import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogEntry } from '@omni/shared';
import { Secret } from '@omni/security';
import { parseRetryAfter, parseSse, request } from '@omni/providers';
import type { ProviderConfig } from '@omni/providers';
import { json, mockServer } from '../../../tests/helpers/mock-server.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const entry = (
  auth: CatalogEntry['auth'] = { type: 'bearer', header: 'Authorization' },
): CatalogEntry => ({
  id: 'mock',
  name: 'Mock',
  adapter: 'openai-compatible',
  baseUrl: 'http://x',
  baseUrlParams: [],
  auth,
  envVars: [],
  region: 'global',
  category: 'aggregator',
  modelsEndpoint: '/models',
  supports: {
    listModels: true,
    streaming: true,
    tools: true,
    vision: false,
    jsonMode: false,
    embeddings: false,
    fim: false,
  },
  fallbackModels: [],
  status: 'active',
  verifiedAt: null,
});

describe('request()', () => {
  it('retries 429 honoring Retry-After, then succeeds', async () => {
    let n = 0;
    const srv = await mockServer((_req, res) =>
      ++n < 3
        ? json(res, 429, { error: { message: 'slow down' } }, { 'retry-after': '0' })
        : json(res, 200, { ok: true }),
    );
    close = srv.close;
    const res = await request({ entry: entry(), baseUrl: srv.url }, { path: '/x' });
    expect(await res.json()).toEqual({ ok: true });
    expect(n).toBe(3);
  });

  it('does not retry 401 and never leaks the key in the error', async () => {
    const key = 'sk-proj-SECRETSECRETSECRETSECRET0000';
    let n = 0;
    const srv = await mockServer((req, res) => {
      n++;
      // A hostile/buggy server echoing the credential back.
      json(res, 401, {
        error: { message: `Incorrect API key provided: ${req.headers.authorization}` },
      });
    });
    close = srv.close;
    const err = await request(
      { entry: entry(), baseUrl: srv.url, apiKey: new Secret(key) },
      { path: '/x' },
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'auth', status: 401, retryable: false });
    expect(String((err as Error).message)).not.toContain('SECRETSECRET');
    expect(n).toBe(1);
  });

  it('gives up after maxRetries on 5xx', async () => {
    let n = 0;
    const srv = await mockServer((_req, res) => {
      n++;
      json(res, 503, { error: 'unavailable' });
    });
    close = srv.close;
    await expect(
      request({ entry: entry(), baseUrl: srv.url, maxRetries: 1 }, { path: '/x' }),
    ).rejects.toMatchObject({ code: 'server' });
    expect(n).toBe(2);
  });

  it('times out and supports cancellation', async () => {
    const srv = await mockServer(() => {
      /* never answers */
    });
    close = srv.close;
    await expect(
      request({ entry: entry(), baseUrl: srv.url, timeoutMs: 100, maxRetries: 0 }, { path: '/x' }),
    ).rejects.toMatchObject({ code: 'timeout' });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    await expect(
      request({ entry: entry(), baseUrl: srv.url }, { path: '/x', signal: ctrl.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('applies header, query and optional auth modes', async () => {
    const srv = await mockServer((_req, res) => json(res, 200, {}));
    close = srv.close;
    const k = new Secret('key-value-123456789');
    await request(
      { entry: entry({ type: 'header', header: 'api-key' }), baseUrl: srv.url, apiKey: k },
      { path: '/a' },
    );
    await request(
      { entry: entry({ type: 'query', queryParam: 'key' }), baseUrl: srv.url, apiKey: k },
      { path: '/b' },
    );
    await request(
      { entry: entry({ type: 'none', optional: true }), baseUrl: srv.url },
      { path: '/c' },
    );
    expect(srv.requests[0]!.headers['api-key']).toBe('key-value-123456789');
    expect(srv.requests[1]!.url).toBe('/b?key=key-value-123456789');
    expect(srv.requests[2]!.headers.authorization).toBeUndefined();
  });
});

describe('helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
  });

  it('parses SSE split across chunks, comments, CRLF and NDJSON', async () => {
    const enc = new TextEncoder();
    const parts = [
      'event: a\r\nda',
      'ta: {"x":1}\r\n\r\n',
      ': keepalive\n\n',
      'data: line1\ndata: line2\n\n',
      '{"nd":true}\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    const events = [];
    for await (const e of parseSse(stream)) events.push(e);
    expect(events).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: undefined, data: 'line1\nline2' },
      { data: '{"nd":true}' },
    ]);
  });

  it('aborts idle streams', async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const it = parseSse(stream, { idleTimeoutMs: 50 });
    await expect(it.next()).rejects.toMatchObject({ code: 'timeout' });
  });
});

export type { ProviderConfig };
