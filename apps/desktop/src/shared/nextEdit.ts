/**
 * Fase 8 — "Tab" de nueva generación: the pure part of next-edit prediction.
 *
 * The model proposes several edits at once (each one a block of whole lines, possibly
 * multi-line); the editor shows the first one, Tab jumps to it, Tab again applies it and the
 * rest are shifted and shown one after another. Everything here is pure (no Monaco, no IPC)
 * so it can be tested on its own.
 */
import type { NextEditRequestView } from './lsp.js';

/** One proposed change: lines startLine..endLine (1-based, inclusive) become `replacement`. */
export interface NextEditHunk {
  startLine: number;
  endLine: number;
  /** The lines as they are now (what the model saw). */
  original: string[];
  /** New lines (empty array = delete the block). */
  replacement: string[];
}

/** Edits proposed at most per prediction. */
export const MAX_HUNKS = 8;
/** Lines one hunk may span at most (bigger answers are usually the model rewriting the file). */
export const MAX_HUNK_LINES = 30;

function splitLines(s: string): string[] {
  return s.replace(/\r\n/g, '\n').split('\n');
}

function sameLine(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** The JSON object (or array) in a model answer, tolerating fences and text around it. */
function jsonIn(text: string): unknown {
  const s = text.trim();
  if (!s || /^(none|null|\{\s*\}|\[\s*\])$/i.test(s)) return undefined;
  const candidates: [number, number][] = [
    [s.indexOf('{'), s.lastIndexOf('}')],
    [s.indexOf('['), s.lastIndexOf(']')],
  ];
  // Whichever bracket comes first wraps the answer.
  candidates.sort((a, b) => (a[0] < 0 ? 1 : b[0] < 0 ? -1 : a[0] - b[0]));
  for (const [start, end] of candidates) {
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      // try the other bracket
    }
  }
  return undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/**
 * Reads the model's answer: `{"edits":[{"line":n | "start":a,"end":b, "original":"…",
 * "replacement":"…"}]}`, a bare array of those, the single-edit form `{"line","original",
 * "replacement"}` of the first version, or "none". Each edit is checked against the lines the
 * model was shown: the block must be inside the window and its "original" must match what is
 * really there (by trimmed lines), otherwise it is dropped. No-ops and overlapping edits are
 * dropped too. Result: sorted by line, at most MAX_HUNKS.
 */
export function parseNextEdits(
  text: string,
  req: Pick<NextEditRequestView, 'startLine' | 'lines'>,
): NextEditHunk[] {
  const v = jsonIn(text);
  if (!v || typeof v !== 'object') return [];
  const list: unknown[] = Array.isArray(v)
    ? v
    : Array.isArray((v as { edits?: unknown }).edits)
      ? (v as { edits: unknown[] }).edits
      : [v];
  const out: NextEditHunk[] = [];
  for (const raw of list.slice(0, MAX_HUNKS * 2)) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.replacement !== 'string') continue;
    const start = num(o.start) ?? num(o.line);
    if (start === undefined) continue;
    const end = num(o.end) ?? start;
    if (end < start || end - start + 1 > MAX_HUNK_LINES) continue;
    const i0 = start - req.startLine;
    const i1 = end - req.startLine;
    if (i0 < 0 || i1 >= req.lines.length) continue;
    const current = req.lines.slice(i0, i1 + 1);
    if (typeof o.original === 'string') {
      const said = splitLines(o.original);
      // The model must be talking about the lines that are really there.
      if (said.length !== current.length || said.some((l, k) => !sameLine(l, current[k]!)))
        continue;
    }
    const replacement = o.replacement === '' && o.delete === true ? [] : splitLines(o.replacement);
    if (replacement.length > MAX_HUNK_LINES * 2) continue;
    if (replacement.length === current.length && replacement.every((l, k) => l === current[k]))
      continue;
    out.push({ startLine: start, endLine: end, original: current, replacement });
  }
  out.sort((a, b) => a.startLine - b.startLine);
  // Overlapping blocks cannot both be applied: keep the first.
  const kept: NextEditHunk[] = [];
  for (const h of out) if (!kept.length || h.startLine > kept.at(-1)!.endLine) kept.push(h);
  return kept.slice(0, MAX_HUNKS);
}

