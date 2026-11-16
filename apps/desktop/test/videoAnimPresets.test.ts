import { describe, expect, it } from 'vitest';
import {
  ANIM_KINDS,
  animLook,
  lookMaxScale,
  presetDef,
  TRANSITION_KINDS,
  transitionLook,
  validAnim,
  validTransition,
  windowExpr,
  type Look,
  type LookExpr,
} from '../src/shared/videoFx.js';

/** Evaluates one of our FFmpeg expressions (numbers, K, clip, if, lt, min) in JS. */
function evalExpr(expr: string, k: number): number {
  const js = expr.replace(/\bif\(/g, 'iff(').replace(/\bK\b/g, 'k');
  const f = new Function('k', 'clip', 'iff', 'lt', 'min', `return ${js};`) as (
    k: number,
    clip: (x: number, a: number, b: number) => number,
    iff: (c: number, a: number, b: number) => number,
    lt: (a: number, b: number) => number,
    min: (a: number, b: number) => number,
  ) => number;
  return f(
    k,
    (x, a, b) => Math.min(b, Math.max(a, x)),
    (c, a, b) => (c ? a : b),
    (a, b) => (a < b ? 1 : 0),
    Math.min,
  );
}

const DEFAULTS: Look = { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };
function sameLook(ex: LookExpr, l: Look, k: number) {
  for (const key of Object.keys(DEFAULTS) as (keyof Look)[]) {
    const v = ex[key] ? evalExpr(ex[key]!, k) : DEFAULTS[key];
    expect(v, `${key} at ${k}`).toBeCloseTo(l[key], 5);
  }
}

const inPlace = (l: Look) =>
  (Object.keys(DEFAULTS) as (keyof Look)[]).forEach((key) =>
    expect(l[key] + 0).toBeCloseTo(DEFAULTS[key], 9),
  );

const STEPS = [0, 0.1, 0.23, 0.4, 0.5, 0.66, 0.8, 0.95, 1];

describe('built-in animations and transitions', () => {
  it('has many more of both', () => {
    expect(ANIM_KINDS.length).toBeGreaterThanOrEqual(20);
    expect(TRANSITION_KINDS.length).toBeGreaterThanOrEqual(16);
  });

  it('every transition ends with the clip in place, and the export matches the preview', () => {
    for (const kind of TRANSITION_KINDS) {
      inPlace(transitionLook(kind, 1));
      const ex = windowExpr(kind, 'K', 0, 1, true);
      for (const k of STEPS) sameLook(ex, transitionLook(kind, k), k);
      expect(validTransition({ kind, d: 0.6 }), kind).toBe(true);
    }
  });

  it('every in / out animation ends in place, and the export matches the preview', () => {
    for (const kind of ANIM_KINDS) {
      inPlace(animLook(kind, 1));
      if (kind === 'none') continue;
      const ex = windowExpr(kind, 'K', 0, 1, true);
      for (const k of STEPS) sameLook(ex, animLook(kind, k), k);
      expect(validAnim({ in: kind, out: kind }), kind).toBe(true);
    }
  });

  it('the new ones actually move (not just a fade)', () => {
    for (const kind of ['bounce', 'elastic', 'whip', 'punch', 'pushUp', 'diagonal'] as const) {
      const moved = STEPS.some((k) => {
        const l = transitionLook(kind, k);
        return Math.abs(l.dx) + Math.abs(l.dy) + Math.abs(l.scale - 1) > 0.05;
      });
      expect(moved, kind).toBe(true);
    }
  });

  it('a bounce overshoots and comes back; an elastic grows past full size', () => {
    const dys = STEPS.map((k) => animLook('bounce', k).dy);
    expect(Math.min(...dys)).toBeLessThan(-0.5);
    const scales = [0.3, 0.35, 0.4].map((k) => animLook('elastic', k).scale);
    expect(Math.max(...scales)).toBeGreaterThan(1.1);
  });

  it('the export knows how far each one zooms', () => {
    expect(lookMaxScale('punch')).toBeCloseTo(1.7, 6);
    expect(lookMaxScale('elastic')).toBeGreaterThan(1.1);
    expect(lookMaxScale('zoom')).toBe(1.4);
    expect(lookMaxScale('fade')).toBe(1);
    expect(lookMaxScale(undefined)).toBe(1);
    expect(presetDef('pushLeft')?.channels.dx?.[0]).toEqual({ t: 0, v: -1 });
  });
});
