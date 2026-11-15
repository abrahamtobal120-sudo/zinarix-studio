import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** One visit kept in the browser history (the latest visit of each address). */
export interface HistoryEntry {
  url: string;
  title: string;
  /** Last visit (ms since epoch). */
  at: number;
  /** Times visited, to rank the address bar suggestions. */
  visits: number;
}

export interface Bookmark {
  url: string;
  title: string;
  at: number;
}

interface Stored {
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  /** Small favicons (data: URLs) by host, so the renderer can show them without network. */
  icons: Record<string, string>;
}

/** Addresses kept in the history; the oldest visits go first. */
export const HISTORY_MAX = 5000;
const ICONS_MAX = 600;
const SAVE_DELAY = 1500;

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/** Only real pages are remembered (no blank page, no data:/file: addresses). */
export function rememberable(url: string): boolean {
  return /^https?:\/\//i.test(url) && url.length <= 4096;
}

/**
 * History, bookmarks and favicons of the built-in browser, in one JSON file in the app's
 * data folder (shared by every window). Writes are grouped (a page that changes its title
 * ten times while loading is written once) and atomic (a crash never leaves half a file).
 */
export class BrowserData {
  private data: Stored = { history: [], bookmarks: [], icons: {} };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
      this.data = {
        history: Array.isArray(raw.history)
          ? raw.history.filter((h) => h && typeof h.url === 'string')
          : [],
        bookmarks: Array.isArray(raw.bookmarks)
          ? raw.bookmarks.filter((b) => b && typeof b.url === 'string')
          : [],
        icons: raw.icons && typeof raw.icons === 'object' ? raw.icons : {},
      };
    } catch {
      // No file yet (or unreadable): start empty.
    }
  }

  static inDir(dir: string): BrowserData {
    return new BrowserData(join(dir, 'browser-data.json'));
  }

  // ---- history

  /** A page was visited (or its title changed): it moves to the top of the history. */
  visit(url: string, title: string, now = Date.now()): void {
    if (!rememberable(url)) return;
    const h = this.data.history;
    const i = h.findIndex((x) => x.url === url);
    const prev = i >= 0 ? h.splice(i, 1)[0]! : undefined;
    h.unshift({ url, title: title || prev?.title || '', at: now, visits: (prev?.visits ?? 0) + 1 });
    if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
    this.save();
  }

  /** Title arrived after the visit: updated in place (not a new visit). */
  retitle(url: string, title: string): void {
    if (!title) return;
    const e = this.data.history.find((x) => x.url === url);
    if (e && e.title !== title) {
      e.title = title;
      this.save();
    }
    const b = this.data.bookmarks.find((x) => x.url === url);
    if (b && !b.title) {
      b.title = title;
      this.save();
    }
  }

  /** Newest first; with a query, the entries whose title or address contain every word. */
  history(query = '', limit = 300): HistoryEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out: HistoryEntry[] = [];
    for (const e of this.data.history) {
      if (out.length >= limit) break;
      const hay = `${e.title} ${e.url}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push(e);
    }
    return out;
  }

  /**
   * Address bar suggestions: bookmarks and history entries matching what was typed,
   * addresses that start with it first, then the most visited.
   */
  suggest(query: string, limit = 8): (HistoryEntry & { bookmark: boolean })[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const bare = (u: string) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
    const marked = new Set(this.data.bookmarks.map((b) => b.url));
    const seen = new Set<string>();
    const scored: { e: HistoryEntry; score: number }[] = [];
    const add = (e: HistoryEntry, bonus: number) => {
      if (seen.has(e.url)) return;
      const url = bare(e.url);
      const title = e.title.toLowerCase();
      let score: number;
      if (url.startsWith(q)) score = 1000;
      else if (url.includes(q)) score = 400;
      else if (title.includes(q)) score = 200;
      else return;
      seen.add(e.url);
      score += bonus + Math.min(e.visits, 50) * 5 - url.length * 0.5;
      scored.push({ e, score });
    };
    for (const b of this.data.bookmarks) add({ ...b, visits: 1 }, 300);
    for (const e of this.data.history) add(e, 0);
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ e }) => ({ ...e, bookmark: marked.has(e.url) }));
  }

  forget(url: string): void {
    const before = this.data.history.length;
    this.data.history = this.data.history.filter((x) => x.url !== url);
    if (this.data.history.length !== before) this.save();
  }

  clearHistory(): void {
    this.data.history = [];
    this.save();
  }

  // ---- bookmarks

  bookmarks(): Bookmark[] {
    return [...this.data.bookmarks];
  }

  isBookmarked(url: string): boolean {
    return this.data.bookmarks.some((b) => b.url === url);
  }

  /** Adds the page to the bookmarks, or removes it if it was there. Returns the new state. */
  toggleBookmark(url: string, title: string): boolean {
    if (!rememberable(url)) return false;
    if (this.isBookmarked(url)) {
      this.removeBookmark(url);
      return false;
    }
    this.data.bookmarks.unshift({ url, title, at: Date.now() });
    this.save();
    return true;
  }

  removeBookmark(url: string): void {
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.url !== url);
    this.save();
  }

  // ---- favicons

  icon(url: string): string | undefined {
    return this.data.icons[hostOf(url)];
  }

  hasIcon(url: string): boolean {
    return hostOf(url) in this.data.icons;
  }

  setIcon(url: string, dataUrl: string): void {
    const host = hostOf(url);
    if (!host || !/^data:image\//.test(dataUrl)) return;
    const icons = this.data.icons;
    delete icons[host];
    icons[host] = dataUrl;
    const keys = Object.keys(icons);
    for (const k of keys.slice(0, Math.max(0, keys.length - ICONS_MAX))) delete icons[k];
    this.save();
  }

  /** Icons of the given addresses (by host), for the renderer. */
  iconsFor(urls: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const u of urls) {
      const h = hostOf(u);
      const i = this.data.icons[h];
      if (i) out[h] = i;
    }
    return out;
  }

  // ---- disk

  private save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY);
    this.timer.unref?.();
  }

  /** Writes pending changes now (on quit). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // Disk full or read-only: the history stays in memory for this session.
    }
  }
}
