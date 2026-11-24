import { execFile } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { buildImportCookie } from '../shared/cookieFile.js';
import type { ImportCookie } from '../shared/cookieFile.js';
import { injectCookies } from './browserCookies.js';
import type { CookieImportResult } from './browserCookies.js';

const run = promisify(execFile);

/** One installed browser we can try to read cookies from. */
export interface BrowserSource {
  /** Stable key for the renderer. */
  id: string;
  /** Shown to the user ("Google Chrome", "Firefox"). */
  name: string;
  family: 'chromium' | 'firefox';
}

/** What a direct import got from one browser. */
export interface DirectImportResult extends CookieImportResult {
  /** Cookies left unreadable because the browser encrypts them with a key we can't reach. */
  appBoundBlocked: number;
  /** The browser's cookie database was locked (it is open): ask the user to close it. */
  locked: boolean;
}

const LOCAL = process.env.LOCALAPPDATA ?? '';
const ROAMING = process.env.APPDATA ?? '';

/** Chromium browsers to look for, with the root of their user data. */
const CHROMIUM: { id: string; name: string; dir: string }[] = [
  { id: 'chrome', name: 'Google Chrome', dir: join(LOCAL, 'Google', 'Chrome', 'User Data') },
  { id: 'edge', name: 'Microsoft Edge', dir: join(LOCAL, 'Microsoft', 'Edge', 'User Data') },
  { id: 'brave', name: 'Brave', dir: join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data') },
];

/** The installed browsers we could read cookies from (so the UI can offer them). */
export function listBrowserSources(): BrowserSource[] {
  const out: BrowserSource[] = [];
  if (process.platform === 'win32') {
    for (const b of CHROMIUM)
      if (existsSync(join(b.dir, 'Local State')))
        out.push({ id: b.id, name: b.name, family: 'chromium' });
  }
  if (firefoxProfiles().length) out.push({ id: 'firefox', name: 'Firefox', family: 'firefox' });
  return out;
}

/** Copies a (maybe locked) sqlite file and its WAL sidecar to a throwaway dir and opens it. */
function openCopy(path: string): { db: DatabaseSync; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'zx-cookies-'));
  const copy = join(dir, 'db.sqlite');
  copyFileSync(path, copy);
  for (const ext of ['-wal', '-shm'])
    if (existsSync(path + ext)) copyFileSync(path + ext, copy + ext);
  // A read-only open on the copy, never on the browser's live file.
  const db = new DatabaseSync(copy, { readOnly: true });
  return { db, dir };
}

// ---- Firefox: cookies.sqlite stores values in the clear, so no key is needed. ----

function firefoxProfiles(): string[] {
  const root = join(ROAMING, 'Mozilla', 'Firefox', 'Profiles');
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name))
      .filter((p) => existsSync(join(p, 'cookies.sqlite')));
  } catch {
    return [];
  }
}

function readFirefox(): { cookies: ImportCookie[]; skipped: number; locked: boolean } {
  const cookies: ImportCookie[] = [];
  let skipped = 0;
  let locked = false;
  const now = Date.now();
  for (const profile of firefoxProfiles()) {
    let handle: { db: DatabaseSync; dir: string } | null = null;
    try {
      handle = openCopy(join(profile, 'cookies.sqlite'));
      const rows = handle.db
        .prepare(
          'SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies',
        )
        .all() as Record<string, unknown>[];
      for (const r of rows) {
        const c = buildImportCookie(
          {
            name: r.name,
            value: r.value,
            domain: r.host,
            path: r.path,
            secure: Number(r.isSecure) === 1,
            httpOnly: Number(r.isHttpOnly) === 1,
            expires: Number(r.expiry) || 0,
            sameSite: ['unspecified', 'lax', 'strict'][Number(r.sameSite)] ?? 'unspecified',
          },
          now,
        );
        if (c) cookies.push(c);
        else skipped++;
      }
    } catch {
      locked = true;
    } finally {
      if (handle) {
        try {
          handle.db.close();
        } catch {
          /* already closed */
        }
        rmSync(handle.dir, { recursive: true, force: true });
      }
    }
  }
  return { cookies, skipped, locked };
}

// ---- Chromium: values are AES-GCM encrypted with a key kept in "Local State". ----