/** How many lines a hunk adds (negative: removes) once applied. */
export function hunkDelta(h: NextEditHunk): number {
  return h.replacement.length - (h.endLine - h.startLine + 1);
}

/**
 * The remaining hunks after `applied` was applied: the ones below it move by its line delta;
 * any that overlapped it are dropped.
 */
export function shiftAfterApply(rest: NextEditHunk[], applied: NextEditHunk): NextEditHunk[] {
  const d = hunkDelta(applied);
  const out: NextEditHunk[] = [];
  for (const h of rest) {
    if (h.endLine < applied.startLine) out.push(h);
    else if (h.startLine > applied.endLine)
      out.push({ ...h, startLine: h.startLine + d, endLine: h.endLine + d });
  }
  return out;
}

/** True when the document still has the hunk's original lines where it expects them. */
export function hunkStillValid(
  h: NextEditHunk,
  lineAt: (n: number) => string | undefined,
): boolean {
  for (let k = 0; k < h.original.length; k++) {
    const cur = lineAt(h.startLine + k);
    if (cur === undefined || !sameLine(cur, h.original[k]!)) return false;
  }
  return true;
}

/**
 * The hunk moved to where its original lines are now, searching up to `radius` lines around
 * its old place (nearest first) — e.g. an auto-import added lines above it. Null when the
 * lines are gone (the user changed them).
 */
export function relocateHunk(
  h: NextEditHunk,
  lineAt: (n: number) => string | undefined,
  radius = 25,
): NextEditHunk | null {
  for (let d = 0; d <= radius; d++) {
    for (const sign of d ? [1, -1] : [1]) {
      const start = h.startLine + sign * d;
      if (start < 1) continue;
      const moved = { ...h, startLine: start, endLine: start + (h.endLine - h.startLine) };
      if (hunkStillValid(moved, lineAt)) return moved;
    }
  }
  return null;
}

/**
 * Order in which Tab visits the hunks: the first one at or below the cursor, then the rest
 * downwards, then the ones above (wrapping), like reading on from where the user is.
 */
export function visitOrder(hunks: NextEditHunk[], cursorLine: number): NextEditHunk[] {
  const sorted = [...hunks].sort((a, b) => a.startLine - b.startLine);
  const i = sorted.findIndex((h) => h.endLine >= cursorLine);
  return i <= 0 ? sorted : [...sorted.slice(i), ...sorted.slice(0, i)];
}

/** True when the cursor is on (or right at the edge of) the hunk: Tab applies instead of jumping. */
export function cursorOnHunk(h: NextEditHunk, cursorLine: number): boolean {
  return cursorLine >= h.startLine && cursorLine <= Math.max(h.endLine, h.startLine);
}

/** Lines compared the way the user sees them: indentation does not count. */
function norm(lines: string[]): string {
  return lines.map((l) => l.trim()).join('\n');
}

/**
 * True when `current` is on the way from `original` to `replacement`: the user is typing (or
 * deleting) exactly what the suggestion proposes, so it should stay on screen. With the
 * changed middle of original -> replacement being `old` -> `neu`, the middle now must be the
 * start of `neu` (typing it after removing `old`) or `old` partly deleted (from either end).
 */
export function typedToward(original: string[], current: string[], replacement: string[]): boolean {
  const o = norm(original);
  const c = norm(current);
  const r = norm(replacement);
  if (c === o || c === r) return false;
  let p = 0;
  while (p < o.length && p < r.length && o[p] === r[p]) p++;
  let s = 0;
  while (s < o.length - p && s < r.length - p && o[o.length - 1 - s] === r[r.length - 1 - s]) s++;
  const fits = (p: number, s: number): boolean => {
    if (c.length < p + s || !c.startsWith(o.slice(0, p)) || !c.endsWith(o.slice(o.length - s)))
      return false;
    const mid = c.slice(p, c.length - s);
    const old = o.slice(p, o.length - s);
    const neu = r.slice(p, r.length - s);
    if (mid.length > 0 && neu.startsWith(mid)) return true;
    return old.length > 0 && mid.length < old.length && (old.startsWith(mid) || old.endsWith(mid));
  };
  // Where the change starts is ambiguous when it repeats the text before it (an inserted
  // line "x" + newline before the final "}" is also newline + "x" right after "{"): try the
  // change slid to the left too.
  for (let k = 0; k <= Math.min(p, 64); k++) {
    const sk = s + k;
    if (k && o.slice(o.length - sk) !== r.slice(r.length - sk)) break;
    if (fits(p - k, sk)) return true;
  }
  return false;
}

