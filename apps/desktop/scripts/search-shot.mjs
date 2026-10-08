// Screenshots of the search panel (content + replace preview, by name) and quick open.
// Usage: node scripts/search-shot.mjs <outDir> [projectDir]
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const proj = resolve(process.argv[3] ?? '../..');
const home = mkdtempSync(join(tmpdir(), 'zs-search-'));
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.tree-row');
await win.locator('.activity[title="Buscar"]').click();
const q = win.locator('.sx-field input').first();
await q.fill('normalizeUrl');
await win.waitForSelector('.sx-hit', { timeout: 10000 });
await win.keyboard.press('ArrowDown');
await win.keyboard.press('ArrowDown');
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'search-content.png') });
await win.locator('.sx-chevron').click();
await win.locator('.sx-field input').nth(1).fill('toUrl');
await win.locator('.sx-filters-btn').click();
await win.locator('.sx-filters input').first().fill('apps/**');
await win.waitForTimeout(500);
await win.screenshot({ path: join(out, 'search-replace.png') });
await win.locator('.sx-tabs button').nth(1).click();
await win.locator('.sx-field input').first().fill('brws');
await win.waitForSelector('.sx-filerow');
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'search-name.png') });
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
    type: 'command',
    command: 'quickOpen',
  }),
);
await win.waitForTimeout(400);
await win.keyboard.type('agtts');
await win.waitForTimeout(400);
await win.screenshot({ path: join(out, 'quick-open.png') });
console.log('errors:', errors.length ? errors : 'none');
await app.close();
