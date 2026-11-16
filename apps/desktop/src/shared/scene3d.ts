/**
 * Fase 14: a small 3D scene (shapes, 3D text, imported models, lights and one camera) with
 * keyframes, kept as plain JSON so the viewer (three.js), the Blender bridge and the agent all
 * read the same thing. Pure: no three.js, no Node, no Electron.
 *
 * Coordinates follow three.js and glTF: Y up, metres, rotations in degrees (Euler XYZ).
 * The Blender script (toBpy) converts to Blender's Z up by parenting everything to one root.
 */
/**
 * Curves of a key (how the value travels to the next key). The first three are the ones of the
 * video keys (Fase 12); the 3D editor adds the classic motion-design ones. Blender gets them
 * baked into per-frame keys (bakeKeys), so both renderers draw the same motion.
 */
export type Ease3D = 'linear' | 'ease' | 'in' | 'out' | 'back' | 'bounce' | 'elastic' | 'hold';
export const EASES_3D: readonly Ease3D[] = [
  'linear',
  'ease',
  'in',
  'out',
  'back',
  'bounce',
  'elastic',
  'hold',
];

export interface Keyframe {
  /** Scene seconds. */
  t: number;
  v: number;
  /** Curve towards the next key (default linear). */
  ease?: Ease3D;
}

function bounceOut(k: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
}

/** 0→1 progress through a segment for each curve ('hold' is handled by the caller). */
export function easeK(ease: Ease3D | undefined, k: number): number {
  switch (ease) {
    case 'ease':
      return k * k * (3 - 2 * k);
    case 'in':
      return k * k * k;
    case 'out':
      return 1 - (1 - k) ** 3;
    case 'back': {
      // Overshoots ~10 % and settles (easeOutBack).
      const c = 1.70158;
      return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
    }
    case 'bounce':
      return bounceOut(k);
    case 'elastic':
      if (k <= 0 || k >= 1) return k;
      return 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    default:
      return k;
  }
}

/** Value of sorted keys at scene time t (held before the first and after the last). */
export function interpKeys(keys: readonly Keyframe[], t: number): number {
  const first = keys[0]!;
  if (keys.length === 1 || t <= first.t) return first.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t >= b.t) continue;
    if (a.ease === 'hold' || b.t - a.t < 1e-9) return a.v;
    return a.v + (b.v - a.v) * easeK(a.ease, (t - a.t) / (b.t - a.t));
  }
  return keys[keys.length - 1]!.v;
}

/**
 * Keys Blender can reproduce exactly: linear and hold segments stay as they are; every other
 * curve becomes one linear key per frame. Exact on frames, which is all a render samples.
 */
export function bakeKeys(keys: readonly Keyframe[], fps: number): Keyframe[] {
  const out: Keyframe[] = [];
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!;
    const b = keys[i + 1];
    const plain = !a.ease || a.ease === 'linear' || a.ease === 'hold';
    out.push(plain ? { ...a } : { t: a.t, v: a.v });
    if (!b || plain) continue;
    const f0 = Math.floor(a.t * fps + 1e-6) + 1;
    const f1 = Math.ceil(b.t * fps - 1e-6) - 1;
    for (let f = f0; f <= f1; f++) {
      const t = f / fps;
      out.push({ t, v: round4(interpKeys(keys, t)) });
    }
  }
  return out;
}

/** Every key list of a scene baked for Blender. */
export function bakeScene(s: Scene3D): Scene3D {
  const bake = <P extends string>(k: Keys<P> | undefined): Keys<P> | undefined => {
    if (!k) return k;
    const out: Keys<P> = {};
    for (const [p, list] of Object.entries(k) as [P, Keyframe[] | undefined][])
      if (list?.length) out[p] = bakeKeys(list, s.fps);
    return out;
  };
  return {
    ...s,
    camera: { ...s.camera, ...(s.camera.keys ? { keys: bake(s.camera.keys) } : {}) },
    nodes: s.nodes.map((n) => (n.keys ? { ...n, keys: bake(n.keys) } : n)),
  };
}

