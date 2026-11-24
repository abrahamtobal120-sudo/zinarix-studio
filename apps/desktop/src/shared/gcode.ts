/**
 * Fase 7 (mejora): reading G-code for the viewer and the AI. Turns the moves into line
 * segments (extrusion and travel), grouped by layer, plus what the slicer wrote in its
 * comments (time, filament) and an own estimate when it wrote nothing.
 * Handles G0/G1, G2/G3 arcs, G90/G91, M82/M83, G92, G20/G21 and G28.
 */

export interface GcodeLayer {
  z: number;
  /** Extrusion segments [start, end) of this layer (index in segments, not floats). */
  e0: number;
  e1: number;
  t0: number;
  t1: number;
}

export interface GcodeStats {
  layers: number;
  /** Extruded area in mm: [min x, min y, min z, max x, max y, max z]. */
  bounds: [number, number, number, number, number, number] | null;
  /** Net filament pushed, in mm (from the E moves). */
  filamentMm: number;
  /** Own estimate: path length / feed rate (no acceleration), in seconds. */
  estimateS: number;
  /** What the slicer wrote, when it did. */
  slicer?: string;
  slicerTimeS?: number;
  slicerFilamentG?: number;
  slicerFilamentMm?: number;
  layerHeight?: number;
  nozzleTemp?: number;
  bedTemp?: number;
  /** PrusaSlicer binary G-code (.bgcode) cannot be read: only the header. */
  binary?: boolean;
  lines: number;
  /** The file had more moves than the viewer keeps; the rest were not read. */
  truncated: boolean;
}

export interface GcodeParsed {
  /** Extrusion segments: x0 y0 z0 x1 y1 z1 per segment. */
  extrude: Float32Array;
  travel: Float32Array;
  layers: GcodeLayer[];
  stats: GcodeStats;
}

/** "1h 2m 3s", "2d 1h", "6m 36s", "45s" -> seconds. */
export function parseDuration(s: string): number | undefined {
  let t = 0;
  let any = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) {
    any = true;
    const v = Number(m[1]);
    t += v * ({ d: 86400, h: 3600, m: 60, s: 1 } as Record<string, number>)[m[2]!.toLowerCase()]!;
  }
  return any ? t : undefined;
}

