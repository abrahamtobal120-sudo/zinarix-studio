import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  autoEdit,
  blurImage,
  coverScale,
  histogramOf,
  straightenImage,
  toneTables,
  vignetteImage,
  cleanEdit,
  colorPixels,
  cropImage,
  describeEdit,
  editedName,
  flattenOnWhite,
  flipEdit,
  formatOf,
  orient,
  outputSize,
  resizeImage,
  rotateEdit,
  sharpenImage,
  type Rgba,
} from '../src/shared/imageEdit.js';

/** A w × h picture whose pixel (x, y) is (x, y, x+y, 255). */
function grid(w: number, h: number): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set([x, y, x + y, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
const px = (img: Rgba, x: number, y: number) => [
  ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];
const solid = (w: number, h: number, c: number[]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(c, i);
  return { width: w, height: h, data };
};

describe('image editor geometry', () => {
  it('rotates clockwise and flips', () => {
    const g = grid(3, 2);
    const r = orient(g, 90);
    expect([r.width, r.height]).toEqual([2, 3]);
    // Top-left after a clockwise turn is the old bottom-left.
    expect(px(r, 0, 0).slice(0, 2)).toEqual([0, 1]);
    expect(px(r, 1, 0).slice(0, 2)).toEqual([0, 0]);
    expect(px(orient(g, 180), 0, 0).slice(0, 2)).toEqual([2, 1]);
    expect(px(orient(g, 270), 0, 0).slice(0, 2)).toEqual([2, 0]);
    expect(px(orient(g, 0, true), 0, 0).slice(0, 2)).toEqual([2, 0]);
    expect(px(orient(g, 0, false, true), 0, 0).slice(0, 2)).toEqual([0, 1]);
    // Four turns are the original.
    let back = g;
    for (let i = 0; i < 4; i++) back = orient(back, 90);
    expect(back.data).toEqual(g.data);
  });

  it('crops inside the picture', () => {
    const c = cropImage(grid(10, 10), { x: 2, y: 3, w: 4, h: 2 });
    expect([c.width, c.height]).toEqual([4, 2]);
    expect(px(c, 0, 0).slice(0, 2)).toEqual([2, 3]);
    // Past the edge is clamped.
    const k = cropImage(grid(10, 10), { x: 8, y: 8, w: 50, h: 50 });
    expect([k.width, k.height]).toEqual([2, 2]);
  });

  it('resizes keeping a flat colour flat, and averages when shrinking', () => {
    const big = resizeImage(solid(4, 4, [200, 100, 50, 255]), 9, 7);
    expect([big.width, big.height]).toEqual([9, 7]);
    expect(px(big, 4, 3)).toEqual([200, 100, 50, 255]);
    // Alternating black/white columns shrunk to one pixel per pair: mid grey, not black or white.
    const stripes = solid(8, 2, [0, 0, 0, 255]);
    for (let x = 1; x < 8; x += 2)
      for (let y = 0; y < 2; y++) stripes.data.set([255, 255, 255, 255], (y * 8 + x) * 4);
    const small = resizeImage(stripes, 4, 1);
    expect(px(small, 1, 0)[0]).toBeGreaterThan(90);
    expect(px(small, 1, 0)[0]).toBeLessThan(165);
  });

  it('carries the crop along when rotating or flipping', () => {
    // 100 × 50 picture, crop the 10 × 20 box at (5, 7).
    const e = { crop: { x: 5, y: 7, w: 10, h: 20 } };
    const r = rotateEdit(e, 100, 50, 1);
    expect(r.rotate).toBe(90);
    expect(r.crop).toEqual({ x: 50 - 7 - 20, y: 5, w: 20, h: 10 });
    // Same pixels either way.
    const g = grid(100, 50);
    const a = applyEdit(g, { ...e, rotate: 0 });
    const b = applyEdit(g, r);
    expect(orient(a, 90).data).toEqual(b.data);
    expect(rotateEdit(r, 100, 50, -1)).toEqual(e);
    const f = flipEdit(e, 100, 50, 'h');
    expect(applyEdit(g, f).data).toEqual(orient(a, 0, true).data);
  });

  it('knows the output size', () => {
    expect(outputSize(100, 50, { rotate: 90 })).toEqual({ w: 50, h: 100 });
    expect(outputSize(100, 50, { crop: { x: 0, y: 0, w: 30, h: 20 } })).toEqual({ w: 30, h: 20 });
    expect(outputSize(100, 50, { resize: { w: 10, h: 5 } })).toEqual({ w: 10, h: 5 });
  });
});

describe('image editor colour and filters', () => {
  it('leaves the picture alone with no adjustment', () => {
    const g = grid(5, 5);
    const copy = new Uint8ClampedArray(g.data);
    colorPixels(copy, {});
    expect(copy).toEqual(g.data);
    expect(applyEdit(g, {}).data).toEqual(g.data);
    expect(applyEdit(g, {}).data).not.toBe(g.data);
  });

  it('brightens, darkens, desaturates and tints', () => {
    const mid = () => new Uint8ClampedArray([100, 120, 140, 255]);
    let d = mid();
    colorPixels(d, { brightness: 50 });
    expect(d[0]).toBeGreaterThan(100);
    d = mid();
    colorPixels(d, { exposure: -1 });
    expect(d[0]).toBe(50);
    d = mid();
    colorPixels(d, { grayscale: 100 });
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
    d = mid();
    colorPixels(d, { temperature: 100 });
    expect(d[0]).toBeGreaterThan(100);
    expect(d[2]).toBeLessThan(140);
    d = mid();
    colorPixels(d, { contrast: -100 });
    expect([d[0], d[1], d[2]]).toEqual([128, 128, 128]);
    // Alpha is never touched.
    expect(d[3]).toBe(255);
  });

  it('blurs and sharpens without leaking the colour of transparent pixels', () => {
    const img = solid(9, 9, [0, 0, 0, 0]);
    img.data.set([255, 0, 0, 255], (4 * 9 + 4) * 4);
    const b = blurImage(img, 4);
    // A neighbour got some red and some opacity, but never turns dark from the transparent black.
    const n = px(b, 5, 4);
    expect(n[3]).toBeGreaterThan(0);
    expect(n[0]).toBe(255);
    const flat = solid(6, 6, [90, 90, 90, 255]);
    expect(px(sharpenImage(flat, 100), 3, 3)).toEqual([90, 90, 90, 255]);
  });

  it('a smaller preview gives the same result as the full picture made small', () => {
    const g = grid(80, 60);
    const e = { crop: { x: 10, y: 10, w: 40, h: 30 }, contrast: 20 };
    const full = applyEdit(g, e);
    const preview = applyEdit(resizeImage(g, 40, 30), e, 0.5);
    expect([preview.width, preview.height]).toEqual([20, 15]);
    const down = resizeImage(full, 20, 15);
    const diff = Math.abs(px(down, 10, 7)[0]! - px(preview, 10, 7)[0]!);
    expect(diff).toBeLessThan(6);
  });

  it('flattens over white for JPEG', () => {
    const f = flattenOnWhite(solid(1, 1, [0, 0, 0, 0]));
    expect(px(f, 0, 0)).toEqual([255, 255, 255, 255]);
  });
});

describe('image edit arguments', () => {
  it('cleans what the agent sends', () => {
    const e = cleanEdit(
      {
        rotate: -90,
        flipH: true,
        flipV: 'yes',
        crop: { x: -5, y: 0, w: 1000, h: 10 },
        brightness: 500,
        contrast: 0,
        blur: 'x',
        evil: 1,
      },
      200,
      100,
    );
    expect(e).toEqual({
      rotate: 270,
      flipH: true,
      crop: { x: 0, y: 0, w: 100, h: 10 },
      brightness: 100,
    });
    // A crop of the whole picture and a resize to the same size are dropped.
    expect(
      cleanEdit({ crop: { x: 0, y: 0, w: 20, h: 10 }, resize: { w: 20, h: 10 } }, 20, 10),
    ).toEqual({});
    expect(cleanEdit(null, 1, 1)).toEqual({});
  });

  it('describes, names and picks formats', () => {
    expect(describeEdit({ rotate: 90, brightness: 20, blur: 3 })).toBe(
      'girar 90°, brillo +20, desenfoque 3',
    );
    expect(describeEdit({})).toBe('sin cambios');
    expect(editedName('fotos/gato.jpg')).toBe('fotos/gato-editada.jpg');
    expect(editedName('fotos/gato.jpg', 'webp')).toBe('fotos/gato-editada.webp');
    expect(formatOf('a.JPEG')).toBe('jpg');
    expect(formatOf('a.gif')).toBeNull();
  });
});

describe('image editor: straighten, light, colour and auto', () => {
  it('straightens keeping the size and no empty corner', () => {
    const s = solid(40, 30, [120, 80, 40, 255]);
    const t = straightenImage(s, 10);
    expect([t.width, t.height]).toEqual([40, 30]);
    // Zoomed to fill: every pixel stays opaque and of the same colour.
    for (let i = 3; i < t.data.length; i += 4) expect(t.data[i]).toBe(255);
    expect(px(t, 0, 0)).toEqual([120, 80, 40, 255]);
    expect(straightenImage(s, 0)).toBe(s);
    expect(coverScale(40, 30, 0)).toBe(1);
    expect(coverScale(40, 30, 10)).toBeCloseTo(coverScale(40, 30, -10));
    // The centre of a gradient barely moves.
    const g = grid(41, 41);
    expect(px(straightenImage(g, 5), 20, 20)).toEqual(px(g, 20, 20));
  });

  it('a mirror turns the tilt the other way', () => {
    const g = grid(30, 20);
    const e = { straighten: 6 };
    const f = flipEdit(e, 30, 20, 'h');
    expect(f.straighten).toBe(-6);
    const a = orient(applyEdit(g, e), 0, true);
    const b = applyEdit(g, f);
    let diff = 0;
    for (let i = 0; i < a.data.length; i++)
      diff = Math.max(diff, Math.abs(a.data[i]! - b.data[i]!));
    expect(diff).toBeLessThanOrEqual(2);
    // A quarter turn keeps the same straighten.
    expect(rotateEdit(e, 30, 20, 1).straighten).toBe(6);
  });

  it('shadows lift only the dark, highlights only the bright', () => {
    const dark = new Uint8ClampedArray([
      30, 30, 30, 255, 230, 230, 230, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    const a = new Uint8ClampedArray(dark);
    colorPixels(a, { shadows: 60 });
    expect(a[0]! - 30).toBeGreaterThan(10);
    expect(Math.abs(a[4]! - 230)).toBeLessThan(5);
    expect([a[8], a[12]]).toEqual([0, 255]);
    const b = new Uint8ClampedArray(dark);
    colorPixels(b, { highlights: -60 });
    expect(230 - b[4]!).toBeGreaterThan(10);
    expect(Math.abs(b[0]! - 30)).toBeLessThan(5);
    // The curve keeps rising at the extremes of the range.
    for (const sh of [-100, 100])
      for (const hi of [-100, 100]) {
        const [t] = toneTables({ shadows: sh, highlights: hi })!;
        for (let i = 1; i < 256; i++) expect(t[i]!).toBeGreaterThanOrEqual(t[i - 1]!);
      }
  });

  it('turns the hue, leaves grey alone, and vibrance spares strong colours', () => {
    const p = new Uint8ClampedArray([200, 40, 40, 255, 128, 128, 128, 255]);
    colorPixels(p, { hue: 120 });
    expect(p[1]!).toBeGreaterThan(p[0]!); // red turned green-ish
    expect([...p.subarray(4, 7)].every((v) => Math.abs(v - 128) <= 1)).toBe(true);
    const dull = new Uint8ClampedArray([140, 120, 110, 255]);
    const strong = new Uint8ClampedArray([230, 30, 30, 255]);
    colorPixels(dull, { vibrance: 80 });
    colorPixels(strong, { vibrance: 80 });
    // The dull one gains much more colour (in proportion) than the strong one.
    const dullGain = (dull[0]! - dull[2]!) / 30;
    const strongGain = (strong[0]! - strong[2]!) / 200;
    expect(dullGain).toBeGreaterThan(1.4);
    expect(strongGain).toBeLessThan(1.15);
  });

  it('darkens the corners, not the centre, at any size', () => {
    const s = solid(50, 50, [200, 200, 200, 255]);
    const v = vignetteImage(s, 80);
    expect(px(v, 25, 25)[0]).toBe(200);
    expect(px(v, 0, 0)[0]!).toBeLessThan(80);
    const l = vignetteImage(s, -80);
    expect(px(l, 0, 0)[0]!).toBeGreaterThan(230);
    const small = vignetteImage(solid(25, 25, [200, 200, 200, 255]), 80);
    expect(Math.abs(px(small, 0, 0)[0]! - px(v, 0, 0)[0]!)).toBeLessThan(8);
  });

  it('counts the histogram and finds an automatic fix', () => {
    const h = histogramOf(solid(10, 10, [10, 20, 30, 255]));
    expect([h.r[10], h.g[20], h.b[30]]).toEqual([100, 100, 100]);
    // Dull and bluish: more contrast, warmer, and brighter (it is dark).
    const data = new Uint8ClampedArray(100 * 10 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const v = 50 + ((i / 4) % 100) * 0.6;
      data.set([v - 10, v, v + 20, 255], i);
    }
    const e = autoEdit({ width: 100, height: 10, data });
    expect(e.contrast!).toBeGreaterThan(10);
    expect(e.temperature!).toBeGreaterThan(0);
    expect(e.brightness!).toBeGreaterThan(0);
    expect(autoEdit(solid(4, 4, [0, 0, 0, 0]))).toEqual({});
  });

  it('cleans and describes the new values', () => {
    expect(cleanEdit({ straighten: 80, hue: -400, vignette: 20, vibrance: 0 }, 10, 10)).toEqual({
      straighten: 45,
      hue: -180,
      vignette: 20,
    });
    expect(describeEdit({ straighten: -2.5, shadows: 30, hue: 15, vignette: 40 })).toBe(
      'enderezar -2.5°, sombras +30, tono +15°, viñeta +40',
    );
  });
});
