import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogEntry, ChatChunk, ChatRequest } from '@omni/shared';
import { Secret } from '@omni/security';
import type { ProviderConfig } from '../src/types.js';
import { writer } from '../src/adapters/writer.js';
import { json, mockServer, sse } from '../../../tests/helpers/mock-server.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'writer',
    name: 'Writer (Palmyra)',
    adapter: 'writer',
    baseUrl: 'http://x',
    baseUrlParams: [],
    auth: { type: 'bearer', header: 'Authorization' },
    envVars: ['WRITER_API_KEY'],
    region: 'us',
    category: 'enterprise',
    modelsEndpoint: '/models',
    supports: {
      listModels: true,
      streaming: true,
      tools: true,
      vision: true,
      jsonMode: true,
      embeddings: false,
      fim: false,
    },
    fallbackModels: [{ id: 'palmyra-x6', label: 'Palmyra X6', context: 1_000_000 }],
    status: 'active',
    verifiedAt: null,
    ...over,
  } as CatalogEntry;
}

const cfgFor = (url: string, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  entry: entry(),
  baseUrl: url,
  apiKey: new Secret('writer-test-key-123456'),
  maxRetries: 0,
  ...over,
});

async function collect(cfg: ProviderConfig, req: Partial<ChatRequest> = {}): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of writer.chat(
    cfg,
    {
      model: 'palmyra-x6',
      messages: [
        { role: 'system', content: 'sé breve' },
        { role: 'user', content: 'hola' },
      ],
      ...req,
    },
    new AbortController().signal,
  ))
    out.push(c);
  return out;
}

const text = (chunks: ChatChunk[]) =>
  chunks
    .filter((c) => c.type === 'text')
    .map((c) => (c as { delta: string }).delta)
    .join('');

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  data: {
    id: 'x',
    object: 'chat.completion.chunk',
    model: 'palmyra-x6',
    choices: [{ index: 0, finish_reason: finish, delta: { role: 'assistant', ...delta } }],
  },
});

