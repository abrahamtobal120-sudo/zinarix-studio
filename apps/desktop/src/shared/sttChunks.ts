/**
 * Fase 13C: long audio for any speech-to-text provider. The audio is split into parts of
 * 20 minutes that overlap by 5 s; each part is transcribed on its own and the words are joined
 * back, dropping the ones the overlap repeats. The cut between two parts is in the middle of
 * their overlap, where both parts heard the speech with context on either side.
 *
 * No Electron, no I/O.
 */
import type { TranscriptWord } from './video.js';

export const CHUNK_SECONDS = 20 * 60;
export const CHUNK_OVERLAP = 5;

export interface Chunk {
  /** Seconds into the file. */
  start: number;
  len: number;
}

/** The parts of a file of `duration` seconds (one part when it fits). */
export function chunkPlan(
  duration: number,
  part = CHUNK_SECONDS,
  overlap = CHUNK_OVERLAP,
): Chunk[] {
  if (!(duration > 0)) return [];
  if (duration <= part + overlap) return [{ start: 0, len: duration }];
  const out: Chunk[] = [];
  for (let s = 0; s < duration; s += part) {
    const len = Math.min(part + overlap, duration - s);
    // A tail shorter than the overlap is already inside the part before.
    if (out.length && len <= overlap) break;
    out.push({ start: s, len });
  }
  return out;
}

const round = (t: number): number => Math.round(t * 1000) / 1000;

/** Same word for the overlap check: case, accents and punctuation do not matter. */
const same = (a: string, b: string): boolean => {
  const k = (w: string) =>
    w
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  return k(a) === k(b);
};

/**
 * Words of each part (times relative to the part) → the words of the whole file. Each pair of
 * neighbours is cut in the middle of its overlap; a word heard by both sides of the cut (the
 * same text, at about the same time) is kept once.
 */
export function mergeChunks(
  parts: readonly { chunk: Chunk; words: readonly TranscriptWord[] }[],
): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  parts.forEach(({ chunk, words }, i) => {
    const prev = parts[i - 1]?.chunk;
    const next = parts[i + 1]?.chunk;
    // The cut with the part before: the middle of the stretch both heard.
    const from = prev ? (chunk.start + (prev.start + prev.len)) / 2 : -Infinity;
    const to = next ? (next.start + (chunk.start + chunk.len)) / 2 : Infinity;
    for (const w of words) {
      const s = round(w.s + chunk.start);
      const e = round(w.e + chunk.start);
      const mid = (s + e) / 2;
      if (mid < from || mid >= to) continue;
      const last = out[out.length - 1];
      if (last && same(last.w, w.w) && Math.abs(last.s - s) < 0.6) continue;
      out.push({ ...w, s, e });
    }
  });
  return out;
}
