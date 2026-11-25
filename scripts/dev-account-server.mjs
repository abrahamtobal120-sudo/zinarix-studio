#!/usr/bin/env node
// Local copy of the website's account server, for trying it without Vercel or Supabase:
//   node scripts/dev-account-server.mjs          -> http://127.0.0.1:8787  (admin at /admin)
// Data lives in memory (gone when it stops). Keys are signed with ~/.omni-signing/license.key
// when it exists (so the real app accepts them); otherwise with a throwaway key.
// Point a development build of the app at it with ZINARIX_ACCOUNT_URL=http://127.0.0.1:8787
// With SUPABASE_URL and SUPABASE_SERVICE_KEY set, it uses that database instead of memory.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeService } from '../website/api/_lib/core.mjs';
import { memoryStore, supabaseStore } from '../website/api/_lib/store.mjs';

const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'website');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * @param opts { port, adminToken, privateKeyPem, store, now, scrypt }
 * @returns { url, close, service, store }
 */
export async function startServer(opts = {}) {
  const env = {
    ADMIN_TOKEN: opts.adminToken ?? 'dev-admin-token-0123456789abcdef',
    LICENSE_PRIVATE_KEY: opts.privateKeyPem,
  };
  const store = opts.store ?? memoryStore();
  const service = makeService(store, env, { now: opts.now, scrypt: opts.scrypt });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const kind = /^\/api\/(account|admin|feed)$/.exec(url.pathname)?.[1];
    if (kind) {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100_000) break;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }
      const out = await service.run(kind, {
        method: req.method,
        headers: req.headers,
        body,
        ip: req.socket.remoteAddress ?? 'local',
      });
      res.writeHead(out.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(out.body));
      return;
    }
    // The static site, with clean URLs like Vercel (/admin -> admin.html).
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '') || 'index.html';
    if (!extname(rel)) rel += '.html';
    const file = join(site, rel);
    if (!file.startsWith(site + sep) || rel.startsWith('api') || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    service,
    store,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keyPath = process.env.ZINARIX_LICENSE_KEY ?? join(homedir(), '.omni-signing/license.key');
  const real = existsSync(keyPath);
  const privateKeyPem = real
    ? readFileSync(keyPath, 'utf8')
    : generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const db = supabaseStore(process.env);
  const s = await startServer({
    port: Number(process.env.PORT || 8787),
    adminToken: process.env.ADMIN_TOKEN,
    privateKeyPem,
    store: db.ready ? db : undefined,
  });
  console.log(`servidor de cuentas: ${s.url}`);
  console.log(`panel del dueño:     ${s.url}/admin`);
  console.log(
    `clave de admin:      ${process.env.ADMIN_TOKEN ?? 'dev-admin-token-0123456789abcdef'}`,
  );
  console.log(`base de datos:       ${db.ready ? 'Supabase' : 'memoria (se borra al cerrar)'}`);
  console.log(
    real
      ? 'firma: la llave real de esta PC (la app acepta las claves)'
      : 'firma: llave de prueba (la app real NO acepta estas claves)',
  );
}
