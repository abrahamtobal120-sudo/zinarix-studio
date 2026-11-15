// Fase 19: the unified palette — every prefix, recent order, go to line.
// node scripts/palette-shot.mjs <out-dir> [project]
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = process.argv[2] ?? tmpdir();
const proj = resolve(process.argv[3] ?? '../..');
const home = mkdtempSync(join(tmpdir(), 'zs-palette-'));
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj, `--user-data-dir=${join(home, 'ud')}`],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const cmd = (command) =>
  app.evaluate(
    ({ BrowserWindow }, command) =>
      BrowserWindow.getAllWindows()[0].webContents.send('omni:event', { type: 'command', command }),
    command,
  );
const win = await app.firstWindow();
await win.waitForSelector('.status-bar', { timeout: 20000 });
await win.waitForTimeout(1500);
await win.keyboard.press('Escape');
const rows = () =>
  win.evaluate(() =>
    [...document.querySelectorAll('.palette .pick-item')]
      .slice(0, 6)
      .map((e) => e.textContent?.trim()),
  );
const groups = () =>
  win.evaluate(() =>
    [...document.querySelectorAll('.palette .pick-group')].map((e) => e.textContent),
  );
const shot = async (name, query) => {
  if (query !== undefined) await win.locator('.palette input').fill(query);
  await win.waitForTimeout(700);
  await win.screenshot({ path: join(out, `palette-${name}.png`) });
  console.log(name, JSON.stringify({ groups: await groups(), rows: await rows() }));
};

await cmd('quickOpen');
await win.waitForSelector('.palette input');
await shot('1-files');
await shot('2-files-search', 'store');
await win.keyboard.press('Enter'); // opens the first match → becomes recent
await win.waitForTimeout(1500);

await cmd('quickOpen');
await win.waitForSelector('.palette input');
await shot('3-files-recent');
await shot('4-symbols', '@');
await shot('5-symbols-search', '@read');
await shot('6-line', ':40:3');
await win.keyboard.press('Enter');
await win.waitForTimeout(500);
console.log('cursor', await win.evaluate(() => document.querySelector('.status-bar')?.textContent));

await cmd('palette');
await win.waitForSelector('.palette input');
await shot('7-commands');
await shot('8-commands-search', '>tema');
await shot('9-chats', '#');
await win.locator('.palette input').fill('');
await win.locator('.palette-scope', { hasText: 'comandos' }).click();
await shot('10-scope-click');
console.log('query', await win.locator('.palette input').inputValue());
await app.close();
