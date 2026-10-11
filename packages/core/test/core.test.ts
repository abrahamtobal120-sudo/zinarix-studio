import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EnvStore,
  FileVault,
  OmniCore,
  cacheRates,
  computeCost,
  configIssues,
  defaultDirs,
  envVarNames,
  loadCatalog,
  omniPaths,
  parseModelRef,
  resolveBaseUrl,
  setPath,
  OmniConfig,
  updateCatalogFromUrl,
} from '@omni/core';
import type { OmniEvent } from '@omni/core';
import type { CatalogEntry } from '@omni/shared';
import { json, mockServer, openAiStream, sse } from '../../../tests/helpers/mock-server.js';

let home: string;
let core: OmniCore | undefined;
let close: (() => Promise<void>) | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omni-core-'));
  process.env.OMNI_NO_KEYCHAIN = '1';
});
afterEach(async () => {
  core?.close();
  core = undefined;
  await close?.();
  close = undefined;
});

const custom = (id: string, baseUrl: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name: id,
  adapter: 'openai-compatible',
  baseUrl,
  baseUrlParams: [],
  auth: { type: 'bearer', header: 'Authorization' },
  envVars: [`${id.toUpperCase().replace(/-/g, '_')}_KEY`],
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
  fallbackModels: [{ id: 'm', label: 'M', inputPrice: 2, outputPrice: 10 }],
  status: 'active',
  verifiedAt: null,
  ...over,
});

function open(env: NodeJS.ProcessEnv = {}, cfg: Partial<OmniConfig> = {}): OmniCore {
  writeFileSync(join(home, 'config.json'), JSON.stringify(OmniConfig.parse(cfg)));
  core = OmniCore.open({
    home,
    env: { ...env, OMNI_NO_KEYCHAIN: '1' },
    askPassword: async () => 'pw',
  });
  return core;
}

async function drain(it: AsyncIterable<OmniEvent>): Promise<OmniEvent[]> {
  const out: OmniEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('config', () => {
  it('validates and sets dotted paths', () => {
    let cfg = OmniConfig.parse({});
    cfg = setPath(cfg, 'privacy.localOnly', 'true');
    cfg = setPath(cfg, 'budgets.anthropic', '{"daily":5}');
    expect(cfg.privacy.localOnly).toBe(true);
    expect(cfg.budgets.anthropic).toEqual({ daily: 5, hardStop: true });
    expect(() => setPath(cfg, 'defaultModel', 'no-slash')).toThrow();
  });

  it('parses provider/model refs, keeping slashes in model ids', () => {
    expect(parseModelRef('openrouter/anthropic/claude-x')).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-x',
    });
    expect(() => parseModelRef('groq')).toThrow();
  });
});

describe('catalog', () => {
  it('loads the bundled catalog and merges custom providers', () => {
    const c = open({}, { customProviders: [custom('mine', 'http://127.0.0.1:1/v1')] });
    expect(c.catalog.source).toBe('bundled');
    expect(c.catalog.providers.size).toBe(c.catalog.catalog.providers.length + 1);
    expect(c.provider('mine').category).toBe('custom');
  });

  it('resolves base URL placeholders or explains what is missing', () => {
    const cf = open().provider('cloudflare-workers-ai');
    expect(resolveBaseUrl(cf, { account_id: 'abc123' })).toBe(
      'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1',
    );
    expect(() => resolveBaseUrl(cf, {})).toThrow(/--param account_id=/);
  });

  it('accepts hot updates only with a valid signature', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const bundled = readFileSync(new URL('../../../catalog/providers.json', import.meta.url));
    const data = Buffer.from(
      JSON.stringify({ ...JSON.parse(bundled.toString()), generatedAt: '2099-01-01' }),
    );
    const goodSig = sign(null, data, privateKey).toString('base64');
    let sig = 'AAAA';
    const srv = await mockServer((req, res) => {
      res.writeHead(200);
      res.end(req.url.endsWith('.sig') ? sig : data);
    });
    close = srv.close;
    const paths = omniPaths(home);
    await expect(
      updateCatalogFromUrl(`${srv.url}/providers.json`, paths, { publicKeyPem: pub }),
    ).rejects.toThrow(/signature/);
    sig = goodSig;
    await updateCatalogFromUrl(`${srv.url}/providers.json`, paths, { publicKeyPem: pub });
    const loaded = loadCatalog(paths, OmniConfig.parse({}), pub);
    expect(loaded.source).toBe('update');
    expect(loaded.catalog.generatedAt).toBe('2099-01-01');
    // Tampering after download makes the loader fall back to the bundled catalog.
    writeFileSync(paths.catalogOverride, data.toString().replace('2099', '2098'));
    expect(loadCatalog(paths, OmniConfig.parse({}), pub).source).toBe('bundled');
  });
});

