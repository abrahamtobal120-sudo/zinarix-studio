/**
 * Reads a cookie export to put in the built-in browser. Accepts what users get out of a
 * regular browser: the JSON of Cookie-Editor / EditThisCookie (an array), a Playwright or
 * Puppeteer storage state ({ cookies: [...] }), and the Netscape "cookies.txt" format.
 * Pure (no Electron), so it is tested on its own.
 */

export type CookieSameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict';

/** One cookie in the shape Electron's `session.cookies.set()` takes. */
export interface ImportCookie {
  url: string;
  name: string;
  value: string;
  /** Absent for host-only cookies (only that exact host gets them). */
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Seconds since epoch; absent for session cookies. */
  expirationDate?: number;
  sameSite: CookieSameSite;
}

export interface ParsedCookies {
  cookies: ImportCookie[];
  /** Entries that could not be read or had already expired. */
  skipped: number;
}

/** The biggest export accepted (a browser with every site logged in is far below). */
export const COOKIE_FILE_MAX = 20 * 1024 * 1024;
const MAX_COOKIES = 20_000;

function sameSiteOf(v: unknown): CookieSameSite {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'no_restriction' || s === 'none') return 'no_restriction';
  if (s === 'lax') return 'lax';
  if (s === 'strict') return 'strict';
  return 'unspecified';
}

/** Builds one cookie, or null when it is not usable (no name/domain, expired, bad host). */
export function buildImportCookie(
  raw: {
    name: unknown;
    value: unknown;
    domain: unknown;
    path?: unknown;
    secure?: unknown;
    httpOnly?: unknown;
    expires?: unknown;
    hostOnly?: unknown;
    sameSite?: unknown;
  },
  now = Date.now(),
): ImportCookie | null {
  return make(raw, Math.floor(now / 1000));
}

function make(
  raw: {
    name: unknown;
    value: unknown;
    domain: unknown;
    path?: unknown;
    secure?: unknown;
    httpOnly?: unknown;
    expires?: unknown;
    hostOnly?: unknown;
    sameSite?: unknown;
  },
  nowSec: number,
): ImportCookie | null {
  if (typeof raw.name !== 'string' || typeof raw.domain !== 'string') return null;
  const value = typeof raw.value === 'string' ? raw.value : String(raw.value ?? '');
  const domainRaw = raw.domain.trim().toLowerCase();
  const host = domainRaw.replace(/^\./, '');
  if (!host || !/^[a-z0-9.-]+$/.test(host) || host.length > 253) return null;
  if (raw.name.length > 4096 || value.length > 16_384) return null;
  const path = typeof raw.path === 'string' && raw.path.startsWith('/') ? raw.path : '/';
  let secure = raw.secure === true;
  let sameSite = sameSiteOf(raw.sameSite);
  // Chromium refuses SameSite=None on a cookie that is not Secure.
  if (sameSite === 'no_restriction' && !secure) sameSite = 'unspecified';
  const exp = typeof raw.expires === 'number' && Number.isFinite(raw.expires) ? raw.expires : 0;
  if (exp > 0 && exp < nowSec) return null;
  // "__Secure-" and "__Host-" cookies are only taken when Secure (and __Host- host-only on "/").
  if (/^__(Secure|Host)-/.test(raw.name)) secure = true;
  const hostCookie = raw.name.startsWith('__Host-');
  const hostOnly = hostCookie || raw.hostOnly === true || (raw.hostOnly == null && !domainRaw.startsWith('.'));
  const cookie: ImportCookie = {
    url: `${secure ? 'https' : 'http'}://${host}${hostCookie ? '/' : path}`,
    name: raw.name,
    value,
    path: hostCookie ? '/' : path,
    secure,
    httpOnly: raw.httpOnly === true,
    sameSite,
  };
  if (!hostOnly) cookie.domain = `.${host}`;
  if (exp > 0) cookie.expirationDate = exp;
  return cookie;
}

function fromJson(data: unknown, nowSec: number): ParsedCookies {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { cookies?: unknown }).cookies)
      ? (data as { cookies: unknown[] }).cookies
      : null;
  if (!list) throw new Error('not-cookies');
  const out: ImportCookie[] = [];
  let skipped = 0;
  for (const item of list) {
    if (out.length >= MAX_COOKIES) {
      skipped++;
      continue;
    }
    const c = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const session = c?.session === true;
    // Cookie-Editor: expirationDate (s); Playwright/Puppeteer: expires (s, -1 = session).
    const expires = session ? 0 : (c?.expirationDate ?? c?.expires);
    const cookie = c
      ? make(
          {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            expires,
            hostOnly: c.hostOnly,
            sameSite: c.sameSite,
          },
          nowSec,
        )
      : null;
    if (cookie) out.push(cookie);
    else skipped++;
  }
  return { cookies: out, skipped };
}

function fromNetscape(text: string, nowSec: number): ParsedCookies {
  const out: ImportCookie[] = [];
  let skipped = 0;
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 7 || out.length >= MAX_COOKIES) {
      skipped++;
      continue;
    }
    const [domain, sub, path, secure, expires, name, ...rest] = f;
    const cookie = make(
      {
        name,
        value: rest.join('\t'),
        domain,
        path,
        secure: secure!.toUpperCase() === 'TRUE',
        httpOnly,
        expires: Number(expires) || 0,
        hostOnly: sub!.toUpperCase() !== 'TRUE',
      },
      nowSec,
    );
    if (cookie) out.push(cookie);
    else skipped++;
  }
  if (!out.length && !skipped) throw new Error('not-cookies');
  return { cookies: out, skipped };
}

/** Parses an export; throws Error('not-cookies') when the text is not a cookie file. */
export function parseCookieFile(text: string, now = Date.now()): ParsedCookies {
  const nowSec = Math.floor(now / 1000);
  const body = text.replace(/^﻿/, '').trim();
  if (body.startsWith('[') || body.startsWith('{')) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error('not-cookies');
    }
    return fromJson(data, nowSec);
  }
  return fromNetscape(body, nowSec);
}
