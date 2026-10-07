import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogEntry, ChatChunk } from '@omni/shared';
import { Secret } from '@omni/security';
import {
  anthropic,
  getAdapter,
  googleGemini,
  openAiCompatible,
  openAiResponses,
  toAnthropic,
  toGemini,
  toOpenAiMessages,
} from '@omni/providers';
import type { ProviderAdapter, ProviderConfig } from '@omni/providers';
import {
  anthropicStream,
  json,
  mockServer,
  openAiStream,
  sse,
} from '../../../tests/helpers/mock-server.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'mock',
    name: 'Mock',
    adapter: 'openai-compatible',
    baseUrl: 'http://x',
    baseUrlParams: [],
    auth: { type: 'bearer', header: 'Authorization' },
    envVars: [],
    region: 'global',
    category: 'aggregator',
    modelsEndpoint: '/models',
    supports: {
      listModels: true,
      streaming: true,
      tools: true,
      vision: true,
      jsonMode: true,
      embeddings: true,
      fim: true,
    },
    fallbackModels: [{ id: 'fallback-1', label: 'Fallback', context: 1000 }],
    status: 'active',
    verifiedAt: null,
    ...over,
  };
}

async function collect(
  adapter: ProviderAdapter,
  cfg: ProviderConfig,
  opts: { tools?: boolean } = {},
): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of adapter.chat(
    cfg,
    {
      model: 'm1',
      messages: [
        { role: 'system', content: 'sé breve' },
        { role: 'user', content: 'hola' },
      ],
      ...(opts.tools
        ? { tools: [{ name: 'read_file', description: 'lee', parameters: { type: 'object' } }] }
        : {}),
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

describe('openai-compatible', () => {
  it('streams text and usage with bearer auth', async () => {
    const srv = await mockServer((req, res) => sse(res, openAiStream()));
    close = srv.close;
    const chunks = await collect(openAiCompatible, {
      entry: entry(),
      baseUrl: srv.url,
      apiKey: new Secret('test-key-1234567890'),
    });
    expect(text(chunks)).toBe('Hola mundo');
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 12,
      outputTokens: 5,
      cachedTokens: 2,
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
    expect(srv.requests[0]!.headers.authorization).toBe('Bearer test-key-1234567890');
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sé breve' });
  });

  it('assembles streamed tool calls by index', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        {
          data: {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"pa' } },
                  ],
                },
              },
            ],
          },
        },
        {
          data: {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, function: { arguments: 'th":1}' } }] },
                finish_reason: 'tool_calls',
              },
            ],
          },
        },
        '[DONE]',
      ]),
    );
    close = srv.close;
    const chunks = await collect(
      openAiCompatible,
      { entry: entry(), baseUrl: srv.url },
      { tools: true },
    );
    const calls = chunks.filter((c) => c.type === 'tool_call');
    expect(
      calls.every((c) => c.type === 'tool_call' && c.id === 'c1' && c.name === 'read_file'),
    ).toBe(true);
    expect(calls.map((c) => (c as { argsDelta: string }).argsDelta).join('')).toBe('{"path":1}');
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
    expect(JSON.parse(srv.requests[0]!.body).tools[0].function.name).toBe('read_file');
  });

  it('retries without stream_options when a server rejects it', async () => {
    const srv = await mockServer((req, res) => {
      if (JSON.parse(req.body).stream_options)
        return json(res, 400, { error: { message: 'unknown field stream_options' } });
      sse(res, openAiStream('ok'));
    });
    close = srv.close;
    expect(text(await collect(openAiCompatible, { entry: entry(), baseUrl: srv.url }))).toBe('ok');
    expect(srv.requests).toHaveLength(2);
  });

  it('lists models with OpenRouter-style metadata and catalog enrichment', async () => {
    const srv = await mockServer((_req, res) =>
      json(res, 200, {
        data: [
          {
            id: 'a/chat',
            context_length: 128000,
            pricing: { prompt: '0.000003', completion: '0.000015' },
            supported_parameters: ['tools'],
            architecture: { input_modalities: ['text', 'image'] },
          },
          { id: 'text-embedding-3-small' },
          { id: 'fallback-1' },
        ],
      }),
    );
    close = srv.close;
    const models = await openAiCompatible.listModels({ entry: entry(), baseUrl: srv.url });
    const chat = models.find((m) => m.id === 'a/chat')!;
    expect(chat.context).toBe(128000);
    expect(chat.inputPrice).toBe(3);
    expect(chat.outputPrice).toBe(15);
    expect(chat.capabilities.tools).toBe(true);
    expect(chat.capabilities.vision).toBe(true);
    expect(models.find((m) => m.id === 'text-embedding-3-small')!.kind).toBe('embedding');
    expect(models.find((m) => m.id === 'fallback-1')!.context).toBe(1000);
  });

  it('falls back to catalog models when the provider has no listing endpoint', async () => {
    const models = await openAiCompatible.listModels({
      entry: entry({ modelsEndpoint: null }),
      baseUrl: 'http://unused',
    });
    expect(models.map((m) => m.id)).toEqual(['fallback-1']);
    expect(models[0]!.source).toBe('catalog');
  });

  it('supports FIM and embeddings', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url === '/completions')
        return json(res, 200, { choices: [{ text: 'return a + b;' }] });
      json(res, 200, {
        data: [
          { index: 1, embedding: [2] },
          { index: 0, embedding: [1] },
        ],
      });
    });
    close = srv.close;
    const cfg = { entry: entry(), baseUrl: srv.url };
    expect(
      await openAiCompatible.complete!(
        cfg,
        { model: 'c', prefix: 'function add(a, b) {', suffix: '}' },
        new AbortController().signal,
      ),
    ).toBe('return a + b;');
    expect(await openAiCompatible.embed!(cfg, { model: 'e', input: ['x', 'y'] })).toEqual([
      [1],
      [2],
    ]);
  });

  it('testConnection reports failure without throwing', async () => {
    const srv = await mockServer((_req, res) =>
      json(res, 401, { error: { message: 'invalid api key' } }),
    );
    close = srv.close;
    const r = await openAiCompatible.testConnection({ entry: entry(), baseUrl: srv.url });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('401');
  });

  it('maps messages including images and tool results', () => {
    const msgs = toOpenAiMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'mira' },
          { type: 'image', mediaType: 'image/png', data: 'AAA' },
        ],
      },
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'f', arguments: '{}' }] },
      { role: 'tool', toolCallId: 't1', content: 'resultado' },
    ]);
    expect(msgs[0]).toMatchObject({
      content: [
        { type: 'text' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      ],
    });
    expect(msgs[1]).toMatchObject({ content: null, tool_calls: [{ id: 't1', type: 'function' }] });
    expect(msgs[2]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'resultado' });
  });
});

