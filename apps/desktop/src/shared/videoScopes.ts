/**
 * Fase 12C: video scopes (waveform, RGB parade, vectorscope, histogram) as pure maths.
 *
 * Input is an RGBA buffer (row-major, 4 bytes per pixel) treated as full-range R'G'B' code values
 * 0–255. Luma is Rec.709: Y' = 0.2126 R + 0.7152 G + 0.0722 B. Chroma is BT.709 colour difference:
 * Cb = (B − Y') / 1.8556, Cr = (R − Y') / 1.5748, both in −127.5 … +127.5.
 *
 * Subsampling: `maxWidth` bounds the work. With step = ceil(w / maxWidth) the scopes read every
 * step-th column of every step-th row (same step both ways, so proportions are kept). The output
 * width of waveform/parade is ceil(w / step).
 *
 * Vectorscope angle convention (used by every helper here): angle = atan2(Cr, Cb) in degrees,
 * 0° = +Cb (right, towards blue), counter-clockwise, 90° = +Cr (up, towards red), range [0, 360).
 * In that convention 75% red sits at ~103°, and the skin-tone line (the NTSC "I" line) at ~123°.
 */

export type Pixels = Uint8ClampedArray | Uint8Array;

/** Broadcast legal range of 8-bit luma (code values). */
export const legalRange = { lo: 16, hi: 235 } as const;

/** Bins per channel / per axis. */
export const SCOPE_BINS = 256;

/** Skin-tone ("I") line angle in degrees, same convention as `cbcrAngle`. */
export const SKIN_TONE_ANGLE = 123;

// Integer luma: coefficients scaled to 2^16 (13933 + 46871 + 4732 = 65536), so 255 maps to 255.
const KR = 13933;
const KG = 46871;
const KB = 4732;

/** Rec.709 luma 0–255 (integer, rounded) of an R'G'B' triple. */
export function luma709(r: number, g: number, b: number): number {
  return (r * KR + g * KG + b * KB + 32768) >> 16;
}

/** BT.709 Cb/Cr (−127.5 … +127.5, unrounded) of an R'G'B' triple. */
export function rgbToCbCr(r: number, g: number, b: number): { cb: number; cr: number } {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { cb: (b - y) / 1.8556, cr: (r - y) / 1.5748 };
}

