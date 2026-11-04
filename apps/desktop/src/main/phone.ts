import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import type { PhoneAction, PhoneRepo, PhoneSnapshot, PhoneStatus } from '../shared/api.js';
import { phonePage } from './phonePage.js';
import { Tunnel } from './tunnel.js';

/** Preferred port (the phone keeps working after a restart); another one if it is taken. */
const PORT = 47390;
/** Wrong PINs before it changes (6 digits: guessing is hopeless with this limit). */
const MAX_TRIES = 5;

const Action = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('send'), text: z.string().min(1).max(20_000) }),
  z.object({
    kind: z.literal('decide'),
    toolCallId: z.string().min(1).max(200),
    decision: z.enum(['approve', 'deny']),
  }),
  z.object({ kind: z.literal('stop') }),
  z.object({ kind: z.literal('select'), chatId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('newChat') }),
  z.object({ kind: z.literal('agent'), on: z.boolean() }),
]);

/** The repositories of this computer, for the phone (see main.ts). */
export interface PhoneRepos {
  list(): Promise<PhoneRepo[]>;
  /** git pull (fast-forward only); returns git's output. Only paths that list() returns. */
  pull(path: string): Promise<string>;
  /** Opens the repository in the window the phone controls (the chat then works on it). */
  open(path: string): Promise<void>;
}

const RepoPath = z.object({ path: z.string().min(1).max(4096) });

