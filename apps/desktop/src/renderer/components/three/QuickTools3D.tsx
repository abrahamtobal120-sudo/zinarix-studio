/**
 * Basic tools of the 3D editor: a floating card over the viewport with big, plain buttons
 * (add a shape, paint it, move it, one-click animations, background, camera views and ready-made
 * scenes). Every button is one undoable commit, so nothing here needs the inspector.
 */
import { useState, type ReactNode } from 'react';
import {
  LIMITS,
  ROW_PROPS,
  TEXT_MAX,
  cameraAt,
  cleanText,
  duplicateNode,
  fromTemplate,
  makeLight,
  makeMesh,
  newScene,
  poseAt,
  removeNode,
  setCameraProp,
  setNodeProp,
  withKey,
  type CameraProp,
  type Ease3D,
  type Material3D,
  type Node3D,
  type NodeProp,
  type Shape,
  type TemplateId,
  type Vec3,
} from '../../../shared/scene3d';
import { lang } from '../../i18n';
import { toast } from '../../store';
import { commit, commitNode, get3, loadScene, selectedNode, set3, use3 } from './store3d';
import './quick3d.css';

const es = {
  title: 'Herramientas básicas',
  hide: 'Ocultar',
  show: 'Herramientas',
  add: 'Agregar',
  box: 'Cubo',
  sphere: 'Esfera',
  cylinder: 'Cilindro',
  cone: 'Cono',
  torus: 'Dona',
  plane: 'Suelo',
  text: 'Texto',
  light: 'Luz',
  pick: 'Toca un objeto para cambiarlo, o cambia la escena aquí abajo.',
  deselect: 'Soltar',
  words: 'Qué dice',
  color: 'Color',
  custom: 'Otro color',
  look: 'Acabado',
  matte: 'Mate',
  shiny: 'Brillante',
  metal: 'Metal',
  glass: 'Vidrio',
  glow: 'Brilla',
  power: 'Fuerza de la luz',
  stronger: 'Más fuerte',
  softer: 'Más suave',
  size: 'Tamaño',
  bigger: 'Más grande',
  smaller: 'Más chico',
  wider: 'Más ancho',
  taller: 'Más alto',
  move: 'Mover',
  up: 'Subir',
  down: 'Bajar',
  left: 'Izquierda',
  right: 'Derecha',
  near: 'Adelante',
  far: 'Atrás',
  turn: 'Girar 45°',
  center: 'Al centro',
  floor: 'Al suelo',
  reset: 'Como nuevo',
  animate: 'Animar',
  spin: 'Girar',
  flip: 'Voltear',
  float: 'Flotar',
  bounce: 'Rebotar',
  pulse: 'Latir',
  appear: 'Aparecer',
  still: 'Quitar animación',
  copy: 'Duplicar',
  hideObj: 'Ocultar',
  showObj: 'Mostrar',
  remove: 'Borrar',
  full: 'La escena ya tiene el máximo de objetos.',
  scene: 'Escena',
  bg: 'Fondo',
  clear: 'Transparente',
  views: 'Cámara',
  front: 'De frente',
  top: 'Desde arriba',
  side: 'De lado',
  corner: 'En diagonal',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  length: 'Duración',
  ready: 'Escenas listas',
  logo: 'Logo girando',
  turntable: 'Objeto girando',
  orbit: 'Cámara alrededor',
  empty: 'Empezar de cero',
};
const en: typeof es = {
  title: 'Basic tools',
  hide: 'Hide',
  show: 'Tools',
  add: 'Add',
  box: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  torus: 'Donut',
  plane: 'Floor',
  text: 'Text',
  light: 'Light',
  pick: 'Click an object to change it, or change the scene below.',
  deselect: 'Let go',
  words: 'What it says',
  color: 'Color',
  custom: 'Other color',
  look: 'Finish',
  matte: 'Matte',
  shiny: 'Shiny',
  metal: 'Metal',
  glass: 'Glass',
  glow: 'Glow',
  power: 'Light strength',
  stronger: 'Stronger',
  softer: 'Softer',
  size: 'Size',
  bigger: 'Bigger',
  smaller: 'Smaller',
  wider: 'Wider',
  taller: 'Taller',
  move: 'Move',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  near: 'Forward',
  far: 'Back',
  turn: 'Turn 45°',
  center: 'To center',
  floor: 'On the floor',
  reset: 'Like new',
  animate: 'Animate',
  spin: 'Spin',
  flip: 'Flip',
  float: 'Float',
  bounce: 'Bounce',
  pulse: 'Pulse',
  appear: 'Pop in',
  still: 'Remove animation',
  copy: 'Duplicate',
  hideObj: 'Hide',
  showObj: 'Show',
  remove: 'Delete',
  full: 'The scene already has the most objects allowed.',
  scene: 'Scene',
  bg: 'Background',
  clear: 'Transparent',
  views: 'Camera',
  front: 'Front',
  top: 'From above',
  side: 'Side',
  corner: 'Diagonal',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  length: 'Length',
  ready: 'Ready-made scenes',
  logo: 'Spinning logo',
  turntable: 'Spinning object',
  orbit: 'Camera around',
  empty: 'Start over',
};
type K = keyof typeof es;
const tq = (k: K): string => (lang === 'en' ? en : es)[k];

