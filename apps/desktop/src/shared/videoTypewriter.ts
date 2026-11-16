/**
 * Fase 11B: the "typewriter" title animation. The renderer draws the whole title once (as for
 * every title) and measures where each letter ends ("stops", shares of the frame width, from
 * the left). Preview and export then uncover the picture up to the letter due at that moment,
 * in jumps: the preview clips the canvas, the export cuts the PNG with the same numbers.
 *
 * Letters are counted by grapheme (what a reader sees as one character), never by UTF-16 unit
 * or byte: "é" made of e + accent, a flag or a family emoji are one letter each.
 *
 * Pure, no runtime imports from video.ts.
 */
import type { Clip } from './video.js';
import type { ClipAnim } from './videoFx.js';
import { animLengths } from './videoFx.js';

/** Most steps a typewriter takes (longer texts advance a few letters per step). */
export const TYPE_MAX_STEPS = 256;

/** The graphemes of a text (Intl.Segmenter; a code point split as a fallback). */
export function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) return [...new Seg(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  return Array.from(text);
}

/** Letters a typewriter shows: line breaks and spaces count as letters (they take time too). */
export const typeLetters = (text: string): string[] => graphemes(text);

/** How many of n letters are visible at progress k (0 → none, 1 → all), in whole letters. */
export function typeCount(n: number, k: number): number {
  if (!(n > 0)) return 0;
  const x = Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0));
  return Math.min(n, Math.floor(x * n + 1e-9));
}

/**
 * Stops cleaned for use: finite, 0–1, never going back, at most TYPE_MAX_STEPS (a longer text
 * keeps every k-th stop and the last one).
 */
export function cleanStops(stops: readonly number[] | undefined): number[] {
  if (!Array.isArray(stops) || !stops.length) return [];
  const out: number[] = [];
  let last = 0;
  for (const s of stops) {
    const v = Math.min(1, Math.max(last, Number.isFinite(s) ? s : last));
    out.push(v);
    last = v;
  }
  if (out.length <= TYPE_MAX_STEPS) return out;
  const step = out.length / TYPE_MAX_STEPS;
  const picked: number[] = [];
  for (let i = 1; i <= TYPE_MAX_STEPS; i++) picked.push(out[Math.ceil(i * step) - 1]!);
  return picked;
}

/** Share of the picture shown at progress k: up to the end of the last visible letter. */
export function typeReveal(stops: readonly number[], k: number): number {
  const s = cleanStops(stops);
  const n = typeCount(s.length, k);
  if (n <= 0) return 0;
  // Everything once the last letter is typed (shadows and outlines reach past its end).
  return n >= s.length ? 1 : s[n - 1]!;
}

const isType = (a: ClipAnim | undefined) => a?.in === 'typewriter' || a?.out === 'typewriter';

/** Whether a clip types its text in or out. */
export const usesTypewriter = (c: Pick<Clip, 'anim' | 'text'>): boolean => !!c.text && isType(c.anim);

/**
 * Typewriter reveal of a title at timeline time t (1 = all shown), or null when the clip has no
 * typewriter. In: letters appear one by one; out: they go away from the end.
 */
export function typewriterAt(
  c: Pick<Clip, 'anim' | 'text' | 'start' | 'in' | 'out' | 'speed'>,
  t: number,
  stops: readonly number[],
): number | null {
  if (!usesTypewriter(c)) return null;
  const len = (c.out - c.in) / (c.speed ?? 1);
  const into = Math.min(Math.max(t - c.start, 0), len);
  const { inD, outD } = animLengths(c.anim, len);
  let r = 1;
  if (c.anim!.in === 'typewriter' && inD > 1e-6 && into < inD)
    r = Math.min(r, typeReveal(stops, into / inD));
  if (c.anim!.out === 'typewriter' && outD > 1e-6 && len - into < outD)
    r = Math.min(r, typeReveal(stops, (len - into) / outD));
  return r;
}

const n6 = (x: number) => (Math.round(x * 1e6) / 1e6).toString();

/**
 * FFmpeg expression of typeReveal over a progress expression k (already clipped to 0–1): a
 * balanced tree of if() (FFmpeg evaluates only the branch it takes). Numbers only.
 */
export function typeRevealExpr(stops: readonly number[], k: string): string {
  const s = cleanStops(stops);
  const n = s.length;
  if (!n) return '1';
  const cnt = `floor((${k})*${n}+0.000000001)`;
  // value(i) = what shows with i letters typed.
  const value = (i: number) => (i <= 0 ? '0' : i >= n ? '1' : n6(s[i - 1]!));
  const tree = (lo: number, hi: number): string => {
    if (lo === hi) return value(lo);
    const mid = Math.floor((lo + hi + 1) / 2);
    return `if(lt(${cnt},${mid}),${tree(lo, mid - 1)},${tree(mid, hi)})`;
  };
  return tree(0, n);
}

/**
 * The export's typewriter reveal of a title over the time variable T (the piece's own seconds,
 * `at` = timeline time of T = 0), or null when it has none. The same windows as typewriterAt.
 */
export function typewriterExpr(
  c: Pick<Clip, 'anim' | 'text' | 'start' | 'in' | 'out' | 'speed'>,
  T: string,
  at: number,
  stops: readonly number[] | undefined,
): string | null {
  if (!usesTypewriter(c) || !stops?.length) return null;
  const len = (c.out - c.in) / (c.speed ?? 1);
  const { inD, outD } = animLengths(c.anim, len);
  const parts: string[] = [];
  if (c.anim!.in === 'typewriter' && inD > 1e-6)
    parts.push(typeRevealExpr(stops, `clip((${T}-(${n6(c.start - at)}))/${n6(inD)},0,1)`));
  if (c.anim!.out === 'typewriter' && outD > 1e-6) {
    const end = c.start + len - at;
    parts.push(typeRevealExpr(stops, `clip(((${n6(end)})-${T})/${n6(outD)},0,1)`));
  }
  if (!parts.length) return null;
  return parts.reduce((a, b) => `min(${a},${b})`);
}
