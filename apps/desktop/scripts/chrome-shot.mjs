// Fase 18: the window's own title bar, Mica, the app menu and its shortcuts.
// node scripts/chrome-shot.mjs <out-dir> [project]
// Takes real screen captures (the system draws Mica and − □ ×, a page capture misses them).
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2] ?? tmpdir());
const proj = resolve(process.argv[3] ?? '../..');
const home = mkdtempSync(join(tmpdir(), 'zs-chrome-'));
const ps = (script) =>
  execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
const keys = (k) =>
  ps(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${k}')`,
  );

const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj, `--user-data-dir=${join(home, 'ud')}`],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForSelector('.titlebar', { timeout: 20000 });
await win.waitForTimeout(2000);
await win.keyboard.press('Escape');

const front = () =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setAlwaysOnTop(true);
    w.show();
    w.focus();
    return w.getBounds();
  });
const shot = (name, b) =>
  ps(
    `Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap ${b.width}, ${b.height}; ` +
      `$g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${b.x}, ${b.y}, 0, 0, $bmp.Size); ` +
      `$bmp.Save('${join(out, name).replace(/'/g, "''")}')`,
  );
const report = () =>
  win.evaluate(() => {
    const r = document.querySelector('.titlebar')?.getBoundingClientRect();
    return {
      material: document.documentElement.dataset.material,
      chrome: document.documentElement.dataset.chrome,
      bar: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      menus: [...document.querySelectorAll('.titlebar-menu')].map((b) => b.textContent),
      title: document.querySelector('.titlebar-title')?.textContent,
      wco: navigator.windowControlsOverlay?.getTitlebarAreaRect?.().width ?? null,
    };
  });

let b = await front();
await win.waitForTimeout(600);
shot('chrome-1-mica.png', b);
console.log('start', JSON.stringify(await report()));

// A menu of the title bar opens the native menu below its label.
await win.locator('.titlebar-menu').first().click();
await win.waitForTimeout(700);
shot('chrome-2-menu.png', b);
keys('{ESC}');
await win.waitForTimeout(300);

// A shortcut that only the app menu knows (Ver > Agrandar todo) still works.
const zoom = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
const z0 = await zoom();
await front();
keys('^=');
await win.waitForTimeout(800);
const z1 = await zoom();
console.log('menu shortcut Ctrl+= zoom', z0, '->', z1, z1 > z0 ? 'OK' : 'NO');
keys('^0');
await win.waitForTimeout(800);

// The setting turns Mica off at once.
await win.evaluate(() => window.omni.app.setPrefs({ windowEffects: false }));
await win.evaluate(async () => {
  const st = await window.omni.app.chrome({ bg: '#181818', fg: '#cccccc', dark: true });
  document.documentElement.dataset.material = st.material;
});
await win.waitForTimeout(600);
b = await front();
shot('chrome-3-opaque.png', b);
console.log('effects off', JSON.stringify(await report()));
await win.evaluate(() => window.omni.app.setPrefs({ windowEffects: true }));

// A light theme: the bar, − □ × and Mica follow it.
await win.evaluate(() => window.omni.ai.setTheme('light'));
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', { type: 'settings:changed' }),
);
await win.waitForTimeout(1200);
b = await front();
shot('chrome-4-light.png', b);
console.log('light', JSON.stringify(await report()));
await win.evaluate(() => window.omni.ai.setTheme('dark'));

await app.close();
