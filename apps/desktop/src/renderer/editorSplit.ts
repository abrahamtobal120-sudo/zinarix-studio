/**
 * The second editor group (estudio, punto B1): which text files are open beside the main
 * editor and which one is in front there. Pure: no DOM, no Monaco. renderer/store.ts keeps
 * it in the state and components/EditorSplit.tsx draws it.
 *
 * The files of the side group are always tabs of the main group too (same document, two
 * views), so closing a file there closes it here as well.
 */

export interface EditorSplit {
  /** Files open in the side group, in tab order. */
  paths: string[];
  /** The one in front. Always one of `paths`. */
  active: string;
}

/** Opens a file in the side group (or brings it to the front when it is already there). */
export function splitOpen(split: EditorSplit | null, path: string): EditorSplit {
  if (!split) return { paths: [path], active: path };
  return {
    paths: split.paths.includes(path) ? split.paths : [...split.paths, path],
    active: path,
  };
}

/** Closes one file of the side group; null when it was the last one (the group goes away). */
export function splitClose(split: EditorSplit | null, path: string): EditorSplit | null {
  if (!split) return null;
  const idx = split.paths.indexOf(path);
  if (idx < 0) return split;
  const paths = split.paths.filter((p) => p !== path);
  if (!paths.length) return null;
  const active = split.active === path ? paths[Math.min(idx, paths.length - 1)]! : split.active;
  return { paths, active };
}

/** Keeps only the files that can still be shown (after tabs close, move or a folder change). */
export function splitPrune(
  split: EditorSplit | null,
  keep: (path: string) => boolean,
): EditorSplit | null {
  let next = split;
  for (const p of split?.paths ?? []) if (!keep(p)) next = splitClose(next, p);
  return next;
}

/** Puts another file of the side group in front; unknown paths change nothing. */
export function splitActivate(split: EditorSplit | null, path: string): EditorSplit | null {
  if (!split || split.active === path || !split.paths.includes(path)) return split;
  return { paths: split.paths, active: path };
}

/** Share of the width the main group takes while split: bounds and the default (half). */
export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
export const SPLIT_DEFAULT = 0.5;

/** A usable share: anything that is not a number falls back to half, the rest is bounded. */
export function clampRatio(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v));
}

/**
 * The share after dragging the divider to `x` (px, same origin as `left`), in a row `width`
 * px wide. Each group keeps at least `minPx` when the row has room for both.
 */
export function ratioAt(x: number, left: number, width: number, minPx = 160): number {
  if (!(width > 0)) return SPLIT_DEFAULT;
  const edge = Math.min(0.5, minPx / width);
  return Math.min(1 - edge, Math.max(edge, clampRatio((x - left) / width)));
}
