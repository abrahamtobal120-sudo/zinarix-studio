/**
 * Fase 7: CAD with OpenSCAD (code -> model). Pure helpers shared by main and the window:
 * Customizer parameters, -D overrides, the log OpenSCAD prints, the files a model uses and the
 * starter templates. Units are millimetres, Z is up.
 */

export type ScadValue = number | string | boolean | number[];

export interface ScadParam {
  name: string;
  value: ScadValue;
  /** 'number' | 'string' | 'boolean' | 'vector' */
  type: 'number' | 'string' | 'boolean' | 'vector';
  /** Comment line just above it. */
  description?: string;
  /** /* [Group] *\/ it is in. */
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Dropdown: [value, label] pairs. */
  options?: { value: ScadValue; label: string }[];
  /** Max length of a string ("// 20"). */
  maxLength?: number;
  /** 1-based line of the assignment. */
  line: number;
}

const NAME = /^[A-Za-z_$][\w$]*$/;

/** A literal OpenSCAD value (number, "string", true/false, [numbers]); null for an expression. */
export function parseScadLiteral(src: string): ScadValue | null {
  const s = src.trim();
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  const str = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
  if (str)
    return str[1]!.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  const vec = /^\[([^\[\]]*)\]$/.exec(s);
  if (vec) {
    const parts = vec[1]!.split(',').map((p) => p.trim());
    if (parts.length === 1 && !parts[0]) return [];
    const nums = parts.map((p) => (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(p) ? Number(p) : NaN));
    return nums.every(Number.isFinite) ? nums : null;
  }
  return null;
}

