/**
 * Fase 7: triangle meshes without three.js, shared by main (agent tools, CAD) and the renderer
 * (model viewer). A mesh is a flat Float32Array, 9 numbers per triangle (x y z of 3 corners).
 * STL and OpenSCAD are Z-up and in millimetres; glTF / Blender are Y-up / Z-up in metres.
 */

export type Tris = Float32Array;

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

const td = new TextDecoder();

/** Binary or ASCII STL. ASCII files may start with "solid" too, so it checks the size. */
export function parseStl(data: Uint8Array): Tris {
  if (data.length >= 84) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === data.length) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return out;
    }
  }
  const text = td.decode(data);
  if (!/^\s*solid/i.test(text)) throw new Error('No es un archivo STL válido.');
  const nums: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (nums.length % 9 || nums.some((v) => !Number.isFinite(v)))
    throw new Error('El STL tiene vértices dañados.');
  return Float32Array.from(nums);
}

/** OBJ faces (polygons become fans). Negative indices count from the end, as the spec says. */
export function parseObj(text: string): Tris {
  const v: number[] = [];
  const out: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.slice(2).trim().split(/\s+/).map(Number);
      v.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    } else if (line.startsWith('f ')) {
      const n = v.length / 3;
      const idx = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((t) => {
          const i = parseInt(t.split('/')[0]!, 10);
          return i < 0 ? n + i : i - 1;
        });
      if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) continue;
      for (let k = 1; k + 1 < idx.length; k++)
        for (const i of [idx[0]!, idx[k]!, idx[k + 1]!])
          out.push(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!);
    }
  }
  return Float32Array.from(out);
}

/** OFF (what OpenSCAD writes with -o x.off): polygons become fans. */
export function parseOff(text: string): Tris {
  const tok = text.replace(/#.*$/gm, '').split(/\s+/).filter(Boolean);
  let i = 0;
  if (/^OFF$/i.test(tok[0] ?? '')) i++;
  const nv = Number(tok[i++]);
  const nf = Number(tok[i++]);
  i++;
  if (!Number.isInteger(nv) || !Number.isInteger(nf))
    throw new Error('No es un archivo OFF válido.');
  const v = tok.slice(i, i + nv * 3).map(Number);
  i += nv * 3;
  const out: number[] = [];
  for (let f = 0; f < nf; f++) {
    const k = Number(tok[i++]);
    const idx = tok.slice(i, i + k).map(Number);
    i += k;
    for (let j = 1; j + 1 < idx.length; j++)
      for (const t of [idx[0]!, idx[j]!, idx[j + 1]!])
        out.push(v[t * 3]!, v[t * 3 + 1]!, v[t * 3 + 2]!);
  }
  return Float32Array.from(out);
}

/** Binary STL (what slicers like best). */
export function writeStl(tris: Tris, header = 'Zinarix Studio'): Uint8Array {
  const n = Math.floor(tris.length / 9);
  const buf = new Uint8Array(84 + n * 50);
  const dv = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode(header.slice(0, 79)), 0);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const nn = normalOf(tris, i);
    dv.setFloat32(o, nn[0], true);
    dv.setFloat32(o + 4, nn[1], true);
    dv.setFloat32(o + 8, nn[2], true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tris[i * 9 + k]!, true);
  }
  return buf;
}

