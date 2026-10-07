import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = process.argv[2];
const app = await electron.launch({
  executablePath: 'node_modules/.bin/electron'.replace('.bin/electron', 'electron/dist/electron'),
  args: ['.', new URL('../../..', import.meta.url).pathname],
  env: {
    ...process.env,
    OMNI_HOME: mkdtempSync(join(tmpdir(), 'omni-e2e-')),
    OMNI_NO_KEYCHAIN: '1',
  },
});
const logs = [];
app.process().stderr.on('data', (d) => logs.push('MAIN: ' + d));
const win = await app.firstWindow();
win.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
win.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await win.setViewportSize?.({ width: 1400, height: 860 });
await win.waitForTimeout(2500);
await win.screenshot({ path: `${S}/shot1.png` });
// open README via explorer
await win
  .locator('.tree-row', { hasText: 'package.json' })
  .first()
  .click()
  .catch((e) => logs.push('click: ' + e.message));
await win.waitForTimeout(1500);
await win.evaluate(() => window.dispatchEvent(new Event('noop')));
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
    type: 'command',
    command: 'view.terminal',
  }),
);
await win.waitForTimeout(2000);
await win.screenshot({ path: `${S}/shot2.png` });
console.log(logs.join('\n'));
await app.close();
