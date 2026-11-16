/**
 * Fase 2 — checkpoints per agent turn, "rewind here" and the turn's diff review.
 *
 * Pure (no fs): the agent keeps the checkpoints and writes the files; this module decides what
 * to write back and splits a file's change into blocks the user accepts or rejects one by one.
 * Texts are split keeping their line endings, so restoring or rebuilding a file gives back the
 * exact same characters (CRLF, a missing final newline and a BOM survive).
 */

/** What the agent saved before changing a file (see `Checkpoint` in main/agent.ts). */
export interface CheckpointLike {
  path: string;
  /** null = the file did not exist. */
  before: string | null;
  /** The exact bytes of `before` (base64) when the file is not valid UTF-8. */
  beforeBytes?: string;
  /** What the agent wrote (null = it deleted the file; undefined = not recorded). */
  after?: string | null;
  /** A file outside the workspace (absolute path). */
  absolute?: boolean;
  /** Project files: the workspace root they belong to. */
  root?: string;
  /** Backup copy of `before` on disk (system files). */
  backup?: string | null;
  /** Order across a conversation and its helpers. */
  seq?: number;
  /** The exchange (request id) that made the change. */
  turn?: string;
}

/** One file to write back: its content before the earliest change being undone. */
export interface RestoreStep {
  path: string;
  absolute: boolean;
  root?: string;
  /** null = delete it (the agent created it). */
  before: string | null;
  /** The exact bytes of `before` (base64) when it is not valid UTF-8. */
  beforeBytes?: string;
  /** What the last of these changes left (undefined = not recorded). */
  after?: string | null;
  /** Backup copies no longer needed once restored. */
  backups: string[];
}

const fileKey = (c: CheckpointLike) =>
  c.absolute ? `abs\0${c.path}` : `${c.root ?? ''}\0${c.path}`;

const bySeq = <C extends CheckpointLike>(cps: readonly C[]) =>
  cps
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (x.c.seq ?? x.i) - (y.c.seq ?? y.i) || x.i - y.i)
    .map((x) => x.c);

/** Groups checkpoints per file, oldest first; each file keeps its oldest `before`. */
function perFile(cps: readonly CheckpointLike[]): RestoreStep[] {
  const out = new Map<string, RestoreStep>();
  for (const c of bySeq(cps)) {
    const k = fileKey(c);
    let step = out.get(k);
    if (!step) {
      step = {
        path: c.path,
        absolute: !!c.absolute,
        ...(c.root !== undefined ? { root: c.root } : {}),
        before: c.before,
        ...(c.beforeBytes !== undefined ? { beforeBytes: c.beforeBytes } : {}),
        backups: [],
      };
      out.set(k, step);
    }
    if (c.backup) step.backups.push(c.backup);
    if (c.after === undefined) delete step.after;
    else step.after = c.after;
  }
  return [...out.values()];
}

/**
 * "Rewind here": undoes everything the agent changed from the first of `turns` on (that
 * exchange and every later one, helpers included). Changes are cut by order, not only by
 * turn: a later change to the same file would otherwise be left on top of a restored one.
 * Returns the files to write back and the checkpoints that stay.
 */
export function rewindPlan<C extends CheckpointLike>(
  cps: readonly C[],
  turns: ReadonlySet<string> | readonly string[],
): { restore: RestoreStep[]; keep: C[] } {
  const set = turns instanceof Set ? turns : new Set(turns as readonly string[]);
  const ordered = bySeq(cps);
  const first = ordered.findIndex((c) => c.turn !== undefined && set.has(c.turn));
  if (first < 0) return { restore: [], keep: [...cps] };
  return { restore: perFile(ordered.slice(first)), keep: ordered.slice(0, first) };
}

/**
 * The file was changed after the agent's last write (by hand, a formatter, another program):
 * restoring it would also throw that work away. Unknown when the write was not recorded.
 */
export function editedSince(step: Pick<RestoreStep, 'after'>, now: string | null): boolean {
  return step.after !== undefined && step.after !== now;
}

/** Files one exchange changed, with their content before it (oldest first). */
export function turnFiles(cps: readonly CheckpointLike[], turn: string): RestoreStep[] {
  return perFile(cps.filter((c) => c.turn === turn));
}

/** Exchanges that changed files, oldest first. */
export function changedTurns(cps: readonly CheckpointLike[]): string[] {
  const out: string[] = [];
  for (const c of bySeq(cps)) if (c.turn && !out.includes(c.turn)) out.push(c.turn);
  return out;
}

// ---------------------------------------------------------------------------------------
// Line diff and review by blocks

export interface DiffLine {
  kind: 'same' | 'del' | 'add';
  /** The line with its ending ("\n", "\r\n" or none at the end of the file). */
  text: string;
}

/** Splits keeping each line's ending: joining the parts gives back the text exactly. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Above this many cells the middle of the file is shown as one replaced block. */
const MAX_CELLS = 4_000_000;

