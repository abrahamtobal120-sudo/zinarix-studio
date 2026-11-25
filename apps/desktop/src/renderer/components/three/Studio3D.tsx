/**
 * Fase 14: the 3D editor, a full-window layer over the app. Outline on the left, viewport in
 * the middle, inspector on the right, playhead and keys below, render dialog on top.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CAMERA_PROPS,
  EASES_3D,
  LIGHT_TYPES,
  LIMITS,
  ROW_PROPS,
  SHAPES,
  TEMPLATES,
  cameraAt as cameraNow,
  duplicateNode,
  easeAt,
  formatFor,
  fromTemplate,
  hasKeyAt,
  keyTimes,
  makeLight,
  makeMesh,
  makeModel,
  poseAt,
  removeNode,
  setCameraProp,
  setNodeProp,
  withEaseAt,
  withKey,
  withoutKey,
  type CameraProp,
  type Ease3D,
  type Keys,
  type Node3D,
  type NodeProp,
  type Render3DFormat,
  type Scene3D,
  type TemplateId,
  type Vec3,
} from '../../../shared/scene3d';
import type { Pro3DLook } from '../../../shared/api';
import { lang } from '../../i18n';
import { api, toast } from '../../store';
import { Icon, type IconName } from '../Icon';
import { render3d, type Engine3D } from './actions3d';
import {
  close3d,
  commit,
  commitNode,
  get3,
  loadScene,
  redo3,
  selectedNode,
  set3,
  undo3,
  use3,
  type Gizmo,
} from './store3d';
import { t3, type Key3D } from './strings3d';
import { Viewport } from './viewport3d';
import { Gen3DDialog } from './Gen3DDialog';
import { QuickTools3D } from './QuickTools3D';
import './studio3d.css';

const fmtTime = (t: number) => `${t.toFixed(2)} s`;

export function Studio3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport | null>(null);
  const [glError, setGlError] = useState(false);
  const scene = use3((s) => s.scene);
  const time = use3((s) => s.time);
  const selected = use3((s) => s.selected);
  const viewCam = use3((s) => s.viewCam);
  const gizmo = use3((s) => s.gizmo);
  const playing = use3((s) => s.playing);
  const dialog = use3((s) => s.dialog);
  const genOpen = use3((s) => s.genOpen);
  const rendering = use3((s) => s.render);

  // The viewport lives as long as the editor is open.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      vp.current = new Viewport(canvas, {
        select: (id) => set3({ selected: id }),
        transform: (id, position, rotation, scale) => {
          const { scene: s, time: t } = get3();
          const n = s.nodes.find((x) => x.id === id);
          if (!n) return;
          const pose = poseAt(n, t);
          let next = n;
          const apply = (props: readonly NodeProp[], now: Vec3, was: Vec3) =>
            props.forEach((p, i) => {
              if (Math.abs(now[i]! - was[i]!) > 1e-4)
                next = setNodeProp(next, p, now[i]!, t, s.fps);
            });
          apply(ROW_PROPS.position, position, pose.position);
          apply(ROW_PROPS.rotation, rotation, pose.rotation);
          apply(ROW_PROPS.scale, scale, pose.scale);
          if (next !== n) commitNode(id, () => next, `gizmo:${id}`);
        },
      });
    } catch {
      setGlError(true);
    }
    return () => {
      vp.current?.dispose();
      vp.current = null;
    };
  }, []);

  useEffect(() => {
    vp.current?.update(scene, time, selected === 'camera' ? null : selected, viewCam, gizmo);
  }, [scene, time, selected, viewCam, gizmo]);

  // Canvas size follows its box at the scene's aspect.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () =>
      vp.current?.resize(box.clientWidth - 16, box.clientHeight - 16, scene.width / scene.height);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [scene.width, scene.height]);

  // Playback: real time, looping.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const s = get3();
      const t = (s.time + (now - last) / 1000) % s.scene.duration;
      last = now;
      set3({ time: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Keyboard (only when focus is not in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const s = get3();
      const handled = () => (e.preventDefault(), e.stopPropagation());
      const inField =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);
      // Esc always gets you out, even with the cursor in a field: it closes the open dialog,
      // or leaves the field so the next Esc closes the editor.
      if (e.key === 'Escape' && inField) {
        handled();
        if (s.genOpen) set3({ genOpen: false });
        else if (s.dialog) set3({ dialog: false });
        else el.blur();
        return;
      }
      if (inField) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') return (handled(), e.shiftKey ? redo3() : undo3());
      if (ctrl && e.key.toLowerCase() === 'y') return (handled(), redo3());
      if (ctrl && e.key.toLowerCase() === 's') return (handled(), void save(false));
      if (ctrl && e.key.toLowerCase() === 'd' && selectedNode(s)) {
        handled();
        const r = duplicateNode(s.scene, s.selected!);
        commit(r.scene, t3('duplicate'));
        return set3({ selected: r.id });
      }
      if (ctrl || e.altKey) return;
      const modes: Record<string, Gizmo> = { w: 'translate', e: 'rotate', r: 'scale' };
      const k = e.key.toLowerCase();
      if (modes[k]) return (handled(), set3({ gizmo: modes[k] }));
      if (e.key === ' ') return (handled(), set3({ playing: !s.playing }));
      if (k === 'f') return (handled(), vp.current?.focus(s.selected));
      if (k === 'k') return (handled(), toggleKeys());
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const n = selectedNode(s);
        if (n)
          return (handled(), commit(removeNode(s.scene, n.id), t3('editRemove', { name: n.name })));
      }
      if (e.key === 'Escape') {
        handled();
        if (s.genOpen) set3({ genOpen: false });
        else if (s.dialog) set3({ dialog: false });
        else if (s.selected) set3({ selected: null });
        else close3d();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="s3-root" role="dialog" aria-label={t3('title')}>
      <TopBar />
      <div className="s3-body">
        <Outline />
        <div className="s3-stage" ref={boxRef}>
          {glError ? (
            <p className="s3-empty">{t3('noWebgl')}</p>
          ) : (
            <canvas
              ref={canvasRef}
              className={`s3-canvas${scene.transparent ? ' s3-checker' : ''}`}
              tabIndex={0}
            />
          )}
          <div className="s3-tools" role="toolbar">
            {(['translate', 'rotate', 'scale'] as Gizmo[]).map((g) => (
              <ToolBtn
                key={g}
                icon={g === 'translate' ? 'pointer' : g === 'rotate' ? 'refresh' : 'maximize'}
                title={t3(g === 'translate' ? 'move' : g === 'rotate' ? 'rotate' : 'scaleTool')}
                on={gizmo === g}
                onClick={() => set3({ gizmo: g })}
              />
            ))}
            <span className="s3-sep" />
            <ToolBtn
              icon={viewCam ? 'eye' : 'eyeOff'}
              title={viewCam ? t3('viewFree') : t3('viewCam')}
              on={viewCam}
              onClick={() => set3({ viewCam: !viewCam })}
            />
          </div>
          <QuickTools3D />
          <div className="s3-watermark" aria-hidden>
            <img src="./logo.svg" alt="" />
            Zinarix 3D
          </div>
        </div>
        <Inspector getView={() => vp.current?.editorView()} />
      </div>
      <KeyBar />
      <div className="s3-splash" aria-hidden>
        <img src="./logo.svg" alt="" />
        <strong>
          <span className="s3-brand-name">Zinarix</span> 3D
        </strong>
        <span>{t3('tagline')}</span>
      </div>
      {dialog && <RenderDialog />}
      {genOpen && <Gen3DDialog />}
      {rendering && (
        <div className="s3-progress" role="status">
          <div className="s3-bar">
            <div style={{ width: `${Math.round(rendering.progress * 100)}%` }} />
          </div>
          <span>{rendering.label}</span>
          <button type="button" className="s3-btn" onClick={rendering.cancel}>
            {t3('cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

function ToolBtn(p: {
  icon: IconName;
  title: string;
  on?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`s3-icon${p.on ? ' on' : ''}`}
      title={p.title}
      aria-label={p.title}
      aria-pressed={p.on}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      <Icon name={p.icon} />
    </button>
  );
}

async function save(saveAs: boolean) {
  const s = get3();
  try {
    const path = await api().scene3d.save(s.scene, s.path, saveAs);
    if (!path) return;
    set3({ path, dirty: false });
    toast(t3('saved', { name: path.split(/[\\/]/).pop() ?? path }));
  } catch (e) {
    toast(String(e instanceof Error ? e.message : e));
  }
}

const BLENDER_DOWNLOAD = 'https://www.blender.org/download/';
/** How long the Pro button stays busy after a launch (Blender takes a while to show up). */
const PRO_LAUNCH_MS = 4000;

