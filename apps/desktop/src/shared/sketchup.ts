/**
 * SketchUp (.skp) support, shared by the main process, the panel and the tests:
 *  - parseSkp: reads the file header (UTF-16LE "SketchUp Model" + "{23.0.367}") and the
 *    embedded PNG thumbnail, without SketchUp.
 *  - validateSketchupOps: the agent never sends Ruby. It sends a list of ops that this file
 *    validates (names, numbers, enums, paths) and the FIXED Ruby runner of the Zinarix
 *    extension (main/sketchupRuby.ts) applies them inside SketchUp. What the user approves
 *    is exactly what happens.
 * Lengths are in the job's units (mm by default; SketchUp works in inches inside).
 */

// ---------------------------------------------------------------- .skp header + thumbnail

export interface SkpInfo {
  /** "23.0.367" (null when the header has no version). */
  version: string | null;
  major: number | null;
  /** 2023 for version 23 (SketchUp 2013 and later); null for older ones. */
  year: number | null;
  /** "SketchUp 2023", "SketchUp 8"… */
  label: string;
  /** The PNG preview SketchUp stores in the file. */
  thumbnail: { png: Uint8Array; width: number; height: number } | null;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function utf16(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(c & 0xff, c >> 8);
  }
  return out;
}

function indexOf(buf: Uint8Array, pat: readonly number[], from = 0, to = buf.length): number {
  const end = Math.min(to, buf.length) - pat.length;
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

const u32 = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

/** A whole PNG starting at "at" (signature … IEND), or null when it is cut or broken. */
export function pngAt(
  buf: Uint8Array,
  at: number,
): { png: Uint8Array; width: number; height: number } | null {
  if (indexOf(buf, PNG_SIG, at, at + 8) !== at) return null;
  let p = at + 8;
  let width = 0;
  let height = 0;
  for (let n = 0; n < 100_000; n++) {
    if (p + 12 > buf.length) return null;
    const len = u32(buf, p);
    const type = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!);
    if (!/^[A-Za-z]{4}$/.test(type) || p + 12 + len > buf.length) return null;
    if (n === 0) {
      if (type !== 'IHDR' || len < 8) return null;
      width = u32(buf, p + 8);
      height = u32(buf, p + 12);
    }
    p += 12 + len;
    if (type === 'IEND') return width && height ? { png: buf.slice(at, p), width, height } : null;
  }
  return null;
}

/** True when the bytes start like a SketchUp model. */
export function isSkpHeader(buf: Uint8Array): boolean {
  return indexOf(buf, utf16('SketchUp Model'), 0, 512) >= 0;
}

export function parseSkp(buf: Uint8Array): SkpInfo {
  const name = indexOf(buf, utf16('SketchUp Model'), 0, 512);
  if (name < 0) throw new Error('This is not a SketchUp file (no "SketchUp Model" header).');
  let version: string | null = null;
  const open = indexOf(buf, utf16('{'), name, name + 200);
  if (open >= 0) {
    let s = '';
    for (let i = open + 2; i + 1 < buf.length && s.length < 40; i += 2) {
      const c = buf[i]! | (buf[i + 1]! << 8);
      if (c === 0x7d) {
        version = s;
        break;
      }
      if (c < 0x20 || c > 0x7e) break;
      s += String.fromCharCode(c);
    }
  }
  const m = version ? /^(\d+)/.exec(version) : null;
  const major = m ? Number(m[1]) : null;
  const year = major !== null && major >= 13 && major < 100 ? 2000 + major : null;
  // The largest whole PNG in the file is the preview.
  let thumbnail: SkpInfo['thumbnail'] = null;
  for (let at = indexOf(buf, PNG_SIG); at >= 0; at = indexOf(buf, PNG_SIG, at + 8)) {
    const png = pngAt(buf, at);
    if (png && (!thumbnail || png.png.length > thumbnail.png.length)) thumbnail = png;
    if (png) at += png.png.length - 8;
  }
  return {
    version,
    major,
    year,
    label: year ? `SketchUp ${year}` : major !== null ? `SketchUp ${major}` : 'SketchUp',
    thumbnail,
  };
}

