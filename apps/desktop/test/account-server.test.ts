/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON answers of the website server (.mjs) */
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseLicense } from '../src/main/license.js';

/**
 * The website's account server (website/api/_lib): registration and sign-in against a
 * database, the owner's desk (keys, users, messages) and the signed feed the apps read.
 * Runs on the in-memory store; the Supabase store is checked by the requests it makes.
 */

const lib = (name: string) =>
  pathToFileURL(fileURLToPath(new URL(`../../../website/api/_lib/${name}`, import.meta.url))).href;

interface Out {
  status: number;
  body: any;
}
interface Service {
  run(kind: string, req: Record<string, unknown>): Promise<Out>;
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ADMIN = 'admin-secret-0123456789-abcdefgh';
const FAST = { N: 1024, r: 8, p: 1 };
const DAY = 86_400_000;

let service: Service;
let clock: number;
let core: any;

beforeEach(async () => {
  core = await import(lib('core.mjs'));
  const { memoryStore } = await import(lib('store.mjs'));
  clock = Date.UTC(2026, 10, 25);
  service = core.makeService(
    memoryStore(),
    { ADMIN_TOKEN: ADMIN, LICENSE_PRIVATE_KEY: PRIV },
    { now: () => clock, scrypt: FAST },
  );
});

const post = (kind: string, body: unknown, token?: string, ip = '1.1.1.1') =>
  service.run(kind, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    ip,
  });
const account = (body: unknown, token?: string) => post('account', body, token);
const admin = (body: unknown, token = ADMIN) => post('admin', body, token);
const register = (email = 'ana@example.com', password = 'secreto-123') =>
  account({ action: 'register', email, password, name: 'Ana' });

describe('accounts', () => {
  it('registers, signs in and reads the profile', async () => {
    const r = await register('Ana@Example.com');
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
    expect(r.body.user.pass_hash).toBeUndefined();
    const me = await account({ action: 'me' }, r.body.token);
    expect(me.body.user.email).toBe('ana@example.com');
    const login = await account({
      action: 'login',
      email: 'ana@example.com',
      password: 'secreto-123',
    });
    expect(login.status).toBe(200);
    expect(login.body.token).not.toBe(r.body.token);
  });

  it('refuses a second account with the same email, bad emails and short passwords', async () => {
    await register();
    expect((await register()).status).toBe(409);
    expect((await register('no-es-correo')).status).toBe(400);
    expect((await register('b@example.com', 'corta')).status).toBe(400);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    await register();
    const wrong = await account({
      action: 'login',
      email: 'ana@example.com',
      password: 'otra-cosa',
    });
    const unknown = await account({
      action: 'login',
      email: 'x@example.com',
      password: 'otra-cosa',
    });
    expect(wrong.status).toBe(401);
    expect(unknown).toEqual(wrong);
  });

  it('locks the account for 15 minutes after 8 wrong passwords', async () => {
    await register();
    const login = (password: string) =>
      account({ action: 'login', email: 'ana@example.com', password });
    for (let i = 0; i < 8; i++) expect((await login('mala-clave')).status).toBe(401);
    expect((await login('secreto-123')).status).toBe(429);
    clock += 16 * 60_000;
    expect((await login('secreto-123')).status).toBe(200);
  });

  it('ends the session on sign-out and when it expires', async () => {
    const a = await register();
    await account({ action: 'logout' }, a.body.token);
    expect((await account({ action: 'me' }, a.body.token)).status).toBe(401);
    const b = await account({ action: 'login', email: 'ana@example.com', password: 'secreto-123' });
    clock += 91 * DAY;
    expect((await account({ action: 'me' }, b.body.token)).status).toBe(401);
  });

  it('changing the password signs every other device out', async () => {
    const a = await register();
    const b = await account({ action: 'login', email: 'ana@example.com', password: 'secreto-123' });
    const bad = await account(
      { action: 'password', current: 'no', password: 'nueva-clave-1' },
      a.body.token,
    );
    expect(bad.status).toBe(401);
    const ok = await account(
      { action: 'password', current: 'secreto-123', password: 'nueva-clave-1' },
      a.body.token,
    );
    expect(ok.status).toBe(200);
    expect((await account({ action: 'me' }, b.body.token)).status).toBe(401);
    expect((await account({ action: 'me' }, ok.body.token)).status).toBe(200);
  });

  it('limits sign-in attempts per address', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++)
      last = (await account({ action: 'login', email: `u${i}@example.com`, password: 'x' })).status;
    expect(last).toBe(429);
  });
});