/** OpenSCAD source text of a value. */
export function scadLiteral(v: ScadValue): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(+v.toPrecision(12)) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.map((n) => scadLiteral(n)).join(', ')}]`;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

const typeOf = (v: ScadValue): ScadParam['type'] =>
  typeof v === 'number'
    ? 'number'
    : typeof v === 'boolean'
      ? 'boolean'
      : Array.isArray(v)
        ? 'vector'
        : 'string';

/** The bracket after an assignment: [max], [min:max], [min:step:max], [a, b, c] or [1:Uno, 2:Dos]. */
function applyHint(p: ScadParam, hint: string): void {
  const h = hint.trim();
  const range = /^\[\s*(-?[\d.]+)\s*(?::\s*(-?[\d.]+)\s*)?(?::\s*(-?[\d.]+)\s*)?\]$/.exec(h);
  if (range && p.type === 'number') {
    const a = Number(range[1]),
      b = range[2] !== undefined ? Number(range[2]) : undefined;
    const c = range[3] !== undefined ? Number(range[3]) : undefined;
    if (b === undefined) {
      p.min = 0;
      p.max = a;
    } else if (c === undefined) {
      p.min = a;
      p.max = b;
    } else {
      p.min = a;
      p.step = b;
      p.max = c;
    }
    return;
  }
  const list = /^\[(.*)\]$/.exec(h);
  if (list) {
    const opts = list[1]!
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => {
        const m = /^("(?:[^"\\]|\\.)*"|[^:]+?)\s*:\s*(.+)$/.exec(o);
        const raw = m ? m[1]! : o;
        const label = m ? m[2]!.trim() : o.replace(/^"|"$/g, '');
        const lit = parseScadLiteral(raw);
        const value: ScadValue =
          p.type === 'number'
            ? Number(raw)
            : typeof lit === 'string'
              ? lit
              : raw.replace(/^"|"$/g, '');
        return { value, label };
      })
      .filter((o) => p.type !== 'number' || Number.isFinite(o.value as number));
    if (opts.length) p.options = opts;
    return;
  }
  const len = /^(\d+)$/.exec(h);
  if (len && p.type === 'string') p.maxLength = Number(len[1]);
}

/**
 * The Customizer parameters: top-level assignments of a literal before the first module or
 * function, as OpenSCAD shows them. /* [Hidden] *\/ hides what follows.
 */
export function parseScadParams(code: string): ScadParam[] {
  const out: ScadParam[] = [];
  const lines = code.split(/\r?\n/);
  let group: string | undefined;
  let comment: string | undefined;
  let depth = 0;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const g = /^\s*\/\*\s*\[([^\]]+)\]\s*\*\/\s*$/.exec(line);
    if (g) {
      group = g[1]!.trim();
      comment = undefined;
      continue;
    }
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
      inBlock = true;
      continue;
    }
    if (depth === 0 && /^\s*(module|function)\b/.test(line)) break;
    const c = /^\s*\/\/\s?(.*)$/.exec(line);
    if (c) {
      comment = c[1]!.trim() || undefined;
      continue;
    }
    const a =
      depth === 0 ? /^\s*([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;\s*(?:\/\/\s*(.*))?$/.exec(line) : null;
    if (a && !a[1]!.startsWith('$') && group?.toLowerCase() !== 'hidden') {
      const value = parseScadLiteral(a[2]!);
      if (value !== null) {
        const p: ScadParam = { name: a[1]!, value, type: typeOf(value), line: i + 1 };
        if (comment) p.description = comment;
        if (group) p.group = group;
        if (a[3]) applyHint(p, a[3]);
        out.push(p);
      }
    }
    comment = undefined;
    for (const ch of line.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/\/\/.*$/, '')) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  return out;
}

/** -D arguments for overrides; unknown names and bad values are dropped (never sent as code). */
export function scadDefines(params: ScadParam[], values: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const p of params) {
    if (!(p.name in values)) continue;
    const v = coerceParam(p, values[p.name]);
    if (v === null) continue;
    out.push('-D', `${p.name}=${scadLiteral(v)}`);
  }
  return out;
}

/** A value for this parameter, or null when it is the wrong kind. Numbers are clamped to the range. */
export function coerceParam(p: ScadParam, v: unknown): ScadValue | null {
  if (!NAME.test(p.name)) return null;
  if (p.type === 'number') {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    let x = n;
    if (p.min !== undefined) x = Math.max(p.min, x);
    if (p.max !== undefined) x = Math.min(p.max, x);
    return x;
  }
  if (p.type === 'boolean')
    return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;
  if (p.type === 'vector') {
    if (!Array.isArray(v) || !v.every((n) => typeof n === 'number' && Number.isFinite(n)))
      return null;
    return v as number[];
  }
  if (typeof v !== 'string') return null;
  return p.maxLength ? v.slice(0, p.maxLength) : v.slice(0, 500);
}

/** Writes a new value into the assignment line, keeping its comment. */
export function setScadParam(code: string, p: ScadParam, value: ScadValue): string {
  const nl = code.includes('\r\n') ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);
  const i = p.line - 1;
  const line = lines[i];
  if (line === undefined) return code;
  const m = /^(\s*[A-Za-z_$][\w$]*\s*=\s*)(.+?)(\s*;.*)$/.exec(line);
  if (!m) return code;
  lines[i] = m[1] + scadLiteral(value) + m[3];
  return lines.join(nl);
}

export interface ScadMessage {
  severity: 'error' | 'warning' | 'echo' | 'trace';
  message: string;
  /** As OpenSCAD printed it. */
  file?: string;
  line?: number;
}

export interface ScadLog {
  messages: ScadMessage[];
  /** "Top level object is a 3D object (manifold)" etc. */
  dimension?: '2d' | '3d' | 'empty';
  /** OpenSCAD's own check (Simple: yes / manifold). */
  manifold?: boolean;
  /** Seconds, from "Total rendering time". */
  seconds?: number;
}

/** What OpenSCAD wrote to stderr: errors and warnings with file and line, echo() lines. */
export function parseScadLog(log: string): ScadLog {
  const out: ScadLog = { messages: [] };
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim();
    const m =
      /^(ERROR|WARNING|DEPRECATED|ECHO|TRACE|UI-WARNING|FONT-WARNING|EXPORT-ERROR|EXPORT-WARNING):\s?(.*)$/.exec(
        line,
      );
    if (m) {
      const kind = m[1]!;
      let message = m[2]!;
      let file: string | undefined;
      let ln: number | undefined;
      const loc = /,?\s*in file\s+"?([^",]+?)"?\s*,\s*line\s+(\d+)\s*:?/.exec(message);
      if (loc) {
        file = loc[1];
        ln = Number(loc[2]);
        message = (message.slice(0, loc.index) + ' ' + message.slice(loc.index + loc[0].length))
          .replace(/\s{2,}/g, ' ')
          .trim();
      } else {
        const at = /\s+at line\s+(\d+)\s*$/.exec(message);
        if (at) ln = Number(at[1]);
      }
      const severity: ScadMessage['severity'] = /ERROR/.test(kind)
        ? 'error'
        : kind === 'ECHO'
          ? 'echo'
          : kind === 'TRACE'
            ? 'trace'
            : 'warning';
      out.messages.push({
        severity,
        message: message.replace(/:\s*$/, ''),
        ...(file && { file }),
        ...(ln && { line: ln }),
      });
      continue;
    }
    if (/Current top level object is empty|Top level object is empty/i.test(line))
      out.dimension = 'empty';
    const top = /Top level object is a (2D|3D) object(?:\s*\(([^)]+)\))?/i.exec(line);
    if (top) {
      out.dimension = top[1]!.toLowerCase() as '2d' | '3d';
      if (top[2])
        out.manifold = /manifold/i.test(top[2]) && !/non/i.test(top[2]) ? true : out.manifold;
    }
    const simple = /^Simple:\s*(yes|no)/i.exec(line);
    if (simple) out.manifold = simple[1]!.toLowerCase() === 'yes';
    const t = /Total rendering time:\s*(\d+):(\d+):([\d.]+)/.exec(line);
    if (t) out.seconds = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
  }
  return out;
}

/** Files a model reads (include <a>, use <b>, import("c"), surface(file="d")), as written. */
export function scadDependencies(code: string): string[] {
  const out = new Set<string>();
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const m of clean.matchAll(/\b(?:include|use)\s*<([^>]+)>/g)) out.add(m[1]!.trim());
  for (const m of clean.matchAll(/\bimport\s*\(\s*(?:file\s*=\s*)?"([^"]+)"/g)) out.add(m[1]!);
  for (const m of clean.matchAll(/\bsurface\s*\(\s*(?:file\s*=\s*)?"([^"]+)"/g)) out.add(m[1]!);
  return [...out];
}

export type CadFormat = 'stl' | '3mf' | 'obj' | 'off' | 'amf';
export const CAD_FORMATS: readonly CadFormat[] = ['stl', '3mf', 'obj', 'off', 'amf'];

export interface CadTemplate {
  id: string;
  es: string;
  en: string;
  code: string;
}

const BOX = `// Caja con tapa (mm). Cambia los valores en el panel de parámetros.