/** Zinarix 3D Pro needs Blender 4.2+ (the render engine alone accepts 3.6+). */
function proVersionOk(v: string): boolean {
  const [major = 0, minor = 0] = v.split('.').map((n) => parseInt(n, 10) || 0);
  return major > 4 || (major === 4 && minor >= 2);
}

type ProErrorKind = 'NO_BLENDER' | 'OLD_BLENDER' | 'NO_TEMPLATE' | null;

/** Electron's invoke() drops custom error properties, so fall back to the message text. */
function proErrorKind(e: unknown): ProErrorKind {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'NO_BLENDER' || code === 'OLD_BLENDER' || code === 'NO_TEMPLATE') return code;
  const m = e instanceof Error ? e.message : String(e);
  if (/NO_BLENDER|no está instalado|not installed/i.test(m)) return 'NO_BLENDER';
  if (/OLD_BLENDER|encontré|\(found /i.test(m)) return 'OLD_BLENDER';
  if (/NO_TEMPLATE|plantilla|template/i.test(m)) return 'NO_TEMPLATE';
  return null;
}

/** "Error invoking remote method 'x': Error: msg" → "msg". */
const ipcMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']*': (?:\w*Error: )?/,
    '',
  );

/**
 * "Modo Pro": opens Zinarix 3D Pro (Blender 4.2+ with the Zinarix template). Without a usable
 * Blender it explains why and offers to download it or pick blender.exe instead.
 */
