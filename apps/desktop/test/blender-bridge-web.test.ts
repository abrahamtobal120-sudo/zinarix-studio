/**
 * Permanent bridge for the web: CORS for loopback and user-allowed origins, the preflight
 * (also Chrome's Private Network Access), and the allowed-origin list kept in the settings.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlenderBridge, normalizeOrigin, type BridgeInfo } from '../src/main/blenderBridge.js';
import { BridgeStore, cleanOrigins } from '../src/main/blenderBridgeStore.js';

let allowed: string[] = ['https://app.example.com'];
const bridge = new BlenderBridge(
  {
    models: async () => [{ id: 'ollama/qwen3:8b', ownedBy: 'ollama' }],
    complete: async () => ({ text: 'hola', model: 'ollama/qwen3:8b' }),
  },
  { origins: () => allowed },
);
let info: BridgeInfo;
let port = 0;
beforeAll(async () => {
  info = await bridge.start();
  port = Number(new URL(info.url).port);
});
afterAll(() => bridge.close());

function call(
  method: string,
  headers: Record<string, string>,
  auth = true,
): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: '/v1/models',
        headers: { ...(auth ? { authorization: `Bearer ${info.token}` } : {}), ...headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('bridge for web pages', () => {
  it('answers an allowed origin with CORS headers', async () => {
    const r = await call('GET', { origin: 'https://app.example.com' });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(r.headers.vary).toBe('Origin');
  });

  it('allows loopback dev servers without listing them', async () => {
    const r = await call('GET', { origin: 'http://localhost:5173' });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('refuses origins not in the list, and reads the list live', async () => {
    expect((await call('GET', { origin: 'https://evil.com' })).status).toBe(403);
    allowed = ['https://evil.com'];
    expect((await call('GET', { origin: 'https://evil.com' })).status).toBe(200);
    allowed = ['https://app.example.com'];
    expect((await call('GET', { origin: 'https://evil.com' })).status).toBe(403);
  });

  it('answers the preflight without the token, with Private Network Access', async () => {
    const r = await call(
      'OPTIONS',
      {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
        'access-control-request-private-network': 'true',
      },
      false,
    );
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-headers']).toContain('authorization');
    expect(r.headers['access-control-allow-private-network']).toBe('true');
  });

  it('still needs the token, and the page can read the 401', async () => {
    const r = await call('GET', { origin: 'https://app.example.com' }, false);
    expect(r.status).toBe(401);
    expect(r.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });
});

describe('allowed web origins', () => {
  it('normalizes what the user types', () => {
    expect(normalizeOrigin('https://app.example.com/path?x=1')).toBe('https://app.example.com');
    expect(normalizeOrigin('mi-app.vercel.app')).toBe('https://mi-app.vercel.app');
    expect(normalizeOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
    for (const bad of ['', '*', 'https://*.example.com', 'file:///c:/x.html', 'ftp://x.com'])
      expect(normalizeOrigin(bad)).toBeNull();
    expect(cleanOrigins(['a.com', 'https://a.com/', 42, '*'])).toEqual(['https://a.com']);
  });

  it('are saved with the settings and cleaned on load', () => {
    const d = mkdtempSync(join(tmpdir(), 'zx-bridge-web-'));
    writeFileSync(
      join(d, 'blender-bridge.json'),
      JSON.stringify({ permanent: true, origins: ['https://ok.dev/x', '*', 7] }),
    );
    const store = new BridgeStore(d, join(d, 'disc.json'));
    expect(store.load().origins).toEqual(['https://ok.dev']);
    const saved = JSON.parse(readFileSync(join(d, 'blender-bridge.json'), 'utf8'));
    expect(saved.origins).toEqual(['https://ok.dev']);
  });
});