/** Year of an installed SketchUp from its folder ("SketchUp 2024") or file name. */
export function sketchupYear(path: string): number | null {
  const m = /SketchUp[ _-]?(20\d\d)/i.exec(path) ?? /(20\d\d)/.exec(path);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------- ops

export const SKETCHUP_UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const;
export type SketchupUnits = (typeof SKETCHUP_UNITS)[number];
export const SKETCHUP_VIEWS = ['iso', 'top', 'bottom', 'front', 'back', 'left', 'right'] as const;
export const SKETCHUP_EXPORTS = [
  'dae',
  'obj',
  'stl',
  'fbx',
  'dwg',
  'dxf',
  '3ds',
  'kmz',
  'png',
  'jpg',
] as const;
/** What the panel's 3D preview can show (exported by SketchUp). */
export const SKETCHUP_PREVIEWABLE = /\.(stl|obj|dae)$/i;
export const SKETCHUP_OP_NAMES = [
  'add_box',
  'add_rect',
  'add_face',
  'pushpull',
  'add_cylinder',
  'move',
  'rotate',
  'scale',
  'group',
  'delete',
  'material',
  'tag',
  'add_component',
  'add_text',
  'add_dimension',
  'view',
  'save',
  'export',
  'open',
] as const;
export type SketchupOpName = (typeof SKETCHUP_OP_NAMES)[number];
export type SketchupOp = { op: SketchupOpName; units?: SketchupUnits } & Record<string, unknown>;

const MAX_OPS = 100;
const MAX_LEN = 1e6;

/** Absolute path of a file the op reads or writes (throws when it is not allowed). */
export type SketchupPathResolver = (
  p: string,
  why: 'component' | 'texture' | 'save' | 'export' | 'open',
) => string;

function err(i: number, op: string, msg: string): never {
  throw new Error(`op #${i + 1} (${op}): ${msg}`);
}

function num(
  v: unknown,
  i: number,
  op: string,
  key: string,
  min = -MAX_LEN,
  max = MAX_LEN,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) err(i, op, `"${key}" must be a number`);
  if (v < min || v > max) err(i, op, `"${key}" must be between ${min} and ${max}`);
  return v;
}

function vec3(
  v: unknown,
  i: number,
  op: string,
  key: string,
  max = MAX_LEN,
): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) err(i, op, `"${key}" must be [x, y, z]`);
  return v.map((n, k) => num(n, i, op, `${key}[${k}]`, -max, max)) as [number, number, number];
}

function label(v: unknown, i: number, op: string, key: string, maxLen = 80): string {
  if (typeof v !== 'string' || !v.trim()) err(i, op, `"${key}" must be a non-empty text`);
  const t = v.trim();
  if (t.length > maxLen) err(i, op, `"${key}" is longer than ${maxLen} characters`);
  if (/[\u0000-\u001f\u007f]/.test(t)) err(i, op, `"${key}" has control characters`);
  return t;
}

const COLOR = /^#[0-9a-f]{6}$/i;

