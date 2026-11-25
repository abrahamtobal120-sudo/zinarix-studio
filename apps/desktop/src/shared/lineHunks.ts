/**
 * C4: line hunks between the text the user had and the text the AI proposed, for the review
 * inside the editor (renderer/inlineReview.ts). Pure: no Monaco here, so it is tested alone.
 */

/** A run of changed lines. Indexes are 0-based; a count of 0 is a pure insertion or deletion. */
export interface LineHunk {
  /** First line of the run in the old text. */
  aStart: number;
  aCount: number;
  /** First line of the run in the new text. */
  bStart: number;
  bCount: number;
}

/** Above this many cells the table would take too long: the middle becomes one hunk. */
const MAX_CELLS = 4_000_000;

/** The changed runs that turn `a` into `b`, top to bottom. Equal texts give []. */
export function lineHunks(a: readonly string[], b: readonly string[]): LineHunk[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || n * m > MAX_CELLS)
    return [{ aStart: head, aCount: n, bStart: head, bCount: m }];

  // Longest common subsequence of the middle, filled from the end so the walk goes forward.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[head + i] === b[head + j]
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const out: LineHunk[] = [];
  let i = 0;
  let j = 0;
  let open: LineHunk | null = null;
  const change = (): LineHunk =>
    (open ??= { aStart: head + i, aCount: 0, bStart: head + j, bCount: 0 });
  while (i < n || j < m) {
    if (i < n && j < m && a[head + i] === b[head + j]) {
      if (open) out.push(open);
      open = null;
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i * w + j + 1]! >= lcs[(i + 1) * w + j]!)) {
      change().bCount++;
      j++;
    } else {
      change().aCount++;
      i++;
    }
  }
  if (open) out.push(open);
  return out;
}

/** A text edit in 1-based editor coordinates (the shape Monaco takes). */
export interface LineEdit {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  text: string;
}

/**
 * The edit that puts the old lines back where a hunk is now in the document.
 * `line` is the first line of the hunk's new text (1-based); for a pure deletion it is the
 * line the removed text sat before, which is lineCount + 1 when it was the end of the file.
 * `lineLength(n)` is the length of line n of the document.
 */
export function revertEdit(
  line: number,
  newCount: number,
  oldLines: readonly string[],
  lineCount: number,
  lineLength: (n: number) => number,
  eol: string,
): LineEdit {
  const old = oldLines.join(eol);
  if (newCount > 0 && oldLines.length > 0) {
    const last = line + newCount - 1;
    return {
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: last,
      endColumn: lineLength(last) + 1,
      text: old,
    };
  }
  if (newCount > 0) {
    // Only added lines: take them out with one of their line breaks.
    const last = line + newCount - 1;
    if (last < lineCount)
      return {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: last + 1,
        endColumn: 1,
        text: '',
      };
    if (line > 1)
      return {
        startLineNumber: line - 1,
        startColumn: lineLength(line - 1) + 1,
        endLineNumber: last,
        endColumn: lineLength(last) + 1,
        text: '',
      };
    // The added lines are the whole document.
    return {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: last,
      endColumn: lineLength(last) + 1,
      text: '',
    };
  }
  // Only removed lines: put them back before `line`, or after the last line of the file.
  if (line <= lineCount)
    return {
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: 1,
      text: old + eol,
    };
  const end = lineLength(lineCount) + 1;
  return {
    startLineNumber: lineCount,
    startColumn: end,
    endLineNumber: lineCount,
    endColumn: end,
    text: eol + old,
  };
}
