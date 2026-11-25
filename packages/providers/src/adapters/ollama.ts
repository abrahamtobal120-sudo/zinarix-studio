import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatMessage, ChatRequest } from '@omni/shared';
import { request, requestJson } from '../http.js';
import { decodeText, isTextual, unsupportedPart } from '../parts.js';
import { parseSse, safeJson } from '../sse.js';
import type { ProviderConfig } from '../types.js';

/**
 * Ollama's native chat API (`POST /api/chat`), used instead of its OpenAI-compatible `/v1`
 * endpoint for one reason: `/v1` cannot set the context size. Ollama loads every model with
 * a small default window (4096 tokens) and silently drops whatever does not fit, so an agent
 * conversation loses its task and its file contents without any error. The native API takes
 * `options.num_ctx`, which is sized here to the request.
 *
 * Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

/** Context sizes requested from Ollama. Changing the size reloads the model, so few steps. */
const BUCKETS = [8192, 16384, 32768] as const;
/** Largest window asked for by default: bigger ones often do not fit in consumer VRAM. */
export const OLLAMA_MAX_CTX = 32768;
/** Tokens kept free for the reply when the request does not say how long it may be. */
const REPLY_RESERVE = 2048;

/** `http://localhost:11434/v1` → `http://localhost:11434` (the native API lives at the root). */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

function nativeCfg(cfg: ProviderConfig): ProviderConfig {
  return { ...cfg, baseUrl: ollamaRoot(cfg.baseUrl) };
}

/** The user's own limit (`ZINARIX_OLLAMA_CTX`), when set to a sane number. */
function userCtx(): number | undefined {
  const n = Number(process.env.ZINARIX_OLLAMA_CTX);
  return Number.isFinite(n) && n >= 1024 ? Math.floor(n) : undefined;
}

const modelMax = new Map<string, number | null>();
const grown = new Map<string, number>();

export function clearOllamaCache(): void {
  modelMax.clear();
  grown.clear();
}

/** The model's trained context length from `/api/show`; null when Ollama does not say. */
export async function ollamaModelContext(
  cfg: ProviderConfig,
  model: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const key = `${cfg.baseUrl}\n${model}`;
  const known = modelMax.get(key);
  if (known !== undefined) return known;
  let max: number | null = null;
  try {
    const info = await requestJson<{ model_info?: Record<string, unknown> }>(
      { ...nativeCfg(cfg), maxRetries: 0, timeoutMs: 10_000 },
      { method: 'POST', path: '/api/show', body: { model }, signal, idempotent: true },
    );
    for (const [k, v] of Object.entries(info.model_info ?? {})) {
      if (k.endsWith('.context_length') && typeof v === 'number' && v > 0) max = v;
    }
  } catch {
    // Unknown: sized from the request alone. Not cached, so a later call can ask again.
    return null;
  }
  modelMax.set(key, max);
  return max;
}

/**
 * The window the model is loaded with right now (`/api/ps`), so the first request of this
 * process keeps it instead of reloading the model with a smaller one. It also respects a
 * larger default the user set on the server (OLLAMA_CONTEXT_LENGTH).
 */
async function seedFromLoaded(cfg: ProviderConfig, model: string, key: string): Promise<void> {
  if (grown.has(key)) return;
  try {
    const ps = await requestJson<{
      models?: { name?: string; model?: string; context_length?: number }[];
    }>({ ...nativeCfg(cfg), maxRetries: 0, timeoutMs: 3000 }, { path: '/api/ps' });
    const loaded = (ps.models ?? []).find((m) => m.name === model || m.model === model);
    if (loaded?.context_length && !grown.has(key)) grown.set(key, loaded.context_length);
  } catch {
    // Not loaded, or an older server: sized from the request.
  }
}

/** The window Zinarix can count on for a model: what it would ask Ollama for at most. */
export function ollamaUsableContext(max: number | null): number {
  const limit = userCtx() ?? OLLAMA_MAX_CTX;
  return max ? Math.min(max, limit) : limit;
}

/**
 * The `num_ctx` for one request: the smallest step that holds `needTokens`, never above the
 * model's own limit, and never smaller than what an earlier request of this model already
 * used (shrinking would reload the model and throw away its prompt cache).
 */
export function pickNumCtx(key: string, needTokens: number, max: number | null): number {
  const fixed = userCtx();
  const top = ollamaUsableContext(max);
  let ctx = fixed ? top : (BUCKETS.find((b) => b >= needTokens) ?? OLLAMA_MAX_CTX);
  ctx = Math.min(ctx, top);
  const before = grown.get(key) ?? 0;
  if (before > ctx) ctx = Math.min(before, top);
  grown.set(key, ctx);
  return ctx;
}

/** Characters of text in the conversation (images and tool definitions not counted). */
function textChars(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else for (const p of m.content) if (p.type === 'text') chars += p.text.length;
  }
  return chars;
}

/**
 * Rough size of a request in tokens, on the high side (2 characters per token; measured
 * with qwen2.5-coder: 2.3 on digit-heavy code, about 3.5 on ordinary code). Falling short is
 * the expensive mistake: Ollama then drops whole messages.
 */
