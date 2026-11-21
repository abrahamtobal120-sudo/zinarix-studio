/**
 * Fase 4 (mejora): level meters of the mixer. The level of every track at a timeline time, read
 * from the media's waveform peaks (the same ones the timeline draws) times everything that sets
 * how loud a clip sounds: its volume (and volume keys), fades, the track's volume, mute / solo,
 * ducking and pan. No audio graph is needed, so it works for any file the preview plays.
 *
 * The master is an estimate: tracks are summed as uncorrelated sounds (√Σ level²).
 */
import type { Clip, VideoProject } from './video.js';
import {
  clipEnd,
  fadeAt,
  mediaOf,
  panAt,
  sourceAt,
  speedOf,
  trackAudible,
  trackOf,
  trackPan,
  trackVolume,
  volumeAt,
} from './video.js';
import { duckGainAt } from './videoEasy.js';

/** Waveform peaks of a media item: `pps` values per second of source, each 0…255. */
export interface Wave {
  pps: number;
  peaks: number[];
}
/** Linear amplitude per side (1 = full scale; above 1 clips). */
export interface Level {
  l: number;
  r: number;
}

/** How much sound one reading covers (a little more than a frame, like a fast peak meter). */
export const METER_WINDOW = 0.05;
export const METER_FLOOR_DB = -60;
export const METER_TOP_DB = 6;

/** Peak of a wave around a source second (0…1). */
export function wavePeak(w: Wave | undefined, from: number, len: number): number {
  if (!w || !(w.pps > 0) || !w.peaks.length) return 0;
  const a = Math.max(0, Math.floor(from * w.pps));
  const b = Math.min(w.peaks.length - 1, Math.floor((from + Math.max(len, 0)) * w.pps));
  let peak = 0;
  for (let i = a; i <= b; i++) peak = Math.max(peak, w.peaks[i] ?? 0);
  return peak / 255;
}

/** Balance law: the centre is untouched, a side fades to silence at ±1. */
const sides = (g: number, pan: number): Level => {
  const p = Math.max(-1, Math.min(1, pan));
  return { l: g * Math.min(1, 1 - p), r: g * Math.min(1, 1 + p) };
};

/** One clip's level at timeline time t, before its track's volume (0 when silent there). */
export function clipLevelAt(p: VideoProject, c: Clip, wave: Wave | undefined, t: number): Level {
  if (c.text || c.compound || t < c.start || t >= clipEnd(c)) return { l: 0, r: 0 };
  const m = mediaOf(p, c.mediaId);
  if (!m || m.missing || m.kind === 'image' || !m.hasAudio) return { l: 0, r: 0 };
  const peak = wavePeak(wave, sourceAt(c, t), METER_WINDOW * speedOf(c));
  return sides(peak * volumeAt(c, t) * fadeAt(c, t), panAt(c, t));
}

/** Every track's level (after its volume, pan, mute / solo and ducking) and the master. */
export function mixLevels(
  p: VideoProject,
  waves: Readonly<Record<string, Wave>>,
  t: number,
): { tracks: Record<string, Level>; master: Level } {
  const tracks: Record<string, Level> = {};
  for (const tr of p.tracks) tracks[tr.id] = { l: 0, r: 0 };
  for (const c of p.clips) {
    const tr = trackOf(p, c.trackId);
    if (!tr || !trackAudible(p, tr)) continue;
    const lv = clipLevelAt(p, c, waves[c.mediaId], t);
    if (!lv.l && !lv.r) continue;
    const g = trackVolume(tr) * duckGainAt(p, tr, t);
    const s = sides(g, trackPan(tr));
    const acc = tracks[tr.id]!;
    // Clips on one track (during a transition) add up like the master does.
    acc.l = Math.hypot(acc.l, lv.l * s.l);
    acc.r = Math.hypot(acc.r, lv.r * s.r);
  }
  let l = 0;
  let r = 0;
  for (const lv of Object.values(tracks)) {
    l = Math.hypot(l, lv.l);
    r = Math.hypot(r, lv.r);
  }
  return { tracks, master: { l, r } };
}

export const toDb = (v: number): number => (v > 1e-6 ? 20 * Math.log10(v) : -Infinity);

/** Where a level sits on the meter, 0 (floor) … 1 (top). */
export function meterFrac(v: number): number {
  const db = toDb(v);
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / (METER_TOP_DB - METER_FLOOR_DB)));
}

/**
 * Peak hold: the meter jumps up at once and falls back slowly (`fall` dB per second), like the
 * meters of a desk. Returns the new shown level.
 */
export function meterFall(shown: number, now: number, dt: number, fall = 24): number {
  if (now >= shown) return now;
  const db = toDb(shown) - fall * Math.max(0, dt);
  const v = db <= METER_FLOOR_DB ? 0 : Math.pow(10, db / 20);
  return Math.max(now, v);
}
