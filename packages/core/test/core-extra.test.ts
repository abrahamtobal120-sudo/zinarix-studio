import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeychainStore, OmniConfig, OmniCore, getPath, loadConfig, saveConfig } from '@omni/core';
import type { CatalogEntry } from '@omni/shared';
import { json, mockServer, sse } from '../../../tests/helpers/mock-server.js';

let home: string;
let core: OmniCore | undefined;
let close: (() => Promise<void>) | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omni-core2-'));
});
afterEach(async () => {
  core?.close();
  core = undefined;
  await close?.();
  close = undefined;
});

const entry = (id: string, baseUrl: string): CatalogEntry => ({
  id,
  name: id,
  adapter: 'openai-compatible',
  baseUrl,
  baseUrlParams: [],
  auth: { type: 'bearer', header: 'Authorization' },
  envVars: [],
  region: 'global',
  category: 'custom',
  modelsEndpoint: '/models',
  supports: {
    listModels: true,
    streaming: true,
    tools: true,
    vision: false,
    jsonMode: true,
    embeddings: false,
    fim: false,
  },
  fallbackModels: [],
  status: 'active',
  verifiedAt: null,
});

function open(cfg: Partial<OmniConfig> = {}, env: NodeJS.ProcessEnv = {}): OmniCore {
  saveConfig(join(home, 'config.json'), OmniConfig.parse(cfg));
  core = OmniCore.open({ home, env: { OMNI_NO_KEYCHAIN: '1', OMNI_VAULT_PASSWORD: 'pw', ...env } });
  return core;
}

describe('config file handling', () => {
  it('reports invalid JSON and schema errors with the file path', () => {
    const f = join(home, 'config.json');
    writeFileSync(f, '{nope');
    expect(() => loadConfig(f)).toThrow(/invalid JSON/);
    writeFileSync(f, JSON.stringify({ defaultModel: 'sin-barra' }));
    expect(() => loadConfig(f)).toThrow(/defaultModel/);
    expect(loadConfig(join(home, 'missing.json')).privacy.redactSecrets).toBe(true);
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1);
  });
});

