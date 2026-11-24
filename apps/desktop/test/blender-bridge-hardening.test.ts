/**
 * Blender bridge hardening: web requests are told apart (main.ts keeps file-reading CLI
 * models from them), close() during start leaves no server behind, and a Blender script
 * longer than the approval card shows is never run.
 */
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { BlenderBridge, type BridgeChatRequest } from '../src/main/blenderBridge.js';
import type { Scene3DService } from '../src/main/scene3d.js';
import { MAX_SCRIPT, runScene3dTool, scene3dPreview } from '../src/main/scene3dTools.js';

function post(port: number, token: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'hola' }] });
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/chat/completions',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: '/v1/models' }, (res) => {
      res.resume();
      resolve(false);
    });
    req.on('error', () => resolve(true));
    req.end();
  });

describe('Blender bridge hardening', () => {
  it('marks requests sent by a web page (they carry an Origin)', async () => {
    const seen: BridgeChatRequest[] = [];
    const bridge = new BlenderBridge({
      models: async () => [],
      complete: async (req) => {
        seen.push(req);
        return { text: 'ok', model: 'x/y' };
      },
    });
    const info = await bridge.start();
    const port = Number(new URL(info.url).port);
    try {
      expect(await post(port, info.token)).toBe(200);
      expect(await post(port, info.token, { origin: 'http://localhost:5173' })).toBe(200);
      expect(seen[0]!.fromWeb).toBeUndefined();
      expect(seen[1]!.fromWeb).toBe(true);
    } finally {
      await bridge.close();
    }
  });

  it('a close() while starting leaves no server listening', async () => {
    const port = await freePort();
    const bridge = new BlenderBridge(
      { models: async () => [], complete: async () => ({ text: '', model: '' }) },
      { port },
    );
    const starting = bridge.start();
    await bridge.close();
    await expect(starting).rejects.toThrow(/closed/);
    expect(bridge.info).toBeNull();
    expect(await refused(port)).toBe(true);
  });
});

describe('blender_script approval', () => {
  const tooLong = 'x = 1\n'.repeat(Math.ceil((MAX_SCRIPT + 10) / 6));

  it('the card says a script that does not fit will not run', () => {
    const p = scene3dPreview('blender_script', { script: tooLong });
    expect(p.command!.length).toBe(MAX_SCRIPT);
    expect(p.warning).toMatch(/no se ejecutará/);
    const ok = scene3dPreview('blender_script', { script: 'import bpy' });
    expect(ok.command).toBe('import bpy');
    expect(ok.warning).not.toMatch(/No recibe tus claves/);
  });

  it('never runs more than the card showed', async () => {
    let ran = false;
    const svc = {
      runScript: async () => {
        ran = true;
        return { paths: [], log: '' };
      },
    } as unknown as Scene3DService;
    const r = await runScene3dTool(
      svc,
      undefined,
      'blender_script',
      { script: tooLong },
      undefined,
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/at most|the most is/);
    expect(ran).toBe(false);
  });
});