describe('anthropic', () => {
  it('streams text, thinking, tool input and cache-aware usage', async () => {
    const srv = await mockServer((_req, res) => sse(res, anthropicStream()));
    close = srv.close;
    const cfg = {
      entry: entry({
        id: 'anthropic',
        adapter: 'anthropic',
        auth: { type: 'header', header: 'x-api-key' },
      }),
      baseUrl: srv.url,
      apiKey: new Secret('sk-ant-test-0000000000000000'),
    };
    const chunks = await collect(anthropic, cfg, { tools: true });
    expect(text(chunks)).toBe('Hola mundo');
    expect(chunks).toContainEqual({ type: 'reasoning', delta: 'pienso' });
    const args = chunks
      .filter((c) => c.type === 'tool_call')
      .map((c) => (c as { argsDelta: string }).argsDelta)
      .join('');
    expect(JSON.parse(args)).toEqual({ path: 'a.ts' });
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 14,
      outputTokens: 20,
      cachedTokens: 4,
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
    const req = srv.requests[0]!;
    expect(req.url).toBe('/messages');
    expect(req.headers['x-api-key']).toBe('sk-ant-test-0000000000000000');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(req.body);
    expect(body.system).toBe('sé breve');
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.tools[0].input_schema).toEqual({ type: 'object' });
  });

  it('turns mid-stream overloaded errors into retryable server errors', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        {
          event: 'error',
          data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
        },
      ]),
    );
    close = srv.close;
    await expect(
      collect(anthropic, { entry: entry({ adapter: 'anthropic' }), baseUrl: srv.url }),
    ).rejects.toMatchObject({ code: 'server', retryable: true });
  });

  it('paginates the models endpoint and reads context/capabilities', async () => {
    const srv = await mockServer((req, res) => {
      if (!req.url.includes('after_id'))
        return json(res, 200, {
          data: [
            {
              id: 'claude-a',
              display_name: 'A',
              max_input_tokens: 1000000,
              max_tokens: 128000,
              capabilities: { image_input: { supported: true }, thinking: { supported: true } },
            },
          ],
          has_more: true,
          last_id: 'claude-a',
        });
      json(res, 200, { data: [{ id: 'claude-b' }], has_more: false });
    });
    close = srv.close;
    const models = await anthropic.listModels({
      entry: entry({ adapter: 'anthropic' }),
      baseUrl: srv.url,
    });
    expect(models.map((m) => m.id)).toEqual(['claude-a', 'claude-b']);
    expect(models[0]).toMatchObject({
      context: 1000000,
      maxOutput: 128000,
      capabilities: { vision: true, reasoning: true },
    });
  });

  it('merges consecutive roles and maps tool results to user blocks', () => {
    const { system, messages } = toAnthropic([
      { role: 'system', content: 's' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'f', arguments: '{"x":1}' }] },
      { role: 'tool', toolCallId: 't', content: 'r', isError: true },
      { role: 'user', content: 'b' },
    ]);
    expect(system).toBe('s');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1]!.content[0]).toEqual({
      type: 'tool_use',
      id: 't',
      name: 'f',
      input: { x: 1 },
    });
    expect(messages[2]!.content).toHaveLength(2);
    expect(messages[2]!.content[0]).toMatchObject({ type: 'tool_result', is_error: true });
  });
});