describe('OmniCore', () => {
  it('complete() collects text, tool calls, usage and notices', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/models')
        return json(res, 200, {
          data: [{ id: 'm', pricing: { prompt: '0.000001', completion: '0.000002' } }],
        });
      sse(res, [
        { data: { choices: [{ delta: { reasoning_content: 'hmm' } }] } },
        {
          data: {
            choices: [
              {
                delta: {
                  content: 'ok',
                  tool_calls: [{ index: 0, id: 't', function: { name: 'ls', arguments: '{}' } }],
                },
                finish_reason: 'tool_calls',
              },
            ],
          },
        },
        { data: { choices: [], usage: { prompt_tokens: 1000000, completion_tokens: 1000000 } } },
        '[DONE]',
      ]);
    });
    close = srv.close;
    const c = open({ customProviders: [entry('mock', srv.url)], defaultModel: 'mock/m' });
    await c.vault.set('mock', 'mock-key-123456789', 'file');
    const r = await c.complete(
      { messages: [{ role: 'user', content: 'hola' }] },
      new AbortController().signal,
    );
    expect(r).toMatchObject({
      text: 'ok',
      reasoning: 'hmm',
      provider: 'mock',
      model: 'm',
      stopReason: 'tool_use',
    });
    expect(r.toolCalls).toEqual([{ id: 't', name: 'ls', arguments: '{}' }]);
    // Price learned lazily from /models after the answer: $1/M in + $2/M out.
    expect(r.usd).toBeCloseTo(3);
  });

  it('fim() uses the native completions endpoint, counts usage and remembers a refusal', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const srv = await mockServer((req, res) => {
      const body = JSON.parse(req.body || '{}') as Record<string, unknown>;
      seen.push({ url: req.url, body });
      if (body.model === 'chat-only')
        return json(res, 400, { error: { message: 'chat-only does not support insert' } });
      json(res, 200, { choices: [{ text: 'a + b;' }] });
    });
    close = srv.close;
    const fimEntry = entry('mock', srv.url);
    fimEntry.supports.fim = true;
    const c = open({
      customProviders: [fimEntry, entry('plain', srv.url)],
      roles: { inline: 'mock/coder' },
      prices: { 'mock/coder': { input: 1, output: 2 } },
    });
    await c.vault.set('mock', 'mock-key-123456789', 'file');
    await c.vault.set('plain', 'mock-key-123456789', 'file');
    const signal = new AbortController().signal;
    const req = { prefix: 'function sum(a, b) {\n  return ', suffix: '\n}\n', maxTokens: 32 };

    expect(await c.fim(req, signal)).toEqual({ text: 'a + b;', provider: 'mock', model: 'coder' });
    expect(seen[0]!.url).toBe('/completions');
    expect(seen[0]!.body).toMatchObject({ prompt: req.prefix, suffix: req.suffix, max_tokens: 32 });
    const row = c.db
      .prepare('SELECT role, input_tokens, output_tokens, cost_usd FROM usage')
      .get() as { role: string; input_tokens: number; output_tokens: number; cost_usd: number };
    expect(row.role).toBe('inline');
    expect(row.input_tokens).toBeGreaterThan(0);
    expect(row.cost_usd).toBeGreaterThan(0);

    // The model refuses: undefined (the caller uses chat) and no second request for it.
    expect(await c.fim({ ...req, model: 'mock/chat-only' }, signal)).toBeUndefined();
    expect(await c.fim({ ...req, model: 'mock/chat-only' }, signal)).toBeUndefined();
    expect(seen).toHaveLength(2);
    // A provider that does not declare fill-in-the-middle is never asked.
    expect(await c.fim({ ...req, model: 'plain/m' }, signal)).toBeUndefined();
    expect(seen).toHaveLength(2);
  });

  it('lists connected providers from keys and keyless local entries', async () => {
    const c = open(
      { providers: { ollama: { params: {}, headers: {} } } },
      { GROQ_API_KEY: 'gsk_x' },
    );
    await c.vault.set('mistral', 'mistral-key-123456', 'file');
    const ids = (await c.connectedProviders()).map((p) => `${p.id}:${p.store}`).sort();
    expect(ids).toEqual(['groq:env', 'mistral:file', 'ollama:none']);
    expect(await c.vault.delete('mistral')).toBe(true);
    expect(await c.vault.delete('mistral')).toBe(false);
  });

  it('warns at 80 % of a soft budget without blocking', () => {
    const c = open({ budgets: { '*': { monthly: 10, hardStop: false } } });
    c.db
      .prepare("INSERT INTO usage (ts, provider, model, cost_usd) VALUES (?, 'x', 'y', 9)")
      .run(Date.now());
    expect(c.checkBudget('x')[0]).toMatch(/90%/);
    c.db
      .prepare("INSERT INTO usage (ts, provider, model, cost_usd) VALUES (?, 'x', 'y', 5)")
      .run(Date.now());
    expect(() => c.checkBudget('x')).not.toThrow();
  });

  it('uses role assignments before the default model and user price overrides', () => {
    const c = open({
      defaultModel: 'a/x',
      roles: { commit: 'b/y' },
      prices: { 'b/y': { input: 1, output: 1 } },
    });
    expect(c.resolveModel(undefined, 'commit')).toEqual({ provider: 'b', model: 'y' });
    expect(c.resolveModel(undefined, 'chat')).toEqual({ provider: 'a', model: 'x' });
    expect(c.price({ provider: 'b', model: 'y' })).toEqual({ input: 1, output: 1 });
  });

  it('asks for a key before using Bedrock, and rejects unknown providers', async () => {
    const c = open({
      providers: { 'amazon-bedrock': { params: { region: 'us-east-1' }, headers: {} } },
    });
    await expect(c.providerConfig('amazon-bedrock')).rejects.toMatchObject({ code: 'auth' });
    expect(() => c.provider('nope')).toThrow(/unknown provider/);
  });

  it('manages history lifecycle and wipes everything', async () => {
    const c = open();
    const conv = c.history.create('uno');
    c.history.append(conv.id, {
      role: 'user',
      content: [
        { type: 'text', text: 'hola' },
        { type: 'image', mediaType: 'image/png', data: 'AA' },
      ],
    });
    c.history.rename(conv.id, 'renombrada');
    expect(c.history.get(conv.id)!.conversation.title).toBe('renombrada');
    expect(c.history.exportMarkdown(conv.id)).toContain('[imagen]');
    expect(c.history.search('100%_')).toEqual([]);
    c.history.delete(conv.id);
    expect(c.history.list()).toEqual([]);
    c.history.create('dos');
    await c.wipe();
    expect(c.history.list()).toEqual([]);
  });

  it('keychain store degrades gracefully when disabled', async () => {
    const k = new KeychainStore('omnicode-test', { OMNI_NO_KEYCHAIN: '1' });
    expect(k.available()).toBe(false);
    expect(await k.get('x')).toBeUndefined();
    expect(await k.list()).toEqual([]);
    expect(await k.delete('x')).toBe(false);
  });
});