describe('vault', () => {
  it('encrypts keys at rest with mode 600 and rejects a wrong password', async () => {
    const file = join(home, 'vault.enc');
    const v = new FileVault(file, async () => 'correct horse');
    await v.set('groq', 'gsk' + '_testtesttesttesttesttest1234');
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('gsk_');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = new FileVault(file, async () => 'correct horse');
    expect((await again.get('groq'))?.reveal()).toBe('gsk' + '_testtesttesttesttesttest1234');
    const wrong = new FileVault(file, async () => 'nope');
    await expect(wrong.get('groq')).rejects.toMatchObject({ code: 'auth' });
  });

  it('reads catalog env vars and OMNI_KEY_<ID>', async () => {
    const c = open();
    const env = new EnvStore(c.catalog.providers, {
      GROQ_API_KEY: 'gsk_env',
      OMNI_KEY_TOGETHER: 'tg_env',
    });
    expect((await env.get('groq'))?.reveal()).toBe('gsk_env');
    expect((await env.get('together'))?.reveal()).toBe('tg_env');
    expect((await env.list()).sort()).toEqual(['groq', 'together']);
  });

  it('falls back to the file vault when the keychain is unavailable', async () => {
    const c = open();
    expect(await c.vault.set('groq', 'gsk_filevaultfilevault1234')).toBe('file');
    expect((await c.vault.get('groq'))?.store).toBe('file');
    await c.wipe();
    expect(existsSync(join(home, 'vault.enc'))).toBe(false);
  });
});

