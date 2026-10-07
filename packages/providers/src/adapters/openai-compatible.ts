import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatMessage, ChatRequest, ModelInfo } from '@omni/shared';
import { request, requestJson } from '../http.js';
import { baseModel, catalogModels } from '../models.js';
import { parseSse, safeJson } from '../sse.js';
import type { ConnectionTest, ProviderAdapter, ProviderConfig } from '../types.js';

type OaiMessage = Record<string, unknown>;

export function toOpenAiMessages(messages: ChatMessage[]): OaiMessage[] {
  return messages.map((m): OaiMessage => {
    switch (m.role) {
      case 'system':
        return { role: 'system', content: m.content };
      case 'user':
        if (typeof m.content === 'string') return { role: 'user', content: m.content };
        return {
          role: 'user',
          content: m.content.map((p) =>
            p.type === 'text'
              ? { type: 'text', text: p.text }
              : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.data}` } },
          ),
        };
      case 'assistant':
        return {
          role: 'assistant',
          content: m.content || null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
        };
      case 'tool':
        return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
  });
}

export function normalizeStop(reason: string | null | undefined): string {
  switch (reason) {
    case 'stop':
    case 'end_turn':
    case 'STOP':
      return 'end_turn';
    case 'length':
    case 'max_tokens':
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
    case 'tool_use':
      return 'tool_use';
    case 'content_filter':
    case 'SAFETY':
    case 'refusal':
      return 'refusal';
    default:
      return reason ?? 'end_turn';
  }
}

interface OaiDelta {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

interface OaiChunk {
  choices?: { delta?: OaiDelta; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
  error?: { message?: string; code?: string | number };
}

function buildBody(req: ChatRequest, withUsage: boolean): Record<string, unknown> {
  return {
    model: req.model,
    messages: toOpenAiMessages(req.messages),
    stream: true,
    ...(withUsage ? { stream_options: { include_usage: true } } : {}),
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.reasoning ? { reasoning_effort: req.reasoning } : {}),
    ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
  };
}

async function* chat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  let res: Response;
  try {
    res = await request(cfg, {
      method: 'POST',
      path: '/chat/completions',
      body: buildBody(req, true),
      signal,
    });
  } catch (e) {
    // Some OpenAI-compatible servers reject stream_options; retry once without it.
    if (
      e instanceof OmniError &&
      e.code === 'bad_request' &&
      /stream_options|include_usage/i.test(e.message)
    ) {
      res = await request(cfg, {
        method: 'POST',
        path: '/chat/completions',
        body: buildBody(req, false),
        signal,
      });
    } else throw e;
  }

  const toolIds = new Map<number, { id: string; name: string }>();
  let stop: string | undefined;
  for await (const ev of parseSse(res.body, {
    signal,
    idleTimeoutMs: cfg.idleTimeoutMs,
    provider: cfg.entry.id,
  })) {
    if (ev.data === '[DONE]') break;
    const chunk = safeJson<OaiChunk>(ev.data);
    if (!chunk) continue;
    if (chunk.error) {
      throw new OmniError('server', String(chunk.error.message ?? 'stream error'), {
        provider: cfg.entry.id,
      });
    }
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (delta) {
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) yield { type: 'reasoning', delta: reasoning };
      if (delta.content) yield { type: 'text', delta: delta.content };
      for (const tc of delta.tool_calls ?? []) {
        const index = tc.index ?? 0;
        let known = toolIds.get(index);
        if (!known || (tc.id && tc.id !== known.id)) {
          known = { id: tc.id ?? `call_${index}`, name: tc.function?.name ?? '' };
          toolIds.set(index, known);
        }
        yield {
          type: 'tool_call',
          id: known.id,
          name: known.name,
          argsDelta: tc.function?.arguments ?? '',
        };
      }
    }
    if (choice?.finish_reason) stop = choice.finish_reason;
    if (chunk.usage) {
      yield {
        type: 'usage',
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
      };
    }
  }
  yield { type: 'done', stopReason: normalizeStop(stop) };
}

interface OaiModel {
  id?: string;
  name?: string;
  context_length?: number;
  context_window?: number;
  max_model_len?: number;
  max_context_length?: number;
  pricing?: { prompt?: string | number; completion?: string | number };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

function perMillion(v: string | number | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : null;
}

async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const ep = cfg.entry.modelsEndpoint;
  if (!ep || !cfg.entry.supports.listModels) return catalogModels(cfg.entry);
  const json = await requestJson<{ data?: OaiModel[]; models?: OaiModel[] } | OaiModel[]>(cfg, {
    path: ep,
    signal,
  });
  const list = Array.isArray(json) ? json : (json.data ?? json.models ?? []);
  return list
    .map((m) => {
      const id = m.id ?? m.name;
      if (!id) return undefined;
      const ctx = m.context_length ?? m.context_window ?? m.max_model_len ?? m.max_context_length;
      return baseModel(cfg.entry, id, {
        context: typeof ctx === 'number' && ctx > 0 ? ctx : undefined,
        inputPrice: perMillion(m.pricing?.prompt) ?? undefined,
        outputPrice: perMillion(m.pricing?.completion) ?? undefined,
        capabilities: {
          tools: m.supported_parameters ? m.supported_parameters.includes('tools') : null,
          vision: m.architecture?.input_modalities
            ? m.architecture.input_modalities.includes('image')
            : null,
          reasoning: m.supported_parameters
            ? m.supported_parameters.includes('reasoning') || null
            : null,
          fim: null,
        },
      });
    })
    .filter((m): m is ModelInfo => m !== undefined);
}

export async function testViaModelsOrChat(
  adapter: Pick<ProviderAdapter, 'listModels' | 'chat'>,
  cfg: ProviderConfig,
): Promise<ConnectionTest> {
  try {
    if (cfg.entry.supports.listModels && cfg.entry.modelsEndpoint) {
      const models = await adapter.listModels({ ...cfg, maxRetries: 0 });
      return { ok: true, models: models.length };
    }
    const model = cfg.entry.fallbackModels[0]?.id;
    if (!model) return { ok: true };
    const ctrl = new AbortController();
    for await (const c of adapter.chat(
      { ...cfg, maxRetries: 0 },
      { model, messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
      ctrl.signal,
    )) {
      if (c.type === 'text' || c.type === 'done') break;
    }
    ctrl.abort();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const openAiCompatible: ProviderAdapter = {
  id: 'openai-compatible',
  listModels,
  chat,
  async complete(cfg, req, signal) {
    const path = cfg.entry.id === 'mistral' ? '/fim/completions' : '/completions';
    const json = await requestJson<{
      choices?: { text?: string; message?: { content?: string } }[];
    }>(cfg, {
      method: 'POST',
      path,
      body: {
        model: req.model,
        prompt: req.prefix,
        suffix: req.suffix,
        max_tokens: req.maxTokens ?? 128,
        stream: false,
      },
      signal,
    });
    const c = json.choices?.[0];
    return c?.text ?? c?.message?.content ?? '';
  },
  async embed(cfg, req, signal) {
    const json = await requestJson<{ data?: { embedding: number[]; index?: number }[] }>(cfg, {
      method: 'POST',
      path: '/embeddings',
      body: { model: req.model, input: req.input },
      signal,
    });
    return (json.data ?? [])
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding);
  },
  testConnection(cfg) {
    return testViaModelsOrChat(openAiCompatible, cfg);
  },
};