export type Vec3 = [number, number, number];
export type Shape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'text';
export const SHAPES: readonly Shape[] = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'torus',
  'plane',
  'text',
];
export type LightType = 'ambient' | 'directional' | 'point';
export const LIGHT_TYPES: readonly LightType[] = ['ambient', 'directional', 'point'];
export type NodeKind = 'mesh' | 'model' | 'light';

/** glTF, GLB, OBJ and FBX open in both the viewer and Blender. */
export const MODEL_EXTS = ['.glb', '.gltf', '.obj', '.fbx'] as const;

export interface Material3D {
  /** sRGB hex, "#rrggbb". */
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  /** 0–1 (1 = solid). */
  opacity: number;
}

/** What can be animated on a node (position, rotation in degrees, scale; light strength). */
export type NodeProp = 'px' | 'py' | 'pz' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz' | 'intensity';
export const NODE_PROPS: readonly NodeProp[] = [
  'px',
  'py',
  'pz',
  'rx',
  'ry',
  'rz',
  'sx',
  'sy',
  'sz',
  'intensity',
];
/** The camera: its position and the point it looks at. */
export type CameraProp = 'px' | 'py' | 'pz' | 'tx' | 'ty' | 'tz';
export const CAMERA_PROPS: readonly CameraProp[] = ['px', 'py', 'pz', 'tx', 'ty', 'tz'];

/** Keys use scene seconds (`t`), the same shape as the video keys of Fase 12. */
export type Keys<P extends string> = Partial<Record<P, Keyframe[]>>;

export interface Node3D {
  id: string;
  name: string;
  kind: NodeKind;
  /** kind "mesh". */
  shape?: Shape;
  /** shape "text": up to TEXT_MAX characters. */
  text?: string;
  /** shape "text": extrusion depth in metres. */
  depth?: number;
  /** kind "model": absolute path to a .glb/.gltf/.obj/.fbx (fitted to 2 m, centred). */
  model?: string;
  /** kind "light". */
  light?: { type: LightType; color: string; intensity: number };
  position: Vec3;
  /** Degrees. */
  rotation: Vec3;
  scale: Vec3;
  material?: Material3D;
  visible: boolean;
  keys?: Keys<NodeProp>;
}

export interface Camera3D {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  keys?: Keys<CameraProp>;
}

export interface Scene3D {
  version: 1;
  width: number;
  height: number;
  fps: number;
  /** Seconds. */
  duration: number;
  /** Render with a transparent background (alpha channel). */
  transparent: boolean;
  /** Background when not transparent (sRGB hex). */
  background: string;
  camera: Camera3D;
  nodes: Node3D[];
}

export const LIMITS = {
  nodes: 200,
  keys: 100,
  duration: [0.5, 60] as const,
  fps: [12, 60] as const,
  size: [64, 3840] as const,
  /** Pixels per frame (4K) bounds the memory of a render. */
  pixels: 3840 * 2160,
  coord: 1000,
  scale: [0.001, 1000] as const,
  fov: [10, 120] as const,
  intensity: [0, 1000] as const,
  depth: [0.01, 5] as const,
};
export const TEXT_MAX = 60;
export const NAME_MAX = 60;

export const DEFAULT_MATERIAL: Material3D = {
  color: '#4f8cff',
  metalness: 0.2,
  roughness: 0.4,
  emissive: '#000000',
  emissiveIntensity: 0,
  opacity: 1,
};

let seq = 0;
export function id3(prefix = 'n'): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const SHAPE_NAMES: Record<Shape, string> = {
  box: 'Cubo',
  sphere: 'Esfera',
  cylinder: 'Cilindro',
  cone: 'Cono',
  torus: 'Toro',
  plane: 'Plano',
  text: 'Texto',
};
const LIGHT_NAMES: Record<LightType, string> = {
  ambient: 'Luz ambiente',
  directional: 'Luz direccional',
  point: 'Luz puntual',
};

