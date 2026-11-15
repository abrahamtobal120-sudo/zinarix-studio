import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { annotate } from './htmlSource.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Hidden files and folders (.env, .git, .zinarix) are never served. */
const HIDDEN = /(^|\/)\./;

export const PREVIEW_COOKIE = 'zxd';

/**
 * Serves the open folder of a plain HTML site to the panel's preview only: bound to
 * 127.0.0.1 on a random port, and every request must carry a random cookie that only the
 * preview's session has (another program on the computer can't read the project through
 * it). HTML pages are served annotated with data-zx-src (see htmlSource.annotate).
 */
export class PreviewServer {
  readonly token = randomBytes(24).toString('hex');
  private server: Server | null = null;
  port = 0;

  constructor(
    /** Absolute path of a project-relative file, or an error if it escapes the project. */
    private readonly resolve: (rel: string) => string,
  ) {}

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.serve(req, res));
    await new Promise<void>((ok, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => ok());
    });
    const addr = server.address();
    this.port = typeof addr === 'object' && addr ? addr.port : 0;
    this.server = server;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private authorized(req: IncomingMessage): boolean {
    const cookies = req.headers.cookie ?? '';
    return cookies.split(';').some((c) => c.trim() === `${PREVIEW_COOKIE}=${this.token}`);
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (code: number, body: string, type = 'text/html; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (!this.authorized(req)) return send(403, 'Forbidden', 'text/plain');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(req.url ?? '/', this.origin).pathname).replace(/^\/+/, '');
    } catch {
      return send(400, 'Bad request');
    }
    if (HIDDEN.test(rel) || rel.includes('\0')) return send(404, notFound());
    try {
      let abs = this.resolve(rel || '.');
      let st = await stat(abs).catch(() => null);
      if (st?.isDirectory()) {
        rel = `${rel.replace(/\/$/, '')}${rel ? '/' : ''}index.html`;
        abs = this.resolve(rel);
        st = await stat(abs).catch(() => null);
      } else if (!st && !extname(rel)) {
        // "/precios" → precios.html, like most static hosts do.
        const html = this.resolve(`${rel}.html`);
        st = await stat(html).catch(() => null);
        if (st) {
          rel = `${rel}.html`;
          abs = html;
        }
      }
      if (!st?.isFile()) return send(404, notFound());
      const ext = extname(abs).toLowerCase();
      const type = TYPES[ext] ?? 'application/octet-stream';
      const buf = await readFile(abs);
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      if (req.method === 'HEAD') return void res.end();
      if (ext === '.html' || ext === '.htm') res.end(annotate(buf.toString('utf8'), rel));
      else res.end(buf);
    } catch {
      send(404, notFound());
    }
  }
}

function notFound(): string {
  return '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;color:#555"><h2>Esta página no existe</h2><p>Revisa el enlace o elige otra página en la columna de la izquierda.</p></body>';
}
