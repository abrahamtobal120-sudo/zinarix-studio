/**
 * Zinarix 3D Pro bridge: the OpenAI-compatible local server Blender's add-on talks to.
 * The model list and the completion are fakes, so no Electron or AI provider is needed.
 */
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BlenderBridge,
  type BridgeChatRequest,
  type BridgeInfo,
} from '../src/main/blenderBridge.js';

const seen: BridgeChatRequest[] = [];
let aborted = false;
const bridge = new BlenderBridge(
  {
    models: async () => [
      { id: 'claude-code/sonnet', ownedBy: 'claude-code' },
      { id: 'ollama/qwen3:8b', ownedBy: 'ollama' },
    ],
    complete: (req, signal) => {
      seen.push(req);
      const last = req.messages.at(-1)!.content;
      if (last === 'fail') return Promise.reject(new Error('Claude Code is not signed in'));
      if (last === 'slow')
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          }),
        );
      return Promise.resolve({ text: `echo: ${last}`, model: req.model ?? 'claude-code/sonnet' });
    },
  },
  { maxBodyBytes: 4096 },
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
  path: string,
  opts: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON answers
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'content-type': 'application/json',
          ...(opts.token !== null ? { authorization: `Bearer ${opts.token ?? info.token}` } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(raw) }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

describe('Blender bridge', () => {
  it('listens on loopback with a /v1 base URL and a random token', async () => {
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    expect(info.token.length).toBeGreaterThanOrEqual(32);
    expect(await bridge.start()).toEqual(info);
  });

  it('rejects requests without the token or with a wrong one', async () => {
    for (const token of [null, 'nope']) {
      const r = await call('GET', '/v1/models', { token });
      expect(r.status).toBe(401);
      expect(typeof r.json.error.message).toBe('string');
    }
  });

  it('rejects foreign hosts and origins (DNS rebinding, web pages)', async () => {
    expect((await call('GET', '/v1/models', { headers: { host: 'evil.com' } })).status).toBe(403);
    expect(
      (await call('GET', '/v1/models', { headers: { origin: 'https://evil.com' } })).status,
    ).toBe(403);
  });

  it('lists the connected models in the OpenAI shape', async () => {
    const r = await call('GET', '/v1/models');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      object: 'list',
      data: [
        { id: 'claude-code/sonnet', object: 'model', created: 0, owned_by: 'claude-code' },
        { id: 'ollama/qwen3:8b', object: 'model', created: 0, owned_by: 'ollama' },
      ],
    });
  });

  it('answers a chat completion in the OpenAI shape', async () => {
    const r = await call('POST', '/v1/chat/completions', {
      body: {
        model: 'ollama/qwen3:8b',
        max_tokens: 500,
        messages: [
          { role: 'system', content: 'You write bpy.' },
          { role: 'user', content: [{ type: 'text', text: 'add a cube' }] },
        ],
      },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      object: 'chat.completion',
      model: 'ollama/qwen3:8b',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'echo: add a cube' },
          finish_reason: 'stop',
        },
      ],
    });
    expect(r.json.id).toMatch(/^chatcmpl-/);
    expect(seen.at(-1)).toEqual({
      model: 'ollama/qwen3:8b',
      maxTokens: 500,
      messages: [
        { role: 'system', content: 'You write bpy.' },
        { role: 'user', content: 'add a cube' },
      ],
    });
  });

  it('uses the Zinarix default model for empty or unknown names', async () => {
    for (const model of [undefined, '', 'gpt-4o']) {
      const r = await call('POST', '/v1/chat/completions', {
        body: { model, messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(r.status).toBe(200);
      expect(seen.at(-1)!.model).toBeUndefined();
    }
  });

  it('returns OpenAI-style errors', async () => {
    const failed = await call('POST', '/v1/chat/completions', {
      body: { messages: [{ role: 'user', content: 'fail' }] },
    });
    expect(failed.status).toBe(502);
    expect(failed.json.error.message).toBe('Claude Code is not signed in');

    const bad = await call('POST', '/v1/chat/completions', { body: { messages: [] } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/messages/);

    const big = await call('POST', '/v1/chat/completions', {
      body: { messages: [{ role: 'user', content: 'x'.repeat(10_000) }] },
    });
    expect(big.status).toBe(413);

    expect((await call('GET', '/v1/nothing')).status).toBe(404);
    expect((await call('GET', '/v1/chat/completions')).status).toBe(405);
  });

  it('cancels the model run when the client disconnects', async () => {
    aborted = false;
    await new Promise<void>((resolve) => {
      const req = request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/chat/completions',
        headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      });
      req.on('error', () => resolve());
      req.end(JSON.stringify({ messages: [{ role: 'user', content: 'slow' }] }));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 150);
    });
    await expect.poll(() => aborted, { timeout: 2000 }).toBe(true);
  });
});