export function makeMesh(shape: Shape, over: Partial<Node3D> = {}): Node3D {
  return {
    id: id3(),
    name: SHAPE_NAMES[shape],
    kind: 'mesh',
    shape,
    ...(shape === 'text' ? { text: 'Zinarix', depth: 0.25 } : {}),
    position: [0, 0, 0],
    rotation: shape === 'plane' ? [-90, 0, 0] : [0, 0, 0],
    scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL },
    visible: true,
    ...over,
  };
}

export function makeLight(type: LightType, over: Partial<Node3D> = {}): Node3D {
  const intensity = type === 'ambient' ? 0.4 : type === 'directional' ? 2.5 : 30;
  return {
    id: id3(),
    name: LIGHT_NAMES[type],
    kind: 'light',
    light: { type, color: '#ffffff', intensity },
    position: type === 'ambient' ? [0, 0, 0] : type === 'directional' ? [4, 6, 5] : [-3, 3, 3],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    ...over,
  };
}

export function makeModel(path: string, over: Partial<Node3D> = {}): Node3D {
  const name = path.split(/[\\/]/).pop() ?? 'Modelo';
  return {
    id: id3(),
    name: name.slice(0, NAME_MAX),
    kind: 'model',
    model: path,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    ...over,
  };
}

/** Three lights that read well on most objects (key, fill, ambient). */
export const studioLights = (): Node3D[] => [
  makeLight('ambient'),
  makeLight('directional'),
  makeLight('point'),
];

export function newScene(over: Partial<Scene3D> = {}): Scene3D {
  return {
    version: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 4,
    transparent: true,
    background: '#101318',
    camera: { position: [0, 1.2, 6], target: [0, 0, 0], fov: 40 },
    nodes: [...studioLights(), makeMesh('box')],
    ...over,
  };
}

// ---------------- Templates ----------------

export type TemplateId = 'logo' | 'turntable' | 'orbit';
export const TEMPLATES: readonly TemplateId[] = ['logo', 'turntable', 'orbit'];

export interface TemplateOptions {
  text?: string;
  color?: string;
  /** 0–1: from plastic to polished metal. */
  metal?: number;
  duration?: number;
  transparent?: boolean;
  shape?: Shape;
  /** Absolute model path (turntable / orbit use it instead of the shape). */
  model?: string;
  width?: number;
  height?: number;
  fps?: number;
}

/** A full turn on Y over the scene, linear (so it loops without a bump). */
const spinKeys = (duration: number, turns = 1): Keyframe[] => [
  { t: 0, v: 0 },
  { t: duration, v: 360 * turns },
];

/**
 * Ready-made scenes:
 * - logo: 3D text that turns once (the "logo girando" of the acceptance test).
 * - turntable: an object (shape or model) on a slow full turn.
 * - orbit: the camera circles a still object (four smooth quarter turns).
 */
export function fromTemplate(id: TemplateId, o: TemplateOptions = {}): Scene3D {
  const duration = clampNum(o.duration ?? 4, ...LIMITS.duration);
  const material: Material3D = {
    ...DEFAULT_MATERIAL,
    color: isHex(o.color) ? o.color : id === 'logo' ? '#38a8ff' : DEFAULT_MATERIAL.color,
    metalness: clampNum(o.metal ?? (id === 'logo' ? 0.85 : 0.2), 0, 1),
    roughness: clampNum(1 - (o.metal ?? (id === 'logo' ? 0.85 : 0.2)) * 0.75, 0.05, 1),
  };
  const base = newScene({
    duration,
    transparent: o.transparent ?? true,
    ...(o.width ? { width: o.width } : {}),
    ...(o.height ? { height: o.height } : {}),
    ...(o.fps ? { fps: o.fps } : {}),
    nodes: studioLights(),
  });
  const subject = (): Node3D =>
    o.model
      ? makeModel(o.model)
      : id === 'logo'
        ? makeMesh('text', {
            name: 'Logo',
            text: cleanText(o.text) || 'Zinarix',
            material,
          })
        : makeMesh(o.shape && o.shape !== 'text' ? o.shape : 'box', { material });
  const s = subject();
  if (s.kind === 'mesh') s.material = material;
  if (id === 'logo' || id === 'turntable') {
    s.keys = { ry: spinKeys(duration) };
    base.nodes.push(s);
    return base;
  }
  // orbit: the camera goes round at radius 6, height 1.5.
  base.nodes.push(s);
  const r = 6;
  const steps = 8;
  const px: Keyframe[] = [];
  const pz: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const t = (i / steps) * duration;
    px.push({ t, v: round4(Math.sin(a) * r) });
    pz.push({ t, v: round4(Math.cos(a) * r) });
  }
  base.camera = { position: [0, 1.5, r], target: [0, 0, 0], fov: 40, keys: { px, pz } };
  return base;
}