/** IPv4 of this computer on the local network (Wi-Fi / Ethernet), private ranges first. */
export function lanAddress(): string | null {
  const all = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
  const priv = (ip: string) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return all.find(priv) ?? all[0] ?? null;
}

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Remote control from a phone on the same network: a small page served over HTTP. The phone
 * pairs once with a PIN shown on the computer and gets a token; with it, it sees the chats
 * and sends messages, approvals and stops, which go to the window that started it.
 *
 * Optionally also from anywhere: a Cloudflare tunnel gives a public https address. Pairing
 * through it needs, besides the PIN, a long random key that only travels in the link the
 * user copies (after the #, so it is not even sent to Cloudflare in the URL).
 */
export class PhoneRemote {
  private server: Server | null = null;
  private host = '';
  private pin = '';
  private tries = 0;
  private tokens = new Set<string>();
  private streams = new Set<ServerResponse>();
  private snapshot: PhoneSnapshot | null = null;
  /** Grows with each snapshot; long polls wait until it changes. */
  private version = 0;
  private waiters = new Set<() => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private port = 0;
  private tunnel = new Tunnel();
  private remote: { url?: string; key: string; progress?: string; error?: string } | null = null;

  constructor(
    private onAction: (a: PhoneAction) => void,
    private onStatus: (s: PhoneStatus) => void,
    private repos: PhoneRepos,
  ) {}

  status(): PhoneStatus {
    if (!this.server) return { running: false, phones: 0 };
    const r = this.remote;
    return {
      running: true,
      url: `http://${this.host}`,
      pin: this.pin,
      phones: this.tokens.size,
      remote: r
        ? {
            url: r.url ? `${r.url}/#k=${r.key}` : undefined,
            progress: r.progress,
            error: r.error,
          }
        : undefined,
    };
  }

  async start(): Promise<PhoneStatus> {
    if (this.server) return this.status();
    const ip = lanAddress();
    if (!ip)
      return {
        running: false,
        phones: 0,
        error: 'Esta computadora no está conectada a una red (Wi-Fi o cable).',
      };
    const server = createServer((req, res) => void this.route(req, res));
    const port = await new Promise<number>((ok, fail) => {
      const listen = (p: number) => {
        server.once('error', (e: NodeJS.ErrnoException) =>
          e.code === 'EADDRINUSE' && p !== 0 ? listen(0) : fail(e),
        );
        server.listen(p, '0.0.0.0', () => {
          const a = server.address();
          ok(typeof a === 'object' && a ? a.port : p);
        });
      };
      listen(PORT);
    });
    this.server = server;
    this.port = port;
    this.host = `${ip}:${port}`;
    this.newPin();
    this.heartbeat = setInterval(() => {
      for (const s of this.streams) s.write(': ping\n\n');
    }, 20_000);
    this.heartbeat.unref();
    return this.status();
  }

  /** Turns access from anywhere (the tunnel) on or off; progress arrives through onStatus. */
  async setRemote(on: boolean): Promise<PhoneStatus> {
    if (!on || !this.server) {
      this.tunnel.stop();
      this.remote = null;
      return this.status();
    }
    if (this.remote?.url || this.remote?.progress) return this.status();
    const remote: NonNullable<PhoneRemote['remote']> = { key: randomBytes(24).toString('hex') };
    this.remote = remote;
    const live = () => this.remote === remote;
    try {
      const url = await this.tunnel.start(
        this.port,
        (progress) => {
          if (!live()) return;
          remote.progress = progress;
          this.onStatus(this.status());
        },
        (error) => {
          if (!live()) return;
          remote.url = undefined;
          remote.error = error;
          this.onStatus(this.status());
        },
      );
      if (!live()) {
        this.tunnel.stop();
        return this.status();
      }
      remote.url = url;
    } catch (e) {
      if (live()) remote.error = e instanceof Error ? e.message : String(e);
    }
    remote.progress = undefined;
    return this.status();
  }

  stop(): PhoneStatus {
    this.tunnel.stop();
    this.remote = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const s of this.streams) s.end();
    this.streams.clear();
    this.tokens.clear();
    this.snapshot = null;
    this.wake();
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = null;
    return this.status();
  }

  /** The window's chats changed: every connected phone gets the new view. */
  push(snapshot: PhoneSnapshot): void {
    if (!this.server) return;
    this.snapshot = snapshot;
    this.version++;
    this.wake();
    const data = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const s of this.streams) s.write(data);
  }

  private wake(): void {
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  /**
   * The PIN shown on the computer (phones and chat bots pair with it). Too many wrong tries
   * change it, so guessing is hopeless.
   */
  checkPin(pin: string): boolean {
    if (!this.server) return false;
    if (same(pin.replace(/\D/g, '').padEnd(6, ' '), this.pin)) {
      this.tries = 0;
      return true;
    }
    if (++this.tries >= MAX_TRIES) {
      this.newPin();
      this.onStatus(this.status());
    }
    return false;
  }

  private newPin(): void {
    this.pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.tries = 0;
  }

  private authorized(req: IncomingMessage, url: URL): boolean {
    const header = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    // EventSource cannot send headers: the event stream carries the token in the URL.
    const token = header ?? url.searchParams.get('token') ?? '';
    for (const t of this.tokens) if (same(t, token)) return true;
    return false;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Only these addresses: a web page elsewhere cannot reach the remote through DNS tricks.
      const host = req.headers.host ?? '';
      const tunnelHost = this.remote?.url ? new URL(this.remote.url).host : null;
      if (host !== this.host && host !== tunnelHost && host !== `127.0.0.1:${this.port}`)
        return end(res, 421, { error: 'host' });
      // The tunnel reaches the server from this same computer: everything local is "remote".
      const viaTunnel = /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');
      const url = new URL(req.url ?? '/', `http://${this.host}`);
      if (req.method === 'GET' && url.pathname === '/') {
        const nonce = randomBytes(16).toString('base64');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
        return void res.end(phonePage(nonce));
      }
      if (req.method === 'POST' && url.pathname === '/api/pair') {
        const { pin, key } = z
          .object({ pin: z.string().max(20), key: z.string().max(200).optional() })
          .parse(await body(req));
        // Through the tunnel the address is public: the key of the link is required too.
        if (viaTunnel && !(this.remote?.url && same(key ?? '', this.remote.key)))
          return end(res, 403, { error: 'Enlace incompleto: copia otra vez el enlace de Zinarix' });
        if (!this.checkPin(pin)) return end(res, 403, { error: 'PIN incorrecto' });
        const token = randomBytes(32).toString('hex');
        this.tokens.add(token);
        this.onStatus(this.status());
        return end(res, 200, { token });
      }
      if (!url.pathname.startsWith('/api/')) return end(res, 404, { error: 'not found' });
      if (!this.authorized(req, url)) return end(res, 401, { error: 'unpaired' });
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        this.streams.add(res);
        req.on('close', () => this.streams.delete(res));
        if (this.snapshot) res.write(`data: ${JSON.stringify(this.snapshot)}\n\n`);
        return;
      }
      // Long polling, for the tunnel: Cloudflare holds an event stream back, not a response.
      if (req.method === 'GET' && url.pathname === '/api/poll') {
        const seen = Number(url.searchParams.get('v'));
        const changed = () => this.snapshot !== null && this.version !== seen;
        if (!changed()) {
          await new Promise<void>((ok) => {
            const done = () => {
              clearTimeout(timer);
              this.waiters.delete(done);
              ok();
            };
            const timer = setTimeout(done, 25_000);
            this.waiters.add(done);
            req.on('close', done);
          });
        }
        if (!changed()) return void res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
        return end(res, 200, { v: this.version, snapshot: this.snapshot });
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        this.onAction(Action.parse(await body(req)));
        return end(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/repos')
        return end(res, 200, { repos: await this.repos.list() });
      if (
        req.method === 'POST' &&
        (url.pathname === '/api/repos/pull' || url.pathname === '/api/repos/open')
      ) {
        const { path } = RepoPath.parse(await body(req));
        try {
          if (url.pathname.endsWith('/pull'))
            return end(res, 200, { output: await this.repos.pull(path) });
          await this.repos.open(path);
          return end(res, 200, { ok: true });
        } catch (e) {
          return end(res, 409, { error: e instanceof Error ? e.message : String(e) });
        }
      }
      end(res, 404, { error: 'not found' });
    } catch {
      end(res, 400, { error: 'bad request' });
    }
  }
}

function end(res: ServerResponse, code: number, json: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(json));
}

/** A JSON body (only JSON: a page on another site cannot post it without asking first). */
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('json only');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > 64_000) throw new Error('too big');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
