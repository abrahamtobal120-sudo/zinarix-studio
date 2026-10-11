import { _electron as electron } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = process.argv[2] ?? tmpdir();
const proj = resolve('../..');
const home = mkdtempSync(join(tmpdir(), 'zs-light-'));
writeFileSync(join(home, 'desktop.json'), JSON.stringify({ theme: 'light' }));
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForSelector('.tree-row', { timeout: 15000 });
await win
  .locator('.tree-row', { hasText: 'package.json' })
  .first()
  .click()
  .catch(() => {});
await win.waitForTimeout(1000);
await win.screenshot({ path: join(out, 'shell-light.png') });
await app.close();
console.log('done');
