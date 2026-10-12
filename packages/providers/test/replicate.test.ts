import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import type { CatalogEntry, ChatChunk, ChatRequest } from '@omni/shared';
import { Secret } from '@omni/security';
import type { ProviderConfig } from '../src/types.js';
import {
  buildInput,
  clearReplicateSchemaCache,
  flattenPrompt,
  parseModelId,
  replicate,
} from '../src/adapters/replicate.js';
import { json, mockServer } from '../../../tests/helpers/mock-server.js';
import type { RecordedRequest } from '../../../tests/helpers/mock-server.js';

let close: (() => Promise<void>) | undefined;
beforeEach(() => clearReplicateSchemaCache());
afterEach(async () => {
  await close?.();
  close = undefined;
});

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'replicate',
    name: 'Replicate',
    adapter: 'replicate',
    baseUrl: 'http://x',
    baseUrlParams: [],
    auth: { type: 'bearer', header: 'Authorization' },
    envVars: ['REPLICATE_API_TOKEN'],
    region: 'global',
    category: 'aggregator',
    modelsEndpoint: '/collections/language-models',
    supports: {
      listModels: true,
      streaming: true,
      tools: false,
      vision: true,
      jsonMode: false,
      embeddings: false,
      fim: false,
    },
    fallbackModels: [{ id: 'meta/meta-llama-3-70b-instruct', label: 'Llama 3 70B', context: 8192 }],
    status: 'active',
    verifiedAt: null,
    ...over,
  } as CatalogEntry;
}

const KEY = 'r8_testtoken1234567890';
const cfgFor = (url: string, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  entry: entry(),
  baseUrl: url,
  apiKey: new Secret(KEY),
  maxRetries: 0,
  ...over,
});

const schemaOf = (props: Record<string, unknown>) => ({
  owner: 'x',
  name: 'y',
  latest_version: {
    id: 'v1',
    openapi_schema: { components: { schemas: { Input: { type: 'object', properties: props } } } },
  },
});

const LLAMA_PROPS = {
  prompt: { type: 'string' },
  system_prompt: { type: 'string' },
  max_tokens: { type: 'integer' },
  max_new_tokens: { type: 'integer' },
  temperature: { type: 'number' },
};

function streamEvents(res: ServerResponse, events: string[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(e);
  res.end();
}

interface FakeOpts {
  props?: Record<string, unknown> | null;
  events?: string[];
  metrics?: Record<string, unknown>;
  noStream?: boolean;
  hangStream?: boolean;
}

/** Fake Replicate: model schema, prediction create, stream, get, cancel. */
async function fakeReplicate(opts: FakeOpts = {}) {
  let base = '';
  let polls = 0;
  const srv = await mockServer((req: RecordedRequest, res) => {
    const u = req.url;
    if (req.method === 'GET' && /^\/models\/[^/]+\/[^/]+$/.test(u)) {
      if (opts.props === null) return json(res, 500, { detail: 'oops' });
      return json(res, 200, schemaOf(opts.props ?? LLAMA_PROPS));
    }
    if (req.method === 'POST' && (u.endsWith('/predictions') || u === '/predictions')) {
      return json(res, 201, {
        id: 'p1',
        status: 'starting',
        output: null,
        error: null,
        urls: {
          get: `${base}/predictions/p1`,
          cancel: `${base}/predictions/p1/cancel`,
          web: 'https://replicate.com/p/p1',
          ...(opts.noStream ? {} : { stream: `${base}/stream/p1` }),
        },
      });
    }
    if (u === '/stream/p1') {
      if (opts.hangStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: output\nid: 1:0\ndata: Hola\n\n');
        return; // never ends
      }
      return streamEvents(
        res,
        opts.events ?? [
          'event: output\nid: 1:0\ndata: Hola\n\n',
          'event: output\nid: 1:1\ndata:  mundo\n\n',
          'event: output\nid: 1:2\ndata: \ndata: \n\n',
          'event: done\ndata: {}\n\n',
        ],
      );
    }
    if (u === '/predictions/p1' && req.method === 'GET') {
      polls++;
      const done = !opts.noStream || polls >= 2;
      return json(res, 200, {
        id: 'p1',
        status: done ? 'succeeded' : 'processing',
        output: done ? ['Hola', ' mundo'] : null,
        error: null,
        metrics: opts.metrics ?? { input_token_count: 21, output_token_count: 4, predict_time: 1 },
        urls: { get: `${base}/predictions/p1`, cancel: `${base}/predictions/p1/cancel` },
      });
    }
    if (u === '/predictions/p1/cancel') return json(res, 200, { id: 'p1', status: 'canceled' });
    json(res, 404, { detail: 'not found' });
  });
  base = srv.url;
  close = srv.close;
  return srv;
}

async function collect(
  cfg: ProviderConfig,
  req: Partial<ChatRequest> = {},
  signal = new AbortController().signal,
): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of replicate.chat(
    cfg,
    {
      model: 'meta/meta-llama-3-70b-instruct',
      messages: [
        { role: 'system', content: 'sé breve' },
        { role: 'user', content: 'hola' },
      ],
      ...req,
    },
    signal,
  ))
    out.push(c);
  return out;
}

