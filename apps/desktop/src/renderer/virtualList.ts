/**
 * Pure maths for the long lists of the window (C5): the explorer tree, whose rows all have the
 * same height, and the chat, whose turns do not.
 */

export interface RowRange {
  /** First row to mount (inclusive). */
  start: number;
  /** Last row to mount (exclusive). */
  end: number;
}

/** Height assumed while the list is hidden or not measured yet (so it never mounts nothing). */
export const FALLBACK_VIEWPORT = 600;

/**
 * Rows of a fixed-height list that must be in the DOM: the ones on screen plus `overscan` rows
 * on each side, so a wheel tick never shows a blank strip before React catches up.
 */
export function rowRange(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan = 12,
): RowRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const view = viewport > 0 ? viewport : FALLBACK_VIEWPORT;
  // The browser may report a scrollTop beyond the list right after it shrinks (a folder closed).
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, count * rowHeight - view)));
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + view) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/**
 * scrollTop that brings row `index` fully into view, or null when it already is (focus moved
 * with the keyboard must scroll as little as a native list does).
 */
export function scrollToRow(
  index: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number,
): number | null {
  const view = viewport > 0 ? viewport : FALLBACK_VIEWPORT;
  const top = index * rowHeight;
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + view) return top + rowHeight - view;
  return null;
}

/** Turns of a chat mounted at once, and how many more each step up brings back. */
export const TURN_PAGE = 40;

/**
 * How many turns at the start of a conversation stay out of the DOM.
 *
 * Chat turns have unknown heights (markdown, code, tool cards), so the chat is not windowed row
 * by row: it mounts the tail and brings older turns back as the reader scrolls up.
 *  - A conversation that shrank below the hidden count (rewind, another one loaded) starts over.
 *  - Reading at the bottom, the mounted part is cut back to one page once it passes two pages
 *    (nothing above the fold moves: the view is pinned to the end).
 *  - Scrolled up, nothing is ever unmounted: that would move the text being read.
 */
export function hiddenTurns(
  hidden: number,
  total: number,
  atBottom: boolean,
  page = TURN_PAGE,
): number {
  if (total <= page) return 0;
  if (hidden >= total) return total - page;
  if (atBottom && total - hidden > page * 2) return total - page;
  return Math.max(0, hidden);
}

/** One step up: `page` more turns come back. */
export function showEarlier(hidden: number, page = TURN_PAGE): number {
  return Math.max(0, hidden - page);
}
