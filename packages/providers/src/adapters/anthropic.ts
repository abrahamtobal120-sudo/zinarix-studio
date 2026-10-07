import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatMessage, ChatRequest, ModelInfo } from '@omni/shared';
import { request, requestJson } from '../http.js';
import { baseModel } from '../models.js';
import { parseSse, safeJson } from '../sse.js';
import type { ProviderAdapter, ProviderConfig } from '../types.js';
import { normalizeStop, testViaModelsOrChat } from './openai-compatible.js';

const VERSION_HEADERS = { 'anthropic-version': '2023-06-01' };
const DEFAULT_MAX_TOKENS = 32_000;

type Block = Record<string, unknown>;
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

function parseArgs(json: string): unknown {
  try {
    return JSON.parse(json || '{}');
  } catch {
    return {};
  }
}

/** Normalized history -> Messages API (system split out, tool results as user blocks, roles merged). */
export function toAnthropic(messages: ChatMessage[]): {
  system?: string;
  messages: AnthropicMessage[];
} {
  const system: string[] = [];
  const out: AnthropicMessage[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        system.push(m.content);
        break;
      case 'user':
        push(
          'user',
          typeof m.content === 'string'
            ? [{ type: 'text', text: m.content }]
            : m.content.map((p) =>
                p.type === 'text'
                  ? { type: 'text', text: p.text }
                  : {
                      type: 'image',
                      source: { type: 'base64', media_type: p.mediaType, data: p.data },
                    },
              ),
        );
        break;
      case 'assistant':
        if (m.raw?.adapter === 'anthropic' && Array.isArray(m.raw.content)) {
          push('assistant', m.raw.content as Block[]);
          break;
        }
        push('assistant', [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...(m.toolCalls ?? []).map((c) => ({
            type: 'tool_use',
            id: c.id,
            name: c.name,
            input: parseArgs(c.arguments),
          })),
        ]);
        break;
      case 'tool':
        push('user', [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: m.content,
            ...(m.isError ? { is_error: true } : {}),
          },
        ]);
        break;
    }
  }
  return { system: system.length ? system.join('\n\n') : undefined, messages: out };
}

function buildBody(req: ChatRequest, maxTokens: number): Record<string, unknown> {
  const { system, messages } = toAnthropic(req.messages);
  return {
    model: req.model,
    max_tokens: maxTokens,
    messages,
    stream: true,
    ...(system ? { system } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    // Current models think adaptively by default; when the caller asks for reasoning we
    // raise effort and request readable summaries so the UI can stream them.
    ...(req.reasoning
      ? {
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: req.reasoning },
        }
      : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }
      : {}),
  };
}

interface AnthropicEvent {
  type?: string;
  index?: number;
  message?: { usage?: Usage };
  content_block?: Record<string, unknown> & { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    signature?: string;
    stop_reason?: string;
  };
  usage?: Usage;
  error?: { type?: string; message?: string };
}
interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