describe('writer adapter', () => {
  it('streams text and usage from POST /chat with bearer auth', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        chunk({ content: 'Hola' }),
        chunk({ content: ' mundo' }, 'stop'),
        {
          data: {
            choices: [],
            usage: {
              prompt_tokens: 40,
              completion_tokens: 3,
              total_tokens: 43,
              prompt_token_details: { cached_tokens: 8 },
              completion_token_details: { reasoning_tokens: 0 },
            },
          },
        },
        '[DONE]',
      ]),
    );
    close = srv.close;
    const chunks = await collect(cfgFor(srv.url), { maxTokens: 50, temperature: 0.2 });
    expect(text(chunks)).toBe('Hola mundo');
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 40,
      outputTokens: 3,
      cachedTokens: 8,
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
    const r = srv.requests[0]!;
    expect(r.method).toBe('POST');
    expect(r.url).toBe('/chat');
    expect(r.headers.authorization).toBe('Bearer writer-test-key-123456');
    const body = JSON.parse(r.body);
    expect(body).toMatchObject({
      model: 'palmyra-x6',
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 50,
      temperature: 0.2,
    });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sé breve' });
    expect(body.tools).toBeUndefined();
  });

  it('sends function tools and assembles streamed tool calls (split name too)', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        chunk({
          tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_' } }],
        }),
        chunk({ tool_calls: [{ index: 0, function: { name: 'file', arguments: '{"pa' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'th":1}' } }] }),
        chunk({
          tool_calls: [
            { index: 1, id: 'call_b', type: 'function', function: { name: 'ls', arguments: '{}' } },
          ],
        }),
        chunk({}, 'tool_calls'),
        '[DONE]',
      ]),
    );
    close = srv.close;
    const chunks = await collect(cfgFor(srv.url), {
      tools: [{ name: 'read_file', description: 'lee', parameters: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'lee a' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_0', name: 'read_file', arguments: '{}' }],
        },
        { role: 'tool', toolCallId: 'call_0', name: 'read_file', content: 'ok' },
      ],
    });
    const calls = chunks.filter((c) => c.type === 'tool_call');
    expect(calls[0]).toEqual({
      type: 'tool_call',
      id: 'call_a',
      name: 'read_file',
      argsDelta: '{"pa',
    });
    expect(calls[1]).toMatchObject({ id: 'call_a', argsDelta: 'th":1}' });
    expect(calls[2]).toEqual({ type: 'tool_call', id: 'call_b', name: 'ls', argsDelta: '{}' });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'read_file', description: 'lee', parameters: { type: 'object' } },
      },
    ]);
    expect(body.tool_choice).toBe('auto');
    expect(body.messages[1].tool_calls[0]).toEqual({
      id: 'call_0',
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    });
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_0', content: 'ok' });
  });

  it('emits a tool call that never received arguments at the end of the stream', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'now' } }] }, 'tool_calls'),
        '[DONE]',
      ]),
    );
    close = srv.close;
    const chunks = await collect(cfgFor(srv.url));
    expect(chunks.filter((c) => c.type === 'tool_call')).toEqual([
      { type: 'tool_call', id: 'c1', name: 'now', argsDelta: '' },
    ]);
  });

  it('maps images to image_url data URLs and JSON mode to json_schema', async () => {
    const srv = await mockServer((_req, res) => sse(res, [chunk({ content: '{}' }, 'stop')]));
    close = srv.close;
    await collect(cfgFor(srv.url), {
      jsonMode: true,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '¿qué ves?' },
            { type: 'image', mediaType: 'image/png', data: 'AAAA' },
          ],
        },
      ],
    } as Partial<ChatRequest>);
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' },
    });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { schema: { type: 'object' } },
    });
  });

  it('retries without response_format when the model rejects it', async () => {
    const srv = await mockServer((req, res) => {
      if (JSON.parse(req.body).response_format)
        return json(res, 400, {
          errors: [{ description: 'x' }],
          message: 'response_format not supported',
        });
      sse(res, [chunk({ content: 'ok' }, 'stop')]);
    });
    close = srv.close;
    const chunks = await collect(cfgFor(srv.url), { jsonMode: true });
    expect(text(chunks)).toBe('ok');
    expect(srv.requests).toHaveLength(2);
    expect(JSON.parse(srv.requests[1]!.body).response_format).toBeUndefined();
  });

  it('normalizes HTTP errors without leaking the key', async () => {
    const srv = await mockServer((_req, res) =>
      json(res, 401, { message: 'Invalid token writer-test-key-123456' }),
    );
    close = srv.close;
    const err = await collect(cfgFor(srv.url)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'auth', status: 401, provider: 'writer' });
    expect(String((err as Error).message)).not.toContain('writer-test-key-123456');
  });

  it('throws on an in-stream error event', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [chunk({ content: 'a' }), { data: { error: { message: 'boom' } } }]),
    );
    close = srv.close;
    await expect(collect(cfgFor(srv.url))).rejects.toMatchObject({ code: 'server' });
  });

  it('lists models from GET /models ({ models: [{ id, name }] })', async () => {
    const srv = await mockServer((_req, res) =>
      json(res, 200, {
        models: [
          { id: 'palmyra-x6', name: 'Palmyra X6' },
          { id: 'palmyra-x5', name: 'Palmyra X5' },
        ],
      }),
    );
    close = srv.close;
    const models = await writer.listModels(cfgFor(srv.url));
    expect(srv.requests[0]!.url).toBe('/models');
    expect(models.map((m) => m.id)).toEqual(['palmyra-x6', 'palmyra-x5']);
    expect(models[0]).toMatchObject({
      provider: 'writer',
      label: 'Palmyra X6',
      context: 1_000_000,
    });
    expect(await writer.testConnection(cfgFor(srv.url))).toEqual({ ok: true, models: 2 });
  });

  it('falls back to catalog models when listing is disabled', async () => {
    const models = await writer.listModels(
      cfgFor('http://127.0.0.1:1', {
        entry: entry({ supports: { ...entry().supports, listModels: false } }),
      }),
    );
    expect(models.map((m) => [m.id, m.source])).toEqual([['palmyra-x6', 'catalog']]);
  });
});
