import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogEntry, ChatChunk, ChatRequest } from '@omni/shared';
import {
  clearOllamaCache,
  estimateOllamaTokens,
  ollamaRoot,
  openAiCompatible,
  pickNumCtx,
  toOllamaMessages,
} from '@omni/providers';
import type { ProviderConfig } from '@omni/providers';
import type { ServerResponse } from 'node:http';
import { json, mockServer, openAiStream, sse } from '../../../tests/helpers/mock-server.js';

let close: (() => Promise<void>) | undefined;
beforeEach(() => {
  clearOllamaCache();
  delete process.env.ZINARIX_OLLAMA_CTX;
});
afterEach(async () => {
  await close?.();
  close = undefined;
  delete process.env.ZINARIX_OLLAMA_CTX;
});

const entry = (): CatalogEntry =>
  ({
    id: 'ollama',
    name: 'Ollama (local)',
    adapter: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    baseUrlParams: [],
    auth: { type: 'none', optional: true },
    envVars: [],
    region: 'local',
    category: 'local',
    modelsEndpoint: '/models',
    supports: {
      listModels: true,
      streaming: true,
      tools: true,
      vision: true,
      jsonMode: true,
      embeddings: true,
      fim: false,
    },
    fallbackModels: [],
    status: 'active',
    verifiedAt: null,
  }) as CatalogEntry;

const cfgFor = (url: string): ProviderConfig => ({
  entry: entry(),
  baseUrl: `${url}/v1`,
  maxRetries: 0,
});

async function collect(cfg: ProviderConfig, req: Partial<ChatRequest> = {}): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of openAiCompatible.chat(
    cfg,
    { model: 'qwen', messages: [{ role: 'user', content: 'hola' }], ...req },
    new AbortController().signal,
  ))
    out.push(c);
  return out;
}

function ndjson(res: ServerResponse, lines: unknown[]): void {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  for (const l of lines) res.write(`${JSON.stringify(l)}\n`);
  res.end();
}

const show = (ctx: number) => ({
  model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': ctx },
});

describe('ollama: native API so the context size can be set', () => {
  it('chats through /api/chat with num_ctx and maps text, usage and the stop reason', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/api/show') return json(res, 200, show(32768));
      return ndjson(res, [
        { message: { role: 'assistant', content: 'Hola' } },
        { message: { role: 'assistant', content: ' mundo' } },
        {
          message: { content: '' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 21,
          eval_count: 3,
        },
      ]);
    });
    close = srv.close;
    const chunks = await collect(cfgFor(srv.url), { maxTokens: 100, temperature: 0 });
    expect(chunks).toEqual([
      { type: 'text', delta: 'Hola' },
      { type: 'text', delta: ' mundo' },
      { type: 'usage', inputTokens: 21, outputTokens: 3 },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const chat = srv.requests.find((r) => r.url === '/api/chat');
    expect(chat).toBeDefined();
    const body = JSON.parse(chat!.body) as { options: Record<string, number>; stream: boolean };
    expect(body.stream).toBe(true);
    expect(body.options).toEqual({ num_ctx: 8192, num_predict: 100, temperature: 0 });
  });

  it('asks for a bigger window when the conversation is long, up to the model limit', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/api/show') return json(res, 200, show(16384));
      return ndjson(res, [{ message: { content: 'ok' }, done: true, done_reason: 'stop' }]);
    });
    close = srv.close;
    const ctxOf = (i: number) =>
      (
        JSON.parse(srv.requests.filter((r) => r.url === '/api/chat')[i]!.body) as {
          options: { num_ctx: number };
        }
      ).options.num_ctx;
    await collect(cfgFor(srv.url), { messages: [{ role: 'user', content: 'x'.repeat(20_000) }] });
    expect(ctxOf(0)).toBe(16384);
    // Would need 32768, but the model was trained with 16384.
    await collect(cfgFor(srv.url), { messages: [{ role: 'user', content: 'x'.repeat(80_000) }] });
    expect(ctxOf(1)).toBe(16384);
    // A short request afterwards keeps the window: shrinking would reload the model.
    await collect(cfgFor(srv.url));
    expect(ctxOf(2)).toBe(16384);
    // The model's limit is asked once, not on every request.
    expect(srv.requests.filter((r) => r.url === '/api/show')).toHaveLength(1);
  });

  it('maps native tool calls (arguments as an object) and reports tool_use', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/api/show') return json(res, 200, show(32768));
      return ndjson(res, [
        {
          message: {
            content: '',
            tool_calls: [
              { function: { name: 'read_file', arguments: { path: 'a.js' } } },
              { id: 'call_x', function: { name: 'list_dir', arguments: {} } },
            ],
          },
        },
        {
          message: { content: '' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 5,
          eval_count: 9,
        },
      ]);
    });
    close = srv.close;
    const chunks = await collect(cfgFor(srv.url), {
      tools: [{ name: 'read_file', description: 'lee', parameters: { type: 'object' } }],
    });
    const calls = chunks.filter((c) => c.type === 'tool_call') as Extract<
      ChatChunk,
      { type: 'tool_call' }
    >[];
    expect(calls.map((c) => [c.name, c.argsDelta])).toEqual([
      ['read_file', '{"path":"a.js"}'],
      ['list_dir', '{}'],
    ]);
    expect(calls[1]!.id).toBe('call_x');
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('reports a cut reply as max_tokens and an in-stream error as an error', async () => {
    let fail = false;
    const srv = await mockServer((req, res) => {
      if (req.url === '/api/show') return json(res, 200, show(8192));
      return ndjson(
        res,
        fail
          ? [{ error: 'model runner has unexpectedly stopped' }]
          : [{ message: { content: 'a' }, done: true, done_reason: 'length' }],
      );
    });
    close = srv.close;
    expect((await collect(cfgFor(srv.url))).at(-1)).toEqual({
      type: 'done',
      stopReason: 'max_tokens',
    });
    fail = true;
    await expect(collect(cfgFor(srv.url))).rejects.toThrow(/unexpectedly stopped/);
  });

  it('falls back to /v1 when the server has no native API', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      return sse(res, openAiStream('Hola'));
    });
    close = srv.close;
    const chunks = await collect(cfgFor(srv.url));
    expect(chunks.some((c) => c.type === 'text')).toBe(true);
    expect(srv.requests.some((r) => r.url === '/v1/chat/completions')).toBe(true);
  });

  it('does not fall back when the model is the thing that is missing', async () => {
    const srv = await mockServer((_req, res) =>
      json(res, 404, { error: 'model "nope" not found, try pulling it first' }),
    );
    close = srv.close;
    await expect(collect(cfgFor(srv.url), { model: 'nope' })).rejects.toThrow(/not found/);
    expect(srv.requests.some((r) => r.url === '/v1/chat/completions')).toBe(false);
  });

  it('lists models with the window Zinarix will really use', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/api/show') {
        const { model } = JSON.parse(req.body) as { model: string };
        return json(res, 200, show(model === 'small' ? 8192 : 131072));
      }
      return json(res, 200, { data: [{ id: 'small' }, { id: 'big' }] });
    });
    close = srv.close;
    const models = await openAiCompatible.listModels(cfgFor(srv.url));
    expect(models.map((m) => [m.id, m.context])).toEqual([
      ['small', 8192],
      ['big', 32768],
    ]);
  });
});

