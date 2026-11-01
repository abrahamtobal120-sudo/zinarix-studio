// Installs a launcher for the local build on the current system (no admin/root needed):
// Linux -> install-linux.sh, Windows -> install-windows.ps1. Pass --uninstall on Windows to remove it.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const run = (cmd, argv) => execFileSync(cmd, argv, { stdio: 'inherit' });

try {
  if (process.platform === 'win32') {
    const ps = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];
    const flags = args.includes('--uninstall') ? ['-Uninstall'] : [];
    run('powershell.exe', [...ps, join(here, 'install-windows.ps1'), ...flags]);
  } else if (process.platform === 'linux') {
    run('bash', [join(here, 'install-linux.sh'), ...args]);
  } else {
    console.error(
      'En macOS usa el instalador: pnpm --filter @omni/desktop dist (crea el .dmg en apps/desktop/release).',
    );
    process.exit(1);
  }
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1);
}
