import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { z } from 'zod';
import type {
  AccountCredentials,
  AccountLicense,
  AccountStatus,
  AccountUser,
  FeedMessage,
} from '../shared/account.js';
import { ACCOUNT_URL } from '../shared/account.js';
import { LICENSE_PUBLIC_KEY, parseLicense } from './license.js';

/**
 * The app's side of the Zinarix account (website/api/account, /api/feed): sign-in, the keys
 * linked to the account, and the owner's signed feed (messages for every app and revoked
 * keys). The session token goes to the keychain; the rest is cached in one file so the app
 * works offline. Signing in is optional: nothing in the app requires an account.
 */

/** What the feed signature covers (website/api/_lib/core.mjs uses the same prefix). */
export const FEED_DOMAIN = 'zinarix-feed:v1:';

const User = z.object({
  id: z.string().min(1).max(64),
  email: z.string().min(3).max(200),
  name: z.string().max(120).default(''),
  createdAt: z.number(),
});
const License = z.object({
  id: z.string().min(1).max(200),
  key: z.string().min(10).max(8192),
  plan: z.enum(['pro', 'ai', 'proai']),
  name: z.string().max(200).default(''),
  createdAt: z.number(),
  expiresAt: z.number().nullable().default(null),
});
const Message = z.object({
  id: z.string().min(1).max(100),
  text: z.string().min(1).max(500),
  url: z.string().url().startsWith('https://').max(500).optional(),
  at: z.number(),
});
const Session = z.object({
  token: z.string().min(20).max(200).optional(),
  user: User,
  licenses: z.array(License).max(500).default([]),
});
const Feed = z.object({
  ts: z.number().int().min(0),
  messages: z.array(Message).max(50).default([]),
  revoked: z.array(z.string().min(1).max(200)).max(20_000).default([]),
});

interface Cache {
  user?: AccountUser;
  licenses?: AccountLicense[];
  messages?: FeedMessage[];
  /** Keys the owner cancelled, from the signed feed. */
  revoked?: string[];
  /** Time stamp of the last feed accepted: an older (replayed) one is ignored. */
  feedTs?: number;
}

export interface TokenBox {
  get(): string | null;
  set(token: string): void;
  delete(): void;
}

