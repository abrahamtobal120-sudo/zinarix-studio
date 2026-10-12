import { createHash, createHmac } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { OmniError } from '@omni/shared';
import type { ChatChunk, ChatMessage, ChatRequest, ModelInfo, OmniErrorCode } from '@omni/shared';
import { registerSecret } from '@omni/security';
import { abortError, providerMessage, request, requestJson } from '../http.js';
import { baseModel } from '../models.js';
import type { ConnectionTest, ProviderAdapter, ProviderConfig } from '../types.js';
import { normalizeStop } from './openai-compatible.js';

/**
 * Amazon Bedrock through the Converse API (`/model/{modelId}/converse-stream`).
 *
 * The stored secret is either:
 *  - a Bedrock API key (AWS_BEARER_TOKEN_BEDROCK) → `Authorization: Bearer <key>`;
 *  - IAM access keys as `ACCESS_KEY_ID:SECRET_ACCESS_KEY[:SESSION_TOKEN]` or a pasted JSON
 *    (`{"accessKeyId","secretAccessKey","sessionToken"}`, also the `aws sts` / `aws configure
 *    export-credentials` shapes) → every request is signed with SigV4 (service `bedrock`).
 *
 * The streamed response uses the binary AWS event-stream framing, decoded here.
 */

const ID = 'aws-bedrock';
const SERVICE = 'bedrock';
const DEFAULT_REGION = 'us-east-1';
/** A frame larger than this is a broken or hostile server. */
const MAX_FRAME = 16 * 1024 * 1024;
const PRELUDE = 12;

// ---------------------------------------------------------------- credentials

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export type BedrockCredential =
  { kind: 'bearer'; token: string } | ({ kind: 'iam' } & AwsCredentials);

const authError = (message: string, provider?: string) =>
  new OmniError('auth', message, { provider, retryable: false });

const ACCESS_KEY_RE = /^[A-Z0-9]{16,128}$/;

function iam(accessKeyId: string, secretAccessKey: string, sessionToken?: string) {
  const id = accessKeyId.trim();
  const secret = secretAccessKey.trim();
  const token = sessionToken?.trim() || undefined;
  if (!ACCESS_KEY_RE.test(id) || !secret)
    throw authError(
      'AWS credentials must be ACCESS_KEY_ID:SECRET_ACCESS_KEY[:SESSION_TOKEN] (or a Bedrock API key)',
    );
  registerSecret(secret);
  if (token) registerSecret(token);
  return { kind: 'iam' as const, accessKeyId: id, secretAccessKey: secret, sessionToken: token };
}

/** Classifies the pasted secret. Never includes the secret in thrown errors. */
export function parseAwsCredential(secret: string): BedrockCredential {
  const value = secret.trim();
  if (!value) throw authError('empty AWS credential');
  if (value.startsWith('{')) {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(value) as Record<string, unknown>;
    } catch {
      throw authError('the AWS credential looks like JSON but could not be parsed');
    }
    // `aws sts get-session-token` wraps them in "Credentials".
    if (j.Credentials && typeof j.Credentials === 'object')
      j = j.Credentials as Record<string, unknown>;
    const pick = (...keys: string[]) => {
      for (const k of keys) if (typeof j[k] === 'string' && j[k]) return j[k] as string;
      return undefined;
    };
    const id = pick('accessKeyId', 'AccessKeyId', 'aws_access_key_id', 'AWS_ACCESS_KEY_ID');
    const sk = pick(
      'secretAccessKey',
      'SecretAccessKey',
      'aws_secret_access_key',
      'AWS_SECRET_ACCESS_KEY',
    );
    const st = pick('sessionToken', 'SessionToken', 'aws_session_token', 'AWS_SESSION_TOKEN');
    if (id && sk) return iam(id, sk, st);
    const bearer = pick('apiKey', 'bearerToken', 'AWS_BEARER_TOKEN_BEDROCK');
    if (bearer) return { kind: 'bearer', token: bearer };
    throw authError('AWS credential JSON needs accessKeyId and secretAccessKey');
  }
  // Bedrock API keys are base64 (`ABSK…`, `bedrock-api-key-…`): they never contain ':'.
  if (value.includes(':')) {
    const parts = value.split(':');
    if (parts.length < 2 || parts.length > 3)
      throw authError(
        'AWS credentials must be ACCESS_KEY_ID:SECRET_ACCESS_KEY[:SESSION_TOKEN] (or a Bedrock API key)',
      );
    return iam(parts[0]!, parts[1]!, parts[2]);
  }
  return { kind: 'bearer', token: value };
}

