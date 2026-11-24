import { readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app, session } from 'electron';
import { COOKIE_FILE_MAX, parseCookieFile } from '../shared/cookieFile.js';
import type { ImportCookie } from '../shared/cookieFile.js';
import { BROWSER_PARTITION } from './browser.js';

/** What the browser settings show about its cookies. */
export interface CookieInfo {
  /** Cookies the built-in browser keeps now. */
  count: number;
  /** Last import (ms since epoch), or null if the user never imported cookies. */
  importedAt: number | null;
  /** Cookies taken in by that import. */
  imported: number;
}

export interface CookieImportResult {
  imported: number;
  /** Entries left out (unreadable, expired, or refused by the browser). */
  skipped: number;
  /** Sites (domains) the cookies are for. */
  sites: number;
}

const marker = () => join(app.getPath('userData'), 'browser-cookies.json');

function readMarker(): { importedAt: number; imported: number } | null {
  try {
    const m = JSON.parse(readFileSync(marker(), 'utf8')) as { importedAt?: unknown; imported?: unknown };
    return typeof m.importedAt === 'number'
      ? { importedAt: m.importedAt, imported: typeof m.imported === 'number' ? m.imported : 0 }
      : null;
  } catch {
    return null;
  }
}

const ses = () => session.fromPartition(BROWSER_PARTITION);

export async function cookieInfo(): Promise<CookieInfo> {
  const m = readMarker();
  const count = (await ses().cookies.get({})).length;
  return { count, importedAt: m?.importedAt ?? null, imported: m?.imported ?? 0 };
}

/**
 * Puts a list of cookies (from a file or read straight from an installed browser) in the
 * built-in browser, counting what it took in and recording the import. `skipped` seeds the
 * count with entries dropped before this point (bad lines, undecryptable values).
 */
export async function injectCookies(
  cookies: ImportCookie[],
  skipped = 0,
): Promise<CookieImportResult> {
  const store = ses().cookies;
  let imported = 0;
  const sites = new Set<string>();
  for (const c of cookies) {
    try {
      await store.set(c);
      imported++;
      sites.add((c.domain ?? new URL(c.url).hostname).replace(/^\./, ''));
    } catch {
      skipped++;
    }
  }
  await store.flushStore().catch(() => {});
  if (imported > 0) {
    writeFileSync(marker(), JSON.stringify({ importedAt: Date.now(), imported }));
  }
  return { imported, skipped, sites: sites.size };
}

/** Puts the cookies of an export file in the built-in browser (logins carry over). */
export async function importCookieFile(file: string): Promise<CookieImportResult> {
  if (statSync(file).size > COOKIE_FILE_MAX) throw new Error('too-big');
  const parsed = parseCookieFile(readFileSync(file, 'utf8'));
  return injectCookies(parsed.cookies, parsed.skipped);
}

/** Deletes every cookie of the built-in browser (signs out of every site). */
export async function clearCookies(): Promise<void> {
  await ses().clearStorageData({ storages: ['cookies'] });
  await ses().cookies.flushStore().catch(() => {});
  rmSync(marker(), { force: true });
}
