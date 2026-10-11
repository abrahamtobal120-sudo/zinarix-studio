import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = process.argv[2] ?? tmpdir();
const proj = resolve(process.argv[3] ?? '../..');
const home = mkdtempSync(join(tmpdir(), 'zs-shell-'));
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForSelector('.tree-row', { timeout: 15000 });
await win.waitForTimeout(800);
await win.screenshot({ path: join(out, 'shell-welcome.png') });
// open a source file
await win
  .locator('.tree-row', { hasText: 'package.json' })
  .first()
  .click()
  .catch(() => {});
await win.waitForTimeout(1200);
await win.screenshot({ path: join(out, 'shell-editor.png') });
// command palette
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
    type: 'command',
    command: 'palette',
  }),
);
await win.waitForTimeout(500);
await win.screenshot({ path: join(out, 'shell-palette.png') });
await app.close();
console.log('done');