export interface AccountOptions {
  /** The cache file (account.json). */
  file: string;
  tokens: TokenBox;
  /** Packaged apps: always the official server, and only a signed feed counts. */
  packaged: boolean;
  /** Development builds only (ZINARIX_ACCOUNT_URL). */
  baseUrl?: string;
  publicKeyPem?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const OFFLINE = 'No se pudo conectar con el servidor de Zinarix. Revisa tu conexión a internet.';
const PLAN_RANK = { proai: 3, pro: 2, ai: 1 } as const;

/** The signed feed body, checked; null when the signature does not match. */
export function verifyFeed(body: string, sigB64: string, publicKeyPem = LICENSE_PUBLIC_KEY) {
  try {
    return verify(
      null,
      Buffer.from(FEED_DOMAIN + body, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(sigB64.trim(), 'base64'),
    );
  } catch {
    return false;
  }
}

export class ZinarixAccount {
  private readonly base: string;
  private readonly publicKeyPem: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private cache: Cache | undefined;

  constructor(private readonly opts: AccountOptions) {
    const dev = !opts.packaged && opts.baseUrl ? opts.baseUrl.replace(/\/+$/, '') : '';
    this.base = dev || ACCOUNT_URL;
    this.publicKeyPem = opts.publicKeyPem ?? LICENSE_PUBLIC_KEY;
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  private read(): Cache {
    if (this.cache) return this.cache;
    let c: Cache = {};
    if (existsSync(this.opts.file)) {
      try {
        const v = JSON.parse(readFileSync(this.opts.file, 'utf8')) as unknown;
        if (v && typeof v === 'object') c = v as Cache;
      } catch {
        /* unreadable: start over */
      }
    }
    return (this.cache = c);
  }

  private write(patch: Partial<Cache>): void {
    this.cache = { ...this.read(), ...patch };
    writeFileSync(this.opts.file, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
  }

  private async post(body: Record<string, unknown>, token?: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}/api/account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ZinarixStudio',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AccountError(OFFLINE, 0);
    }
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (!res.ok)
      throw new AccountError(
        typeof data?.error === 'string' ? data.error.slice(0, 300) : `Error ${res.status}`,
        res.status,
      );
    return data;
  }

  status(): AccountStatus {
    const c = this.read();
    const signedIn = !!c.user && !!this.opts.tokens.get();
    return {
      signedIn,
      ...(signedIn ? { user: c.user } : {}),
      licenses: signedIn ? (c.licenses ?? []) : [],
      messages: c.messages ?? [],
    };
  }

  private accept(data: unknown): AccountStatus {
    const s = Session.parse(data);
    if (s.token) this.opts.tokens.set(s.token);
    this.write({ user: s.user, licenses: s.licenses });
    return this.status();
  }

  private forget(): void {
    this.opts.tokens.delete();
    this.write({ user: undefined, licenses: undefined });
  }

  async register(c: AccountCredentials): Promise<AccountStatus> {
    return this.accept(await this.post({ action: 'register', ...c, device: hostname() }));
  }

  async login(c: AccountCredentials): Promise<AccountStatus> {
    return this.accept(
      await this.post({
        action: 'login',
        email: c.email,
        password: c.password,
        device: hostname(),
      }),
    );
  }

  /** Signs out here even when the server cannot be told. */
  async logout(): Promise<AccountStatus> {
    const token = this.opts.tokens.get();
    if (token) await this.post({ action: 'logout' }, token).catch(() => undefined);
    this.forget();
    return this.status();
  }

  /** With a session token: the method runs; a session the server no longer accepts ends here. */
  private async authed(body: Record<string, unknown>): Promise<AccountStatus> {
    const token = this.opts.tokens.get();
    if (!token) throw new AccountError('Inicia sesión primero.', 401);
    try {
      return this.accept(await this.post(body, token));
    } catch (e) {
      if (e instanceof AccountError && e.status === 401 && body.action !== 'password')
        this.forget();
      throw e;
    }
  }

  /** Refreshes the profile and keys. Offline: the cached ones stay. */
  async sync(): Promise<AccountStatus> {
    if (!this.opts.tokens.get()) return this.status();
    try {
      return await this.authed({ action: 'me' });
    } catch (e) {
      if (e instanceof AccountError && e.status === 401) return this.status();
      throw e;
    }
  }

  /** Links a key the user activated to their account. */
  redeem(key: string): Promise<AccountStatus> {
    return this.authed({ action: 'redeem', key });
  }

  changePassword(current: string, password: string): Promise<AccountStatus> {
    return this.authed({ action: 'password', current, password, device: hostname() });
  }

  /**
   * The owner's feed: messages for every app and the cancelled keys. Returns the messages,
   * or null when unreachable, unsigned (packaged apps) or older than the last one accepted.
   */
  async refreshFeed(): Promise<FeedMessage[] | null> {
    try {
      const res = await this.fetchFn(`${this.base}/api/feed`, {
        headers: { Accept: 'application/json', 'User-Agent': 'ZinarixStudio' },
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const wrap = z
        .object({ body: z.string().max(2_000_000), sig: z.string().max(400) })
        .parse(await res.json());
      if (!verifyFeed(wrap.body, wrap.sig, this.publicKeyPem) && this.opts.packaged) return null;
      const feed = Feed.parse(JSON.parse(wrap.body));
      if (feed.ts < (this.read().feedTs ?? 0)) return null;
      this.write({ messages: feed.messages, revoked: feed.revoked, feedTs: feed.ts });
      return feed.messages;
    } catch {
      return null;
    }
  }

  /** Ids of the keys the owner cancelled on the server. */
  revoked(): string[] {
    return this.read().revoked ?? [];
  }

  /**
   * The best key of the account this app can use right now (signed, not expired, not
   * cancelled): Pro + AI over Pro over AI.
   */
  bestLicense(alsoRevoked: readonly string[] = []): string | null {
    const c = this.read();
    if (!c.user || !this.opts.tokens.get()) return null;
    const dead = new Set([...(c.revoked ?? []), ...alsoRevoked]);
    let best: { key: string; rank: number } | null = null;
    for (const l of c.licenses ?? []) {
      try {
        const p = parseLicense(l.key, this.publicKeyPem);
        if (dead.has(p.id) || (p.exp && p.exp < this.now())) continue;
        const rank = PLAN_RANK[p.plan];
        if (!best || rank > best.rank) best = { key: l.key, rank };
      } catch {
        /* not a key this app accepts */
      }
    }
    return best?.key ?? null;
  }
}

export class AccountError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0: the server could not be reached. */
    readonly status: number,
  ) {
    super(message);
  }
}