const SHAPE_BTNS: { shape: Shape; glyph: string; key: K }[] = [
  { shape: 'box', glyph: '■', key: 'box' },
  { shape: 'sphere', glyph: '●', key: 'sphere' },
  { shape: 'cylinder', glyph: '▮', key: 'cylinder' },
  { shape: 'cone', glyph: '▲', key: 'cone' },
  { shape: 'torus', glyph: '◯', key: 'torus' },
  { shape: 'plane', glyph: '▬', key: 'plane' },
  { shape: 'text', glyph: 'T', key: 'text' },
];

const SWATCHES = [
  '#ffffff',
  '#1c1c1e',
  '#e5484d',
  '#f76b15',
  '#ffc53d',
  '#46a758',
  '#38a8ff',
  '#8e4ec6',
  '#e93d82',
  '#a18072',
];
const BACKGROUNDS = ['#101318', '#000000', '#ffffff', '#1e2a44', '#2b1d3a', '#f2efe8'];

const FINISHES: { key: K; m: Partial<Material3D> }[] = [
  { key: 'matte', m: { metalness: 0, roughness: 0.9, opacity: 1, emissiveIntensity: 0 } },
  { key: 'shiny', m: { metalness: 0.1, roughness: 0.15, opacity: 1, emissiveIntensity: 0 } },
  { key: 'metal', m: { metalness: 1, roughness: 0.25, opacity: 1, emissiveIntensity: 0 } },
  { key: 'glass', m: { metalness: 0, roughness: 0.05, opacity: 0.35, emissiveIntensity: 0 } },
  { key: 'glow', m: { emissiveIntensity: 1.5 } },
];

/** Which finish a material looks like (to light up its button). */
function finishOf(m: Material3D | undefined): K | null {
  if (!m) return null;
  if (m.emissiveIntensity > 0) return 'glow';
  if (m.opacity < 1) return 'glass';
  if (m.metalness >= 0.8) return 'metal';
  return m.roughness < 0.4 ? 'shiny' : 'matte';
}

/** Height of the floor: the default 1 m objects at the origin stand on it. */
const FLOOR_Y = -0.5;
const SLOTS = [0, 1.5, -1.5, 3, -3];

const SHOW_KEY = 'zinarix.scene3d.quickTools';
const FOLD_KEY = 'zinarix.scene3d.quickFolds';

function readFolds(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
const folds = readFolds();

/** A titled group that folds; the app remembers which ones are folded. */
function Section(p: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => !folds.has(p.id));
  return (
    <details
      className="q3-sec"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        if (o) folds.delete(p.id);
        else folds.add(p.id);
        localStorage.setItem(FOLD_KEY, JSON.stringify([...folds]));
      }}
    >
      <summary>{p.title}</summary>
      {p.children}
    </details>
  );
}

