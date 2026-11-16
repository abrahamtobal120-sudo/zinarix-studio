/**
 * Fase 14: the agent edits the scene open in the 3D editor, the pure part.
 *
 * The scene lives in the renderer. Main sends each scene3d_edit call there; the renderer applies
 * the operations with these functions and commits the result as one undoable step (Ctrl+Z).
 * Everything goes through sanitizeScene at the end, so a bad value is clamped, never stored.
 */
import {
  CAMERA_PROPS,
  EASES_3D,
  LIGHT_TYPES,
  LIMITS,
  NAME_MAX,
  NODE_PROPS,
  SHAPES,
  TEMPLATES,
  cleanText,
  duplicateNode,
  fromTemplate,
  isHex,
  isModelPath,
  makeLight,
  makeMesh,
  makeModel,
  removeNode,
  sanitizeScene,
  withKey,
  withoutKey,
  type CameraProp,
  type Ease3D,
  type LightType,
  type Node3D,
  type NodeProp,
  type Scene3D,
  type Shape,
  type TemplateId,
  type Vec3,
} from './scene3d.js';

export const SCENE3D_OPS = [
  'add',
  'set',
  'delete',
  'duplicate',
  'key',
  'clear_keys',
  'camera',
  'scene',
  'template',
] as const;
export type Scene3DOp = (typeof SCENE3D_OPS)[number];

type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
const num = (a: Args, k: string) =>
  typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : undefined;
