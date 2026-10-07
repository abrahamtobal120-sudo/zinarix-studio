import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatMessage, ChatRequest } from '@omni/shared';
import { request } from '../http.js';
import { parseSse, safeJson } from '../sse.js';
import type { ProviderAdapter, ProviderConfig } from '../types.js';
import { openAiCompatible, testViaModelsOrChat } from './openai-compatible.js';

/** Converts the normalized history into Responses API `instructions` + `input` items. */
export function toResponsesInput(messages: ChatMessage[]): {
  instructions?: string;
  input: Record<string, unknown>[];
} {
  const system: string[] = [];
  const input: Record<string, unknown>[] = [];
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        system.push(m.content);
        break;
      case 'user':
        input.push({
          role: 'user',
          content:
            typeof m.content === 'string'
              ? [{ type: 'input_text', text: m.content }]
              : m.content.map((p) =>
                  p.type === 'text'
                    ? { type: 'input_text', text: p.text }
                    : { type: 'input_image', image_url: `data:${p.mediaType};base64,${p.data}` },
                ),
        });
        break;
      case 'assistant':
        if (m.content) input.push({ role: 'assistant', content: m.content });
        for (const c of m.toolCalls ?? []) {
          input.push({
            type: 'function_call',
            call_id: c.id,
            name: c.name,
            arguments: c.arguments,
          });
        }
        break;
      case 'tool':
        input.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content });
        break;
    }
  }
  return { instructions: system.length ? system.join('\n\n') : undefined, input };
}

interface ResponsesEvent {
  type?: string;
  delta?: string;
  item_id?: string;
  output_index?: number;
  item?: { type?: string; id?: string; call_id?: string; name?: string };
  response?: {
    status?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
    error?: { message?: string; code?: string };
    incomplete_details?: { reason?: string };
  };
  message?: string;
  code?: string;
}

async function* chat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const { instructions, input } = toResponsesInput(req.messages);
  const body: Record<string, unknown> = {
    model: req.model,
    input,
    stream: true,
    store: false,
    ...(instructions ? { instructions } : {}),
    ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.reasoning ? { reasoning: { effort: req.reasoning, summary: 'auto' } } : {}),
    ...(req.jsonMode ? { text: { format: { type: 'json_object' } } } : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        }
      : {}),
  };
  const res = await request(cfg, { method: 'POST', path: '/responses', body, signal });

  // output_index -> function call identity
  const calls = new Map<number, { id: string; name: string }>();
  let stop = 'end_turn';
  for await (const ev of parseSse(res.body, {
    signal,
    idleTimeoutMs: cfg.idleTimeoutMs,
    provider: cfg.entry.id,
  })) {
    if (ev.data === '[DONE]') break;
    const e = safeJson<ResponsesEvent>(ev.data);
    if (!e?.type) continue;
    switch (e.type) {
      case 'response.output_text.delta':
        if (e.delta) yield { type: 'text', delta: e.delta };
        break;
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (e.delta) yield { type: 'reasoning', delta: e.delta };
        break;
      case 'response.output_item.added':
        if (e.item?.type === 'function_call') {
          const call = {
            id: e.item.call_id ?? e.item.id ?? `call_${e.output_index}`,
            name: e.item.name ?? '',
          };
          calls.set(e.output_index ?? 0, call);
          stop = 'tool_use';
          yield { type: 'tool_call', id: call.id, name: call.name, argsDelta: '' };
        }
        break;
      case 'response.function_call_arguments.delta': {
        const call = calls.get(e.output_index ?? 0);
        if (call && e.delta)
          yield { type: 'tool_call', id: call.id, name: call.name, argsDelta: e.delta };
        break;
      }
      case 'response.completed':
      case 'response.incomplete': {
        const u = e.response?.usage;
        if (u) {
          yield {
            type: 'usage',
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cachedTokens: u.input_tokens_details?.cached_tokens,
          };
        }
        if (e.type === 'response.incomplete') {
          stop =
            e.response?.incomplete_details?.reason === 'content_filter' ? 'refusal' : 'max_tokens';
        }
        break;
      }
      case 'response.failed':
        throw new OmniError('server', e.response?.error?.message ?? 'response failed', {
          provider: cfg.entry.id,
        });
      case 'error':
        throw new OmniError(
          e.code === 'rate_limit_exceeded' ? 'rate_limit' : 'server',
          e.message ?? 'stream error',
          {
            provider: cfg.entry.id,
          },
        );
    }
  }
  yield { type: 'done', stopReason: stop };
}

export const openAiResponses: ProviderAdapter = {
  id: 'openai-responses',
  listModels: openAiCompatible.listModels,
  chat,
  complete: undefined,
  embed: openAiCompatible.embed,
  testConnection(cfg) {
    return testViaModelsOrChat(openAiResponses, cfg);
  },
};
