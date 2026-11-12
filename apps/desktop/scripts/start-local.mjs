// Rebuild local sources on every launch so reopening the app applies edits.
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const buildSteps = [
  [join(appDir, 'build.mjs')],
  [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build'],
];
for (const args of buildSteps) {
  const result = spawnSync(process.execPath, args, {
    cwd: appDir,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// --build-only verifies the launcher without opening another app instance.
if (!process.argv.includes('--build-only')) {
  const child = spawn(require('electron'), [appDir, ...process.argv.slice(2)], {
    cwd: appDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.unref();
}