// ---------------- Evaluation ----------------

const PROP_AT: Record<
  Exclude<NodeProp, 'intensity'>,
  ['position' | 'rotation' | 'scale', number]
> = {
  px: ['position', 0],
  py: ['position', 1],
  pz: ['position', 2],
  rx: ['rotation', 0],
  ry: ['rotation', 1],
  rz: ['rotation', 2],
  sx: ['scale', 0],
  sy: ['scale', 1],
  sz: ['scale', 2],
};

/** The value of a node property without animation. */
export function baseValue(n: Node3D, p: NodeProp): number {
  if (p === 'intensity') return n.light?.intensity ?? 0;
  const [field, i] = PROP_AT[p];
  return n[field][i]!;
}

export interface NodePose {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  intensity: number;
}

const valueOf = <P extends string>(keys: Keys<P> | undefined, p: P, base: number, t: number) => {
  const k = keys?.[p];
  return k?.length ? interpKeys(k, t) : base;
};

/** Where a node is (and how bright a light is) at scene time t. */
export function poseAt(n: Node3D, t: number): NodePose {
  const v = (p: NodeProp) => valueOf(n.keys, p, baseValue(n, p), t);
  return {
    position: [v('px'), v('py'), v('pz')],
    rotation: [v('rx'), v('ry'), v('rz')],
    scale: [v('sx'), v('sy'), v('sz')],
    intensity: v('intensity'),
  };
}

export function cameraAt(c: Camera3D, t: number): { position: Vec3; target: Vec3; fov: number } {
  const v = (p: CameraProp, base: number) => valueOf(c.keys, p, base, t);
  return {
    position: [v('px', c.position[0]), v('py', c.position[1]), v('pz', c.position[2])],
    target: [v('tx', c.target[0]), v('ty', c.target[1]), v('tz', c.target[2])],
    fov: c.fov,
  };
}

export const frameCount = (s: Scene3D): number => Math.max(1, Math.round(s.duration * s.fps));
/** Scene time of frame i (0-based). */
export const frameTime = (s: Scene3D, i: number): number => i / s.fps;

/** Every key time in the scene (for the markers of the key bar), sorted, unique. */
export function keyTimes(s: Scene3D, nodeId?: string): number[] {
  const out = new Set<number>();
  const add = (keys: Keys<string> | undefined) => {
    for (const list of Object.values(keys ?? {})) for (const k of list ?? []) out.add(k.t);
  };
  if (!nodeId || nodeId === 'camera') add(s.camera.keys as Keys<string> | undefined);
  for (const n of s.nodes) if (!nodeId || n.id === nodeId) add(n.keys as Keys<string> | undefined);
  return [...out].sort((a, b) => a - b);
}

// ---------------- Editing (immutable) ----------------

/** Puts (or replaces, within half a frame) a key at time t. */
export function withKey<P extends string>(
  keys: Keys<P> | undefined,
  p: P,
  t: number,
  v: number,
  fps: number,
  ease?: Ease3D,
): Keys<P> {
  const old = keys?.[p] ?? [];
  // Re-keying keeps the curve the key had.
  const prev = old.find((k) => Math.abs(k.t - t) < 0.5 / fps)?.ease;
  const list = old.filter((k) => Math.abs(k.t - t) >= 0.5 / fps);
  const key: Keyframe = { t: round4(t), v: round4(v) };
  const e = ease ?? prev;
  if (e && e !== 'linear') key.ease = e;
  list.push(key);
  list.sort((a, b) => a.t - b.t);
  return { ...keys, [p]: list.slice(0, LIMITS.keys) } as Keys<P>;
}

