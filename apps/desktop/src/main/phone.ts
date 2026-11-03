import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import type { PhoneAction, PhoneSnapshot, PhoneStatus } from '../shared/api.js';
import { phonePage } from './phonePage.js';

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
 */
export class PhoneRemote {
  private server: Server | null = null;
  private host = '';
  private pin = '';
  private tries = 0;
  private tokens = new Set<string>();
  private streams = new Set<ServerResponse>();
  private snapshot: PhoneSnapshot | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private onAction: (a: PhoneAction) => void,
    private onStatus: (s: PhoneStatus) => void,
  ) {}

  status(): PhoneStatus {
    if (!this.server) return { running: false, phones: 0 };
    return { running: true, url: `http://${this.host}`, pin: this.pin, phones: this.tokens.size };
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
    this.host = `${ip}:${port}`;
    this.newPin();
    this.heartbeat = setInterval(() => {
      for (const s of this.streams) s.write(': ping\n\n');
    }, 20_000);
    this.heartbeat.unref();
    return this.status();
  }

  stop(): PhoneStatus {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const s of this.streams) s.end();
    this.streams.clear();
    this.tokens.clear();
    this.snapshot = null;
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = null;
    return this.status();
  }

  /** The window's chats changed: every connected phone gets the new view. */
  push(snapshot: PhoneSnapshot): void {
    if (!this.server) return;
    this.snapshot = snapshot;
    const data = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const s of this.streams) s.write(data);
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
      // Only this address: a web page elsewhere cannot reach the remote through DNS tricks.
      if (req.headers.host !== this.host) return end(res, 421, { error: 'host' });
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
        const { pin } = z.object({ pin: z.string().max(20) }).parse(await body(req));
        if (!same(pin.replace(/\D/g, '').padEnd(6, ' '), this.pin)) {
          if (++this.tries >= MAX_TRIES) {
            this.newPin();
            this.onStatus(this.status());
          }
          return end(res, 403, { error: 'PIN incorrecto' });
        }
        const token = randomBytes(32).toString('hex');
        this.tokens.add(token);
        this.tries = 0;
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
      if (req.method === 'POST' && url.pathname === '/api/action') {
        this.onAction(Action.parse(await body(req)));
        return end(res, 200, { ok: true });
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