const text = (chunks: ChatChunk[]) =>
  chunks
    .filter((c) => c.type === 'text')
    .map((c) => (c as { delta: string }).delta)
    .join('');

describe('replicate input mapping', () => {
  const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
    model: 'a/b',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ],
    maxTokens: 100,
    temperature: 0.5,
    ...over,
  });

  it('parses owner/name[:version] ids', () => {
    expect(parseModelId('meta/llama')).toEqual({ owner: 'meta', name: 'llama' });
    expect(parseModelId('a/b:abc123')).toEqual({ owner: 'a', name: 'b', version: 'abc123' });
    expect(() => parseModelId('llama')).toThrow(/owner\/name/);
  });

  it('flattens the conversation with the last user turn at the end', () => {
    expect(flattenPrompt([{ role: 'user', content: 'solo' }])).toBe('solo');
    expect(flattenPrompt(req().messages)).toBe(
      'User: q1\n\nAssistant: a1\n\nUser: q2\n\nAssistant:',
    );
  });

  it('uses prompt + system_prompt + max_tokens for llama-style schemas', () => {
    expect(buildInput(req(), { props: LLAMA_PROPS })).toEqual({
      prompt: 'User: q1\n\nAssistant: a1\n\nUser: q2\n\nAssistant:',
      system_prompt: 'sys',
      max_tokens: 100,
      temperature: 0.5,
    });
  });

  it('uses messages, max_completion_tokens, reasoning_effort and image_input (gpt-5 style)', () => {
    const input = buildInput(
      req({
        reasoning: 'high',
        messages: [
          { role: 'system', content: 'sys' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'mira' },
              { type: 'image', mediaType: 'image/png', data: 'AAAA' },
            ],
          },
        ],
      }),
      {
        props: {
          prompt: { type: 'string' },
          messages: { type: 'array' },
          system_prompt: { type: 'string' },
          image_input: { type: 'array' },
          reasoning_effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high'] },
          max_completion_tokens: { type: 'integer' },
        },
      },
    );
    expect(input).toEqual({
      messages: [{ role: 'user', content: 'mira' }],
      system_prompt: 'sys',
      max_completion_tokens: 100,
      reasoning_effort: 'high',
      image_input: ['data:image/png;base64,AAAA'],
    });
  });

  it('handles gemini-style system_instruction/max_output_tokens/images and claude-style image', () => {
    const r = req({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'BBBB' }] },
      ],
    });
    expect(
      buildInput(r, {
        props: {
          prompt: { type: 'string' },
          system_instruction: { type: 'string' },
          max_output_tokens: { type: 'integer' },
          images: { type: 'array' },
        },
      }),
    ).toEqual({
      prompt: '',
      system_instruction: 'sys',
      max_output_tokens: 100,
      images: ['data:image/jpeg;base64,BBBB'],
    });
    expect(
      buildInput(r, {
        props: { prompt: { type: 'string' }, image: { type: 'string' }, max_tokens: {} },
      }),
    ).toMatchObject({ image: 'data:image/jpeg;base64,BBBB', max_tokens: 100 });
  });

  it('folds the system prompt into the prompt when the model has no system field', () => {
    const input = buildInput(req(), {
      props: { prompt: { type: 'string' }, max_new_tokens: { type: 'integer' } },
    });
    expect(input).toEqual({
      prompt: 'sys\n\nUser: q1\n\nAssistant: a1\n\nUser: q2\n\nAssistant:',
      max_new_tokens: 100,
    });
  });

  it('falls back to prompt/system_prompt/max_tokens without a schema and ignores tools', () => {
    const input = buildInput(req({ tools: [{ name: 't', description: 'd', parameters: {} }] }), {});
    expect(Object.keys(input).sort()).toEqual([
      'max_tokens',
      'prompt',
      'system_prompt',
      'temperature',
    ]);
  });
});

