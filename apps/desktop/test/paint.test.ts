// Fase 3A (plan de funciones): bucket fill, brush dabs and the .zdraw format.
import { describe, expect, it } from 'vitest';
import {
  floodFill,
  hexToRgba,
  normPressure,
  parsePaintFile,
  rgbToHex,
  serializePaintFile,
  stampsBetween,
} from '../src/shared/paint.js';

function img(w: number, h: number, fill: [number, number, number, number]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set(fill, i * 4);
  return a;
}
const px = (a: Uint8ClampedArray, w: number, x: number, y: number) => [
  ...a.subarray((y * w + x) * 4, (y * w + x) * 4 + 4),
];

describe('bucket fill', () => {
  it('fills the connected area only, up to a wall, and grows one pixel', () => {
    const w = 10;
    const h = 5;
    const a = img(w, h, [255, 255, 255, 255]);
    // A black wall at x = 5.
    for (let y = 0; y < h; y++) a.set([0, 0, 0, 255], (y * w + 5) * 4);
    const box = floodFill(a, a.slice(), w, h, 1, 1, hexToRgba('#ff0000'), 10);
    expect(box).toEqual({ x: 0, y: 0, w: 6, h: 5 });
    expect(px(a, w, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(a, w, 4, 4)).toEqual([255, 0, 0, 255]);
    // The wall pixel next to the area is covered (no halo); beyond it nothing changes.
    expect(px(a, w, 5, 2)).toEqual([255, 0, 0, 255]);
    expect(px(a, w, 7, 2)).toEqual([255, 255, 255, 255]);
  });

  it('tolerance takes similar colors; the sample can differ from the target', () => {
    const w = 4;
    const h = 1;
    const sample = img(w, h, [100, 100, 100, 255]);
    sample.set([120, 100, 100, 255], 2 * 4);
    sample.set([200, 0, 0, 255], 3 * 4);
    const target = new Uint8ClampedArray(w * h * 4); // an empty layer
    floodFill(target, sample, w, h, 0, 0, hexToRgba('#0000ff'), 25);
    expect(px(target, w, 2, 0)).toEqual([0, 0, 255, 255]);
    // x = 3 is outside the tolerance but touches the area: the one-pixel edge covers it.
    expect(px(target, w, 3, 0)).toEqual([0, 0, 255, 255]);
    const t2 = new Uint8ClampedArray(w * h * 4);
    floodFill(t2, sample, w, h, 0, 0, hexToRgba('#0000ff'), 5);
    expect(px(t2, w, 2, 0)).toEqual([0, 0, 255, 255]); // edge of the area (x = 0…1)
    expect(px(t2, w, 3, 0)).toEqual([0, 0, 0, 0]);
  });

  it('outside the picture does nothing; a big area does not overflow the stack', () => {
    const a = img(3, 3, [0, 0, 0, 0]);
    expect(floodFill(a, a, 3, 3, -1, 0, hexToRgba('#ffffff'), 0)).toBeNull();
    const w = 1500;
    const h = 1500;
    const big = new Uint8ClampedArray(w * h * 4);
    expect(floodFill(big, big.slice(), w, h, 700, 700, hexToRgba('#00ff00'), 0)).toEqual({
      x: 0,
      y: 0,
      w,
      h,
    });
    expect(px(big, w, w - 1, h - 1)).toEqual([0, 255, 0, 255]);
  });
});

describe('brush', () => {
  it('dabs are evenly spaced along a stroke, carrying the remainder', () => {
    const o = { size: 10, sizePressure: false, flowPressure: false, spacing: 0.5 };
    const first = stampsBetween({ x: 0, y: 0, pressure: 1 }, { x: 0, y: 0, pressure: 1 }, o, 0);
    expect(first.stamps).toHaveLength(1);
    const a = stampsBetween(
      { x: 0, y: 0, pressure: 1 },
      { x: 12, y: 0, pressure: 1 },
      o,
      first.carry,
    );
    expect(a.stamps.map((s) => s.x)).toEqual([5, 10]);
    const b = stampsBetween({ x: 12, y: 0, pressure: 1 }, { x: 20, y: 0, pressure: 1 }, o, a.carry);
    expect(b.stamps.map((s) => s.x)).toEqual([15, 20]);
  });

  it('pen pressure changes size and flow; mouse is full strength', () => {
    const o = { size: 20, sizePressure: true, flowPressure: true, spacing: 1 };
    const r = stampsBetween({ x: 0, y: 0, pressure: 0.25 }, { x: 0, y: 0, pressure: 0.25 }, o, 0);
    expect(r.stamps[0]).toMatchObject({ size: 5, alpha: 0.25 });
    expect(normPressure('mouse', 0.5)).toBe(1);
    expect(normPressure('pen', 0.3)).toBe(0.3);
    expect(normPressure('pen', 0)).toBe(0.05);
  });

  it('colors', () => {
    expect(hexToRgba('#102030')).toEqual({ r: 16, g: 32, b: 48, a: 255 });
    expect(rgbToHex(16, 32, 300)).toBe('#1020ff');
  });
});

describe('.zdraw files', () => {
  it('round-trips and normalizes', () => {
    const text = serializePaintFile({
      width: 10,
      height: 20,
      layers: [{ name: 'Fondo', visible: true, opacity: 1, blend: 'normal', png: 'AAAA' }],
    });
    expect(parsePaintFile(text)).toEqual({
      format: 'zinarix-draw',
      version: 1,
      width: 10,
      height: 20,
      layers: [{ name: 'Fondo', visible: true, opacity: 1, blend: 'normal', png: 'AAAA' }],
    });
    const odd = parsePaintFile(
      JSON.stringify({
        format: 'zinarix-draw',
        width: 5,
        height: 5,
        layers: [{ opacity: 7, blend: 'weird', png: 'data:image/png;base64,QQ==' }],
      }),
    );
    expect(odd.layers[0]).toEqual({
      name: 'Capa 1',
      visible: true,
      opacity: 1,
      blend: 'normal',
      png: 'QQ==',
    });
  });

  it('refuses broken files', () => {
    expect(() => parsePaintFile('{')).toThrow(/damaged/);
    expect(() => parsePaintFile('{"format":"x"}')).toThrow(/not a Zinarix drawing/);
    expect(() =>
      parsePaintFile('{"format":"zinarix-draw","width":0,"height":5,"layers":[{}]}'),
    ).toThrow(/size/);
    expect(() =>
      parsePaintFile('{"format":"zinarix-draw","width":5,"height":5,"layers":[]}'),
    ).toThrow(/no layers/);
  });
});
