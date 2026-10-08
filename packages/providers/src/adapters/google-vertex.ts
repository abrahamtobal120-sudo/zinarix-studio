import { createHash, createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatRequest, ModelInfo } from '@omni/shared';
import { redact, registerSecret } from '@omni/security';
import { abortError, request } from '../http.js';
import { catalogModels } from '../models.js';
import type { ProviderAdapter, ProviderConfig } from '../types.js';
import { geminiBody, readGeminiStream } from './google-gemini.js';
import { testViaModelsOrChat } from './openai-compatible.js';

/**
 * Google Cloud Vertex AI, Gemini native format (`publishers/google/models/*`).
 *
 * The stored secret can be one of:
 *  - a Vertex AI API key (express mode) → `x-goog-api-key`;
 *  - a service-account JSON key → we mint an OAuth2 access token (JWT bearer grant);
 *  - an `authorized_user` JSON (gcloud application-default credentials) → refresh-token grant;
 *  - a raw OAuth access token (`ya29.…`, e.g. `gcloud auth print-access-token`) → bearer;
 *  - an absolute path to one of the JSON files above (GOOGLE_APPLICATION_CREDENTIALS).
 */

const RAW_TAG = 'google-vertex';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GLOBAL_HOST = 'https://aiplatform.googleapis.com';
/** Refresh this long before the token expires. */
const EXPIRY_MARGIN_MS = 60_000;
const TOKEN_TIMEOUT_MS = 30_000;

interface ServiceAccount {
  kind: 'service-account';
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
  tokenUri: string;
  projectId?: string;
}

interface AuthorizedUser {
  kind: 'authorized-user';
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUri: string;
  projectId?: string;
}

export type VertexCredential =
  | { kind: 'api-key'; key: string }
  | { kind: 'access-token'; token: string }
  | ServiceAccount
  | AuthorizedUser;

const authError = (message: string, provider?: string) =>
  new OmniError('auth', message, { provider, retryable: false });

/** Only Google's endpoint, or a loopback server (tests, local proxies), may receive a JWT. */
function checkTokenUri(uri: unknown): string {
  if (uri === undefined) return DEFAULT_TOKEN_URI;
  if (typeof uri === 'string') {
    try {
      const u = new URL(uri);
      if (u.protocol === 'https:' && u.hostname.endsWith('.googleapis.com')) return uri;
      if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))
        return uri;
    } catch {
      // fall through
    }
  }
  throw authError('service-account JSON: token_uri must be a googleapis.com URL');
}

/** Classifies the pasted secret. Never includes the secret in thrown errors. */
export function parseVertexCredential(raw: string): VertexCredential {
  const value = raw.trim();
  if (value.startsWith('{')) {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(value) as Record<string, unknown>;
    } catch {
      throw authError(
        'the Vertex AI credential looks like JSON but could not be parsed (paste the whole service-account key file)',
      );
    }
    const str = (k: string) => (typeof j[k] === 'string' && j[k] ? (j[k] as string) : undefined);
    const projectId = str('project_id') ?? str('quota_project_id');
    if (str('private_key') && str('client_email')) {
      const privateKey = str('private_key')!;
      registerSecret(privateKey);
      return {
        kind: 'service-account',
        clientEmail: str('client_email')!,
        privateKey,
        privateKeyId: str('private_key_id'),
        tokenUri: checkTokenUri(j.token_uri),
        projectId,
      };
    }
    if (j.type === 'authorized_user' && str('refresh_token') && str('client_id')) {
      registerSecret(str('refresh_token')!);
      if (str('client_secret')) registerSecret(str('client_secret')!);
      return {
        kind: 'authorized-user',
        clientId: str('client_id')!,
        clientSecret: str('client_secret') ?? '',
        refreshToken: str('refresh_token')!,
        tokenUri: checkTokenUri(j.token_uri),
        projectId,
      };
    }
    throw authError(
      'unsupported Google credential JSON: expected a service-account key (private_key + client_email)',
    );
  }
  if (value.startsWith('ya29.')) return { kind: 'access-token', token: value };
  return { kind: 'api-key', key: value };
}

