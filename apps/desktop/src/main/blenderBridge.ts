/**
 * Zinarix 3D Pro: a local, OpenAI-compatible HTTP bridge so the Blender add-on (zinarix_ai)
 * can use the models connected in Zinarix (Claude Code, Codex, Ollama, API providers) without
 * keys of its own. Bound to 127.0.0.1 on a random port, guarded by a random bearer token that
 * only the Blender we spawn receives. No Electron imports: main.ts injects the model list and
 * the completion function, so the tests drive it with fakes.
 *
 *   GET  /v1/models            -> {object:'list', data:[{id:'provider/model', object:'model', owned_by}]}
 *   POST /v1/chat/completions  -> {id, object:'chat.completion', created, model, choices:[...]}
 *   POST /v1/jobs              -> 202 {id, object:'bridge.job', status:'queued'}   (same body)
 *   GET  /v1/jobs[/:id]        -> the tasks left / one task, with `completion` once done
 *   DELETE /v1/jobs/:id        -> cancels a waiting task (removes a finished one)
 *   errors                     -> {error:{message, type, code}}
 *
 * Jobs (bridgeJobs.ts) are saved to disk: they keep running with the window closed and,
 * after a shutdown, continue the next time Zinarix opens.
 *
 * Web pages: the browser sends an Origin. Loopback origins (a local dev server) and the web
 * origins the user allowed get CORS headers (and the preflight answer, also Chrome's Private
 * Network Access one); any other origin is refused. They still need the token.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { QueueFullError, jobView, type BridgeJob } from './bridgeJobs.js';

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
  /** Preferred port (permanent bridge); taken by something else -> a random one. 0 = random. */
  port?: number;
  /** Fixed bearer token (permanent bridge, persisted by the caller); default random. */
  token?: string;
  /** Web origins allowed to call the bridge from a browser (read on every request). */
  origins?: () => readonly string[];
  /** The persistent task queue (POST /v1/jobs); without it those endpoints answer 404. */
  jobs?: {
    add(req: BridgeChatRequest, title?: string): BridgeJob;
    list(): BridgeJob[];
    get(id: string): BridgeJob | null;
    cancel(id: string): boolean;
  };
}

/**
 * "https://app.example.com/path" -> "https://app.example.com"; null when it is not an http(s)
 * origin (wildcards, file:, garbage). What the user types as an allowed web origin.
 */