function addNode(n: Node3D) {
  const s = get3().scene;
  if (s.nodes.length >= LIMITS.nodes) return alertFull();
  // New objects take turns right and left of the centre, so they don't pile up; the floor goes
  // big, under the objects.
  const meshes = s.nodes.filter((x) => x.kind !== 'light' && x.shape !== 'plane').length;
  const placed: Node3D =
    n.shape === 'plane'
      ? { ...n, position: [0, FLOOR_Y, 0], scale: [10, 10, 1] }
      : n.kind === 'mesh'
        ? { ...n, position: [SLOTS[meshes % SLOTS.length]!, 0, 0] }
        : n;
  commit({ ...s, nodes: [...s.nodes, placed] }, `${tq('add')}: ${n.name}`);
  set3({ selected: placed.id });
}
const alertFull = (): void => toast(tq('full'));

/** Changes props of the selected node at the playhead (keyed props get a key, like the gizmo). */
function nudge(
  label: string,
  fn: (pose: ReturnType<typeof poseAt>) => Partial<Record<NodeProp, number>>,
) {
  const { scene, time } = get3();
  const n = selectedNode(get3());
  if (!n) return;
  const pose = poseAt(n, time);
  let next = n;
  for (const [p, v] of Object.entries(fn(pose)) as [NodeProp, number][])
    next = setNodeProp(next, p, v, time, scene.fps);
  commitNode(n.id, () => next, label);
}

const clampScale = (v: number) => Math.min(LIMITS.scale[1], Math.max(LIMITS.scale[0], v));

const scaleBy = (f: number, axes: readonly (0 | 1 | 2)[], key: K) => () =>
  nudge(tq(key), (p) => {
    const out: Partial<Record<NodeProp, number>> = {};
    for (const i of axes) out[ROW_PROPS.scale[i]] = clampScale(p.scale[i] * f);
    return out;
  });

const moveBy = (axis: 0 | 1 | 2, d: number, key: K) => () =>
  nudge(tq(key), (p) => ({ [ROW_PROPS.position[axis]]: p.position[axis] + d }));

type Anim = 'spin' | 'flip' | 'float' | 'bounce' | 'pulse' | 'appear';

/** Which one-click animations a node has (read back from its keys). */
function animsOf(n: Node3D): Set<Anim> {
  const k = n.keys ?? {};
  const out = new Set<Anim>();
  if (k.ry?.length) out.add('spin');
  if (k.rx?.length) out.add('flip');
  if (k.py?.length) out.add(k.py[0]?.ease === 'bounce' ? 'bounce' : 'float');
  if (k.sx?.length) out.add((k.sx[0]?.v ?? 1) < 0.01 ? 'appear' : 'pulse');
  return out;
}

/** One-click loops over the whole scene: they replace the keys of the props they use. */
function animate(kind: Anim | 'still') {
  const { scene } = get3();
  const n = selectedNode(get3());
  if (!n) return;
  const d = scene.duration;
  const fps = scene.fps;
  const base = poseAt(n, 0);
  if (kind === 'still') {
    // The object stays where it is at the start.
    const still: Node3D = {
      ...n,
      position: base.position,
      rotation: base.rotation,
      scale: base.scale,
      ...(n.light ? { light: { ...n.light, intensity: base.intensity } } : {}),
    };
    delete still.keys;
    return commitNode(n.id, () => still, tq('still'));
  }
  const keys = { ...n.keys };
  const set = (p: NodeProp, points: [number, number, Ease3D?][]) => {
    delete keys[p];
    let k: typeof keys = keys;
    for (const [t, v, ease] of points) k = withKey(k, p, t, v, fps, ease);
    keys[p] = k[p];
  };
  const y = base.position[1];
  if (kind === 'spin' || kind === 'flip') {
    const i = kind === 'spin' ? 1 : 0;
    set(ROW_PROPS.rotation[i], [
      [0, base.rotation[i]],
      [d, base.rotation[i] + 360],
    ]);
  } else if (kind === 'float') {
    set('py', [
      [0, y, 'ease'],
      [d / 2, y + 0.5, 'ease'],
      [d, y],
    ]);
  } else if (kind === 'bounce') {
    // Falls from above and bounces to a stop in the first second and a half.
    set('py', [
      [0, y + 2, 'bounce'],
      [Math.min(1.5, d), y],
    ]);
  } else {
    // Pulse grows and shrinks over the scene; appear pops in from nothing (with a small overshoot).
    ROW_PROPS.scale.forEach((p, i) => {
      const v = base.scale[i]! < 0.01 ? 1 : base.scale[i]!;
      set(
        p,
        kind === 'pulse'
          ? [
              [0, v, 'ease'],
              [d / 2, clampScale(v * 1.25), 'ease'],
              [d, v],
            ]
          : [
              [0, LIMITS.scale[0], 'back'],
              [Math.min(0.8, d), v],
            ],
      );
    });
  }
  commitNode(n.id, (x) => ({ ...x, keys }), tq(kind));
}

