// Builds "Zinarix Studio Especial": a portable Windows .exe that never asks for UAC.
//   pnpm --filter @omni/desktop build && node scripts/build-especial.mjs
// Output: release/Zinarix-Studio-Especial-<version>-x64.exe (portable, no install).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const c = structuredClone(pkg.build);

c.appId = 'dev.zinarix.studio.especial';
c.productName = 'Zinarix Studio Especial';
c.executableName = 'zinarix-studio-especial';
c.publish = [];
c.win = {
  target: [{ target: 'portable', arch: ['x64'] }],
  icon: 'build/icon.png',
  // asInvoker: runs with the user's token, never prompts for UAC.
  requestedExecutionLevel: 'asInvoker',
  artifactName: 'Zinarix-Studio-Especial-${version}-${arch}.${ext}',
};
delete c.nsis;

const cfg = join(mkdtempSync(join(tmpdir(), 'zs-especial-')), 'especial.json');
writeFileSync(cfg, JSON.stringify(c, null, 2));
const extra = process.argv.slice(2);
const r = spawnSync(
  join(root, 'node_modules', '.bin', 'electron-builder'),
  ['--config', cfg, '--win', 'portable', '--x64', '--publish', 'never', ...extra],
  {
    cwd: root,
    stdio: 'inherit',
    // Trust the OS certificate store for electron-builder downloads (see dist.mjs).
    env: { NODE_USE_SYSTEM_CA: '1', ...process.env },
    shell: process.platform === 'win32',
  },
);
process.exit(r.status ?? 1);
