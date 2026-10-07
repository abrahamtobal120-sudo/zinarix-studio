import { OmniError, errorCodeForStatus } from '@omni/shared';
import { redact } from '@omni/security';
import type { ProviderConfig } from './types.js';

export interface HttpRequest {
  method?: 'GET' | 'POST';
  /** Path relative to cfg.baseUrl (leading slash) or an absolute URL. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip auth headers (e.g. public endpoints). */
  noAuth?: boolean;
}

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_RETRIES = 3;
const MAX_BACKOFF = 30_000;

export function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

/** Builds the auth headers / query params described by the catalog entry. */
export function applyAuth(cfg: ProviderConfig, url: URL, headers: Record<string, string>): void {
  const auth = cfg.entry.auth;
  const key = cfg.apiKey && !cfg.apiKey.isEmpty ? cfg.apiKey.reveal() : undefined;
  switch (auth.type) {
    case 'bearer':
      if (key) headers[auth.header ?? 'Authorization'] = `Bearer ${key}`;
      break;
    case 'header':
      if (key) headers[auth.header ?? 'x-api-key'] = key;
      break;
    case 'query':
      if (key) url.searchParams.set(auth.queryParam ?? 'key', key);
      break;
    case 'none':
      // Local servers started with --api-key still accept an optional bearer token.
      if (key) headers.Authorization = `Bearer ${key}`;
      break;
    case 'aws-sigv4':
      throw new OmniError(
        'unsupported',
        'AWS SigV4 auth requires the aws-bedrock adapter (Phase 3)',
        {
          provider: cfg.entry.id,
        },
      );
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function backoff(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_BACKOFF * 2);
  const base = Math.min(MAX_BACKOFF, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function abortError(): OmniError {
  return new OmniError('aborted', 'aborted', { retryable: false });
}

/** Extracts a human readable message from a provider error body, redacted. */
export function describeErrorBody(text: string): string {
  let msg = text;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const err = (j.error ?? j) as Record<string, unknown> | string;
    if (typeof err === 'string') msg = err;
    else if (typeof err.message === 'string') msg = err.message;
    else if (typeof j.message === 'string') msg = j.message;
    else if (typeof j.detail === 'string') msg = j.detail;
  } catch {
    // not JSON
  }
  return redact(msg).slice(0, 500);
}

export async function errorFromResponse(res: Response, provider: string): Promise<OmniError> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    // ignore
  }
  const code = errorCodeForStatus(res.status);
  return new OmniError(code, `HTTP ${res.status}: ${describeErrorBody(text) || res.statusText}`, {
    status: res.status,
    provider,
    retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
  });
}

/**
 * fetch with: auth, timeout, caller cancellation, exponential backoff with jitter,
 * Retry-After, and normalized errors. Retries only happen before a response body is
 * handed to the caller, so a stream that already emitted tokens is never replayed.
 */
export async function request(cfg: ProviderConfig, req: HttpRequest): Promise<Response> {
  const provider = cfg.entry.id;
  const fetchImpl = cfg.fetch ?? fetch;
  const maxRetries = cfg.maxRetries ?? DEFAULT_RETRIES;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT;

  const url = new URL(joinUrl(cfg.baseUrl, req.path));
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'user-agent': 'ZinarixStudio/0.1',
    ...cfg.entry.extraHeaders,
    ...cfg.extraHeaders,
    ...req.headers,
  };
  if (req.body !== undefined) headers['content-type'] = 'application/json';
  if (!req.noAuth) applyAuth(cfg, url, headers);
  const body = req.body === undefined ? undefined : JSON.stringify(req.body);

  for (let attempt = 0; ; attempt++) {
    if (req.signal?.aborted) throw abortError();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    let err: OmniError;
    try {
      const res = await fetchImpl(url, { method: req.method ?? 'GET', headers, body, signal });
      if (res.ok) return res;
      err = await errorFromResponse(res, provider);
    } catch (e) {
      if (req.signal?.aborted) throw abortError();
      if (timeout.aborted) {
        err = new OmniError('timeout', `timeout after ${timeoutMs} ms`, { provider });
      } else if (e instanceof OmniError) {
        throw e;
      } else {
        // Network errors can echo the URL, which may carry a query-param key.
        err = new OmniError(
          'network',
          redact(
            e instanceof Error
              ? e.cause instanceof Error
                ? e.cause.message
                : e.message
              : String(e),
          ),
          {
            provider,
          },
        );
      }
    }
    cfg.logger?.debug('provider request failed', {
      provider,
      code: err.code,
      status: err.status,
      attempt,
    });
    if (!err.retryable || attempt >= maxRetries) throw err;
    await sleep(backoff(attempt, err.retryAfterMs), req.signal);
  }
}

export async function requestJson<T>(cfg: ProviderConfig, req: HttpRequest): Promise<T> {
  const res = await request(cfg, req);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OmniError('server', `invalid JSON from provider: ${describeErrorBody(text)}`, {
      provider: cfg.entry.id,
    });
  }
}
