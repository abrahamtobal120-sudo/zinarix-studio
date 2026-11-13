// Builds one installer set per plan: Zinarix Studio (standard, free), Zinarix Studio Pro,
// Zinarix Studio AI and Zinarix Studio Pro + AI. Each edition is its own app: own name,
// app id, package name, installer file names and update channel (pro.yml, ai.yml…), so
// they install side by side and each one only updates to itself.
//
//   node scripts/build-editions.mjs [standard pro ai proai] [-- <electron-builder args>]
//   node scripts/build-editions.mjs pro -- --linux deb --publish never
//
// Needs `pnpm build` first (the renderer is the same for every edition; only the main
// process is rebuilt with ZINARIX_EDITION).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Keep in sync with src/shared/edition.ts (the app reads its edition from there).
const EDITIONS = {
  standard: { name: 'Zinarix Studio', slug: 'zinarix-studio', appId: 'dev.zinarix.studio' },
  pro: { name: 'Zinarix Studio Pro', slug: 'zinarix-studio-pro', appId: 'dev.zinarix.studio.pro' },
  ai: { name: 'Zinarix Studio AI', slug: 'zinarix-studio-ai', appId: 'dev.zinarix.studio.ai' },
  proai: {
    name: 'Zinarix Studio Pro + AI',
    slug: 'zinarix-studio-proai',
    appId: 'dev.zinarix.studio.proai',
  },
};

const argv = process.argv.slice(2);
const cut = argv.indexOf('--');
const picked = cut < 0 ? argv : argv.slice(0, cut);
const builderArgs = cut < 0 ? ['--publish', 'never'] : argv.slice(cut + 1);
const ids = picked.length ? picked : Object.keys(EDITIONS);
for (const id of ids) if (!EDITIONS[id]) throw new Error(`Edición desconocida: ${id}`);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'zs-editions-'));

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    // NODE_USE_SYSTEM_CA: trust the OS certificate store for downloads (see dist.mjs).
    env: { NODE_USE_SYSTEM_CA: '1', ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

/** electron-builder config of an edition: the standard one with its names swapped. */
function configFor(id) {
  const e = EDITIONS[id];
  const c = structuredClone(pkg.build);
  // ZINARIX_KEEP_ELECTRON_EXE=1: ship Electron's exe byte-for-byte (no icon/version edit).
  // Windows Smart App Control blocks any new unsigned exe; the untouched Electron exe is
  // already known to it, so the app keeps opening on PCs where that protection is on.
  if (process.env.ZINARIX_KEEP_ELECTRON_EXE === '1')
    c.win = { ...c.win, signAndEditExecutable: false };
  if (id === 'standard') return c;
  // "Zinarix Studio Pro + AI" -> "Zinarix-Studio-ProAI" in file names.
  const file = e.name.replace(' + ', '').replaceAll(' ', '-');
  const swap = (s) => s.replaceAll('Zinarix-Studio', file).replaceAll('zinarix-studio', e.slug);
  c.appId = e.appId;
  c.productName = e.name;
  c.executableName = e.slug;
  c.extraMetadata = { ...c.extraMetadata, name: e.slug, productName: e.name };
  c.publish = c.publish.map((p) => ({ ...p, channel: id }));
  for (const k of ['linux', 'deb', 'pacman', 'mac', 'win', 'nsis'])
    if (c[k]?.artifactName) c[k].artifactName = swap(c[k].artifactName);
  c.deb.packageName = c.pacman.packageName = e.slug;
  c.nsis.shortcutName = c.dmg.title = e.name;
  c.linux.desktop.entry.StartupWMClass = e.name;
  return c;
}

/**
 * Code signing, only when the release workflow provides the secrets (docs/release-signing.md);
 * without them the build stays unsigned, as before.
 * - macOS: CSC_LINK (+ CSC_KEY_PASSWORD) = Developer ID Application certificate; with
 *   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID the app is also notarized.
 * - Windows: WIN_CSC_LINK (+ WIN_CSC_KEY_PASSWORD) is used by electron-builder on its own
 *   (signtool); or Azure Trusted Signing with AZURE_TENANT_ID / AZURE_CLIENT_ID /
 *   AZURE_CLIENT_SECRET and AZURE_SIGNING_ENDPOINT / _ACCOUNT / _PROFILE / _PUBLISHER (the
 *   certificate's subject CN).
 */
function withSigning(c) {
  const env = process.env;
  if (process.platform === 'darwin' && env.CSC_LINK) {
    // `identity: null` in package.json turns signing off for local and unsigned builds.
    delete c.mac.identity;
    // Notarization requires the hardened runtime; electron-builder's default entitlements
    // keep Electron's JIT and native modules (node-pty, keyring) working under it.
    c.mac.hardenedRuntime = true;
    c.mac.notarize = Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID);
    if (!c.mac.notarize) console.warn('macOS: signed but NOT notarized (APPLE_* secrets missing)');
  }
  const azure = [
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_SIGNING_ENDPOINT',
    'AZURE_SIGNING_ACCOUNT',
    'AZURE_SIGNING_PROFILE',
    'AZURE_SIGNING_PUBLISHER',
  ];
  if (process.platform === 'win32' && azure.every((k) => env[k])) {
    c.win = {
      ...c.win,
      azureSignOptions: {
        endpoint: env.AZURE_SIGNING_ENDPOINT,
        codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
        certificateProfileName: env.AZURE_SIGNING_PROFILE,
        publisherName: env.AZURE_SIGNING_PUBLISHER,
      },
    };
  }
  return c;
}

try {
  for (const id of ids) {
    process.stdout.write(`\n== ${EDITIONS[id].name} ==\n`);
    run('node', ['build.mjs'], { ZINARIX_EDITION: id === 'standard' ? '' : id });
    const cfg = join(tmp, `${id}.json`);
    writeFileSync(cfg, JSON.stringify(withSigning(configFor(id)), null, 2));
    run(join(root, 'node_modules', '.bin', 'electron-builder'), ['--config', cfg, ...builderArgs]);
  }
} finally {
  // Leave dist/ as the standard app (what `pnpm desktop` and the tests expect).
  run('node', ['build.mjs'], { ZINARIX_EDITION: '' });
}