function paint(color: string) {
  const n = selectedNode(get3());
  if (!n) return;
  if (n.kind === 'light' && n.light)
    return commitNode(n.id, (x) => ({ ...x, light: { ...x.light!, color } }), tq('color'));
  if (n.material)
    commitNode(
      n.id,
      (x) => ({ ...x, material: { ...x.material!, color, emissive: color } }),
      tq('color'),
    );
}

function finish(m: Partial<Material3D>, label: string) {
  const n = selectedNode(get3());
  if (!n?.material) return;
  commitNode(
    n.id,
    (x) => ({
      ...x,
      material: {
        ...x.material!,
        ...m,
        emissive: m.emissiveIntensity ? x.material!.color : x.material!.emissive,
      },
    }),
    label,
  );
}

/** Puts the bottom of the object on the floor, using the half height of its shape. */
function toFloor() {
  const n = selectedNode(get3());
  if (!n || n.kind === 'light') return;
  const half: Partial<Record<Shape, number>> = { torus: 0.68, plane: 0, text: 0.4 };
  nudge(tq('floor'), (p) => ({ py: FLOOR_Y + (half[n.shape ?? 'box'] ?? 0.5) * p.scale[1] }));
}

/** Back to the size and angle it had when added (a floor stays lying down). */
function resetNode() {
  const floor = selectedNode(get3())?.shape === 'plane';
  const s = floor ? 10 : 1;
  nudge(tq('reset'), () => ({ rx: floor ? -90 : 0, ry: 0, rz: 0, sx: s, sy: s, sz: 1 }));
}

function setBackground(color: string | null) {
  const s = get3().scene;
  commit(
    color ? { ...s, background: color, transparent: false } : { ...s, transparent: true },
    tq('bg'),
  );
}

function setDuration(sec: number) {
  const s = get3().scene;
  const duration = Math.min(LIMITS.duration[1], Math.max(LIMITS.duration[0], sec));
  // The keys stretch with the scene, so a loop still ends on the last frame.
  const fit = <P extends string>(keys: Partial<Record<P, { t: number }[]>> | undefined) => {
    if (!keys) return keys;
    const f = duration / s.duration;
    const out = {} as Record<P, { t: number }[]>;
    for (const [p, list] of Object.entries(keys) as [P, { t: number }[]][])
      out[p] = list.map((k) => ({ ...k, t: Math.round(k.t * f * 1e4) / 1e4 }));
    return out;
  };
  commit(
    {
      ...s,
      duration,
      nodes: s.nodes.map((n) => (n.keys ? { ...n, keys: fit(n.keys) as Node3D['keys'] } : n)),
      camera: s.camera.keys
        ? { ...s.camera, keys: fit(s.camera.keys) as typeof s.camera.keys }
        : s.camera,
    },
    tq('length'),
  );
}