function normalOf(t: Tris, i: number): [number, number, number] {
  const o = i * 9;
  const ux = t[o + 3]! - t[o]!,
    uy = t[o + 4]! - t[o + 1]!,
    uz = t[o + 5]! - t[o + 2]!;
  const vx = t[o + 6]! - t[o]!,
    vy = t[o + 7]! - t[o + 1]!,
    vz = t[o + 8]! - t[o + 2]!;
  const x = uy * vz - uz * vy,
    y = uz * vx - ux * vz,
    z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

export function boundsOf(t: Tris): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = t[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  if (!t.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Multiplies every coordinate (mm ⇄ m) in place-free fashion. */
export function scaleTris(t: Tris, k: number): Tris {
  return t.map((v) => v * k);
}

/** Y-up (glTF) -> Z-up (STL): (x, y, z) -> (x, -z, y). */
export function yUpToZUp(t: Tris): Tris {
  const o = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    o[i] = t[i]!;
    o[i + 1] = -t[i + 2]!;
    o[i + 2] = t[i + 1]!;
  }
  return o;
}

export interface MeshReport {
  triangles: number;
  vertices: number;
  bounds: Bounds;
  /** mm³ when the mesh is in mm; negative = the normals point inwards. */
  volume: number;
  area: number;
  /** Edges with one face: holes, the mesh is not watertight. */
  openEdges: number;
  /** Edges shared by 3 or more faces. */
  nonManifoldEdges: number;
  /** Edges whose two faces disagree on which side is outside. */
  flippedEdges: number;
  degenerate: number;
  /** Separate pieces. */
  shells: number;
  watertight: boolean;
}

/** Topology and size of a mesh. Corners closer than `weld` count as the same vertex. */
export function analyzeMesh(t: Tris, weld = 1e-4): MeshReport {
  const n = Math.floor(t.length / 9);
  const ids = new Map<string, number>();
  const corner = new Int32Array(n * 3);
  const q = (v: number) => Math.round(v / weld);
  for (let i = 0; i < n * 3; i++) {
    const key = `${q(t[i * 3]!)},${q(t[i * 3 + 1]!)},${q(t[i * 3 + 2]!)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    corner[i] = id;
  }
  // Union-find over vertices for the number of pieces.
  const parent = Int32Array.from({ length: ids.size }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]!]!;
    return a;
  };
  const edges = new Map<number, { count: number; dir: number }>();
  let volume = 0;
  let area = 0;
  let degenerate = 0;
  const W = ids.size + 1;
  for (let i = 0; i < n; i++) {
    const a = corner[i * 3]!,
      b = corner[i * 3 + 1]!,
      c = corner[i * 3 + 2]!;
    const o = i * 9;
    const ax = t[o]!,
      ay = t[o + 1]!,
      az = t[o + 2]!;
    const bx = t[o + 3]!,
      by = t[o + 4]!,
      bz = t[o + 5]!;
    const cx = t[o + 6]!,
      cy = t[o + 7]!,
      cz = t[o + 8]!;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az,
      vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    const tri = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    area += tri;
    if (a === b || b === c || a === c || tri < 1e-12) {
      degenerate++;
      continue;
    }
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
    for (const [p, r] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = p < r ? p * W + r : r * W + p;
      const e = edges.get(key) ?? { count: 0, dir: 0 };
      e.count++;
      e.dir += p < r ? 1 : -1;
      edges.set(key, e);
    }
  }
  let openEdges = 0;
  let nonManifoldEdges = 0;
  let flippedEdges = 0;
  for (const e of edges.values()) {
    if (e.count === 1) openEdges++;
    else if (e.count > 2) nonManifoldEdges++;
    else if (e.dir !== 0) flippedEdges++;
  }
  const roots = new Set<number>();
  const used = new Set<number>();
  for (let i = 0; i < n * 3; i++) used.add(corner[i]!);
  for (const v of used) roots.add(find(v));
  return {
    triangles: n,
    vertices: ids.size,
    bounds: boundsOf(t),
    volume,
    area,
    openEdges,
    nonManifoldEdges,
    flippedEdges,
    degenerate,
    shells: roots.size,
    watertight: n > 0 && openEdges === 0 && nonManifoldEdges === 0 && flippedEdges === 0,
  };
}

export interface PrintCheck {
  ok: boolean;
  /** Problems that break a print. */
  errors: string[];
  /** Things to look at. */
  warnings: string[];
  /** Advice that changes nothing by itself. */
  notes: string[];
}

export interface PrintOptions {
  /** Printer build volume in mm (default 220 × 220 × 250, a common bed). */
  bed?: [number, number, number];
  /** Units of the mesh: 'mm' (STL, OpenSCAD) or 'm' (Blender, glTF). */
  units?: 'mm' | 'm';
  lang?: 'es' | 'en';
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

/** What a slicer would complain about, in plain words. */
export function checkPrint(r: MeshReport, o: PrintOptions = {}): PrintCheck {
  const es = (o.lang ?? 'es') === 'es';
  const bed = o.bed ?? [220, 220, 250];
  const k = o.units === 'm' ? 1000 : 1;
  const size = r.bounds.size.map((v) => v * k) as [number, number, number];
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  if (!r.triangles) errors.push(es ? 'El modelo está vacío.' : 'The model is empty.');
  if (r.openEdges)
    errors.push(
      es
        ? `Tiene ${r.openEdges} bordes abiertos: no está cerrado (hermético) y el laminador puede rellenarlo mal.`
        : `It has ${r.openEdges} open edges: it is not watertight and the slicer may fill it wrongly.`,
    );
  if (r.nonManifoldEdges)
    errors.push(
      es
        ? `Tiene ${r.nonManifoldEdges} bordes compartidos por 3 caras o más (no "manifold").`
        : `It has ${r.nonManifoldEdges} edges shared by 3 or more faces (non-manifold).`,
    );
  if (r.flippedEdges)
    warnings.push(
      es
        ? `Hay ${r.flippedEdges} bordes con caras volteadas (normales al revés).`
        : `${r.flippedEdges} edges have flipped faces (normals the wrong way).`,
    );
  if (r.triangles && r.volume < 0)
    warnings.push(
      es
        ? 'Las normales apuntan hacia adentro: el modelo está "al revés".'
        : 'The normals point inwards: the model is inside out.',
    );
  if (r.degenerate)
    notes.push(
      es
        ? `${r.degenerate} triángulos sin área (se ignoran al laminar).`
        : `${r.degenerate} triangles with no area (slicers skip them).`,
    );
  if (r.triangles) {
    const fits = (s: number[]) => s[0]! <= bed[0] && s[1]! <= bed[1] && s[2]! <= bed[2];
    const sorted = [...size].sort((a, b) => a - b);
    const bedSorted = [...bed].sort((a, b) => a - b);
    const dims = `${fmt(size[0])} × ${fmt(size[1])} × ${fmt(size[2])} mm`;
    if (!fits(size)) {
      if (sorted.every((v, i) => v <= bedSorted[i]!))
        warnings.push(
          es
            ? `Mide ${dims}: no cabe en la cama (${bed.join(' × ')} mm) en esta posición; girándolo sí cabe.`
            : `It measures ${dims}: it does not fit the bed (${bed.join(' × ')} mm) as placed; rotated it does.`,
        );
      else
        errors.push(
          es
            ? `Mide ${dims}: es más grande que la cama (${bed.join(' × ')} mm). Escálalo o pártelo en piezas.`
            : `It measures ${dims}: bigger than the bed (${bed.join(' × ')} mm). Scale it down or split it.`,
        );
    } else notes.push(es ? `Mide ${dims}.` : `It measures ${dims}.`);
    if (Math.max(...size) < 2)
      warnings.push(
        o.units !== 'm' && Math.max(...size) < 1
          ? es
            ? 'Mide menos de 1 mm: probablemente está en metros (Blender). Multiplica la escala por 1000.'
            : 'It is smaller than 1 mm: probably in metres (Blender). Scale it by 1000.'
          : es
            ? 'Es muy pequeño para imprimirlo bien.'
            : 'It is very small to print well.',
      );
    if (r.bounds.min[2] * k > 0.01 || r.bounds.min[2] * k < -0.01)
      notes.push(
        es
          ? `La base está en Z = ${fmt(r.bounds.min[2] * k)} mm; el laminador la bajará a la cama.`
          : `The base is at Z = ${fmt(r.bounds.min[2] * k)} mm; the slicer will drop it onto the bed.`,
      );
    if (r.shells > 1)
      notes.push(es ? `Son ${r.shells} piezas separadas.` : `It is ${r.shells} separate pieces.`);
    if (r.watertight && r.volume > 0)
      notes.push(
        es
          ? `Volumen ${fmt((r.volume * k ** 3) / 1000)} cm³ (≈ ${fmt(((r.volume * k ** 3) / 1000) * 1.24)} g de PLA macizo).`
          : `Volume ${fmt((r.volume * k ** 3) / 1000)} cm³ (≈ ${fmt(((r.volume * k ** 3) / 1000) * 1.24)} g of solid PLA).`,
      );
  }
  return { ok: !errors.length, errors, warnings, notes };
}

/** One paragraph for the agent and the panels. */
export function describeMesh(r: MeshReport, c: PrintCheck): string {
  const s = r.bounds.size;
  return [
    `${r.triangles} triangles, ${r.vertices} vertices, ${r.shells} piece(s); size ${s.map((v) => +v.toFixed(3)).join(' × ')}; ${r.watertight ? 'watertight' : 'NOT watertight'}.`,
    ...c.errors.map((e) => `ERROR: ${e}`),
    ...c.warnings.map((e) => `WARNING: ${e}`),
    ...c.notes,
  ].join('\n');
}