function ProButton() {
  // undefined = still checking; null = not found.
  const [blender, setBlender] = useState<{ version: string } | null | undefined>(undefined);
  const [pop, setPop] = useState(false);
  const [launching, setLaunching] = useState(false);
  const busy = useRef(false);
  const look = (refresh = false) =>
    api()
      .scene3d.info(refresh)
      .then(
        (i) => (setBlender(i.blender), i.blender),
        () => (setBlender(null), null),
      );
  useEffect(() => void look(), []);
  const ready = blender === undefined || (!!blender && proVersionOk(blender.version));

  const launch = async () => {
    if (busy.current) return;
    busy.current = true;
    setLaunching(true);
    setPop(false);
    let started = false;
    try {
      await api().scene3d.openPro(lang === 'en' ? 'en' : 'es', appLook());
      started = true;
      toast(t3('openProStarted'));
    } catch (e) {
      const kind = proErrorKind(e);
      if (kind === 'NO_BLENDER' || kind === 'OLD_BLENDER') {
        await look(true);
        setPop(true);
      } else if (kind === 'NO_TEMPLATE') toast(t3('proNoTemplate'));
      else toast(t3('proFailed', { msg: ipcMessage(e) }));
    } finally {
      const done = () => {
        busy.current = false;
        setLaunching(false);
      };
      if (started) window.setTimeout(done, PRO_LAUNCH_MS);
      else done();
    }
  };

  return (
    <div className="s3-menu">
      <button
        type="button"
        className="s3-btn"
        title={t3('openProHint')}
        disabled={launching}
        aria-busy={launching}
        aria-expanded={ready ? undefined : pop}
        onClick={() => (ready ? void launch() : setPop(!pop))}
      >
        {launching ? (
          <span className="s3-spin" aria-hidden="true" />
        ) : (
          <Icon name={ready ? 'external' : 'warning'} />
        )}{' '}
        {launching ? t3('openProLaunching') : t3('openPro')}
      </button>
      {pop && !launching && (
        <div className="s3-pop s3-pro-pop" role="dialog" aria-label={t3('openPro')}>
          <p className="s3-hint s3-pro-msg">
            {blender ? t3('proOldBlender', { v: blender.version }) : t3('proNeedsBlender')}
          </p>
          <button type="button" onClick={() => void api().app.openExternal(BLENDER_DOWNLOAD)}>
            <Icon name="download" /> {t3('proDownload')}
          </button>
          <button
            type="button"
            onClick={async () => {
              const b = await api().scene3d.pickBlender();
              if (b === false) return toast(t3('notBlender'));
              if (!b) return;
              setBlender(b);
              if (proVersionOk(b.version)) void launch();
            }}
          >
            <Icon name="folder" /> {t3('proPick')}
          </button>
          <button
            type="button"
            onClick={async () => {
              const b = await look(true);
              if (b && proVersionOk(b.version)) void launch();
              else if (!b) toast(t3('proNotFound'));
            }}
          >
            <Icon name="refresh" /> {t3('findAgain')}
          </button>
        </div>
      )}
    </div>
  );
}

/** The app's current theme colors, so Zinarix 3D Pro (Blender) is light or dark like the app. */
function appLook(): Pro3DLook {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  // The IPC schema caps each color at 64 characters; a longer value would fail the whole call.
  const v = (name: string, fallback: string) => {
    const c = css.getPropertyValue(name).trim();
    return c && c.length <= 64 ? c : fallback;
  };
  return {
    dark: root.dataset.theme !== 'light',
    bg: v('--bg', '#1e1e1e'),
    fg: v('--fg', '#d6d6dc'),
    accent: v('--accent', '#2f6fdb'),
  };
}