/* [Medidas (mm)] */
// Ancho por dentro
ancho = 60; // [20:1:200]
// Largo por dentro
largo = 40; // [20:1:200]
// Alto por dentro
alto = 30; // [10:1:150]
// Grosor de la pared
pared = 2; // [1:0.2:5]
// Radio de las esquinas
radio = 3; // [0:0.5:10]

/* [Tapa] */
con_tapa = true;
// Holgura entre la caja y la tapa
holgura = 0.3; // [0:0.05:1]

/* [Hidden] */
$fn = 48;

module redondeado(x, y, z, r) {
  if (r <= 0) cube([x, y, z]);
  else hull() for (i = [r, x - r], j = [r, y - r]) translate([i, j, 0]) cylinder(r = r, h = z);
}

difference() {
  redondeado(ancho + 2 * pared, largo + 2 * pared, alto + pared, radio + pared);
  translate([pared, pared, pared]) redondeado(ancho, largo, alto + 1, radio);
}

if (con_tapa)
  translate([ancho + 2 * pared + 10, 0, 0]) {
    redondeado(ancho + 2 * pared, largo + 2 * pared, pared, radio + pared);
    translate([pared + holgura, pared + holgura, pared])
      difference() {
        redondeado(ancho - 2 * holgura, largo - 2 * holgura, 4, max(radio - holgura, 0));
        translate([pared, pared, -1])
          redondeado(ancho - 2 * holgura - 2 * pared, largo - 2 * holgura - 2 * pared, 6, max(radio - pared, 0));
      }
  }