async function* chat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  let res: Response;
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  try {
    res = await request(cfg, {
      method: 'POST',
      path: '/messages',
      headers: VERSION_HEADERS,
      body: buildBody(req, maxTokens),
      signal,
    });
  } catch (e) {
    // Older models have smaller output caps: retry once with a conservative value.
    if (
      !req.maxTokens &&
      e instanceof OmniError &&
      e.code === 'bad_request' &&
      /max_tokens/.test(e.message)
    ) {
      res = await request(cfg, {
        method: 'POST',
        path: '/messages',
        headers: VERSION_HEADERS,
        body: buildBody(req, 8192),
        signal,
      });
    } else throw e;
  }

  const tools = new Map<number, { id: string; name: string }>();
  // Full content blocks, kept so the turn can be replayed (thinking signatures included).
  const blocks: Record<string, unknown>[] = [];
  const partialJson = new Map<number, string>();
  let input = 0;
  let cached = 0;
  let output = 0;
  let stop: string | undefined;
  for await (const ev of parseSse(res.body, {
    signal,
    idleTimeoutMs: cfg.idleTimeoutMs,
    provider: cfg.entry.id,
  })) {
    const e = safeJson<AnthropicEvent>(ev.data);
    if (!e?.type) continue;
    switch (e.type) {
      case 'message_start': {
        const u = e.message?.usage ?? {};
        cached = u.cache_read_input_tokens ?? 0;
        input = (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0);
        output = u.output_tokens ?? 0;
        break;
      }
      case 'content_block_start':
        if (e.content_block) blocks[e.index ?? 0] = { ...e.content_block };
        if (e.content_block?.type === 'tool_use') {
          const call = {
            id: e.content_block.id ?? `toolu_${e.index}`,
            name: e.content_block.name ?? '',
          };
          tools.set(e.index ?? 0, call);
          yield { type: 'tool_call', id: call.id, name: call.name, argsDelta: '' };
        }
        break;
      case 'content_block_delta': {
        const d = e.delta;
        const block = blocks[e.index ?? 0];
        if (block && d) {
          if (d.type === 'text_delta') block.text = String(block.text ?? '') + (d.text ?? '');
          if (d.type === 'thinking_delta')
            block.thinking = String(block.thinking ?? '') + (d.thinking ?? '');
          if (d.type === 'signature_delta') block.signature = d.signature;
          if (d.type === 'input_json_delta')
            partialJson.set(
              e.index ?? 0,
              (partialJson.get(e.index ?? 0) ?? '') + (d.partial_json ?? ''),
            );
        }
        if (d?.type === 'text_delta' && d.text) yield { type: 'text', delta: d.text };
        else if (d?.type === 'thinking_delta' && d.thinking)
          yield { type: 'reasoning', delta: d.thinking };
        else if (d?.type === 'input_json_delta' && d.partial_json) {
          const call = tools.get(e.index ?? 0);
          if (call)
            yield { type: 'tool_call', id: call.id, name: call.name, argsDelta: d.partial_json };
        }
        break;
      }
      case 'message_delta':
        if (e.delta?.stop_reason) stop = e.delta.stop_reason;
        if (e.usage?.output_tokens !== undefined) output = e.usage.output_tokens;
        break;
      case 'error': {
        const type = e.error?.type ?? '';
        const code =
          type === 'overloaded_error' || type === 'api_error'
            ? 'server'
            : type === 'rate_limit_error'
              ? 'rate_limit'
              : 'bad_request';
        throw new OmniError(code, e.error?.message ?? 'stream error', { provider: cfg.entry.id });
      }
    }
  }
  for (const [i, json] of partialJson) {
    const block = blocks[i];
    if (block) block.input = parseArgs(json);
  }
  const content = blocks.filter(Boolean);
  if (content.length) yield { type: 'raw', adapter: 'anthropic', content };
  yield { type: 'usage', inputTokens: input, outputTokens: output, cachedTokens: cached };
  yield { type: 'done', stopReason: normalizeStop(stop) };
}

interface AnthropicModel {
  id: string;
  display_name?: string;
  max_input_tokens?: number;
  max_tokens?: number;
  capabilities?: {
    image_input?: { supported?: boolean };
    thinking?: { supported?: boolean };
  };
}

async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const json = await requestJson<{
      data?: AnthropicModel[];
      has_more?: boolean;
      last_id?: string;
    }>(cfg, {
      path: '/models',
      headers: VERSION_HEADERS,
      query: { limit: '1000', ...(after ? { after_id: after } : {}) },
      signal,
    });
    for (const m of json.data ?? []) {
      out.push(
        baseModel(cfg.entry, m.id, {
          label: m.display_name,
          context: m.max_input_tokens,
          maxOutput: m.max_tokens,
          capabilities: {
            tools: true,
            vision: m.capabilities?.image_input?.supported ?? true,
            reasoning: m.capabilities?.thinking?.supported ?? null,
            fim: false,
          },
        }),
      );
    }
    if (!json.has_more || !json.last_id) break;
    after = json.last_id;
  }
  return out;
}

export const anthropic: ProviderAdapter = {
  id: 'anthropic',
  listModels,
  chat,
  testConnection(cfg) {
    return testViaModelsOrChat(anthropic, cfg);
  },
};
