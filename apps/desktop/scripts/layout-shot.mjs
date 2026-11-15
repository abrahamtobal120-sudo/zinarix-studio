// Fase 17: panel at the right, Zen, workspaces, and that the layout survives a restart.
// node scripts/layout-shot.mjs <out-dir> [project]
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = process.argv[2] ?? tmpdir();
const proj = resolve(process.argv[3] ?? '../..');
const home = mkdtempSync(join(tmpdir(), 'zs-layout-'));
const launch = () =>
  electron.launch({
    executablePath: 'node_modules/electron/dist/electron',
    args: ['.', proj, `--user-data-dir=${join(home, 'ud')}`],
    env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
  });
const cmd = (app, command) =>
  app.evaluate(
    ({ BrowserWindow }, command) =>
      BrowserWindow.getAllWindows()[0].webContents.send('omni:event', { type: 'command', command }),
    command,
  );
const report = (win) =>
  win.evaluate(() => {
    const box = (s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null;
    };
    return {
      panel: box('.panel-wrap'),
      editor: box('.editor-area'),
      activity: box('.activity-bar'),
      status: box('.status-bar'),
      space: document.querySelector('.space-trigger')?.textContent?.trim(),
      saved: localStorage.getItem('zs.layout'),
    };
  });

let app = await launch();
let win = await app.firstWindow();
await win.waitForSelector('.status-bar', { timeout: 20000 });
await win.waitForTimeout(1500);
await win.keyboard.press('Escape');
await win.screenshot({ path: join(out, 'layout-1-start.png') });
console.log('start', JSON.stringify(await report(win)));

await cmd(app, 'layout.panelPosition');
await win.waitForTimeout(1200);
await win.screenshot({ path: join(out, 'layout-2-right.png') });
console.log('right', JSON.stringify(await report(win)));

await win.locator('.space-trigger').click();
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'layout-3-menu.png') });
await win.keyboard.press('Escape');

await cmd(app, 'layout.space.agents');
await win.waitForTimeout(800);
await win.screenshot({ path: join(out, 'layout-4-agents.png') });
console.log('agents', JSON.stringify(await report(win)));
await cmd(app, 'layout.space.code');
await win.waitForTimeout(800);
console.log('back to code', JSON.stringify(await report(win)));

await cmd(app, 'layout.zen');
await win.waitForTimeout(600);
await win.screenshot({ path: join(out, 'layout-5-zen.png') });
console.log('zen', JSON.stringify(await report(win)));
await win.keyboard.press('Escape');
await win.keyboard.press('Escape');
await win.waitForTimeout(400);
console.log('after Esc Esc', JSON.stringify(await report(win)));
await win.waitForTimeout(400);
await app.close();

app = await launch();
win = await app.firstWindow();
await win.waitForSelector('.status-bar', { timeout: 20000 });
await win.waitForTimeout(2000);
await win.screenshot({ path: join(out, 'layout-6-restart.png') });
console.log('restart', JSON.stringify(await report(win)));
await app.close();
console.log('done');
