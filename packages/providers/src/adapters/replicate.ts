import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatMessage, ChatRequest, ModelInfo } from '@omni/shared';
import { abortError, providerMessage, request, requestJson } from '../http.js';
import { baseModel, catalogModels } from '../models.js';
import { parseSse, safeJson } from '../sse.js';
import type { ConnectionTest, ProviderAdapter, ProviderConfig } from '../types.js';

/**
 * Replicate, native predictions API (https://replicate.com/docs/reference/http).
 * Replicate has no OpenAI-compatible chat endpoint, so a chat turn is one prediction:
 *
 *   POST /models/{owner}/{name}/predictions  { input }      (official models, id `owner/name`)
 *   POST /predictions  { version, input }                   (id `owner/name:version`)
 *   GET  urls.stream  (Accept: text/event-stream)  -> events `output` (plain text), `error`, `done`
 *   GET  urls.get     -> final prediction with `metrics.input_token_count/output_token_count`
 *   POST urls.cancel  on abort
 *
 * Each model has its own input schema, so the model's OpenAPI schema
 * (`latest_version.openapi_schema.components.schemas.Input.properties`) is read once per model
 * and decides between `messages` and a flattened `prompt`, the system field, the max-tokens
 * field and the image field. No tool calling: `req.tools` is ignored.
 */

type InputProps = Record<string, { type?: string; enum?: unknown[] } | undefined>;

interface ModelSchema {
  /** Input property names; undefined when the schema could not be read. */
  props?: InputProps;
}

interface Prediction {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  metrics?: { input_token_count?: number; output_token_count?: number } & Record<string, unknown>;
  urls?: { get?: string; stream?: string; cancel?: string };
}

const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'aborted']);
const POLL_MS = 1000;
const SCHEMA_TTL = 60 * 60 * 1000;
const schemaCache = new Map<string, { at: number; schema: ModelSchema }>();

/** Test hook: forget cached input schemas. */
export function clearReplicateSchemaCache(): void {
  schemaCache.clear();
}

export function parseModelId(id: string): { owner: string; name: string; version?: string } {
  const [path, version] = id.split(':', 2) as [string, string | undefined];
  const parts = path.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw new OmniError('bad_request', `Replicate model ids look like "owner/name": ${id}`, {
      retryable: false,
    });
  return { owner: parts[0], name: parts[1], ...(version ? { version } : {}) };
}

function inputProps(json: unknown): InputProps | undefined {
  const j = json as {
    openapi_schema?: unknown;
    latest_version?: { openapi_schema?: unknown } | null;
  } | null;
  const schema = (j?.latest_version?.openapi_schema ?? j?.openapi_schema) as
    { components?: { schemas?: { Input?: { properties?: InputProps } } } } | undefined;
  return schema?.components?.schemas?.Input?.properties;
}

async function modelSchema(
  cfg: ProviderConfig,
  model: string,
  signal: AbortSignal,
): Promise<ModelSchema> {
  const key = `${cfg.baseUrl}|${model}`;
  const hit = schemaCache.get(key);
  if (hit && Date.now() - hit.at < SCHEMA_TTL) return hit.schema;
  const { owner, name, version } = parseModelId(model);
  const path = version
    ? `/models/${owner}/${name}/versions/${version}`
    : `/models/${owner}/${name}`;
  let schema: ModelSchema;
  try {
    schema = { props: inputProps(await requestJson(cfg, { path, signal })) };
  } catch (e) {
    if (signal.aborted) throw abortError();
    // Auth and missing-model errors would fail the prediction too: report them now.
    if (e instanceof OmniError && (e.code === 'auth' || e.code === 'not_found')) throw e;
    cfg.logger?.debug('replicate: input schema unavailable', { provider: cfg.entry.id, model });
    schema = {};
  }
  schemaCache.set(key, { at: Date.now(), schema });
  return schema;
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('\n');
}

function imagesOf(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const p of m.content)
      if (p.type !== 'text') out.push(`data:${p.mediaType};base64,${p.data}`);
  }
  return out;
}

const pick = (props: InputProps, names: string[]) => names.find((n) => props[n] !== undefined);