function TopBar() {
  const past = use3((s) => s.past.length);
  const future = use3((s) => s.future.length);
  const path = use3((s) => s.path);
  const dirty = use3((s) => s.dirty);
  const busy = use3((s) => !!s.render);
  const [tpl, setTpl] = useState(false);
  return (
    <header className="s3-top">
      <img className="s3-logo" src="./logo.svg" alt="" />
      <strong className="s3-title">
        <span className="s3-brand-name">Zinarix</span> 3D
        {path && (
          <span className="s3-path">
            {' '}
            · {path.split(/[\\/]/).pop()}
            {dirty ? ' •' : ''}
          </span>
        )}
      </strong>
      <div className="s3-menu">
        <button type="button" className="s3-btn" aria-expanded={tpl} onClick={() => setTpl(!tpl)}>
          <Icon name="star" /> {t3('templates')}
        </button>
        {tpl && (
          <div className="s3-pop" role="menu" title={t3('templateHint')}>
            {TEMPLATES.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTpl(false);
                  const old = get3().scene;
                  loadScene(
                    fromTemplate(id as TemplateId, {
                      transparent: old.transparent,
                      width: old.width,
                      height: old.height,
                      fps: old.fps,
                    }),
                    t3('editTemplate'),
                  );
                }}
              >
                {t3(`t_${id}` as Key3D)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="s3-btn"
        onClick={async () => {
          try {
            const r = await api().scene3d.open();
            if (r) {
              loadScene(r.scene, t3('openFile'), r.path);
              set3({ dirty: false });
            }
          } catch (e) {
            toast(String(e instanceof Error ? e.message : e));
          }
        }}
      >
        <Icon name="folder" /> {t3('openFile')}
      </button>
      <button type="button" className="s3-btn" onClick={() => void save(false)} title="Ctrl+S">
        <Icon name="download" /> {t3('save')}
      </button>
      <ProButton />
      <button type="button" className="s3-btn" onClick={() => void save(true)}>
        {t3('saveAs')}
      </button>
      <span className="s3-sep" />
      <ToolBtn icon="undo" title={`${t3('undo')} (Ctrl+Z)`} disabled={!past} onClick={undo3} />
      <span className="s3-flip">
        <ToolBtn icon="undo" title={`${t3('redo')} (Ctrl+Y)`} disabled={!future} onClick={redo3} />
      </span>
      <span className="s3-grow" />
      <button
        type="button"
        className="s3-btn s3-primary"
        disabled={busy}
        onClick={() => set3({ dialog: true })}
      >
        <Icon name="film" /> {t3('render')}
      </button>
      <ToolBtn icon="close" title={`${t3('close')} (Esc)`} onClick={close3d} />
    </header>
  );
}

function Outline() {
  const nodes = use3((s) => s.scene.nodes);
  const selected = use3((s) => s.selected);
  const [menu, setMenu] = useState(false);
  const add = (n: Node3D) => {
    const s = get3().scene;
    if (s.nodes.length >= LIMITS.nodes) return;
    commit({ ...s, nodes: [...s.nodes, n] }, t3('editAdd', { name: n.name }));
    set3({ selected: n.id });
    setMenu(false);
  };
  const row = (id: string | null, label: string, icon: IconName, extra?: ReactNode) => (
    <li key={id ?? 'scene'}>
      <button
        type="button"
        className={`s3-row${selected === id ? ' on' : ''}`}
        aria-current={selected === id}
        onClick={() => set3({ selected: id })}
      >
        <Icon name={icon} />
        <span className="s3-ell">{label}</span>
        {extra}
      </button>
    </li>
  );
  return (
    <aside className="s3-side" aria-label={t3('outline')}>
      <div className="s3-menu">
        <button
          type="button"
          className="s3-btn s3-wide"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Icon name="plus" /> {t3('add')}
        </button>
        {menu && (
          <div className="s3-pop" role="menu">
            {SHAPES.map((sh) => (
              <button key={sh} type="button" role="menuitem" onClick={() => add(makeMesh(sh))}>
                {t3(`sh_${sh}` as Key3D)}
              </button>
            ))}
            <hr />
            {LIGHT_TYPES.map((l) => (
              <button key={l} type="button" role="menuitem" onClick={() => add(makeLight(l))}>
                {t3(`li_${l}` as Key3D)}
              </button>
            ))}
            <hr />
            <button
              type="button"
              role="menuitem"
              title={t3('modelHint')}
              onClick={async () => {
                const r = await api().scene3d.pickModel();
                if (r) add(makeModel(r.path));
                else setMenu(false);
              }}
            >
              {t3('importModel')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                set3({ genOpen: true });
              }}
            >
              {t3('gen')}
            </button>
          </div>
        )}
      </div>
      <ul className="s3-tree">
        {row(null, t3('scene'), 'settings')}
        {row('camera', t3('camera'), 'eye')}
        {nodes.map((n) =>
          row(
            n.id,
            n.name,
            n.kind === 'light'
              ? 'bolt'
              : n.kind === 'model'
                ? 'package'
                : n.shape === 'text'
                  ? 'type'
                  : 'layers',
            !n.visible ? (
              <Icon name="eyeOff" />
            ) : n.keys ? (
              <span className="s3-dot" aria-hidden>
                ◆
              </span>
            ) : null,
          ),
        )}
      </ul>
    </aside>
  );
}

function Field(p: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="s3-field" title={p.hint}>
      <span>{p.label}</span>
      {p.children}
    </label>
  );
}

/** A number box that commits on every change (merged into one undo step per field). */
function Num(p: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  label?: string;
}) {
  const [text, setText] = useState(String(p.value));
  useEffect(() => setText(String(Math.round(p.value * 1000) / 1000)), [p.value]);
  return (
    <input
      type="number"
      className="s3-num"
      value={text}
      step={p.step ?? 0.1}
      min={p.min}
      max={p.max}
      aria-label={p.label}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v)) {
          const lo = p.min ?? -Infinity;
          const hi = p.max ?? Infinity;
          p.onChange(Math.min(hi, Math.max(lo, v)));
        }
      }}
    />
  );
}

function Slider(p: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}) {
  return (
    <span className="s3-slider">
      <input
        type="range"
        min={p.min ?? 0}
        max={p.max ?? 1}
        step={p.step ?? 0.01}
        value={p.value}
        aria-label={p.label}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
      <output>{p.value.toFixed(2)}</output>
    </span>
  );
}