describe('stream', () => {
  it('routes, streams, prices and records usage + audit + redaction', async () => {
    const srv = await mockServer((req, res) => sse(res, openAiStream('respuesta')));
    close = srv.close;
    const c = open(
      { MOCK_KEY: 'mock-key-1234567890' },
      { customProviders: [custom('mock', srv.url)], defaultModel: 'mock/m' },
    );
    const events = await drain(
      c.stream(
        {
          messages: [
            {
              role: 'user',
              content: 'mi llave es ' + 'sk-ant' + '-api03-zzzzzzzzzzzzzzzzzzzzzzzz',
            },
          ],
        },
        new AbortController().signal,
      ),
    );
    expect(events).toContainEqual({ type: 'notice', kind: 'redaction', message: '1' });
    expect(srv.requests[0]!.body).not.toContain('sk-ant-api03');
    expect(srv.requests[0]!.body).toContain('[REDACTADO]');
    const cost = events.find((e) => e.type === 'cost') as Extract<OmniEvent, { type: 'cost' }>;
    // 12 input (2 cached at the OpenAI 50 % rate) * $2/M + 5 output * $10/M
    expect(cost.usd).toBeCloseTo((10 * 2 + 2 * 1 + 5 * 10) / 1e6, 12);
    const usage = c.db
      .prepare('SELECT provider, model, input_tokens, output_tokens FROM usage')
      .all();
    expect(usage).toEqual([{ provider: 'mock', model: 'm', input_tokens: 12, output_tokens: 5 }]);
    const audit = c.db
      .prepare("SELECT event, detail_json FROM audit WHERE event = 'chat'")
      .get() as { detail_json: string };
    expect(JSON.parse(audit.detail_json).redactions).toBe(1);
    expect(audit.detail_json).not.toContain('sk-ant');
  });

  it('falls back to the next model on retryable errors before the first token', async () => {
    const bad = await mockServer((_req, res) => json(res, 503, { error: 'down' }));
    const good = await mockServer((_req, res) => sse(res, openAiStream('desde respaldo')));
    close = async () => {
      await bad.close();
      await good.close();
    };
    const c = open(
      { BAD_KEY: 'k1-xxxxxxxx', GOOD_KEY: 'k2-xxxxxxxx' },
      {
        customProviders: [custom('bad', bad.url), custom('good', good.url)],
        defaultModel: 'bad/m',
        fallbacks: ['good/m'],
      },
    );
    (c as unknown as { timeoutMs: number }).timeoutMs = 2000;
    const cfgBad = await c.providerConfig('bad');
    expect(cfgBad.entry.id).toBe('bad');
    const events = await drain(
      c.stream({ messages: [{ role: 'user', content: 'hola' }] }, new AbortController().signal),
    );
    expect(events.some((e) => e.type === 'notice' && e.kind === 'fallback')).toBe(true);
    expect(events.find((e) => e.type === 'start' && e.provider === 'good')).toBeTruthy();
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { delta: string }).delta)
        .join(''),
    ).toBe('desde respaldo');
  }, 30000);

  it('does not fall back on auth errors', async () => {
    const srv = await mockServer((_req, res) => json(res, 401, { error: { message: 'bad key' } }));
    close = srv.close;
    const c = open(
      { MOCK_KEY: 'mock-key-1234567890', OTHER_KEY: 'x' },
      {
        customProviders: [custom('mock', srv.url), custom('other', srv.url)],
        defaultModel: 'mock/m',
        fallbacks: ['other/m'],
      },
    );
    await expect(
      drain(c.stream({ messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('enforces hard budgets', async () => {
    const c = open(
      { MOCK_KEY: 'k' },
      {
        customProviders: [custom('mock', 'http://127.0.0.1:9')],
        defaultModel: 'mock/m',
        budgets: { mock: { daily: 0.01, hardStop: true } },
      },
    );
    c.db
      .prepare("INSERT INTO usage (ts, provider, model, cost_usd) VALUES (?, 'mock', 'm', 0.02)")
      .run(Date.now());
    await expect(
      drain(c.stream({ messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'budget' });
  });

  it('blocks cloud providers in 100% local mode but allows local ones', async () => {
    const c = open(
      { GROQ_API_KEY: 'gsk_x' },
      {
        privacy: { localOnly: true, redactSecrets: true },
        providers: { ollama: { params: {}, headers: {} } },
      },
    );
    await expect(c.providerConfig('groq')).rejects.toMatchObject({ code: 'privacy' });
    expect((await c.providerConfig('ollama')).baseUrl).toBe('http://localhost:11434/v1');
  });

  it('reports missing keys with the command to fix it', async () => {
    const c = open();
    await expect(c.providerConfig('groq')).rejects.toThrow(/omni auth add groq/);
  });
});

describe('models + history + cost', () => {
  it('caches live model lists and refreshes on demand', async () => {
    let calls = 0;
    const srv = await mockServer((_req, res) => {
      calls++;
      json(res, 200, { data: [{ id: 'm' }, { id: 'n' }] });
    });
    close = srv.close;
    const c = open({ MOCK_KEY: 'k' }, { customProviders: [custom('mock', srv.url)] });
    const cfg = await c.providerConfig('mock');
    expect((await c.models.list(cfg)).cached).toBe(false);
    const second = await c.models.list(cfg);
    expect(second.cached).toBe(true);
    expect(second.models.find((m) => m.id === 'm')!.inputPrice).toBe(2);
    await c.models.list(cfg, { refresh: true });
    expect(calls).toBe(2);
  });

  it('stores redacted history, searches and exports markdown', () => {
    const c = open();
    const conv = c.history.create('JWT en Express', 'mock/m');
    c.history.append(conv.id, {
      role: 'user',
      content: 'token ' + 'ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789 ¿es seguro?',
    });
    c.history.append(conv.id, { role: 'assistant', content: 'Usa jsonwebtoken' }, 'mock/m');
    expect(c.history.search('jwt').map((h) => h.id)).toEqual([conv.id]);
    const md = c.history.exportMarkdown(conv.id.slice(0, 8))!;
    expect(md).toContain('# JWT en Express');
    expect(md).not.toContain('ghp_');
  });

  it('computes cost with cache discount', () => {
    expect(computeCost({ input: 3, output: 15 }, 1_000_000, 1_000_000)).toBe(18);
    expect(computeCost(undefined, 10, 10)).toBeNull();
    // Cache reads: OpenAI-style 50 % by default, Anthropic 10 %.
    expect(computeCost({ input: 10, output: 0 }, 1_000_000, 0, 1_000_000)).toBeCloseTo(5);
    expect(
      computeCost({ input: 10, output: 0 }, 1_000_000, 0, 1_000_000, {
        rates: cacheRates('anthropic'),
      }),
    ).toBeCloseTo(1);
    // Anthropic cache writes cost 125 % of the input price, not the base price.
    expect(
      computeCost({ input: 10, output: 0 }, 1_000_000, 0, 0, {
        cacheWrite: 1_000_000,
        rates: cacheRates('anthropic'),
      }),
    ).toBeCloseTo(12.5);
    // Explicit catalog/config cache prices win over the multipliers.
    expect(
      computeCost({ input: 10, output: 0, cachedInput: 2 }, 1_000_000, 0, 1_000_000),
    ).toBeCloseTo(2);
  });
});

describe('budgets with unpriced models', () => {
  const unpriced = (id: string, baseUrl: string) =>
    custom(id, baseUrl, {
      modelsEndpoint: null,
      supports: { ...custom(id, baseUrl).supports, listModels: false },
      fallbackModels: [{ id: 'm', label: 'M' }],
    });

  it('refuses an unpriced cloud model when a hardStop budget applies', async () => {
    const srv = await mockServer((_req, res) => sse(res, openAiStream('x')));
    close = srv.close;
    const c = open(
      { FREE_KEY: 'free-key-1234567890' },
      {
        customProviders: [unpriced('free', srv.url)],
        defaultModel: 'free/m',
        budgets: { '*': { daily: 1, hardStop: true } },
      },
    );
    await expect(
      drain(c.stream({ messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'budget', message: expect.stringMatching(/no known price/) });
    expect(srv.requests).toHaveLength(0);
  });

  it('only warns without hardStop, and a config price makes it trackable', async () => {
    const srv = await mockServer((_req, res) => sse(res, openAiStream('x')));
    close = srv.close;
    const c = open(
      { FREE_KEY: 'free-key-1234567890' },
      {
        customProviders: [unpriced('free', srv.url)],
        defaultModel: 'free/m',
        budgets: { free: { daily: 1, hardStop: false } },
      },
    );
    const events = await drain(
      c.stream({ messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'notice',
        kind: 'budget',
        message: expect.stringMatching(/no known price/),
      }),
    );
    c.saveConfig({ ...c.config, prices: { 'free/m': { input: 1, output: 1 } } });
    const priced = await drain(
      c.stream({ messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal),
    );
    expect(priced.find((e) => e.type === 'notice' && e.kind === 'budget')).toBeUndefined();
    expect((priced.find((e) => e.type === 'cost') as { usd: number }).usd).toBeGreaterThan(0);
  });

  it('records the cost of tokens consumed before a mid-stream error', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        { data: { choices: [{ delta: { content: 'hola' } }] } },
        { data: { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 1000 } } },
        { data: { error: { message: 'boom' } } },
      ]),
    );
    close = srv.close;
    const c = open(
      { MOCK_KEY: 'mock-key-1234567890' },
      { customProviders: [custom('mock', srv.url)], defaultModel: 'mock/m' },
    );
    await expect(
      drain(c.stream({ messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'server' });
    const row = c.db.prepare('SELECT cost_usd, ok FROM usage').get() as {
      cost_usd: number;
      ok: number;
    };
    expect(row.ok).toBe(0);
    expect(row.cost_usd).toBeCloseTo((1000 * 2 + 1000 * 10) / 1e6, 12);
  });
});

describe('config.json cannot weaken the signed catalog', () => {
  it('ignores a custom provider that reuses a catalog id and refuses to save it', () => {
    const c = open({}, { customProviders: [custom('anthropic', 'https://evil.example/v1')] });
    expect(c.provider('anthropic').baseUrl).toBe('https://api.anthropic.com/v1');
    expect(c.catalog.rejected[0]).toMatch(/already a catalog provider/);
    expect(() => c.saveConfig(c.config)).toThrow(/already a catalog provider/);
  });

  it('allows baseUrl overrides only on the same registrable domain or loopback', async () => {
    const ok = (url: string) =>
      configIssues(
        OmniConfig.parse({ providers: { anthropic: { baseUrl: url } } }),
        open().catalog.catalog,
      );
    expect(ok('https://eu.api.anthropic.com/v1')).toEqual([]);
    expect(ok('http://127.0.0.1:8080/v1')).toEqual([]);
    expect(ok('https://anthropic.com.evil.io/v1')[0]).toMatch(/not on anthropic\.com/);
    core?.close();
    const c = open(
      { ANTHROPIC_API_KEY: 'sk-ant-test-0000000000000000' },
      { providers: { anthropic: { params: {}, headers: {}, baseUrl: 'https://evil.example/v1' } } },
    );
    await expect(c.providerConfig('anthropic')).rejects.toMatchObject({ code: 'config' });
  });

  it('refuses to send a key over plain http to a non-loopback host', async () => {
    const c = open(
      { LAN_KEY: 'lan-key-1234567890' },
      { customProviders: [custom('lan', 'http://192.168.1.20:8000/v1')] },
    );
    await expect(c.providerConfig('lan')).rejects.toThrow(/plain HTTP/);
    core?.close();
    // Keyless local servers on the LAN are fine: there is no credential to expose.
    const keyless = open(
      {},
      {
        customProviders: [
          custom('lan', 'http://192.168.1.20:11434/v1', { auth: { type: 'none' } }),
        ],
      },
    );
    expect((await keyless.providerConfig('lan')).baseUrl).toBe('http://192.168.1.20:11434/v1');
  });
});

describe('vault hardening', () => {
  it('keyless providers never unlock the file vault', async () => {
    const asked: string[] = [];
    writeFileSync(join(home, 'config.json'), JSON.stringify(OmniConfig.parse({})));
    core = OmniCore.open({
      home,
      env: { OMNI_NO_KEYCHAIN: '1' },
      askPassword: async () => {
        asked.push('x');
        return 'pw';
      },
    });
    await core.vault.set('groq', 'gsk_filevaultfilevault1234', 'file');
    core.close();
    asked.length = 0;
    core = OmniCore.open({
      home,
      env: { OMNI_NO_KEYCHAIN: '1' },
      askPassword: async () => {
        asked.push('x');
        return 'pw';
      },
    });
    expect((await core.providerConfig('ollama')).apiKey).toBeUndefined();
    expect(asked).toEqual([]);
    expect((await core.providerConfig('groq')).apiKey?.reveal()).toBe('gsk_filevaultfilevault1234');
    expect(asked).toEqual(['x']);
  });

  it('rejects absurd Argon2 parameters from a tampered vault.enc', async () => {
    const file = join(home, 'vault.enc');
    await new FileVault(file, async () => 'pw').set('groq', 'gsk_x1234567890');
    const vf = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...vf, kdf: { ...vf.kdf, memory: 2 ** 31 } }));
    await expect(new FileVault(file, async () => 'pw').get('groq')).rejects.toThrow(
      /kdf\.memory out of range/,
    );
  });

  it('never uses endpoints, account ids or regions as the key', async () => {
    const c = open();
    expect(envVarNames(c.provider('azure-openai'))).not.toContain('AZURE_OPENAI_ENDPOINT');
    expect(envVarNames(c.provider('cloudflare-workers-ai'))).not.toContain('CLOUDFLARE_ACCOUNT_ID');
    const env = new EnvStore(c.catalog.providers, {
      AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
    });
    expect(await env.get('azure-openai')).toBeUndefined();
    // Older or custom catalogs that still list them as envVars are filtered too.
    const legacy = new EnvStore(
      new Map([['az', custom('az', 'https://x', { envVars: ['AZ_ENDPOINT', 'AZ_KEY'] })]]),
      { AZ_ENDPOINT: 'https://x' },
    );
    expect(await legacy.get('az')).toBeUndefined();
  });
});

describe('history ids', () => {
  it('does not treat LIKE wildcards as an id and needs an unambiguous prefix', () => {
    const c = open();
    const a = c.history.create('a', 'mock/m');
    expect(c.history.get('%')).toBeUndefined();
    expect(c.history.get('_')).toBeUndefined();
    expect(c.history.get(a.id)?.conversation.id).toBe(a.id);
    expect(c.history.get(a.id.slice(0, 8))?.conversation.id).toBe(a.id);
  });
});

describe('data directory', () => {
  it('keeps an existing ~/.omni, otherwise follows XDG and APPDATA', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'omni-home-'));
    expect(
      defaultDirs({ HOME: fakeHome, XDG_CONFIG_HOME: '/x/cfg', XDG_DATA_HOME: '/x/data' }, 'linux'),
    ).toEqual({
      config: '/x/cfg/omni',
      data: '/x/data/omni',
    });
    expect(defaultDirs({ HOME: fakeHome }, 'linux')).toEqual({
      config: join(fakeHome, '.config', 'omni'),
      data: join(fakeHome, '.local', 'share', 'omni'),
    });
    expect(defaultDirs({ USERPROFILE: fakeHome, APPDATA: '/appdata' }, 'win32').data).toBe(
      join('/appdata', 'omni'),
    );
    // Relative XDG values are invalid per spec and ignored.
    expect(defaultDirs({ HOME: fakeHome, XDG_DATA_HOME: 'rel' }, 'linux').data).toBe(
      join(fakeHome, '.local', 'share', 'omni'),
    );
    mkdirSync(join(fakeHome, '.omni'));
    expect(defaultDirs({ HOME: fakeHome, XDG_CONFIG_HOME: '/x/cfg' }, 'linux')).toEqual({
      config: join(fakeHome, '.omni'),
      data: join(fakeHome, '.omni'),
    });
    expect(defaultDirs({ HOME: fakeHome, OMNI_HOME: '/o' }, 'linux').data).toBe('/o');
  });
});
