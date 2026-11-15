/**
 * Zinarix Video Studio, Fase 12: the pro trim tools (ripple, roll, slip, slide). Pure: each
 * takes a project and returns the next one, or the same object when the edit is not possible
 * (locked track, no room, no media left). Amounts are clamped, never refused half-way.
 *
 * - Ripple trim: trims an edge and moves everything after it on the track, so no gap opens.
 * - Roll: moves the cut between two touching clips (one gets longer, the other shorter).
 * - Slip: shows another part of the source, same place and length on the timeline.
 * - Slide: moves a clip between its neighbours, which give or take the room.
 *
 * Keyframes live in source time, so they stay on their picture through all of these.
 */
import type { Clip, VideoProject } from './video.js';
import {
  MIN_CLIP,
  clipDur,
  clipEnd,
  isText,
  mediaOf,
  nextAdjacent,
  prevAdjacent,
  speedOf,
  trackOf,
} from './video.js';

const EPS = 1e-6;

const editable = (p: VideoProject, c: Clip | undefined): c is Clip =>
  !!c && !trackOf(p, c.trackId)?.locked;

/**
 * Source seconds a clip may reach: [0, media length]. Images and titles have no end; their
 * source never goes below 0 either, so keyframes (in source time) never need renumbering.
 */
function sourceLimits(p: VideoProject, c: Clip): { min: number; max: number; still: boolean } {
  const m = mediaOf(p, c.mediaId);
  const still = isText(c) || m?.kind === 'image' || !m;
  return { min: 0, max: still ? Infinity : m.duration, still };
}

const put = (p: VideoProject, next: Clip[]): VideoProject => {
  const byId = new Map(next.map((c) => [c.id, c]));
  return { ...p, clips: p.clips.map((c) => byId.get(c.id) ?? c) };
};

/** Clips on the same track that start at or after `t`. */
const later = (p: VideoProject, c: Clip, t: number) =>
  p.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id && x.start >= t - EPS);

/**
 * Ripple trim: moves one edge of a clip to timeline time `to` and shifts the clips after it on
 * its track by the same amount. The left edge keeps the clip's start (the content before it is
 * what goes or comes back), like the ripple trim of a pro editor.
 */
export function rippleTrim(
  p: VideoProject,
  id: string,
  edge: 'left' | 'right',
  to: number,
): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!editable(p, c)) return p;
  const sp = speedOf(c);
  const lim = sourceLimits(p, c);
  const end = clipEnd(c);
  const after = later(p, c, end);
  let next: Clip;
  let shift: number;
  if (edge === 'left') {
    // Timeline seconds removed from the head (negative = brought back).
    let cut = to - c.start;
    cut = Math.min(cut, clipDur(c) - MIN_CLIP);
    cut = Math.max(cut, (lim.min - c.in) / sp);
    if (Math.abs(cut) < EPS) return p;
    next = { ...c, in: c.in + cut * sp };
    shift = -cut;
  } else {
    let len = to - c.start;
    len = Math.max(len, MIN_CLIP);
    if (Number.isFinite(lim.max)) len = Math.min(len, (lim.max - c.in) / sp);
    shift = len - clipDur(c);
    if (Math.abs(shift) < EPS) return p;
    next = { ...c, out: c.in + len * sp };
  }
  // Locked clips further down the track would be overrun: then only what fits happens.
  if (after.some((x) => trackOf(p, x.trackId)?.locked)) return p;
  return put(p, [next, ...after.map((x) => ({ ...x, start: Math.max(0, x.start + shift) }))]);
}

/**
 * Roll: moves the cut at the end of clip `id` (which must touch the next one) to timeline time
 * `to`. The total length of the track does not change.
 */
export function rollEdit(p: VideoProject, id: string, to: number): VideoProject {
  const a = p.clips.find((x) => x.id === id);
  if (!editable(p, a)) return p;
  const b = nextAdjacent(p, a);
  if (!b) return p;
  const sa = speedOf(a);
  const sb = speedOf(b);
  const la = sourceLimits(p, a);
  const lb = sourceLimits(p, b);
  const cut = clipEnd(a);
  let d = to - cut;
  // a keeps at least MIN_CLIP, b too; a cannot read past its media, b not before 0.
  d = Math.max(d, MIN_CLIP - clipDur(a));
  d = Math.min(d, clipDur(b) - MIN_CLIP);
  if (Number.isFinite(la.max)) d = Math.min(d, (la.max - a.out) / sa);
  d = Math.max(d, (lb.min - b.in) / sb);
  if (Math.abs(d) < EPS) return p;
  const na: Clip = { ...a, out: a.out + d * sa };
  const nb: Clip = { ...b, start: cut + d, in: b.in + d * sb };
  if (!editable(p, nb)) return p;
  return put(p, [na, nb]);
}

/** Slip: shifts what part of the source the clip shows by `d` timeline seconds. */
export function slipClip(p: VideoProject, id: string, d: number): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!editable(p, c)) return p;
  const lim = sourceLimits(p, c);
  if (lim.still) return p; // a still picture: nothing to slip
  let s = d * speedOf(c);
  s = Math.max(s, lim.min - c.in);
  s = Math.min(s, lim.max - c.out);
  if (Math.abs(s) < EPS) return p;
  return put(p, [{ ...c, in: c.in + s, out: c.out + s }]);
}

/**
 * Slide: moves a clip by `d` timeline seconds between the clips touching it. The one before
 * gets longer (or shorter) at its end, the one after at its start; the cut points move, the
 * rest of the track does not. Without a neighbour on a side, that side just needs free room.
 */
export function slideClip(p: VideoProject, id: string, d: number): VideoProject {
  const c = p.clips.find((x) => x.id === id);
  if (!editable(p, c)) return p;
  const prev = prevAdjacent(p, c);
  const next = nextAdjacent(p, c);
  const others = p.clips.filter(
    (x) => x.trackId === c.trackId && x.id !== c.id && x.id !== prev?.id && x.id !== next?.id,
  );
  let k = d;
  if (prev) {
    const sp = speedOf(prev);
    const lp = sourceLimits(p, prev);
    k = Math.max(k, MIN_CLIP - clipDur(prev));
    if (Number.isFinite(lp.max)) k = Math.min(k, (lp.max - prev.out) / sp);
  } else {
    // Free room before the clip (to 0 or the previous clip's end).
    const room = others
      .filter((x) => clipEnd(x) <= c.start + EPS)
      .reduce((mx, x) => Math.max(mx, clipEnd(x)), 0);
    k = Math.max(k, room - c.start);
  }
  if (next) {
    const sn = speedOf(next);
    const ln = sourceLimits(p, next);
    k = Math.min(k, clipDur(next) - MIN_CLIP);
    k = Math.max(k, (ln.min - next.in) / sn);
  } else {
    const room = others
      .filter((x) => x.start >= clipEnd(c) - EPS)
      .reduce((mn, x) => Math.min(mn, x.start), Infinity);
    k = Math.min(k, room - clipEnd(c));
  }
  // The two sides can contradict each other (no room at all): then nothing moves.
  if (Math.abs(k) < EPS || (d > 0 && k < 0) || (d < 0 && k > 0)) return p;
  const out: Clip[] = [{ ...c, start: c.start + k }];
  if (prev) out.push({ ...prev, out: prev.out + k * speedOf(prev) });
  if (next) {
    out.push({ ...next, start: next.start + k, in: next.in + k * speedOf(next) });
  }
  if (out.some((x) => !editable(p, x))) return p;
  return put(p, out);
}