function KeyBtn(p: { on: boolean; animated: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`s3-key${p.on ? ' on' : p.animated ? ' anim' : ''}`}
      title={t3('key')}
      aria-label={t3('key')}
      aria-pressed={p.on}
      onClick={p.onClick}
    >
      ◆
    </button>
  );
}

/** K and the ◆ of a row: keys on when some are missing at the playhead, else off. */
function toggleRow(n: Node3D, props: readonly NodeProp[], t: number, fps: number): Node3D {
  const all = props.every((p) => hasKeyAt(n.keys?.[p], t, fps));
  const pose = poseAt(n, t);
  const valueOf = (p: NodeProp) => {
    if (p === 'intensity') return pose.intensity;
    const i = 'xyz'.indexOf(p[1]!);
    return p[0] === 'p' ? pose.position[i]! : p[0] === 'r' ? pose.rotation[i]! : pose.scale[i]!;
  };
  let keys = n.keys;
  for (const p of props) {
    if (all) keys = withoutKey(keys, p, t, fps);
    else if (!hasKeyAt(keys?.[p], t, fps)) keys = withKey(keys, p, t, valueOf(p), fps);
  }
  const out = { ...n, keys };
  if (!keys) delete out.keys;
  return out;
}

function toggleKeys() {
  const s = get3();
  const n = selectedNode(s);
  if (n) {
    const props: NodeProp[] =
      n.kind === 'light'
        ? ['px', 'py', 'pz']
        : [...ROW_PROPS.position, ...ROW_PROPS.rotation, ...ROW_PROPS.scale];
    return commitNode(n.id, (x) => toggleRow(x, props, s.time, s.scene.fps), t3('editKey'));
  }
  if (s.selected === 'camera')
    commit({ ...s.scene, camera: toggleCam(s.scene, CAMERA_PROPS, s.time) }, t3('editKey'));
}

function toggleCam(s: Scene3D, props: readonly CameraProp[], t: number) {
  const c = s.camera;
  const all = props.every((p) => hasKeyAt(c.keys?.[p], t, s.fps));
  let keys = c.keys;
  const x = cameraNow(c, t);
  const now: Record<CameraProp, number> = {
    px: x.position[0],
    py: x.position[1],
    pz: x.position[2],
    tx: x.target[0],
    ty: x.target[1],
    tz: x.target[2],
  };
  for (const p of props) {
    if (all) keys = withoutKey(keys, p, t, s.fps);
    else if (!hasKeyAt(keys?.[p], t, s.fps)) keys = withKey(keys, p, t, now[p], s.fps);
  }
  const out = { ...c, keys };
  if (!keys) delete out.keys;
  return out;
}

function Vec(p: {
  label: string;
  value: Vec3;
  step?: number;
  min?: number;
  onChange: (i: number, v: number) => void;
  keyed?: { on: boolean; animated: boolean; toggle: () => void };
}) {
  return (
    <div className="s3-vec" role="group" aria-label={p.label}>
      <span className="s3-vlabel">{p.label}</span>
      {p.value.map((v, i) => (
        <Num
          key={i}
          value={v}
          step={p.step}
          min={p.min}
          label={`${p.label} ${'XYZ'[i]}`}
          onChange={(x) => p.onChange(i, x)}
        />
      ))}
      {p.keyed && <KeyBtn on={p.keyed.on} animated={p.keyed.animated} onClick={p.keyed.toggle} />}
    </div>
  );
}

function Inspector({ getView }: { getView: () => { position: Vec3; target: Vec3 } | undefined }) {
  const s = use3((x) => x.scene);
  const sel = use3((x) => x.selected);
  const t = use3((x) => x.time);
  const n = sel && sel !== 'camera' ? s.nodes.find((x) => x.id === sel) : undefined;
  return (
    <aside className="s3-insp" aria-label="Inspector">
      {sel === null ? (
        <SceneSettings s={s} />
      ) : sel === 'camera' ? (
        <CameraPanel s={s} t={t} getView={getView} />
      ) : n ? (
        <NodePanel n={n} s={s} t={t} />
      ) : (
        <p className="s3-empty">{t3('nothing')}</p>
      )}
      <p className="s3-hint">{t3('keyHint')}</p>
    </aside>
  );
}

const SIZES: [number, number][] = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
  [1280, 720],
  [3840, 2160],
];

