import { createHash } from 'node:crypto';
import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatRequest, ModelInfo } from '@omni/shared';
import { redact, registerSecret } from '@omni/security';
import { abortError, providerMessage, request } from '../http.js';
import { baseModel } from '../models.js';
import { parseSse, safeJson } from '../sse.js';
import type { ConnectionTest, ProviderAdapter, ProviderConfig } from '../types.js';
import { normalizeStop, toOpenAiMessages } from './openai-compatible.js';

/**
 * IBM watsonx.ai (`/ml/v1/text/chat_stream`, OpenAI-like chat payloads).
 *
 * Auth: the stored secret is an API key that is exchanged for a short-lived bearer token:
 *  - IBM Cloud regions (`{region}.ml.cloud.ibm.com`): IBM Cloud IAM,
 *    `POST https://iam.cloud.ibm.com/identity/token` (form, grant_type=…:apikey);
 *  - watsonx on AWS (`{region}.aws.wxai.ibm.com`): IBM SaaS account IAM,
 *    `POST https://account-iam.platform.saas.ibm.com/api/2.0/apikeys/token` (JSON {apikey});
 *  - a pasted bearer token (JWT, e.g. `ibmcloud iam oauth-tokens` or a CPD token) is sent as is.
 * Every request also needs `?version=YYYY-MM-DD` and a project_id (or space_id) in the body.
 */

const ID = 'ibm-watsonx';
/** API version date sent as `?version=`; the value the official ibm-watsonx-ai SDK 1.8 sends. */
export const WATSONX_API_VERSION = '2026-09-25';
export const IBM_CLOUD_IAM_URL = 'https://iam.cloud.ibm.com/identity/token';
export const IBM_SAAS_IAM_URL = 'https://account-iam.platform.saas.ibm.com/api/2.0/apikeys/token';
const DEFAULT_REGION = 'us-south';
/** watsonx regions hosted on AWS (different host and IAM service). */
const AWS_REGIONS = new Set(['ap-south-1', 'us-east-1']);
/** Refresh this long before the token expires. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
const DEFAULT_TTL_SEC = 3600;
const TOKEN_TIMEOUT_MS = 30_000;

const authError = (
  provider: string,
  message: string,
  extra: { status?: number; retryable?: boolean } = {},
) => new OmniError('auth', message, { provider, retryable: false, ...extra });

// ---------------------------------------------------------------------------------------------
// URLs

/** Host for a region: `us-south` → `https://us-south.ml.cloud.ibm.com`, AWS → `*.aws.wxai.ibm.com`. */
export function watsonxHost(region = DEFAULT_REGION): string {
  const r = region.trim().toLowerCase() || DEFAULT_REGION;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r))
    throw new OmniError('config', `invalid watsonx.ai region "${region.slice(0, 40)}"`, {
      provider: ID,
      retryable: false,
    });
  return AWS_REGIONS.has(r) ? `https://${r}.aws.wxai.ibm.com` : `https://${r}.ml.cloud.ibm.com`;
}

/**
 * Root of the API (no `/ml/v1`). The catalog default is rebuilt from `region` (so AWS regions
 * get their own host); a custom base URL (proxy, CPD cluster, tests) is used as given.
 */
export function watsonxRoot(cfg: ProviderConfig): string {
  const region = cfg.params?.region?.trim();
  const strip = (u: string) => u.replace(/\/+$/, '').replace(/\/ml\/v[14]$/, '');
  const base = strip(cfg.baseUrl);
  const catalogDefault = strip(cfg.entry.baseUrl.replace(/\{region\}/g, region ?? ''));
  if (!base || base === catalogDefault) return watsonxHost(region);
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new OmniError('config', 'invalid watsonx.ai base URL', {
      provider: cfg.entry.id,
      retryable: false,
    });
  }
  if (!host || host.startsWith('.')) return watsonxHost(region);
  return base;
}

function apiVersion(cfg: ProviderConfig): string {
  const v = cfg.params?.api_version?.trim();
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : WATSONX_API_VERSION;
}

// ---------------------------------------------------------------------------------------------
// Tokens

type TokenKind = 'ibm-cloud' | 'aws';

interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