describe('google-gemini', () => {
  it('streams via streamGenerateContent with x-goog-api-key', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        { data: { candidates: [{ content: { parts: [{ text: 'razono', thought: true }] } }] } },
        { data: { candidates: [{ content: { parts: [{ text: 'Hola ' }] } }] } },
        {
          data: {
            candidates: [{ content: { parts: [{ text: 'mundo' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 2 },
          },
        },
      ]),
    );
    close = srv.close;
    const cfg = {
      entry: entry({
        adapter: 'google-gemini',
        auth: { type: 'header', header: 'x-goog-api-key' },
      }),
      baseUrl: srv.url,
      apiKey: new Secret('AIza-test-key-000000000000'),
    };
    const chunks = await collect(googleGemini, cfg);
    expect(text(chunks)).toBe('Hola mundo');
    expect(chunks).toContainEqual({ type: 'reasoning', delta: 'razono' });
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 7,
      outputTokens: 5,
      cachedTokens: undefined,
    });
    expect(srv.requests[0]!.url).toBe('/models/m1:streamGenerateContent?alt=sse');
    expect(srv.requests[0]!.headers['x-goog-api-key']).toBe('AIza-test-key-000000000000');
    expect(JSON.parse(srv.requests[0]!.body).systemInstruction.parts[0].text).toBe('sé breve');
  });

  it('emits complete function calls and lists models', async () => {
    const srv = await mockServer((req, res) => {
      if (req.url.startsWith('/models?')) {
        return json(res, 200, {
          models: [
            {
              name: 'models/gemini-x',
              inputTokenLimit: 1048576,
              supportedGenerationMethods: ['generateContent'],
            },
            { name: 'models/embed-y', supportedGenerationMethods: ['embedContent'] },
          ],
        });
      }
      sse(res, [
        {
          data: {
            candidates: [
              {
                content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'a' } } }] },
                finishReason: 'STOP',
              },
            ],
          },
        },
      ]);
    });
    close = srv.close;
    const cfg = { entry: entry({ adapter: 'google-gemini' }), baseUrl: srv.url };
    const chunks = await collect(googleGemini, cfg, { tools: true });
    expect(chunks).toContainEqual({
      type: 'tool_call',
      id: 'call_0',
      name: 'read_file',
      argsDelta: '{"path":"a"}',
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
    const models = await googleGemini.listModels(cfg);
    expect(models.map((m) => [m.id, m.kind])).toEqual([
      ['gemini-x', 'chat'],
      ['embed-y', 'embedding'],
    ]);
  });

  it('maps tool results to functionResponse with the original name', () => {
    const { contents } = toGemini([
      { role: 'user', content: 'x' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'grep', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c', content: 'ok' },
    ]);
    expect(contents[2]!.parts[0]).toEqual({
      functionResponse: { id: 'c', name: 'grep', response: { content: 'ok' } },
    });
  });
});

