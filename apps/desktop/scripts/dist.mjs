// Runs electron-builder (pnpm --filter @omni/desktop dist -- <args>).
// NODE_USE_SYSTEM_CA makes Node trust the OS certificate store, so the downloads
// electron-builder does (Electron, NSIS, 7zip…) work behind antivirus/proxies that
// inspect HTTPS ("unable to get local issuer certificate").
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => a !== '--');
const r = spawnSync(
  join(root, 'node_modules', '.bin', 'electron-builder'),
  args.length ? args : ['--publish', 'never'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { NODE_USE_SYSTEM_CA: '1', ...process.env },
    shell: process.platform === 'win32',
  },
);
process.exit(r.status ?? 1);