export function normalizeOrigin(value: string): string | null {
  const v = value.trim();
  if (!v || v.includes('*')) return null;
  try {
    const u = new URL(/^[a-z][\w+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || !u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
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
  private readonly token: string;
  private readonly tokenHash: Buffer;
  private readonly maxBody: number;
  private readonly timeoutMs: number;
  private readonly port: number;
  private readonly origins: () => readonly string[];
  private readonly jobs: BridgeOptions['jobs'];

  constructor(
    private readonly deps: BridgeDeps,
    opts: BridgeOptions = {},
  ) {
    this.maxBody = opts.maxBodyBytes ?? 2 * 1024 * 1024;
    this.timeoutMs = opts.timeoutMs ?? 10 * 60_000;
    this.port = opts.port ?? 0;
    this.origins = opts.origins ?? (() => []);
    this.jobs = opts.jobs;
    this.token = opts.token && opts.token.length >= 32 ? opts.token : newBridgeToken();
    this.tokenHash = digest(this.token);
  }

  /** The running bridge, or null when it is closed. */
  get info(): BridgeInfo | null {
    const a = this.server?.address() as AddressInfo | null | undefined;
    return a ? { url: `http://127.0.0.1:${a.port}/v1`, token: this.token } : null;
  }

  /** Starts the server on first use; later calls return the same URL and token. */
  start(): Promise<BridgeInfo> {
    this.starting ??= new Promise<BridgeInfo>((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res));
      // Time to receive a request; the answer itself may take up to timeoutMs.
      server.requestTimeout = 60_000;
      server.headersTimeout = 30_000;
      const listen = (port: number) => {
        server.once('error', (e: NodeJS.ErrnoException) => {
          // The preferred port is busy (another app, another Zinarix): any free one will do.
          if (port && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) return listen(0);
          this.starting = null;
          reject(e);
        });
        server.listen(port, '127.0.0.1', () => {
          server.removeAllListeners('error');
          server.on('error', () => undefined); // Late socket errors must not crash main.
          this.server = server;
          resolve(this.info!);
        });
      };
      listen(this.port);
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
      // Blocks DNS rebinding and foreign web pages: loopback names, allowed origins, our token.
      const host = hostOf(req.headers.host ?? '', false);
      if (!host || !LOOPBACK.has(host)) throw new HttpError(403, 'Forbidden host.', 'forbidden');
      const origin = req.headers.origin;
      if (origin !== undefined) {
        const o = hostOf(origin, true);
        const own = normalizeOrigin(origin);
        const allowed = (!!o && LOOPBACK.has(o)) || (!!own && this.origins().includes(own));
        if (!allowed) throw new HttpError(403, 'Forbidden origin.', 'forbidden');
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
        if (req.method === 'OPTIONS') {
          // Preflight: browsers send it without the token.
          res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('access-control-allow-headers', 'authorization, content-type');
          res.setHeader('access-control-max-age', '600');
          if (req.headers['access-control-request-private-network'] === 'true')
            res.setHeader('access-control-allow-private-network', 'true');
          res.writeHead(204).end();
          return;
        }
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
      const job = /^\/v1\/jobs(?:\/([\w-]{1,80}))?$/.exec(path);
      if (job && this.jobs) return await this.job(req, res, job[1]);
      throw new HttpError(404, `Unknown endpoint ${path || '/'}.`);
    } catch (e) {
      if (res.headersSent || res.destroyed) return;
      if (e instanceof HttpError)
        return json(res, e.status, { error: { message: e.message, type: e.type, code: e.status } });
      const message = e instanceof Error ? e.message : String(e);
      json(res, 502, { error: { message, type: 'server_error', code: 502 } });
    }
  }

  /** Reads and checks a chat body (the completions one, also used by jobs). */
  private async readChat(
    req: IncomingMessage,
  ): Promise<{ body: unknown; parsed: BridgeChatRequest }> {
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
    return { body, parsed };
  }

  private async job(req: IncomingMessage, res: ServerResponse, id?: string): Promise<void> {
    const jobs = this.jobs!;
    if (!id) {
      if (req.method === 'GET')
        return json(res, 200, { object: 'list', data: jobs.list().reverse().map(jobView) });
      if (req.method !== 'POST') throw new HttpError(405, 'Use GET or POST.');
      const { body, parsed } = await this.readChat(req);
      const t = (body as { title?: unknown }).title;
      try {
        return json(
          res,
          202,
          jobView(jobs.add(parsed, typeof t === 'string' ? t.trim() : undefined)),
        );
      } catch (e) {
        if (e instanceof QueueFullError) throw new HttpError(429, e.message, 'rate_limit_error');
        throw e;
      }
    }
    if (req.method === 'GET') {
      const j = jobs.get(id);
      if (!j) throw new HttpError(404, 'Unknown job.', 'not_found');
      return json(res, 200, jobView(j));
    }
    if (req.method === 'DELETE') {
      if (!jobs.cancel(id)) throw new HttpError(404, 'Unknown job.', 'not_found');
      const j = jobs.get(id);
      return json(res, 200, j ? jobView(j) : { id, object: 'bridge.job', deleted: true });
    }
    throw new HttpError(405, 'Use GET or DELETE.');
  }

  private async chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { parsed } = await this.readChat(req);
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

/** A new random bearer token for the bridge. */
export function newBridgeToken(): string {
  return randomBytes(32).toString('base64url');
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
