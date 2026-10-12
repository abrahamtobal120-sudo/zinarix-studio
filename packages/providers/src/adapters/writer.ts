import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatRequest, ModelInfo } from '@omni/shared';
import { describeErrorBody, request, requestJson } from '../http.js';
import { baseModel, catalogModels } from '../models.js';
import { parseSse, safeJson } from '../sse.js';
import type { ProviderAdapter, ProviderConfig } from '../types.js';
import { normalizeStop, testViaModelsOrChat, toOpenAiMessages } from './openai-compatible.js';

/**
 * Writer (Palmyra). Docs: https://dev.writer.com/api-reference/completion-api/chat-completion
 *
 * The wire format is OpenAI-like, with these differences handled here:
 * - the chat endpoint is `POST /v1/chat` (not `/chat/completions`);
 * - `response_format` only accepts `text` / `json_schema` (no `json_object`), so JSON mode
 *   sends a permissive object schema;
 * - usage reports cached tokens in `prompt_token_details` (singular "token");
 * - a streamed tool call may spread its name over several deltas, keyed by `index`;
 * - `GET /v1/models` answers `{ models: [{ id, name }] }`.
 * Writer's built-in tools (graph, web_search, llm, translation, vision) are not used.
 */

interface WriterToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface WriterDelta {
  content?: string | null;
  tool_calls?: WriterToolCallDelta[] | null;
}

interface WriterChunk {
  choices?: { delta?: WriterDelta; message?: WriterDelta; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_token_details?: { cached_tokens?: number } | null;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  } | null;
  error?: unknown;
}

function buildBody(req: ChatRequest, withJson: boolean): Record<string, unknown> {
  return {
    model: req.model,
    messages: toOpenAiMessages(req.messages),
    stream: true,
    stream_options: { include_usage: true },
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(withJson && req.jsonMode
      ? { response_format: { type: 'json_schema', json_schema: { schema: { type: 'object' } } } }
      : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: 'auto',
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
    res = await request(cfg, { method: 'POST', path: '/chat', body: buildBody(req, true), signal });
  } catch (e) {
    // Structured output is documented for palmyra-x4/x5 only; retry once in plain text.
    if (
      req.jsonMode &&
      e instanceof OmniError &&
      e.code === 'bad_request' &&
      /response_format|json_schema/i.test(e.message)
    ) {
      res = await request(cfg, {
        method: 'POST',
        path: '/chat',
        body: buildBody(req, false),
        signal,
      });
    } else throw e;
  }

  // The core keeps the name of a call's first chunk, and Writer may split the name over
  // several deltas (its SDK concatenates them), so a call is only announced once its
  // arguments start, i.e. once the name is complete.
  const calls = new Map<number, { id: string; name: string; args: string; emitted: boolean }>();
  let lastIndex = 0;
  let stop: string | undefined;
  for await (const ev of parseSse(res.body, {
    signal,
    idleTimeoutMs: cfg.idleTimeoutMs,
    provider: cfg.entry.id,
  })) {
    if (ev.data === '[DONE]') break;
    const chunk = safeJson<WriterChunk>(ev.data);
    if (!chunk) continue;
    if (chunk.error) {
      throw new OmniError('server', describeErrorBody(ev.data), { provider: cfg.entry.id });
    }
    const choice = chunk.choices?.[0];
    // `message` is the deprecated streaming alias of `delta`.
    const delta = choice?.delta ?? choice?.message;
    if (delta) {
      if (delta.content) yield { type: 'text', delta: delta.content };
      for (const tc of delta.tool_calls ?? []) {
        const index = tc.index ?? (tc.id ? calls.size : lastIndex);
        lastIndex = index;
        let call = calls.get(index);
        if (!call || (tc.id && tc.id !== call.id)) {
          if (call && !call.emitted) yield* flush(call);
          call = { id: tc.id ?? `call_${index}`, name: '', args: '', emitted: false };
          calls.set(index, call);
        }
        if (tc.function?.name) call.name += tc.function.name;
        const args = tc.function?.arguments ?? '';
        if (call.emitted) {
          if (args) yield { type: 'tool_call', id: call.id, name: call.name, argsDelta: args };
        } else {
          call.args += args;
          if (call.args) yield* flush(call);
        }
      }
    }
    if (choice?.finish_reason) stop = choice.finish_reason;
    if (chunk.usage) {
      const cached =
        chunk.usage.prompt_token_details?.cached_tokens ??
        chunk.usage.prompt_tokens_details?.cached_tokens;
      yield {
        type: 'usage',
        inputTokens: chunk.usage.prompt_tokens ?? 0,
        outputTokens: chunk.usage.completion_tokens ?? 0,
        ...(cached ? { cachedTokens: cached } : {}),
      };
    }
  }
  for (const call of calls.values()) if (!call.emitted) yield* flush(call);
  yield { type: 'done', stopReason: normalizeStop(stop) };
}

function* flush(call: { id: string; name: string; args: string; emitted: boolean }) {
  call.emitted = true;
  const chunk: ChatChunk = {
    type: 'tool_call',
    id: call.id,
    name: call.name,
    argsDelta: call.args,
  };
  call.args = '';
  yield chunk;
}

interface WriterModel {
  id?: string;
  name?: string;
}

async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  if (!cfg.entry.supports.listModels) return catalogModels(cfg.entry);
  const json = await requestJson<{ models?: WriterModel[]; data?: WriterModel[] } | WriterModel[]>(
    cfg,
    { path: cfg.entry.modelsEndpoint ?? '/models', signal },
  );
  const list = Array.isArray(json) ? json : (json.models ?? json.data ?? []);
  return list
    .map((m) => {
      const id = m.id ?? m.name;
      if (!id) return undefined;
      return baseModel(cfg.entry, id, m.name && m.name !== id ? { label: m.name } : {});
    })
    .filter((m): m is ModelInfo => m !== undefined);
}

export const writer: ProviderAdapter = {
  id: 'writer',
  listModels,
  chat,
  testConnection(cfg) {
    return testViaModelsOrChat(writer, cfg);
  },
};