// ---------------------------------------------------------------- SigV4

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ */
export function awsUriEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Canonical URI for non-S3 services: the path exactly as sent (already percent-encoded
 * once) with every segment encoded again, so a model id `a:0` sent as `a%3A0` is signed
 * as `a%253A0`.
 */
export function canonicalUri(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname
    .split('/')
    .map((seg) => awsUriEncode(seg))
    .join('/');
}

function canonicalQuery(url: URL): string {
  const pairs: [string, string][] = [];
  for (const [k, v] of url.searchParams) pairs.push([awsUriEncode(k), awsUriEncode(v)]);
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

export function amzDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export interface SigV4Options {
  method: string;
  url: string | URL;
  region: string;
  service: string;
  credentials: AwsCredentials;
  /** Request body as sent (empty string / undefined for GET). */
  body?: string;
  /** Extra headers to include in the signature (host and x-amz-* are always signed). */
  headers?: Record<string, string>;
  date?: Date;
  /** Also send (and sign) x-amz-content-sha256. Optional outside S3. */
  contentSha256?: boolean;
}

/**
 * AWS Signature Version 4. Returns the headers to add to the request: `authorization`,
 * `x-amz-date`, plus `x-amz-security-token` / `x-amz-content-sha256` when applicable.
 * The `host` header is signed but not returned (fetch sets it from the URL).
 */
export function sigV4Headers(o: SigV4Options): Record<string, string> {
  const url = typeof o.url === 'string' ? new URL(o.url) : o.url;
  const stamp = amzDate(o.date ?? new Date());
  const day = stamp.slice(0, 8);
  const payloadHash = sha256Hex(o.body ?? '');
  const out: Record<string, string> = { 'x-amz-date': stamp };
  if (o.credentials.sessionToken) out['x-amz-security-token'] = o.credentials.sessionToken;
  if (o.contentSha256) out['x-amz-content-sha256'] = payloadHash;

  const toSign = new Map<string, string>();
  for (const [k, v] of Object.entries(o.headers ?? {})) toSign.set(k.toLowerCase(), v);
  toSign.set('host', url.host);
  for (const [k, v] of Object.entries(out)) toSign.set(k, v);
  const names = [...toSign.keys()].sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${toSign.get(n)!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    o.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${o.region}/${o.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${o.credentials.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, o.region), o.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  out.authorization = `AWS4-HMAC-SHA256 Credential=${o.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

// ---------------------------------------------------------------- endpoints

const REGION_RE = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;

export function bedrockRegion(cfg: Pick<ProviderConfig, 'params' | 'baseUrl'>): string {
  const param = cfg.params?.region?.trim().toLowerCase();
  if (param) {
    if (!REGION_RE.test(param))
      throw new OmniError('config', `invalid AWS region "${param.slice(0, 40)}"`, {
        provider: 'amazon-bedrock',
        retryable: false,
      });
    return param;
  }
  const m = /bedrock(?:-runtime)?(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com/.exec(cfg.baseUrl ?? '');
  return m && REGION_RE.test(m[1]!) ? m[1]! : DEFAULT_REGION;
}

/** Runtime root URL: the configured base, or the regional host when the base is unresolved. */
function runtimeRoot(cfg: ProviderConfig, region: string): string {
  const base = (cfg.baseUrl ?? '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    if (!base.includes('{') && !u.hostname.includes('..') && !u.hostname.startsWith('.'))
      return base;
  } catch {
    // fall through
  }
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}

/** Control plane (model listing) lives on `bedrock.{region}`; proxies/tests keep their host. */
function controlRoot(cfg: ProviderConfig, region: string): string {
  const root = runtimeRoot(cfg, region);
  const u = new URL(root);
  if (/^bedrock-runtime(-fips)?\./.test(u.hostname)) {
    u.hostname = u.hostname.replace(/^bedrock-runtime/, 'bedrock');
    return u.toString().replace(/\/+$/, '');
  }
  return root;
}

/** Model ids, inference-profile ids and ARNs all go in one path segment (`:` and `/` encoded). */
export function bedrockModelPath(model: string, op = 'converse-stream'): string {
  return `/model/${encodeURIComponent(model.trim())}/${op}`;
}

function credential(cfg: ProviderConfig): BedrockCredential {
  const raw = cfg.apiKey && !cfg.apiKey.isEmpty ? cfg.apiKey.reveal() : undefined;
  if (!raw)
    throw authError(
      'Amazon Bedrock needs a Bedrock API key or IAM keys as ACCESS_KEY_ID:SECRET_ACCESS_KEY',
      cfg.entry.id,
    );
  return parseAwsCredential(raw);
}

/** Auth headers for one request (bearer, or a fresh SigV4 signature over the exact URL/body). */
export function bedrockAuthHeaders(
  cfg: ProviderConfig,
  method: 'GET' | 'POST',
  url: string,
  body?: string,
): Record<string, string> {
  const cred = credential(cfg);
  if (cred.kind === 'bearer') return { authorization: `Bearer ${cred.token}` };
  return sigV4Headers({
    method,
    url,
    body,
    region: bedrockRegion(cfg),
    service: SERVICE,
    credentials: cred,
  });
}

/** http.ts must not add catalog auth (aws-sigv4 throws there): we set the headers ourselves. */
function bare(cfg: ProviderConfig): ProviderConfig {
  return { ...cfg, apiKey: undefined, entry: { ...cfg.entry, auth: { type: 'none' } } };
}

async function signedRequest(
  cfg: ProviderConfig,
  method: 'GET' | 'POST',
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = {},
): Promise<Response> {
  // http.ts serializes with JSON.stringify too: same object → same bytes → same hash.
  const text = body === undefined ? undefined : JSON.stringify(body);
  return request(bare(cfg), {
    method,
    path: url,
    body,
    signal,
    headers: { ...headers, ...bedrockAuthHeaders(cfg, method, url, text) },
  });
}

async function signedJson<T>(cfg: ProviderConfig, url: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(bare(cfg), {
    path: url,
    signal,
    headers: { accept: 'application/json', ...bedrockAuthHeaders(cfg, 'GET', url) },
  });
}

// ---------------------------------------------------------------- event stream

export type EventHeaderValue = string | number | bigint | boolean | Uint8Array | Date;

export interface EventStreamMessage {
  headers: Record<string, EventHeaderValue>;
  payload: Buffer;
}

function frameError(message: string, provider?: string): OmniError {
  return new OmniError('server', `invalid event stream: ${message}`, {
    provider,
    retryable: false,
  });
}

/** Decodes one complete `application/vnd.amazon.eventstream` frame (CRCs verified). */
export function decodeEventStreamMessage(buf: Buffer, provider?: string): EventStreamMessage {
  if (buf.length < PRELUDE + 4) throw frameError('frame too short', provider);
  const total = buf.readUInt32BE(0);
  const headersLen = buf.readUInt32BE(4);
  if (total !== buf.length) throw frameError('length mismatch', provider);
  if (crc32(buf.subarray(0, 8)) !== buf.readUInt32BE(8))
    throw frameError('prelude CRC mismatch', provider);
  if (crc32(buf.subarray(0, total - 4)) !== buf.readUInt32BE(total - 4))
    throw frameError('message CRC mismatch', provider);
  if (PRELUDE + headersLen > total - 4) throw frameError('headers overflow', provider);

  const headers: Record<string, EventHeaderValue> = {};
  let p = PRELUDE;
  const end = PRELUDE + headersLen;
  const need = (n: number) => {
    if (p + n > end) throw frameError('truncated header', provider);
  };
  while (p < end) {
    need(1);
    const nameLen = buf.readUInt8(p++);
    need(nameLen + 1);
    const name = buf.toString('utf8', p, p + nameLen);
    p += nameLen;
    const type = buf.readUInt8(p++);
    let value: EventHeaderValue;
    switch (type) {
      case 0:
        value = true;
        break;
      case 1:
        value = false;
        break;
      case 2:
        need(1);
        value = buf.readInt8(p);
        p += 1;
        break;
      case 3:
        need(2);
        value = buf.readInt16BE(p);
        p += 2;
        break;
      case 4:
        need(4);
        value = buf.readInt32BE(p);
        p += 4;
        break;
      case 5:
        need(8);
        value = buf.readBigInt64BE(p);
        p += 8;
        break;
      case 6:
      case 7: {
        need(2);
        const len = buf.readUInt16BE(p);
        p += 2;
        need(len);
        value =
          type === 7 ? buf.toString('utf8', p, p + len) : new Uint8Array(buf.subarray(p, p + len));
        p += len;
        break;
      }
      case 8:
        need(8);
        value = new Date(Number(buf.readBigInt64BE(p)));
        p += 8;
        break;
      case 9:
        need(16);
        value = new Uint8Array(buf.subarray(p, p + 16));
        p += 16;
        break;
      default:
        throw frameError(`unknown header type ${type}`, provider);
    }
    headers[name] = value;
  }
  return { headers, payload: Buffer.from(buf.subarray(end, total - 4)) };
}

/** Splits a streamed body into event-stream frames, with an idle timeout between chunks. */
export async function* readEventStream(
  body: ReadableStream<Uint8Array> | null,
  opts: { signal?: AbortSignal; idleTimeoutMs?: number; provider?: string } = {},
): AsyncGenerator<EventStreamMessage> {
  if (!body) return;
  const reader = body.getReader();
  const idle = opts.idleTimeoutMs ?? 120_000;
  let buffer: Buffer = Buffer.alloc(0);

  const readChunk = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new OmniError('timeout', `stream idle for ${idle} ms`, { provider: opts.provider }),
              ),
            idle,
          );
          onAbort = () => reject(abortError());
          if (opts.signal?.aborted) onAbort();
          opts.signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    }
  };

  try {
    for (;;) {
      const { value, done } = await readChunk();
      if (done) break;
      if (value?.length) buffer = Buffer.concat([buffer, value]);
      while (buffer.length >= PRELUDE) {
        const total = buffer.readUInt32BE(0);
        if (total < PRELUDE + 4 || total > MAX_FRAME)
          throw frameError(`bad frame length ${total}`, opts.provider);
        if (buffer.length < total) break;
        const frame = buffer.subarray(0, total);
        buffer = buffer.subarray(total);
        yield decodeEventStreamMessage(Buffer.from(frame), opts.provider);
      }
    }
    if (buffer.length) throw frameError('stream ended mid-frame', opts.provider);
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ---------------------------------------------------------------- request body

type Block = Record<string, unknown>;
interface ConverseMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

/** What a turn's `raw` chunk carries: the native blocks plus the model that produced them. */
interface BedrockRaw {
  model: string;
  blocks: Block[];
}

function parseArgs(json: string): unknown {
  try {
    const v = JSON.parse(json || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function imageFormat(mediaType: string): string {
  const t = mediaType.toLowerCase().replace(/^image\//, '');
  return t === 'jpg' ? 'jpeg' : t;
}

/** Strips geo/global inference-profile prefixes and ARNs: `us.anthropic.x` → `anthropic.x`. */
export function baseModelId(model: string): string {
  const m = model.trim();
  const arn = /foundation-model\/(.+)$/.exec(m) ?? /inference-profile\/(.+)$/.exec(m);
  const id = arn ? arn[1]! : m;
  return id.replace(/^(?:us|eu|apac|jp|au|ca|us-gov|global)\./, '');
}

/** Normalized history → Converse messages (system split out, tool results as user blocks). */
export function toConverse(
  messages: ChatMessage[],
  model: string,
): { system: Block[]; messages: ConverseMessage[]; toolNames: Set<string> } {
  const system: Block[] = [];
  const out: ConverseMessage[] = [];
  const toolNames = new Set<string>();
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        if (m.content) system.push({ text: m.content });
        break;
      case 'user':
        push(
          'user',
          typeof m.content === 'string'
            ? m.content
              ? [{ text: m.content }]
              : []
            : m.content.flatMap((p): Block[] =>
                p.type === 'text'
                  ? p.text
                    ? [{ text: p.text }]
                    : []
                  : [{ image: { format: imageFormat(p.mediaType), source: { bytes: p.data } } }],
              ),
        );
        break;
      case 'assistant': {
        const raw = m.raw?.adapter === ID ? (m.raw.content as BedrockRaw | undefined) : undefined;
        if (
          raw &&
          Array.isArray(raw.blocks) &&
          baseModelId(raw.model ?? '') === baseModelId(model)
        ) {
          for (const b of raw.blocks) {
            const tu = b.toolUse as { name?: string } | undefined;
            if (tu?.name) toolNames.add(tu.name);
          }
          push('assistant', raw.blocks);
          break;
        }
        const calls = (m.toolCalls ?? []).map((c) => {
          toolNames.add(c.name);
          return { toolUse: { toolUseId: c.id, name: c.name, input: parseArgs(c.arguments) } };
        });
        push('assistant', [...(m.content ? [{ text: m.content }] : []), ...calls]);
        break;
      }
      case 'tool':
        push('user', [
          {
            toolResult: {
              toolUseId: m.toolCallId,
              content: [{ text: m.content || '(empty)' }],
              ...(m.isError ? { status: 'error' } : {}),
            },
          },
        ]);
        break;
    }
  }
  return { system, messages: out, toolNames };
}

const CLAUDE_BUDGET = { low: 2048, medium: 8192, high: 24_576 } as const;

/** Claude 4.6+ (and 5.x) use adaptive thinking + effort; older ones need a token budget. */
function claudeAdaptive(id: string): boolean {
  const m = /claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  return major > 4 || (major === 4 && minor >= 6);
}

export function buildConverseBody(req: ChatRequest): Record<string, unknown> {
  const { system, messages, toolNames } = toConverse(req.messages, req.model);
  const id = baseModelId(req.model).toLowerCase();
  const inference: Record<string, unknown> = {};
  let maxTokens = req.maxTokens;
  let temperature = req.temperature;
  let extra: Record<string, unknown> | undefined;

  if (req.reasoning) {
    if (id.startsWith('anthropic.claude')) {
      temperature = undefined; // Claude rejects temperature != 1 with thinking on
      if (claudeAdaptive(id)) {
        extra = {
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: req.reasoning },
        };
      } else {
        const budget = CLAUDE_BUDGET[req.reasoning];
        extra = { thinking: { type: 'enabled', budget_tokens: budget } };
        if (!maxTokens || maxTokens <= budget) maxTokens = budget + 8192;
      }
    } else if (id.startsWith('amazon.nova')) {
      extra = { reasoningConfig: { type: 'enabled', maxReasoningEffort: req.reasoning } };
      // Nova rejects temperature / maxTokens with high effort.
      if (req.reasoning === 'high') {
        temperature = undefined;
        maxTokens = undefined;
      }
    } else if (id.startsWith('openai.')) {
      extra = { reasoning_effort: req.reasoning };
    }
  }
  if (maxTokens !== undefined) inference.maxTokens = maxTokens;
  if (temperature !== undefined) inference.temperature = temperature;

  // Converse requires toolConfig whenever the history holds toolUse/toolResult blocks.
  const tools = req.tools?.length
    ? req.tools.map((t) => ({
        toolSpec: {
          name: t.name,
          description: t.description || t.name,
          inputSchema: { json: t.parameters },
        },
      }))
    : [...toolNames].map((name) => ({
        toolSpec: { name, description: name, inputSchema: { json: { type: 'object' } } },
      }));

  return {
    messages,
    ...(system.length ? { system } : {}),
    ...(Object.keys(inference).length ? { inferenceConfig: inference } : {}),
    ...(tools.length ? { toolConfig: { tools } } : {}),
    ...(extra ? { additionalModelRequestFields: extra } : {}),
  };
}

// ---------------------------------------------------------------- chat

interface DeltaEvent {
  contentBlockIndex?: number;
  delta?: {
    text?: string;
    toolUse?: { input?: string };
    reasoningContent?: { text?: string; signature?: string; redactedContent?: string };
  };
  start?: { toolUse?: { toolUseId?: string; name?: string } };
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
  message?: string;
  Message?: string;
}

function exceptionCode(type: string): OmniErrorCode {
  switch (type) {
    case 'throttlingException':
    case 'modelNotReadyException':
      return 'rate_limit';
    case 'validationException':
      return 'bad_request';
    case 'accessDeniedException':
      return 'auth';
    case 'resourceNotFoundException':
      return 'not_found';
    case 'modelTimeoutException':
      return 'timeout';
    default:
      return 'server'; // internalServer, serviceUnavailable, modelStreamError, ...
  }
}

function header(msg: EventStreamMessage, name: string): string {
  const v = msg.headers[name];
  return typeof v === 'string' ? v : '';
}

/** Model needs an inference profile (bare id of a profile-only model). */
function needsProfile(e: unknown, model: string): boolean {
  return (
    e instanceof OmniError &&
    e.code === 'bad_request' &&
    /inference profile|on-demand throughput/i.test(e.message) &&
    baseModelId(model) === model.trim() &&
    !model.startsWith('arn:')
  );
}

async function* chat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const region = bedrockRegion(cfg);
  const root = runtimeRoot(cfg, region);
  const body = buildConverseBody(req);
  const send = (model: string) =>
    signedRequest(cfg, 'POST', root + bedrockModelPath(model), body, signal, { accept: '*/*' });
  let model = req.model;
  let res: Response;
  try {
    res = await send(model);
  } catch (e) {
    // Newer models are only served through cross-region profiles: retry once with global.
    if (!needsProfile(e, model)) throw e;
    model = `global.${model.trim()}`;
    cfg.logger?.debug('bedrock: retrying with a global inference profile', {
      provider: cfg.entry.id,
    });
    res = await send(model);
  }

  const tools = new Map<number, { id: string; name: string }>();
  const blocks: Block[] = [];
  const toolInput = new Map<number, string>();
  let input = 0;
  let cached = 0;
  let cacheWrite = 0;
  let output = 0;
  let stop: string | undefined;

  for await (const msg of readEventStream(res.body, {
    signal,
    idleTimeoutMs: cfg.idleTimeoutMs,
    provider: cfg.entry.id,
  })) {
    const messageType = header(msg, ':message-type');
    const text = msg.payload.toString('utf8');
    let ev: DeltaEvent = {};
    try {
      ev = text ? (JSON.parse(text) as DeltaEvent) : {};
    } catch {
      // non-JSON payload
    }
    if (messageType === 'exception' || messageType === 'error') {
      const type = header(msg, ':exception-type') || header(msg, ':error-code') || 'error';
      const detail =
        ev.message ?? ev.Message ?? (header(msg, ':error-message') || text || 'stream error');
      const code = exceptionCode(type.charAt(0).toLowerCase() + type.slice(1));
      throw new OmniError(code, providerMessage(`${type}: ${detail}`), {
        provider: cfg.entry.id,
      });
    }
    const idx = ev.contentBlockIndex ?? 0;
    switch (header(msg, ':event-type')) {
      case 'contentBlockStart': {
        const tu = ev.start?.toolUse;
        if (tu) {
          const call = { id: tu.toolUseId ?? `tooluse_${idx}`, name: tu.name ?? '' };
          tools.set(idx, call);
          blocks[idx] = { toolUse: { toolUseId: call.id, name: call.name, input: {} } };
          yield { type: 'tool_call', id: call.id, name: call.name, argsDelta: '' };
        }
        break;
      }
      case 'contentBlockDelta': {
        const d = ev.delta ?? {};
        if (typeof d.text === 'string') {
          const b = (blocks[idx] ??= { text: '' });
          b.text = String(b.text ?? '') + d.text;
          if (d.text) yield { type: 'text', delta: d.text };
        } else if (d.reasoningContent) {
          const rc = d.reasoningContent;
          const b = (blocks[idx] ??= { reasoningContent: {} });
          const holder = (b.reasoningContent ??= {}) as Record<string, unknown>;
          if (rc.redactedContent) holder.redactedContent = rc.redactedContent;
          if (rc.text !== undefined || rc.signature !== undefined) {
            const rt = (holder.reasoningText ??= { text: '' }) as Record<string, unknown>;
            if (rc.text) rt.text = String(rt.text ?? '') + rc.text;
            if (rc.signature) rt.signature = rc.signature;
          }
          if (rc.text) yield { type: 'reasoning', delta: rc.text };
        } else if (d.toolUse) {
          const call = tools.get(idx);
          const part = d.toolUse.input ?? '';
          toolInput.set(idx, (toolInput.get(idx) ?? '') + part);
          if (call && part)
            yield { type: 'tool_call', id: call.id, name: call.name, argsDelta: part };
        }
        break;
      }
      case 'messageStop':
        if (ev.stopReason) stop = ev.stopReason;
        break;
      case 'metadata': {
        const u = ev.usage ?? {};
        cached = u.cacheReadInputTokens ?? 0;
        cacheWrite = u.cacheWriteInputTokens ?? 0;
        input = (u.inputTokens ?? 0) + cached + cacheWrite;
        output = u.outputTokens ?? 0;
        break;
      }
      default:
        // messageStart, contentBlockStop, initial-response, unknown future events
        break;
    }
  }
  for (const [i, json] of toolInput) {
    const tu = blocks[i]?.toolUse as Record<string, unknown> | undefined;
    if (tu) tu.input = parseArgs(json);
  }
  const content = blocks.filter(Boolean);
  if (content.length)
    yield { type: 'raw', adapter: ID, content: { model, blocks: content } satisfies BedrockRaw };
  yield {
    type: 'usage',
    inputTokens: input,
    outputTokens: output,
    cachedTokens: cached,
    ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
  };
  const s =
    stop === 'guardrail_intervened' || stop === 'content_filtered'
      ? 'refusal'
      : stop === 'stop_sequence'
        ? 'end_turn'
        : stop;
  yield { type: 'done', stopReason: normalizeStop(s) };
}

// ---------------------------------------------------------------- models

interface FoundationModelSummary {
  modelId?: string;
  modelName?: string;
  providerName?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  responseStreamingSupported?: boolean;
  inferenceTypesSupported?: string[];
  modelLifecycle?: { status?: string };
}

interface InferenceProfileSummary {
  inferenceProfileId?: string;
  inferenceProfileName?: string;
  status?: string;
  models?: { modelArn?: string }[];
}

function modelInfo(cfg: ProviderConfig, id: string, m: FoundationModelSummary, label?: string) {
  const lower = id.toLowerCase();
  return baseModel(cfg.entry, id, {
    label: label ?? m.modelName,
    kind: 'chat',
    capabilities: {
      tools: null,
      vision: m.inputModalities?.includes('IMAGE') ?? null,
      reasoning:
        /anthropic\.claude-(?:opus|sonnet|haiku|fable|mythos)-[4-9]|claude-3-7|nova-2|deepseek\.r1|gpt-oss|kimi-k2-thinking|magistral/.test(
          lower,
        )
          ? true
          : null,
      fim: false,
    },
  });
}

async function listProfiles(
  cfg: ProviderConfig,
  control: string,
  signal?: AbortSignal,
): Promise<InferenceProfileSummary[]> {
  const out: InferenceProfileSummary[] = [];
  let next: string | undefined;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ maxResults: '1000', typeEquals: 'SYSTEM_DEFINED' });
    if (next) q.set('nextToken', next);
    const json = await signedJson<{
      inferenceProfileSummaries?: InferenceProfileSummary[];
      nextToken?: string;
    }>({ ...cfg, maxRetries: 0 }, `${control}/inference-profiles?${q}`, signal);
    out.push(...(json.inferenceProfileSummaries ?? []));
    if (!json.nextToken) break;
    next = json.nextToken;
  }
  return out;
}

async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const control = controlRoot(cfg, bedrockRegion(cfg));
  const json = await signedJson<{ modelSummaries?: FoundationModelSummary[] }>(
    cfg,
    `${control}/foundation-models?byOutputModality=TEXT`,
    signal,
  );
  const text = new Map<string, FoundationModelSummary>();
  for (const m of json.modelSummaries ?? []) {
    if (!m.modelId) continue;
    if (m.modelLifecycle?.status && m.modelLifecycle.status !== 'ACTIVE') continue;
    if (m.responseStreamingSupported === false) continue;
    if (m.inputModalities && !m.inputModalities.includes('TEXT')) continue;
    if (m.outputModalities && !m.outputModalities.includes('TEXT')) continue;
    text.set(m.modelId, m);
  }
  const out = new Map<string, ModelInfo>();
  // Inference profiles first: most current models are only invocable through them.
  try {
    for (const p of await listProfiles(cfg, control, signal)) {
      if (!p.inferenceProfileId || (p.status && p.status !== 'ACTIVE')) continue;
      const arn = p.models?.[0]?.modelArn ?? '';
      const base = /foundation-model\/(.+)$/.exec(arn)?.[1] ?? baseModelId(p.inferenceProfileId);
      const fm = text.get(base);
      if (!fm) continue;
      out.set(
        p.inferenceProfileId,
        modelInfo(cfg, p.inferenceProfileId, fm, p.inferenceProfileName ?? fm.modelName),
      );
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    cfg.logger?.debug('bedrock: inference profile listing failed', {
      provider: cfg.entry.id,
      code: e instanceof OmniError ? e.code : 'unknown',
    });
  }
  for (const [id, m] of text) {
    // Profile-only models cannot be invoked by their bare id.
    if (m.inferenceTypesSupported && !m.inferenceTypesSupported.includes('ON_DEMAND')) continue;
    if (!out.has(id)) out.set(id, modelInfo(cfg, id, m));
  }
  return [...out.values()];
}

async function testConnection(cfg: ProviderConfig): Promise<ConnectionTest> {
  const fail = (e: unknown): ConnectionTest =>
    e instanceof OmniError
      ? { ok: false, error: e.message, code: e.code, ...(e.status ? { status: e.status } : {}) }
      : { ok: false, error: e instanceof Error ? e.message : String(e), code: 'unknown' };
  try {
    credential(cfg);
  } catch (e) {
    return fail(e);
  }
  let listError: unknown;
  try {
    const models = await listModels({ ...cfg, maxRetries: 0 });
    return { ok: true, models: models.length };
  } catch (e) {
    // Keys scoped to inference only may not list models: fall back to a 1-token converse.
    if (!(e instanceof OmniError && (e.status === 403 || e.status === 404))) return fail(e);
    listError = e;
  }
  const model = cfg.entry.fallbackModels[0]?.id;
  if (!model) return fail(listError);
  const ctrl = new AbortController();
  try {
    for await (const c of chat(
      { ...cfg, maxRetries: 0 },
      { model, messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
      ctrl.signal,
    )) {
      if (c.type === 'text' || c.type === 'done') break;
    }
    return { ok: true };
  } catch (e) {
    return fail(e);
  } finally {
    ctrl.abort();
  }
}

export const awsBedrock: ProviderAdapter = {
  id: ID,
  listModels,
  chat,
  testConnection,
};
