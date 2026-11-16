/**
 * Fase 12B: keyframes on any property (not only the transform) and bezier curves.
 *
 * FFmpeg cannot solve a cubic bezier inside an expression, so a bezier segment is turned into
 * BEZIER_STEPS straight pieces here; the preview (interpKeys) and the export (videoRender's
 * keyExpr) both use those same pieces, so they draw exactly the same curve.
 *
 * Type-only imports from video.ts (it imports the runtime parts from here).
 */
import type { Keyframe } from './video.js';

/** Non-transform properties that can be animated. */
export type ExtraKeyProp =
  | 'volume'
  | 'pan'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'blur'
  | 'gradeMix';
export const EXTRA_KEY_PROPS: readonly ExtraKeyProp[] = [
  'volume',
  'pan',
  'brightness',
  'contrast',
  'saturation',
  'blur',
  'gradeMix',
];
/** The effects (videoFx Effects keys) that can be animated. */
export const KEYED_EFFECTS = ['brightness', 'contrast', 'saturation', 'blur'] as const;
export type KeyedEffect = (typeof KEYED_EFFECTS)[number];

/** Allowed range of every animatable value (the export clamps to it, the preview too). */
export const KEY_RANGE: Record<string, [number, number]> = {
  x: [-10, 10],
  y: [-10, 10],
  scale: [0.01, 20],
  rotation: [-3600, 3600],
  opacity: [0, 1],
  volume: [0, 2],
  pan: [-1, 1],
  brightness: [-1, 1],
  contrast: [-1, 1],
  saturation: [-1, 1],
  blur: [0, 40],
  gradeMix: [0, 1],
};

/** Straight pieces per bezier segment (the plan's 16: error < 0.5 % of the range). */
export const BEZIER_STEPS = 16;
/** CSS's "ease-in-out": the control points a new bezier key starts with. */
export const BEZIER_DEFAULT: [number, number, number, number] = [0.42, 0, 0.58, 1];

const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Control points of a key (x within 0…1 as in CSS; y may overshoot a little). */
export function bezierOf(k: Pick<Keyframe, 'cx1' | 'cy1' | 'cx2' | 'cy2'>): [number, number, number, number] {
  const [a, b, c, d] = BEZIER_DEFAULT;
  return [
    clamp(fin(k.cx1, a), 0, 1),
    clamp(fin(k.cy1, b), -2, 3),
    clamp(fin(k.cx2, c), 0, 1),
    clamp(fin(k.cy2, d), -2, 3),
  ];
}

/** The exact CSS cubic-bezier(x1, y1, x2, y2) at progress x (0…1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const dx = (t: number) =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
  // Newton first (fast), bisection when the slope is flat.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const e = bx(t) - x;
    if (Math.abs(e) < 1e-7) return by(t);
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    t = clamp(t - e / d, 0, 1);
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i++) {
    const e = bx(t) - x;
    if (Math.abs(e) < 1e-7) break;
    if (e > 0) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
  }
  return by(t);
}

/** The BEZIER_STEPS + 1 heights of a key's curve at evenly spaced progress (0 and 1 at the ends). */
export function bezierTable(k: Pick<Keyframe, 'cx1' | 'cy1' | 'cx2' | 'cy2'>): number[] {
  const [x1, y1, x2, y2] = bezierOf(k);
  const out: number[] = [];
  for (let i = 0; i <= BEZIER_STEPS; i++) out.push(cubicBezier(x1, y1, x2, y2, i / BEZIER_STEPS));
  return out;
}

/** The straight-piece bezier at progress k (0…1): what the preview and the export both draw. */
export function bezierLinear(table: readonly number[], k: number): number {
  const x = clamp(k, 0, 1) * BEZIER_STEPS;
  const i = Math.min(BEZIER_STEPS - 1, Math.floor(x));
  const f = x - i;
  return table[i]! + (table[i + 1]! - table[i]!) * f;
}

/**
 * Keys with every bezier segment replaced by BEZIER_STEPS linear ones (other eases untouched).
 * The export feeds these to its expression builder, which knows no bezier.
 */
export function expandBezier<K extends Keyframe>(keys: readonly K[]): Keyframe[] {
  const out: Keyframe[] = [];
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!;
    const b = keys[i + 1];
    if (a.ease !== 'bezier' || !b || b.t - a.t < 1e-9) {
      const { cx1: _a, cy1: _b, cx2: _c, cy2: _d, ...rest } = a;
      out.push(a.ease === 'bezier' ? { t: rest.t, v: rest.v } : { ...rest });
      continue;
    }
    const tab = bezierTable(a);
    for (let s = 0; s < BEZIER_STEPS; s++)
      out.push({ t: a.t + ((b.t - a.t) * s) / BEZIER_STEPS, v: a.v + (b.v - a.v) * tab[s]! });
  }
  return out;
}

/** Keys of one property copied from a clip (for paste onto another, shifted to its time). */
export interface KeyClipboard {
  prop: string;
  /** Source seconds relative to the first key. */
  keys: Keyframe[];
}