/** Moves the camera to a preset spot (keyed at the playhead when the camera is animated). */
function cameraTo(label: string, fn: (pos: Vec3, target: Vec3) => { pos: Vec3; target: Vec3 }) {
  const { scene, time } = get3();
  const now = cameraAt(scene.camera, time);
  const { pos, target } = fn(now.position, now.target);
  let cam = scene.camera;
  const props: [CameraProp, number][] = [
    ['px', pos[0]],
    ['py', pos[1]],
    ['pz', pos[2]],
    ['tx', target[0]],
    ['ty', target[1]],
    ['tz', target[2]],
  ];
  for (const [p, v] of props) cam = setCameraProp(cam, p, v, time, scene.fps);
  commit({ ...scene, camera: cam }, label);
  set3({ viewCam: true });
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) || 6;
const VIEWS: { key: K; glyph: string; at: (r: number) => Vec3 }[] = [
  { key: 'front', glyph: '⬜', at: (r) => [0, r * 0.2, r] },
  { key: 'top', glyph: '⬇', at: (r) => [0, r, 0.01] },
  { key: 'side', glyph: '◧', at: (r) => [r, r * 0.2, 0] },
  { key: 'corner', glyph: '◩', at: (r) => [r * 0.62, r * 0.45, r * 0.62] },
];
const zoom = (f: number, key: K) => () =>
  cameraTo(tq(key), (pos, target) => ({
    pos: [0, 1, 2].map((i) => target[i]! + (pos[i]! - target[i]!) * f) as Vec3,
    target,
  }));

function template(id: TemplateId | 'empty') {
  const s = get3().scene;
  const keep = { width: s.width, height: s.height, fps: s.fps, duration: s.duration };
  loadScene(id === 'empty' ? newScene(keep) : fromTemplate(id, keep), tq(id));
}

function Btn(p: {
  glyph?: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  on?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      className={`q3-btn${p.danger ? ' q3-danger' : ''}${p.on ? ' on' : ''}${p.wide ? ' q3-wide' : ''}`}
      title={p.label}
      aria-pressed={p.on}
      onClick={p.onClick}
    >
      {p.glyph && (
        <span className="q3-glyph" aria-hidden>
          {p.glyph}
        </span>
      )}
      <span>{p.label}</span>
    </button>
  );
}