/** Hue angle on the vectorscope in degrees [0, 360): 0° = +Cb, counter-clockwise, 90° = +Cr. */
export function cbcrAngle(cb: number, cr: number): number {
  const a = (Math.atan2(cr, cb) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** Saturation radius on the vectorscope, in Cb/Cr code values (0 for greys, ~127 max). */
export function cbcrRadius(cb: number, cr: number): number {
  return Math.hypot(cb, cr);
}

/** Vectorscope angle (degrees) and radius of an R'G'B' colour. */
export function colorAngle(r: number, g: number, b: number): { angle: number; radius: number } {
  const { cb, cr } = rgbToCbCr(r, g, b);
  return { angle: cbcrAngle(cb, cr), radius: cbcrRadius(cb, cr) };
}

/** Vectorscope bin of a Cb/Cr pair: column 128 + Cb (right = +Cb), row 128 − Cr (up = +Cr). */
export function cbcrToBin(cb: number, cr: number): { col: number; row: number } {
  const col = Math.round(128 + cb);
  const row = Math.round(128 - cr);
  return { col: col < 0 ? 0 : col > 255 ? 255 : col, row: row < 0 ? 0 : row > 255 ? 255 : row };
}

export type BarName = 'R' | 'Y' | 'G' | 'C' | 'B' | 'M';

export interface BarTarget {
  name: BarName;
  rgb: [number, number, number];
  cb: number;
  cr: number;
  angle: number;
  radius: number;
  /** Bin position in the 256×256 vectorscope (see `cbcrToBin`). */
  col: number;
  row: number;
}

/** 75% amplitude level of the colour bars (0.75 × 255, rounded). */
export const BAR_75 = 191;

/** Target positions of the 75% colour bars R, Y, G, C, B, M on the vectorscope. */
export const COLOR_BAR_TARGETS: readonly BarTarget[] = (
  [
    ['R', [BAR_75, 0, 0]],
    ['Y', [BAR_75, BAR_75, 0]],
    ['G', [0, BAR_75, 0]],
    ['C', [0, BAR_75, BAR_75]],
    ['B', [0, 0, BAR_75]],
    ['M', [BAR_75, 0, BAR_75]],
  ] as [BarName, [number, number, number]][]
).map(([name, rgb]) => {
  const { cb, cr } = rgbToCbCr(...rgb);
  return { name, rgb, cb, cr, angle: cbcrAngle(cb, cr), radius: cbcrRadius(cb, cr), ...cbcrToBin(cb, cr) };
});

/** Sampling grid for a w×h frame bounded by `maxWidth` columns. */
export function sampling(w: number, h: number, maxWidth = Infinity): { step: number; outW: number; outH: number } {
  const step = Math.max(1, Math.ceil(w / Math.max(1, maxWidth)));
  return { step, outW: Math.ceil(w / step), outH: Math.ceil(h / step) };
}

export interface Waveform {
  /** Output columns (sampled frame width). */
  cols: number;
  /** cols × 256 counts; index = col * 256 + level (level 0 = black). */
  bins: Uint32Array;
  /** Largest single count, handy to normalise intensity. */
  peak: number;
}

/** Luma waveform: per output column, a 256-bin count of Rec.709 luma. */
export function waveform(data: Pixels, w: number, h: number, maxWidth = Infinity): Waveform {
  const { step, outW } = sampling(w, h, maxWidth);
  const bins = new Uint32Array(outW * SCOPE_BINS);
  const rowStride = w * 4;
  for (let y = 0; y < h; y += step) {
    let p = y * rowStride;
    const pStep = step * 4;
    for (let c = 0; c < outW; c++, p += pStep) {
      const l = (data[p]! * KR + data[p + 1]! * KG + data[p + 2]! * KB + 32768) >> 16;
      bins[(c << 8) | l]!++;
    }
  }
  return { cols: outW, bins, peak: peakOf(bins) };
}

export interface Parade {
  cols: number;
  /** Each cols × 256, index = col * 256 + level. */
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Largest count across the three channels. */
  peak: number;
}

/** RGB parade: a waveform per channel. */
export function parade(data: Pixels, w: number, h: number, maxWidth = Infinity): Parade {
  const { step, outW } = sampling(w, h, maxWidth);
  const r = new Uint32Array(outW * SCOPE_BINS);
  const g = new Uint32Array(outW * SCOPE_BINS);
  const b = new Uint32Array(outW * SCOPE_BINS);
  const rowStride = w * 4;
  const pStep = step * 4;
  for (let y = 0; y < h; y += step) {
    let p = y * rowStride;
    for (let c = 0; c < outW; c++, p += pStep) {
      const base = c << 8;
      r[base | data[p]!]!++;
      g[base | data[p + 1]!]!++;
      b[base | data[p + 2]!]!++;
    }
  }
  return { cols: outW, r, g, b, peak: Math.max(peakOf(r), peakOf(g), peakOf(b)) };
}

export interface Vectorscope {
  /** 256 × 256 counts; index = row * 256 + col, col = 128 + Cb, row = 128 − Cr. */
  bins: Uint32Array;
  peak: number;
  /** Pixels sampled. */
  total: number;
}

/** Vectorscope: 2D histogram of BT.709 Cb (x, right = +Cb) and Cr (y, up = +Cr). */
export function vectorscope(data: Pixels, w: number, h: number, maxWidth = Infinity): Vectorscope {
  const { step, outW } = sampling(w, h, maxWidth);
  const bins = new Uint32Array(SCOPE_BINS * SCOPE_BINS);
  const rowStride = w * 4;
  const pStep = step * 4;
  // Cb = (B − Y)/1.8556 and Cr = (R − Y)/1.5748 expanded into plain RGB weights.
  const cbR = -0.2126 / 1.8556;
  const cbG = -0.7152 / 1.8556;
  const cbB = (1 - 0.0722) / 1.8556;
  const crR = (1 - 0.2126) / 1.5748;
  const crG = -0.7152 / 1.5748;
  const crB = -0.0722 / 1.5748;
  let total = 0;
  for (let y = 0; y < h; y += step) {
    let p = y * rowStride;
    for (let c = 0; c < outW; c++, p += pStep) {
      const R = data[p]!;
      const G = data[p + 1]!;
      const B = data[p + 2]!;
      // +128.5 then truncation = round-half-up; values stay within 0.5 … 256 before clamping.
      let col = (128.5 + cbR * R + cbG * G + cbB * B) | 0;
      let row = (128.5 - (crR * R + crG * G + crB * B)) | 0;
      if (col > 255) col = 255;
      else if (col < 0) col = 0;
      if (row > 255) row = 255;
      else if (row < 0) row = 0;
      bins[(row << 8) | col]!++;
      total++;
    }
  }
  return { bins, peak: peakOf(bins), total };
}

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  /** Pixels sampled (each channel sums to this). */
  total: number;
  /** Largest bin across the four channels. */
  peak: number;
}

/** Histogram: 256 bins each for R, G, B and Rec.709 luma. */
export function histogram(data: Pixels, w: number, h: number, maxWidth = Infinity): Histogram {
  const { step, outW } = sampling(w, h, maxWidth);
  const r = new Uint32Array(SCOPE_BINS);
  const g = new Uint32Array(SCOPE_BINS);
  const b = new Uint32Array(SCOPE_BINS);
  const luma = new Uint32Array(SCOPE_BINS);
  const rowStride = w * 4;
  const pStep = step * 4;
  let total = 0;
  for (let y = 0; y < h; y += step) {
    let p = y * rowStride;
    for (let c = 0; c < outW; c++, p += pStep) {
      const R = data[p]!;
      const G = data[p + 1]!;
      const B = data[p + 2]!;
      r[R]!++;
      g[G]!++;
      b[B]!++;
      luma[(R * KR + G * KG + B * KB + 32768) >> 16]!++;
      total++;
    }
  }
  return { r, g, b, luma, total, peak: Math.max(peakOf(r), peakOf(g), peakOf(b), peakOf(luma)) };
}

export interface LumaStats {
  /** Lowest / highest luma code value present (0 / 0 for an empty frame). */
  min: number;
  max: number;
  /** Mean luma code value. */
  mean: number;
  /** Percentage (0–100) of sampled pixels below 16, above 235, and outside 16–235 in total. */
  belowPct: number;
  abovePct: number;
  outPct: number;
  total: number;
}

/** Luma statistics from a 256-bin luma histogram (e.g. `histogram(...).luma`). */
export function lumaStats(luma: Uint32Array): LumaStats {
  let min = -1;
  let max = 0;
  let total = 0;
  let sum = 0;
  let below = 0;
  let above = 0;
  for (let i = 0; i < SCOPE_BINS; i++) {
    const n = luma[i]!;
    if (!n) continue;
    if (min < 0) min = i;
    max = i;
    total += n;
    sum += n * i;
    if (i < legalRange.lo) below += n;
    else if (i > legalRange.hi) above += n;
  }
  const pct = (n: number) => (total ? (n * 100) / total : 0);
  return {
    min: Math.max(0, min),
    max,
    mean: total ? sum / total : 0,
    belowPct: pct(below),
    abovePct: pct(above),
    outPct: pct(below + above),
    total,
  };
}

/** Shortcut: luma statistics straight from the pixels. */
export function frameStats(data: Pixels, w: number, h: number, maxWidth = Infinity): LumaStats {
  return lumaStats(histogram(data, w, h, maxWidth).luma);
}

/** Collapses a waveform to a 256-bin luma histogram (sum over columns). */
export function waveformToHistogram(wf: Waveform): Uint32Array {
  const out = new Uint32Array(SCOPE_BINS);
  for (let c = 0; c < wf.cols; c++) {
    const base = c << 8;
    for (let i = 0; i < SCOPE_BINS; i++) out[i]! += wf.bins[base + i]!;
  }
  return out;
}

function peakOf(a: Uint32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) if (a[i]! > m) m = a[i]!;
  return m;
}