export function estimateOllamaTokens(req: ChatRequest): number {
  let chars = 0;
  for (const m of req.messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else
      for (const p of m.content)
        chars += p.type === 'text' ? p.text.length : p.type === 'image' ? 3000 : 0;
    if (m.role === 'assistant')
      for (const c of m.toolCalls ?? []) chars += c.name.length + c.arguments.length;
  }
  if (req.tools?.length) chars += JSON.stringify(req.tools).length;
  return Math.ceil(chars / 2) + (req.maxTokens ?? REPLY_RESERVE);
}

type NativeMessage = Record<string, unknown>;

export function toOllamaMessages(messages: ChatMessage[]): NativeMessage[] {
  const toolNames = new Map<string, string>();
  return messages.map((m): NativeMessage => {
    switch (m.role) {
      case 'system':
        return { role: 'system', content: m.content };
      case 'user': {
        if (typeof m.content === 'string') return { role: 'user', content: m.content };
        const text: string[] = [];
        const images: string[] = [];
        for (const p of m.content) {
          if (p.type === 'text') text.push(p.text);
          else if (p.type === 'image') images.push(p.data);
          else if (isTextual(p)) text.push(decodeText(p));
          else text.push(unsupportedPart(p, 'Ollama'));
        }
        return {
          role: 'user',
          content: text.join('\n\n'),
          ...(images.length ? { images } : {}),
        };
      }
      case 'assistant':
        for (const c of m.toolCalls ?? []) toolNames.set(c.id, c.name);
        return {
          role: 'assistant',
          content: m.content || '',
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  function: {
                    name: c.name,
                    arguments: safeJson<Record<string, unknown>>(c.arguments) ?? {},
                  },
                })),
              }
            : {}),
        };
      case 'tool': {
        const name = toolNames.get(m.toolCallId);
        return { role: 'tool', content: m.content, ...(name ? { tool_name: name } : {}) };
      }
    }
  });
}

export function ollamaBody(req: ChatRequest, numCtx: number): Record<string, unknown> {
  return {
    model: req.model,
    messages: toOllamaMessages(req.messages),
    stream: true,
    options: {
      num_ctx: numCtx,
      ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.topP !== undefined ? { top_p: req.topP } : {}),
    },
    ...(req.jsonSchema
      ? { format: req.jsonSchema.schema }
      : req.jsonMode
        ? { format: 'json' }
        : {}),
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

interface NativeChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * True when the server at this URL does not speak the native API (a proxy that only exposes
 * `/v1`): the caller then falls back to the OpenAI-compatible endpoint.
 */
export function noNativeApi(e: unknown): boolean {
  return (
    e instanceof OmniError && (e.status === 404 || e.status === 405) && !/model/i.test(e.message)
  );
}

export async function* ollamaChat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const max = await ollamaModelContext(cfg, req.model, signal);
  const key = `${cfg.baseUrl}\n${req.model}`;
  await seedFromLoaded(cfg, req.model, key);
  const numCtx = pickNumCtx(key, estimateOllamaTokens(req), max);
  const res = await request(nativeCfg(cfg), {
    method: 'POST',
    path: '/api/chat',
    body: ollamaBody(req, numCtx),
    signal,
  });

  const sent = textChars(req.messages);
  let calls = 0;
  let reason: string | undefined;
  const turn = Date.now().toString(36);
  for await (const ev of parseSse(res.body, {
    signal,
    idleTimeoutMs: cfg.idleTimeoutMs,
    provider: cfg.entry.id,
  })) {
    const chunk = safeJson<NativeChunk>(ev.data);
    if (!chunk) continue;
    if (chunk.error) throw new OmniError('server', chunk.error, { provider: cfg.entry.id });
    const msg = chunk.message;
    if (msg?.thinking) yield { type: 'reasoning', delta: msg.thinking };
    if (msg?.content) yield { type: 'text', delta: msg.content };
    for (const tc of msg?.tool_calls ?? []) {
      const args = tc.function?.arguments;
      yield {
        type: 'tool_call',
        id: tc.id ?? `call_${turn}_${calls}`,
        name: tc.function?.name ?? '',
        argsDelta: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      };
      calls++;
    }
    if (chunk.done) {
      reason = chunk.done_reason;
      // No tokenizer gives fewer than one token per 10 characters of text, so a count this
      // low means Ollama threw messages away to fit the window. The reply was written
      // without them: fail instead of letting an agent act on it.
      const read = chunk.prompt_eval_count ?? 0;
      if (read > 0 && sent >= 8000 && read < sent / 10)
        throw new OmniError(
          'bad_request',
          `Ollama dropped part of the conversation: it does not fit in the ${numCtx}-token window of ${req.model} (it read ${read} tokens of about ${Math.round(sent / 3)}). Start a new chat, use a model with a larger context, or set ZINARIX_OLLAMA_CTX.`,
          { provider: cfg.entry.id, retryable: false },
        );
      yield {
        type: 'usage',
        inputTokens: chunk.prompt_eval_count ?? 0,
        outputTokens: chunk.eval_count ?? 0,
      };
    }
  }
  yield {
    type: 'done',
    stopReason: calls ? 'tool_use' : reason === 'length' ? 'max_tokens' : 'end_turn',
  };
}
