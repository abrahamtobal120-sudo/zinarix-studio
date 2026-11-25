/**
 * B7: marks in the editor margin for what changed since the last git version of the file
 * (added, modified and deleted lines). Pure: no Monaco here, so it is tested alone.
 */
import { lineHunks } from './lineHunks';

export type GutterKind = 'added' | 'modified' | 'deleted';

export interface GutterMark {
  kind: GutterKind;
  /** 1-based lines of the current text. A deletion marks one line (see `above`). */
  start: number;
  end: number;
  /** Deletion only: the lines went away ABOVE `start` (false: below it, at the end of the file). */
  above?: boolean;
  /** The lines of the git version this mark replaces (empty for an addition). */
  old: string[];
}

/** Files bigger than this get no marks: the comparison would stall typing. */
export const GUTTER_MAX_CHARS = 1_500_000;

const lines = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n');

/**
 * Marks that turn `base` (the git version) into `current`, top to bottom. Line endings are
 * ignored, so a file checked out with CRLF does not show every line as changed.
 */
export function gutterMarks(base: string, current: string): GutterMark[] {
  if (base.length > GUTTER_MAX_CHARS || current.length > GUTTER_MAX_CHARS) return [];
  const a = lines(base);
  const b = lines(current);
  const out: GutterMark[] = [];
  for (const h of lineHunks(a, b)) {
    const old = a.slice(h.aStart, h.aStart + h.aCount);
    if (h.bCount === 0) {
      // Lines removed between b[bStart-1] and b[bStart].
      const above = h.bStart < b.length;
      const line = above ? h.bStart + 1 : b.length;
      out.push({ kind: 'deleted', start: line, end: line, above, old });
    } else {
      out.push({
        kind: h.aCount === 0 ? 'added' : 'modified',
        start: h.bStart + 1,
        end: h.bStart + h.bCount,
        old,
      });
    }
  }
  return out;
}

/** Counts for the status text: lines added, modified and removed. */
export function gutterSummary(marks: readonly GutterMark[]): {
  added: number;
  modified: number;
  deleted: number;
} {
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const m of marks) {
    if (m.kind === 'added') added += m.end - m.start + 1;
    else if (m.kind === 'modified') modified += m.end - m.start + 1;
    else deleted += m.old.length;
  }
  return { added, modified, deleted };
}

/** The mark after (dir 1) or before (dir -1) a line, wrapping around. Null when there are none. */
export function nextMark(
  marks: readonly GutterMark[],
  line: number,
  dir: 1 | -1,
): GutterMark | null {
  if (!marks.length) return null;
  if (dir === 1) return marks.find((m) => m.start > line) ?? marks[0]!;
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i]!.end < line) return marks[i]!;
  return marks[marks.length - 1]!;
}