export interface RebaseResult {
  queue: NextEditHunk[];
  /** The user typed part of the first hunk: it stays, there is no need to ask the model again. */
  typedThrough: boolean;
  /** The user typed exactly what a hunk proposed (the suggestion was right; it is gone now). */
  completed: boolean;
}

/**
 * The queue after a change the USER made (`edit` = the changed block, as lineDiff gives it, in
 * the coordinates of the document before the change; `lineAt` reads the document after it).
 * Hunks above or below the change survive (the ones below move by its line delta); the hunk
 * the change falls in survives only when the user is typing what it proposes, and is dropped
 * once the text equals its replacement. Anything else the change touched is dropped.
 */
export function rebaseAfterUserEdit(
  queue: NextEditHunk[],
  edit: { line: number; before: string[]; after: string[] },
  lineAt: (n: number) => string | undefined,
): RebaseResult {
  const delta = edit.after.length - edit.before.length;
  const editEnd = edit.line + edit.before.length - 1;
  const out: NextEditHunk[] = [];
  let typedThrough = false;
  let completed = false;
  queue.forEach((h, i) => {
    let next: NextEditHunk | null = null;
    if (h.endLine < edit.line) next = h;
    else if (h.startLine > editEnd)
      next = { ...h, startLine: h.startLine + delta, endLine: h.endLine + delta };
    else if (edit.line >= h.startLine && editEnd <= h.endLine) {
      const end = h.endLine + delta;
      const current: string[] = [];
      for (let n = h.startLine; n <= end; n++) {
        const l = lineAt(n);
        if (l === undefined) return;
        current.push(l);
      }
      if (norm(current) === norm(h.replacement)) {
        completed = true;
        return;
      }
      if (end >= h.startLine && typedToward(h.original, current, h.replacement)) {
        if (i === 0) typedThrough = true;
        out.push({ ...h, endLine: end, original: current });
      }
      return;
    }
    if (next && hunkStillValid(next, lineAt)) out.push(next);
  });
  return { queue: out, typedThrough, completed };
}

// ---------------------------------------------------------------- recent edits

/** One change the user made, in lines (what the prompt shows as "recent edits"). */
export interface RecentEdit {
  path: string;
  line: number;
  before: string[];
  after: string[];
}

/**
 * The change between two versions of a document, as one block of lines (common prefix and
 * suffix stripped). Null when nothing changed.
 */
export function lineDiff(before: string[], after: string[]): Omit<RecentEdit, 'path'> | null {
  let s = 0;
  while (s < before.length && s < after.length && before[s] === after[s]) s++;
  let eb = before.length - 1;
  let ea = after.length - 1;
  while (eb >= s && ea >= s && before[eb] === after[ea]) {
    eb--;
    ea--;
  }
  if (s > eb && s > ea) return null;
  return { line: s + 1, before: before.slice(s, eb + 1), after: after.slice(s, ea + 1) };
}

/**
 * Adds a change to the history: typing on the same line merges into the previous entry (so
 * "c", "co", "cou"… is one edit), the history keeps the last `max` entries.
 */
export function pushRecentEdit(list: RecentEdit[], e: RecentEdit, max = 8): RecentEdit[] {
  const last = list.at(-1);
  if (
    last &&
    last.path === e.path &&
    last.line === e.line &&
    last.after.length === 1 &&
    e.before.length === 1 &&
    e.after.length === 1 &&
    last.after[0] === e.before[0]
  ) {
    const merged = { ...last, after: e.after };
    // Typed and erased back to where it was: no edit at all.
    const noop = merged.before.length === 1 && merged.before[0] === merged.after[0];
    return noop ? list.slice(0, -1) : [...list.slice(0, -1), merged];
  }
  return [...list, e].slice(-max);
}