describe('the owner’s desk', () => {
  it('needs the admin secret', async () => {
    expect((await admin({ action: 'overview' }, 'otra-clave-cualquiera-000000')).status).toBe(401);
    expect((await admin({ action: 'overview' }, '')).status).toBe(401);
    const user = await register();
    expect((await admin({ action: 'overview' }, user.body.token)).status).toBe(401);
    expect((await admin({ action: 'overview' })).body).toMatchObject({ users: 1, keys: 0 });
  });

  it('refuses to work with a short or missing admin secret', async () => {
    const { memoryStore } = await import(lib('store.mjs'));
    const open = core.makeService(memoryStore(), { ADMIN_TOKEN: 'corta' }, { scrypt: FAST });
    const r = await open.run('admin', {
      method: 'POST',
      headers: { authorization: 'Bearer corta' },
      body: { action: 'overview' },
      ip: 'x',
    });
    expect(r.status).toBe(503);
  });

  it('makes keys the app accepts', async () => {
    const r = await admin({
      action: 'createKeys',
      plan: 'proai',
      days: 30,
      count: 3,
      note: 'feria',
    });
    expect(r.status).toBe(200);
    expect(r.body.keys).toHaveLength(3);
    const p = parseLicense(r.body.keys[0].key, PUB);
    expect(p).toMatchObject({ v: 1, plan: 'proai', email: 'cliente@zinarix-studio', iat: clock });
    expect(p.exp).toBe(clock + 30 * DAY);
    expect(new Set(r.body.keys.map((k: any) => k.id)).size).toBe(3);
    expect((await admin({ action: 'keys', q: 'feria' })).body.keys).toHaveLength(3);
    expect((await admin({ action: 'createKeys', plan: 'gratis' })).status).toBe(400);
  });

  it('a key made for a registered email shows up in that account', async () => {
    const user = await register();
    const made = await admin({ action: 'createKeys', plan: 'pro', email: 'ANA@example.com' });
    expect(made.body.linked).toBe(true);
    const me = await account({ action: 'me' }, user.body.token);
    expect(me.body.licenses).toHaveLength(1);
    expect(me.body.licenses[0]).toMatchObject({ plan: 'pro', id: made.body.keys[0].id });
    // Revoked: gone from the account and listed in the feed.
    await admin({ action: 'setKey', id: made.body.keys[0].id, revoked: true });
    expect((await account({ action: 'me' }, user.body.token)).body.licenses).toHaveLength(0);
    const feed = await service.run('feed', { method: 'GET', headers: {}, ip: 'x' });
    expect(JSON.parse(feed.body.body).revoked).toEqual([made.body.keys[0].id]);
  });

  it('a key for an email without an account is not handed to whoever registers it later', async () => {
    await admin({ action: 'createKeys', plan: 'pro', email: 'luis@example.com' });
    const luis = await register('luis@example.com');
    expect(luis.body.licenses).toEqual([]);
    expect((await account({ action: 'me' }, luis.body.token)).body.licenses).toEqual([]);
  });

  it('links a key to the account that redeems it, once', async () => {
    const ana = await register();
    const luis = await register('luis@example.com');
    const made = await admin({ action: 'createKeys', plan: 'ai' });
    const key = made.body.keys[0].key;
    const r = await account({ action: 'redeem', key: ` ${key}\n` }, ana.body.token);
    expect(r.body.licenses).toHaveLength(1);
    expect((await account({ action: 'redeem', key }, ana.body.token)).status).toBe(200);
    expect((await account({ action: 'redeem', key }, luis.body.token)).status).toBe(409);
    expect(
      (await account({ action: 'redeem', key: 'ZX1.aaaa.bbbb' }, luis.body.token)).status,
    ).toBe(400);
    // A key signed by someone else is not accepted.
    const other = generateKeyPairSync('ed25519').privateKey;
    const forged = core.makeLicense({ v: 1, id: 'x', plan: 'pro', email: 'a@b.co', iat: 1 }, other);
    expect((await account({ action: 'redeem', key: forged }, luis.body.token)).status).toBe(400);
  });

  it('disables an account and resets its password', async () => {
    const ana = await register();
    const id = ana.body.user.id;
    await admin({ action: 'setUser', id, disabled: true });
    expect((await account({ action: 'me' }, ana.body.token)).status).toBe(401);
    const login = (password: string) =>
      account({ action: 'login', email: 'ana@example.com', password });
    expect((await login('secreto-123')).status).toBe(403);
    await admin({ action: 'setUser', id, disabled: false });
    const reset = await admin({ action: 'resetPassword', id });
    expect(reset.body.password.length).toBeGreaterThanOrEqual(12);
    expect((await login('secreto-123')).status).toBe(401);
    expect((await login(reset.body.password)).status).toBe(200);
    const list = await admin({ action: 'users', q: 'ana' });
    expect(list.body.users).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('scrypt');
  });
});

