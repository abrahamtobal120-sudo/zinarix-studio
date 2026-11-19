import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

const { PhoneRemote, deviceName, lanAddress } = await import('../src/main/phone.js');
type Remote = InstanceType<typeof PhoneRemote>;

const dirs: string[] = [];
const remotes: Remote[] = [];
afterEach(() => {
  for (const r of remotes.splice(0)) r.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function make(dir: string): Remote {
  const r = new PhoneRemote(
    () => undefined,
    () => undefined,
    { list: async () => [], pull: async () => '', open: async () => undefined },
    async () => true,
    () => join(dir, 'guard.json'),
    undefined,
    { file: () => join(dir, 'phone-remote.json'), seal: (s) => `S:${s}`, open: (s) => s.slice(2) },
  );
  remotes.push(r);
  return r;
}

const ip = lanAddress();

describe.skipIf(!ip)('phone remote survives a restart', () => {
  it('keeps the paired phone, the link and the on switch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zx-phone-'));
    dirs.push(dir);
    const a = make(dir);
    const st = await a.start();
    expect(st.running).toBe(true);
    const base = st.url!;
    const pair = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130' },
      body: JSON.stringify({ pin: st.pin }),
    });
    expect(pair.status).toBe(200);
    const { token } = (await pair.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${base}/api/me`, { headers: auth })).status).toBe(200);
    // The token itself is never written to disk, only its hash.
    expect(readFileSync(join(dir, 'phone-remote.json'), 'utf8')).not.toContain(token);
    const key = JSON.parse(readFileSync(join(dir, 'phone-remote.json'), 'utf8')).key as string;

    // Zinarix closes (not the user turning it off) and opens again.
    a.stop();
    remotes.splice(remotes.indexOf(a), 1);
    const b = make(dir);
    expect(b.wanted().enabled).toBe(true);
    const st2 = await b.start();
    // Same address (the fixed port, unless something else holds it on this machine).
    if (base.endsWith(':47390')) expect(st2.url).toBe(base);
    const base2 = st2.url!;
    expect(st2.phones).toBe(1);
    expect(st2.devices![0]!.name).toBe('Pixel 8 · Chrome');
    const me = await fetch(`${base2}/api/me`, { headers: auth });
    expect(me.status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, 'phone-remote.json'), 'utf8')).key).toBe(key);

    // Renaming, then unpairing from the phone.
    expect(
      (await fetch(`${base2}/api/rename`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Mi celular' }),
      })).status,
    ).toBe(200);
    expect(b.devices()[0]!.name).toBe('Mi celular');
    await fetch(`${base2}/api/unpair`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect((await fetch(`${base2}/api/me`, { headers: auth })).status).toBe(401);

    // Turned off by the user: it stays off next time.
    b.stop(true);
    expect(make(dir).wanted().enabled).toBe(false);
  });

  it('serves the install manifest and checks the fixed tunnel settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zx-phone-'));
    dirs.push(dir);
    const a = make(dir);
    const st = await a.start();
    const m = await fetch(`${st.url}/manifest.webmanifest`);
    expect(m.status).toBe(200);
    expect(((await m.json()) as { start_url: string }).start_url).toBe('/');
    await expect(a.setFixed({ host: 'not a host', token: 'x'.repeat(60) })).rejects.toThrow();
    await expect(a.setFixed({ host: 'z.example.com', token: 'short' })).rejects.toThrow();
    const ok = await a.setFixed({
      host: 'https://Z.Example.com/',
      token: `cloudflared tunnel run --token ${'eyJh'.padEnd(80, 'A')}`,
    });
    expect(ok.fixedHost).toBe('z.example.com');
    const saved = JSON.parse(readFileSync(join(dir, 'phone-remote.json'), 'utf8'));
    expect(saved.fixed.token.startsWith('S:eyJh')).toBe(true);
    expect((await a.setFixed(null)).fixedHost).toBeUndefined();
  });
});

describe('deviceName', () => {
  it('names common phones', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceName('Mozilla/5.0 (Linux; Android 10; K) Chrome/130 Mobile Safari/537.36')).toBe('Android · Chrome');
    expect(deviceName('Mozilla/5.0 (Linux; Android 13; SM-S911B) SamsungBrowser/23.0 Chrome/115')).toBe('SM-S911B · Samsung Internet');
  });
});
