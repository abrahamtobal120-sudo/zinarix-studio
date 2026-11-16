/**
 * Fase 11C: what the analysis of a media file found, as pure data kept in the library (the
 * project's media list), so it is never computed twice and the preview and the export read the
 * same numbers. main/videoAnalyze.ts runs FFmpeg and fills it in; everything here is maths:
 *
 * - voice: where there is sound (the inverse of silencedetect), for ducking guided by sound;
 * - scenes: where a new shot starts;
 * - still / blurry: stretches where nothing moves or the picture is soft (frame statistics);
 * - sharpness: of a photo (variance of the Laplacian, normalised);
 * - beats: music hits (energy onsets of the decoded audio), for cuts on the beat.
 *
 * Plus the choice of "the best part" of a clip for a shot, and the beat snapping of cuts.
 * No runtime imports from video.ts (it imports the validator from here).
 */

export type Span = [number, number];

export interface MediaAnalysis {
  /** Format version (migrated on load). */
  v: 1;
  /** Seconds of the file where there is sound (voice, or anything over the noise floor). */
  voice?: Span[];
  /** Seconds where a new scene starts. */
  scenes?: number[];
  /** Stretches with almost no motion, and with a soft picture. */
  still?: Span[];
  blurry?: Span[];
  /** 0–1: how sharp a photo (or the clip, on average) is. */
  sharpness?: number;
  /** Seconds of the beats (music). */
  beats?: number[];
  /** Beats per minute, when steady. */
  bpm?: number;
  /** When it was made (ms since 1970). */
  at: number;
}

export const ANALYSIS_MAX_ITEMS = 20_000;

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const spans = (x: unknown) =>
  x === undefined ||
  (Array.isArray(x) &&
    x.length <= ANALYSIS_MAX_ITEMS &&
    x.every((s) => Array.isArray(s) && s.length === 2 && fin(s[0]) && fin(s[1]) && s[1] >= s[0]));
const times = (x: unknown) =>
  x === undefined || (Array.isArray(x) && x.length <= ANALYSIS_MAX_ITEMS && x.every(fin));

export function validAnalysis(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const a = x as MediaAnalysis;
  return (
    a.v === 1 &&
    spans(a.voice) &&
    spans(a.still) &&
    spans(a.blurry) &&
    times(a.scenes) &&
    times(a.beats) &&
    (a.sharpness === undefined || fin(a.sharpness)) &&
    (a.bpm === undefined || fin(a.bpm))
  );
}

/** Spans sorted, clipped to [0, duration] and merged when they touch. */
export function mergeSpans(list: readonly Span[], duration = Infinity, join = 0): Span[] {
  const s = list
    .map(([a, b]) => [Math.max(0, a), Math.min(duration, b)] as Span)
    .filter(([a, b]) => b - a > 1e-6)
    .sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a - last[1] <= join) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Where there is sound: the gaps between the silences, dropping blips shorter than `minLen`. */
export function soundSpans(silences: readonly Span[], duration: number, minLen = 0.1): Span[] {
  const quiet = mergeSpans(silences, duration);
  const out: Span[] = [];
  let t = 0;
  for (const [a, b] of quiet) {
    if (a - t >= minLen) out.push([t, a]);
    t = Math.max(t, b);
  }
  if (duration - t >= minLen) out.push([t, duration]);
  return out.map(([a, b]) => [r3(a), r3(b)] as Span);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------- frames: motion, blur, sharpness ----------------

/** Sharpness of a grey picture (w×h, 8 bits): variance of the Laplacian, mapped to 0–1. */
export function sharpness(gray: Uint8Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      sum += l;
      sq += l * l;
      n++;
    }
  const v = sq / n - (sum / n) ** 2;
  // ~50 is soft, ~500 is crisp at the small analysis size.
  return r3(1 - Math.exp(-v / 300));
}

/** Mean absolute difference (0–1) between two grey frames of the same size. */
export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!);
  return s / n / 255;
}

export interface FrameStat {
  /** Seconds of the file. */
  t: number;
  /** Motion against the frame before (0–1). */
  motion: number;
  sharp: number;
}

/** Per-frame motion and sharpness of grey frames sampled at `fps`. */
export function frameStats(frames: readonly Uint8Array[], w: number, h: number, fps: number): FrameStat[] {
  return frames.map((f, i) => ({
    t: r3(i / fps),
    motion: i ? r3(frameDiff(frames[i - 1]!, f)) : 0,
    sharp: sharpness(f, w, h),
  }));
}