/** Line diff (LCS) of two texts; common head and tail are skipped first. */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = splitLines(a);
  const y = splitLines(b);
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const head: DiffLine[] = x.slice(0, start).map((text) => ({ kind: 'same', text }));
  const tail: DiffLine[] = x.slice(endX).map((text) => ({ kind: 'same', text }));
  const mx = x.slice(start, endX);
  const my = y.slice(start, endY);
  const n = mx.length;
  const m = my.length;
  const mid: DiffLine[] = [];
  if (n * m > MAX_CELLS) {
    for (const text of mx) mid.push({ kind: 'del', text });
    for (const text of my) mid.push({ kind: 'add', text });
  } else {
    // lcs[i][j] = longest common subsequence of mx[i..] and my[j..]
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * w + j] =
          mx[i] === my[j]
            ? lcs[(i + 1) * w + j + 1]! + 1
            : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && mx[i] === my[j]) {
        mid.push({ kind: 'same', text: mx[i++]! });
        j++;
      } else if (i < n && (j >= m || lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) {
        // Deletions first inside a block: "- old / + new" reads better.
        mid.push({ kind: 'del', text: mx[i++]! });
      } else mid.push({ kind: 'add', text: my[j++]! });
    }
  }
  return [...head, ...mid, ...tail];
}

/** One block of changed lines, with some unchanged lines around it to read it. */
export interface Hunk {
  /** Block number (0-based), the key used by `applyReview`. */
  index: number;
  /** 1-based first line of the block in the old and the new text. */
  oldStart: number;
  newStart: number;
  /** Context before, the changed lines, context after. */
  lines: DiffLine[];
  added: number;
  removed: number;
}

/** Splits a diff into blocks of consecutive changed lines. */
export function hunks(before: string, after: string, context = 3): Hunk[] {
  const d = diffLines(before, after);
  const out: Hunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (let k = 0; k < d.length;) {
    if (d[k]!.kind === 'same') {
      oldLine++;
      newLine++;
      k++;
      continue;
    }
    const from = k;
    const oldStart = oldLine;
    const newStart = newLine;
    let added = 0;
    let removed = 0;
    while (k < d.length && d[k]!.kind !== 'same') {
      if (d[k]!.kind === 'add') {
        added++;
        newLine++;
      } else {
        removed++;
        oldLine++;
      }
      k++;
    }
    const lo = Math.max(0, from - context);
    const hi = Math.min(d.length, k + context);
    // Context stops at a neighbouring block (it shows in that block).
    let a = from;
    while (a > lo && d[a - 1]!.kind === 'same') a--;
    let b = k;
    while (b < hi && d[b]!.kind === 'same') b++;
    out.push({ index: out.length, oldStart, newStart, lines: d.slice(a, b), added, removed });
  }
  return out;
}

/**
 * Rebuilds the file keeping the accepted blocks of `after` and putting back the old lines of
 * the rejected ones. With nothing rejected it returns `after`; with everything, `before`.
 */
export function applyReview(before: string, after: string, rejected: ReadonlySet<number>): string {
  if (!rejected.size) return after;
  const d = diffLines(before, after);
  let out = '';
  let block = -1;
  let inBlock = false;
  for (const line of d) {
    if (line.kind === 'same') {
      inBlock = false;
      out += line.text;
      continue;
    }
    if (!inBlock) {
      block++;
      inBlock = true;
    }
    const keepOld = rejected.has(block);
    if ((line.kind === 'del') === keepOld) out += line.text;
  }
  return out;
}

/** Tools whose effects a rewind cannot undo (shown as a warning before rewinding). */
export const IRREVERSIBLE_TOOLS: readonly string[] = ['run_command'];

/**
 * Puts back the rejected blocks of a `before → after` change into `current`, a file that kept
 * changing after `after` (a later message or a hand edit). Each block is found by its new
 * lines and the unchanged lines around it; one that is no longer there exactly once is left
 * as it is and reported in `failed`.
 */
export function revertHunks(
  current: string,
  before: string,
  after: string,
  rejected: ReadonlySet<number>,
  context = 3,
): { text: string; failed: number[] } {
  if (current === after) return { text: applyReview(before, after, rejected), failed: [] };
  const d = diffLines(before, after);
  const blocks: { from: number; to: number }[] = [];
  for (let k = 0; k < d.length;) {
    if (d[k]!.kind === 'same') {
      k++;
      continue;
    }
    const from = k;
    while (k < d.length && d[k]!.kind !== 'same') k++;
    blocks.push({ from, to: k });
  }
  let lines = splitLines(current);
  const failed: number[] = [];
  // Last block first: replacing it does not move the lines the earlier ones are found by.
  for (let b = blocks.length - 1; b >= 0; b--) {
    if (!rejected.has(b)) continue;
    const { from, to } = blocks[b]!;
    let a = from;
    while (a > 0 && from - a < context && d[a - 1]!.kind === 'same') a--;
    let z = to;
    while (z < d.length && z - to < context && d[z]!.kind === 'same') z++;
    const pre = d.slice(a, from).map((l) => l.text);
    const post = d.slice(to, z).map((l) => l.text);
    const added = d
      .slice(from, to)
      .filter((l) => l.kind === 'add')
      .map((l) => l.text);
    const removed = d
      .slice(from, to)
      .filter((l) => l.kind === 'del')
      .map((l) => l.text);
    const find = [...pre, ...added, ...post];
    const atStart = a === 0;
    const atEnd = z === d.length;
    const hits: number[] = [];
    if (find.length)
      for (let i = 0; i + find.length <= lines.length; i++) {
        if (atStart && i !== 0) break;
        if (atEnd && i + find.length !== lines.length) continue;
        if (find.every((t, j) => lines[i + j] === t)) hits.push(i);
      }
    if (hits.length !== 1) {
      failed.push(b);
      continue;
    }
    const i = hits[0]!;
    lines = [...lines.slice(0, i), ...pre, ...removed, ...post, ...lines.slice(i + find.length)];
  }
  return { text: lines.join(''), failed: failed.reverse() };
}
