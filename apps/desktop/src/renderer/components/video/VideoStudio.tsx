import { useEffect, useRef, useState } from 'react';
import {
  FORMAT_PRESETS,
  FPS_CHOICES,
  RESOLUTIONS,
  pasteClips,
  sizeFor,
} from '../../../shared/video';
import { api, toast } from '../../store';
import { Icon, type IconName } from '../Icon';
import { ExportDialog, RenderQueue } from './ExportDialog';
import { Inspector } from './Inspector';
import { MediaLibrary, pickAndImport } from './MediaLibrary';
import { tv, type VideoKey } from './strings';
import {
  addMarkerAtPlayhead,
  deleteSelection,
  setInOut,
  splitAtPlayhead,
  Timeline,
  zoomBy,
  zoomToFit,
} from './Timeline';
import { shuttle, stepFrame, togglePlay } from './Viewer';
import { Viewer } from './Viewer';
import './video.css';
import {
  closeStudio,
  commit,
  closeTopPopover,
  getV,
  holdEscape,
  importPaths,
  loadLayout,
  minimizeStudio,
  newProjectWith,
  openProjectFile,
  openStudio,
  redo,
  saveLayout,
  saveProject,
  seek,
  setV,
  toggleStudio,
  undo,
  useV,
  wireJobs,
  type Layout,
  type StudioTab,
} from './videoStore';
import { projectDuration } from '../../../shared/video';

const TABS: { id: StudioTab; key: VideoKey; icon: IconName; phase?: number; soon?: VideoKey }[] = [
  { id: 'media', key: 'tabMedia', icon: 'folder' },
  { id: 'audio', key: 'tabAudio', icon: 'music', phase: 2, soon: 'soonAudio' },
  { id: 'text', key: 'tabText', icon: 'type', phase: 2, soon: 'soonText' },
  { id: 'stickers', key: 'tabStickers', icon: 'smile', phase: 2, soon: 'soonStickers' },
  { id: 'effects', key: 'tabEffects', icon: 'sparkle', phase: 2, soon: 'soonEffects' },
  { id: 'transitions', key: 'tabTransitions', icon: 'layers', phase: 2, soon: 'soonTransitions' },
  { id: 'filters', key: 'tabFilters', icon: 'palette', phase: 3, soon: 'soonFilters' },
  { id: 'ai', key: 'tabAi', icon: 'cpu', phase: 4, soon: 'soonAi' },
];

/** Top bar + tabs + sash, in px (the rest is viewer and timeline). */
const CHROME_H = 104;
const MIN_VIEWER_H = 240;
const MIN_VIEWER_W = 380;

function useWindowSize(): { w: number; h: number } {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/** Mounted from the first time the studio opens, so closing it keeps everything as it was. */
export function VideoStudioHost() {
  const open = useV((s) => s.open);
  // Ctrl+Shift+V anywhere in the app (the menu has it too; toggleStudio ignores the double).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyV') {
        e.preventDefault();
        e.stopPropagation();
        toggleStudio();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const minimized = useV((s) => s.minimized);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open && !minimized) {
      setMounted(true);
      wireJobs();
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
  }, [open, minimized]);
  return (
    <>
      {mounted && <VideoStudio shown={shown} visible={open && !minimized} />}
      <MiniPill />
    </>
  );
}

