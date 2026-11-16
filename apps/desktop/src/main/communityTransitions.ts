import {
  COMMUNITY_LIST_URL,
  COMMUNITY_REPO,
  DEF_BYTES_MAX,
  parseTransitionFile,
  type TransitionDef,
} from '../shared/videoTransitions.js';

/**
 * The transitions people shared in the Zinarix Studio repository (community/transitions),
 * downloaded from GitHub. Each file is validated with the same rules as an import: only data,
 * numbers clamped, broken files skipped. Kept for 10 minutes (GitHub limits anonymous calls).
 */
const MAX_FILES = 200;
const TTL = 10 * 60_000;
let cache: { at: number; defs: TransitionDef[] } | null = null;

async function getText(url: string, signal: AbortSignal): Promise<string> {
  const r = await fetch(url, {
    signal,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'zinarix-studio' },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.text();
}

export async function communityTransitions(force = false): Promise<TransitionDef[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.defs;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const list = JSON.parse(await getText(COMMUNITY_LIST_URL, ctl.signal)) as unknown;
    if (!Array.isArray(list)) throw new Error('Unexpected answer from GitHub.');
    const raw = `https://raw.githubusercontent.com/${COMMUNITY_REPO}/main/`;
    const files = list
      .filter(
        (x): x is { name: string; size: number; download_url: string } =>
          !!x &&
          typeof x.name === 'string' &&
          /^[a-z0-9-]+\.json$/.test(x.name) &&
          typeof x.download_url === 'string' &&
          // Only files of this repository, never a link elsewhere.
          x.download_url.startsWith(raw) &&
          typeof x.size === 'number' &&
          x.size <= DEF_BYTES_MAX,
      )
      .slice(0, MAX_FILES);
    const defs: TransitionDef[] = [];
    await Promise.all(
      files.map(async (f) => {
        try {
          const d = parseTransitionFile(await getText(f.download_url, ctl.signal));
          if (!('error' in d)) defs.push(d);
        } catch {
          // One broken or missing file does not hide the others.
        }
      }),
    );
    defs.sort((a, b) => a.name.localeCompare(b.name));
    cache = { at: Date.now(), defs };
    return defs;
  } finally {
    clearTimeout(timer);
  }
}