describe('replicate adapter', () => {
  it('creates a prediction, streams output events and reports usage', async () => {
    const srv = await fakeReplicate();
    const chunks = await collect(cfgFor(srv.url), {
      maxTokens: 64,
      tools: [{ name: 't', description: 'd', parameters: {} }],
    });
    expect(text(chunks)).toBe('Hola mundo\n');
    expect(chunks).toContainEqual({ type: 'usage', inputTokens: 21, outputTokens: 4 });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });

    const [schemaReq, create, stream, get] = srv.requests;
    expect(schemaReq!.url).toBe('/models/meta/meta-llama-3-70b-instruct');
    expect(create!.method).toBe('POST');
    expect(create!.url).toBe('/models/meta/meta-llama-3-70b-instruct/predictions');
    expect(create!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(create!.body)).toEqual({
      input: { prompt: 'hola', system_prompt: 'sé breve', max_tokens: 64 },
    });
    expect(stream!.url).toBe('/stream/p1');
    expect(stream!.headers.accept).toBe('text/event-stream');
    expect(get!.url).toBe('/predictions/p1');
    expect(srv.requests.some((r) => r.url.endsWith('/cancel'))).toBe(false);
  });

  it('caches the input schema per model', async () => {
    const srv = await fakeReplicate();
    await collect(cfgFor(srv.url));
    await collect(cfgFor(srv.url));
    expect(
      srv.requests.filter((r) => r.url === '/models/meta/meta-llama-3-70b-instruct'),
    ).toHaveLength(1);
  });

  it('uses POST /predictions with version for owner/name:version ids', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/models/a/b/versions/v9')
        return json(res, 200, {
          id: 'v9',
          openapi_schema: {
            components: { schemas: { Input: { properties: { prompt: { type: 'string' } } } } },
          },
        });
      if (req.url === '/predictions' && req.method === 'POST')
        return json(res, 201, {
          id: 'p',
          status: 'failed',
          error: 'CUDA out of memory',
          urls: { get: 'x', cancel: `${srv.url}/c` },
        });
      json(res, 200, {});
    });
    close = srv.close;
    await expect(collect(cfgFor(srv.url), { model: 'a/b:v9' })).rejects.toMatchObject({
      code: 'server',
      retryable: false,
    });
    expect(JSON.parse(srv.requests[1]!.body)).toEqual({
      version: 'v9',
      input: { prompt: 'sé breve\n\nhola' },
    });
  });

  it('still runs when the schema cannot be read', async () => {
    const srv = await fakeReplicate({ props: null });
    const chunks = await collect(cfgFor(srv.url));
    expect(text(chunks)).toBe('Hola mundo\n');
    expect(JSON.parse(srv.requests[1]!.body).input).toEqual({
      prompt: 'hola',
      system_prompt: 'sé breve',
    });
  });

  it('turns an error event into an OmniError without leaking the token', async () => {
    const srv = await fakeReplicate({
      events: [
        'event: output\ndata: a\n\n',
        `event: error\ndata: {"detail": "bad things ${KEY}"}\n\n`,
        'event: done\ndata: {"reason": "error"}\n\n',
      ],
    });
    const err = await collect(cfgFor(srv.url)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'server', provider: 'replicate' });
    expect((err as Error).message).toContain('bad things');
    expect((err as Error).message).not.toContain(KEY);
  });

  it('reports a canceled prediction', async () => {
    const srv = await fakeReplicate({
      events: ['event: output\ndata: a\n\n', 'event: done\ndata: {"reason": "canceled"}\n\n'],
    });
    const chunks = await collect(cfgFor(srv.url));
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'canceled' });
  });

  it('cancels the prediction when the caller aborts', async () => {
    const srv = await fakeReplicate({ hangStream: true });
    const ctrl = new AbortController();
    const out: ChatChunk[] = [];
    const run = (async () => {
      for await (const c of replicate.chat(
        cfgFor(srv.url),
        { model: 'meta/meta-llama-3-70b-instruct', messages: [{ role: 'user', content: 'hi' }] },
        ctrl.signal,
      )) {
        out.push(c);
        if (c.type === 'text') ctrl.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ code: 'aborted' });
    expect(out).toEqual([{ type: 'text', delta: 'Hola' }]);
    await new Promise((r) => setTimeout(r, 100));
    const cancel = srv.requests.find((r) => r.url === '/predictions/p1/cancel');
    expect(cancel?.method).toBe('POST');
  });

  it('polls urls.get when the model has no stream URL', async () => {
    const srv = await fakeReplicate({ noStream: true });
    const chunks = await collect(cfgFor(srv.url));
    expect(text(chunks)).toBe('Hola mundo');
    expect(chunks).toContainEqual({ type: 'usage', inputTokens: 21, outputTokens: 4 });
    expect(srv.requests.filter((r) => r.url === '/predictions/p1')).toHaveLength(2);
  }, 10_000);

  it('normalizes HTTP errors on create', async () => {
    const srv = await mockServer((req, res) =>
      req.method === 'GET'
        ? json(res, 200, schemaOf(LLAMA_PROPS))
        : json(res, 422, { detail: 'Input validation failed', status: 422 }),
    );
    close = srv.close;
    await expect(collect(cfgFor(srv.url))).rejects.toMatchObject({
      code: 'bad_request',
      status: 422,
    });
  });

  it('lists the language-models collection as owner/name ids', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/account') return json(res, 200, { type: 'user', username: 'me' });
      json(res, 200, {
        name: 'Language models',
        slug: 'language-models',
        models: [
          { owner: 'meta', name: 'meta-llama-3-70b-instruct', description: 'Llama' },
          { owner: 'openai', name: 'gpt-5', description: 'GPT-5' },
          { owner: 'broken' },
        ],
      });
    });
    close = srv.close;
    const models = await replicate.listModels(cfgFor(srv.url));
    expect(srv.requests[0]!.url).toBe('/collections/language-models');
    expect(models.map((m) => m.id)).toEqual(['meta/meta-llama-3-70b-instruct', 'openai/gpt-5']);
    expect(models[0]).toMatchObject({
      provider: 'replicate',
      kind: 'chat',
      label: 'Llama 3 70B',
      context: 8192,
      capabilities: { tools: false },
    });
    expect(await replicate.testConnection(cfgFor(srv.url))).toEqual({ ok: true, models: 2 });
  });

  it('falls back to the catalog when listing is disabled and reports bad tokens', async () => {
    const models = await replicate.listModels(
      cfgFor('http://127.0.0.1:1', {
        entry: entry({ supports: { ...entry().supports, listModels: false } }),
      }),
    );
    expect(models.map((m) => m.source)).toEqual(['catalog']);
    const srv = await mockServer((_req, res) => json(res, 401, { detail: 'Invalid token.' }));
    close = srv.close;
    expect(await replicate.testConnection(cfgFor(srv.url))).toMatchObject({
      ok: false,
      code: 'auth',
      status: 401,
    });
  });
});
