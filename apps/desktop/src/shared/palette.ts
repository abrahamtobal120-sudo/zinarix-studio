/**
 * Fase 19: the unified palette. Pure model: which list a query asks for (by its first
 * character), "go to line" parsing, and the "used lately" ranking. No DOM, no store.
 *
 *   (nothing)  files of the folder, the recent ones first
 *   >          commands, AI actions and models
 *   @          symbols of the open file
 *   #          chats: the open ones and the saved conversations
 *   :          go to a line (":120" or ":120:8")
 */

export type PaletteScope = 'files' | 'commands' | 'symbols' | 'chats' | 'line';

export const PREFIXES: Record<string, PaletteScope> = {
  '>': 'commands',
  '@': 'symbols',
  '#': 'chats',
  ':': 'line',
};

/** The prefix that opens a scope ('' for files). */
export function prefixOf(scope: PaletteScope): string {
  return Object.entries(PREFIXES).find(([, s]) => s === scope)?.[0] ?? '';
}

export interface PaletteQuery {
  scope: PaletteScope;
  /** What is searched within the scope (without the prefix, trimmed at the start). */
  text: string;
}

export function parseQuery(raw: string): PaletteQuery {
  const scope = PREFIXES[raw.charAt(0)];
  if (!scope) return { scope: 'files', text: raw.trim() };
  return { scope, text: raw.slice(1).trimStart() };
}

/** ":120", ":120:8" or ":120,8" → 1-based line and column; null when it is not a line. */
export function parseLine(text: string): { line: number; column: number } | null {
  const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const line = Number(m[1]);
  if (line < 1) return null;
  return { line, column: Math.max(1, Number(m[2] ?? 1)) };
}

/** How often and how lately each entry was picked, by "scope:id". */
export type PaletteRecent = Record<string, { n: number; last: number }>;

/** How many entries are kept (the least used are dropped first). */
export const RECENT_CAP = 300;

const DAY = 86_400_000;

export function recentKey(scope: PaletteScope, id: string): string {
  return `${scope}:${id}`;
}

/** Records a pick. Returns a new object; the oldest entries go past {@link RECENT_CAP}. */
export function bumpRecent(
  recent: PaletteRecent,
  key: string,
  now: number,
  cap = RECENT_CAP,
): PaletteRecent {
  const prev = recent[key];
  const next: PaletteRecent = { ...recent, [key]: { n: (prev?.n ?? 0) + 1, last: now } };
  const keys = Object.keys(next);
  if (keys.length <= cap) return next;
  keys.sort((a, b) => frecency(next[a], now) - frecency(next[b], now));
  for (const k of keys.slice(0, keys.length - cap)) if (k !== key) delete next[k];
  return next;
}

/**
 * "Used lately" weight: the number of picks, worth less the older the last one is
 * (half after a week). 0 when it was never picked.
 */
export function frecency(entry: { n: number; last: number } | undefined, now: number): number {
  if (!entry) return 0;
  const age = Math.max(0, now - entry.last) / DAY;
  return Math.min(entry.n, 20) * Math.pow(0.5, age / 7);
}

/** Reads a saved value defensively (localStorage can hold anything). */
export function readRecent(raw: unknown): PaletteRecent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PaletteRecent = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { n, last } = v as { n?: unknown; last?: unknown };
    if (
      typeof n === 'number' &&
      n > 0 &&
      Number.isFinite(n) &&
      typeof last === 'number' &&
      Number.isFinite(last)
    )
      out[k] = { n: Math.floor(n), last };
  }
  return out;
}

export interface Scored<T> {
  item: T;
  /** Text match score; < 0 = no match. With an empty query every item scores 0. */
  score: number;
  key: string;
}

/**
 * Orders the matches. With an empty query: the used-lately ones first (most weight first),
 * then the rest in their own order. With a query: the text match decides and use breaks
 * near-ties (a few points, so a much better match still wins).
 */
export function rankItems<T>(
  scored: Scored<T>[],
  recent: PaletteRecent,
  now: number,
  empty: boolean,
): T[] {
  const withUse = scored
    .map((s, i) => ({ ...s, i, use: frecency(recent[s.key], now) }))
    .filter((s) => s.score >= 0);
  if (empty) {
    withUse.sort((a, b) => b.use - a.use || a.i - b.i);
  } else {
    withUse.sort((a, b) => b.score + bonus(b.use) - (a.score + bonus(a.use)) || a.i - b.i);
  }
  return withUse.map((s) => s.item);
}

/** At most 30 points: enough to lift an entry past a similar match, not past a far better one. */
function bonus(use: number): number {
  return use > 0 ? Math.min(30, 10 + use * 2) : 0;
}
