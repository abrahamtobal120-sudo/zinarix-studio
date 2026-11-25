/**
 * Open tabs per folder (estudio, punto B4): which files were open in a folder, which one was
 * in front and where the cursor was, so reopening the folder (or Zinarix) brings them back.
 * Pure: no DOM, no storage. renderer/store.ts reads and writes it in localStorage.
 */

export interface SessionTab {
  path: string;
  line?: number;
  column?: number;
}

export interface TabSession {
  tabs: SessionTab[];
  active: string | null;
  /** When it was saved (ms), to drop the folders not opened for longest. */
  at: number;
  /** B1: the side editor group, when the editor was split (its files are tabs above too). */
  split?: SessionSplit;
}

export interface SessionSplit {
  paths: string[];
  active: string;
}

/** The side group limited to the tabs that are kept; undefined when nothing of it is left. */
function keptSplit(split: unknown, tabs: SessionTab[]): SessionSplit | undefined {
  if (!split || typeof split !== 'object') return undefined;
  const { paths, active } = split as { paths?: unknown; active?: unknown };
  if (!Array.isArray(paths)) return undefined;
  const kept: string[] = [];
  for (const p of paths as unknown[])
    if (typeof p === 'string' && !kept.includes(p) && tabs.some((x) => x.path === p)) kept.push(p);
  if (!kept.length) return undefined;
  return {
    paths: kept,
    active: typeof active === 'string' && kept.includes(active) ? active : kept[0]!,
  };
}

export type TabSessions = Record<string, TabSession>;

/** Folders remembered; the ones saved longest ago are dropped. */
export const MAX_FOLDERS = 30;
/** Tabs remembered per folder. */
export const MAX_TABS = 40;

const pos = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined;

/** Reads what was stored. Anything malformed is dropped: a bad entry never blocks a folder. */
export function parseSessions(raw: string | null | undefined): TabSessions {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? '');
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: TabSessions = {};
  for (const [root, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as { tabs?: unknown; active?: unknown; at?: unknown; split?: unknown };
    if (!Array.isArray(v.tabs)) continue;
    const tabs: SessionTab[] = [];
    for (const t of v.tabs as unknown[]) {
      if (!t || typeof t !== 'object') continue;
      const { path, line, column } = t as Record<string, unknown>;
      if (typeof path !== 'string' || !path || tabs.some((x) => x.path === path)) continue;
      const l = pos(line);
      const c = pos(column);
      tabs.push({ path, ...(l ? { line: l, column: c ?? 1 } : {}) });
    }
    if (!tabs.length) continue;
    const active =
      typeof v.active === 'string' && tabs.some((x) => x.path === v.active) ? v.active : null;
    const kept = tabs.slice(0, MAX_TABS);
    const split = keptSplit(v.split, kept);
    out[root] = {
      tabs: kept,
      active,
      at: typeof v.at === 'number' ? v.at : 0,
      ...(split ? { split } : {}),
    };
  }
  return out;
}

/**
 * The sessions with one folder's tabs replaced. A folder left with no tabs is forgotten (the
 * user closed everything on purpose), and only the MAX_FOLDERS most recent folders are kept.
 */
export function putSession(
  all: TabSessions,
  root: string,
  session: { tabs: SessionTab[]; active: string | null; split?: SessionSplit | null },
  now: number,
): TabSessions {
  const next: TabSessions = { ...all };
  delete next[root];
  const tabs = session.tabs.slice(0, MAX_TABS);
  if (tabs.length) {
    const split = keptSplit(session.split, tabs);
    next[root] = {
      tabs,
      active: session.active && tabs.some((x) => x.path === session.active) ? session.active : null,
      at: now,
      ...(split ? { split } : {}),
    };
  }
  const roots = Object.keys(next).sort((a, b) => next[b]!.at - next[a]!.at);
  for (const old of roots.slice(MAX_FOLDERS)) delete next[old];
  return next;
}
