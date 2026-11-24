/**
 * Fase 1A (plan de funciones): the simple image editor. An edit is a small description
 * (rotation, flip, crop, size, colour, filters) applied in a fixed order to the original
 * pixels, so undo/redo is just going back to an earlier description and nothing is lost until
 * the user saves. Pure maths on RGBA bytes, shared by the editor (canvas ImageData) and the
 * agent tool in the main process (pixels decoded by FFmpeg): both give the same result.
 *
 * Order: background removal (Fase 1B: the mask of shared/bgRemove.ts) → rotate → flip →
 * straighten → crop → resize → colour (exposure, temperature, brightness, shadows / highlights,
 * contrast, hue, saturation, vibrance) → black & white / sepia → blur → sharpen → vignette →
 * backdrop colour.
 */
import { applyMask, fillBackdrop, parseHex } from './bgRemove.js';

export interface Rgba {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, rows top to bottom (not premultiplied). */
  data: Uint8ClampedArray;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface ImageEdit {
  /** Clockwise. */
  rotate?: Rotation;
  flipH?: boolean;
  flipV?: boolean;
  /**
   * Small turn in degrees (-45…45, clockwise +) to level a horizon. The picture is zoomed so no
   * empty corner shows, and keeps its size (so a crop made afterwards stays where it is).
   */
  straighten?: number;
  /** In pixels of the rotated and flipped picture (what the user sees). */
  crop?: CropRect;
  /** Final size in pixels (after the crop). */
  resize?: { w: number; h: number };
  /** -100…100 each (0 = unchanged). */
  brightness?: number;
  contrast?: number;
  saturation?: number;
  /** Warm (+) or cool (−), -100…100. */
  temperature?: number;
  /** Stops, -3…3. */
  exposure?: number;
  /** -100…100: darken (−) or lift (+) only the dark / the bright parts. */
  shadows?: number;
  highlights?: number;
  /** Degrees, -180…180. */
  hue?: number;
  /** -100…100: saturation that spares the colours that are already strong (skin). */
  vibrance?: number;
  /** 0…100 (share of the effect). */
  grayscale?: number;
  sepia?: number;
  /** Radius in pixels of the final picture, 0…50. */
  blur?: number;
  /** 0…100. */
  sharpen?: number;
  /** -100…100: darker (+) or lighter (−) corners. */
  vignette?: number;
  /** Fase 1B: the background is removed (with the mask given to applyEdit). */
  cutout?: true;
  /** With cutout: a solid colour behind the subject ("#rrggbb"); transparent when absent. */
  backdrop?: string;
}

export const IMAGE_FORMATS = ['png', 'jpg', 'webp'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const MIME_OF: Record<ImageFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/** Extensions the editor opens (what Chromium and FFmpeg both decode). */
export const EDITABLE_EXT = new Set(['png', 'jpg', 'jpeg', 'jfif', 'webp', 'bmp']);

/** Biggest side the editor and the tool accept (memory: 16384² RGBA is 1 GB). */
export const MAX_SIDE = 12_000;

export const ADJUST_KEYS = [
  'exposure',
  'temperature',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'saturation',
  'vibrance',
  'hue',
] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];

export const FILTER_KEYS = ['grayscale', 'sepia', 'blur', 'sharpen', 'vignette'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** Slider ranges [min, max, step]. */
export const RANGES: Record<AdjustKey | FilterKey | 'straighten', [number, number, number]> = {
  straighten: [-45, 45, 0.1],
  exposure: [-3, 3, 0.05],
  temperature: [-100, 100, 1],
  brightness: [-100, 100, 1],
  contrast: [-100, 100, 1],
  highlights: [-100, 100, 1],
  shadows: [-100, 100, 1],
  saturation: [-100, 100, 1],
  vibrance: [-100, 100, 1],
  hue: [-180, 180, 1],
  grayscale: [0, 100, 1],
  sepia: [0, 100, 1],
  blur: [0, 50, 0.5],
  sharpen: [0, 100, 1],
  vignette: [-100, 100, 1],
};

/** Keys with a value that can go below zero (shown with a sign). */
const SIGNED = new Set<string>([...ADJUST_KEYS, 'vignette', 'straighten']);

/** One-click looks (only colour and filters: geometry stays as it is). */
export const IMAGE_PRESETS: { id: string; edit: ImageEdit }[] = [
  { id: 'none', edit: {} },
  { id: 'vivid', edit: { contrast: 15, saturation: 35 } },
  { id: 'warm', edit: { temperature: 35, saturation: 10 } },
  { id: 'cool', edit: { temperature: -35 } },
  { id: 'bw', edit: { grayscale: 100, contrast: 20 } },
  { id: 'sepia', edit: { sepia: 85, contrast: -5 } },
  { id: 'fade', edit: { contrast: -30, brightness: 10, saturation: -25 } },
  { id: 'punch', edit: { contrast: 35, saturation: 20, sharpen: 30 } },
  {
    id: 'film',
    edit: {
      contrast: -12,
      highlights: -25,
      shadows: 20,
      vibrance: -15,
      temperature: 12,
      vignette: 25,
    },
  },
  { id: 'drama', edit: { contrast: 30, highlights: -40, shadows: 30, vibrance: 25, vignette: 40 } },
  { id: 'noir', edit: { grayscale: 100, contrast: 45, shadows: -20, vignette: 45 } },
  { id: 'pastel', edit: { brightness: 18, contrast: -25, vibrance: -10, hue: -8 } },
];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Size after rotation. */
export function orientedSize(w: number, h: number, rotate: Rotation = 0): { w: number; h: number } {
  return rotate === 90 || rotate === 270 ? { w: h, h: w } : { w, h };
}

/** The crop clamped to a picture of w × h (whole pixels, at least 1 × 1). */
export function clampCrop(c: CropRect, w: number, h: number): CropRect {
  const x = clamp(Math.round(c.x), 0, w - 1);
  const y = clamp(Math.round(c.y), 0, h - 1);
  return {
    x,
    y,
    w: clamp(Math.round(c.w), 1, w - x),
    h: clamp(Math.round(c.h), 1, h - y),
  };
}

/** Size of the result of an edit on a w × h original. */
export function outputSize(w: number, h: number, e: ImageEdit): { w: number; h: number } {
  if (e.resize) return { w: e.resize.w, h: e.resize.h };
  const o = orientedSize(w, h, e.rotate);
  if (e.crop) {
    const c = clampCrop(e.crop, o.w, o.h);
    return { w: c.w, h: c.h };
  }
  return o;
}

/**
 * The edit cleaned up: numbers clamped to their range, zeros dropped, crop/resize kept only
 * when they make sense for a w × h original. Accepts anything (agent arguments, saved files).
 */
export function cleanEdit(x: unknown, w: number, h: number): ImageEdit {
  const e: ImageEdit = {};
  if (!x || typeof x !== 'object') return e;
  const a = x as Record<string, unknown>;
  const r = num(a.rotate);
  if (r !== undefined) {
    const n = (((Math.round(r / 90) * 90) % 360) + 360) % 360;
    if (n) e.rotate = n as Rotation;
  }
  if (a.flipH === true) e.flipH = true;
  if (a.flipV === true) e.flipV = true;
  const st = num(a.straighten);
  if (st !== undefined && Math.abs(st) >= 0.05)
    e.straighten = Math.round(clamp(st, -45, 45) * 10) / 10;
  const o = orientedSize(w, h, e.rotate);
  const c = a.crop as Record<string, unknown> | undefined;
  if (c && typeof c === 'object') {
    const [cx, cy, cw, ch] = [num(c.x), num(c.y), num(c.w), num(c.h)];
    if (
      cx !== undefined &&
      cy !== undefined &&
      cw !== undefined &&
      ch !== undefined &&
      cw > 0 &&
      ch > 0
    ) {
      const k = clampCrop({ x: cx, y: cy, w: cw, h: ch }, o.w, o.h);
      if (k.x || k.y || k.w !== o.w || k.h !== o.h) e.crop = k;
    }
  }
  const z = a.resize as Record<string, unknown> | undefined;
  if (z && typeof z === 'object') {
    const zw = num(z.w);
    const zh = num(z.h);
    if (zw !== undefined && zh !== undefined) {
      const rw = clamp(Math.round(zw), 1, MAX_SIDE);
      const rh = clamp(Math.round(zh), 1, MAX_SIDE);
      const before = e.crop ?? o;
      if (rw !== before.w || rh !== before.h) e.resize = { w: rw, h: rh };
    }
  }
  for (const k of [...ADJUST_KEYS, ...FILTER_KEYS]) {
    const v = num(a[k]);
    if (v === undefined) continue;
    const [lo, hi] = RANGES[k];
    const n = clamp(v, lo, hi);
    if (Math.abs(n) > 1e-9) e[k] = n;
  }
  if (a.cutout === true) {
    e.cutout = true;
    const c = parseHex(a.backdrop);
    if (c) e.backdrop = `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return e;
}

export function isIdentity(e: ImageEdit): boolean {
  return Object.keys(e).length === 0;
}

/** Short Spanish summary ("girar 90°, recortar 800×600, brillo +20") for approval cards. */
export function describeEdit(e: ImageEdit): string {
  const p: string[] = [];
  if (e.rotate) p.push(`girar ${e.rotate}°`);
  if (e.flipH) p.push('voltear horizontal');
  if (e.flipV) p.push('voltear vertical');
  if (e.straighten) p.push(`enderezar ${e.straighten > 0 ? '+' : ''}${e.straighten}°`);
  if (e.crop) p.push(`recortar ${e.crop.w}×${e.crop.h} desde (${e.crop.x}, ${e.crop.y})`);
  if (e.resize) p.push(`tamaño ${e.resize.w}×${e.resize.h}`);
  const names: Record<AdjustKey | FilterKey, string> = {
    exposure: 'exposición',
    temperature: 'temperatura',
    brightness: 'brillo',
    contrast: 'contraste',
    highlights: 'luces',
    shadows: 'sombras',
    saturation: 'saturación',
    vibrance: 'intensidad',
    hue: 'tono',
    grayscale: 'blanco y negro',
    sepia: 'sepia',
    blur: 'desenfoque',
    sharpen: 'nitidez',
    vignette: 'viñeta',
  };
  for (const k of [...ADJUST_KEYS, ...FILTER_KEYS]) {
    const v = e[k];
    if (v === undefined) continue;
    const s = k === 'exposure' ? v.toFixed(2) : String(Math.round(v * 10) / 10);
    p.push(`${names[k]} ${v > 0 && SIGNED.has(k) ? '+' : ''}${s}${k === 'hue' ? '°' : ''}`);
  }
  if (e.cutout) p.push(e.backdrop ? `quitar fondo (fondo ${e.backdrop})` : 'quitar fondo');
  return p.length ? p.join(', ') : 'sin cambios';
}

/** Rotating the picture by 90° clockwise carries the crop along. */
export function rotateEdit(e: ImageEdit, w: number, h: number, dir: 1 | -1): ImageEdit {
  const before = orientedSize(w, h, e.rotate);
  const rotate = ((((e.rotate ?? 0) + dir * 90) % 360) + 360) % 360;
  const next: ImageEdit = { ...e };
  if (rotate) next.rotate = rotate as Rotation;
  else delete next.rotate;
  if (e.crop) {
    const c = e.crop;
    next.crop =
      dir === 1
        ? { x: before.h - c.y - c.h, y: c.x, w: c.h, h: c.w }
        : { x: c.y, y: before.w - c.x - c.w, w: c.h, h: c.w };
  }
  if (e.resize) next.resize = { w: e.resize.h, h: e.resize.w };
  return next;
}

/** Flipping carries the crop along too. */
export function flipEdit(e: ImageEdit, w: number, h: number, axis: 'h' | 'v'): ImageEdit {
  const o = orientedSize(w, h, e.rotate);
  const next: ImageEdit = { ...e };
  // A mirror turns a clockwise tilt into a counter-clockwise one.
  if (e.straighten) next.straighten = -e.straighten;
  if (axis === 'h') {
    if (e.flipH) delete next.flipH;
    else next.flipH = true;
    if (e.crop) next.crop = { ...e.crop, x: o.w - e.crop.x - e.crop.w };
  } else {
    if (e.flipV) delete next.flipV;
    else next.flipV = true;
    if (e.crop) next.crop = { ...e.crop, y: o.h - e.crop.y - e.crop.h };
  }
  return next;
}

// ------------------------------------------------------------------- geometry

/** Rotation (clockwise) and flips in one pass. */
export function orient(img: Rgba, rotate: Rotation = 0, flipH = false, flipV = false): Rgba {
  if (!rotate && !flipH && !flipV) return img;
  const { width: W, height: H, data: src } = img;
  const o = orientedSize(W, H, rotate);
  const out = new Uint8ClampedArray(o.w * o.h * 4);
  const s32 = new Uint32Array(src.buffer, src.byteOffset, W * H);
  const d32 = new Uint32Array(out.buffer);
  for (let y = 0; y < o.h; y++) {
    const fy = flipV ? o.h - 1 - y : y;
    for (let x = 0; x < o.w; x++) {
      const fx = flipH ? o.w - 1 - x : x;
      // (fx, fy) in the rotated picture → (sx, sy) in the source.
      let sx: number;
      let sy: number;
      if (rotate === 90) {
        sx = fy;
        sy = H - 1 - fx;
      } else if (rotate === 180) {
        sx = W - 1 - fx;
        sy = H - 1 - fy;
      } else if (rotate === 270) {
        sx = W - 1 - fy;
        sy = fx;
      } else {
        sx = fx;
        sy = fy;
      }
      d32[y * o.w + x] = s32[sy * W + sx]!;
    }
  }
  return { width: o.w, height: o.h, data: out };
}

export function cropImage(img: Rgba, c: CropRect): Rgba {
  const k = clampCrop(c, img.width, img.height);
  if (k.x === 0 && k.y === 0 && k.w === img.width && k.h === img.height) return img;
  const out = new Uint8ClampedArray(k.w * k.h * 4);
  for (let y = 0; y < k.h; y++) {
    const from = ((k.y + y) * img.width + k.x) * 4;
    out.set(img.data.subarray(from, from + k.w * 4), y * k.w * 4);
  }
  return { width: k.w, height: k.h, data: out };
}

/** How much a w × h picture turned by `deg` must grow so no empty corner shows. */
export function coverScale(w: number, h: number, deg: number): number {
  const t = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
}

/** Turns the picture by a small angle around its centre, zoomed to fill (same size, bilinear). */
export function straightenImage(img: Rgba, deg: number): Rgba {
  if (Math.abs(deg) < 0.05) return img;
  const { width: W, height: H, data: src } = img;
  const k = 1 / coverScale(W, H, deg);
  const t = (deg * Math.PI) / 180;
  // Output → source: turn back by −deg and shrink by 1 / scale.
  const cos = Math.cos(t) * k;
  const sin = Math.sin(t) * k;
  const cx = W / 2;
  const cy = H / 2;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < H; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const sx = clamp(cos * dx + sin * dy + cx - 0.5, 0, W - 1);
      const sy = clamp(-sin * dx + cos * dy + cy - 0.5, 0, H - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(W - 1, x0 + 1);
      const y1 = Math.min(H - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * W + x0) * 4;
      const i10 = (y0 * W + x1) * 4;
      const i01 = (y1 * W + x0) * 4;
      const i11 = (y1 * W + x1) * 4;
      // Weights times alpha (premultiplied), so transparent pixels lend no colour.
      const w00 = (1 - fx) * (1 - fy) * src[i00 + 3]!;
      const w10 = fx * (1 - fy) * src[i10 + 3]!;
      const w01 = (1 - fx) * fy * src[i01 + 3]!;
      const w11 = fx * fy * src[i11 + 3]!;
      const a = w00 + w10 + w01 + w11;
      const o = (y * W + x) * 4;
      if (a > 0) {
        out[o] = (src[i00]! * w00 + src[i10]! * w10 + src[i01]! * w01 + src[i11]! * w11) / a;
        out[o + 1] =
          (src[i00 + 1]! * w00 + src[i10 + 1]! * w10 + src[i01 + 1]! * w01 + src[i11 + 1]! * w11) /
          a;
        out[o + 2] =
          (src[i00 + 2]! * w00 + src[i10 + 2]! * w10 + src[i01 + 2]! * w01 + src[i11 + 2]! * w11) /
          a;
      }
      out[o + 3] = a;
    }
  }
  return { width: W, height: H, data: out };
}

/** Premultiplied float copy (filters must not bleed the colour of transparent pixels). */
function toPremul(img: Rgba): Float32Array {
  const d = img.data;
  const f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    f[i] = d[i]! * a;
    f[i + 1] = d[i + 1]! * a;
    f[i + 2] = d[i + 2]! * a;
    f[i + 3] = d[i + 3]!;
  }
  return f;
}

function fromPremul(f: Float32Array, w: number, h: number): Rgba {
  const out = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3]!;
    out[i + 3] = a;
    if (a > 0.5) {
      const k = 255 / a;
      out[i] = f[i]! * k;
      out[i + 1] = f[i + 1]! * k;
      out[i + 2] = f[i + 2]! * k;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * One axis of a resample with a tent filter that widens when shrinking (so a big photo made
 * small averages its pixels instead of skipping them).
 */
function resampleAxis(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  horizontal: boolean,
): Float32Array {
  const len = horizontal ? sw : sh;
  const other = horizontal ? sh : sw;
  const scale = dw / len;
  const support = scale < 1 ? 1 / scale : 1;
  const out = new Float32Array((horizontal ? dw * sh : sw * dw) * 4);
  // Weights per output position (same for every row / column).
  const starts = new Int32Array(dw);
  const counts = new Int32Array(dw);
  const weights: number[][] = [];
  for (let i = 0; i < dw; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const lo = Math.max(0, Math.floor(center - support));
    const hi = Math.min(len - 1, Math.ceil(center + support));
    const ws: number[] = [];
    let total = 0;
    for (let j = lo; j <= hi; j++) {
      const wgt = Math.max(0, 1 - Math.abs(j - center) / support);
      ws.push(wgt);
      total += wgt;
    }
    if (total <= 0) {
      // Upscaling past the edge: nearest pixel.
      const j = clamp(Math.round(center), 0, len - 1);
      starts[i] = j;
      counts[i] = 1;
      weights.push([1]);
      continue;
    }
    starts[i] = lo;
    counts[i] = ws.length;
    weights.push(ws.map((v) => v / total));
  }
  for (let o = 0; o < other; o++) {
    for (let i = 0; i < dw; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const ws = weights[i]!;
      const s0 = starts[i]!;
      for (let k = 0; k < counts[i]!; k++) {
        const j = s0 + k;
        const si = (horizontal ? o * sw + j : j * sw + o) * 4;
        const wgt = ws[k]!;
        r += src[si]! * wgt;
        g += src[si + 1]! * wgt;
        b += src[si + 2]! * wgt;
        a += src[si + 3]! * wgt;
      }
      const di = (horizontal ? o * dw + i : i * sw + o) * 4;
      out[di] = r;
      out[di + 1] = g;
      out[di + 2] = b;
      out[di + 3] = a;
    }
  }
  return out;
}

export function resizeImage(img: Rgba, w: number, h: number): Rgba {
  const W = clamp(Math.round(w), 1, MAX_SIDE);
  const H = clamp(Math.round(h), 1, MAX_SIDE);
  if (W === img.width && H === img.height) return img;
  let f = toPremul(img);
  if (W !== img.width) f = resampleAxis(f, img.width, img.height, W, true);
  if (H !== img.height) f = resampleAxis(f, W, img.height, H, false);
  return fromPremul(f, W, H);
}

// ------------------------------------------------------------------- colour

/** Per-channel tables for exposure, temperature, brightness and contrast. */
export function toneTables(e: ImageEdit): [Uint8Array, Uint8Array, Uint8Array] | null {
  const ex = e.exposure ?? 0;
  const te = (e.temperature ?? 0) / 100;
  const br = (e.brightness ?? 0) / 100;
  const co = (e.contrast ?? 0) / 100;
  const sh = (e.shadows ?? 0) / 100;
  const hi = (e.highlights ?? 0) / 100;
  if (!ex && !te && !br && !co && !sh && !hi) return null;
  const gain = 2 ** ex;
  // Contrast -100 → flat grey, +100 → twice as steep (a gentle, photo-like range).
  const k = 1 + co;
  const shift = [te * 0.12, te * 0.02, -te * 0.12];
  const tables = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)] as const;
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 256; i++) {
      let v = (i / 255) * gain;
      v *= 1 + shift[c]!;
      // Brightness lifts the mids more than the ends (a gamma), so whites do not just clip.
      if (br && v > 0 && v < 1) v = Math.pow(v, br > 0 ? 1 / (1 + br * 1.5) : 1 - br * 1.5);
      // Shadows bend the lower part of the curve, highlights the upper part (both stay rising).
      if ((sh || hi) && v > 0 && v < 1) {
        const u = 1 - v;
        v += sh * 1.2 * v * u * u + hi * 1.2 * v * v * u;
      }
      v = (v - 0.5) * k + 0.5;
      tables[c]![i] = clamp(Math.round(v * 255), 0, 255);
    }
  }
  return [tables[0], tables[1], tables[2]];
}

/** Hue turn as a 3 × 3 matrix that keeps the luminance (as CSS hue-rotate). */
export function hueMatrix(deg: number): number[] {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    0.213 + c * 0.787 - s * 0.213,
    0.715 - c * 0.715 - s * 0.715,
    0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143,
    0.715 + c * 0.285 + s * 0.14,
    0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 + s * 0.715,
    0.072 + c * 0.928 + s * 0.072,
  ];
}

/** Colour in place: tone tables, hue, saturation and vibrance, then black & white and sepia. */
export function colorPixels(px: Uint8ClampedArray, e: ImageEdit): void {
  const tables = toneTables(e);
  const sat = 1 + (e.saturation ?? 0) / 100;
  const vib = (e.vibrance ?? 0) / 100;
  const gray = (e.grayscale ?? 0) / 100;
  const sep = (e.sepia ?? 0) / 100;
  const m = e.hue ? hueMatrix(e.hue) : null;
  if (!tables && sat === 1 && !vib && !gray && !sep && !m) return;
  const [tr, tg, tb] = tables ?? [null, null, null];
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i]!;
    let g = px[i + 1]!;
    let b = px[i + 2]!;
    if (tr) {
      r = tr[r]!;
      g = tg![g]!;
      b = tb![b]!;
    }
    if (m) {
      const hr = m[0]! * r + m[1]! * g + m[2]! * b;
      const hg = m[3]! * r + m[4]! * g + m[5]! * b;
      b = m[6]! * r + m[7]! * g + m[8]! * b;
      r = hr;
      g = hg;
    }
    if (sat !== 1 || vib || gray) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let s = sat * (1 - gray);
      if (vib) {
        // How colourful the pixel already is (0 grey … 1 pure): vibrance acts on the dull ones.
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const chroma = mx > 0 ? (mx - mn) / mx : 0;
        s *= 1 + vib * (1 - chroma);
      }
      r = l + (r - l) * s;
      g = l + (g - l) * s;
      b = l + (b - l) * s;
    }
    if (sep) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sep;
      g += (sg - g) * sep;
      b += (sb - b) * sep;
    }
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
}

// ------------------------------------------------------------------- filters

/** One box-blur pass along an axis (running sum, edges clamped). */
function boxPass(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const norm = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * 4 : l * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[base + clamp(k, 0, len - 1) * step + c]!;
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = sum * norm;
        const add = clamp(i + r + 1, 0, len - 1);
        const sub = clamp(i - r, 0, len - 1);
        sum += src[base + add * step + c]! - src[base + sub * step + c]!;
      }
    }
  }
}

/** Gaussian-like blur (three box passes) of a premultiplied float picture. */
function blurPremul(f: Float32Array, w: number, h: number, radius: number): Float32Array {
  // Three boxes of width b give a Gaussian of sigma ≈ radius / 2.
  const sigma = radius / 2;
  const boxes = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  const r = Math.max(1, Math.round((boxes - 1) / 2));
  let a: Float32Array = f;
  let b: Float32Array = new Float32Array(f.length);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, w, h, r, true);
    [a, b] = [b, a];
    boxPass(a, b, w, h, r, false);
    [a, b] = [b, a];
  }
  return a === f ? new Float32Array(a) : a;
}

export function blurImage(img: Rgba, radius: number): Rgba {
  if (radius < 0.5) return img;
  const f = toPremul(img);
  return fromPremul(blurPremul(f, img.width, img.height, radius), img.width, img.height);
}

/** Unsharp mask: adds back the difference between the picture and a small blur of it. */
export function sharpenImage(img: Rgba, amount: number): Rgba {
  if (amount <= 0) return img;
  const k = (amount / 100) * 1.5;
  const f = toPremul(img);
  const soft = blurPremul(f, img.width, img.height, 2);
  for (let i = 0; i < f.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = f[i + c]!;
      f[i + c] = clamp(v + (v - soft[i + c]!) * k, 0, f[i + 3]!);
    }
  }
  return fromPremul(f, img.width, img.height);
}

/** Darker (+) or lighter (−) corners; the same at any size (so the preview matches). */
export function vignetteImage(img: Rgba, amount: number): Rgba {
  const m = clamp(amount, -100, 100) / 100;
  if (!m) return img;
  const { width: w, height: h } = img;
  const d = new Uint8ClampedArray(img.data);
  const cx = w / 2;
  const cy = h / 2;
  const fx = new Float32Array(w);
  for (let x = 0; x < w; x++) fx[x] = ((x + 0.5 - cx) / cx) ** 2;
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5 - cy) / cy) ** 2;
    for (let x = 0; x < w; x++) {
      // 0 in the centre, 1 in the corners; the effect starts a third of the way out.
      const r = Math.sqrt((fx[x]! + fy) / 2);
      const t0 = clamp((r - 0.3) / 0.7, 0, 1);
      const t = t0 * t0 * (3 - 2 * t0) * 0.85 * Math.abs(m);
      if (!t) continue;
      const i = (y * w + x) * 4;
      if (m > 0) {
        d[i] = d[i]! * (1 - t);
        d[i + 1] = d[i + 1]! * (1 - t);
        d[i + 2] = d[i + 2]! * (1 - t);
      } else {
        d[i] = d[i]! + (255 - d[i]!) * t;
        d[i + 1] = d[i + 1]! + (255 - d[i + 1]!) * t;
        d[i + 2] = d[i + 2]! + (255 - d[i + 2]!) * t;
      }
    }
  }
  return { width: w, height: h, data: d };
}

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
}

/** Red, green, blue and luminance counts (256 bins each), sampling about 250 000 pixels. */
export function histogramOf(img: Rgba): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  const d = img.data;
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / 250_000));
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    if (d[i + 3]! < 128) continue;
    r[d[i]!]!++;
    g[d[i + 1]!]!++;
    b[d[i + 2]!]!++;
    l[Math.round(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!)]!++;
  }
  return { r, g, b, l };
}

/**
 * A one-click fix ("Auto") from the picture's own numbers: contrast from how much of the range
 * it uses, brightness from its middle grey, temperature from a colour cast in the mid-tones, and
 * a little vibrance. Gentle on purpose: the user tunes it from there.
 */
export function autoEdit(img: Rgba): ImageEdit {
  const d = img.data;
  const hist = new Uint32Array(256);
  let sr = 0;
  let sb = 0;
  let mids = 0;
  let total = 0;
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / 250_000));
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    if (d[i + 3]! < 128) continue;
    const l = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    hist[Math.round(l)]!++;
    total++;
    if (l > 38 && l < 217) {
      sr += d[i]!;
      sb += d[i + 2]!;
      mids++;
    }
  }
  if (!total) return {};
  const at = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= q * total) return v / 255;
    }
    return 1;
  };
  const lo = at(0.005);
  const hi = at(0.995);
  const mid = at(0.5);
  const e: Record<string, number> = {};
  const spread = hi - lo;
  if (spread > 0.05 && spread < 0.9)
    e.contrast = Math.round(clamp((0.95 / spread - 1) * 100, 0, 45));
  if (mid > 0.03 && mid < 0.97) {
    // Brightness is a gamma: the one that brings the middle grey to about 0.47.
    const gamma = Math.log(0.47) / Math.log(mid);
    const br = gamma < 1 ? (1 / gamma - 1) / 1.5 : (1 - gamma) / 1.5;
    const v = Math.round(clamp(br * 100 * 0.7, -35, 35));
    if (Math.abs(v) >= 3) e.brightness = v;
  }
  if (mids > total * 0.05) {
    const r = sr / mids;
    const b = sb / mids;
    // Temperature scales red by 1 + 0.12 t and blue by 1 − 0.12 t: the t that evens them,
    // at 60 % (a sunset should stay a little warm).
    if (Math.abs(r - b) > 4 && r + b > 20) {
      const v = Math.round(clamp(((b - r) / (0.12 * (r + b))) * 100 * 0.6, -40, 40));
      if (Math.abs(v) >= 3) e.temperature = v;
    }
  }
  e.vibrance = 15;
  return cleanEdit(e, img.width, img.height);
}

// ------------------------------------------------------------------- all together

/**
 * Applies an edit to the original pixels. `scale` < 1 means `img` is a smaller copy of the
 * original (the editor's preview): crop coordinates and blur radius follow it, and the final
 * resize is skipped (the preview is drawn at screen size anyway). The input is not modified.
 * `mask` (the size of `img`) is the background-removal alpha, used when the edit has cutout.
 */
export function applyEdit(img: Rgba, e: ImageEdit, scale = 1, mask?: Uint8Array | null): Rgba {
  if (e.cutout && mask) img = applyMask(img, mask);
  let out = orient(img, e.rotate, e.flipH, e.flipV);
  if (e.straighten) out = straightenImage(out, e.straighten);
  if (e.crop) {
    const c = e.crop;
    out = cropImage(out, { x: c.x * scale, y: c.y * scale, w: c.w * scale, h: c.h * scale });
  }
  let blurScale = scale;
  if (e.resize && scale === 1) {
    out = resizeImage(out, e.resize.w, e.resize.h);
  } else if (e.resize) {
    // Preview: the blur radius is in pixels of the final size.
    const before = e.crop ?? orientedSize(img.width / scale, img.height / scale, e.rotate);
    blurScale = (scale * before.w) / e.resize.w;
  }
  if (out === img)
    out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  colorPixels(out.data, e);
  if (e.blur) out = blurImage(out, e.blur * blurScale);
  if (e.sharpen) out = sharpenImage(out, e.sharpen);
  if (e.vignette) out = vignetteImage(out, e.vignette);
  if (e.cutout && e.backdrop) out = fillBackdrop(out, e.backdrop);
  return out;
}

/** JPEG has no transparency: transparent pixels go over white (not black). */
export function flattenOnWhite(img: Rgba): Rgba {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    if (a >= 1) continue;
    d[i] = d[i]! * a + 255 * (1 - a);
    d[i + 1] = d[i + 1]! * a + 255 * (1 - a);
    d[i + 2] = d[i + 2]! * a + 255 * (1 - a);
    d[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: d };
}

/** Format from a file name (null when the editor cannot write it). */
export function formatOf(path: string): ImageFormat | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif') return 'jpg';
  if (ext === 'webp') return 'webp';
  return null;
}

/** "fotos/gato.jpg" → "fotos/gato-editada.png" (format optional). */
export function editedName(path: string, format?: ImageFormat): string {
  const m = /^(.*?)(\.[^./\\]+)?$/.exec(path)!;
  const ext = format ? `.${format}` : (m[2] ?? '.png');
  return `${m[1]}-editada${ext}`;
}
