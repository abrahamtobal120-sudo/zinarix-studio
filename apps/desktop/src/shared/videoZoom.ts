/**
 * Fase 4 (mejora): auto zoom of screen recordings, like Screen Studio.
 *
 * While the screen is recorded, main saves where the mouse is (`<recording>.cursor.json`). Here
 * that path becomes zoom keyframes on the clip: when the cursor comes to rest somewhere, the
 * picture zooms in towards it, follows it to the next resting place when that comes soon, and
 * zooms back out. Only the clip's scale / x / y keys are written, so the preview, the export and
 * the inspector already know how to show and edit them.
 *
 * Pure: no Electron, no files.
 */
import type { Clip, Keyframe, VideoProject } from './video.js';
import { MAX_KEYS, mediaOf } from './video.js';

/** Mouse samples per second while recording. */
export const CURSOR_RATE = 30;
/** Cursor files are this big at most (4 hours of samples is far less). */
export const CURSOR_MAX_BYTES = 32 * 1024 * 1024;

/** What main saves next to a screen recording. */
export interface CursorTrack {
  v: 1;
  /** Size of the recorded screen (DIP), for distances. */
  w: number;
  h: number;
  /** [milliseconds into the recording, x, y]: x / y are 0…1 of the screen (outside = off it). */
  samples: [number, number, number][];
}

export const cursorFile = (mediaPath: string): string => `${mediaPath}.cursor.json`;

/** A cursor file as read from disk, or null when it is not one. */
export function parseCursorTrack(text: string): CursorTrack | null {
  if (text.length > CURSOR_MAX_BYTES) return null;
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  const o = x as Partial<CursorTrack> | null;
  if (!o || o.v !== 1 || !(Number(o.w) > 0) || !(Number(o.h) > 0) || !Array.isArray(o.samples))
    return null;
  const samples: [number, number, number][] = [];
  let last = -Infinity;
  for (const s of o.samples) {
    if (
      !Array.isArray(s) ||
      s.length !== 3 ||
      !s.every((v) => typeof v === 'number' && Number.isFinite(v))
    )
      return null;
    if (s[0] < last) return null; // in time order
    last = s[0];
    samples.push([s[0], s[1], s[2]]);
  }
  return { v: 1, w: Number(o.w), h: Number(o.h), samples };
}

/** A stretch where the cursor stays (nearly) still, in source seconds. */
export interface Rest {
  t0: number;
  t1: number;
  x: number;
  y: number;
}

export interface ZoomOptions {
  /** How much it zooms in (×). */
  scale?: number;
  /** Seconds the zoom in / out takes. */
  ramp?: number;
  /** Shortest rest that zooms in (s). */
  minRest?: number;
  /** How far the cursor may wander and still be resting (share of the screen height). */
  radius?: number;
  /** Rests closer than this (s) are joined: the picture pans instead of zooming out and in. */
  join?: number;
}
export const ZOOM_DEFAULTS: Required<ZoomOptions> = {
  scale: 1.8,
  ramp: 0.6,
  minRest: 0.8,
  radius: 0.025,
  join: 1.5,
};
export const ZOOM_MIN = 1.1;
export const ZOOM_MAX = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The resting places of the cursor. Samples are only saved when it moves (and once a second
 * when it does not), so a rest lasts until the first sample that leaves its circle.
 */
export function findRests(track: CursorTrack, opts: ZoomOptions = {}): Rest[] {
  const o = { ...ZOOM_DEFAULTS, ...opts };
  const s = track.samples;
  const ar = track.w / track.h;
  const out: Rest[] = [];
  let i = 0;
  while (i < s.length) {
    const [ta, xa, ya] = s[i]!;
    let j = i + 1;
    let sx = xa;
    let sy = ya;
    // Distance in screen heights, so the circle is round on a wide screen.
    while (j < s.length && Math.hypot((s[j]![1] - xa) * ar, s[j]![2] - ya) <= o.radius) {
      sx += s[j]![1];
      sy += s[j]![2];
      j++;
    }
    const end = j < s.length ? s[j]![0] - 1000 / CURSOR_RATE : s[s.length - 1]![0];
    const n = j - i;
    const x = sx / n;
    const y = sy / n;
    const onScreen = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    if (onScreen && (end - ta) / 1000 >= o.minRest)
      out.push({ t0: ta / 1000, t1: end / 1000, x, y });
    i = j;
  }
  return out;
}

