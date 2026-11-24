/**
 * Fase 3A (plan de funciones): pure parts of the paint canvas — bucket fill, brush stamps
 * along a stroke and the layered file format (.zdraw). The renderer draws with canvas 2D.
 */

export const PAINT_EXT = 'zdraw';
export const MAX_PAINT_SIDE = 8192;
export const MAX_LAYERS = 32;

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn';
export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
];

/** globalCompositeOperation of a blend mode. */
export const compositeOf = (b: BlendMode): string => (b === 'normal' ? 'source-over' : b);

export interface PaintLayerFile {
  name: string;
  visible: boolean;
  /** 0…1 */
  opacity: number;
  blend: BlendMode;
  /** PNG of the layer as base64 (no data: prefix). */
  png: string;
}

export interface PaintFile {
  format: 'zinarix-draw';
  version: 1;
  width: number;
  height: number;
  /** Bottom to top. */
  layers: PaintLayerFile[];
}

/** Checks and normalizes a .zdraw file (throws with a readable reason). */
export function parsePaintFile(text: string): PaintFile {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('The drawing file is damaged (not JSON).');
  }
  const o = j as Partial<PaintFile>;
  if (!o || o.format !== 'zinarix-draw') throw new Error('This is not a Zinarix drawing (.zdraw).');
  const side = (v: unknown): number => {
    const x = Math.round(Number(v));
    if (!Number.isFinite(x) || x < 1 || x > MAX_PAINT_SIDE)
      throw new Error('The size of the drawing is not valid.');
    return x;
  };
  const width = side(o.width);
  const height = side(o.height);
  if (!Array.isArray(o.layers) || o.layers.length === 0)
    throw new Error('The drawing has no layers.');
  const layers = o.layers.slice(0, MAX_LAYERS).map((l, i): PaintLayerFile => ({
    name: typeof l?.name === 'string' && l.name.trim() ? l.name.slice(0, 60) : `Capa ${i + 1}`,
    visible: l?.visible !== false,
    opacity: Number.isFinite(Number(l?.opacity)) ? Math.min(1, Math.max(0, Number(l.opacity))) : 1,
    blend: BLEND_MODES.includes(l?.blend as BlendMode) ? (l.blend as BlendMode) : 'normal',
    png: typeof l?.png === 'string' ? l.png.replace(/^data:image\/png;base64,/, '') : '',
  }));
  return { format: 'zinarix-draw', version: 1, width, height, layers };
}

export function serializePaintFile(f: Omit<PaintFile, 'format' | 'version'>): string {
  return JSON.stringify({
    format: 'zinarix-draw',
    version: 1,
    width: f.width,
    height: f.height,
    layers: f.layers,
  });
}

// ------------------------------------------------------------------ colors