function Swatches(p: { colors: string[]; value?: string; onPick: (c: string) => void }) {
  return (
    <div className="q3-swatches">
      {p.colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`q3-sw${p.value?.toLowerCase() === c ? ' on' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={c}
          onClick={() => p.onPick(c)}
        />
      ))}
      <label className="q3-sw q3-custom" title={tq('custom')}>
        <input
          type="color"
          value={p.value ?? '#ffffff'}
          aria-label={tq('custom')}
          onChange={(e) => p.onPick(e.target.value)}
        />
      </label>
    </div>
  );
}

function SceneTools() {
  const bg = use3((s) => (s.scene.transparent ? null : s.scene.background));
  const duration = use3((s) => s.scene.duration);
  return (
    <>
      <Section id="bg" title={tq('bg')}>
        <Swatches colors={BACKGROUNDS} value={bg ?? undefined} onPick={setBackground} />
        <div className="q3-grid q3-gap">
          <Btn glyph="▦" label={tq('clear')} on={bg === null} onClick={() => setBackground(null)} />
        </div>
      </Section>
      <Section id="views" title={tq('views')}>
        <div className="q3-grid">
          {VIEWS.map((v) => (
            <Btn
              key={v.key}
              glyph={v.glyph}
              label={tq(v.key)}
              onClick={() =>
                cameraTo(tq(v.key), (pos, target) => ({
                  pos: v.at(dist(pos, target)),
                  target: [0, 0, 0],
                }))
              }
            />
          ))}
          <Btn glyph="＋" label={tq('zoomIn')} onClick={zoom(0.8, 'zoomIn')} />
          <Btn glyph="－" label={tq('zoomOut')} onClick={zoom(1.25, 'zoomOut')} />
        </div>
      </Section>
      <Section id="length" title={tq('length')}>
        <div className="q3-row">
          {[3, 5, 10, 15].map((sec) => (
            <Btn
              key={sec}
              label={`${sec} s`}
              on={Math.abs(duration - sec) < 0.01}
              onClick={() => setDuration(sec)}
            />
          ))}
        </div>
      </Section>
      <Section id="ready" title={tq('ready')}>
        <div className="q3-grid">
          <Btn glyph="✦" label={tq('logo')} onClick={() => template('logo')} />
          <Btn glyph="⟳" label={tq('turntable')} onClick={() => template('turntable')} />
          <Btn glyph="🎥" label={tq('orbit')} onClick={() => template('orbit')} />
          <Btn glyph="✕" label={tq('empty')} onClick={() => template('empty')} />
        </div>
      </Section>
    </>
  );
}

function NodeTools({ n }: { n: Node3D }) {
  const color = n.kind === 'light' ? n.light?.color : n.material?.color;
  const anims = animsOf(n);
  const look = finishOf(n.material);
  const isLight = n.kind === 'light';
  const ambient = n.light?.type === 'ambient';
  return (
    <>
      <div className="q3-name">
        <strong title={n.name}>{n.name}</strong>
        <button type="button" className="q3-link" onClick={() => set3({ selected: null })}>
          {tq('deselect')}
        </button>
      </div>
      {n.shape === 'text' && (
        <label className="q3-text">
          <span>{tq('words')}</span>
          <input
            type="text"
            maxLength={TEXT_MAX}
            value={n.text ?? ''}
            onChange={(e) => {
              const text = cleanText(e.target.value);
              if (text) commitNode(n.id, (x) => ({ ...x, text }), tq('words'));
            }}
          />
        </label>
      )}
      {(isLight || n.material) && (
        <Section id="color" title={tq('color')}>
          <Swatches colors={SWATCHES} value={color} onPick={paint} />
        </Section>
      )}
      {n.material && (
        <Section id="look" title={tq('look')}>
          <div className="q3-grid">
            {FINISHES.map((f) => (
              <Btn
                key={f.key}
                label={tq(f.key)}
                on={look === f.key}
                onClick={() => finish(f.m, tq(f.key))}
              />
            ))}
          </div>
        </Section>
      )}
      {isLight && (
        <Section id="power" title={tq('power')}>
          <div className="q3-grid">
            {(['stronger', 'softer'] as const).map((k) => (
              <Btn
                key={k}
                glyph={k === 'stronger' ? '☀' : '☾'}
                label={tq(k)}
                onClick={() =>
                  nudge(tq(k), (p) => ({
                    intensity: Math.min(
                      LIMITS.intensity[1],
                      Math.max(0.01, p.intensity * (k === 'stronger' ? 1.5 : 1 / 1.5)),
                    ),
                  }))
                }
              />
            ))}
          </div>
        </Section>
      )}
      {!isLight && (
        <Section id="size" title={tq('size')}>
          <div className="q3-grid">
            <Btn glyph="＋" label={tq('bigger')} onClick={scaleBy(1.25, [0, 1, 2], 'bigger')} />
            <Btn glyph="－" label={tq('smaller')} onClick={scaleBy(0.8, [0, 1, 2], 'smaller')} />
            <Btn glyph="↔" label={tq('wider')} onClick={scaleBy(1.25, [0], 'wider')} />
            <Btn glyph="↕" label={tq('taller')} onClick={scaleBy(1.25, [1], 'taller')} />
          </div>
        </Section>
      )}
      {!ambient && (
        <Section id="move" title={tq('move')}>
          <div className="q3-pad">
            <span />
            <Btn glyph="↑" label={tq('up')} onClick={moveBy(1, 0.5, 'up')} />
            <span />
            <Btn glyph="←" label={tq('left')} onClick={moveBy(0, -0.5, 'left')} />
            <Btn
              glyph="◎"
              label={tq('center')}
              onClick={() => nudge(tq('center'), () => ({ px: 0, pz: 0 }))}
            />
            <Btn glyph="→" label={tq('right')} onClick={moveBy(0, 0.5, 'right')} />
            <span />
            <Btn glyph="↓" label={tq('down')} onClick={moveBy(1, -0.5, 'down')} />
            <span />
          </div>
          <div className="q3-grid q3-gap">
            <Btn glyph="⇡" label={tq('far')} onClick={moveBy(2, -0.5, 'far')} />
            <Btn glyph="⇣" label={tq('near')} onClick={moveBy(2, 0.5, 'near')} />
            {!isLight && (
              <>
                <Btn
                  glyph="↻"
                  label={tq('turn')}
                  onClick={() => nudge(tq('turn'), (p) => ({ ry: p.rotation[1] + 45 }))}
                />
                <Btn glyph="⊥" label={tq('floor')} onClick={toFloor} />
                <Btn glyph="↺" label={tq('reset')} onClick={resetNode} wide />
              </>
            )}
          </div>
        </Section>
      )}
      {!isLight && (
        <Section id="animate" title={tq('animate')}>
          <div className="q3-grid">
            {(
              [
                ['spin', '⟳'],
                ['flip', '⤾'],
                ['float', '〰'],
                ['bounce', '⤓'],
                ['pulse', '♥'],
                ['appear', '✨'],
              ] as const
            ).map(([k, g]) => (
              <Btn key={k} glyph={g} label={tq(k)} on={anims.has(k)} onClick={() => animate(k)} />
            ))}
            {n.keys && <Btn glyph="■" label={tq('still')} onClick={() => animate('still')} wide />}
          </div>
        </Section>
      )}
      <div className="q3-grid q3-end">
        <Btn
          glyph="⧉"
          label={tq('copy')}
          onClick={() => {
            const r = duplicateNode(get3().scene, n.id);
            if (r.id === n.id) return alertFull();
            commit(r.scene, tq('copy'));
            set3({ selected: r.id });
          }}
        />
        <Btn
          glyph={n.visible ? '◌' : '●'}
          label={tq(n.visible ? 'hideObj' : 'showObj')}
          onClick={() =>
            commitNode(
              n.id,
              (x) => ({ ...x, visible: !x.visible }),
              tq(n.visible ? 'hideObj' : 'showObj'),
            )
          }
        />
        <Btn
          glyph="🗑"
          label={tq('remove')}
          danger
          wide
          onClick={() => commit(removeNode(get3().scene, n.id), `${tq('remove')}: ${n.name}`)}
        />
      </div>
    </>
  );
}

export function QuickTools3D() {
  const [show, setShow] = useState(() => localStorage.getItem(SHOW_KEY) !== '0');
  const n = use3(selectedNode);
  const toggle = (v: boolean) => {
    setShow(v);
    localStorage.setItem(SHOW_KEY, v ? '1' : '0');
  };
  if (!show)
    return (
      <button type="button" className="q3-open s3-btn" onClick={() => toggle(true)}>
        🧰 {tq('show')}
      </button>
    );
  return (
    <section className="q3-card" aria-label={tq('title')}>
      <header className="q3-head">
        <strong>🧰 {tq('title')}</strong>
        <button type="button" className="q3-x" title={tq('hide')} onClick={() => toggle(false)}>
          ×
        </button>
      </header>

      <Section id="add" title={tq('add')}>
        <div className="q3-grid">
          {SHAPE_BTNS.map((b) => (
            <Btn
              key={b.shape}
              glyph={b.glyph}
              label={tq(b.key)}
              onClick={() => addNode(makeMesh(b.shape))}
            />
          ))}
          <Btn glyph="💡" label={tq('light')} onClick={() => addNode(makeLight('point'))} />
        </div>
      </Section>

      {n ? (
        <NodeTools n={n} />
      ) : (
        <>
          <p className="q3-hint">{tq('pick')}</p>
          <h3 className="q3-title">{tq('scene')}</h3>
          <SceneTools />
        </>
      )}
    </section>
  );
}