/** Reads GOOGLE_APPLICATION_CREDENTIALS-style paths; anything else is the credential itself. */
async function loadCredential(raw: string): Promise<VertexCredential> {
  const value = raw.trim();
  if (isAbsolute(value) && /\.json$/i.test(value) && !value.includes('\n')) {
    let text: string;
    try {
      text = await readFile(value, 'utf8');
    } catch {
      throw authError('could not read the Google credentials file');
    }
    registerSecret(text);
    return parseVertexCredential(text);
  }
  return parseVertexCredential(value);
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** Signed RS256 JWT for the OAuth2 JWT-bearer grant. */
export function serviceAccountAssertion(sa: ServiceAccount, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT', ...(sa.privateKeyId ? { kid: sa.privateKeyId } : {}) };
  const claims = { iss: sa.clientEmail, scope: SCOPE, aud: sa.tokenUri, iat, exp: iat + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  let signature: Buffer;
  try {
    signature = createSign('RSA-SHA256').update(unsigned).sign(sa.privateKey);
  } catch {
    // node:crypto errors never echo the key, but keep the message generic anyway.
    throw authError('service-account JSON: private_key is not a valid PEM RSA key');
  }
  return `${unsigned}.${b64url(signature)}`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

/** For tests. */
export function clearVertexTokenCache(): void {
  tokenCache.clear();
  inflight.clear();
}

function cacheKey(c: ServiceAccount | AuthorizedUser): string {
  const material =
    c.kind === 'service-account'
      ? `sa\0${c.clientEmail}\0${c.privateKey}\0${c.tokenUri}`
      : `user\0${c.clientId}\0${c.refreshToken}\0${c.tokenUri}`;
  return createHash('sha256').update(material).digest('hex');
}

async function exchangeToken(
  cfg: ProviderConfig,
  cred: ServiceAccount | AuthorizedUser,
  signal?: AbortSignal,
): Promise<CachedToken> {
  const form = new URLSearchParams(
    cred.kind === 'service-account'
      ? {
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: serviceAccountAssertion(cred),
        }
      : {
          grant_type: 'refresh_token',
          client_id: cred.clientId,
          client_secret: cred.clientSecret,
          refresh_token: cred.refreshToken,
        },
  );
  const timeout = AbortSignal.timeout(cfg.timeoutMs ?? TOKEN_TIMEOUT_MS);
  let res: Response;
  try {
    res = await (cfg.fetch ?? fetch)(cred.tokenUri, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': 'ZinarixStudio/0.1',
      },
      body: form.toString(),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (timeout.aborted)
      throw new OmniError('timeout', 'timeout while requesting a Google OAuth token', {
        provider: cfg.entry.id,
      });
    throw new OmniError(
      'network',
      `Google OAuth token request failed: ${redact(e instanceof Error ? e.message : String(e))}`,
      { provider: cfg.entry.id },
    );
  }
  const text = await res.text().catch(() => '');
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  if (!res.ok || typeof body.access_token !== 'string') {
    const detail = [body.error, body.error_description]
      .filter((x): x is string => typeof x === 'string')
      .join(': ');
    throw new OmniError(
      res.status >= 500 ? 'server' : 'auth',
      `Google OAuth token exchange failed (HTTP ${res.status})${detail ? `: ${redact(detail).slice(0, 300)}` : ''}`,
      { provider: cfg.entry.id, status: res.status, retryable: res.status >= 500 },
    );
  }
  const token = body.access_token;
  registerSecret(token);
  const ttlSec = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  return { token, expiresAt: Date.now() + ttlSec * 1000 };
}

/** Returns a valid OAuth access token, minting one only when the cached one is near expiry. */
export async function vertexAccessToken(
  cfg: ProviderConfig,
  cred: ServiceAccount | AuthorizedUser,
  signal?: AbortSignal,
): Promise<string> {
  const key = cacheKey(cred);
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return hit.token;
  let pending = inflight.get(key);
  if (!pending) {
    pending = exchangeToken(cfg, cred, signal).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const fresh = await pending;
  tokenCache.set(key, fresh);
  return fresh.token;
}

export interface VertexUrlOptions {
  location?: string;
  projectId?: string;
  model: string;
  method: 'streamGenerateContent' | 'generateContent' | 'countTokens';
  /** Replaces `https://{host}` (custom base URL / proxy / tests). */
  root?: string;
}

/** Accepts bare ids plus `google/…` and `publishers/google/models/…` forms. */
export function vertexModelId(model: string): string {
  return model.replace(/^publishers\/google\/models\//, '').replace(/^google\//, '');
}

export function vertexHost(location = 'global'): string {
  const loc = location.trim().toLowerCase() || 'global';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(loc))
    throw new OmniError('config', `invalid Vertex AI location "${location.slice(0, 40)}"`);
  return loc === 'global' ? GLOBAL_HOST : `https://${loc}-aiplatform.googleapis.com`;
}

/**
 * `{host}/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:{method}`,
 * or the project-less express-mode path `{global host}/v1/publishers/google/models/{model}:{method}`.
 */
export function vertexUrl(o: VertexUrlOptions): string {
  const location = o.location?.trim().toLowerCase() || 'global';
  const model = encodeURIComponent(vertexModelId(o.model)).replace(/%2E/g, '.');
  const tail = `publishers/google/models/${model}:${o.method}`;
  const project = o.projectId?.trim();
  if (!project) return `${(o.root ?? GLOBAL_HOST).replace(/\/+$/, '')}/v1/${tail}`;
  if (!/^[A-Za-z0-9.:-]+$/.test(project))
    throw new OmniError('config', `invalid GCP project id "${project.slice(0, 60)}"`);
  const host = vertexHost(location); // also validates the location (it ends up in the URL)
  const root = (o.root ?? host).replace(/\/+$/, '');
  return `${root}/v1/projects/${encodeURIComponent(project).replace(/%3A/g, ':')}/locations/${location}/${tail}`;
}

interface ResolvedAuth {
  headers: Record<string, string>;
  projectId?: string;
  /** API-key requests may omit the project (Vertex AI express mode). */
  projectOptional: boolean;
}

export async function resolveVertexAuth(
  cfg: ProviderConfig,
  signal?: AbortSignal,
): Promise<ResolvedAuth> {
  const raw = cfg.apiKey && !cfg.apiKey.isEmpty ? cfg.apiKey.reveal() : undefined;
  if (!raw)
    throw authError(
      'Vertex AI needs an API key, a service-account JSON key or an OAuth access token',
      cfg.entry.id,
    );
  const cred = await loadCredential(raw);
  const projectParam = cfg.params?.project_id?.trim() || undefined;
  switch (cred.kind) {
    case 'api-key':
      return {
        headers: { 'x-goog-api-key': cred.key },
        projectId: projectParam,
        projectOptional: true,
      };
    case 'access-token':
      return {
        headers: { authorization: `Bearer ${cred.token}` },
        projectId: projectParam,
        projectOptional: false,
      };
    default:
      return {
        headers: { authorization: `Bearer ${await vertexAccessToken(cfg, cred, signal)}` },
        projectId: projectParam ?? cred.projectId,
        projectOptional: false,
      };
  }
}

/** Custom base URLs (proxies, tests) replace the regional host; the catalog default does not. */
function customRoot(cfg: ProviderConfig): string | undefined {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  if (!base || base === cfg.entry.baseUrl.replace(/\/+$/, '')) return undefined;
  return base.replace(/\/v1$/, '');
}

async function endpoint(
  cfg: ProviderConfig,
  model: string,
  method: VertexUrlOptions['method'],
  signal?: AbortSignal,
): Promise<{ url: string; headers: Record<string, string> }> {
  const auth = await resolveVertexAuth(cfg, signal);
  if (!auth.projectId && !auth.projectOptional)
    throw new OmniError(
      'config',
      `${cfg.entry.id} needs "project_id" with OAuth credentials: omni auth add ${cfg.entry.id} --param project_id=<id>`,
      { provider: cfg.entry.id, retryable: false },
    );
  const url = vertexUrl({
    location: cfg.params?.location,
    projectId: auth.projectId,
    model,
    method,
    root: customRoot(cfg),
  });
  return { url, headers: auth.headers };
}

async function* chat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const { url, headers } = await endpoint(cfg, req.model, 'streamGenerateContent', signal);
  // apiKey is dropped so http.ts does not add the catalog auth header with the raw secret.
  const res = await request(
    { ...cfg, apiKey: undefined },
    {
      method: 'POST',
      path: url,
      query: { alt: 'sse' },
      body: geminiBody(req, RAW_TAG),
      headers,
      signal,
    },
  );
  yield* readGeminiStream(cfg, res, signal, RAW_TAG);
}

/**
 * Vertex has no API-key-friendly listing of publisher models, so the catalog list is used.
 * Credentials are still resolved (a service-account key is exchanged for a token), so a
 * broken JSON key or a missing project id is reported when the provider is saved.
 */
async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const model = cfg.entry.fallbackModels[0]?.id ?? 'gemini-2.5-flash';
  await endpoint(cfg, model, 'generateContent', signal);
  return catalogModels(cfg.entry);
}

export const googleVertex: ProviderAdapter = {
  id: RAW_TAG,
  listModels,
  chat,
  testConnection(cfg) {
    return testViaModelsOrChat(googleVertex, cfg);
  },
};
