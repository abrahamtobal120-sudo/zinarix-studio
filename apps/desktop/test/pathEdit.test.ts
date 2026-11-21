// @vitest-environment jsdom
// Fase 3 mejorada: editing the points of paths, text that wraps, the new templates and the
// paint helpers (brushes, symmetry, transform).
import { describe, expect, it } from 'vitest';
import {
  arcToCubics,
  deleteNodes,
  ellipsePathData,
  insertNode,
  moveHandle,
  nearestOnPath,
  parsePathData,
  pointsPathData,
  rectPathData,
  segmentPoints,
  serializePathData,
  setNodeType,
} from '../src/shared/pathEdit.js';
import { TEMPLATES, buildTemplate, svgSize, wrapText } from '../src/shared/graphics.js';
import { diskPoints, mirrorPoints, mulberry32, pixelBox, rectMap, scaleRect } from '../src/shared/paint.js';
import { setTextLines, textValue } from '../src/renderer/components/vector/vectorSession.js';

const close = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('path data', () => {
  it('reads lines, relative moves, H / V and Z into nodes', () => {
    const subs = parsePathData('M10 10 h 20 v20 H10 z m 5 5 l 1 1');
    expect(subs).toHaveLength(2);
    expect(subs[0]!.closed).toBe(true);
    expect(subs[0]!.nodes.map((n) => [n.x, n.y])).toEqual([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);
    // After Z the current point is the start of the closed sub-path.
    expect(subs[1]!.nodes.map((n) => [n.x, n.y])).toEqual([
      [15, 15],
      [16, 16],
    ]);
  });

  it('round-trips curves (C, S, Q, T) without changing the shape', () => {
    const d = 'M 0 0 C 10 0 20 10 20 20 S 30 40 40 40 Q 50 40 50 50 T 60 60';
    const subs = parsePathData(d);
    const once = serializePathData(subs);
    // Written with 4 decimals: reading it back and writing again gives the same text.
    expect(serializePathData(parsePathData(once))).toBe(once);
    expect(parsePathData(once)[0]!.nodes).toHaveLength(subs[0]!.nodes.length);
    const n = subs[0]!.nodes;
    // S mirrors the last control point: the node at (20,20) is smooth.
    expect(n[1]).toMatchObject({ x: 20, y: 20, ix: 20, iy: 10, ox: 20, oy: 30, smooth: true });
    // Q becomes a cubic with control points at 2/3 of the way to the quadratic one.
    close(n[2]!.ox!, 40 + (2 / 3) * 10);
    close(n[3]!.ix!, 50);
  });

  it('a closing node on top of the first one is merged', () => {
    const subs = parsePathData('M 0 0 C 0 -5 10 -5 10 0 C 10 5 0 5 0 0 Z');
    expect(subs[0]!.nodes).toHaveLength(2);
    expect(subs[0]!.nodes[0]).toMatchObject({ ix: 0, iy: 5 });
    expect(serializePathData(subs)).toBe('M 0 0 C 0 -5 10 -5 10 0 C 10 5 0 5 0 0 Z');
  });

  it('arcs become cubic curves through the right end point', () => {
    const parts = arcToCubics(0, 0, 10, 10, 0, false, true, 20, 0);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    const end = parts[parts.length - 1]![2];
    expect(end).toEqual({ x: 20, y: 0 });
    // Half circle: the middle reaches 10 units away from the center (10, 0).
    const subs = parsePathData('M0 0 A10 10 0 0 1 20 0');
    const mid = subs[0]!.nodes[1]!;
    close(Math.hypot(mid.x - 10, mid.y), 10);
    // Flags written without spaces.
    expect(parsePathData('M0 0a10 10 0 0120 0')[0]!.nodes.at(-1)).toMatchObject({ x: 20, y: 0 });
  });

  it('rejects broken data', () => {
    expect(() => parsePathData('10 10 L 5')).toThrow();
    expect(() => parsePathData('M 0 0 L 5')).toThrow();
  });
});

describe('editing nodes', () => {
  it('inserting a point keeps the curve the same', () => {
    const subs = parsePathData('M 0 0 C 0 50 100 50 100 0');
    const before = segmentPoints(subs[0]!, 0)!;
    const near = nearestOnPath(subs, { x: 50, y: 40 })!;
    expect(near.seg).toBe(0);
    close(near.t, 0.5, 0.01);
    const i = insertNode(subs[0]!, 0, 0.5);
    expect(i).toBe(1);
    const mid = subs[0]!.nodes[1]!;
    // B(0.5) of the original curve.
    const b = (t: number) => {
      const u = 1 - t;
      return u * u * u * before[0].y + 3 * u * u * t * before[1].y + 3 * u * t * t * before[2].y + t * t * t * before[3].y;
    };
    close(mid.y, b(0.5));
    close(mid.x, 50);
    expect(mid.smooth).toBe(true);
  });

  it('inserting on a straight line adds a plain point', () => {
    const subs = parsePathData('M 0 0 L 10 0');
    insertNode(subs[0]!, 0, 0.3);
    expect(serializePathData(subs)).toBe('M 0 0 L 3 0 L 10 0');
  });

  it('deletes points and drops sub-paths left with one point', () => {
    const subs = parsePathData('M 0 0 L 10 0 L 10 10 M 50 50 L 60 60');
    const out = deleteNodes(subs, new Set(['0:1', '1:0']));
    expect(out).toHaveLength(1);
    expect(serializePathData(out)).toBe('M 0 0 L 10 10');
  });

  it('corner and smooth points, and smooth handles turning together', () => {
    const subs = parsePathData('M 0 0 L 10 0 L 20 0');
    setNodeType(subs[0]!, 1, 'smooth');
    const n = subs[0]!.nodes[1]!;
    expect(n).toMatchObject({ smooth: true });
    close(n.ix!, 10 - 10 / 3);
    close(n.ox!, 10 + 10 / 3);
    moveHandle(n, 'out', { x: 10, y: 5 });
    // The incoming one turns to the opposite side and keeps its length.
    close(n.ix!, 10);
    close(n.iy!, -10 / 3);
    moveHandle(n, 'out', { x: 15, y: 0 }, true);
    expect(n.smooth).toBe(false);
    close(n.iy!, -10 / 3);
    setNodeType(subs[0]!, 1, 'corner');
    expect(serializePathData(subs)).toBe('M 0 0 L 10 0 L 20 0');
  });

  it('shapes as paths', () => {
    expect(rectPathData(0, 0, 10, 20)).toBe('M 0 0 L 10 0 L 10 20 L 0 20 Z');
    expect(parsePathData(rectPathData(0, 0, 100, 50, 10))[0]!.nodes).toHaveLength(8);
    const e = parsePathData(ellipsePathData(50, 50, 40, 20))[0]!;
    expect(e.closed).toBe(true);
    expect(e.nodes.map((n) => [n.x, n.y])).toEqual([
      [90, 50],
      [50, 70],
      [10, 50],
      [50, 30],
    ]);
    expect(e.nodes.every((n) => n.smooth)).toBe(true);
    expect(pointsPathData('0,0 10,0 10,10', true)).toBe('M 0 0 L 10 0 L 10 10 Z');
  });
});

describe('text that wraps to a width', () => {
  const mono = (s: string) => s.length * 10;

  it('breaks at spaces, keeps Enter, cuts a word that does not fit', () => {
    expect(wrapText('uno dos tres cuatro', 75, mono)).toEqual([
      { text: 'uno dos', soft: false },
      { text: 'tres', soft: true },
      { text: 'cuatro', soft: true },
    ]);
    expect(wrapText('a b\nc', 1000, mono)).toEqual([
      { text: 'a b', soft: false },
      { text: 'c', soft: false },
    ]);
    expect(wrapText('abcdefghij', 40, mono).map((l) => l.text)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('sin ancho', 0, mono)).toEqual([{ text: 'sin ancho', soft: false }]);
  });

  it('the SVG text keeps the paragraphs: wrapped lines come back joined with a space', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text') as SVGTextElement;
    el.setAttribute('x', '10');
    el.setAttribute('font-size', '10');
    // No layout in jsdom: the width is estimated (0.55 em per letter = 5.5 px).
    el.setAttribute('data-wrap-width', '60');
    setTextLines(el, 'hola mundo bonito\nfin');
    const spans = [...el.querySelectorAll('tspan')];
    expect(spans.length).toBeGreaterThan(2);
    expect(spans.some((t) => t.getAttribute('data-soft') === '1')).toBe(true);
    expect(spans.every((t) => t.getAttribute('x') === '10')).toBe(true);
    expect(textValue(el)).toBe('hola mundo bonito\nfin');
  });
});

