import { describe, expect, it } from 'vitest';
import { EASES, easeCurve, interpKeys, transformAt } from '../src/shared/video.js';
import type { Clip, Ease } from '../src/shared/video.js';
import { easeExpr } from '../src/shared/videoRender.js';

/** Evaluates an easeExpr string (only numbers, p, + - * and parentheses) at p. */
const evalExpr = (expr: string, p: number): number =>
  new Function('p', `return ${expr};`)(p) as number;

describe('keyframe eases (Motion Canvas curves)', () => {
  it('every ease starts at 0 and ends at 1', () => {
    for (const e of EASES) {
      if (e === 'hold') continue;
      expect(easeCurve(e, 0)).toBeCloseTo(0, 9);
      expect(easeCurve(e, 1)).toBeCloseTo(1, 9);
    }
  });

  it('in is slow at the start, out is slow at the end, back overshoots', () => {
    expect(easeCurve('in', 0.5)).toBeCloseTo(0.125, 9);
    expect(easeCurve('out', 0.5)).toBeCloseTo(0.875, 9);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => easeCurve('back', i / 100)));
    expect(peak).toBeGreaterThan(1.09);
    expect(peak).toBeLessThan(1.11);
  });

  it('the export expression draws the same curve as the preview', () => {
    for (const e of EASES as readonly Ease[]) {
      const expr = easeExpr(e, '(p)');
      for (let i = 0; i <= 20; i++) {
        const p = i / 20;
        expect(evalExpr(expr, p)).toBeCloseTo(easeCurve(e, p), 6);
      }
    }
  });

  it('interpKeys uses the ease of the first key of each segment', () => {
    const keys = [
      { t: 0, v: 0, ease: 'in' as Ease },
      { t: 2, v: 10 },
    ];
    expect(interpKeys(keys, 1)).toBeCloseTo(10 * 0.125, 9);
  });

  it('a back overshoot never takes opacity past 1 or scale below 0.01', () => {
    const clip: Clip = {
      id: 'c',
      mediaId: 'm',
      trackId: 't',
      start: 0,
      in: 0,
      out: 4,
      volume: 1,
      keyframes: {
        opacity: [
          { t: 0, v: 0, ease: 'back' },
          { t: 2, v: 1 },
        ],
        scale: [
          { t: 0, v: 1, ease: 'back' },
          { t: 2, v: 0.01 },
        ],
      },
    };
    for (let t = 0; t <= 2; t += 0.05) {
      const tr = transformAt(clip, t);
      expect(tr.opacity).toBeLessThanOrEqual(1);
      expect(tr.scale).toBeGreaterThanOrEqual(0.01);
    }
  });
});
