/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON answers of the website server (.mjs) */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountError, ZinarixAccount, type TokenBox } from '../src/main/zinarixAccount.js';

/**
 * The app's side of the Zinarix account, against the real server code (the local dev server
 * with its in-memory database): sign-in, the keys of the account and the signed feed.
 */

interface Server {
  url: string;
  close(): Promise<void>;
  service: { run(kind: string, req: Record<string, unknown>): Promise<{ body: any }> };
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ADMIN = 'admin-secret-0123456789-abcdefgh';

let server: Server;
let dir: string;
let clock: number;

function box(): TokenBox & { value: string | null } {
  return {
    value: null,
    get() {
      return this.value;
    },
    set(t) {
      this.value = t;
    },
    delete() {
      this.value = null;
    },
  };
}

function client(over: { packaged?: boolean; publicKeyPem?: string; tokens?: TokenBox } = {}) {
  return new ZinarixAccount({
    file: join(dir, 'account.json'),
    tokens: over.tokens ?? box(),
    packaged: over.packaged ?? false,
    baseUrl: server.url,
    publicKeyPem: over.publicKeyPem ?? PUB,
    now: () => clock,
  });
}

const admin = (body: Record<string, unknown>) =>
  server.service.run('admin', {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN}` },
    body,
    ip: 'test',
  });

beforeEach(async () => {
  const mod = (await import(
    pathToFileURL(
      fileURLToPath(new URL('../../../scripts/dev-account-server.mjs', import.meta.url)),
    ).href
  )) as { startServer(opts: Record<string, unknown>): Promise<Server> };
  clock = Date.UTC(2026, 10, 25);
  server = await mod.startServer({
    adminToken: ADMIN,
    privateKeyPem: PRIV,
    now: () => clock,
    scrypt: { N: 1024, r: 8, p: 1 },
  });
  dir = mkdtempSync(join(tmpdir(), 'zx-account-'));
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const ana = { email: 'ana@example.com', password: 'secreto-123', name: 'Ana' };

describe('the Zinarix account in the app', () => {
  it('registers, keeps the session across restarts and signs out', async () => {
    const tokens = box();
    const a = client({ tokens });
    expect(a.status()).toEqual({ signedIn: false, licenses: [], messages: [] });
    const s = await a.register(ana);
    expect(s.signedIn).toBe(true);
    expect(s.user).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
    // The token is in the keychain box, never in the cache file.
    expect(tokens.value).toBeTruthy();
    expect(readFileSync(join(dir, 'account.json'), 'utf8')).not.toContain(tokens.value!);
    // A new instance (the app restarted) is still signed in, even before talking to the server.
    expect(client({ tokens }).status().user?.email).toBe('ana@example.com');
    const out = await client({ tokens }).logout();
    expect(out.signedIn).toBe(false);
    expect(tokens.value).toBeNull();
  });

  it('shows the server’s reason when signing in fails', async () => {
    await client().register(ana);
    const err = await client()
      .login({ email: ana.email, password: 'otra' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountError);
    expect((err as AccountError).message).toBe('El correo o la contraseña no coinciden.');
    expect((err as AccountError).status).toBe(401);
  });

  it('says so when the server cannot be reached', async () => {
    const a = client();
    await server.close();
    const err = await a.login(ana).catch((e: unknown) => e);
    expect((err as AccountError).status).toBe(0);
    expect((err as AccountError).message).toContain('No se pudo conectar');
    expect(await a.refreshFeed()).toBeNull();
    // restart for afterEach
    server = { ...server, close: async () => undefined };
  });

  it('picks up a key the owner made for the account, the best plan first', async () => {
    const a = client();
    await a.register(ana);
    expect(a.bestLicense()).toBeNull();
    await admin({ action: 'createKeys', plan: 'ai', email: ana.email });
    const pro = await admin({ action: 'createKeys', plan: 'proai', email: ana.email, days: 30 });
    const s = await a.sync();
    expect(s.licenses.map((l) => l.plan).sort()).toEqual(['ai', 'proai']);
    expect(a.bestLicense()).toBe(pro.body.keys[0].key);
    // Expired: the other one is used. Cancelled by the owner (feed): none.
    clock += 31 * 86_400_000;
    const ai = a.bestLicense();
    expect(ai).not.toBe(pro.body.keys[0].key);
    expect(ai).toBeTruthy();
    for (const l of s.licenses) await admin({ action: 'setKey', id: l.id, revoked: true });
    await a.refreshFeed();
    expect(a.revoked()).toHaveLength(2);
    expect(a.bestLicense()).toBeNull();
  });

  it('ignores keys signed by someone else', async () => {
    const other = generateKeyPairSync('ed25519').publicKey;
    const a = client({ publicKeyPem: other.export({ type: 'spki', format: 'pem' }).toString() });
    await a.register(ana);
    await admin({ action: 'createKeys', plan: 'pro', email: ana.email });
    expect((await a.sync()).licenses).toHaveLength(1);
    expect(a.bestLicense()).toBeNull();
  });

  it('links an activated key to the account', async () => {
    const a = client();
    await a.register(ana);
    const made = await admin({ action: 'createKeys', plan: 'pro' });
    const s = await a.redeem(made.body.keys[0].key);
    expect(s.licenses).toHaveLength(1);
  });

  it('a session the server ended signs the app out; the password change keeps it', async () => {
    const tokens = box();
    const a = client({ tokens });
    const s = await a.register(ana);
    const bad = await a.changePassword('no', 'nueva-clave-1').catch((e: unknown) => e);
    expect((bad as AccountError).status).toBe(401);
    expect(a.status().signedIn).toBe(true);
    await a.changePassword(ana.password, 'nueva-clave-1');
    expect(a.status().signedIn).toBe(true);
    await admin({ action: 'setUser', id: s.user!.id, disabled: true });
    expect((await a.sync()).signedIn).toBe(false);
    expect(tokens.value).toBeNull();
  });

  it('reads the owner’s messages without an account, and only a signed feed when packaged', async () => {
    await admin({ action: 'sendMessage', text: 'Versión nueva', url: 'https://example.com/v' });
    const a = client({ packaged: false });
    const messages = await a.refreshFeed();
    expect(messages).toHaveLength(1);
    expect(a.status().messages[0]).toMatchObject({
      text: 'Versión nueva',
      url: 'https://example.com/v',
    });
    // An older feed (a replay) is not accepted.
    clock -= 1000;
    expect(await a.refreshFeed()).toBeNull();
    clock += 2000;
    expect(await a.refreshFeed()).toHaveLength(1);
  });

  it('a packaged app refuses a feed signed with another key', async () => {
    await admin({ action: 'sendMessage', text: 'hola' });
    const feed = await (await fetch(`${server.url}/api/feed`)).text();
    const wrongKey = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString();
    const packaged = (publicKeyPem: string) =>
      new ZinarixAccount({
        file: join(dir, `p-${publicKeyPem.length}-${Math.random()}.json`),
        tokens: box(),
        packaged: true,
        publicKeyPem,
        fetch: (async () => new Response(feed)) as unknown as typeof fetch,
        now: () => clock,
      });
    expect(await packaged(wrongKey).refreshFeed()).toBeNull();
    expect(await packaged(PUB).refreshFeed()).toHaveLength(1);
  });

  it('a packaged app always talks to the official server', async () => {
    const urls: string[] = [];
    const a = new ZinarixAccount({
      file: join(dir, 'x.json'),
      tokens: box(),
      packaged: true,
      baseUrl: 'http://evil.example',
      fetch: (async (url: string) => {
        urls.push(url);
        return new Response('{}', { status: 500 });
      }) as unknown as typeof fetch,
    });
    await a.refreshFeed();
    expect(urls).toEqual(['https://zinarix-studio.vercel.app/api/feed']);
  });
});