/** For tests. */
export function clearWatsonxTokenCache(): void {
  tokenCache.clear();
  inflight.clear();
}

const looksLikeJwt = (v: string) => /^eyJ[\w-]*\.[\w-]+\.[\w-]*$/.test(v);

function jwtExpiry(token: string): number | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims?.exp === 'number' ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** `iam_url` override: only IBM hosts, or loopback (tests / local proxies), may receive the key. */
function tokenUrl(cfg: ProviderConfig, kind: TokenKind): string {
  const custom = cfg.params?.iam_url?.trim();
  if (!custom) return kind === 'aws' ? IBM_SAAS_IAM_URL : IBM_CLOUD_IAM_URL;
  try {
    const u = new URL(custom);
    const h = u.hostname;
    if (u.protocol === 'https:' && /(^|\.)(ibm\.com|ibmforusgov\.com)$/.test(h)) return custom;
    if (u.protocol === 'http:' && (h === '127.0.0.1' || h === 'localhost')) return custom;
  } catch {
    // fall through
  }
  throw new OmniError('config', 'iam_url must be an https://*.ibm.com URL', {
    provider: cfg.entry.id,
    retryable: false,
  });
}

function cacheKey(kind: TokenKind, url: string, apiKey: string): string {
  return createHash('sha256').update(`${kind}\0${url}\0${apiKey}`).digest('hex');
}