describe('new templates', () => {
  it('has the invitation, menu, certificate and sale designs, all valid SVG', () => {
    for (const id of ['invitation', 'menu', 'certificate', 'sale']) {
      const t = TEMPLATES.find((x) => x.id === id)!;
      expect(t).toBeTruthy();
      const svg = buildTemplate({ template: id, palette: 'mono', lang: 'en' });
      expect(svgSize(svg)).toEqual({ width: t.width, height: t.height });
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.querySelectorAll('text').length).toBeGreaterThan(0);
    }
    expect(TEMPLATES.length).toBe(13);
  });
});

describe('paint helpers', () => {
  it('seeded random numbers repeat and stay in 0…1', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('spray points stay inside the brush circle', () => {
    const pts = diskPoints(100, 100, 20, 300, mulberry32(3));
    expect(pts).toHaveLength(300);
    expect(pts.every((p) => Math.hypot(p.x - 100, p.y - 100) <= 20 + 1e-9)).toBe(true);
  });

  it('symmetry mirrors across the middle of the canvas', () => {
    expect(mirrorPoints('none', 10, 20, 100, 200)).toEqual([{ x: 10, y: 20 }]);
    expect(mirrorPoints('x', 10, 20, 100, 200)).toEqual([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
    ]);
    expect(mirrorPoints('xy', 10, 20, 100, 200)).toHaveLength(4);
  });

  it('moving and scaling a box of pixels', () => {
    expect(pixelBox([{ x: -5, y: 2.5 }, { x: 10.2, y: 300 }], 50, 50)).toEqual({ x: 0, y: 2, w: 11, h: 48 });
    expect(pixelBox([{ x: 60, y: 60 }, { x: 70, y: 70 }], 50, 50)).toBeNull();
    const m = rectMap({ x: 10, y: 10, w: 20, h: 10 }, { x: 0, y: 0, w: 40, h: 20 });
    expect(m).toEqual([2, 0, 0, 2, -20, -20]);
    // Flipped: the left edge lands on the right.
    const f = rectMap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }, true);
    expect(f[0] * 0 + f[4]).toBe(10);
    expect(scaleRect({ x: 0, y: 0, w: 100, h: 50 }, 'se', 200, 60, true)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(scaleRect({ x: 0, y: 0, w: 100, h: 50 }, 'nw', 50, 10, false)).toEqual({ x: 50, y: 10, w: 50, h: 40 });
  });
});