/** Flattens a conversation into one prompt; the last user turn goes last. */
export function flattenPrompt(messages: ChatMessage[]): string {
  const turns = messages.filter((m) => m.role !== 'system');
  if (turns.length === 1 && turns[0]!.role === 'user') return textOf(turns[0]!.content);
  return turns
    .map((m) => {
      switch (m.role) {
        case 'user':
          return `User: ${textOf(m.content)}`;
        case 'assistant':
          return `Assistant: ${m.content}`;
        case 'tool':
          return `Tool result${m.name ? ` (${m.name})` : ''}: ${m.content}`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .concat(turns.at(-1)?.role === 'assistant' ? [] : ['Assistant:'])
    .join('\n\n');
}

/** Builds the prediction input for this model's schema (or a conservative default). */
export function buildInput(req: ChatRequest, schema: ModelSchema): Record<string, unknown> {
  // Without a schema, use the fields every official Replicate LLM accepts.
  const props: InputProps = schema.props ?? {
    prompt: {},
    system_prompt: {},
    max_tokens: {},
    temperature: {},
  };
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content as string)
    .join('\n\n');
  const input: Record<string, unknown> = {};
  const systemField = pick(props, ['system_prompt', 'system_instruction', 'system']);

  if (props.messages?.type === 'array') {
    input.messages = req.messages
      .filter((m) => m.role !== 'system' || !systemField)
      .map((m) =>
        m.role === 'tool'
          ? { role: 'user', content: `Tool result: ${m.content}` }
          : { role: m.role, content: textOf(m.content) },
      );
    if (systemField && system) input[systemField] = system;
  } else {
    const prompt = flattenPrompt(req.messages);
    if (systemField) {
      input.prompt = prompt;
      if (system) input[systemField] = system;
    } else input.prompt = system ? `${system}\n\n${prompt}` : prompt;
  }

  const maxField = pick(props, [
    'max_tokens',
    'max_completion_tokens',
    'max_output_tokens',
    'max_new_tokens',
  ]);
  if (req.maxTokens && maxField) input[maxField] = req.maxTokens;
  if (req.temperature !== undefined && props.temperature) input.temperature = req.temperature;
  if (req.reasoning && props.reasoning_effort) {
    const allowed = props.reasoning_effort.enum;
    if (!allowed || allowed.includes(req.reasoning)) input.reasoning_effort = req.reasoning;
  }

  const images = imagesOf(req.messages);
  if (images.length) {
    const arrayField = pick(props, ['image_input', 'images', 'image_urls']);
    if (arrayField && props[arrayField]?.type === 'array') input[arrayField] = images;
    else if (props.image) input.image = images.at(-1);
  }
  return input;
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.filter((o) => typeof o === 'string').join('');
  return '';
}

function predictionError(cfg: ProviderConfig, err: unknown): OmniError {
  const msg =
    typeof err === 'string'
      ? err
      : ((err as { detail?: string; message?: string } | null)?.detail ??
        (err as { message?: string } | null)?.message ??
        JSON.stringify(err));
  return new OmniError('server', `prediction failed: ${providerMessage(String(msg))}`, {
    provider: cfg.entry.id,
    retryable: false,
  });
}

function usageOf(p: Prediction): ChatChunk | undefined {
  const m = p.metrics;
  if (!m || (m.input_token_count === undefined && m.output_token_count === undefined))
    return undefined;
  return {
    type: 'usage',
    inputTokens: m.input_token_count ?? 0,
    outputTokens: m.output_token_count ?? 0,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function* chat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const { owner, name, version } = parseModelId(req.model);
  const schema = await modelSchema(cfg, req.model, signal);
  const input = buildInput(req, schema);
  const created = await requestJson<Prediction>(cfg, {
    method: 'POST',
    path: version ? '/predictions' : `/models/${owner}/${name}/predictions`,
    body: version ? { version, input } : { input },
    signal,
  });

  let finished = false;
  const cancelUrl = created.urls?.cancel;
  let canceled = false;
  const cancel = () => {
    if (!cancelUrl || canceled) return;
    canceled = true;
    request(
      { ...cfg, maxRetries: 0, timeoutMs: Math.min(cfg.timeoutMs ?? 10_000, 10_000) },
      { method: 'POST', path: cancelUrl },
    )
      .then((r) => r.body?.cancel())
      .catch(() => {});
  };
  const onAbort = () => {
    if (!finished) cancel();
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    let stop = 'end_turn';
    if (created.status === 'failed') throw predictionError(cfg, created.error);
    if (created.urls?.stream) {
      const res = await request(cfg, {
        path: created.urls.stream,
        headers: { accept: 'text/event-stream', 'cache-control': 'no-store' },
        signal,
      });
      for await (const ev of parseSse(res.body, {
        signal,
        idleTimeoutMs: cfg.idleTimeoutMs,
        provider: cfg.entry.id,
      })) {
        if (ev.event === 'output') {
          if (ev.data) yield { type: 'text', delta: ev.data };
        } else if (ev.event === 'error') {
          throw predictionError(cfg, safeJson(ev.data) ?? ev.data);
        } else if (ev.event === 'done') {
          const reason = safeJson<{ reason?: string }>(ev.data)?.reason;
          if (reason === 'canceled') stop = 'canceled';
          else if (reason === 'error') throw predictionError(cfg, 'unknown error');
          break;
        }
      }
      finished = true;
      // Token counts only show up on the finished prediction; best effort.
      if (created.urls.get) {
        try {
          const final = await requestJson<Prediction>(
            { ...cfg, maxRetries: 0 },
            { path: created.urls.get, signal },
          );
          const usage = usageOf(final);
          if (usage) yield usage;
        } catch (e) {
          if (signal.aborted) throw abortError();
          cfg.logger?.debug('replicate: usage unavailable', {
            provider: cfg.entry.id,
            code: e instanceof OmniError ? e.code : 'unknown',
          });
        }
      }
    } else {
      // Model without streaming support: poll until the prediction ends.
      let p = created;
      while (!TERMINAL.has(p.status ?? '')) {
        if (!p.urls?.get)
          throw new OmniError('server', 'prediction has no get URL', {
            provider: cfg.entry.id,
          });
        await sleep(POLL_MS, signal);
        p = await requestJson<Prediction>(cfg, { path: p.urls.get, signal });
      }
      finished = true;
      if (p.status === 'failed') throw predictionError(cfg, p.error);
      if (p.status === 'canceled' || p.status === 'aborted') stop = 'canceled';
      const text = outputText(p.output);
      if (text) yield { type: 'text', delta: text };
      const usage = usageOf(p);
      if (usage) yield usage;
    }
    yield { type: 'done', stopReason: stop };
  } catch (e) {
    // fetch may reject the body read with a raw DOMException before parseSse sees the abort.
    if (signal.aborted && !(e instanceof OmniError && e.code === 'aborted')) throw abortError();
    throw e;
  } finally {
    signal.removeEventListener('abort', onAbort);
    // Consumer stopped early (break / error): don't leave the prediction running and billing.
    if (!finished) cancel();
  }
}

interface ReplicateModel {
  owner?: string;
  name?: string;
  description?: string | null;
}

async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  if (!cfg.entry.supports.listModels) return catalogModels(cfg.entry);
  const json = await requestJson<{ models?: ReplicateModel[] }>(cfg, {
    path: cfg.entry.modelsEndpoint ?? '/collections/language-models',
    signal,
  });
  return (json.models ?? [])
    .filter((m) => m.owner && m.name)
    .map((m) => baseModel(cfg.entry, `${m.owner}/${m.name}`, { kind: 'chat' }));
}

async function testConnection(cfg: ProviderConfig): Promise<ConnectionTest> {
  try {
    // GET /account is the cheapest authenticated call.
    await requestJson({ ...cfg, maxRetries: 0 }, { path: '/account' });
    let models: number | undefined;
    try {
      models = (await listModels({ ...cfg, maxRetries: 0 })).length;
    } catch {
      // the token works; the model list is optional here
    }
    return { ok: true, ...(models !== undefined ? { models } : {}) };
  } catch (e) {
    return e instanceof OmniError
      ? { ok: false, error: e.message, code: e.code, ...(e.status ? { status: e.status } : {}) }
      : { ok: false, error: e instanceof Error ? e.message : String(e), code: 'unknown' };
  }
}

export const replicate: ProviderAdapter = {
  id: 'replicate',
  listModels,
  chat,
  testConnection,
};