`;

const KEYCHAIN = `// Llavero con texto (mm).

/* [Texto] */
texto = "ZINARIX"; // 14
// Tamaño de las letras
tamano = 8; // [4:0.5:20]
fuente = "Liberation Sans:style=Bold";

/* [Placa] */
grosor = 3; // [1:0.5:8]
// Cuánto sobresalen las letras
relieve = 1.5; // [0.5:0.5:4]
// Diámetro del agujero de la argolla
agujero = 4; // [2:0.5:8]

/* [Hidden] */
$fn = 40;
largo = len(texto) * tamano * 0.78 + tamano + agujero * 2;
alto_placa = tamano * 1.9;

linear_extrude(grosor)
  difference() {
    offset(r = 3) translate([3, 3]) square([largo - 6, alto_placa - 6]);
    translate([agujero * 1.2, alto_placa / 2]) circle(d = agujero);
  }
translate([agujero * 2.2 + (largo - agujero * 2.2) / 2, alto_placa / 2, 0])
  linear_extrude(grosor + relieve)
    text(texto, size = tamano, font = fuente, halign = "center", valign = "center");
`;

const STAND = `// Soporte para celular (mm).

/* [Medidas (mm)] */
// Ancho del soporte
ancho = 70; // [30:1:140]
// Inclinación del respaldo
angulo = 65; // [45:1:85]
// Grosor del celular con funda
celular = 12; // [6:0.5:25]
// Alto del respaldo
respaldo = 80; // [40:1:150]
// Fondo de la base
base = 90; // [50:1:160]
espesor = 4; // [2:0.5:8]
// Alto del tope delantero
tope = 10; // [4:1:30]

rotate([90, 0, 0])
  linear_extrude(ancho, center = true)
    union() {
      square([base, espesor]);
      square([espesor, espesor + tope]);
      hull() {
        translate([espesor + celular, 0]) rotate(angulo - 90) square([espesor, respaldo]);
        translate([espesor + celular, 0]) square([base - espesor - celular, espesor]);
      }
    }
`;

const GEAR = `// Engranaje recto sencillo (mm). Para piezas exactas usa una librería de engranajes.

/* [Engranaje] */
dientes = 20; // [6:1:80]
// Módulo (tamaño del diente)
modulo = 2; // [0.5:0.25:5]
grosor = 6; // [1:0.5:30]
// Diámetro del eje
eje = 5; // [0:0.5:30]

/* [Hidden] */
$fn = 64;
r = modulo * dientes / 2;
ra = r + modulo;
rf = r - 1.25 * modulo;
hr = 90 / dientes * 1.25;
ht = 90 / dientes * 0.55;

linear_extrude(grosor)
  difference() {
    union() {
      circle(r = rf + 0.01);
      for (i = [0 : dientes - 1])
        rotate(i * 360 / dientes)
          polygon([
            [rf * cos(-hr), rf * sin(-hr)], [ra * cos(-ht), ra * sin(-ht)],
            [ra * cos(ht), ra * sin(ht)], [rf * cos(hr), rf * sin(hr)]
          ]);
    }
    if (eje > 0) circle(d = eje);
  }
`;

const PLANTER = `// Maceta (mm). Con 6 lados es hexagonal; con 64 es redonda.

