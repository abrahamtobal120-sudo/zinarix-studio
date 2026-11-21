/**
 * Fase 4B: speed ramps (the speed changes gradually along a clip, like CapCut's "curve" speed).
 *
 * A ramp is stored as consecutive steps: the clip is cut into short pieces, each with a constant
 * speed taken from the curve. Everything else (preview, audio with atempo, export, keyframes in
 * source time, undo) already works with constant-speed clips, so the ramp needs nothing new
 * there. The steps share a RampTag so the editor treats them as one ramp and can undo it.
 * Pure: no DOM, no Electron, no disk.
 */
import type { Clip, VideoProject } from './video.js';
import {
  MIN_CLIP,
  SPEED_MAX,
  SPEED_MIN,
  clipDur,
  clipEnd,
  isText,
  mediaOf,
  speedOf,
  trackClips,
  trackOf,
  uid,
} from './video.js';

/** A point of the curve: `u` is the position along the clip's source (0 = start, 1 = end). */
export interface RampPoint {
  u: number;
  s: number;
}

export type RampPreset = 'hero' | 'bullet' | 'montage' | 'flashIn' | 'flashOut' | 'slowEnd';
export const RAMP_PRESETS: Record<RampPreset, RampPoint[]> = {
  /** Normal, slow motion in the middle, normal again. */
  hero: [
    { u: 0, s: 1 },
    { u: 0.38, s: 0.3 },
    { u: 0.62, s: 0.3 },
    { u: 1, s: 1 },
  ],
  /** Fast, very slow in the middle, fast. */
  bullet: [
    { u: 0, s: 3 },
    { u: 0.45, s: 0.3 },
    { u: 0.55, s: 0.3 },
    { u: 1, s: 3 },
  ],
  /** Normal, fast in the middle, normal. */
  montage: [
    { u: 0, s: 1 },
    { u: 0.3, s: 3 },
    { u: 0.7, s: 3 },
    { u: 1, s: 1 },
  ],
  /** Starts fast and settles at normal speed. */
  flashIn: [
    { u: 0, s: 3.5 },
    { u: 0.45, s: 1 },
    { u: 1, s: 1 },
  ],
  /** Normal, then speeds away at the end. */
  flashOut: [
    { u: 0, s: 1 },
    { u: 0.55, s: 1 },
    { u: 1, s: 3.5 },
  ],
  /** Normal, then slows down at the end (a dramatic stop). */
  slowEnd: [
    { u: 0, s: 1 },
    { u: 0.6, s: 1 },
    { u: 1, s: 0.3 },
  ],
};
export const RAMP_PRESET_IDS = Object.keys(RAMP_PRESETS) as RampPreset[];
export const RAMP_MAX_POINTS = 16;
export const RAMP_MIN_STEPS = 3;
export const RAMP_MAX_STEPS = 40;
/** Source seconds per step when the count is automatic (about 4 changes of speed a second). */
const STEP_SOURCE = 0.25;

const clampSpeed = (s: number) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, s));

/** Sorted, clamped points (refuses empty or non-finite input). */
export function cleanPoints(points: readonly RampPoint[]): RampPoint[] {
  const out = points
    .filter((p) => p && Number.isFinite(p.u) && Number.isFinite(p.s))
    .slice(0, RAMP_MAX_POINTS)
    .map((p) => ({ u: Math.min(1, Math.max(0, p.u)), s: clampSpeed(p.s) }))
    .sort((a, b) => a.u - b.u);
  if (!out.length) throw new Error('La rampa necesita al menos un punto.');
  return out;
}

/** Speed at position u (0…1), smooth (cosine) between points, flat before the first / after the last. */
export function rampSpeedAt(points: readonly RampPoint[], u: number): number {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (u <= first.u) return first.s;
  if (u >= last.u) return last.s;
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    if (u > b.u) continue;
    const a = points[i - 1]!;
    const span = b.u - a.u;
    if (span <= 1e-9) return b.s;
    const k = (u - a.u) / span;
    const e = (1 - Math.cos(Math.PI * k)) / 2;
    return a.s + (b.s - a.s) * e;
  }
  return last.s;
}