/** Unprotects a DPAPI blob (the Chromium master key) with the user's Windows credentials. */
async function dpapiUnprotect(blob: Buffer): Promise<Buffer | null> {
  try {
    const b64 = blob.toString('base64');
    const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`;
    const { stdout } = await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { maxBuffer: 1 << 20 },
    );
    const out = stdout.trim();
    return out ? Buffer.from(out, 'base64') : null;
  } catch {
    return null;
  }
}

/** The AES-256 key a Chromium browser uses for its "v10"/"v11" cookies, or null. */
async function chromiumKey(userDataDir: string): Promise<Buffer | null> {
  try {
    const state = JSON.parse(readFileSync(join(userDataDir, 'Local State'), 'utf8')) as {
      os_crypt?: { encrypted_key?: string };
    };
    const b64 = state.os_crypt?.encrypted_key;
    if (!b64) return null;
    const raw = Buffer.from(b64, 'base64');
    // The blob starts with the ASCII tag "DPAPI"; the rest is what Windows protected.
    if (raw.subarray(0, 5).toString('ascii') !== 'DPAPI') return null;
    return dpapiUnprotect(raw.subarray(5));
  } catch {
    return null;
  }
}

/** Decrypts one Chromium "v10"/"v11" value; null for "v20" (app-bound) or anything unexpected. */
function decryptChromiumValue(blob: Buffer, key: Buffer): string | null {
  const tag = blob.subarray(0, 3).toString('ascii');
  if (tag !== 'v10' && tag !== 'v11') return null; // "v20" = app-bound, out of reach here
  try {
    const nonce = blob.subarray(3, 15);
    const authTag = blob.subarray(blob.length - 16);
    const data = blob.subarray(15, blob.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

/** Microseconds since 1601-01-01 (Chromium epoch) → seconds since 1970, 0 for session cookies. */
function chromiumExpiry(us: number): number {
  if (!us) return 0;
  return Math.floor(us / 1_000_000 - 11_644_473_600);
}

/** Profile folders inside a Chromium user-data dir that hold a cookie database. */
function chromiumCookieDbs(userDataDir: string): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(userDataDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n === 'Default' || n.startsWith('Profile '));
  } catch {
    return out;
  }
  for (const n of names) {
    const net = join(userDataDir, n, 'Network', 'Cookies');
    const old = join(userDataDir, n, 'Cookies');
    if (existsSync(net)) out.push(net);
    else if (existsSync(old)) out.push(old);
  }
  return out;
}

async function readChromium(
  userDataDir: string,
): Promise<{ cookies: ImportCookie[]; skipped: number; appBound: number; locked: boolean }> {
  const cookies: ImportCookie[] = [];
  let skipped = 0;
  let appBound = 0;
  let locked = false;
  const key = await chromiumKey(userDataDir);
  const now = Date.now();
  for (const dbPath of chromiumCookieDbs(userDataDir)) {
    let handle: { db: DatabaseSync; dir: string } | null = null;
    try {
      handle = openCopy(dbPath);
      const rows = handle.db
        .prepare(
          'SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies',
        )
        .all() as Record<string, unknown>[];
      for (const r of rows) {
        let value = typeof r.value === 'string' ? r.value : '';
        const enc = r.encrypted_value;
        if (!value && enc) {
          const blob = Buffer.isBuffer(enc)
            ? enc
            : enc instanceof Uint8Array
              ? Buffer.from(enc)
              : null;
          if (!blob) {
            skipped++;
            continue;
          }
          if (!key) {
            appBound++;
            continue;
          }
          const dec = decryptChromiumValue(blob, key);
          if (dec === null) {
            // "v20"/app-bound values can't be read outside the browser process.
            appBound++;
            continue;
          }
          value = dec;
        }
        // Chromium samesite: -1 unspecified, 0 none, 1 lax, 2 strict.
        const sameSite = Number(r.samesite);
        const c = buildImportCookie(
          {
            name: r.name,
            value,
            domain: r.host_key,
            path: r.path,
            secure: Number(r.is_secure) === 1,
            httpOnly: Number(r.is_httponly) === 1,
            expires: chromiumExpiry(Number(r.expires_utc)),
            sameSite:
              sameSite === 0
                ? 'no_restriction'
                : sameSite === 1
                  ? 'lax'
                  : sameSite === 2
                    ? 'strict'
                    : 'unspecified',
          },
          now,
        );
        if (c) cookies.push(c);
        else skipped++;
      }
    } catch {
      locked = true;
    } finally {
      if (handle) {
        try {
          handle.db.close();
        } catch {
          /* already closed */
        }
        rmSync(handle.dir, { recursive: true, force: true });
      }
    }
  }
  return { cookies, skipped, appBound, locked };
}

/**
 * Reads cookies straight from an installed browser and puts them in the built-in one. For
 * Chrome/Edge/Brave this works for "v10/v11" cookies; their newer "v20" (app-bound) cookies
 * are encrypted with a key only the browser process can use, and are counted as blocked.
 * Firefox stores its cookies in the clear, so those always come through.
 */
export async function importFromBrowser(id: string): Promise<DirectImportResult> {
  if (id === 'firefox') {
    const { cookies, skipped, locked } = readFirefox();
    const res = await injectCookies(cookies, skipped);
    return { ...res, appBoundBlocked: 0, locked };
  }
  const src = CHROMIUM.find((b) => b.id === id);
  if (!src) throw new Error('unknown-browser');
  const { cookies, skipped, appBound, locked } = await readChromium(src.dir);
  const res = await injectCookies(cookies, skipped);
  return { ...res, appBoundBlocked: appBound, locked };
}