/** Validates the agent's ops; paths come back absolute (resolved by the caller). */
export function validateSketchupOps(raw: unknown, resolve: SketchupPathResolver): SketchupOp[] {
  if (!Array.isArray(raw)) throw new Error('"ops" must be an array.');
  if (raw.length > MAX_OPS) throw new Error(`At most ${MAX_OPS} ops per call.`);
  return raw.map((r, i): SketchupOp => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) err(i, '?', 'must be an object');
    const a = r as Record<string, unknown>;
    let op = String(a.op ?? '');
    if (op === 'set_layer' || op === 'set_tag') op = 'tag';
    if (op === 'face') op = 'add_face';
    if (!(SKETCHUP_OP_NAMES as readonly string[]).includes(op))
      err(i, op || '?', `unknown op; use ${SKETCHUP_OP_NAMES.join(', ')}`);
    const out: SketchupOp = { op: op as SketchupOpName };
    if (a.units !== undefined) {
      if (!(SKETCHUP_UNITS as readonly string[]).includes(String(a.units)))
        err(i, op, `"units" must be ${SKETCHUP_UNITS.join('|')}`);
      out.units = a.units as SketchupUnits;
    }
    const opt = (key: string, f: (v: unknown) => unknown) => {
      if (a[key] !== undefined && a[key] !== null) out[key] = f(a[key]);
    };
    const xyz = () => {
      for (const k of ['x', 'y', 'z']) out[k] = a[k] === undefined ? 0 : num(a[k], i, op, k);
    };
    const pathOf = (key: string, why: Parameters<SketchupPathResolver>[1], ext: RegExp) => {
      const p = label(a[key], i, op, key, 4096);
      if (!ext.test(p)) err(i, op, `"${key}" has the wrong file type`);
      try {
        return resolve(p, why);
      } catch (e) {
        return err(i, op, (e as Error).message);
      }
    };
    const named = () => opt('name', (v) => label(v, i, op, 'name'));
    const target = () => (out.target = label(a.target ?? a.object, i, op, 'target'));
    switch (op) {
      case 'add_box':
        named();
        xyz();
        out.w = num(a.w, i, op, 'w', 1e-6);
        out.d = num(a.d, i, op, 'd', 1e-6);
        out.h = num(a.h, i, op, 'h', 1e-6);
        break;
      case 'add_rect':
        named();
        xyz();
        out.w = num(a.w, i, op, 'w', 1e-6);
        out.d = num(a.d, i, op, 'd', 1e-6);
        break;
      case 'add_face': {
        named();
        const pts = a.points;
        if (!Array.isArray(pts) || pts.length < 3 || pts.length > 500)
          err(i, op, '"points" must be 3 to 500 [x, y, z] points');
        out.points = pts.map((p, k) => vec3(p, i, op, `points[${k}]`));
        break;
      }
      case 'pushpull':
        target();
        out.distance = num(a.distance, i, op, 'distance');
        if (out.distance === 0) err(i, op, '"distance" cannot be 0');
        break;
      case 'add_cylinder':
        named();
        xyz();
        out.radius = num(a.radius, i, op, 'radius', 1e-6);
        out.h = num(a.h, i, op, 'h', 1e-6);
        opt('segments', (v) => Math.round(num(v, i, op, 'segments', 3, 360)));
        break;
      case 'move':
        target();
        opt('to', (v) => vec3(v, i, op, 'to'));
        opt('by', (v) => vec3(v, i, op, 'by'));
        if (!out.to === !out.by)
          err(i, op, 'give "to" (new corner position) or "by" (offset), not both');
        break;
      case 'rotate':
        target();
        out.angle = num(a.angle, i, op, 'angle', -36000, 36000);
        opt('axis', (v) => {
          if (!['x', 'y', 'z'].includes(String(v))) err(i, op, '"axis" must be x|y|z');
          return v;
        });
        opt('about', (v) => vec3(v, i, op, 'about'));
        break;
      case 'scale':
        target();
        out.factor = Array.isArray(a.factor)
          ? vec3(a.factor, i, op, 'factor', 1e4)
          : num(a.factor, i, op, 'factor', -1e4, 1e4);
        if ((Array.isArray(out.factor) ? out.factor : [out.factor]).some((f) => f === 0))
          err(i, op, '"factor" cannot be 0');
        opt('about', (v) => vec3(v, i, op, 'about'));
        break;
      case 'group': {
        const ts = a.targets;
        if (!Array.isArray(ts) || !ts.length || ts.length > 200)
          err(i, op, '"targets" must be 1 to 200 names');
        out.targets = ts.map((t, k) => label(t, i, op, `targets[${k}]`));
        out.name = label(a.name, i, op, 'name');
        break;
      }
      case 'delete':
        target();
        break;
      case 'material':
        target();
        opt('name', (v) => label(v, i, op, 'name'));
        opt('color', (v) => {
          if (typeof v !== 'string' || !COLOR.test(v)) err(i, op, '"color" must be "#rrggbb"');
          return v.toLowerCase();
        });
        opt('alpha', (v) => num(v, i, op, 'alpha', 0, 1));
        if (a.texture !== undefined)
          out.texture = pathOf('texture', 'texture', /\.(png|jpe?g|bmp|tiff?|tga)$/i);
        if (!out.color && !out.texture && !out.name)
          err(i, op, 'give "color", "texture" or "name"');
        break;
      case 'tag':
        target();
        out.tag = label(a.tag ?? a.layer, i, op, 'tag');
        break;
      case 'add_component':
        out.path = pathOf('path', 'component', /\.skp$/i);
        named();
        xyz();
        break;
      case 'add_text':
        out.text = label(a.text, i, op, 'text', 500);
        xyz();
        break;
      case 'add_dimension':
        out.from = vec3(a.from, i, op, 'from');
        out.to = vec3(a.to, i, op, 'to');
        out.offset = a.offset === undefined ? [0, 0, 0] : vec3(a.offset, i, op, 'offset');
        break;
      case 'view': {
        const v = String(a.preset ?? a.view ?? 'iso');
        if (!(SKETCHUP_VIEWS as readonly string[]).includes(v))
          err(i, op, `"preset" must be ${SKETCHUP_VIEWS.join('|')}`);
        out.preset = v;
        opt('perspective', (x) => x === true);
        out.zoom_extents = a.zoom_extents !== false;
        break;
      }
      case 'save':
        if (a.path !== undefined) out.path = pathOf('path', 'save', /\.skp$/i);
        break;
      case 'export': {
        out.path = pathOf('path', 'export', new RegExp(`\\.(${SKETCHUP_EXPORTS.join('|')})$`, 'i'));
        opt('width', (v) => Math.round(num(v, i, op, 'width', 16, 8192)));
        opt('height', (v) => Math.round(num(v, i, op, 'height', 16, 8192)));
        break;
      }
      case 'open':
        out.path = pathOf('path', 'open', /\.skp$/i);
        break;
    }
    return out;
  });
}

