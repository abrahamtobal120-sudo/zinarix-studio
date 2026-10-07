// Bundles the Electron main process (ESM) and the sandboxed preload (CJS) with esbuild,
// and ships the provider catalog next to them. The renderer is built by Vite.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const external = ['electron', '@lydell/node-pty', '@napi-rs/keyring'];

rmSync(join(root, 'dist/main'), { recursive: true, force: true });
rmSync(join(root, 'dist/preload'), { recursive: true, force: true });

await build({
  entryPoints: [join(root, 'src/main/main.ts')],
  outfile: join(root, 'dist/main/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external,
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
