// Fase 20: Ayuda → Licencias with the third-party list generated at build time.
// node scripts/licenses-shot.mjs <out-dir>   (after `pnpm build`)
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const out = process.argv[2] ?? tmpdir();
const home = mkdtempSync(join(tmpdir(), 'zs-licenses-'));
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', `--user-data-dir=${join(home, 'ud')}`],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForSelector('.status-bar', { timeout: 20000 });
await win.waitForTimeout(1500);
await win.keyboard.press('Escape');
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
    type: 'command',
    command: 'help.licenses',
  }),
);
await win.waitForSelector('.tp-list', { timeout: 10000 });
const count = () => win.locator('.tp-list').nth(1).locator('li').count();
console.log('packages shown', await count());
await win.locator('.tp').scrollIntoViewIfNeeded();
await win.screenshot({ path: join(out, 'licenses-1-list.png') });

await win.locator('.tp-filter').fill('bsd');
await win.waitForTimeout(300);
console.log('bsd matches', await count());
await win.locator('.tp-list').nth(1).locator('summary').first().click();
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'licenses-2-filter-open.png') });

await win.locator('.tp-filter').fill('zzz-nothing');
await win.waitForTimeout(300);
console.log('empty text', await win.locator('.tp > p.tp-note').first().textContent());
await app.close();