/** Motion below this is "nothing happening"; sharpness below this share of the clip's best is soft. */
export const STILL_MOTION = 0.004;
export const BLUR_SHARE = 0.45;
/** A jump in motion this big is a new scene. */
export const SCENE_MOTION = 0.18;

/** Stretches of at least `minLen` s where `bad` holds for every sample. */
function runs(stats: readonly FrameStat[], bad: (s: FrameStat) => boolean, step: number, minLen: number): Span[] {
  const out: Span[] = [];
  let from = -1;
  stats.forEach((s, i) => {
    if (bad(s)) {
      if (from < 0) from = s.t;
    } else if (from >= 0) {
      if (s.t - from >= minLen) out.push([from, s.t]);
      from = -1;
    }
    if (i === stats.length - 1 && from >= 0 && s.t + step - from >= minLen) out.push([from, r3(s.t + step)]);
  });
  return out;
}

/** Still and blurry stretches, scenes and the average sharpness, from the frame statistics. */
export function summarizeFrames(stats: readonly FrameStat[], fps: number): Pick<MediaAnalysis, 'still' | 'blurry' | 'scenes' | 'sharpness'> {
  if (!stats.length) return {};
  const step = 1 / fps;
  const best = Math.max(...stats.map((s) => s.sharp));
  const still = runs(stats.slice(1), (s) => s.motion < STILL_MOTION, step, 1);
  const blurry = best > 0.05 ? runs(stats, (s) => s.sharp < best * BLUR_SHARE, step, 0.5) : [];
  const scenes = stats.filter((s, i) => i > 0 && s.motion > SCENE_MOTION).map((s) => s.t);
  const sharp = r3(stats.reduce((a, s) => a + s.sharp, 0) / stats.length);
  return { still, blurry, scenes, sharpness: sharp };
}

// ---------------- beats ----------------

/**
 * Beat times (seconds) of mono audio samples: an energy envelope in short hops, its rises
 * (onset strength), and the peaks that stand out from their neighbourhood, at least `minGap`
 * apart. Each beat is placed at the hop where the energy starts to climb.
 */
export function detectBeats(samples: Float32Array, rate: number, minGap = 0.25): number[] {
  const hop = Math.max(1, Math.round(rate * 0.005)); // 5 ms
  const win = hop * 2;
  const n = Math.floor((samples.length - win) / hop);
  if (n < 4) return [];
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * hop;
    for (let j = 0; j < win; j++) s += samples[o + j]! * samples[o + j]!;
    env[i] = Math.sqrt(s / win);
  }
  // Onset strength: how much the (log) energy rose against the last 30 ms.
  const look = Math.max(1, Math.round(0.03 / 0.005));
  const onset = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let prev = 0;
    for (let j = 1; j <= look; j++) prev = Math.max(prev, i - j >= 0 ? env[i - j]! : 0);
    const a = Math.log1p(env[i]! * 100);
    const b = Math.log1p(prev * 100);
    onset[i] = Math.max(0, a - b);
  }
  // Peaks above an adaptive threshold (local mean + 1.5 × local deviation, over ±1 s).
  const half = Math.round(1 / 0.005);
  const pre = new Float64Array(n + 1);
  const pre2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    pre[i + 1] = pre[i]! + onset[i]!;
    pre2[i + 1] = pre2[i]! + onset[i]! * onset[i]!;
  }
  const max = onset.reduce((m, v) => Math.max(m, v), 0);
  if (!(max > 0)) return [];
  const gapHops = Math.round(minGap / 0.005);
  const beats: number[] = [];
  let lastHop = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const v = onset[i]!;
    if (v < onset[i - 1]! || v < onset[i + 1]!) continue;
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half);
    const m = (pre[b]! - pre[a]!) / (b - a);
    const sd = Math.sqrt(Math.max(0, (pre2[b]! - pre2[a]!) / (b - a) - m * m));
    if (v < m + 1.5 * sd || v < max * 0.2) continue;
    if (i - lastHop < gapHops) {
      // Keep the stronger of two close peaks.
      if (v > onset[lastHop]!) {
        beats[beats.length - 1] = r3(((i + 1) * hop) / rate);
        lastHop = i;
      }
      continue;
    }
    // The envelope at hop i covers [i·hop, i·hop + win): the rise sits about one hop later.
    beats.push(r3(((i + 1) * hop) / rate));
    lastHop = i;
  }
  return beats;
}