async function exchangeToken(
  cfg: ProviderConfig,
  kind: TokenKind,
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<CachedToken> {
  const timeout = AbortSignal.timeout(cfg.timeoutMs ?? TOKEN_TIMEOUT_MS);
  let res: Response;
  try {
    res = await (cfg.fetch ?? fetch)(url, {
      method: 'POST',
      headers:
        kind === 'aws'
          ? { 'content-type': 'application/json', accept: 'application/json' }
          : { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body:
        kind === 'aws'
          ? JSON.stringify({ apikey: apiKey })
          : new URLSearchParams({
              grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
              apikey: apiKey,
            }).toString(),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (timeout.aborted)
      throw new OmniError('timeout', 'timeout while requesting an IBM IAM token', {
        provider: cfg.entry.id,
      });
    throw new OmniError(
      'network',
      `IBM IAM token request failed: ${redact(e instanceof Error ? e.message : String(e))}`,
      { provider: cfg.entry.id },
    );
  }
  const text = await res.text().catch(() => '');
  const body = safeJson<Record<string, unknown>>(text) ?? {};
  const token =
    typeof body.access_token === 'string'
      ? body.access_token
      : typeof body.token === 'string'
        ? body.token
        : undefined;
  if (!res.ok || !token) {
    const detail = [body.errorCode, body.errorMessage ?? body.message ?? body.error]
      .filter((x): x is string => typeof x === 'string')
      .join(': ');
    const msg = `IBM IAM token exchange failed (HTTP ${res.status})${detail ? `: ${providerMessage(detail).slice(0, 300)}` : ''}`;
    if (res.status >= 500 || res.status === 429)
      throw new OmniError(res.status === 429 ? 'rate_limit' : 'server', msg, {
        provider: cfg.entry.id,
        status: res.status,
        retryable: true,
      });
    throw authError(cfg.entry.id, msg, { status: res.status });
  }
  registerSecret(token);
  let expiresAt: number | undefined;
  if (typeof body.expiration === 'number') expiresAt = body.expiration * 1000;
  else if (typeof body.expires_in === 'number') expiresAt = Date.now() + body.expires_in * 1000;
  else expiresAt = jwtExpiry(token);
  return { token, expiresAt: expiresAt ?? Date.now() + DEFAULT_TTL_SEC * 1000 };
}

/**
 * Bearer token for the configured key: cached in memory (keyed by a SHA-256 of the key, never
 * the key itself) and refreshed 5 minutes before it expires.
 */
export async function watsonxAccessToken(
  cfg: ProviderConfig,
  signal?: AbortSignal,
  opts: { forceRefresh?: boolean } = {},
): Promise<string> {
  const raw = cfg.apiKey && !cfg.apiKey.isEmpty ? cfg.apiKey.reveal().trim() : '';
  if (!raw) throw authError(cfg.entry.id, 'IBM watsonx.ai needs an IBM Cloud API key');
  if (looksLikeJwt(raw)) return raw;
  const kind: TokenKind = /\.aws\.wxai\.ibm\.com$/.test(safeHost(watsonxRoot(cfg)))
    ? 'aws'
    : 'ibm-cloud';
  const url = tokenUrl(cfg, kind);
  const key = cacheKey(kind, url, raw);
  const hit = tokenCache.get(key);
  if (opts.forceRefresh) tokenCache.delete(key);
  else if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return hit.token;
  let pending = inflight.get(key);
  if (!pending) {
    pending = exchangeToken(cfg, kind, url, raw, signal).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const fresh = await pending;
  tokenCache.set(key, fresh);
  return fresh.token;
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------------------------
// Requests

/** watsonx error bodies are `{errors:[{code,message}], trace, status_code}`. */
function refineError(e: unknown): unknown {
  if (!(e instanceof OmniError)) return e;
  const m = /^HTTP (\d+): ([\s\S]*)$/.exec(e.message);
  const parsed = m
    ? safeJson<{ errors?: { code?: string; message?: string }[] }>(m[2]!)
    : undefined;
  const first = parsed?.errors?.[0];
  if (!first?.message) return e;
  const text = [first.code, first.message].filter(Boolean).join(': ');
  return new OmniError(e.code, `HTTP ${m![1]}: ${providerMessage(text)}`, {
    status: e.status,
    provider: e.provider,
    retryable: e.retryable,
    retryAfterMs: e.retryAfterMs,
  });
}

/** Authenticated request; a 401 with a cached token re-mints it once. */
async function authed(
  cfg: ProviderConfig,
  method: 'GET' | 'POST',
  path: string,
  query: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const root = watsonxRoot(cfg);
  for (let attempt = 0; ; attempt++) {
    const token = await watsonxAccessToken(cfg, signal, { forceRefresh: attempt > 0 });
    try {
      // apiKey is dropped (and noAuth set) so http.ts never sends the raw key.
      return await request(
        { ...cfg, apiKey: undefined, baseUrl: root },
        {
          method,
          path,
          query: { version: apiVersion(cfg), ...query },
          body,
          headers: { authorization: `Bearer ${token}` },
          noAuth: true,
          signal,
        },
      );
    } catch (e) {
      const raw = cfg.apiKey?.reveal().trim() ?? '';
      if (attempt === 0 && e instanceof OmniError && e.status === 401 && !looksLikeJwt(raw))
        continue;
      throw refineError(e);
    }
  }
}

function target(cfg: ProviderConfig): Record<string, string> {
  const project = cfg.params?.project_id?.trim();
  if (project) return { project_id: project };
  const space = cfg.params?.space_id?.trim();
  if (space) return { space_id: space };
  throw new OmniError(
    'config',
    `${cfg.entry.id} needs a watsonx.ai project: omni auth add ${cfg.entry.id} --param project_id=<id> (or space_id)`,
    { provider: cfg.entry.id, retryable: false },
  );
}

export function watsonxChatBody(cfg: ProviderConfig, req: ChatRequest): Record<string, unknown> {
  const messages = toOpenAiMessages(req.messages).map((m) => {
    // watsonx rejects `content: null` on assistant tool-call turns; omit it instead.
    if (m.content === null) {
      const { content: _drop, ...rest } = m;
      return rest;
    }
    return m;
  });
  return {
    model_id: req.model,
    ...target(cfg),
    messages,
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

interface WxDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

interface WxChunk {
  choices?: { delta?: WxDelta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  errors?: { code?: string; message?: string }[];
}

function stopReason(reason: string | undefined): string {
  if (reason === 'time_limit') return 'max_tokens';
  return normalizeStop(reason);
}

async function* chat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const body = watsonxChatBody(cfg, req); // validates project_id before any network call
  const res = await authed(cfg, 'POST', '/ml/v1/text/chat_stream', {}, body, signal);

  const tools = new Map<number, { id: string; name: string }>();
  const byId = new Map<string, number>();
  let lastIndex = 0;
  let stop: string | undefined;
  let usage: WxChunk['usage'];
  for await (const ev of parseSse(res.body, {
    signal,
    idleTimeoutMs: cfg.idleTimeoutMs,
    provider: cfg.entry.id,
  })) {
    if (ev.data === '[DONE]') break;
    const chunk = safeJson<WxChunk>(ev.data);
    if (!chunk) continue;
    if (ev.event === 'error' || chunk.errors?.length) {
      const e = chunk.errors?.[0];
      throw new OmniError(
        'server',
        providerMessage([e?.code, e?.message].filter(Boolean).join(': ') || ev.data),
        { provider: cfg.entry.id },
      );
    }
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (delta) {
      if (delta.reasoning_content) yield { type: 'reasoning', delta: delta.reasoning_content };
      if (delta.content) yield { type: 'text', delta: delta.content };
      for (const tc of delta.tool_calls ?? []) {
        let index = tc.index;
        if (index === undefined)
          index = tc.id ? (byId.get(tc.id) ?? (tools.size ? tools.size : 0)) : lastIndex;
        lastIndex = index;
        let known = tools.get(index);
        if (!known || (tc.id && tc.id !== known.id)) {
          known = { id: tc.id ?? `call_${index}`, name: tc.function?.name ?? '' };
          tools.set(index, known);
          byId.set(known.id, index);
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
    if (chunk.usage) usage = chunk.usage;
  }
  if (usage)
    yield {
      type: 'usage',
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
    };
  yield { type: 'done', stopReason: stopReason(stop) };
}

// ---------------------------------------------------------------------------------------------
// Models

interface WxModelSpec {
  model_id?: string;
  label?: string;
  functions?: { id?: string }[];
  task_ids?: string[];
  model_limits?: { max_sequence_length?: number; max_output_tokens?: number };
  lifecycle?: { id?: string; start_date?: string }[];
}

/** Current lifecycle state: the latest entry that has already started. */
export function lifecycleState(spec: WxModelSpec, now = Date.now()): string | undefined {
  let current: { id?: string; t: number } | undefined;
  for (const l of spec.lifecycle ?? []) {
    const t = l.start_date ? Date.parse(l.start_date) : 0;
    if (Number.isNaN(t) || t > now) continue;
    if (!current || t >= current.t) current = { id: l.id, t };
  }
  return current?.id;
}

async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const res = await authed(
    cfg,
    'GET',
    '/ml/v1/foundation_model_specs',
    { filters: 'function_text_chat,!lifecycle_withdrawn:and', limit: '200' },
    undefined,
    signal,
  );
  const text = await res.text();
  const json = safeJson<{ resources?: WxModelSpec[] }>(text);
  if (!json)
    throw new OmniError('server', 'invalid JSON from watsonx.ai model specs', {
      provider: cfg.entry.id,
    });
  return (json.resources ?? [])
    .filter((m) => {
      const state = lifecycleState(m);
      return m.model_id && state !== 'withdrawn' && state !== 'deprecated';
    })
    .map((m) => {
      const ctx = m.model_limits?.max_sequence_length;
      const out = m.model_limits?.max_output_tokens;
      const fns = (m.functions ?? []).map((f) => f.id);
      return baseModel(cfg.entry, m.model_id!, {
        label: m.label,
        kind: 'chat',
        context: typeof ctx === 'number' && ctx > 0 ? ctx : undefined,
        maxOutput: typeof out === 'number' && out > 0 ? out : undefined,
        capabilities: {
          tools: m.task_ids?.includes('function_calling') ? true : null,
          vision: fns.includes('image_chat') ? true : null,
          reasoning: null,
          fim: null,
        },
      });
    });
}

async function testConnection(cfg: ProviderConfig): Promise<ConnectionTest> {
  try {
    const c = { ...cfg, maxRetries: 0 };
    await watsonxAccessToken(c);
    target(c);
    const models = await listModels(c);
    return { ok: true, models: models.length };
  } catch (e) {
    return e instanceof OmniError
      ? { ok: false, error: e.message, code: e.code, ...(e.status ? { status: e.status } : {}) }
      : { ok: false, error: redact(e instanceof Error ? e.message : String(e)), code: 'unknown' };
  }
}

export const ibmWatsonx: ProviderAdapter = {
  id: ID,
  listModels,
  chat,
  testConnection,
};
