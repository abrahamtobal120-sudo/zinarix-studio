import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function make(dir: string, tools?: ConstructorParameters<typeof PhoneRemote>[7]): Remote {
  const r = new PhoneRemote(
    () => undefined,
    () => undefined,
    { list: async () => [], pull: async () => '', open: async () => undefined },
    async () => true,
    () => join(dir, 'guard.json'),
    undefined,
    { file: () => join(dir, 'phone-remote.json'), seal: (s) => `S:${s}`, open: (s) => s.slice(2) },
    tools,
  );
  remotes.push(r);
  return r;
}

const ip = lanAddress();

/** fetch, once more if the keep-alive socket of the closed server was reused. */
async function get(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    return fetch(url, init);
  }
}

describe.skipIf(!ip)('phone remote survives a restart', () => {
  it('keeps the paired phone, the link and the on switch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zx-phone-'));
    dirs.push(dir);
    const a = make(dir);
    const st = await a.start();
    expect(st.running).toBe(true);
    const base = st.url!;
    const pair = await get(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130' },
      body: JSON.stringify({ pin: st.pin }),
    });
    expect(pair.status).toBe(200);
    const { token } = (await pair.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    expect((await get(`${base}/api/me`, { headers: auth })).status).toBe(200);
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
    const me = await get(`${base2}/api/me`, { headers: auth });
    expect(me.status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, 'phone-remote.json'), 'utf8')).key).toBe(key);

    // Renaming, then unpairing from the phone.
    expect(
      (await get(`${base2}/api/rename`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Mi celular' }),
      })).status,
    ).toBe(200);
    expect(b.devices()[0]!.name).toBe('Mi celular');
    await get(`${base2}/api/unpair`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect((await get(`${base2}/api/me`, { headers: auth })).status).toBe(401);

    // Turned off by the user: it stays off next time.
    b.stop(true);
    expect(make(dir).wanted().enabled).toBe(false);
  });

  it('serves the install manifest and checks the fixed tunnel settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zx-phone-'));
    dirs.push(dir);
    const a = make(dir);
    const st = await a.start();
    const m = await get(`${st.url}/manifest.webmanifest`);
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

  it('hands out the bundled Android app from this computer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zx-phone-'));
    dirs.push(dir);
    const a = make(dir);
    const none = await a.start();
    expect(none.apkUrl).toBeUndefined();
    expect((await get(`${none.url}/Zinarix-Remote.apk`)).status).not.toBe(200);
    const apk = join(dir, 'Zinarix-Remote.apk');
    writeFileSync(apk, Buffer.from('PK\x03\x04 fake apk'));
    a.appApk = apk;
    const st = a.status();
    expect(st.apkUrl).toBe(`${st.url}/Zinarix-Remote.apk`);
    const res = await get(st.apkUrl!);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('PK\x03\x04 fake apk');
    // The panel links to it instead of GitHub.
    expect(await (await get(`${st.url}/`)).text()).toContain('const APP_APK = "/Zinarix-Remote.apk"');
  });
});

describe.skipIf(!ip)('phone remote: Zinarix settings', () => {
  it('reads and changes the settings, rejects the rest and obeys the switch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zx-phone-'));
    dirs.push(dir);
    const patches: unknown[] = [];
    const view = { version: '1.0.0', theme: 'dark', prefs: { fontSize: 14 } };
    const a = make(dir, {
      config: {
        get: async () => view as never,
        set: async (p) => {
          patches.push(p);
          if (p.defaultModel === 'x/unknown') throw new Error('Modelo desconocido');
        },
      },
    });
    const st = await a.start();
    const base = st.url!;
    const pair = await get(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: st.pin }),
    });
    const { token } = (await pair.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const set = (body: unknown) =>
      get(`${base}/api/config`, { method: 'POST', headers: auth, body: JSON.stringify(body) });

    expect((await get(`${base}/api/caps`, { headers: auth }).then((r) => r.json())).config).toBe(true);
    const g = await get(`${base}/api/config`, { headers: auth });
    expect(g.status).toBe(200);
    expect(((await g.json()) as { version: string }).version).toBe('1.0.0');
    expect((await get(`${base}/api/config`)).status).toBe(401);

    expect((await set({ theme: 'nord', prefs: { fontSize: 16, uiZoom: 125 } })).status).toBe(200);
    expect((await set({ role: { role: 'agent', ref: null } })).status).toBe(200);
    expect((await set({ budget: { provider: 'openai', monthly: 20 } })).status).toBe(200);
    expect(patches).toHaveLength(3);
    // Keys, shortcuts, commands and odd values stay on the computer.
    expect((await set({ prefs: { keybindings: {} } })).status).toBe(400);
    expect((await set({ prefs: { lspCommands: { py: 'calc.exe' } } })).status).toBe(400);
    expect((await set({ prefs: { uiZoom: 133 } })).status).toBe(400);
    expect((await set({ theme: 'hacker' })).status).toBe(400);
    expect((await set({ apiKey: 'sk-1' })).status).toBe(400);
    expect(patches).toHaveLength(3);
    const bad = await set({ defaultModel: 'x/unknown' });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: string }).error).toBe('Modelo desconocido');

    // Turned off on the computer.
    a.setAllow({ files: true, terminal: true, git: true, config: false });
    expect((await get(`${base}/api/config`, { headers: auth })).status).toBe(403);
    expect((await set({ theme: 'dark' })).status).toBe(403);
    // The other switches keep it off.
    a.setAllow({ files: false, terminal: true, git: true });
    expect(a.allowed().config).toBe(false);
  });

  it('builds a page whose script parses and has the settings screen', async () => {
    const { phonePage } = await import('../src/main/phonePage.js');
    for (const lang of ['es', 'en'] as const) {
      const html = phonePage('n0nce', lang);
      const js = html.slice(html.indexOf('<script nonce="n0nce">') + 22, html.lastIndexOf('</script>'));
      expect(() => new Function(js)).not.toThrow();
      expect(js).toContain('async function openConfig()');
      expect(html).toContain('id="config2"');
    }
  });
});

describe('deviceName', () => {
  it('names common phones', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceName('Mozilla/5.0 (Linux; Android 10; K) Chrome/130 Mobile Safari/537.36')).toBe('Android · Chrome');
    expect(deviceName('Mozilla/5.0 (Linux; Android 13; SM-S911B) SamsungBrowser/23.0 Chrome/115')).toBe('SM-S911B · Samsung Internet');
  });
});