function VideoStudio({ shown, visible }: { shown: boolean; visible: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const tab = useV((s) => s.tab);
  const dialog = useV((s) => s.dialog);
  const prompt = useV((s) => s.prompt);
  const tools = useV((s) => s.tools);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [gone, setGone] = useState(!visible);

  // Fade out, then take it out of the layout (it stays mounted).
  useEffect(() => {
    if (visible) {
      setGone(false);
      root.current?.focus();
      return;
    }
    const t = setTimeout(() => setGone(true), 200);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => saveLayout(layout), [layout]);
  useStudioKeys(visible);

  const drag =
    (key: 'left' | 'right' | 'timeline', sign: 1 | -1, axis: 'x' | 'y') =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      let last = axis === 'x' ? e.clientX : e.clientY;
      const move = (ev: MouseEvent) => {
        const now = axis === 'x' ? ev.clientX : ev.clientY;
        const d = (now - last) * sign;
        last = now;
        setLayout((l) => {
          const lim =
            key === 'timeline'
              ? [150, window.innerHeight - CHROME_H - MIN_VIEWER_H]
              : [200, Math.min(560, window.innerWidth - MIN_VIEWER_W)];
          // Start from what is on screen (the saved size may be larger than the window allows).
          const from = key === 'timeline' ? Math.min(l.timeline, lim[1]!) : l[key];
          return { ...l, [key]: Math.max(lim[0]!, Math.min(lim[1]!, from + d)) };
        });
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.classList.remove('dragging');
      };
      document.body.classList.add('dragging');
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

  // Small windows: panels shrink so the viewer always keeps room; the inspector steps aside.
  const win = useWindowSize();
  const narrow = win.w < 900;
  const showLeft = layout.showLeft;
  const showRight = layout.showRight && !narrow;
  const sideRoom = Math.max(0, win.w - MIN_VIEWER_W);
  const wantLeft = showLeft ? layout.left : 0;
  const wantRight = showRight ? layout.right : 0;
  const k = wantLeft + wantRight > sideRoom ? sideRoom / (wantLeft + wantRight) : 1;
  const leftW = Math.max(180, Math.round(wantLeft * k));
  const rightW = Math.max(180, Math.round(wantRight * k));
  // The timeline never pushes the viewer below a usable height.
  const timelineH = Math.max(150, Math.min(layout.timeline, win.h - CHROME_H - MIN_VIEWER_H));

  const current = TABS.find((x) => x.id === tab)!;
  return (
    <div
      ref={root}
      className={`vs-root ${shown && visible ? 'vs-in' : ''}`}
      style={gone ? { display: 'none' } : undefined}
      role="application"
      aria-label={tv('title')}
      tabIndex={-1}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        // Anywhere else in the studio: the files go to the media library.
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const paths = [...e.dataTransfer.files]
          .map((f) => api().app.pathForFile(f))
          .filter(Boolean);
        void importPaths(paths);
      }}
    >
      <TopBar />
      {tools && !tools.ffmpeg && <div className="vs-banner">{tv('noFfmpeg')}</div>}
      <nav className="vs-tabs">
        <div className="vs-tabs-scroll" role="tablist" aria-label={tv('title')}>
          {TABS.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={tab === x.id}
              className={tab === x.id ? 'on' : ''}
              onClick={() => {
                setV({ tab: x.id });
                if (!layout.showLeft) setLayout((l) => ({ ...l, showLeft: true }));
              }}
            >
              <Icon name={x.icon} size={15} />
              <span>{tv(x.key)}</span>
              {x.phase && <i className="vs-tab-soon" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="vs-tabs-tools">
          <button
            className="vs-icon-btn"
            title={tv('shortcuts')}
            aria-label={tv('shortcuts')}
            onClick={() => setV({ dialog: 'shortcuts' })}
          >
            <Icon name="keyboard" size={15} />
          </button>
          <button
            className={`vs-icon-btn ${layout.showLeft ? 'on' : ''}`}
            aria-label={tv('togglePanel')}
            aria-pressed={layout.showLeft}
            title={tv('togglePanel')}
            onClick={() => setLayout((l) => ({ ...l, showLeft: !l.showLeft }))}
          >
            <Icon name="columns" size={15} />
          </button>
          {!narrow && (
            <button
              className={`vs-icon-btn ${layout.showRight ? 'on' : ''}`}
              aria-label={tv('toggleInspector')}
              aria-pressed={layout.showRight}
              title={tv('toggleInspector')}
              onClick={() => setLayout((l) => ({ ...l, showRight: !l.showRight }))}
            >
              <Icon name="settings" size={15} />
            </button>
          )}
        </div>
      </nav>
      <div className="vs-main">
        {showLeft && (
          <>
            <section className="vs-left" style={{ width: leftW }} aria-label={tv(current.key)}>
              {tab === 'media' ? (
                <MediaLibrary />
              ) : (
                <div className="vs-soon">
                  <span className="vs-soon-icon">
                    <Icon name={current.icon} size={26} />
                  </span>
                  <h3>{tv(current.key)}</h3>
                  <span className="vs-soon-badge">{tv('soonBadge')}</span>
                  <p>{tv('comingPhase', { n: current.phase ?? 2 })}</p>
                  {current.soon && (
                    <p className="vs-dim">{tv('comingList', { what: tv(current.soon) })}</p>
                  )}
                </div>
              )}
            </section>
            <div
              className="vs-sash vs-sash-x"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={drag('left', 1, 'x')}
            />
          </>
        )}
        <section className="vs-center">
          <Viewer />
        </section>
        {showRight && (
          <>
            <div
              className="vs-sash vs-sash-x"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={drag('right', -1, 'x')}
            />
            <section className="vs-right" style={{ width: rightW }}>
              <Inspector />
            </section>
          </>
        )}
      </div>
      <div
        className="vs-sash vs-sash-y"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={drag('timeline', -1, 'y')}
      />
      <section className="vs-bottom" style={{ height: timelineH }}>
        <Timeline />
      </section>
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'new' && <NewProjectDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {prompt && <PromptBox key={prompt.label} />}
    </div>
  );
}

function TopBar() {
  const name = useV((s) => s.project.name);
  const dirty = useV((s) => s.dirty);
  const savedAt = useV((s) => s.savedAt);
  const autosavedAt = useV((s) => s.autosavedAt);
  const canUndo = useV((s) => s.past.length > 0);
  const canRedo = useV((s) => s.future.length > 0);
  const undoLabel = useV((s) => s.past.at(-1)?.label);
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!menuBox.current?.contains(e.target as Node)) setMenu(false);
    };
    const release = holdEscape(() => setMenu(false));
    window.addEventListener('mousedown', away);
    return () => {
      release();
      window.removeEventListener('mousedown', away);
    };
  }, [menu]);
  const status = dirty
    ? autosavedAt
      ? tv('autosaved', {
          time: new Date(autosavedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        })
      : tv('unsaved')
    : savedAt
      ? tv('savedAt', {
          time: new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })
      : '';
  return (
    <header className="vs-top">
      <div className="vs-logo" aria-hidden="true">
        <Icon name="film" size={18} />
      </div>
      <span className="vs-brand">Video Studio</span>
      <span className="vs-top-sep" aria-hidden="true" />
      <div className="vs-filemenu" ref={menuBox}>
        <button
          className="vs-icon-btn"
          title={tv('fileMenu')}
          aria-label={tv('fileMenu')}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Icon name="menu" size={16} />
        </button>
        {menu && (
          <div className="vs-menu vs-menu-down" role="menu">
            {(
              [
                [tv('newProject'), () => setV({ dialog: 'new' })],
                [tv('openProject'), () => void openProjectFile()],
                [tv('save'), () => void saveProject()],
                [tv('saveAs'), () => void saveProject(true)],
                [tv('import'), () => void pickAndImport()],
              ] as const
            ).map(([label, run]) => (
              <button
                key={label}
                className="vs-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  run();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        className="vs-name"
        aria-label={tv('projectName')}
        value={name}
        maxLength={120}
        onChange={(e) =>
          setV((s) => ({ project: { ...s.project, name: e.target.value }, dirty: true }))
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className={`vs-save-state ${dirty ? 'dirty' : ''}`} title={status}>
        <span className="vs-dot" />
        <span className="vs-save-text">{status}</span>
      </span>
      <div className="vs-top-mid">
        <button
          className="vs-icon-btn"
          title={undoLabel ? `${tv('undo')} · ${undoLabel}` : tv('undo')}
          aria-label={tv('undo')}
          disabled={!canUndo}
          onClick={undo}
        >
          <Icon name="undo" size={16} />
        </button>
        <button
          className="vs-icon-btn"
          title={tv('redo')}
          aria-label={tv('redo')}
          disabled={!canRedo}
          onClick={redo}
        >
          <Icon name="undo" size={16} className="vs-flip" />
        </button>
        <button
          className="vs-icon-btn"
          title={tv('save')}
          aria-label={tv('save')}
          onClick={() => void saveProject()}
        >
          <Icon name="download" size={16} />
        </button>
      </div>
      <div className="spacer" />
      <RenderQueue />
      <button
        className="vs-ghost vs-back"
        title={tv('backToChat')}
        aria-label={tv('backToChat')}
        onClick={() => void closeStudio(true)}
      >
        <Icon name="agent" size={15} />
        <span className="vs-back-label">{tv('backToChat')}</span>
      </button>
      <button
        className="vs-icon-btn"
        title={tv('minimize')}
        aria-label={tv('minimize')}
        onClick={minimizeStudio}
      >
        <Icon name="minimize" size={16} />
      </button>
      <button
        className="primary vs-export"
        onClick={() => {
          if (!projectDuration(getV().project)) return toast(tv('exportEmpty'));
          setV({ dialog: 'export' });
        }}
      >
        <Icon name="push" size={15} />
        <span>{tv('exportBtn')}</span>
      </button>
    </header>
  );
}

/** Floating pill while the studio is minimized (or closed with an export running). */
function MiniPill() {
  const open = useV((s) => s.open);
  const minimized = useV((s) => s.minimized);
  const running = useV((s) => s.jobs.find((j) => j.state === 'running' || j.state === 'queued'));
  if (open && !minimized) return null;
  if (!minimized && !running) return null;
  const pct = running ? Math.round(running.progress * 100) : null;
  return (
    <button className="vs-pill" onClick={() => void openStudio()} title={tv('restore')}>
      <Icon name="film" size={15} />
      {pct != null ? tv('rendering', { pct }) : tv('title')}
      {pct != null && (
        <span className="vs-pill-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </button>
  );
}

function NewProjectDialog() {
  const [aspect, setAspect] = useState(FORMAT_PRESETS[0]!.id);
  const [short, setShort] = useState(1080);
  const [fps, setFps] = useState(30);
  // Typed as text and rounded on create (rounding each keystroke made typing impossible).
  const [customText, setCustomText] = useState({ width: '1920', height: '1080' });
  const even = (v: string) => Math.min(8192, Math.max(16, Math.round((Number(v) || 0) / 2) * 2));
  const custom = { width: even(customText.width), height: even(customText.height) };
  const preset = FORMAT_PRESETS.find((p) => p.id === aspect);
  const size = preset ? sizeFor(preset.width, preset.height, short) : custom;
  return (
    <div className="vs-dialog-bg" onMouseDown={() => setV({ dialog: null })}>
      <div
        className="vs-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tv('newTitle')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="vs-dialog-head">
          <h2>{tv('newTitle')}</h2>
          <button
            className="vs-icon-btn"
            aria-label={tv('close')}
            onClick={() => setV({ dialog: null })}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="vs-formats" role="radiogroup" aria-label={tv('format')}>
          {[
            ...FORMAT_PRESETS,
            { id: 'custom', label: tv('custom'), width: custom.width, height: custom.height },
          ].map((f) => {
            const k = Math.min(40 / f.width, 40 / f.height);
            return (
              <button
                key={f.id}
                role="radio"
                aria-checked={aspect === f.id}
                className={aspect === f.id ? 'on' : ''}
                onClick={() => setAspect(f.id)}
              >
                <span className="vs-format-art">
                  <span
                    className="vs-format-box"
                    style={{ width: f.width * k, height: f.height * k }}
                  />
                </span>
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>
        <div className="vs-form">
          {preset ? (
            <label>
              <span>{tv('resolution')}</span>
              <select
                className="vs-select"
                value={short}
                onChange={(e) => setShort(Number(e.target.value))}
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.id} value={r.short}>
                    {r.id}
                  </option>
                ))}
              </select>
              <span className="vs-dim">
                {size.width}×{size.height}
              </span>
            </label>
          ) : (
            <div className="vs-form-field">
              <span>
                {tv('width')} × {tv('height')}
              </span>
              <span className="vs-size-inputs">
                <input
                  type="number"
                  min={16}
                  max={8192}
                  step={2}
                  aria-label={tv('width')}
                  value={customText.width}
                  onChange={(e) => setCustomText({ ...customText, width: e.target.value })}
                />
                <span className="vs-dim">×</span>
                <input
                  type="number"
                  min={16}
                  max={8192}
                  step={2}
                  aria-label={tv('height')}
                  value={customText.height}
                  onChange={(e) => setCustomText({ ...customText, height: e.target.value })}
                />
              </span>
              <span className="vs-dim">
                {custom.width}×{custom.height}
              </span>
            </div>
          )}
          <label>
            <span>{tv('fps')}</span>
            <select
              className="vs-select"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
            >
              {FPS_CHOICES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="vs-dialog-foot">
          <div className="spacer" />
          <button onClick={() => setV({ dialog: null })}>{tv('cancel')}</button>
          <button
            className="primary"
            onClick={async () => {
              const w = Math.min(8192, Math.max(16, size.width));
              const h = Math.min(8192, Math.max(16, size.height));
              setV({ dialog: null });
              await newProjectWith({ width: w, height: h, fps });
            }}
          >
            {tv('create')}
          </button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [VideoKey, string][] = [
  ['kToggle', 'Ctrl+Shift+V'],
  ['kPlay', 'Espacio / Space'],
  ['kJkl', 'J / K / L'],
  ['kFrame', '← / →'],
  ['kSplit', 'S · Ctrl+B'],
  ['kInOut', 'I / O'],
  ['kRipple', 'Shift+Supr / Del'],
  ['kSnap', 'N'],
  ['kMarker', 'M'],
  ['kUndo', 'Ctrl+Z / Ctrl+Shift+Z'],
  ['kCopy', 'Ctrl+C / Ctrl+V / Ctrl+D'],
  ['kZoom', '+ / − · Ctrl+rueda'],
  ['kSave', 'Ctrl+S'],
  ['kExport', 'Ctrl+E'],
];

function ShortcutsDialog() {
  return (
    <div className="vs-dialog-bg" onMouseDown={() => setV({ dialog: null })}>
      <div
        className="vs-dialog vs-dialog-sm"
        role="dialog"
        aria-modal="true"
        aria-label={tv('shortcuts')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="vs-dialog-head">
          <h2>{tv('shortcuts')}</h2>
          <button
            className="vs-icon-btn"
            aria-label={tv('close')}
            onClick={() => setV({ dialog: null })}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <table className="vs-keys">
          <tbody>
            {SHORTCUTS.map(([k, combo]) => (
              <tr key={k}>
                <td>{tv(k)}</td>
                <td>
                  <kbd>{combo}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PromptBox() {
  const prompt = useV((s) => s.prompt)!;
  const [value, setValue] = useState(prompt.value);
  const done = (v: string | null) => {
    setV({ prompt: null });
    prompt.resolve(v);
  };
  return (
    <div className="vs-dialog-bg" onMouseDown={() => done(null)}>
      <form
        className="vs-dialog vs-dialog-sm"
        role="dialog"
        aria-modal="true"
        aria-label={prompt.label}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          done(value);
        }}
      >
        <label className="vs-prompt">
          <span>{prompt.label}</span>
          <input
            autoFocus
            value={value}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), done(null))}
          />
        </label>
        <div className="vs-dialog-foot">
          <div className="spacer" />
          <button type="button" onClick={() => done(null)}>
            {tv('cancel')}
          </button>
          <button className="primary" type="submit">
            OK
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------- keyboard ----------------

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT')
    return !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type);
  return false;
}

function useStudioKeys(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const s = getV();
      if (!s.open || s.minimized) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (s.prompt) return;
        if (closeTopPopover()) return;
        if (s.dialog) return setV({ dialog: null });
        if (s.selection.length) return setV({ selection: [] });
        return void closeStudio(true);
      }
      if (s.prompt || typing(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      // Ctrl+S also comes through the app menu (videoCommands.ts): saving twice at once is ignored.
      if (mod && !e.altKey) {
        if (k === 's') return run(() => void saveProject(e.shiftKey));
        if (k === 'z' && !e.shiftKey) return run(undo);
        if ((k === 'z' && e.shiftKey) || k === 'y') return run(redo);
        if (k === 'b') return run(splitAtPlayhead);
        if (k === 'e')
          return run(() =>
            projectDuration(s.project) ? setV({ dialog: 'export' }) : toast(tv('exportEmpty')),
          );
        if (k === 'a') return run(() => setV({ selection: s.project.clips.map((c) => c.id) }));
        if (k === 'c') return run(() => copySelection());
        if (k === 'v' && !e.shiftKey) return run(() => paste(s.playhead));
        if (k === 'd') return run(() => duplicateSelection());
        return;
      }
      if (e.altKey) return;
      if (s.dialog) return;
      switch (e.key) {
        case ' ':
          return run(togglePlay);
        case 'ArrowLeft':
          return run(() => stepFrame(e.shiftKey ? -10 : -1));
        case 'ArrowRight':
          return run(() => stepFrame(e.shiftKey ? 10 : 1));
        case 'Home':
          return run(() => seek(0));
        case 'End':
          return run(() => seek(projectDuration(s.project)));
        case 'Delete':
        case 'Backspace':
          return run(() => deleteSelection(e.shiftKey));
        case '+':
        case '=':
          return run(() => zoomBy(1.5));
        case '-':
          return run(() => zoomBy(1 / 1.5));
        case '?':
          return run(() => setV({ dialog: 'shortcuts' }));
      }
      switch (k) {
        case 'j':
          return run(() => shuttle(-1));
        case 'k':
          return run(() => shuttle(0));
        case 'l':
          return run(() => shuttle(1));
        case 's':
          return run(splitAtPlayhead);
        case 'i':
          return run(() => setInOut('in'));
        case 'o':
          return run(() => setInOut('out'));
        case 'n':
          return run(() => setV({ snap: !s.snap }));
        case 'm':
          return run(addMarkerAtPlayhead);
        case 'z':
          if (e.shiftKey) return run(zoomToFit);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}

function copySelection(): void {
  const s = getV();
  const clips = s.project.clips.filter((c) => s.selection.includes(c.id));
  if (!clips.length) return;
  setV({ clipboard: clips });
  toast(tv('copied', { n: clips.length }));
}

function paste(at: number): void {
  const s = getV();
  if (!s.clipboard.length) return;
  const { project, ids } = pasteClips(s.project, s.clipboard, at);
  commit(project, 'Pegar');
  setV({ selection: ids });
}

function duplicateSelection(): void {
  const s = getV();
  const clips = s.project.clips.filter((c) => s.selection.includes(c.id));
  if (!clips.length) return;
  const end = Math.max(...clips.map((c) => c.start + c.out - c.in));
  const { project, ids } = pasteClips(s.project, clips, end);
  commit(project, 'Duplicar');
  setV({ selection: ids });
}