describe('ollama: dropped context is an error, not a wrong answer', () => {
  it('fails when Ollama read far fewer tokens than were sent', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/api/show') return json(res, 200, show(8192));
      if (req.url === '/api/ps') return json(res, 200, { models: [] });
      return ndjson(res, [
        { message: { content: 'No sé' } },
        { message: { content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 43 },
      ]);
    });
    close = srv.close;
    await expect(
      collect(cfgFor(srv.url), { messages: [{ role: 'user', content: 'x'.repeat(60_000) }] }),
    ).rejects.toThrow(/dropped part of the conversation.*8192-token/);
    // A normal count for the same text passes.
    await close();
    const ok = await mockServer((req, res) => {
      if (req.url === '/api/show') return json(res, 200, show(32768));
      if (req.url === '/api/ps') return json(res, 200, { models: [] });
      return ndjson(res, [{ message: { content: 'ok' }, done: true, prompt_eval_count: 15000 }]);
    });
    close = ok.close;
    const chunks = await collect(cfgFor(ok.url), {
      messages: [{ role: 'user', content: 'x'.repeat(60_000) }],
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('keeps the window the model is already loaded with', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/api/show') return json(res, 200, show(32768));
      if (req.url === '/api/ps')
        return json(res, 200, { models: [{ name: 'qwen', model: 'qwen', context_length: 16384 }] });
      return ndjson(res, [{ message: { content: 'ok' }, done: true }]);
    });
    close = srv.close;
    await collect(cfgFor(srv.url));
    const body = JSON.parse(srv.requests.find((r) => r.url === '/api/chat')!.body) as {
      options: { num_ctx: number };
    };
    expect(body.options.num_ctx).toBe(16384);
  });
});

describe('ollama helpers', () => {
  it('ollamaRoot strips the /v1 suffix', () => {
    expect(ollamaRoot('http://localhost:11434/v1')).toBe('http://localhost:11434');
    expect(ollamaRoot('http://host:1/v1/')).toBe('http://host:1');
    expect(ollamaRoot('http://host:1')).toBe('http://host:1');
  });

  it('pickNumCtx honours ZINARIX_OLLAMA_CTX and never passes the model limit', () => {
    expect(pickNumCtx('a', 100, null)).toBe(8192);
    expect(pickNumCtx('b', 9000, 4096)).toBe(4096);
    expect(pickNumCtx('c', 500_000, null)).toBe(32768);
    process.env.ZINARIX_OLLAMA_CTX = '65536';
    expect(pickNumCtx('d', 100, 131072)).toBe(65536);
    expect(pickNumCtx('e', 100, 16384)).toBe(16384);
  });

  it('estimates tools and tool calls, not only the text', () => {
    const base: ChatRequest = {
      model: 'm',
      messages: [{ role: 'user', content: 'x'.repeat(300) }],
    };
    const small = estimateOllamaTokens(base);
    const big = estimateOllamaTokens({
      ...base,
      tools: [{ name: 't', description: 'd'.repeat(3000), parameters: { type: 'object' } }],
    });
    expect(small).toBe(150 + 2048);
    expect(big).toBeGreaterThan(small + 900);
  });

  it('toOllamaMessages sends images apart, parsed tool arguments and the tool name', () => {
    const out = toOllamaMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'mira' },
          { type: 'image', mediaType: 'image/png', data: 'AAAA' },
        ],
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a"}' }],
      },
      { role: 'tool', toolCallId: 'c1', content: 'contenido' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'mira', images: ['AAAA'] },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a' } } }],
      },
      { role: 'tool', content: 'contenido', tool_name: 'read_file' },
    ]);
  });
});