/** The history as the prompt shows it (a small unified diff per edit), at most `max` chars. */
export function formatRecentEdits(list: RecentEdit[], max = 3000): string {
  const parts = list.map((e) => {
    const minus = e.before.map((l) => `-${l}`).join('\n');
    const plus = e.after.map((l) => `+${l}`).join('\n');
    return `${e.path}:${e.line}\n${[minus, plus].filter(Boolean).join('\n')}`;
  });
  const text = parts.join('\n\n');
  return text.length > max ? text.slice(-max) : text;
}

// ---------------------------------------------------------------- acceptance metric

export type SuggestionKind = 'inline' | 'nextEdit';
export type SuggestionOutcome = 'shown' | 'accepted' | 'dismissed' | 'empty' | 'error';

export interface SuggestionEvent {
  kind: SuggestionKind;
  model: string;
  outcome: SuggestionOutcome;
  /** Request time (ms) for shown / empty / error. */
  latencyMs?: number;
  at: number;
}

export interface SuggestionStatsRow {
  kind: SuggestionKind;
  model: string;
  requests: number;
  shown: number;
  accepted: number;
  /** accepted / shown (0..1); null when nothing was shown. */
  acceptRate: number | null;
  p50: number | null;
  p90: number | null;
}

/** p-th percentile (0..100) by nearest rank; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length - 1, Math.max(0, rank - 1))]!;
}

/** Summary per (kind, model), most used first. */
export function suggestionStats(events: SuggestionEvent[]): SuggestionStatsRow[] {
  const rows = new Map<string, SuggestionStatsRow & { lat: number[] }>();
  for (const e of events) {
    const key = `${e.kind}\u0000${e.model}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        kind: e.kind,
        model: e.model,
        requests: 0,
        shown: 0,
        accepted: 0,
        acceptRate: null,
        p50: null,
        p90: null,
        lat: [],
      };
      rows.set(key, r);
    }
    if (e.outcome === 'shown' || e.outcome === 'empty' || e.outcome === 'error') {
      r.requests++;
      if (typeof e.latencyMs === 'number' && e.outcome !== 'error') r.lat.push(e.latencyMs);
    }
    if (e.outcome === 'shown') r.shown++;
    if (e.outcome === 'accepted') r.accepted++;
  }
  return [...rows.values()]
    .map(({ lat, ...r }) => ({
      ...r,
      acceptRate: r.shown ? Math.min(1, r.accepted / r.shown) : null,
      p50: percentile(lat, 50),
      p90: percentile(lat, 90),
    }))
    .sort((a, b) => b.requests - a.requests);
}

/** Latency goal of the plan for a fast model (p50, ms). */
export const TARGET_P50_MS = 400;

/**
 * Pause after the last keystroke before asking the model, tuned from the metric: when
 * suggestions are rarely accepted, ask less often (save tokens, less noise); when they are
 * accepted a lot and the model is fast, ask sooner. Clamped to [250, 1200] ms.
 */
export function adaptiveDebounce(row: SuggestionStatsRow | undefined, base = 450): number {
  if (!row || row.shown < 10 || row.acceptRate === null) return base;
  let d = base;
  if (row.acceptRate < 0.1) d = base * 2;
  else if (row.acceptRate < 0.2) d = base * 1.4;
  else if (row.acceptRate > 0.4 && (row.p50 ?? Infinity) <= TARGET_P50_MS) d = base * 0.7;
  return Math.round(Math.min(1200, Math.max(250, d)));
}

/** Advice for Settings: null when the model meets the goal (or there is too little data). */
export function latencyAdvice(row: SuggestionStatsRow): 'slow' | 'lowAccept' | null {
  if (row.requests < 10) return null;
  if ((row.p50 ?? 0) > TARGET_P50_MS) return 'slow';
  if (row.shown >= 10 && (row.acceptRate ?? 1) < 0.1) return 'lowAccept';
  return null;
}
