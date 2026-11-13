// Bundles the Electron main process (ESM) and the sandboxed preload (CJS) with esbuild,
// and ships the provider catalog next to them. The renderer is built by Vite.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const external = ['electron', '@lydell/node-pty', '@napi-rs/keyring'];

rmSync(join(root, 'dist/main'), { recursive: true, force: true });
rmSync(join(root, 'dist/preload'), { recursive: true, force: true });

/**
 * The "Sign in with Google" client built into the installer, so customers never configure
 * one: ZINARIX_GOOGLE_CLIENT_ID/_SECRET (CI secrets) or google-oauth.local.json (gitignored).
 */
const googleClient = (() => {
  const env = {
    clientId: process.env.ZINARIX_GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.ZINARIX_GOOGLE_CLIENT_SECRET ?? '',
  };
  if (env.clientId) return env;
  const file = join(root, 'google-oauth.local.json');
  if (!existsSync(file)) return env;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  // Also accepts the JSON Google downloads ({ "installed": { client_id, client_secret } }).
  const c = j.installed ?? j;
  return { clientId: c.clientId ?? c.client_id ?? '', clientSecret: c.clientSecret ?? c.client_secret ?? '' };
})();

await build({
  entryPoints: [join(root, 'src/main/main.ts')],
  outfile: join(root, 'dist/main/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Maps for stack traces only: no source text inside (it ships with the app).
  sourcemap: true,
  sourcesContent: false,
  external,
  // The edition (scripts/build-editions.mjs): standard, pro, ai or proai.
  define: {
    'process.env.ZINARIX_EDITION': JSON.stringify(process.env.ZINARIX_EDITION ?? ''),
    'process.env.ZINARIX_GOOGLE_CLIENT_ID': JSON.stringify(googleClient.clientId),
    'process.env.ZINARIX_GOOGLE_CLIENT_SECRET': JSON.stringify(googleClient.clientSecret),
  },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});

await build({
  entryPoints: [join(root, 'src/preload/preload.ts')],
  outfile: join(root, 'dist/preload/preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  logLevel: 'warning',
});

const catalogDir = dirname(require.resolve('@omni/catalog/providers.json'));
mkdirSync(join(root, 'dist/catalog/keys'), { recursive: true });
for (const f of ['providers.json', 'providers.json.sig', 'keys/catalog.pub']) {
  cpSync(join(catalogDir, f), join(root, 'dist/catalog', f));
}
process.stdout.write('main + preload built\n');