/** Files the ops write. */
export function sketchupWrites(ops: SketchupOp[]): string[] {
  return ops
    .filter((o) => (o.op === 'export' || o.op === 'save') && typeof o.path === 'string')
    .map((o) => o.path as string);
}

const OP_ES: Record<SketchupOpName, string> = {
  add_box: 'caja',
  add_rect: 'rectángulo',
  add_face: 'cara',
  pushpull: 'empujar/tirar',
  add_cylinder: 'cilindro',
  move: 'mover',
  rotate: 'girar',
  scale: 'escalar',
  group: 'agrupar',
  delete: 'borrar',
  material: 'material',
  tag: 'etiqueta',
  add_component: 'componente',
  add_text: 'texto',
  add_dimension: 'cota',
  view: 'vista',
  save: 'guardar',
  export: 'exportar',
  open: 'abrir',
};

/** "2 caja, mover, exportar" for the approval card. */
export function describeSketchupOps(ops: SketchupOp[]): string {
  if (!ops.length) return 'sin cambios';
  const counts = new Map<string, number>();
  for (const o of ops) counts.set(OP_ES[o.op], (counts.get(OP_ES[o.op]) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${n} × ${k}` : k)).join(', ');
}

// ---------------------------------------------------------------- jobs and reports

/** What Zinarix leaves in the jobs folder for the SketchUp extension. */
export interface SketchupJob {
  id: string;
  /** ms since 1970: the extension drops jobs older than 10 minutes. */
  created: number;
  /** .skp to open (or to create when it does not exist); absent = the model open now. */
  path?: string;
  units: SketchupUnits;
  ops: SketchupOp[];
  /** Save the model after the ops (to "path" when given). */
  save: boolean;
  /** Picture of the view after the ops. */
  shot?: { path: string; width: number; height: number };
}

export interface SketchupEntityReport {
  name: string;
  type: 'group' | 'component';
  definition?: string;
  /** Bounding-box size in the job's units [x, y, z]. */
  size: [number, number, number];
  min: [number, number, number];
  tag?: string;
  material?: string;
}

export interface SketchupReport {
  sketchup: string;
  model: string;
  title: string;
  units: SketchupUnits;
  faces: number;
  edges: number;
  entities: SketchupEntityReport[];
  materials: string[];
  tags: string[];
  exported: string[];
  saved?: string;
  shot?: string;
}

export interface SketchupResult {
  id: string;
  ok: boolean;
  error?: string;
  report?: SketchupReport;
}

const f = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Number(n.toFixed(2)).toString());

export function describeSketchupReport(r: SketchupReport): string {
  const lines = [
    `SketchUp ${r.sketchup} · ${r.model || '(model not saved yet)'}${r.title ? ` (${r.title})` : ''}`,
    `${r.faces} faces, ${r.edges} edges at the top level and inside groups. Units: ${r.units}.`,
  ];
  if (r.entities.length) {
    lines.push(
      `Groups / components (${r.entities.length}${r.entities.length >= 200 ? ', first 200' : ''}):`,
      ...r.entities.map(
        (e) =>
          `- "${e.name}" ${e.type}${e.definition ? ` of ${e.definition}` : ''}: size ${e.size.map(f).join(' × ')} at ${e.min.map(f).join(', ')}${e.tag ? `, tag ${e.tag}` : ''}${e.material ? `, material ${e.material}` : ''}`,
      ),
    );
  } else lines.push('No groups or components (loose geometry only, or an empty model).');
  if (r.materials.length) lines.push(`Materials: ${r.materials.slice(0, 40).join(', ')}`);
  if (r.tags.length) lines.push(`Tags: ${r.tags.slice(0, 40).join(', ')}`);
  if (r.exported.length) lines.push(`Exported: ${r.exported.join(', ')}`);
  if (r.saved) lines.push(`Saved: ${r.saved}`);
  return lines.join('\n');
}

/** What the window gets from sketchup:status. */
export interface SketchupStatusView {
  installs: { exe: string; year: number | null }[];
  /** The SketchUp Zinarix uses (picked, ZINARIX_SKETCHUP, or the newest installed). */
  active: { exe: string; year: number | null } | null;
  extension: { installed: boolean; outdated: boolean; path: string | null };
  /** SketchUp is open with the extension (it answered in the last seconds). */
  connected: boolean;
  running?: { version: string; model: string; title: string };
  bridgeDir: string;
}

export interface SkpInfoView {
  path: string;
  size: number;
  version: string | null;
  label: string;
  thumbnail: Uint8Array | null;
  width: number;
  height: number;
}

export interface SketchupRunView {
  ok: boolean;
  error?: string;
  report?: SketchupReport;
  shot?: Uint8Array;
}
