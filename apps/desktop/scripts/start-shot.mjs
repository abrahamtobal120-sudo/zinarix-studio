// Visual check: empty start screen (drop zone), opening a dropped path, providers-first picker.
import { _electron as electron } from 'playwright';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const out = process.argv[2] ?? tmpdir();
const home = mkdtempSync(join(tmpdir(), 'zs-start-'));
const proj = join(home, 'mi-proyecto');
mkdirSync(proj);
writeFileSync(join(proj, 'app.js'), 'console.log("hola");\n');
writeFileSync(
  join(home, 'desktop.json'),
  JSON.stringify({ lastFolder: proj, recentFolders: [proj] }),
);
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.'],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.drop-zone', { timeout: 15000 });
await win.waitForTimeout(800);
await win.screenshot({ path: join(out, 'start-empty.png') });
console.log('folder at start:', await win.evaluate(() => window.omni.workspace.current()));
await win.evaluate(
  async (p) => {
    const r = await window.omni.workspace.openPath(p);
    return r;
  },
  join(proj, 'app.js'),
);
await win.waitForSelector('.tree-row', { timeout: 10000 });
await win.waitForTimeout(500);
console.log(
  'after drop-open:',
  (await win.evaluate(() => window.omni.workspace.current()))?.name,
  '| tabs:',
  await win.locator('.tab').count(),
);
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
    type: 'command',
    command: 'ai.pickModel',
  }),
);
await win.waitForSelector('.mp-card', { timeout: 10000 });
await win.waitForTimeout(1000);
await win.screenshot({ path: join(out, 'picker-grid.png') });
await win.locator('.mp-card', { hasText: 'Anthropic' }).first().click();
await win.waitForSelector('.mp-crumb', { timeout: 5000 });
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'picker-provider.png') });
console.log('errors:', errors.length ? errors : 'none');
await app.close();