/** How many steps a source stretch gets: automatic, or the given count, within what fits. */
export function rampSteps(srcLen: number, points: readonly RampPoint[], wanted?: number): number {
  const fastest = Math.max(...points.map((p) => p.s));
  // Every step must last at least MIN_CLIP on the timeline at its speed.
  const fit = Math.floor(srcLen / (MIN_CLIP * fastest * 1.05));
  const auto = Math.round(srcLen / STEP_SOURCE);
  const n = Math.round(wanted ?? auto);
  return Math.max(0, Math.min(RAMP_MAX_STEPS, fit, Math.max(RAMP_MIN_STEPS, n)));
}

/** The steps a ramp makes over a source stretch: source in/out and speed of each. */
export function rampPlan(
  srcIn: number,
  srcOut: number,
  points: readonly RampPoint[],
  steps?: number,
): { in: number; out: number; speed: number }[] {
  const len = srcOut - srcIn;
  const n = rampSteps(len, points, steps);
  if (n < 2) return [];
  const out: { in: number; out: number; speed: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = srcIn + (len * i) / n;
    const b = i === n - 1 ? srcOut : srcIn + (len * (i + 1)) / n;
    const mid = (i + 0.5) / n;
    out.push({
      in: a,
      out: b,
      speed: Math.round(clampSpeed(rampSpeedAt(points, mid)) * 1000) / 1000,
    });
  }
  return out;
}

/** Timeline length of a plan. */
export const planDuration = (plan: readonly { in: number; out: number; speed: number }[]): number =>
  plan.reduce((sum, s) => sum + (s.out - s.in) / s.speed, 0);

/** Every step of the ramp a clip belongs to, in timeline order (just the clip when it has none). */
export function rampGroup(p: VideoProject, clipId: string): Clip[] {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return [];
  if (!c.ramp) return [c];
  const g = c.ramp.group;
  return p.clips
    .filter((x) => x.ramp?.group === g && x.trackId === c.trackId)
    .sort((a, b) => a.start - b.start);
}

/** Moves the clips of one track that start at or after `from` by `delta` seconds. */
function rippleTrack(
  clips: Clip[],
  trackId: string,
  from: number,
  delta: number,
  skip: Set<string>,
): Clip[] {
  if (Math.abs(delta) < 1e-9) return clips;
  return clips.map((x) =>
    x.trackId === trackId && !skip.has(x.id) && x.start >= from - 1e-6
      ? { ...x, start: Math.max(0, x.start + delta) }
      : x,
  );
}

export interface RampResult {
  project: VideoProject;
  /** Ids of the steps (the first keeps the original clip's id). */
  ids: string[];
  /** New timeline length of the ramped stretch, and how much it changed. */
  duration: number;
  delta: number;
}

/**
 * Puts a speed ramp on a clip (replacing the ramp it already had). `ripple` (default true) moves
 * the later clips of the same track so nothing overlaps; without it the ramp must fit before the
 * next clip.
 */
