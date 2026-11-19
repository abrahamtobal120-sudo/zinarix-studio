/**
 * Zinarix 3D Pro permanent bridge: fixed port and token, the busy-port fallback, and the
 * settings / discovery files the Blender add-on reads.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlenderBridge, newBridgeToken } from '../src/main/blenderBridge.js';
import { BRIDGE_PORT, BridgeStore, discoveryPath } from '../src/main/blenderBridgeStore.js';

const deps = {
  models: async () => [],
  complete: async () => ({ text: 'ok', model: 'x/y' }),
};
const open: BlenderBridge[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((b) => b.close()));
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

describe('BlenderBridge fixed port and token', () => {
  it('uses the given port and token, and info is null when closed', async () => {
    const port = await freePort();
    const token = newBridgeToken();
    const b = new BlenderBridge(deps, { port, token });
    open.push(b);
    expect(b.info).toBeNull();
    const info = await b.start();
    expect(info).toEqual({ url: `http://127.0.0.1:${port}/v1`, token });
    expect(b.info).toEqual(info);
    await b.close();
    expect(b.info).toBeNull();
  });

  it('falls back to a random port when the preferred one is busy', async () => {
    const port = await freePort();
    const first = new BlenderBridge(deps, { port });
    const second = new BlenderBridge(deps, { port });
    open.push(first, second);
    await first.start();
    const info = await second.start();
    expect(Number(new URL(info.url).port)).not.toBe(port);
  });

  it('ignores a short token', async () => {
    const b = new BlenderBridge(deps, { token: 'short' });
    open.push(b);
    expect((await b.start()).token).not.toBe('short');
  });
});

describe('BridgeStore', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'zx-bridge-'));

  it('creates and keeps a token, default off', () => {
    const d = dir();
    const store = new BridgeStore(d, join(d, 'disc.json'));
    const a = store.load();
    expect(a).toMatchObject({ permanent: false, port: BRIDGE_PORT });
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect(store.load().token).toBe(a.token);
    store.save({ ...a, permanent: true });
    expect(store.load().permanent).toBe(true);
  });

  it('repairs a broken settings file', () => {
    const d = dir();
    writeFileSync(join(d, 'blender-bridge.json'), '{"port": 80, "token": "x"');
    const s = new BridgeStore(d, join(d, 'disc.json')).load();
    expect(s.port).toBe(BRIDGE_PORT);
    expect(s.token).not.toBe('x');
  });

  it('publishes the discovery file and removes only its own', () => {
    const d = dir();
    const disc = join(d, 'sub', 'disc.json');
    const store = new BridgeStore(d, disc);
    store.publish({ url: 'http://127.0.0.1:1/v1', token: 't'.repeat(40) });
    expect(JSON.parse(readFileSync(disc, 'utf8'))).toEqual({
      url: 'http://127.0.0.1:1/v1',
      token: 't'.repeat(40),
      pid: process.pid,
    });
    store.unpublish();
    expect(existsSync(disc)).toBe(false);
    // Another Zinarix instance's file stays.
    writeFileSync(disc, JSON.stringify({ url: 'u', token: 't', pid: -1 }));
    store.unpublish();
    expect(existsSync(disc)).toBe(true);
  });

  it('discovery path honours ZINARIX_BRIDGE_FILE', () => {
    expect(discoveryPath({ ZINARIX_BRIDGE_FILE: 'C:/x/b.json' })).toBe('C:/x/b.json');
    expect(discoveryPath({})).toMatch(/\.zinarix[\\/]blender-bridge\.json$/);
  });
});