export function withoutKey<P extends string>(
  keys: Keys<P> | undefined,
  p: P,
  t: number,
  fps: number,
): Keys<P> | undefined {
  const list = (keys?.[p] ?? []).filter((k) => Math.abs(k.t - t) >= 0.5 / fps);
  const next = { ...keys } as Keys<P>;
  if (list.length) next[p] = list;
  else delete next[p];
  return Object.keys(next).length ? next : undefined;
}

/** Keys at t for every property of a group (◆ on the transform of the inspector). */
export function keyAllAt(n: Node3D, props: readonly NodeProp[], t: number, fps: number): Node3D {
  const pose = poseAt(n, t);
  let keys = n.keys;
  for (const p of props) {
    const v = p === 'intensity' ? pose.intensity : pose[PROP_AT[p][0]][PROP_AT[p][1]]!;
    keys = withKey(keys, p, t, v, fps);
  }
  return { ...n, keys };
}

export const hasKeyAt = (list: readonly Keyframe[] | undefined, t: number, fps: number): boolean =>
  !!list?.some((k) => Math.abs(k.t - t) < 0.5 / fps);

/** The curve of the keys at t of a node or the camera ('mixed' when they differ). */
export function easeAt(
  keys: Keys<string> | undefined,
  t: number,
  fps: number,
): Ease3D | 'mixed' | null {
  const found = new Set<Ease3D>();
  for (const list of Object.values(keys ?? {}))
    for (const k of list ?? []) if (Math.abs(k.t - t) < 0.5 / fps) found.add(k.ease ?? 'linear');
  if (!found.size) return null;
  return found.size === 1 ? [...found][0]! : 'mixed';
}

/** Sets the curve of every key at t (the segment that starts there). */
export function withEaseAt<P extends string>(
  keys: Keys<P> | undefined,
  t: number,
  fps: number,
  ease: Ease3D,
): Keys<P> | undefined {
  if (!keys) return keys;
  const out: Keys<P> = {};
  for (const [p, list] of Object.entries(keys) as [P, Keyframe[] | undefined][]) {
    if (!list) continue;
    out[p] = list.map((k) => {
      if (Math.abs(k.t - t) >= 0.5 / fps) return k;
      const next: Keyframe = { t: k.t, v: k.v };
      if (ease !== 'linear') next.ease = ease;
      return next;
    });
  }
  return out;
}

export function updateNode(s: Scene3D, id: string, fn: (n: Node3D) => Node3D): Scene3D {
  return { ...s, nodes: s.nodes.map((n) => (n.id === id ? fn(n) : n)) };
}

export function removeNode(s: Scene3D, id: string): Scene3D {
  return { ...s, nodes: s.nodes.filter((n) => n.id !== id) };
}

export function duplicateNode(s: Scene3D, id: string): { scene: Scene3D; id: string } {
  const n = s.nodes.find((x) => x.id === id);
  if (!n || s.nodes.length >= LIMITS.nodes) return { scene: s, id };
  const copy: Node3D = structuredClone(n);
  copy.id = id3();
  copy.name = `${n.name} (copia)`.slice(0, NAME_MAX);
  copy.position = [n.position[0] + 0.5, n.position[1], n.position[2]];
  const i = s.nodes.indexOf(n);
  return {
    scene: { ...s, nodes: [...s.nodes.slice(0, i + 1), copy, ...s.nodes.slice(i + 1)] },
    id: copy.id,
  };
}

// ---------------- Validation ----------------

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (s: unknown): s is string => typeof s === 'string' && HEX.test(s);

