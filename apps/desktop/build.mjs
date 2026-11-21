// Bundles the Electron main process (ESM) and the sandboxed preload (CJS) with esbuild,
// and ships the provider catalog next to them. The renderer is built by Vite.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeKnowledge } from './scripts/helper-knowledge.mjs';
import { writeMainPackages } from './scripts/notices.mjs';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Fase 1B: copies the fast background-removal model (4.6 MB, Apache-2.0) into `dir`. It is kept
 * in node_modules/.cache after the first download and always checked with SHA-256. Without
 * internet on a first build the app still works: it downloads the model when first used.
 */
async function bundleFastModel(dir) {
  const { createHash } = await import('node:crypto');
  const { writeFileSync } = await import('node:fs');
  const url = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx';
  const sha = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
  const cache = join(root, 'node_modules/.cache/zinarix-models/u2netp.onnx');
  const ok = (p) => existsSync(p) && createHash('sha256').update(readFileSync(p)).digest('hex') === sha;
  if (!ok(cache)) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (createHash('sha256').update(buf).digest('hex') !== sha) throw new Error('SHA-256 mismatch');
      mkdirSync(dirname(cache), { recursive: true });
      writeFileSync(cache, buf);
    } catch (e) {
      console.error(`[build] fast background model not bundled (${e.message}); the app downloads it on first use.`);
      return;
    }
  }
  cpSync(cache, join(dir, 'u2netp.onnx'));
}
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

const mainBuild = await build({
  entryPoints: [join(root, 'src/main/main.ts')],
  metafile: true,
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

const preloadBuild = await build({
  entryPoints: [join(root, 'src/preload/preload.ts')],
  metafile: true,
  outfile: join(root, 'dist/preload/preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  logLevel: 'warning',
});

// The editing script of the visual editor, served only inside its sandboxed preview frame.
const designBuild = await build({
  entryPoints: [join(root, 'src/preload/designPreview.ts')],
  metafile: true,
  outfile: join(root, 'dist/preload/designPreview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome140',
  logLevel: 'warning',
});

// Fase 7: the built-in OpenSCAD (WebAssembly, GPL-2.0-or-later). Like FFmpeg it ships as a separate
// program next to the app (resources/openscad, see package.json), never inside the app bundle, with
// its license, notice and source; it runs as its own process so a long render never blocks main.
await build({
  entryPoints: [join(root, 'src/main/cadWorker.ts')],
  metafile: true,
  outfile: join(root, 'dist/openscad/cadWorker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
cpSync(join(root, 'node_modules/openscad-wasm-prebuilt/COPYING'), join(root, 'dist/openscad/COPYING.GPLv2.txt'));
for (const f of ['OPENSCAD-NOTICE.txt', 'OPENSCAD-SOURCE.txt']) cpSync(join(root, 'build/openscad', f), join(root, 'dist/openscad', f));

// Fase 1B: background removal on this PC. ONNX Runtime Web (WebAssembly, MIT) bundled into its
// own program next to the app (resources/bgremove, outside the app archive so its threads can load
// their files), with the fast U²-Net model (Apache-2.0) when the build has it (cache below).
await build({
  entryPoints: [join(root, 'src/main/bgWorker.ts')],
  outfile: join(root, 'dist/bgremove/bgWorker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
{
  const ortDist = join(root, 'node_modules/onnxruntime-web/dist');
  for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'])
    cpSync(join(ortDist, f), join(root, 'dist/bgremove', f));
  cpSync(join(root, 'build/bgremove/MODELS-NOTICE.txt'), join(root, 'dist/bgremove/MODELS-NOTICE.txt'));
  await bundleFastModel(join(root, 'dist/bgremove'));
}

// Fase 6: the Phaser build (MIT) for the "web-phaser" game template, so it works offline.
mkdirSync(join(root, 'dist/vendor'), { recursive: true });
cpSync(join(root, 'node_modules/phaser/dist/phaser.min.js'), join(root, 'dist/vendor/phaser.min.js'));

const catalogDir = dirname(require.resolve('@omni/catalog/providers.json'));
mkdirSync(join(root, 'dist/catalog/keys'), { recursive: true });
for (const f of ['providers.json', 'providers.json.sig', 'keys/catalog.pub']) {
  cpSync(join(catalogDir, f), join(root, 'dist/catalog', f));
}
// What "Ayuda de Zinarix" knows about the app (dist/helper/knowledge.json, packaged with dist/**).
writeKnowledge(join(root, 'dist/helper/knowledge.json'));
// The npm packages main/preload bundle; Vite adds the renderer's and writes the notices.
writeMainPackages([mainBuild.metafile, preloadBuild.metafile, designBuild.metafile]);
process.stdout.write('main + preload built\n');