/* [Medidas (mm)] */
arriba = 80; // [30:1:200]
abajo = 60; // [20:1:200]
alto = 70; // [20:1:200]
pared = 2; // [1:0.2:5]
// Agujero de drenaje (0 = sin agujero)
drenaje = 8; // [0:1:20]
// Lados
lados = 6; // [3:1:64]

difference() {
  cylinder(h = alto, d1 = abajo, d2 = arriba, $fn = lados);
  translate([0, 0, pared])
    cylinder(h = alto, d1 = abajo - 2 * pared, d2 = arriba - 2 * pared + (arriba - abajo) * pared / alto, $fn = lados);
  if (drenaje > 0) translate([0, 0, -1]) cylinder(d = drenaje, h = pared + 2, $fn = 32);
}
`;

const PLATE = `// Placa de montaje con agujeros (mm).

/* [Placa] */
largo = 80; // [20:1:250]
ancho = 20; // [8:1:100]
grosor = 3; // [1:0.5:10]

/* [Agujeros] */
agujeros = 3; // [1:1:10]
diametro = 4; // [2:0.5:10]
// Agujeros avellanados para tornillos de cabeza plana
avellanado = true;

/* [Hidden] */
$fn = 40;
paso = agujeros > 1 ? (largo - ancho) / (agujeros - 1) : 0;

difference() {
  hull() {
    translate([ancho / 2, ancho / 2, 0]) cylinder(d = ancho, h = grosor);
    translate([largo - ancho / 2, ancho / 2, 0]) cylinder(d = ancho, h = grosor);
  }
  for (i = [0 : agujeros - 1])
    translate([agujeros > 1 ? ancho / 2 + i * paso : largo / 2, ancho / 2, -1]) {
      cylinder(d = diametro, h = grosor + 2);
      if (avellanado) translate([0, 0, grosor + 1 - diametro / 2]) cylinder(d1 = diametro, d2 = diametro * 2, h = diametro / 2 + 0.01);
    }
}
`;

const BLANK = `// Mi modelo (mm). Z es hacia arriba.
// Ayuda rápida: cube([x, y, z]); sphere(r); cylinder(h, r); translate([x, y, z]) ...;
// difference() { a(); b(); } resta b de a; union() junta; hull() envuelve.

/* [Medidas] */
lado = 20; // [5:1:100]

difference() {
  cube(lado, center = true);
  sphere(r = lado * 0.65, $fn = 64);
}
`;

export const CAD_TEMPLATES: readonly CadTemplate[] = [
  { id: 'caja', es: 'Caja con tapa', en: 'Box with lid', code: BOX },
  { id: 'llavero', es: 'Llavero con texto', en: 'Keychain with text', code: KEYCHAIN },
  { id: 'soporte', es: 'Soporte para celular', en: 'Phone stand', code: STAND },
  { id: 'engranaje', es: 'Engranaje', en: 'Gear', code: GEAR },
  { id: 'maceta', es: 'Maceta', en: 'Planter', code: PLANTER },
  { id: 'placa', es: 'Placa con agujeros', en: 'Mounting plate', code: PLATE },
  { id: 'vacio', es: 'En blanco', en: 'Blank', code: BLANK },
];

export const isScadPath = (p: string) => /\.scad$/i.test(p);
/** Meshes the model viewer opens. */
export const isMeshPath = (p: string) => /\.(stl|obj|off|glb|gltf|3mf|ply|fbx)$/i.test(p);

/** What the window gets from cad:engines. */
export interface CadEnginesView {
  native: { path: string; version: string; manifold: boolean } | null;
  builtin: boolean;
  /** Blender version for "open in Blender" / blender_* tools; null = not installed. */
  blender: string | null;
}

/** What the window gets from cad:render (binary STL on success). */
export type CadRenderView =
  | {
      ok: true;
      stl: Uint8Array;
      engine: 'native' | 'builtin';
      ms: number;
      messages: ScadMessage[];
      params: ScadParam[];
    }
  | { ok: false; error: string; messages: ScadMessage[]; params: ScadParam[]; cancelled?: boolean };