function clampNum(v: unknown, lo: number, hi: number, fallback = lo): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
}
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Printable text without control characters, trimmed to TEXT_MAX. */
export function cleanText(s: unknown, max = TEXT_MAX): string {
  if (typeof s !== 'string') return '';
  return [...s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, max).join('');
}

function vec(v: unknown, fallback: Vec3, lo = -LIMITS.coord, hi = LIMITS.coord): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) return [...fallback];
  return v.map((x, i) => clampNum(x, lo, hi, fallback[i])) as Vec3;
}

function keys<P extends string>(
  v: unknown,
  props: readonly P[],
  duration: number,
): Keys<P> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Keys<P> = {};
  for (const p of props) {
    const list = (v as Record<string, unknown>)[p];
    if (!Array.isArray(list)) continue;
    const clean: Keyframe[] = [];
    for (const k of list.slice(0, LIMITS.keys)) {
      if (!k || typeof k !== 'object') continue;
      const { t, v: val, ease } = k as Record<string, unknown>;
      if (typeof t !== 'number' || typeof val !== 'number') continue;
      if (!Number.isFinite(t) || !Number.isFinite(val)) continue;
      const key: Keyframe = { t: clampNum(t, 0, duration), v: clampNum(val, -1e5, 1e5) };
      if (EASES_3D.includes(ease as Ease3D) && ease !== 'linear') key.ease = ease as Ease3D;
      clean.push(key);
    }
    clean.sort((a, b) => a.t - b.t);
    if (clean.length) out[p] = clean;
  }
  return Object.keys(out).length ? out : undefined;
}

function material(v: unknown): Material3D {
  const m = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    color: isHex(m.color) ? m.color.toLowerCase() : DEFAULT_MATERIAL.color,
    metalness: clampNum(m.metalness, 0, 1, DEFAULT_MATERIAL.metalness),
    roughness: clampNum(m.roughness, 0, 1, DEFAULT_MATERIAL.roughness),
    emissive: isHex(m.emissive) ? m.emissive.toLowerCase() : '#000000',
    emissiveIntensity: clampNum(m.emissiveIntensity, 0, 20, 0),
    opacity: clampNum(m.opacity, 0, 1, 1),
  };
}

const isAbs = (p: string) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p);
export const isModelPath = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.length < 4096 &&
  isAbs(p) &&
  !p.includes('\0') &&
  MODEL_EXTS.some((e) => p.toLowerCase().endsWith(e));

function node(v: unknown, duration: number): Node3D | null {
  if (!v || typeof v !== 'object') return null;
  const n = v as Record<string, unknown>;
  const kind = n.kind;
  const common = {
    id: typeof n.id === 'string' && /^[\w-]{1,40}$/.test(n.id) ? n.id : id3(),
    name: cleanText(n.name, NAME_MAX),
    position: vec(n.position, [0, 0, 0]),
    rotation: vec(n.rotation, [0, 0, 0], -1e5, 1e5),
    scale: vec(n.scale, [1, 1, 1], ...LIMITS.scale),
    visible: n.visible !== false,
  };
  const k = keys(n.keys, NODE_PROPS, duration);
  if (kind === 'mesh') {
    const shape = SHAPES.includes(n.shape as Shape) ? (n.shape as Shape) : 'box';
    const out: Node3D = {
      ...common,
      name: common.name || SHAPE_NAMES[shape],
      kind,
      shape,
      material: material(n.material),
      ...(k ? { keys: k } : {}),
    };
    if (shape === 'text') {
      out.text = cleanText(n.text) || 'Texto';
      out.depth = clampNum(n.depth, ...LIMITS.depth, 0.25);
    }
    return out;
  }
  if (kind === 'model') {
    if (!isModelPath(n.model)) return null;
    return {
      ...common,
      name: common.name || 'Modelo',
      kind,
      model: n.model,
      ...(n.material ? { material: material(n.material) } : {}),
      ...(k ? { keys: k } : {}),
    };
  }
  if (kind === 'light') {
    const l = (n.light && typeof n.light === 'object' ? n.light : {}) as Record<string, unknown>;
    const type = LIGHT_TYPES.includes(l.type as LightType) ? (l.type as LightType) : 'point';
    return {
      ...common,
      name: common.name || LIGHT_NAMES[type],
      kind,
      light: {
        type,
        color: isHex(l.color) ? l.color.toLowerCase() : '#ffffff',
        intensity: clampNum(l.intensity, ...LIMITS.intensity, 1),
      },
      ...(k ? { keys: k } : {}),
    };
  }
  return null;
}