/** Offset (share of the canvas) that brings a point of the picture to the centre, no edges showing. */
function offsetFor(p: number, scale: number, fit: number): number {
  const limit = Math.max(0, (scale * fit - 1) / 2);
  return clamp(-scale * fit * (p - 0.5), -limit, limit);
}

/** How much of the canvas width / height the picture covers at scale 1 (fitted inside). */
function fitOf(p: VideoProject, c: Clip): { fw: number; fh: number } {
  const m = mediaOf(p, c.mediaId);
  if (!m?.width || !m.height || !p.width || !p.height) return { fw: 1, fh: 1 };
  const k = Math.min(p.width / m.width, p.height / m.height);
  return { fw: (m.width * k) / p.width, fh: (m.height * k) / p.height };
}

/**
 * The scale / x / y keys of the auto zoom for a clip (source seconds), or null when the cursor
 * never rests inside the clip's part of the recording.
 */
export function autoZoomKeys(
  p: VideoProject,
  c: Clip,
  track: CursorTrack,
  opts: ZoomOptions = {},
): { scale: Keyframe[]; x: Keyframe[]; y: Keyframe[]; rests: number } | null {
  const o = { ...ZOOM_DEFAULTS, ...opts };
  const S = clamp(o.scale, ZOOM_MIN, ZOOM_MAX);
  const ramp = clamp(o.ramp, 0.1, 3);
  let rests = findRests(track, o).filter((r) => r.t1 > c.in && r.t0 < c.out);
  if (!rests.length) return null;
  // Keep within MAX_KEYS: each rest costs at most 2 keys per property, plus 2 per zoom.
  const budget = Math.floor((MAX_KEYS - 2) / 4);
  if (rests.length > budget)
    rests = [...rests]
      .sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))
      .slice(0, budget)
      .sort((a, b) => a.t0 - b.t0);
  // Chains of rests that come one right after the other.
  const chains: Rest[][] = [];
  for (const r of rests) {
    const last = chains[chains.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && r.t0 - prev.t1 <= o.join) last!.push(r);
    else chains.push([r]);
  }
  const { fw, fh } = fitOf(p, c);
  const scale: Keyframe[] = [];
  const x: Keyframe[] = [];
  const y: Keyframe[] = [];
  const key = (list: Keyframe[], t: number, v: number) => {
    const at = r3(t);
    const last = list[list.length - 1];
    if (last && at <= last.t) {
      // Keys too close (short rests): the later one wins.
      last.v = r3(v);
      return;
    }
    list.push({ t: at, v: r3(v), ease: 'ease' });
  };
  let prevEnd = -Infinity;
  for (const ch of chains) {
    // Zoom in while the cursor settles; never before the previous zoom is out.
    const start = Math.max(ch[0]!.t0 - ramp * 0.5, prevEnd);
    const end = ch[ch.length - 1]!.t1;
    key(scale, start, 1);
    key(x, start, 0);
    key(y, start, 0);
    key(scale, start + ramp, S);
    ch.forEach((r, i) => {
      const X = offsetFor(r.x, S, fw);
      const Y = offsetFor(r.y, S, fh);
      // Arrive at this rest (the first one while zooming in), stay until it ends.
      const arrive = i === 0 ? start + ramp : Math.max(r.t0, x[x.length - 1]!.t + 0.05);
      key(x, arrive, X);
      key(y, arrive, Y);
      key(x, Math.max(arrive, r.t1), X);
      key(y, Math.max(arrive, r.t1), Y);
    });
    const out = Math.max(end, start + ramp);
    key(scale, out, S);
    key(scale, out + ramp, 1);
    key(x, out + ramp, 0);
    key(y, out + ramp, 0);
    prevEnd = out + ramp;
  }
  return { scale, x, y, rests: rests.length };
}

/** The clip with the auto zoom keys (replacing its scale / x / y keys). */
export function withAutoZoom(
  c: Clip,
  keys: { scale: Keyframe[]; x: Keyframe[]; y: Keyframe[] },
): Clip {
  return { ...c, keyframes: { ...c.keyframes, scale: keys.scale, x: keys.x, y: keys.y } };
}

/** The clip without scale / x / y keys (back to its static framing). */
export function withoutZoom(c: Clip): Clip {
  if (!c.keyframes) return c;
  const k = { ...c.keyframes };
  delete k.scale;
  delete k.x;
  delete k.y;
  const next = { ...c, keyframes: Object.keys(k).length ? k : undefined };
  if (!next.keyframes) delete next.keyframes;
  return next;
}

/** Whether a clip has a zoom (any scale keys). */
export const hasZoom = (c: Clip): boolean => !!c.keyframes?.scale?.length;