describe('usage reports', () => {
  it('groups spend by provider and by local day', async () => {
    const { usageByProvider, usageByDay, recordUsage } = await import('@omni/core');
    const c = open();
    const now = Date.now();
    recordUsage(
      c.db,
      { provider: 'a', model: 'm', inputTokens: 10, outputTokens: 5, costUsd: 0.5 },
      now,
    );
    recordUsage(
      c.db,
      { provider: 'a', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: null },
      now,
    );
    recordUsage(
      c.db,
      { provider: 'b', model: 'x', inputTokens: 2, outputTokens: 2, costUsd: 2 },
      now - 86_400_000 * 3,
    );
    const byP = usageByProvider(c.db, 0);
    expect(byP.map((r) => [r.provider, r.requests, r.costUsd, r.unpricedRequests])).toEqual([
      ['b', 1, 2, 0],
      ['a', 2, 0.5, 1],
    ]);
    const days = usageByDay(c.db, 0);
    expect(days).toHaveLength(2);
    expect(days[0]!.provider).toBe('b');
    expect(days[1]!.tokens).toBe(17);
  });
});

describe('saved conversations', () => {
  it('keeps display data, filters by project and survives reopening', () => {
    const c = open();
    const a = c.history.create('Arreglar login', 'openai/x', '/proj/a');
    c.history.create('Otra cosa', 'openai/x', '/proj/b');
    c.history.append(a.id, { role: 'user', content: 'arregla el login' }, undefined, {
      context: ['file:src/login.ts'],
    });
    c.history.append(a.id, { role: 'assistant', content: 'Listo' }, 'openai/x', {
      parts: [
        {
          kind: 'tool',
          name: 'read_file',
          summary: 'ok',
          output: 'token ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789',
        },
      ],
    });
    expect(c.history.list(50, '/proj/a').map((x) => x.title)).toEqual(['Arreglar login']);
    expect(c.history.list(50).length).toBe(2);
    expect(c.history.search('login', 50, '/proj/b')).toEqual([]);
    const home = c.paths.home;
    c.close();
    core = OmniCore.open({ home, env: { OMNI_NO_KEYCHAIN: '1' } });
    const got = core.history.get(a.id)!;
    expect(got.conversation).toMatchObject({ project: '/proj/a', messageCount: 2 });
    expect(got.messages[0]!.display).toEqual({ context: ['file:src/login.ts'] });
    expect(JSON.stringify(got.messages[1]!.display)).not.toContain('ghp_');
  });
});

describe('catalog resilience', () => {
  it('keeps the valid providers when one entry is unknown to this build', async () => {
    const { parseCatalog } = await import('../src/catalog.js');
    const good = {
      id: 'good',
      name: 'Good',
      adapter: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      auth: { type: 'bearer' },
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
      status: 'active',
      verifiedAt: null,
    };
    const text = JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-10-08',
      providers: [good, { ...good, id: 'future', adapter: 'some-future-adapter' }],
    });
    const cat = parseCatalog(text, 'test');
    expect(cat.providers.map((p) => p.id)).toEqual(['good']);
    expect(() => parseCatalog('{"schemaVersion":1,"providers":[]}', 'test')).toThrow();
  });
});