/**
 * A scene from untrusted JSON (a .z3d file, the agent, an old version): every number clamped,
 * unknown kinds dropped, sizes even (for the video encoders) and within 4K. Throws only when the
 * value is not a scene at all.
 */
export function sanitizeScene(v: unknown): Scene3D {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('No es una escena 3D.');
  const s = v as Record<string, unknown>;
  const duration = round4(clampNum(s.duration, ...LIMITS.duration, 4));
  let width = even(clampNum(s.width, ...LIMITS.size, 1920));
  let height = even(clampNum(s.height, ...LIMITS.size, 1080));
  if (width * height > LIMITS.pixels) {
    const k = Math.sqrt(LIMITS.pixels / (width * height));
    width = even(Math.floor(width * k) - 1);
    height = even(Math.floor(height * k) - 1);
  }
  const cam = (s.camera && typeof s.camera === 'object' ? s.camera : {}) as Record<string, unknown>;
  const camKeys = keys(cam.keys, CAMERA_PROPS, duration);
  const nodes = (Array.isArray(s.nodes) ? s.nodes : [])
    .slice(0, LIMITS.nodes)
    .map((n) => node(n, duration))
    .filter((n): n is Node3D => !!n);
  // Ids must be unique (a hand-edited file may repeat one).
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) n.id = id3();
    seen.add(n.id);
  }
  return {
    version: 1,
    width,
    height,
    fps: Math.round(clampNum(s.fps, ...LIMITS.fps, 30)),
    duration,
    transparent: s.transparent !== false,
    background: isHex(s.background) ? s.background.toLowerCase() : '#101318',
    camera: {
      position: vec(cam.position, [0, 1.2, 6]),
      target: vec(cam.target, [0, 0, 0]),
      fov: clampNum(cam.fov, ...LIMITS.fov, 40),
      ...(camKeys ? { keys: camKeys } : {}),
    },
    nodes,
  };
}

/** Model files the scene needs (for checking they exist before a render). */
export const modelPaths = (s: Scene3D): string[] => [
  ...new Set(s.nodes.filter((n) => n.kind === 'model' && n.model).map((n) => n.model!)),
];

/** Plain-language summary for the approval card and the agent. */
export function describeScene(s: Scene3D): string {
  const meshes = s.nodes.filter((n) => n.kind !== 'light');
  const lights = s.nodes.length - meshes.length;
  const animated = s.nodes.filter((n) => n.keys).length + (s.camera.keys ? 1 : 0);
  const what = meshes
    .slice(0, 4)
    .map((n) => (n.shape === 'text' ? `texto "${n.text}"` : n.name))
    .join(', ');
  return [
    `${s.width}×${s.height}, ${s.fps} fps, ${s.duration} s`,
    s.transparent ? 'fondo transparente' : `fondo ${s.background}`,
    `${meshes.length} objeto(s)${what ? `: ${what}${meshes.length > 4 ? '…' : ''}` : ''}`,
    `${lights} luz(ces)`,
    animated ? `${animated} con animación` : 'sin animación',
  ].join(' · ');
}

// ---------------- Video output ----------------

export type Render3DFormat = 'webm' | 'mp4' | 'png';

/** Transparent scenes need WebM (VP9 with alpha) or PNG frames; MP4 has no alpha. */
export function formatFor(s: Scene3D, asked?: Render3DFormat): Render3DFormat {
  if (asked === 'png') return 'png';
  if (s.transparent) return 'webm';
  return asked ?? 'mp4';
}

