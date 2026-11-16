import { describe, expect, it } from 'vitest';
import {
  BAR_75,
  COLOR_BAR_TARGETS,
  SKIN_TONE_ANGLE,
  cbcrAngle,
  colorAngle,
  frameStats,
  histogram,
  legalRange,
  luma709,
  lumaStats,
  parade,
  sampling,
  vectorscope,
  waveform,
  waveformToHistogram,
} from '../src/shared/videoScopes';

type Rgb = [number, number, number];

function image(w: number, h: number, at: (x: number, y: number) => Rgb): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const o = (y * w + x) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  return d;
}

const V = BAR_75;
// SMPTE-like 75% bars, left to right: white, Y, C, G, M, R, B.
const BARS: [string, Rgb][] = [
  ['W', [V, V, V]],
  ['Y', [V, V, 0]],
  ['C', [0, V, V]],
  ['G', [0, V, 0]],
  ['M', [V, 0, V]],
  ['R', [V, 0, 0]],
  ['B', [0, 0, V]],
];
const BW = 7 * 40;
const BH = 60;
const bars = image(BW, BH, (x) => BARS[Math.floor(x / 40)]![1]);

/** Angular distance in degrees. */
const dAngle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('videoScopes', () => {
  it('luma709 maps the extremes and weights green most', () => {
    expect(luma709(0, 0, 0)).toBe(0);
    expect(luma709(255, 255, 255)).toBe(255);
    expect(luma709(0, 255, 0)).toBeGreaterThan(luma709(255, 0, 0));
    expect(luma709(255, 0, 0)).toBeGreaterThan(luma709(0, 0, 255));
  });

  it('angle convention: 0° = +Cb, 90° = +Cr; red ≈ 103°, skin line ≈ 123°', () => {
    expect(cbcrAngle(1, 0)).toBeCloseTo(0);
    expect(cbcrAngle(0, 1)).toBeCloseTo(90);
    expect(cbcrAngle(0, -1)).toBeCloseTo(270);
    expect(dAngle(colorAngle(V, 0, 0).angle, 103)).toBeLessThan(2);
    expect(SKIN_TONE_ANGLE).toBe(123);
    // A typical skin tone sits near the line.
    expect(dAngle(colorAngle(224, 172, 140).angle, SKIN_TONE_ANGLE)).toBeLessThan(10);
  });

  it('colour bars: each bar peaks at its target angle (±3°)', () => {
    const v = vectorscope(bars, BW, BH);
    expect(v.total).toBe(BW * BH);
    for (const t of COLOR_BAR_TARGETS) {
      // Peak in the target's half-plane neighbourhood: find the strongest bin within 12 bins of it.
      let best = 0;
      let bestCol = 0;
      let bestRow = 0;
      for (let row = t.row - 12; row <= t.row + 12; row++)
        for (let col = t.col - 12; col <= t.col + 12; col++) {
          const n = v.bins[row * 256 + col]!;
          if (n > best) [best, bestCol, bestRow] = [n, col, row];
        }
      expect(best, t.name).toBe(40 * BH);
      const angle = cbcrAngle(bestCol - 128, 128 - bestRow);
      expect(dAngle(angle, t.angle), t.name).toBeLessThan(3);
    }
    // White sits in the centre.
    expect(v.bins[128 * 256 + 128]).toBe(40 * BH);
  });

  it('75% bar targets sit at the BT.709 Cb/Cr angles, complements opposite', () => {
    const a = Object.fromEntries(COLOR_BAR_TARGETS.map((t) => [t.name, t.angle]));
    // BT.709 positions (degrees, counter-clockwise from +Cb). Rec.601 scopes put M/G/Y/B a few
    // degrees elsewhere (e.g. M 61°), which is why the 709 values are pinned here.
    const ref = { R: 102.9, Y: 174.8, G: 229.7, C: 282.9, B: 354.8, M: 49.7 };
    for (const [k, deg] of Object.entries(ref)) expect(dAngle(a[k]!, deg), k).toBeLessThan(0.2);
    for (const [x, y] of [['R', 'C'], ['G', 'M'], ['B', 'Y']] as const) expect(dAngle(a[x]!, a[y]! + 180)).toBeLessThan(0.2);
  });

  it('histogram counts sum to the pixel count', () => {
    const h = histogram(bars, BW, BH);
    const sum = (a: Uint32Array) => a.reduce((s, n) => s + n, 0);
    expect(h.total).toBe(BW * BH);
    for (const ch of [h.r, h.g, h.b, h.luma]) expect(sum(ch)).toBe(BW * BH);
    // R channel: 4 bars at 191 (W, Y, M, R), 3 at 0.
    expect(h.r[V]).toBe(4 * 40 * BH);
    expect(h.r[0]).toBe(3 * 40 * BH);
  });

  it('flat grey → the waveform lives in one bin per column', () => {
    const w = 64;
    const h = 32;
    const wf = waveform(image(w, h, () => [128, 128, 128]), w, h);
    expect(wf.cols).toBe(w);
    for (let c = 0; c < w; c++)
      for (let lv = 0; lv < 256; lv++) expect(wf.bins[c * 256 + lv]).toBe(lv === 128 ? h : 0);
    expect(wf.peak).toBe(h);
  });

  it('parade splits the channels', () => {
    const p = parade(image(10, 5, () => [10, 20, 30]), 10, 5);
    expect(p.r[3 * 256 + 10]).toBe(5);
    expect(p.g[3 * 256 + 20]).toBe(5);
    expect(p.b[3 * 256 + 30]).toBe(5);
    expect(p.peak).toBe(5);
  });

  it('a grey ramp gives min/max luma', () => {
    const ramp = image(256, 4, (x) => [x, x, x]);
    const s = frameStats(ramp, 256, 4);
    expect(s.min).toBe(0);
    expect(s.max).toBe(255);
    expect(s.mean).toBeCloseTo(127.5, 5);
    // 0..15 below, 236..255 above: 16 + 20 of 256 levels.
    expect(s.belowPct).toBeCloseTo((16 / 256) * 100, 5);
    expect(s.abovePct).toBeCloseTo((20 / 256) * 100, 5);
    expect(s.outPct).toBeCloseTo((36 / 256) * 100, 5);
    const narrow = frameStats(image(100, 2, (x) => [40 + x, 40 + x, 40 + x]), 100, 2);
    expect([narrow.min, narrow.max, narrow.outPct]).toEqual([40, 139, 0]);
  });

  it('overexposed image → out-of-range percentage', () => {
    // 30% of the frame clipped to white, the rest legal.
    const img = image(100, 10, (x) => (x < 30 ? [255, 255, 255] : [120, 120, 120]));
    const s = frameStats(img, 100, 10);
    expect(s.abovePct).toBeCloseTo(30, 5);
    expect(s.belowPct).toBe(0);
    expect(s.outPct).toBeCloseTo(30, 5);
    expect(s.max).toBeGreaterThan(legalRange.hi);
    expect(legalRange).toEqual({ lo: 16, hi: 235 });
  });

  it('maxWidth subsampling keeps proportions and bounds the output', () => {
    const w = 1920;
    const h = 1080;
    // Left quarter red, rest blue.
    const img = image(w, h, (x) => (x < w / 4 ? [200, 0, 0] : [0, 0, 200]));
    const { step, outW, outH } = sampling(w, h, 512);
    expect(step).toBe(4);
    expect(outW).toBeLessThanOrEqual(512);
    expect(outH).toBe(270);
    const full = histogram(img, w, h);
    const sub = histogram(img, w, h, 512);
    expect(sub.total).toBe(outW * outH);
    expect(sub.r[200]! / sub.total).toBeCloseTo(full.r[200]! / full.total, 2);
    const wf = waveform(img, w, h, 512);
    expect(wf.cols).toBe(outW);
    // Each column holds outH samples; the redness boundary lands at a quarter of the columns.
    const redLuma = luma709(200, 0, 0);
    expect(wf.bins[0 * 256 + redLuma]).toBe(outH);
    expect(wf.bins[(outW / 4 - 1) * 256 + redLuma]).toBe(outH);
    expect(wf.bins[(outW / 4) * 256 + redLuma]).toBe(0);
    // Waveform collapsed equals the luma histogram of the same sample.
    expect(Array.from(waveformToHistogram(wf))).toEqual(Array.from(sub.luma));
    expect(lumaStats(sub.luma).total).toBe(sub.total);
  });

  it('a 512-wide frame is fast', () => {
    const w = 512;
    const h = 288;
    const img = image(w, h, (x, y) => [(x * 7) & 255, (y * 3) & 255, (x + y) & 255]);
    // Warm up the JIT, then time all four scopes together.
    for (let i = 0; i < 3; i++) {
      waveform(img, w, h);
      vectorscope(img, w, h);
    }
    const t0 = performance.now();
    waveform(img, w, h);
    parade(img, w, h);
    vectorscope(img, w, h);
    histogram(img, w, h);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