export function applyRamp(
  p: VideoProject,
  clipId: string,
  curve: RampPreset | readonly RampPoint[],
  opts: { steps?: number; ripple?: boolean } = {},
): RampResult {
  const start = p.clips.find((x) => x.id === clipId);
  if (!start) throw new Error(`No existe el clip ${clipId}.`);
  // Re-ramping: go back to the plain clip first.
  const base = start.ramp ? removeRamp(p, clipId) : { project: p, id: clipId };
  p = base.project;
  const c = p.clips.find((x) => x.id === base.id)!;
  if (trackOf(p, c.trackId)?.locked) throw new Error('La pista está bloqueada.');
  const m = mediaOf(p, c.mediaId);
  if (isText(c) || c.compound || !m || m.kind === 'image')
    throw new Error('Las rampas de velocidad son para clips de video o audio.');
  const preset = typeof curve === 'string' ? curve : 'custom';
  const points = cleanPoints(typeof curve === 'string' ? (RAMP_PRESETS[curve] ?? []) : curve);
  const plan = rampPlan(c.in, c.out, points, opts.steps);
  if (plan.length < 2) throw new Error('El clip es demasiado corto para una rampa.');
  const duration = planDuration(plan);
  const oldDur = clipDur(c);
  const delta = duration - oldDur;
  const ripple = opts.ripple ?? true;
  if (!ripple && delta > 1e-6) {
    const nextStart = trackClips(p, c.trackId)
      .filter((x) => x.id !== c.id && x.start >= c.start + 1e-6)
      .reduce((mn, x) => Math.min(mn, x.start), Infinity);
    if (c.start + duration > nextStart + 1e-6)
      throw new Error('La rampa no cabe antes del siguiente clip (usa ripple para recorrerlo).');
  }
  const group = uid('rp');
  const tag = { group, preset, base: c.speed };
  const steps: Clip[] = [];
  let t = c.start;
  plan.forEach((s, i) => {
    const first = i === 0;
    const last = i === plan.length - 1;
    steps.push({
      ...c,
      id: first ? c.id : uid('c'),
      start: t,
      in: s.in,
      out: s.out,
      speed: s.speed === 1 ? undefined : s.speed,
      fadeIn: first ? c.fadeIn : undefined,
      fadeOut: last ? c.fadeOut : undefined,
      transition: first ? c.transition : undefined,
      anim:
        c.anim &&
        (first
          ? { in: c.anim.in, inD: c.anim.inD }
          : last
            ? { out: c.anim.out, outD: c.anim.outD }
            : undefined),
      ramp: tag,
    });
    t += (s.out - s.in) / s.speed;
  });
  const oldEnd = clipEnd(c);
  let clips = p.clips.filter((x) => x.id !== c.id);
  if (ripple) clips = rippleTrack(clips, c.trackId, oldEnd, delta, new Set());
  clips = [...clips, ...steps];
  return { project: { ...p, clips }, ids: steps.map((s) => s.id), duration, delta };
}

/**
 * Takes the ramp off: the steps become one clip again at the speed it had before. Later clips of
 * the track move back by the difference.
 */
export function removeRamp(
  p: VideoProject,
  clipId: string,
  opts: { ripple?: boolean } = {},
): { project: VideoProject; id: string } {
  const steps = rampGroup(p, clipId);
  const first = steps[0];
  if (!first?.ramp) return { project: p, id: clipId };
  const last = steps[steps.length - 1]!;
  const speed = first.ramp.base;
  const one: Clip = {
    ...first,
    in: first.in,
    out: last.out,
    speed,
    fadeOut: last.fadeOut,
    anim: first.anim || last.anim ? { ...first.anim, ...last.anim } : undefined,
    ramp: undefined,
  };
  delete one.ramp;
  if (one.speed === undefined) delete one.speed;
  if (one.anim === undefined) delete one.anim;
  const oldEnd = clipEnd(last);
  const delta = clipDur(one) - (oldEnd - first.start);
  const ids = new Set(steps.map((s) => s.id));
  let clips = p.clips.filter((x) => !ids.has(x.id));
  if (opts.ripple ?? true) {
    // Growing back must not run over the next clip: ripple only what is really after the ramp.
    clips = rippleTrack(clips, first.trackId, oldEnd, delta, new Set());
  }
  return { project: { ...p, clips: [...clips, one] }, id: one.id };
}

/** Summary for the inspector and the AI: preset, steps, slowest / fastest speed, length. */
export function rampInfo(p: VideoProject, clipId: string) {
  const steps = rampGroup(p, clipId);
  const first = steps[0];
  if (!first?.ramp) return null;
  const speeds = steps.map(speedOf);
  return {
    group: first.ramp.group,
    preset: first.ramp.preset,
    steps: steps.length,
    ids: steps.map((s) => s.id),
    min: Math.min(...speeds),
    max: Math.max(...speeds),
    start: first.start,
    duration: clipEnd(steps[steps.length - 1]!) - first.start,
  };
}
