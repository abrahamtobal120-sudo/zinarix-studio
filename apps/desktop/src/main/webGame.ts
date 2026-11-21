import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { PREVIEW_TYPES } from './design/previewServer.js';

/**
 * Fase 6 (plan de funciones): live preview of web games (three.js, Phaser, canvas…). Serves
 * the open folder on 127.0.0.1 under a random path segment, so the built-in browser can load
 * ES modules, import maps and assets (file:// can't), while other programs on the computer
 * can't guess the URL. Hidden files (.env, .git…) are never served.
 */

const TYPES: Record<string, string> = {
  ...PREVIEW_TYPES,
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.ts': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pck': 'application/octet-stream',
};

interface Served {
  server: Server;
  port: number;
  token: string;
}

export class WebGameServers {
  private servers = new Map<string, Promise<Served>>();

  /** URL of a file of the open folder (rel, '/'-separated; '' = the folder). */
  async url(root: string, rel: string): Promise<string> {
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (clean.split('/').some((s) => s === '..' || s.startsWith('.'))) throw new Error('Ruta no válida.');
    const s = await this.serve(root);
    return `http://127.0.0.1:${s.port}/${s.token}/${clean.split('/').map(encodeURIComponent).join('/')}`;
  }

  private serve(root: string): Promise<Served> {
    let p = this.servers.get(root);
    if (!p) {
      p = start(root);
      this.servers.set(root, p);
      p.catch(() => this.servers.delete(root));
    }
    return p;
  }

  stop(root?: string): void {
    for (const [r, p] of this.servers) {
      if (root && r !== root) continue;
      void p.then((s) => s.server.close()).catch(() => undefined);
      this.servers.delete(r);
    }
  }
}

async function start(root: string): Promise<Served> {
  const token = randomBytes(16).toString('hex');
  const base = resolve(root);
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const parts = url.pathname.split('/').slice(1);
      if (parts[0] !== token || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404).end();
        return;
      }
      let rel: string[];
      try {
        rel = parts.slice(1).map((x) => decodeURIComponent(x));
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (rel.some((x) => x === '..' || x.startsWith('.') || x.includes('\\') || x.includes('\0'))) {
        res.writeHead(403).end();
        return;
      }
      let file = join(base, ...rel);
      if (file !== base && !file.startsWith(base + sep)) {
        res.writeHead(403).end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        const body = await readFile(file);
        // Godot web exports (a .wasm next to the page) need SharedArrayBuffer: isolate them.
        // Other games keep loading images and libraries from other sites.
        const isolate = (await readdir(dirname(file)).catch(() => [] as string[])).some((f) => f.endsWith('.wasm'));
        res.writeHead(200, {
          'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          ...(isolate ? { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } : {}),
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No existe');
      }
    })();
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const a = server.address();
  return { server, port: typeof a === 'object' && a ? a.port : 0, token };
}