/** Tempo of steady beats (median interval), or undefined. */
export function bpmOf(beats: readonly number[]): number | undefined {
  if (beats.length < 4) return undefined;
  const d = beats.slice(1).map((b, i) => b - beats[i]!).sort((a, b) => a - b);
  const med = d[Math.floor(d.length / 2)]!;
  return med > 0 ? Math.round((60 / med) * 10) / 10 : undefined;
}

/** Cuts within this many seconds of a beat move onto it. */
export const BEAT_SNAP = 0.3;

/**
 * Moves each cut (seconds, increasing) onto the nearest beat when it is within `tol`, keeping
 * every shot at least `minLen` long and the order intact. `canMove(i, to)` may refuse a move
 * (a clip that has no more frames to give).
 */
export function snapCuts(
  cuts: readonly number[],
  beats: readonly number[],
  tol = BEAT_SNAP,
  minLen = 0.5,
  canMove: (i: number, to: number) => boolean = () => true,
): number[] {
  const out = [...cuts];
  if (!beats.length) return out;
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    let best: number | undefined;
    for (const b of beats) if (Math.abs(b - c) <= tol && (best === undefined || Math.abs(b - c) < Math.abs(best - c))) best = b;
    if (best === undefined) continue;
    const prev = i ? out[i - 1]! : -Infinity;
    const next = i + 1 < cuts.length ? cuts[i + 1]! : Infinity;
    if (best - prev < minLen || next - best < minLen) continue;
    if (!canMove(i, best)) continue;
    out[i] = best;
  }
  return out;
}

// ---------------- choosing the best part ----------------

/** How much happens in [a, b): penalties for still and blurry time, a bonus for scene changes. */
export function segmentScore(a: MediaAnalysis | undefined, from: number, to: number): number {
  if (!a) return 0;
  const len = Math.max(1e-6, to - from);
  const overlap = (list: readonly Span[] | undefined) =>
    (list ?? []).reduce((s, [x, y]) => s + Math.max(0, Math.min(y, to) - Math.max(x, from)), 0) / len;
  const scenes = (a.scenes ?? []).filter((t) => t > from + 0.2 && t < to - 0.2).length;
  return -2 * overlap(a.still) - 1.5 * overlap(a.blurry) + 0.3 * Math.min(2, scenes);
}

/**
 * Where to take `len` seconds from a clip of `duration`: the window with the most going on
 * (segmentScore, tried every 0.25 s), ties broken toward the middle. Without analysis: the middle.
 */
export function bestSegment(a: MediaAnalysis | undefined, duration: number, len: number): number {
  const room = Math.max(0, duration - len);
  const mid = room / 2;
  if (!a || room < 0.25) return r3(mid);
  let best = mid;
  let bestScore = segmentScore(a, mid, mid + len);
  for (let s = 0; s <= room + 1e-9; s += 0.25) {
    const v = segmentScore(a, s, s + len) - 0.01 * (Math.abs(s - mid) / Math.max(1, room));
    if (v > bestScore + 1e-9) {
      bestScore = v;
      best = s;
    }
  }
  return r3(best);
}

/** One line of text for the model about a media file (no paths, no pictures). */
export function describeAnalysis(a: MediaAnalysis | undefined): string {
  if (!a) return 'not analysed';
  const f = (list: readonly Span[] | undefined) =>
    list?.length ? list.slice(0, 12).map(([x, y]) => `${x.toFixed(1)}-${y.toFixed(1)}`).join(' ') : 'none';
  const parts: string[] = [];
  if (a.sharpness !== undefined) parts.push(`sharpness ${a.sharpness.toFixed(2)}`);
  if (a.scenes) parts.push(`scene changes at ${a.scenes.length ? a.scenes.slice(0, 12).map((t) => t.toFixed(1)).join(' ') : 'none'}`);
  if (a.voice) parts.push(`sound ${f(a.voice)}`);
  if (a.still) parts.push(`still ${f(a.still)}`);
  if (a.blurry) parts.push(`blurry ${f(a.blurry)}`);
  if (a.beats) parts.push(`${a.beats.length} beats${a.bpm ? ` (${a.bpm} BPM)` : ''}`);
  return parts.join('; ') || 'nothing found';
}