/**
 * FFmpeg arguments that turn frames into the output: raw RGBA frames on stdin (the viewer) or
 * a numbered PNG sequence (Blender). Straight (not premultiplied) alpha in both cases.
 */
export function encodeArgs(o: {
  width: number;
  height: number;
  fps: number;
  format: Render3DFormat;
  out: string;
  /** "%04d" PNG pattern instead of stdin. */
  pngInput?: string;
  /** First number of the PNG sequence (Blender starts at 1). */
  startNumber?: number;
}): string[] {
  const input = o.pngInput
    ? ['-framerate', String(o.fps), '-start_number', String(o.startNumber ?? 1), '-i', o.pngInput]
    : [
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${o.width}x${o.height}`,
        '-framerate',
        String(o.fps),
        '-i',
        'pipe:0',
      ];
  const codec =
    o.format === 'webm'
      ? [
          '-c:v',
          'libvpx-vp9',
          '-pix_fmt',
          'yuva420p',
          '-b:v',
          '0',
          '-crf',
          '24',
          '-row-mt',
          '1',
          '-deadline',
          'good',
          '-cpu-used',
          '4',
          '-auto-alt-ref',
          '0',
        ]
      : o.format === 'mp4'
        ? [
            '-c:v',
            'libx264',
            '-preset',
            'medium',
            '-crf',
            '18',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
          ]
        : ['-c:v', 'png', '-pix_fmt', 'rgba'];
  return ['-hide_banner', '-v', 'error', '-y', ...input, '-an', ...codec, o.out];
}

/**
 * Edits one property the way the inspector and the gizmo do: animated properties get a key at
 * the playhead (so dragging an animated object re-keys it), still ones change their value.
 */
export function setNodeProp(n: Node3D, p: NodeProp, v: number, t: number, fps: number): Node3D {
  if (n.keys?.[p]?.length) return { ...n, keys: withKey(n.keys, p, t, v, fps) };
  if (p === 'intensity') return n.light ? { ...n, light: { ...n.light, intensity: v } } : n;
  const [field, i] = PROP_AT[p];
  const next = [...n[field]] as Vec3;
  next[i] = v;
  return { ...n, [field]: next };
}

export function setCameraProp(
  c: Camera3D,
  p: CameraProp,
  v: number,
  t: number,
  fps: number,
): Camera3D {
  if (c.keys?.[p]?.length) return { ...c, keys: withKey(c.keys, p, t, v, fps) };
  const field = p[0] === 'p' ? 'position' : 'target';
  const next = [...c[field]] as Vec3;
  next['xyz'.indexOf(p[1]!)] = v;
  return { ...c, [field]: next };
}

/** The props of a row of the inspector (position, rotation, scale). */
export const ROW_PROPS = {
  position: ['px', 'py', 'pz'],
  rotation: ['rx', 'ry', 'rz'],
  scale: ['sx', 'sy', 'sz'],
} as const satisfies Record<string, readonly NodeProp[]>;

/**
 * WebGL reads pixels bottom row first, with colour premultiplied by alpha at the antialiased
 * edges. FFmpeg wants the top row first and straight alpha: flip and un-premultiply into `out`.
 */
export function straightTopDown(
  src: Uint8Array,
  w: number,
  h: number,
  out: Uint8Array,
): Uint8Array {
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    const from = (h - 1 - y) * row;
    const to = y * row;
    for (let i = 0; i < row; i += 4) {
      const a = src[from + i + 3]!;
      out[to + i + 3] = a;
      if (a === 255 || a === 0) {
        out[to + i] = a ? src[from + i]! : 0;
        out[to + i + 1] = a ? src[from + i + 1]! : 0;
        out[to + i + 2] = a ? src[from + i + 2]! : 0;
      } else {
        const k = 255 / a;
        out[to + i] = Math.min(255, Math.round(src[from + i]! * k));
        out[to + i + 1] = Math.min(255, Math.round(src[from + i + 1]! * k));
        out[to + i + 2] = Math.min(255, Math.round(src[from + i + 2]! * k));
      }
    }
  }
  return out;
}