const vec = (a: Args, k: string): Vec3 | undefined => {
  const v = a[k];
  return Array.isArray(v) &&
    v.length === 3 &&
    v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? (v as Vec3)
    : undefined;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmtV = (v: readonly number[]) => `[${v.map(r3).join(', ')}]`;

/** A node by id, else by name (case-insensitive; the newest one wins when names repeat). */
export function findNode(s: Scene3D, ref: string): Node3D | undefined {
  if (!ref) return undefined;
  const byId = s.nodes.find((n) => n.id === ref);
  if (byId) return byId;
  const low = ref.toLowerCase();
  return [...s.nodes].reverse().find((n) => n.name.toLowerCase() === low);
}

/** The scene as compact text for the model: settings, camera, every node with its id. */
export function sceneStateText(s: Scene3D, selected: string | null, open: boolean): string {
  const lines = [
    `3D editor ${open ? 'open' : 'closed (the scene is kept; edits still apply)'}.`,
    `Scene: ${s.width}x${s.height}, ${s.fps} fps, ${s.duration} s, ${s.transparent ? 'transparent background' : `background ${s.background}`}. Y is up, units are metres, rotation in degrees.`,
    `Camera: position ${fmtV(s.camera.position)}, target ${fmtV(s.camera.target)}, fov ${s.camera.fov}${s.camera.keys ? `, animated: ${Object.keys(s.camera.keys).join(' ')}` : ''}.`,
    `Selected: ${selected ?? 'nothing'}.`,
    `Nodes (${s.nodes.length}/${LIMITS.nodes}):`,
  ];
  for (const n of s.nodes) {
    const what =
      n.kind === 'light'
        ? `light ${n.light!.type} ${n.light!.color} intensity ${n.light!.intensity}`
        : n.kind === 'model'
          ? `model ${n.model}`
          : n.shape === 'text'
            ? `text "${n.text}" depth ${n.depth}`
            : `mesh ${n.shape}`;
    const m = n.material;
    const mat = m
      ? ` color ${m.color} metal ${m.metalness} rough ${m.roughness}${m.emissiveIntensity ? ` emissive ${m.emissive}×${m.emissiveIntensity}` : ''}${m.opacity < 1 ? ` opacity ${m.opacity}` : ''}`
      : '';
    const keys = n.keys
      ? ` keys{${Object.entries(n.keys)
          .map(
            ([p, l]) =>
              `${p}:${l!.map((k) => `${r3(k.t)}s=${r3(k.v)}${k.ease ? `/${k.ease}` : ''}`).join(',')}`,
          )
          .join(' ')}}`
      : '';
    lines.push(
      `- ${n.id} "${n.name}": ${what}; pos ${fmtV(n.position)} rot ${fmtV(n.rotation)} scale ${fmtV(n.scale)}${mat}${n.visible ? '' : ' hidden'}${keys}`,
    );
  }
  return lines.join('\n');
}

/** Applies the look/placement fields of an op (shared by add and set). */
function applyFields(n: Node3D, a: Args): Node3D {
  const out: Node3D = structuredClone(n);
  const name = cleanText(a.name, NAME_MAX);
  if (name) out.name = name;
  const p = vec(a, 'position');
  const r = vec(a, 'rotation');
  const sc = vec(a, 'scale');
  if (p) out.position = p;
  if (r) out.rotation = r;
  if (sc) out.scale = sc;
  if (typeof a.visible === 'boolean') out.visible = a.visible;
  if (out.kind === 'mesh' && out.shape === 'text') {
    const t = cleanText(a.text);
    if (t) out.text = t;
    const d = num(a, 'depth');
    if (d !== undefined) out.depth = d;
  }
  if (out.kind === 'light' && out.light) {
    if (isHex(a.color)) out.light.color = a.color;
    const i = num(a, 'intensity');
    if (i !== undefined) out.light.intensity = i;
  } else {
    const hasMat =
      isHex(a.color) ||
      ['metalness', 'roughness', 'emissiveIntensity', 'opacity'].some(
        (k) => num(a, k) !== undefined,
      ) ||
      isHex(a.emissive);
    if (hasMat || out.material) {
      const m = { ...(out.material ?? makeMesh('box').material!) };
      if (isHex(a.color)) m.color = a.color;
      if (isHex(a.emissive)) m.emissive = a.emissive;
      for (const k of ['metalness', 'roughness', 'emissiveIntensity', 'opacity'] as const) {
        const v = num(a, k);
        if (v !== undefined) m[k] = v;
      }
      if (hasMat) out.material = m;
    }
  }
  return out;
}

export interface OpsResult {
  scene: Scene3D;
  /** One line per op (English, for the model). */
  log: string[];
  /** Short Spanish summary (for the chat card). */
  summary: string;
  /** Id of the last node an op added (to select it). */
  lastAdded?: string;
}

/**
 * Applies the ops in order. A bad op stops everything (nothing is committed) with an error that
 * says which op failed, so the model can fix it and try again.
 */
export function applyScene3dOps(scene: Scene3D, ops: unknown, playhead = 0): OpsResult {
  if (!Array.isArray(ops) || !ops.length) throw new Error('"ops" must be a non-empty array.');
  if (ops.length > 100) throw new Error('At most 100 ops per call.');
  let s: Scene3D = structuredClone(scene);
  const log: string[] = [];
  let lastAdded: string | undefined;
  const counts: Record<string, number> = {};
  ops.forEach((raw, i) => {
    const fail = (msg: string): never => {
      throw new Error(`op ${i + 1}: ${msg}`);
    };
    if (!raw || typeof raw !== 'object') fail('not an object');
    const a = raw as Args;
    const op = str(a, 'op') as Scene3DOp;
    counts[op] = (counts[op] ?? 0) + 1;
    const target = (): Node3D =>
      findNode(s, str(a, 'id')) ??
      fail(`no node "${str(a, 'id')}" (use an id or name from scene3d_state)`);
    switch (op) {
      case 'add': {
        if (s.nodes.length >= LIMITS.nodes) fail(`the scene already has ${LIMITS.nodes} nodes`);
        const kind = str(a, 'kind') || 'mesh';
        let n: Node3D;
        if (kind === 'light') {
          const type = str(a, 'light') || str(a, 'type') || 'point';
          if (!LIGHT_TYPES.includes(type as LightType))
            fail(`light must be ${LIGHT_TYPES.join('|')}`);
          n = makeLight(type as LightType);
        } else if (kind === 'model') {
          const path = str(a, 'model');
          if (!isModelPath(path)) fail('model must be an absolute path to a .glb/.gltf/.obj/.fbx');
          n = makeModel(path);
        } else if (kind === 'mesh') {
          const shape = str(a, 'shape') || 'box';
          if (!SHAPES.includes(shape as Shape)) fail(`shape must be ${SHAPES.join('|')}`);
          n = makeMesh(shape as Shape);
        } else return fail('kind must be mesh|light|model');
        n = applyFields(n, a);
        s = { ...s, nodes: [...s.nodes, n] };
        lastAdded = n.id;
        log.push(`added ${n.id} "${n.name}"`);
        return;
      }
      case 'set': {
        const n = target();
        const next = applyFields(n, a);
        s = { ...s, nodes: s.nodes.map((x) => (x.id === n.id ? next : x)) };
        log.push(`changed ${n.id} "${next.name}"`);
        return;
      }
      case 'delete': {
        const n = target();
        s = removeNode(s, n.id);
        log.push(`deleted ${n.id} "${n.name}"`);
        return;
      }
      case 'duplicate': {
        const n = target();
        if (s.nodes.length >= LIMITS.nodes) fail(`the scene already has ${LIMITS.nodes} nodes`);
        const d = duplicateNode(s, n.id);
        s = d.scene;
        const copy = s.nodes.find((x) => x.id === d.id)!;
        const moved = applyFields(copy, a);
        s = { ...s, nodes: s.nodes.map((x) => (x.id === d.id ? moved : x)) };
        lastAdded = d.id;
        log.push(`duplicated ${n.id} as ${d.id} "${moved.name}"`);
        return;
      }
      case 'key': {
        const prop = str(a, 'prop');
        const t = num(a, 't') ?? playhead;
        const v = num(a, 'v');
        if (v === undefined) fail('key needs a number "v"');
        if (t < 0 || t > s.duration) fail(`t must be between 0 and the duration (${s.duration} s)`);
        const easeRaw = str(a, 'ease');
        if (easeRaw && !EASES_3D.includes(easeRaw as Ease3D))
          fail(`ease must be ${EASES_3D.join('|')}`);
        const ease = (easeRaw || undefined) as Ease3D | undefined;
        if (str(a, 'id') === 'camera') {
          if (!CAMERA_PROPS.includes(prop as CameraProp))
            fail(`camera prop must be ${CAMERA_PROPS.join('|')}`);
          s = {
            ...s,
            camera: {
              ...s.camera,
              keys: withKey(s.camera.keys, prop as CameraProp, t, v!, s.fps, ease),
            },
          };
          log.push(`camera key ${prop} ${r3(t)}s=${r3(v!)}`);
          return;
        }
        const n = target();
        if (!NODE_PROPS.includes(prop as NodeProp)) fail(`prop must be ${NODE_PROPS.join('|')}`);
        const keys = withKey(n.keys, prop as NodeProp, t, v!, s.fps, ease);
        s = { ...s, nodes: s.nodes.map((x) => (x.id === n.id ? { ...x, keys } : x)) };
        log.push(`key ${n.id} ${prop} ${r3(t)}s=${r3(v!)}`);
        return;
      }
      case 'clear_keys': {
        const prop = str(a, 'prop');
        const t = num(a, 't');
        const isCam = str(a, 'id') === 'camera';
        const keysOf = isCam ? s.camera.keys : target().keys;
        let next: typeof keysOf;
        if (!prop) next = undefined;
        else if (t === undefined) {
          next = { ...keysOf };
          delete (next as Record<string, unknown>)[prop];
          if (!Object.keys(next).length) next = undefined;
        } else
          next = withoutKey(keysOf as Record<string, never> | undefined, prop as never, t, s.fps);
        if (isCam) {
          const cam = { ...s.camera };
          if (next) cam.keys = next as Scene3D['camera']['keys'];
          else delete cam.keys;
          s = { ...s, camera: cam };
          log.push(`cleared camera keys ${prop || '(all)'}`);
        } else {
          const n = target();
          s = {
            ...s,
            nodes: s.nodes.map((x) => {
              if (x.id !== n.id) return x;
              const y = { ...x };
              if (next) y.keys = next as Node3D['keys'];
              else delete y.keys;
              return y;
            }),
          };
          log.push(`cleared keys of ${n.id} ${prop || '(all)'}`);
        }
        return;
      }
      case 'camera': {
        const p = vec(a, 'position');
        const tg = vec(a, 'target');
        const fov = num(a, 'fov');
        s = {
          ...s,
          camera: {
            ...s.camera,
            ...(p ? { position: p } : {}),
            ...(tg ? { target: tg } : {}),
            ...(fov !== undefined ? { fov } : {}),
          },
        };
        log.push('camera changed');
        return;
      }
      case 'scene': {
        const next = { ...s };
        for (const k of ['width', 'height', 'fps', 'duration'] as const) {
          const v = num(a, k);
          if (v !== undefined) next[k] = v;
        }
        if (typeof a.transparent === 'boolean') next.transparent = a.transparent;
        if (isHex(a.background)) {
          next.background = a.background;
          if (typeof a.transparent !== 'boolean') next.transparent = false;
        }
        s = next;
        log.push('scene settings changed');
        return;
      }
      case 'template': {
        const id = str(a, 'template');
        if (!TEMPLATES.includes(id as TemplateId)) fail(`template must be ${TEMPLATES.join('|')}`);
        const shape = str(a, 'shape');
        s = fromTemplate(id as TemplateId, {
          text: cleanText(a.text) || undefined,
          color: isHex(a.color) ? a.color : undefined,
          shape: SHAPES.includes(shape as Shape) ? (shape as Shape) : undefined,
          model: isModelPath(a.model) ? a.model : undefined,
          duration: num(a, 'duration'),
        });
        log.push(`scene replaced by template ${id}`);
        return;
      }
      default:
        fail(`unknown op "${op}" (use ${SCENE3D_OPS.join('|')})`);
    }
  });
  const clean = sanitizeScene(s);
  const ES: Record<string, string> = {
    add: 'agregó',
    set: 'cambió',
    delete: 'borró',
    duplicate: 'duplicó',
    key: 'clave(s)',
    clear_keys: 'quitó claves',
    camera: 'cámara',
    scene: 'ajustes',
    template: 'plantilla',
  };
  const summary = Object.entries(counts)
    .map(([op, c]) => `${ES[op] ?? op}${c > 1 ? ` ×${c}` : ''}`)
    .join(', ');
  return {
    scene: clean,
    log,
    summary,
    ...(lastAdded && clean.nodes.some((n) => n.id === lastAdded) ? { lastAdded } : {}),
  };
}

/** Plain Spanish line for the approval card. */
export function describeOps(ops: unknown): string {
  if (!Array.isArray(ops)) return 'cambiar la escena 3D';
  const parts = ops.slice(0, 8).map((raw) => {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Args;
    const id = str(a, 'id');
    switch (str(a, 'op')) {
      case 'add':
        return `agregar ${str(a, 'kind') === 'light' ? `luz ${str(a, 'light') || 'puntual'}` : str(a, 'kind') === 'model' ? 'modelo' : str(a, 'shape') || 'cubo'}${str(a, 'name') ? ` "${str(a, 'name')}"` : ''}`;
      case 'set':
        return `cambiar ${id}`;
      case 'delete':
        return `borrar ${id}`;
      case 'duplicate':
        return `duplicar ${id}`;
      case 'key':
        return `animar ${id} (${str(a, 'prop')})`;
      case 'clear_keys':
        return `quitar animación de ${id}`;
      case 'camera':
        return 'mover la cámara';
      case 'scene':
        return 'ajustes de la escena';
      case 'template':
        return `reemplazar la escena con la plantilla ${str(a, 'template')}`;
      default:
        return str(a, 'op') || '?';
    }
  });
  return parts.join(', ') + (ops.length > 8 ? ` y ${ops.length - 8} más` : '');
}
