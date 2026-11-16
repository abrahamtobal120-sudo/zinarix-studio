/**
 * Zinarix 3D Pro: a local, OpenAI-compatible HTTP bridge so the Blender add-on (zinarix_ai)
 * can use the models connected in Zinarix (Claude Code, Codex, Ollama, API providers) without
 * keys of its own. Bound to 127.0.0.1 on a random port, guarded by a random bearer token that
 * only the Blender we spawn receives. No Electron imports: main.ts injects the model list and
 * the completion function, so the tests drive it with fakes.
 *
 *   GET  /v1/models            -> {object:'list', data:[{id:'provider/model', object:'model', owned_by}]}
 *   POST /v1/chat/completions  -> {id, object:'chat.completion', created, model, choices:[...]}
 *   errors                     -> {error:{message, type, code}}
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface BridgeModel {
  /** "provider/model", as the user picks it in Zinarix. */
  id: string;
  ownedBy: string;
}

export interface BridgeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BridgeChatRequest {
  /** A listed "provider/model"; undefined = the user's default chat model in Zinarix. */
  model?: string;
  messages: BridgeMessage[];
  maxTokens?: number;
}

export interface BridgeDeps {
  /** Chat models connected in Zinarix. */
  models(): Promise<BridgeModel[]>;
  /** One text-only completion; must honour `signal` (client gone or timeout). */
  complete(req: BridgeChatRequest, signal: AbortSignal): Promise<{ text: string; model: string }>;
}

export interface BridgeInfo {
  /** Base URL of the OpenAI-style API, e.g. http://127.0.0.1:51234/v1 */
  url: string;
  token: string;
}

export interface BridgeOptions {
  maxBodyBytes?: number;
  /** Completion time limit: CLI models can take minutes. */
  timeoutMs?: number;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = 'invalid_request_error',
  ) {
    super(message);
  }
}

/** Hostname of a Host header or Origin URL ("127.0.0.1:5000" -> "127.0.0.1"). */
function hostOf(value: string, isOrigin: boolean): string | null {
  try {
    return new URL(isOrigin ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** OpenAI content: a string or an array of parts; only the text parts are kept. */
function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (!Array.isArray(content)) return null;
  return content
    .map((p) =>
      p && typeof p === 'object' && (p as { type?: unknown }).type === 'text'
        ? String((p as { text?: unknown }).text ?? '')
        : '',
    )
    .join('');
}

export function parseChatBody(body: unknown): BridgeChatRequest {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be a JSON object.');
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || !b.messages.length)
    throw new HttpError(400, '"messages" must be a non-empty array.');
  const messages: BridgeMessage[] = b.messages.map((m, i) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const role = r.role === 'developer' ? 'system' : r.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant')
      throw new HttpError(400, `messages[${i}].role must be system, user or assistant.`);
    const content = textOf(r.content);
    if (content === null) throw new HttpError(400, `messages[${i}].content must be text.`);
    return { role, content };
  });
  if (!messages.some((m) => m.role === 'user'))
    throw new HttpError(400, 'At least one user message is required.');
  const max = b.max_tokens ?? b.max_completion_tokens;
  const maxTokens =
    typeof max === 'number' && Number.isFinite(max) && max > 0
      ? Math.min(Math.trunc(max), 128_000)
      : undefined;
  const model = typeof b.model === 'string' && b.model.trim() ? b.model.trim() : undefined;
  return { model, messages, ...(maxTokens ? { maxTokens } : {}) };
}

export class BlenderBridge {
  private server: Server | null = null;
  private starting: Promise<BridgeInfo> | null = null;
  private readonly token = randomBytes(32).toString('base64url');
  private readonly tokenHash = digest(this.token);
  private readonly maxBody: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly deps: BridgeDeps,
    opts: BridgeOptions = {},
  ) {
    this.maxBody = opts.maxBodyBytes ?? 2 * 1024 * 1024;
    this.timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  }

  /** Starts the server on first use; later calls return the same URL and token. */
  start(): Promise<BridgeInfo> {
    this.starting ??= new Promise<BridgeInfo>((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res));
      // Time to receive a request; the answer itself may take up to timeoutMs.
      server.requestTimeout = 60_000;
      server.headersTimeout = 30_000;
      server.once('error', (e) => {
        this.starting = null;
        reject(e);
      });
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        const { port } = server.address() as AddressInfo;
        resolve({ url: `http://127.0.0.1:${port}/v1`, token: this.token });
      });
    });
    return this.starting;
  }

  close(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.starting = null;
    if (!s) return Promise.resolve();
    return new Promise((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections();
    });
  }

  private authorized(req: IncomingMessage): boolean {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    return !!m && timingSafeEqual(digest(m[1]!.trim()), this.tokenHash);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Blocks DNS rebinding and web pages: only loopback names, only our token.
      const host = hostOf(req.headers.host ?? '', false);
      if (!host || !LOOPBACK.has(host)) throw new HttpError(403, 'Forbidden host.', 'forbidden');
      const origin = req.headers.origin;
      if (origin !== undefined) {
        const o = hostOf(origin, true);
        if (!o || !LOOPBACK.has(o)) throw new HttpError(403, 'Forbidden origin.', 'forbidden');
      }
      if (!this.authorized(req))
        throw new HttpError(401, 'Missing or invalid bridge token.', 'authentication_error');
      const path = (req.url ?? '/').split('?')[0]!.replace(/\/+$/, '');
      if (path === '/v1/models') {
        if (req.method !== 'GET') throw new HttpError(405, 'Use GET.');
        const models = await this.deps.models();
        return json(res, 200, {
          object: 'list',
          data: models.map((m) => ({ id: m.id, object: 'model', created: 0, owned_by: m.ownedBy })),
        });
      }
      if (path === '/v1/chat/completions') {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
        return await this.chat(req, res);
      }
      throw new HttpError(404, `Unknown endpoint ${path || '/'}.`);
    } catch (e) {
      if (res.headersSent || res.destroyed) return;
      if (e instanceof HttpError)
        return json(res, e.status, { error: { message: e.message, type: e.type, code: e.status } });
      const message = e instanceof Error ? e.message : String(e);
      json(res, 502, { error: { message, type: 'server_error', code: 502 } });
    }
  }

  private async chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, this.maxBody);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Body is not valid JSON.');
    }
    const parsed = parseChatBody(body);
    // Unknown names (e.g. the add-on's own default "gpt-4o") fall back to the Zinarix default.
    if (parsed.model) {
      const known = await this.deps.models().catch(() => [] as BridgeModel[]);
      if (!known.some((m) => m.id === parsed.model)) parsed.model = undefined;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new HttpError(504, 'The model took too long to answer.', 'timeout')),
      this.timeoutMs,
    );
    // Blender closed or cancelled: stop the model run too.
    const onClose = () => {
      if (!res.writableEnded) ctrl.abort(new Error('client disconnected'));
    };
    res.on('close', onClose);
    try {
      const r = await this.deps.complete(parsed, ctrl.signal);
      json(res, 200, {
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: r.model,
        choices: [
          { index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' },
        ],
      });
    } catch (e) {
      if (ctrl.signal.reason instanceof HttpError) throw ctrl.signal.reason;
      throw e;
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) {
      req.resume();
      return reject(new HttpError(413, 'Request body too large.'));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.resume();
        reject(new HttpError(413, 'Request body too large.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}
