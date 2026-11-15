/**
 * Phase 9 acceptance (wire side): one JSON Schema reaches three different providers in each
 * one's own structured-output format, and the streamed reply comes back as the JSON text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogEntry, ChatChunk, ChatRequest } from '@omni/shared';
import { Secret } from '@omni/security';
import { anthropic, googleGemini, openAiCompatible } from '@omni/providers';
import type { ProviderAdapter, ProviderConfig } from '@omni/providers';
import {
  anthropicStream,
  mockServer,
  openAiStream,
  sse,
} from '../../../tests/helpers/mock-server.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    done: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'done', 'tags'],
  additionalProperties: false,
};
const REPLY = JSON.stringify({ title: 'Comprar pan', done: false, tags: ['casa'] });

function cfg(url: string, over: Partial<CatalogEntry>): ProviderConfig {
  return {
    entry: {
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
        embeddings: false,
        fim: false,
      },
      fallbackModels: [],
      status: 'active',
      verifiedAt: null,
      ...over,
    },
    baseUrl: url,
    apiKey: new Secret('test-key-000000000000000000'),
  };
}

async function run(
  adapter: ProviderAdapter,
  c: ProviderConfig,
  over: Partial<ChatRequest> = {},
): Promise<string> {
  const out: ChatChunk[] = [];
  for await (const ch of adapter.chat(
    c,
    {
      model: 'm1',
      messages: [{ role: 'user', content: 'Dame una tarea de ejemplo' }],
      jsonMode: true,
      jsonSchema: { name: 'response', schema: SCHEMA, strict: true },
      temperature: 0.2,
      topP: 0.9,
      ...over,
    },
    new AbortController().signal,
  ))
    out.push(ch);
  const err = out.find((x) => x.type === 'error');
  if (err) throw new Error(JSON.stringify(err));
  return out
    .filter((x) => x.type === 'text')
    .map((x) => (x as { delta: string }).delta)
    .join('');
}

describe('JSON Schema on three providers', () => {
  it('openai-compatible sends response_format json_schema (strict)', async () => {
    const srv = await mockServer((_req, res) => sse(res, openAiStream(REPLY)));
    close = srv.close;
    const text = await run(openAiCompatible, cfg(srv.url, {}));
    expect(JSON.parse(text)).toEqual(JSON.parse(REPLY));
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', schema: SCHEMA, strict: true },
    });
    expect(body.temperature).toBe(0.2);
    expect(body.top_p).toBe(0.9);
  });

  it('anthropic sends output_config.format json_schema', async () => {
    const srv = await mockServer((_req, res) => sse(res, anthropicStream(REPLY)));
    close = srv.close;
    const text = await run(
      anthropic,
      cfg(srv.url, {
        id: 'anthropic',
        adapter: 'anthropic',
        auth: { type: 'header', header: 'x-api-key' },
      }),
    );
    expect(JSON.parse(text)).toEqual(JSON.parse(REPLY));
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: SCHEMA } });
  });

  it('gemini sends responseMimeType + responseJsonSchema', async () => {
    const srv = await mockServer((_req, res) =>
      sse(res, [
        { data: { candidates: [{ content: { parts: [{ text: REPLY.slice(0, 10) }] } }] } },
        {
          data: {
            candidates: [{ content: { parts: [{ text: REPLY.slice(10) }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 9 },
          },
        },
      ]),
    );
    close = srv.close;
    const text = await run(
      googleGemini,
      cfg(srv.url, {
        adapter: 'google-gemini',
        auth: { type: 'header', header: 'x-goog-api-key' },
      }),
    );
    expect(JSON.parse(text)).toEqual(JSON.parse(REPLY));
    const gc = JSON.parse(srv.requests[0]!.body).generationConfig;
    expect(gc.responseMimeType).toBe('application/json');
    expect(gc.responseJsonSchema).toEqual(SCHEMA);
    expect(gc.topP).toBe(0.9);
  });
});

describe('Anthropic: only what each Claude model accepts', () => {
  const claude = (url: string) =>
    cfg(url, {
      id: 'anthropic',
      adapter: 'anthropic',
      auth: { type: 'header', header: 'x-api-key' },
    });

  it('Claude 5: no sampling knobs, schema made acceptable, adaptive thinking + effort', async () => {
    const srv = await mockServer((_req, res) => sse(res, anthropicStream(REPLY)));
    close = srv.close;
    const loose = {
      type: 'object',
      properties: { title: { type: 'string', minLength: 3 }, n: { type: 'integer', minimum: 0 } },
      required: ['title'],
    };
    await run(anthropic, claude(srv.url), {
      model: 'claude-opus-5-5',
      reasoning: 'high',
      jsonSchema: { name: 'response', schema: loose },
    });
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config.effort).toBe('high');
    expect(body.output_config.format.schema).toEqual({
      type: 'object',
      properties: { title: { type: 'string' }, n: { type: 'integer' } },
      required: ['title'],
      additionalProperties: false,
    });
    // The caller's schema object is untouched.
    expect(loose.properties.title.minLength).toBe(3);
  });

  it('Claude Haiku 4.5 with reasoning: budget_tokens, no effort, sampling dropped', async () => {
    const srv = await mockServer((_req, res) => sse(res, anthropicStream(REPLY)));
    close = srv.close;
    await run(anthropic, claude(srv.url), {
      model: 'claude-haiku-4-5',
      reasoning: 'medium',
      maxTokens: 16000,
      jsonSchema: undefined,
      jsonMode: false,
    });
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(body.output_config).toBeUndefined();
    expect(body.temperature).toBeUndefined(); // 0.2 is not 1 with thinking on
    expect(body.top_p).toBeUndefined(); // 0.9 < 0.95 with thinking on
  });

  it('Claude Sonnet 4.6 without reasoning: temperature kept, top_p dropped', async () => {
    const srv = await mockServer((_req, res) => sse(res, anthropicStream(REPLY)));
    close = srv.close;
    await run(anthropic, claude(srv.url), { model: 'claude-sonnet-4-6' });
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.temperature).toBe(0.2);
    expect(body.top_p).toBeUndefined();
  });

  it('a non-Claude model behind the Anthropic API passes through unchanged', async () => {
    const srv = await mockServer((_req, res) => sse(res, anthropicStream(REPLY)));
    close = srv.close;
    await run(anthropic, claude(srv.url), { model: 'kimi-k2' });
    const body = JSON.parse(srv.requests[0]!.body);
    expect(body.temperature).toBe(0.2);
    expect(body.top_p).toBe(0.9);
    expect(body.output_config.format.schema).toEqual(SCHEMA);
  });
});