export function formatDuration(sec: number, lang: 'es' | 'en' = 'es'): string {
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} ${lang === 'en' ? 'd' : 'd'} ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min${s % 60 && m < 10 ? ` ${s % 60} s` : ''}`;
  return `${s} s`;
}

/** Grams of filament: length (mm) × section × density (PLA 1.24 g/cm³). */
export function filamentGrams(mm: number, diameter = 1.75, density = 1.24): number {
  return (mm * Math.PI * (diameter / 2) ** 2 * density) / 1000;
}

/** Comments the slicers leave (PrusaSlicer / SuperSlicer / Orca / Bambu / Cura / Simplify3D). */
function readComment(c: string, st: GcodeStats): void {
  let m: RegExpExecArray | null;
  if (!st.slicer && (m = /generated (?:by|with) ([A-Za-z][\w .-]*?\d[\w.]*)/i.exec(c)))
    st.slicer = m[1]!.trim();
  else if (!st.slicer && (m = /^FLAVOR:/i.exec(c))) st.slicer = 'Cura';
  if (
    (m = /estimated printing time(?: \(normal mode\))?\s*=\s*(.+)$/i.exec(c)) ||
    (m = /total estimated time:\s*([^;]+)/i.exec(c)) ||
    (m = /model printing time:\s*([^;]+)/i.exec(c))
  ) {
    if (st.slicerTimeS === undefined) st.slicerTimeS = parseDuration(m[1]!);
  } else if ((m = /^TIME:\s*(\d+)/.exec(c))) st.slicerTimeS = Number(m[1]);
  else if ((m = /Build time:\s*(.+)$/i.exec(c)))
    st.slicerTimeS ??= parseDuration(m[1]!.replace(/hours?/i, 'h').replace(/minutes?/i, 'm'));
  if (
    (m = /total filament used \[g\]\s*=\s*([\d.]+)/i.exec(c)) ||
    (m = /filament used \[g\]\s*=\s*([\d.]+)/i.exec(c))
  ) {
    const g = Number(m[1]);
    if (g > 0) st.slicerFilamentG = g;
  }
  if ((m = /filament used \[mm\]\s*=\s*([\d.]+)/i.exec(c))) st.slicerFilamentMm = Number(m[1]);
  else if ((m = /^Filament used:\s*([\d.]+)m/i.exec(c))) st.slicerFilamentMm = Number(m[1]) * 1000;
  if ((m = /^\s*layer_height\s*=\s*([\d.]+)/.exec(c)) || (m = /^Layer height:\s*([\d.]+)/i.exec(c)))
    st.layerHeight ??= Number(m[1]);
}

const NUM = /([A-Z])\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;

export interface ParseOptions {
  /** Most segments kept (each kind); 4 million by default. */
  maxSegments?: number;
}

/** Reads G-code text. Never throws on odd lines: unknown commands are skipped. */
export function parseGcode(text: string, opts: ParseOptions = {}): GcodeParsed {
  const max = opts.maxSegments ?? 4_000_000;
  const stats: GcodeStats = {
    layers: 0,
    bounds: null,
    filamentMm: 0,
    estimateS: 0,
    lines: 0,
    truncated: false,
  };
  if (text.startsWith('GCDE')) {
    stats.binary = true;
    return { extrude: new Float32Array(0), travel: new Float32Array(0), layers: [], stats };
  }
  let ex = new Float32Array(Math.min(max, 65536) * 6);
  let tr = new Float32Array(Math.min(max, 65536) * 6);
  let ne = 0;
  let nt = 0;
  const push = (
    which: 'e' | 't',
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ) => {
    if (which === 'e') {
      if (ne >= max) return void (stats.truncated = true);
      if ((ne + 1) * 6 > ex.length) {
        const n = new Float32Array(Math.min(max * 6, ex.length * 2));
        n.set(ex);
        ex = n;
      }
      const i = ne * 6;
      ex[i] = a;
      ex[i + 1] = b;
      ex[i + 2] = c;
      ex[i + 3] = d;
      ex[i + 4] = e;
      ex[i + 5] = f;
      ne++;
    } else {
      if (nt >= max) return void (stats.truncated = true);
      if ((nt + 1) * 6 > tr.length) {
        const n = new Float32Array(Math.min(max * 6, tr.length * 2));
        n.set(tr);
        tr = n;
      }
      const i = nt * 6;
      tr[i] = a;
      tr[i + 1] = b;
      tr[i + 2] = c;
      tr[i + 3] = d;
      tr[i + 4] = e;
      tr[i + 5] = f;
      nt++;
    }
  };
  const layers: GcodeLayer[] = [];
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let feed = 1500; // mm/min
  let absXYZ = true;
  let absE = true;
  let scale = 1; // G20 inches
  let layerZ = Number.NaN;
  const obj = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const all = [...obj];
  let custom = false;
  const startLayer = (zz: number) => {
    const last = layers[layers.length - 1];
    if (last) {
      last.e1 = ne;
      last.t1 = nt;
    }
    layers.push({ z: zz, e0: ne, e1: ne, t0: nt, t1: nt });
    layerZ = zz;
  };
  const seg = (nx: number, ny: number, nz: number, extruding: boolean) => {
    const d = Math.hypot(nx - x, ny - y, nz - z);
    if (d > 0) stats.estimateS += (d / Math.max(feed, 1)) * 60;
    if (extruding) {
      // 0.04 mm: thinner than any real layer, so a spiral (vase mode) does not make one per move.
      if (!(Math.abs(nz - layerZ) < 0.04)) startLayer(nz);
      push('e', x, y, z, nx, ny, nz);
      // The start / end G-code (purge line) is not part of the object's size.
      const b = custom ? all : obj;
      if (nx < b[0]!) b[0] = nx;
      if (ny < b[1]!) b[1] = ny;
      if (nz < b[2]!) b[2] = nz;
      if (nx > b[3]!) b[3] = nx;
      if (ny > b[4]!) b[4] = ny;
      if (nz > b[5]!) b[5] = nz;
      if (x < b[0]!) b[0] = x;
      if (y < b[1]!) b[1] = y;
      if (x > b[3]!) b[3] = x;
      if (y > b[4]!) b[4] = y;
    } else if (d > 0 && layers.length) push('t', x, y, z, nx, ny, nz);
    x = nx;
    y = ny;
    z = nz;
  };
  let pos = 0;
  const len = text.length;
  while (pos < len) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = len;
    let line = text.slice(pos, nl);
    pos = nl + 1;
    stats.lines++;
    const semi = line.indexOf(';');
    if (semi >= 0) {
      const c = line.slice(semi + 1).trim();
      if (c) {
        readComment(c, stats);
        // PrusaSlicer / Orca mark their start and end G-code as ;TYPE:Custom.
        if (c.startsWith('TYPE:')) custom = /^TYPE:Custom/i.test(c);
      }
      line = line.slice(0, semi);
    }
    line = line.trim().toUpperCase();
    if (!line) continue;
    // N123 line numbers and *checksums.
    if (line.charCodeAt(0) === 78 /* N */) line = line.replace(/^N\d+\s*/, '');
    const star = line.indexOf('*');
    if (star >= 0) line = line.slice(0, star);
    const cmd = /^([GMT])(\d+)(?:\.\d+)?/.exec(line);
    if (!cmd) continue;
    const code = cmd[1]! + cmd[2]!;
    const w: Record<string, number> = {};
    NUM.lastIndex = cmd[0].length;
    for (let m = NUM.exec(line); m; m = NUM.exec(line)) w[m[1]!] = Number(m[2]);
    switch (code) {
      case 'G0':
      case 'G1':
      case 'G2':
      case 'G3': {
        if (w.F !== undefined && w.F > 0) feed = w.F * scale;
        const nx = w.X !== undefined ? (absXYZ ? w.X * scale : x + w.X * scale) : x;
        const ny = w.Y !== undefined ? (absXYZ ? w.Y * scale : y + w.Y * scale) : y;
        const nz = w.Z !== undefined ? (absXYZ ? w.Z * scale : z + w.Z * scale) : z;
        let de = 0;
        if (w.E !== undefined) {
          de = absE ? w.E * scale - e : w.E * scale;
          e = absE ? w.E * scale : e + w.E * scale;
        }
        const extruding = de > 1e-6 && (nx !== x || ny !== y);
        // Net: a retraction and its unretraction cancel out.
        stats.filamentMm += de;
        if (code === 'G0' || code === 'G1') {
          seg(nx, ny, nz, extruding);
          break;
        }
        // Arc: centre from I J (relative to the start) or R; split in ~1 mm pieces.
        let cx: number;
        let cy: number;
        const cw = code === 'G2';
        if (w.I !== undefined || w.J !== undefined) {
          cx = x + (w.I ?? 0) * scale;
          cy = y + (w.J ?? 0) * scale;
        } else if (w.R !== undefined) {
          const r = w.R * scale;
          const mx = (x + nx) / 2;
          const my = (y + ny) / 2;
          const dx = nx - x;
          const dy = ny - y;
          const q = Math.hypot(dx, dy);
          const h = Math.sqrt(Math.max(0, r * r - (q / 2) ** 2));
          const sgn = (cw ? 1 : -1) * (r > 0 ? 1 : -1);
          cx = mx + (sgn * h * dy) / (q || 1);
          cy = my - (sgn * h * dx) / (q || 1);
        } else {
          seg(nx, ny, nz, extruding);
          break;
        }
        const r = Math.hypot(x - cx, y - cy);
        const a0 = Math.atan2(y - cy, x - cx);
        let a1 = Math.atan2(ny - cy, nx - cx);
        if (cw && a1 >= a0) a1 -= 2 * Math.PI;
        if (!cw && a1 <= a0) a1 += 2 * Math.PI;
        const sweep = a1 - a0;
        const n = Math.max(2, Math.min(256, Math.ceil((Math.abs(sweep) * r) / 1)));
        const z0 = z;
        for (let i = 1; i <= n; i++) {
          const a = a0 + (sweep * i) / n;
          seg(
            i === n ? nx : cx + r * Math.cos(a),
            i === n ? ny : cy + r * Math.sin(a),
            z0 + ((nz - z0) * i) / n,
            extruding,
          );
        }
        break;
      }
      case 'G4':
        stats.estimateS += (w.S ?? 0) + (w.P ?? 0) / 1000;
        break;
      case 'G20':
        scale = 25.4;
        break;
      case 'G21':
        scale = 1;
        break;
      case 'G28':
        if (w.X === undefined && w.Y === undefined && w.Z === undefined) x = y = z = 0;
        else {
          if (w.X !== undefined) x = 0;
          if (w.Y !== undefined) y = 0;
          if (w.Z !== undefined) z = 0;
        }
        break;
      case 'G90':
        absXYZ = true;
        absE = true;
        break;
      case 'G91':
        absXYZ = false;
        absE = false;
        break;
      case 'M82':
        absE = true;
        break;
      case 'M83':
        absE = false;
        break;
      case 'G92':
        if (w.E !== undefined) e = w.E * scale;
        if (w.X !== undefined) x = w.X * scale;
        if (w.Y !== undefined) y = w.Y * scale;
        if (w.Z !== undefined) z = w.Z * scale;
        break;
      case 'M104':
      case 'M109':
        if (w.S !== undefined && w.S > 0) stats.nozzleTemp = Math.max(stats.nozzleTemp ?? 0, w.S);
        break;
      case 'M140':
      case 'M190':
        if (w.S !== undefined && w.S > 0) stats.bedTemp = Math.max(stats.bedTemp ?? 0, w.S);
        break;
    }
  }
  const last = layers[layers.length - 1];
  if (last) {
    last.e1 = ne;
    last.t1 = nt;
  }
  // Same-height pieces (a Z hop and back) merge into one layer.
  const merged: GcodeLayer[] = [];
  for (const l of layers) {
    const p = merged[merged.length - 1];
    // A purge line drawn higher than the first real layer belongs to that layer.
    const purge = merged.length === 1 && p && l.z < p.z - 1e-4;
    if (purge) p.z = l.z;
    if (p && (purge || Math.abs(p.z - l.z) < 1e-4)) {
      p.e1 = l.e1;
      p.t1 = l.t1;
    } else merged.push({ ...l });
  }
  stats.layers = merged.length;
  // Object bounds; the custom-code ones too when that is all there is.
  const bb = obj[0] !== Infinity ? obj : all;
  stats.bounds = bb[0] === Infinity ? null : (bb as GcodeStats['bounds']);
  if (stats.layerHeight === undefined && merged.length > 2)
    stats.layerHeight = Math.round((merged[2]!.z - merged[1]!.z) * 1000) / 1000;
  return { extrude: ex.subarray(0, ne * 6), travel: tr.subarray(0, nt * 6), layers: merged, stats };
}

/** The time to show: the slicer's when it gave one (it counts acceleration), else ours. */
export const gcodeTime = (s: GcodeStats) => s.slicerTimeS ?? s.estimateS;
export const gcodeGrams = (s: GcodeStats, diameter = 1.75) =>
  s.slicerFilamentG ?? filamentGrams(s.slicerFilamentMm ?? s.filamentMm, diameter);

/** Plain words for the AI. */
export function describeGcode(s: GcodeStats, bed?: [number, number, number]): string {
  if (s.binary)
    return 'This is binary G-code (.bgcode); it can be sent to the printer but not read here.';
  const out: string[] = [];
  if (s.slicer) out.push(`Sliced with ${s.slicer}.`);
  out.push(
    `${s.layers} layers${s.layerHeight ? ` of ${s.layerHeight} mm` : ''}, ${s.lines.toLocaleString('en')} lines.`,
  );
  if (s.bounds) {
    const [x0, y0, z0, x1, y1, z1] = s.bounds;
    out.push(
      `Printed area X ${x0.toFixed(1)}..${x1.toFixed(1)}, Y ${y0.toFixed(1)}..${y1.toFixed(1)}, height ${(z1 - Math.min(z0, 0)).toFixed(1)} mm.`,
    );
    if (bed && (x0 < -1 || y0 < -1 || x1 > bed[0] + 1 || y1 > bed[1] + 1 || z1 > bed[2] + 0.5))
      out.push(`WARNING: it goes outside a ${bed.join('×')} mm printer.`);
  } else out.push('It has no extrusion moves: nothing would be printed.');
  out.push(
    `Time: ${formatDuration(gcodeTime(s), 'en')}${s.slicerTimeS === undefined ? ' (rough estimate, no slicer time in the file)' : ''}. Filament: ${((s.slicerFilamentMm ?? s.filamentMm) / 1000).toFixed(2)} m ≈ ${gcodeGrams(s).toFixed(1)} g.`,
  );
  if (s.nozzleTemp || s.bedTemp)
    out.push(`Temperatures: nozzle ${s.nozzleTemp ?? '?'} °C, bed ${s.bedTemp ?? '?'} °C.`);
  if (s.truncated) out.push('The file is very large; only the first part was read.');
  return out.join(' ');
}

/**
 * Extrusion lines as thin ribbons of triangles (a flat strip on top plus a wall), so the
 * same software rasterizer that draws meshes can draw what will be printed. Long prints are
 * thinned out evenly to about `maxSegments`.
 */
export function gcodeTris(p: GcodeParsed, maxSegments = 150_000, width = 0.45): Float32Array {
  const n = p.extrude.length / 6;
  const step = Math.max(1, Math.ceil(n / maxSegments));
  const h = p.stats.layerHeight && p.stats.layerHeight > 0 ? p.stats.layerHeight : 0.2;
  const out = new Float32Array(Math.ceil(n / step) * 4 * 9);
  let k = 0;
  const tri = (a: number[], b: number[], c: number[]) => {
    out[k++] = a[0]!;
    out[k++] = a[1]!;
    out[k++] = a[2]!;
    out[k++] = b[0]!;
    out[k++] = b[1]!;
    out[k++] = b[2]!;
    out[k++] = c[0]!;
    out[k++] = c[1]!;
    out[k++] = c[2]!;
  };
  const s = p.extrude;
  for (let i = 0; i < n; i += step) {
    const o = i * 6;
    const x0 = s[o]!,
      y0 = s[o + 1]!,
      z0 = s[o + 2]!,
      x1 = s[o + 3]!,
      y1 = s[o + 4]!,
      z1 = s[o + 5]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const nx = (-(y1 - y0) / len) * (width / 2);
    const ny = ((x1 - x0) / len) * (width / 2);
    // Flat strip on top.
    const a = [x0 + nx, y0 + ny, z0],
      b = [x0 - nx, y0 - ny, z0],
      c = [x1 - nx, y1 - ny, z1],
      d = [x1 + nx, y1 + ny, z1];
    tri(a, b, c);
    tri(a, c, d);
    // Wall down to the layer below (what the side views see).
    const e = [x0, y0, z0 - h],
      f = [x1, y1, z1 - h],
      g = [x1, y1, z1],
      q = [x0, y0, z0];
    tri(e, f, g);
    tri(e, g, q);
  }
  return out.subarray(0, k);
}