function SceneSettings({ s }: { s: Scene3D }) {
  const set = (patch: Partial<Scene3D>) => commit({ ...s, ...patch }, t3('editScene'));
  return (
    <section>
      <h3>{t3('scene')}</h3>
      <Field label={t3('size')}>
        <select
          value={`${s.width}x${s.height}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            set({ width: w!, height: h! });
          }}
        >
          {SIZES.map(([w, h]) => (
            <option key={`${w}x${h}`} value={`${w}x${h}`}>
              {w} × {h}
            </option>
          ))}
          {!SIZES.some(([w, h]) => w === s.width && h === s.height) && (
            <option value={`${s.width}x${s.height}`}>
              {s.width} × {s.height}
            </option>
          )}
        </select>
      </Field>
      <Field label={t3('fps')}>
        <select value={s.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
          {[24, 25, 30, 50, 60].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t3('duration')}>
        <Num
          value={s.duration}
          step={0.5}
          min={LIMITS.duration[0]}
          max={LIMITS.duration[1]}
          onChange={(v) => set({ duration: v })}
        />
      </Field>
      <label className="s3-check" title={t3('transparentHint')}>
        <input
          type="checkbox"
          checked={s.transparent}
          onChange={(e) => set({ transparent: e.target.checked })}
        />
        {t3('transparent')}
      </label>
      {!s.transparent && (
        <Field label={t3('background')}>
          <input
            type="color"
            value={s.background}
            onChange={(e) => set({ background: e.target.value })}
          />
        </Field>
      )}
    </section>
  );
}

function CameraPanel({
  s,
  t,
  getView,
}: {
  s: Scene3D;
  t: number;
  getView: () => { position: Vec3; target: Vec3 } | undefined;
}) {
  const c = cameraNow(s.camera, t);
  const edit = (p: CameraProp, v: number) =>
    commit({ ...s, camera: setCameraProp(s.camera, p, v, t, s.fps) }, `cam:${p}`);
  const row = (props: readonly CameraProp[]) => ({
    on: props.every((p) => hasKeyAt(s.camera.keys?.[p], t, s.fps)),
    animated: props.some((p) => !!s.camera.keys?.[p]?.length),
    toggle: () => commit({ ...s, camera: toggleCam(s, props, t) }, t3('editKey')),
  });
  return (
    <section>
      <h3>{t3('camera')}</h3>
      <Vec
        label={t3('position')}
        value={c.position}
        onChange={(i, v) => edit((['px', 'py', 'pz'] as const)[i]!, v)}
        keyed={row(['px', 'py', 'pz'])}
      />
      <Vec
        label={t3('target')}
        value={c.target}
        onChange={(i, v) => edit((['tx', 'ty', 'tz'] as const)[i]!, v)}
        keyed={row(['tx', 'ty', 'tz'])}
      />
      <Field label={t3('fov')}>
        <Num
          value={s.camera.fov}
          step={1}
          min={LIMITS.fov[0]}
          max={LIMITS.fov[1]}
          onChange={(v) => commit({ ...s, camera: { ...s.camera, fov: v } }, 'cam:fov')}
        />
      </Field>
      <button
        type="button"
        className="s3-btn s3-wide"
        title={t3('useViewHint')}
        onClick={() => {
          const v = getView();
          if (!v) return;
          let cam = s.camera;
          (['px', 'py', 'pz'] as const).forEach(
            (p, i) => (cam = setCameraProp(cam, p, v.position[i]!, t, s.fps)),
          );
          (['tx', 'ty', 'tz'] as const).forEach(
            (p, i) => (cam = setCameraProp(cam, p, v.target[i]!, t, s.fps)),
          );
          commit({ ...s, camera: cam }, t3('useView'));
        }}
      >
        {t3('useView')}
      </button>
    </section>
  );
}

function NodePanel({ n, s, t }: { n: Node3D; s: Scene3D; t: number }) {
  const pose = poseAt(n, t);
  const edit = (fn: (x: Node3D) => Node3D, field: string) =>
    commitNode(n.id, fn, `${field}:${n.id}`);
  const prop = (p: NodeProp, v: number) => edit((x) => setNodeProp(x, p, v, t, s.fps), p);
  const row = (props: readonly NodeProp[]) => ({
    on: props.every((p) => hasKeyAt(n.keys?.[p], t, s.fps)),
    animated: props.some((p) => !!n.keys?.[p]?.length),
    toggle: () => commitNode(n.id, (x) => toggleRow(x, props, t, s.fps), t3('editKey')),
  });
  const m = n.material;
  const setMat = (patch: Partial<NonNullable<Node3D['material']>>) =>
    edit(
      (x) => ({ ...x, material: { ...(x.material ?? m!), ...patch } }),
      `mat:${Object.keys(patch)[0]}`,
    );
  return (
    <section>
      <Field label={t3('name')}>
        <input
          value={n.name}
          maxLength={60}
          onChange={(e) => edit((x) => ({ ...x, name: e.target.value }), 'name')}
        />
      </Field>
      {n.shape === 'text' && (
        <>
          <Field label={t3('text')}>
            <input
              value={n.text ?? ''}
              maxLength={60}
              onChange={(e) => edit((x) => ({ ...x, text: e.target.value }), 'text')}
            />
          </Field>
          <Field label={t3('depth')}>
            <Num
              value={n.depth ?? 0.25}
              step={0.05}
              min={LIMITS.depth[0]}
              max={LIMITS.depth[1]}
              onChange={(v) => edit((x) => ({ ...x, depth: v }), 'depth')}
            />
          </Field>
        </>
      )}
      {!(n.kind === 'light' && n.light?.type === 'ambient') && (
        <Vec
          label={t3('position')}
          value={pose.position}
          onChange={(i, v) => prop(ROW_PROPS.position[i]!, v)}
          keyed={row(ROW_PROPS.position)}
        />
      )}
      {n.kind !== 'light' && (
        <>
          <Vec
            label={t3('rotation')}
            value={pose.rotation}
            step={5}
            onChange={(i, v) => prop(ROW_PROPS.rotation[i]!, v)}
            keyed={row(ROW_PROPS.rotation)}
          />
          <Vec
            label={t3('scale')}
            value={pose.scale}
            step={0.1}
            min={LIMITS.scale[0]}
            onChange={(i, v) => prop(ROW_PROPS.scale[i]!, v)}
            keyed={row(ROW_PROPS.scale)}
          />
        </>
      )}
      {n.kind === 'light' && n.light && (
        <>
          <h3>{t3('light')}</h3>
          <Field label={t3('color')}>
            <input
              type="color"
              value={n.light.color}
              onChange={(e) =>
                edit((x) => ({ ...x, light: { ...x.light!, color: e.target.value } }), 'lcolor')
              }
            />
          </Field>
          <div className="s3-vec">
            <span className="s3-vlabel">{t3('intensity')}</span>
            <Num
              value={pose.intensity}
              step={n.light.type === 'point' ? 5 : 0.1}
              min={0}
              max={LIMITS.intensity[1]}
              onChange={(v) => prop('intensity', v)}
            />
            <KeyBtn
              on={row(['intensity']).on}
              animated={row(['intensity']).animated}
              onClick={row(['intensity']).toggle}
            />
          </div>
        </>
      )}
      {m && (
        <>
          <h3>{t3('material')}</h3>
          <Field label={t3('color')}>
            <input
              type="color"
              value={m.color}
              onChange={(e) => setMat({ color: e.target.value })}
            />
          </Field>
          <Field label={t3('metalness')}>
            <Slider
              label={t3('metalness')}
              value={m.metalness}
              onChange={(v) => setMat({ metalness: v })}
            />
          </Field>
          <Field label={t3('roughness')}>
            <Slider
              label={t3('roughness')}
              value={m.roughness}
              onChange={(v) => setMat({ roughness: v })}
            />
          </Field>
          <Field label={t3('emissive')}>
            <input
              type="color"
              value={m.emissive}
              onChange={(e) => setMat({ emissive: e.target.value })}
            />
          </Field>
          <Field label={t3('emissiveIntensity')}>
            <Slider
              label={t3('emissiveIntensity')}
              value={m.emissiveIntensity}
              max={5}
              onChange={(v) => setMat({ emissiveIntensity: v })}
            />
          </Field>
          <Field label={t3('opacity')}>
            <Slider
              label={t3('opacity')}
              value={m.opacity}
              onChange={(v) => setMat({ opacity: v })}
            />
          </Field>
        </>
      )}
      <label className="s3-check">
        <input
          type="checkbox"
          checked={n.visible}
          onChange={(e) => edit((x) => ({ ...x, visible: e.target.checked }), 'visible')}
        />
        {t3('visible')}
      </label>
      <div className="s3-actions">
        <button
          type="button"
          className="s3-btn"
          onClick={() => {
            const r = duplicateNode(s, n.id);
            commit(r.scene, t3('duplicate'));
            set3({ selected: r.id });
          }}
        >
          <Icon name="copy" /> {t3('duplicate')}
        </button>
        <button
          type="button"
          className="s3-btn s3-danger"
          onClick={() => commit(removeNode(s, n.id), t3('editRemove', { name: n.name }))}
        >
          <Icon name="trash" /> {t3('remove')}
        </button>
      </div>
    </section>
  );
}

function KeyBar() {
  const s = use3((x) => x.scene);
  const t = use3((x) => x.time);
  const sel = use3((x) => x.selected);
  const playing = use3((x) => x.playing);
  const marks = keyTimes(s, sel ?? undefined);
  const frame = 1 / s.fps;
  return (
    <footer className="s3-keys">
      <ToolBtn
        icon={playing ? 'pause' : 'play'}
        title={playing ? t3('pause') : t3('play')}
        onClick={() => set3({ playing: !playing })}
      />
      <span className="s3-time">{fmtTime(t)}</span>
      <div className="s3-track">
        <input
          type="range"
          min={0}
          max={s.duration}
          step={frame}
          value={t}
          aria-label="Tiempo"
          onChange={(e) => set3({ time: Number(e.target.value), playing: false })}
        />
        {marks.map((k) => (
          <button
            key={k}
            type="button"
            className="s3-mark"
            style={{ left: `${(k / s.duration) * 100}%` }}
            title={fmtTime(k)}
            aria-label={fmtTime(k)}
            onClick={() => set3({ time: k, playing: false })}
          >
            ◆
          </button>
        ))}
      </div>
      <span className="s3-time">{fmtTime(s.duration)}</span>
      <CurvePick />
      <ToolBtn icon="flag" title={t3('key')} onClick={toggleKeys} disabled={sel === null} />
    </footer>
  );
}

/** Curve of the selected object's keys at the playhead (hidden when there is none there). */
function CurvePick() {
  const s = use3((x) => x.scene);
  const t = use3((x) => x.time);
  const sel = use3((x) => x.selected);
  const n = sel && sel !== 'camera' ? s.nodes.find((x) => x.id === sel) : undefined;
  const keys = (sel === 'camera' ? s.camera.keys : n?.keys) as Keys<string> | undefined;
  const now = easeAt(keys, t, s.fps);
  if (!now) return null;
  const pick = (ease: Ease3D) => {
    if (sel === 'camera') {
      const k = withEaseAt(s.camera.keys, t, s.fps, ease);
      commit({ ...s, camera: { ...s.camera, ...(k ? { keys: k } : {}) } }, t3('editCurve'));
    } else if (n) {
      commitNode(
        n.id,
        (x) => ({ ...x, keys: withEaseAt(x.keys, t, s.fps, ease) }),
        t3('editCurve'),
      );
    }
  };
  return (
    <label className="s3-curve" title={t3('curveHint')}>
      <span>{t3('curve')}</span>
      <select value={now} onChange={(e) => pick(e.target.value as Ease3D)}>
        {now === 'mixed' && (
          <option value="mixed" disabled>
            {t3('curveMixed')}
          </option>
        )}
        {EASES_3D.map((e) => (
          <option key={e} value={e}>
            {t3(`e_${e}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RenderDialog() {
  const s = use3((x) => x.scene);
  const [info, setInfo] = useState<{ blender: { version: string } | null; outDir: string } | null>(
    null,
  );
  const [engine, setEngine] = useState<Engine3D>('viewer');
  const [format, setFormat] = useState<Render3DFormat>(formatFor(s));
  const firstText = s.nodes.find((n) => n.shape === 'text')?.text;
  const [name, setName] = useState(firstText || 'escena-3d');
  const [timeline, setTimeline] = useState(true);
  const look = (refresh = false) =>
    void api()
      .scene3d.info(refresh)
      .then(setInfo, () => setInfo({ blender: null, outDir: '' }));
  useEffect(() => look(), []);
  const blender = engine !== 'viewer';
  const canStart = !blender || !!info?.blender;
  return (
    <div
      className="s3-modal"
      role="dialog"
      aria-label={t3('renderTitle')}
      onMouseDown={(e) => e.target === e.currentTarget && set3({ dialog: false })}
    >
      <div className="s3-card">
        <h3>{t3('renderTitle')}</h3>
        <Field label={t3('engine')}>
          <select value={engine} onChange={(e) => setEngine(e.target.value as Engine3D)}>
            <option value="viewer">{t3('e_viewer')}</option>
            <option value="eevee">{t3('e_eevee')}</option>
            <option value="cycles">{t3('e_cycles')}</option>
          </select>
        </Field>
        {blender && (
          <p className="s3-hint">
            {info?.blender ? t3('blenderFound', { v: info.blender.version }) : t3('noBlender')}{' '}
            {!info?.blender && (
              <button type="button" className="s3-link" onClick={() => look(true)}>
                {t3('findAgain')}
              </button>
            )}{' '}
            <button
              type="button"
              className="s3-link"
              onClick={async () => {
                const b = await api().scene3d.pickBlender();
                if (b) setInfo((i) => ({ outDir: i?.outDir ?? '', blender: b }));
                else if (b === false) toast(t3('notBlender'));
              }}
            >
              {t3('pickBlender')}
            </button>
          </p>
        )}
        <Field label={t3('format')}>
          <select value={format} onChange={(e) => setFormat(e.target.value as Render3DFormat)}>
            <option value="webm">{t3('f_webm')}</option>
            <option value="mp4">{t3('f_mp4')}</option>
            <option value="png">{t3('f_png')}</option>
          </select>
        </Field>
        {format === 'mp4' && s.transparent && (
          <p className="s3-hint">{t3('mp4NoAlpha', { color: s.background })}</p>
        )}
        <Field label={t3('fileName')}>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        {format !== 'png' && (
          <label className="s3-check">
            <input
              type="checkbox"
              checked={timeline}
              onChange={(e) => setTimeline(e.target.checked)}
            />
            {t3('addTimeline')}
          </label>
        )}
        {info?.outDir && <p className="s3-hint">{t3('outDir', { dir: info.outDir })}</p>}
        <div className="s3-actions">
          <button type="button" className="s3-btn" onClick={() => set3({ dialog: false })}>
            {t3('cancel')}
          </button>
          <button
            type="button"
            className="s3-btn s3-primary"
            disabled={!canStart}
            onClick={() => {
              // MP4 has no alpha: render it over the background colour.
              const scene = format === 'mp4' ? { ...s, transparent: false } : s;
              void render3d(scene, {
                engine,
                format,
                name: name.trim() || 'escena-3d',
                timeline,
              }).catch(() => {});
            }}
          >
            {t3('start')}
          </button>
        </div>
      </div>
    </div>
  );
}