export interface Rgba8 {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function hexToRgba(hex: string, a = 255): Rgba8 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1]!, 16) : 0;
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((x) =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// ------------------------------------------------------------------ bucket fill

/**
 * Flood fill of `target` (RGBA, width × height) from (x, y) with `color`. The region is the
 * connected area whose color is within `tolerance` (0…255, per channel distance incl. alpha)
 * of the start pixel, read from `sample` (the layer itself or the whole picture). Edges are
 * grown by one pixel so anti-aliased outlines leave no halo. Returns the box that changed.
 */
export function floodFill(
  target: Uint8ClampedArray,
  sample: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Rgba8,
  tolerance: number,
): { x: number; y: number; w: number; h: number } | null {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const at = (y * width + x) * 4;
  const sr = sample[at]!;
  const sg = sample[at + 1]!;
  const sb = sample[at + 2]!;
  const sa = sample[at + 3]!;
  const tol = Math.max(0, Math.min(255, tolerance));
  const match = (i: number): boolean =>
    Math.abs(sample[i]! - sr) <= tol &&
    Math.abs(sample[i + 1]! - sg) <= tol &&
    Math.abs(sample[i + 2]! - sb) <= tol &&
    Math.abs(sample[i + 3]! - sa) <= tol;
  const mask = new Uint8Array(width * height);
  const stack = [x, y];
  let minX = x;
  let maxX = x;
  let minY = y;
  let maxY = y;
  // Scanline fill: walks each row to its ends and queues the rows above and below.
  while (stack.length) {
    const cy = stack.pop()!;
    let cx = stack.pop()!;
    while (cx > 0 && !mask[cy * width + cx - 1] && match((cy * width + cx - 1) * 4)) cx--;
    let up = false;
    let down = false;
    for (; cx < width; cx++) {
      const p = cy * width + cx;
      if (mask[p] || !match(p * 4)) break;
      mask[p] = 1;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      if (cy > 0) {
        const q = p - width;
        const ok = !mask[q] && match(q * 4);
        if (ok && !up) stack.push(cx, cy - 1);
        up = ok;
      }
      if (cy < height - 1) {
        const q = p + width;
        const ok = !mask[q] && match(q * 4);
        if (ok && !down) stack.push(cx, cy + 1);
        down = ok;
      }
    }
  }
  // Grow by one pixel (covers the soft edge of brush strokes).
  const x0 = Math.max(0, minX - 1);
  const x1 = Math.min(width - 1, maxX + 1);
  const y0 = Math.max(0, minY - 1);
  const y1 = Math.min(height - 1, maxY + 1);
  const paint = (p: number): void => {
    const i = p * 4;
    // Over the pixel (source-over with the fill color's alpha).
    const a = color.a / 255;
    const da = target[i + 3]! / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    target[i] = (color.r * a + target[i]! * da * (1 - a)) / oa;
    target[i + 1] = (color.g * a + target[i + 1]! * da * (1 - a)) / oa;
    target[i + 2] = (color.b * a + target[i + 2]! * da * (1 - a)) / oa;
    target[i + 3] = oa * 255;
  };
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const p = yy * width + xx;
      if (mask[p]) paint(p);
      else if (
        (xx > 0 && mask[p - 1]) ||
        (xx < width - 1 && mask[p + 1]) ||
        (yy > 0 && mask[p - width]) ||
        (yy < height - 1 && mask[p + width])
      )
        paint(p);
    }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ------------------------------------------------------------------ brush stroke

export interface StrokePoint {
  x: number;
  y: number;
  /** Pen pressure 0…1 (mouse: 0.5 in the browser, treated as full). */
  pressure: number;
}

export interface Stamp {
  x: number;
  y: number;
  /** Diameter of the dab. */
  size: number;
  /** 0…1 */
  alpha: number;
}

export interface BrushOpts {
  size: number;
  /** Pressure changes the size (true) — and the flow when flowPressure. */
  sizePressure: boolean;
  flowPressure: boolean;
  /** Distance between dabs as a share of the size (0.05…1). */
  spacing: number;
}

/** Mouse and touch report 0.5 or 0 when they have no pressure: full strength then. */
export function normPressure(pointerType: string, p: number): number {
  if (pointerType !== 'pen') return 1;
  return Math.max(0.05, Math.min(1, p || 0.05));
}

/**
 * Dabs from `from` to `to` (exclusive of `from`), evenly spaced. `carry` is the distance
 * left over from the last segment so spacing stays even along the whole stroke.
 */
export function stampsBetween(
  from: StrokePoint,
  to: StrokePoint,
  o: BrushOpts,
  carry: number,
): { stamps: Stamp[]; carry: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const stamps: Stamp[] = [];
  let d = carry;
  const sizeAt = (p: number): number => Math.max(0.5, o.sizePressure ? o.size * p : o.size);
  while (true) {
    const t = dist === 0 ? 1 : d / dist;
    if (t > 1) break;
    const p = from.pressure + (to.pressure - from.pressure) * t;
    const size = sizeAt(p);
    stamps.push({ x: from.x + dx * t, y: from.y + dy * t, size, alpha: o.flowPressure ? p : 1 });
    const step = Math.max(0.5, size * Math.max(0.02, Math.min(1, o.spacing)));
    d += step;
    if (dist === 0) break;
  }
  return { stamps, carry: d - dist };
}

// ------------------------------------------------------------------ brushes (mejora)

export type BrushKind = 'round' | 'pencil' | 'airbrush' | 'marker' | 'spray' | 'chalk';
export const BRUSH_KINDS: BrushKind[] = ['round', 'pencil', 'airbrush', 'marker', 'spray', 'chalk'];

/** Distance between dabs (share of the size) for each brush. */
export const BRUSH_SPACING: Record<BrushKind, number> = {
  round: 0.12,
  pencil: 0.08,
  airbrush: 0.06,
  marker: 0.06,
  spray: 0.35,
  chalk: 0.25,
};

/** Small fast seeded random numbers (0…1), so a stroke draws the same while it is shown. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` points spread evenly inside a circle (spray and chalk dabs). */
export function diskPoints(
  cx: number,
  cy: number,
  r: number,
  n: number,
  rand: () => number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r;
    out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d });
  }
  return out;
}

