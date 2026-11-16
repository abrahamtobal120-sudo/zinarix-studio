/**
 * Fase 5B: the allow-list proxy of the sandbox (Linux, macOS). A confined command has no
 * network but this proxy (a unix socket bound into bwrap, or one loopback port that the
 * sandbox-exec profile allows), and the proxy only lets through hosts of the list (npm,
 * PyPI). HTTPS goes through CONNECT, so the proxy sees the host but not the traffic; plain
 * HTTP is forwarded. Anything else gets 403 and never leaves the machine.
 */
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { rmSync } from 'node:fs';
import { hostAllowed } from '../shared/sandbox.js';

export interface AllowProxyOptions {
  /** Hosts that may be reached (exact, or `*.domain`). */
  allow: readonly string[];
  /** Where to listen: a unix socket (Linux; a named pipe on Windows) or a loopback port
   * (0 = any free one). */
  listen: { socket: string } | { port?: number };
  /** Ports that may be reached (default 443 and 80). */
  ports?: readonly number[];
  /** A request was refused (host:port), for the task's terminal. */
  onDeny?: (target: string) => void;
}

export interface AllowProxy {
  /** The loopback port it listens on (undefined with a socket). */
  port?: number;
  socket?: string;
  close(): Promise<void>;
}

/** "host:port" (or "[v6]:port") → its parts; undefined when it does not parse. */
export function splitTarget(target: string): { host: string; port: number } | undefined {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(target) ?? /^([^:]+):(\d+)$/.exec(target);
  if (!m) return undefined;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1]!, port } : undefined;
}

export function startAllowProxy(o: AllowProxyOptions): Promise<AllowProxy> {
  const ports = o.ports ?? [443, 80];
  const ok = (host: string, port: number) => hostAllowed(host, o.allow) && ports.includes(port);
  const deny = (target: string) => o.onDeny?.(target);

  // Plain HTTP: the request line has the absolute URL.
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end('Bad request\n');
      return;
    }
    const port = Number(url.port) || 80;
    if (url.protocol !== 'http:' || !ok(url.hostname, port)) {
      deny(`${url.hostname}:${port}`);
      res.writeHead(403).end(`Zinarix sandbox: ${url.hostname} is not on the allowed list.\n`);
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const up = request(
      { host: url.hostname, port, method: req.method, path: url.pathname + url.search, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', () => res.writeHead(502).end());
    req.pipe(up);
  });

  // HTTPS: CONNECT host:443, then the bytes go through untouched.
  server.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    const t = splitTarget(req.url ?? '');
    client.on('error', () => client.destroy());
    if (!t || !ok(t.host, t.port)) {
      deny(req.url ?? '?');
      client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const up = connect(t.port, t.host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(client).pipe(up);
    });
    up.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'));
    client.on('close', () => up.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const done = () => {
      server.off('error', reject);
      const a = server.address();
      const close = () =>
        new Promise<void>((r) => {
          server.close(() => r());
          server.closeAllConnections();
        });
      resolve(
        'socket' in o.listen
          ? { socket: o.listen.socket, close }
          : { port: (a as AddressInfo).port, close },
      );
    };
    if ('socket' in o.listen) {
      // A stale socket file from a crash would make listen fail (not on Windows pipes).
      if (process.platform !== 'win32') rmSync(o.listen.socket, { force: true });
      server.listen(o.listen.socket, done);
    } else server.listen(o.listen.port ?? 0, '127.0.0.1', done);
  });
}