describe('messages for every app', () => {
  it('signs the feed with the license key, under its own prefix', async () => {
    await admin({ action: 'sendMessage', text: 'Hola a todos', url: 'https://example.com/x' });
    await admin({ action: 'sendMessage', text: 'Solo hoy', days: 1 });
    const feed = await service.run('feed', { method: 'GET', headers: {}, ip: 'x' });
    expect(feed.status).toBe(200);
    const ok = verify(
      null,
      Buffer.from(core.FEED_DOMAIN + feed.body.body, 'utf8'),
      createPublicKey(PUB),
      Buffer.from(feed.body.sig, 'base64'),
    );
    expect(ok).toBe(true);
    const data = JSON.parse(feed.body.body);
    expect(data.ts).toBe(clock);
    expect(data.messages.map((m: any) => m.text).sort()).toEqual(['Hola a todos', 'Solo hoy']);
    expect(data.messages.find((m: any) => m.text === 'Hola a todos').url).toBe(
      'https://example.com/x',
    );
    // The one-day message leaves the feed; deleting removes the other.
    clock += 2 * DAY;
    const later = JSON.parse(
      (await service.run('feed', { method: 'GET', headers: {}, ip: 'x' })).body.body,
    );
    expect(later.messages).toHaveLength(1);
    await admin({ action: 'deleteMessage', id: later.messages[0].id });
    expect((await admin({ action: 'messages' })).body.messages).toHaveLength(1);
  });

  it('refuses empty messages and links that are not https', async () => {
    expect((await admin({ action: 'sendMessage', text: '  ' })).status).toBe(400);
    expect(
      (await admin({ action: 'sendMessage', text: 'x', url: 'javascript:alert(1)' })).status,
    ).toBe(400);
  });

  it('sending needs the admin secret; reading does not', async () => {
    expect((await post('admin', { action: 'sendMessage', text: 'x' }, 'nope')).status).toBe(401);
    expect((await service.run('feed', { method: 'POST', headers: {}, ip: 'x' })).status).toBe(405);
  });
});

describe('the Supabase store', () => {
  it('talks to the REST API with the service key and escapes what it sends', async () => {
    const { supabaseStore } = await import(lib('store.mjs'));
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;
    const env = { SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_SERVICE_KEY: 'k'.repeat(40) };
    const db = supabaseStore(env, fake);
    expect(db.ready).toBe(true);
    expect(await db.userByEmail('a&b=c@example.com')).toBeNull();
    expect(calls[0]!.url).toBe(
      'https://abc.supabase.co/rest/v1/zx_users?email=eq.a%26b%3Dc%40example.com&limit=1',
    );
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe('k'.repeat(40));
    await db.listUsers({ q: 'a*,(b)', limit: 5 });
    expect(calls[1]!.url).toContain('or=(email.ilike.*ab*,name.ilike.*ab*)'.replace(/\*/g, '*'));
    expect(supabaseStore({}, fake).ready).toBe(false);
  });

  it('answers 503 until the database is configured', async () => {
    const { supabaseStore } = await import(lib('store.mjs'));
    const s = core.makeService(supabaseStore({}), {
      ADMIN_TOKEN: ADMIN,
      LICENSE_PRIVATE_KEY: PRIV,
    });
    const r = await s.run('account', {
      method: 'POST',
      headers: {},
      body: { action: 'me' },
      ip: 'x',
    });
    expect(r.status).toBe(503);
  });
});