export type Symmetry = 'none' | 'x' | 'y' | 'xy';

/** The point and its mirrors across the middle of the canvas (x: left ↔ right, y: top ↕ bottom). */
export function mirrorPoints(
  sym: Symmetry,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number }[] {
  const out = [{ x, y }];
  if (sym === 'x' || sym === 'xy') out.push({ x: w - x, y });
  if (sym === 'y' || sym === 'xy') out.push({ x, y: h - y });
  if (sym === 'xy') out.push({ x: w - x, y: h - y });
  return out;
}

// ------------------------------------------------------------------ selection and transform (mejora)

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whole-pixel box around points, cut to the canvas (null when nothing is left). */
export function pixelBox(pts: { x: number; y: number }[], w: number, h: number): Rect | null {
  if (!pts.length) return null;
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))));
  const x1 = Math.min(w, Math.ceil(Math.max(...pts.map((p) => p.x))));
  const y1 = Math.min(h, Math.ceil(Math.max(...pts.map((p) => p.y))));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Affine map (a, b, c, d, e, f as in canvas setTransform) that puts the box `src` onto
 * `dst`, flipped when asked.
 */
export function rectMap(
  src: Rect,
  dst: Rect,
  flipX = false,
  flipY = false,
): [number, number, number, number, number, number] {
  const sx = src.w ? dst.w / src.w : 1;
  const sy = src.h ? dst.h / src.h : 1;
  const a = flipX ? -sx : sx;
  const d = flipY ? -sy : sy;
  const e = flipX ? dst.x + dst.w + src.x * sx : dst.x - src.x * sx;
  const f = flipY ? dst.y + dst.h + src.y * sy : dst.y - src.y * sy;
  return [a, 0, 0, d, e, f];
}

export type Corner = 'nw' | 'ne' | 'se' | 'sw';

/** Box after dragging a corner to (px, py): the opposite corner stays; keepRatio keeps the shape. */
export function scaleRect(
  r: Rect,
  corner: Corner,
  px: number,
  py: number,
  keepRatio: boolean,
): Rect {
  const ax = corner.includes('w') ? r.x + r.w : r.x;
  const ay = corner.includes('n') ? r.y + r.h : r.y;
  let w = Math.max(1, Math.abs(px - ax));
  let h = Math.max(1, Math.abs(py - ay));
  if (keepRatio && r.w > 0 && r.h > 0) {
    const k = Math.max(w / r.w, h / r.h);
    w = Math.max(1, r.w * k);
    h = Math.max(1, r.h * k);
  }
  return { x: corner.includes('w') ? ax - w : ax, y: corner.includes('n') ? ay - h : ay, w, h };
}