describe('openai-responses', () => {
  it('streams output text, function calls and usage', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        { data: { type: 'response.reasoning_summary_text.delta', delta: 'plan' } },
        { data: { type: 'response.output_text.delta', delta: 'Hola mundo' } },
        {
          data: {
            type: 'response.output_item.added',
            output_index: 1,
            item: { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'read_file' },
          },
        },
        {
          data: {
            type: 'response.function_call_arguments.delta',
            output_index: 1,
            delta: '{"p":1}',
          },
        },
        {
          data: {
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: 9,
                output_tokens: 4,
                input_tokens_details: { cached_tokens: 3 },
              },
            },
          },
        },
      ]),
    );
    close = srv.close;
    const chunks = await collect(
      openAiResponses,
      { entry: entry({ adapter: 'openai-responses' }), baseUrl: srv.url },
      { tools: true },
    );
    expect(text(chunks)).toBe('Hola mundo');
    expect(chunks).toContainEqual({ type: 'reasoning', delta: 'plan' });
    expect(chunks).toContainEqual({
      type: 'tool_call',
      id: 'call_9',
      name: 'read_file',
      argsDelta: '{"p":1}',
    });
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 9,
      outputTokens: 4,
      cachedTokens: 3,
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
    const body = JSON.parse(srv.requests[0]!.body);
    expect(srv.requests[0]!.url).toBe('/responses');
    expect(body.instructions).toBe('sé breve');
    expect(body.store).toBe(false);
    expect(body.tools[0]).toMatchObject({ type: 'function', name: 'read_file' });
  });

  it('raises response.failed as an error', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [{ data: { type: 'response.failed', response: { error: { message: 'boom' } } } }]),
    );
    close = srv.close;
    await expect(
      collect(openAiResponses, { entry: entry({ adapter: 'openai-responses' }), baseUrl: srv.url }),
    ).rejects.toThrow('boom');
  });
});

describe('registry', () => {
  it('maps OpenAI-wire families to the compatible adapter and rejects bedrock until Phase 3', () => {
    expect(getAdapter('azure-openai')).toBe(openAiCompatible);
    expect(getAdapter('cohere')).toBe(openAiCompatible);
    expect(() => getAdapter('aws-bedrock')).toThrow(/Phase 3/);
  });
});

describe('provider-native replay (tool loops keep reasoning)', () => {
  it('anthropic emits raw blocks with thinking signatures and replays them verbatim', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        {
          event: 'message_start',
          data: { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'sig123' },
          },
        },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 't1', name: 'ls', input: {} },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"p":1}' },
          },
        },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 3 },
          },
        },
      ]),
    );
    close = srv.close;
    const chunks = await collect(anthropic, {
      entry: entry({ adapter: 'anthropic' }),
      baseUrl: srv.url,
    });
    const raw = chunks.find((c) => c.type === 'raw') as { adapter: string; content: unknown[] };
    expect(raw.adapter).toBe('anthropic');
    expect(raw.content).toEqual([
      { type: 'thinking', thinking: '', signature: 'sig123' },
      { type: 'tool_use', id: 't1', name: 'ls', input: { p: 1 } },
    ]);
    const { messages } = toAnthropic([
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'ls', arguments: '{"p":1}' }],
        raw: { adapter: 'anthropic', content: raw.content },
      },
      { role: 'tool', toolCallId: 't1', content: 'ok' },
    ]);
    expect(messages[1]!.content).toEqual(raw.content);
    // Another adapter's raw content is ignored.
    const other = toAnthropic([
      {
        role: 'assistant',
        content: 'hi',
        raw: { adapter: 'google-gemini', content: [{ text: 'x' }] },
      },
    ]);
    expect(other.messages[0]!.content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('gemini replays parts (thought signatures) and omits synthesized call ids', () => {
    const { contents } = toGemini([
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_0', name: 'ls', arguments: '{}' }],
        raw: {
          adapter: 'google-gemini',
          content: [{ functionCall: { name: 'ls', args: {} }, thoughtSignature: 'abc' }],
        },
      },
      { role: 'tool', toolCallId: 'call_0', content: 'ok' },
    ]);
    expect(contents[1]!.parts[0]).toEqual({
      functionCall: { name: 'ls', args: {} },
      thoughtSignature: 'abc',
    });
    expect(contents[2]!.parts[0]).toEqual({
      functionResponse: { name: 'ls', response: { content: 'ok' } },
    });
  });
});
