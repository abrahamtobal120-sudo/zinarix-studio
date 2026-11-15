import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  DesignApplyResult,
  DesignHistory,
  DesignLayer,
  DesignOp,
  DesignPreviewCmd,
  DesignPreviewMsg,
  DesignSelection,
  DesignSessionView,
  DesignSrc,
} from '../../shared/design';
import { t } from '../i18n';
import { api, openFile, setState, toast, useStore } from '../store';
import { askInChat } from './Chat';
import { Icon, type IconName } from './Icon';
import { Properties } from './design/Properties';
import { tagName } from './design/names';
import './design/design.css';

type Device = 'desktop' | 'tablet' | 'phone';
const DEVICE_W: Record<Device, number> = { desktop: 0, tablet: 820, phone: 390 };
type Tab = 'file' | 'home' | 'view';
type SaveState = 'saved' | 'saving' | 'error';

const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

const ZOOM_KEY = 'zs.design.zoom';
const PAGE_KEY = 'zs.design.page';

/**
 * Panel de Edición: the open project's pages, live, edited like slides. Click to select,
 * double click to write on a text, change colors and spacing in Properties; every change
 * is written to the project's files at once and can be undone.
 */
export function DesignPanel() {
  const root = useStore((s) => s.workspace?.root ?? null);
  const fsVersion = useStore((s) => s.fsVersion);
  const [view, setView] = useState<DesignSessionView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [tree, setTree] = useState<DesignLayer[]>([]);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<DesignSelection | null>(null);
  const [hover, setHover] = useState<DesignSrc | null>(null);
  const [hidden, setHidden] = useState<Set<DesignSrc>>(new Set());
  const [history, setHistory] = useState<DesignHistory>({
    canUndo: false,
    canRedo: false,
    steps: [],
    redo: [],
  });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [problem, setProblem] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem(ZOOM_KEY)) || 100);
  const [fit, setFit] = useState(true);
  const [mode, setMode] = useState<'edit' | 'visitor'>('edit');
  const [outlines, setOutlines] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [ribbonOpen, setRibbonOpen] = useState(true);
  const [aiText, setAiText] = useState('');
  const [box, setBox] = useState({ w: 800, h: 600 });

  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const aiInput = useRef<HTMLInputElement>(null);
  const scroll = useRef(0);
  const restore = useRef<{ scroll: number; src: DesignSrc | null } | null>(null);
  const selRef = useRef<DesignSelection | null>(null);
  selRef.current = sel;
  const pending = useRef(new Map<DesignSrc, Record<string, string | null>>());
  const flushTimer = useRef<number>(0);
  const busy = useRef<Promise<unknown>>(Promise.resolve());

  // ------------------------------------------------------------ session

  useEffect(() => {
    if (!root) return;
    let gone = false;
    setView(null);
    setLoadError(null);
    void api()
      .design.open()
      .then((v) => {
        if (gone) return;
        setView(v);
        setHistory(v.history);
        const saved = localStorage.getItem(`${PAGE_KEY}:${root}`);
        setPage(v.pages.find((p) => p.file === saved)?.file ?? v.pages[0]?.file ?? null);
      })
      .catch((e: unknown) => !gone && setLoadError(errText(e)));
    return () => {
      gone = true;
      void api().design.close();
    };
  }, [root]);

  useEffect(() => {
    if (root && page) localStorage.setItem(`${PAGE_KEY}:${root}`, page);
    setSel(null);
    setTree([]);
    setHidden(new Set());
  }, [page, root]);

  // Another program (code editor, the AI, git) changed the page: show it as it is now.
  useEffect(() => {
    if (!page || !view?.editable) return;
    const timer = setTimeout(() => {
      void api()
        .design.stale(page)
        .then((stale) => {
          if (!stale) return;
          reload();
          toast(t('dzExternal'));
        })
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsVersion]);

  // ------------------------------------------------------------ preview link

  const send = useCallback((cmd: DesignPreviewCmd) => {
    frame.current?.contentWindow?.postMessage({ zx: 1, ...cmd }, '*');
  }, []);

  const reload = useCallback(() => {
    restore.current = { scroll: scroll.current, src: selRef.current?.src ?? null };
    setFrameKey((k) => k + 1);
  }, []);

  /** Runs edits one after the other (a style change waiting to be written goes first). */
  const run = useCallback(
    (fn: () => Promise<DesignApplyResult | null>, after?: (r: DesignApplyResult) => void) => {
      setSaveState('saving');
      const next = busy.current.then(async () => {
        try {
          const r = await fn();
          if (r) {
            setHistory(r.history);
            if (r.reload || r.file !== page) {
              if (r.file !== page) setPage(r.file);
              else reload();
            }
            after?.(r);
          }
          setSaveState('saved');
          setProblem(null);
        } catch (e) {
          setSaveState('error');
          setProblem(errText(e));
          // The preview may show a change that was not written: back to the file.
          reload();
        }
      });
      busy.current = next;
      return next;
    },
    [page, reload],
  );

  const flush = useCallback(() => {
    clearTimeout(flushTimer.current);
    const all = [...pending.current.entries()];
    pending.current.clear();
    for (const [src, styles] of all)
      void run(() => api().design.apply({ kind: 'setStyle', src, styles }));
    return busy.current;
  }, [run]);

  const apply = useCallback(
    (op: DesignOp) => {
      void flush();
      return run(() => api().design.apply(op));
    },
    [flush, run],
  );

  /** Style change: seen at once in the preview, written a moment later (one Undo step). */
  const setStyle = useCallback(
    (styles: Record<string, string | null>) => {
      const s = selRef.current;
      if (!s) return;
      send({ type: 'style', src: s.src, styles });
      pending.current.set(s.src, { ...pending.current.get(s.src), ...styles });
      setSaveState('saving');
      clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => void flush(), 400);
    },
    [flush, send],
  );

  const undo = useCallback(
    async (times = 1) => {
      await flush();
      for (let i = 0; i < times; i++) await run(() => api().design.undo());
    },
    [flush, run],
  );
  const redo = useCallback(async () => {
    await flush();
    await run(() => api().design.redo());
  }, [flush, run]);

  const askAi = useCallback(
    (text: string) => {
      const s = selRef.current;
      const ctx = [
        {
          source: s ? `${page} · ${tagName(s.tag)}` : (page ?? 'página'),
          content: s ? s.outer : `Página ${page}`,
        },
      ];
      const what = text.trim();
      if (!what) {
        aiInput.current?.focus();
        return;
      }
      askInChat(
        t('dzAiPrompt', {
          file: page ?? '',
          target: s ? `${tagName(s.tag)} «${s.text}»` : t('dzWholePage'),
          what,
        }),
        ctx,
      );
      setAiText('');
    },
    [page],
  );

  // Messages from the preview frame (only that frame: other windows are ignored).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const msg = e.data as DesignPreviewMsg & { zx?: number };
      if (!msg || msg.zx !== 1) return;
      switch (msg.type) {
        case 'ready': {
          setTree(msg.tree);
          setTitle(msg.title);
          frame.current?.contentWindow?.postMessage(
            { zx: 1, type: 'mode', mode, names: tagNames() },
            '*',
          );
          send({ type: 'outlines', on: outlines });
          for (const h of hidden) send({ type: 'setHidden', src: h, hidden: true });
          const r = restore.current;
          restore.current = null;
          // After a reload: same scroll, same element selected (its number did not change).
          if (r) {
            send({ type: 'scrollTo', y: r.scroll });
            if (r.src) send({ type: 'select', src: r.src });
          }
          break;
        }
        case 'scroll':
          scroll.current = msg.y;
          break;
        case 'hover':
          setHover(msg.src);
          break;
        case 'select':
          setSel(msg.selection);
          break;
        case 'textChanged':
          void apply({ kind: 'setText', src: msg.src, html: msg.html });
          break;
        case 'key':
          if (msg.key === 'undo') void undo();
          else if (msg.key === 'redo') void redo();
          else if (msg.key === 'save') void flush().then(() => toast(t('dzSavedAll')));
          else if (msg.key === 'ai') aiInput.current?.focus();
          else if (msg.key === 'escape') {
            const parent = selRef.current?.parents[0];
            send({ type: 'select', src: parent?.src ?? null });
            if (!parent) setSel(null);
          }
          break;
        case 'action':
          if (msg.action === 'ai') aiInput.current?.focus();
          else {
            const parent = selRef.current?.parents[0];
            if (parent) send({ type: 'select', src: parent.src });
          }
          break;
        case 'navigate': {
          const want = msg.path.replace(/^\/+/, '');
          const p = view?.pages.find(
            (x) => x.file === want || x.path === msg.path || x.file === `${want}.html` ||
              x.file === `${want}${want && !want.endsWith('/') ? '/' : ''}index.html`,
          );
          if (p) setPage(p.file);
          break;
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [apply, flush, hidden, mode, outlines, redo, send, undo, view]);

  useEffect(() => send({ type: 'mode', mode }), [mode, send]);
  useEffect(() => send({ type: 'outlines', on: outlines }), [outlines, send]);

  // Commands from the palette ("Ver como visitante").
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === 'visitor') setMode('visitor');
    };
    window.addEventListener('zx-design', on);
    return () => window.removeEventListener('zx-design', on);
  }, []);

  // Write what is pending before leaving the panel.
  useEffect(() => () => void flush(), [flush]);

  // Size of the stage, to fit the page in the window.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  useEffect(() => localStorage.setItem(ZOOM_KEY, String(zoom)), [zoom]);

  // ------------------------------------------------------------ keys outside the preview

  const onKey = (e: React.KeyboardEvent) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('input, textarea, select, [contenteditable]')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      void undo();
    } else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      void redo();
    } else if (ctrl && k === 'k') {
      e.preventDefault();
      aiInput.current?.focus();
    } else if (ctrl && k === '0') {
      e.preventDefault();
      setFit(true);
    }
  };

  // ------------------------------------------------------------ layout

  const exit = () => {
    void flush();
    setState({ sidebar: 'explorer' });
  };

  if (!root)
    return (
      <Empty icon="folder" title={t('dzNoFolder')} text={t('dzNoFolderText')}>
        <button className="primary" onClick={() => void runOpenFolder()}>
          {t('dzOpenFolder')}
        </button>
        <button onClick={exit}>{t('dzExit')}</button>
      </Empty>
    );
  if (loadError)
    return (
      <Empty icon="warning" title={t('dzLoadError')} text={loadError}>
        <button onClick={exit}>{t('dzExit')}</button>
      </Empty>
    );
  if (!view)
    return (
      <Empty icon="palette" title={t('dzLoading')} text="">
        {null}
      </Empty>
    );
  if (!view.editable || !view.base || !page)
    return (
      <Empty
        icon="palette"
        title={view.kind === 'unknown' ? t('dzNoPages') : t('dzNotYet', { kind: view.label })}
        text={view.kind === 'unknown' ? t('dzNoPagesText') : t('dzNotYetText')}
      >
        <button
          className="primary"
          onClick={() =>
            askInChat(view.kind === 'unknown' ? t('dzAiNewSite') : t('dzAiNotYet', { kind: view.label }))
          }
        >
          <Icon name="sparkle" size={14} /> {t('dzAskAi')}
        </button>
        <button onClick={exit}>{t('dzExit')}</button>
      </Empty>
    );

  const pageIdx = view.pages.findIndex((p) => p.file === page);
  const devW = DEVICE_W[device];
  const pad = 32;
  const scale = fit
    ? devW
      ? Math.min(1, (box.w - pad) / devW)
      : 1
    : zoom / 100;
  const frameW = devW || Math.max(320, (box.w - pad) / scale);
  const frameH = Math.max(200, (box.h - pad) / scale);
  const shownZoom = Math.round(scale * 100);
  const url = `${view.base}/${page.split('/').map(encodeURIComponent).join('/')}?v=${frameKey}`;

  const R = (props: { icon: IconName; label: string; onClick: () => void; on?: boolean; disabled?: boolean; title?: string }) => (
    <button
      className={`dz-rb ${props.on ? 'on' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title ?? props.label}
      aria-pressed={props.on}
    >
      <Icon name={props.icon} size={18} />
      <span>{props.label}</span>
    </button>
  );
  const editable = Boolean(sel?.editable);
  const fmt = (command: 'bold' | 'italic' | 'underline' | 'strikeThrough') =>
    send({ type: 'format', command });

  return (
    <div className="dz" onKeyDown={onKey}>
      {/* ---------------- ribbon ---------------- */}
      <div className="dz-tabs" role="tablist">
        {(
          [
            ['file', t('dzTabFile')],
            ['home', t('dzTabHome')],
            ['view', t('dzTabView')],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => (tab === id ? setRibbonOpen((o) => !o) : (setTab(id), setRibbonOpen(true)))}
            onDoubleClick={() => setRibbonOpen((o) => !o)}
          >
            {label}
          </button>
        ))}
        <form
          className="dz-ai"
          onSubmit={(e) => {
            e.preventDefault();
            askAi(aiText);
          }}
        >
          <Icon name="sparkle" size={14} />
          <input
            ref={aiInput}
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder={sel ? t('dzAiPlaceholderSel', { what: tagName(sel.tag) }) : t('dzAiPlaceholder')}
            aria-label={t('dzAiPlaceholder')}
          />
        </form>
        <button className="dz-exit" onClick={exit} title={t('dzExitTitle')}>
          <Icon name="close" size={14} /> {t('dzExit')}
        </button>
      </div>
      {ribbonOpen && (
        <div className="dz-ribbon" role="toolbar">
          {tab === 'file' && (
            <>
              <Group label={t('dzGroupFile')}>
                <R icon="file" label={t('dzSeeCode')} onClick={() => void openFile(page)} title={t('dzSeeCodeTitle')} />
                <R icon="history" label={t('dzVersions')} onClick={() => setState({ sidebar: 'git' })} />
                <R icon="close" label={t('dzExit')} onClick={exit} />
              </Group>
            </>
          )}
          {tab === 'home' && (
            <>
              <Group label={t('dzGroupHistory')}>
                <R icon="undo" label={t('dzUndo')} onClick={() => void undo()} disabled={!history.canUndo} title={history.steps[0] ? `${t('dzUndo')}: ${history.steps[0]} (Ctrl+Z)` : t('dzUndo')} />
                <R icon="continue" label={t('dzRedo')} onClick={() => void redo()} disabled={!history.canRedo} title={history.redo[0] ? `${t('dzRedo')}: ${history.redo[0]} (Ctrl+Y)` : t('dzRedo')} />
              </Group>
              <Group label={t('dzGroupText')}>
                <R icon="edit" label={t('dzEditText')} onClick={() => sel && send({ type: 'editText', src: sel.src })} disabled={!editable} title={t('dzEditTextTitle')} />
                <button className="dz-rb dz-fmt" disabled={!editable} onClick={() => fmt('bold')} title={t('dzBold')}><b>B</b></button>
                <button className="dz-rb dz-fmt" disabled={!editable} onClick={() => fmt('italic')} title={t('dzItalic')}><i>I</i></button>
                <button className="dz-rb dz-fmt" disabled={!editable} onClick={() => fmt('underline')} title={t('dzUnderline')}><u>U</u></button>
                <button className="dz-rb dz-fmt" disabled={!editable} onClick={() => fmt('strikeThrough')} title={t('dzStrike')}><s>S</s></button>
              </Group>
              <Group label={t('dzGroupSelect')}>
                <R icon="back" label={t('dzParent')} onClick={() => sel?.parents[0] && send({ type: 'select', src: sel.parents[0].src })} disabled={!sel?.parents.length} title={t('dzParentTitle')} />
                <R icon="x" label={t('dzDeselect')} onClick={() => { send({ type: 'select', src: null }); setSel(null); }} disabled={!sel} />
              </Group>
              <Group label={t('dzGroupAi')}>
                <R icon="sparkle" label={t('dzAskAi')} onClick={() => (aiText.trim() ? askAi(aiText) : aiInput.current?.focus())} />
              </Group>
            </>
          )}
          {tab === 'view' && (
            <>
              <Group label={t('dzGroupDevice')}>
                <R icon="monitor" label={t('dzDesktop')} on={device === 'desktop'} onClick={() => setDevice('desktop')} />
                <R icon="window" label={t('dzTablet')} on={device === 'tablet'} onClick={() => setDevice('tablet')} />
                <R icon="smartphone" label={t('dzPhone')} on={device === 'phone'} onClick={() => setDevice('phone')} />
              </Group>
              <Group label={t('dzGroupShow')}>
                <R icon="eye" label={t('dzVisitor')} on={mode === 'visitor'} onClick={() => setMode((m) => (m === 'edit' ? 'visitor' : 'edit'))} title={t('dzVisitorTitle')} />
                <R icon="columns" label={t('dzOutlines')} on={outlines} onClick={() => setOutlines((o) => !o)} />
                <R icon="refresh" label={t('dzReload')} onClick={reload} />
              </Group>
              <Group label={t('dzGroupZoom')}>
                <R icon="maximize" label={t('dzFit')} on={fit} onClick={() => setFit(true)} title={`${t('dzFit')} (Ctrl+0)`} />
                <R icon="search" label="100%" on={!fit && zoom === 100} onClick={() => (setFit(false), setZoom(100))} />
              </Group>
            </>
          )}
        </div>
      )}

      <div className="dz-body">
        {/* ---------------- pages + layers ---------------- */}
        <aside className="dz-left">
          <div className="dz-head">{t('dzPages')}</div>
          <div className="dz-pages">
            {view.pages.map((p, i) => (
              <button
                key={p.file}
                className={`dz-page ${p.file === page ? 'on' : ''}`}
                onClick={() => {
                  void flush();
                  setPage(p.file);
                }}
                title={`${p.path} · ${p.file}`}
              >
                <span className="dz-page-n">{i + 1}</span>
                <span className="dz-page-name">{p.name}</span>
                <span className="dz-page-path">{p.path}</span>
              </button>
            ))}
          </div>
          <div className="dz-head">{t('dzLayers')}</div>
          <div className="dz-layers" role="tree" aria-label={t('dzLayers')}>
            {tree.length === 0 ? (
              <div className="dz-muted">{t('dzEmptyPage')}</div>
            ) : (
              tree.map((l) => (
                <LayerRow
                  key={l.src}
                  layer={l}
                  depth={0}
                  selected={sel?.src ?? null}
                  hover={hover}
                  hidden={hidden}
                  onSelect={(src) => send({ type: 'select', src })}
                  onHover={(src) => send({ type: 'hover', src })}
                  onToggleHidden={(src) => {
                    const next = new Set(hidden);
                    const h = !next.has(src);
                    if (h) next.add(src);
                    else next.delete(src);
                    setHidden(next);
                    send({ type: 'setHidden', src, hidden: h });
                  }}
                />
              ))
            )}
          </div>
        </aside>

        {/* ---------------- canvas ---------------- */}
        <main className="dz-center">
          <div className="dz-stage" ref={stage}>
            <div
              className={`dz-frame-wrap ${device}`}
              style={{ width: frameW * scale, height: frameH * scale }}
            >
              <iframe
                key={page}
                ref={frame}
                className="dz-frame"
                title={title || page}
                src={url}
                // Opaque origin: the project's scripts can't reach Zinarix (only postMessage).
                sandbox="allow-scripts allow-forms allow-modals"
                style={{
                  width: frameW,
                  height: frameH,
                  transform: `scale(${scale})`,
                }}
              />
            </div>
          </div>
        </main>

        {/* ---------------- properties ---------------- */}
        <aside className="dz-right">
          <div className="dz-head">{t('dzProps')}</div>
          {sel ? (
            <Properties
              key={sel.src}
              sel={sel}
              setStyle={setStyle}
              onEditText={() => send({ type: 'editText', src: sel.src })}
              onParent={(src) => send({ type: 'select', src })}
            />
          ) : (
            <div className="dz-muted dz-pad">{t('dzNothingSelected')}</div>
          )}
        </aside>
      </div>

      {/* ---------------- status bar ---------------- */}
      <div className="dz-status">
        <button onClick={() => void undo()} disabled={!history.canUndo} title={`${t('dzUndo')} (Ctrl+Z)`}>
          <Icon name="undo" size={13} />
        </button>
        {history.steps.length > 1 && (
          <select
            className="dz-steps"
            value=""
            aria-label={t('dzUndoList')}
            onChange={(e) => e.target.value && void undo(Number(e.target.value))}
          >
            <option value="">{t('dzUndoList')}</option>
            {history.steps.slice(0, 30).map((s, i) => (
              <option key={i} value={i + 1}>
                {i + 1}. {s}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => void redo()} disabled={!history.canRedo} title={`${t('dzRedo')} (Ctrl+Y)`}>
          <Icon name="continue" size={13} />
        </button>
        <span className={`dz-save ${saveState}`}>
          {saveState === 'saved' ? `${t('dzSaved')} ✓` : saveState === 'saving' ? t('dzSaving') : t('dzSaveError')}
        </span>
        {problem && (
          <span className="dz-problem" role="alert">
            <Icon name="warning" size={13} /> {problem}
            <button className="link" onClick={() => askAi(t('dzAiFix', { problem }))}>
              {t('dzAskAiDo')}
            </button>
            <button className="link" onClick={() => setProblem(null)} aria-label={t('dzDismiss')}>
              ×
            </button>
          </span>
        )}
        <span className="spacer" />
        {mode === 'visitor' && <span className="dz-badge">{t('dzVisitorOn')}</span>}
        <span>{t('dzPageOf', { n: pageIdx + 1, total: view.pages.length })}</span>
        <input
          type="range"
          min={25}
          max={200}
          step={5}
          value={shownZoom}
          aria-label={t('dzGroupZoom')}
          onChange={(e) => {
            setFit(false);
            setZoom(Number(e.target.value));
          }}
        />
        <span className="dz-zoom">{shownZoom}%</span>
        <button onClick={() => setFit(true)} title={`${t('dzFit')} (Ctrl+0)`}>
          <Icon name="maximize" size={13} />
        </button>
      </div>
    </div>
  );
}

function runOpenFolder(): Promise<void> {
  return api()
    .workspace.openDialog()
    .then((ws) => {
      if (ws) setState({ workspace: ws, sidebar: 'design' });
    });
}

function tagNames(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button', 'img', 'section', 'header', 'footer', 'nav', 'div', 'span', 'ul', 'ol', 'li', 'form', 'input', 'main', 'article', 'aside', 'figure', 'video', 'table', 'body', 'blockquote', 'label', 'textarea', 'select', 'svg', 'strong', 'b', 'em', 'i', 'hr', 'iframe', 'small'])
    out[tag] = tagName(tag);
  return out;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dz-group" role="group" aria-label={label}>
      <div className="dz-group-items">{children}</div>
      <div className="dz-group-label">{label}</div>
    </div>
  );
}

function Empty(props: { icon: IconName; title: string; text: string; children: ReactNode }) {
  const exitOnly = () => setState({ sidebar: 'explorer' });
  return (
    <div className="dz dz-empty">
      <div className="dz-empty-card">
        <Icon name={props.icon} size={34} />
        <h2>{props.title}</h2>
        {props.text && <p>{props.text}</p>}
        <div className="dz-empty-actions">{props.children ?? <button onClick={exitOnly}>{t('dzExit')}</button>}</div>
      </div>
    </div>
  );
}

function LayerRow(props: {
  layer: DesignLayer;
  depth: number;
  selected: DesignSrc | null;
  hover: DesignSrc | null;
  hidden: Set<DesignSrc>;
  onSelect: (src: DesignSrc) => void;
  onHover: (src: DesignSrc | null) => void;
  onToggleHidden: (src: DesignSrc) => void;
}) {
  const { layer, depth } = props;
  const [open, setOpen] = useState(depth < 2);
  const contains = (l: DesignLayer, src: DesignSrc | null): boolean =>
    !!src && (l.src === src || l.children.some((c) => contains(c, src)));
  // Selecting something on the page opens the branches down to it.
  useEffect(() => {
    if (props.selected && props.selected !== layer.src && contains(layer, props.selected)) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selected]);
  const ref = useRef<HTMLDivElement>(null);
  const isSel = props.selected === layer.src;
  useEffect(() => {
    if (isSel) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isSel]);
  const isHidden = props.hidden.has(layer.src);
  return (
    <>
      <div
        ref={ref}
        role="treeitem"
        aria-selected={isSel}
        aria-expanded={layer.children.length ? open : undefined}
        tabIndex={0}
        className={`dz-layer ${isSel ? 'on' : ''} ${props.hover === layer.src ? 'hover' : ''} ${isHidden ? 'off' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => props.onSelect(layer.src)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onSelect(layer.src);
          } else if (e.key === 'ArrowRight') setOpen(true);
          else if (e.key === 'ArrowLeft') setOpen(false);
        }}
        onMouseEnter={() => props.onHover(layer.src)}
        onMouseLeave={() => props.onHover(null)}
      >
        <span
          className={`dz-twisty ${layer.children.length ? '' : 'none'} ${open ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <Icon name="chevron" size={11} />
        </span>
        <span className="dz-layer-name">{tagName(layer.tag)}</span>
        {layer.text && <span className="dz-layer-text">{layer.text}</span>}
        <button
          className="dz-eye"
          title={isHidden ? t('dzShow') : t('dzHide')}
          aria-label={isHidden ? t('dzShow') : t('dzHide')}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleHidden(layer.src);
          }}
        >
          <Icon name="eye" size={12} />
        </button>
      </div>
      {open &&
        layer.children.map((c) => <LayerRow key={c.src} {...props} layer={c} depth={depth + 1} />)}
    </>
  );
}
