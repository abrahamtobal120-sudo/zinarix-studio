// Screenshots of the browser tab with the native page composited in (Playwright alone only
// captures the renderer). Usage: node scripts/browser-shot.mjs <outDir> [url]
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const out = process.argv[2] ?? tmpdir();
const url = process.argv[3] ?? 'https://example.com';
const home = mkdtempSync(join(tmpdir(), 'zs-bshot-'));
const proj = join(home, 'proyecto');
mkdirSync(proj);
writeFileSync(join(proj, 'index.html'), '<h1>hola</h1>');
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForSelector('.tree-row');
await win.locator('.activity[title="Navegador"]').click();
await win.waitForTimeout(600);
await win.screenshot({ path: join(out, 'browser-empty.png') });

async function composite(name) {
  const ui = join(out, `${name}-ui.png`);
  await win.screenshot({ path: ui });
  const v = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const view = w.contentView.children[0];
    if (!view || !view.getVisible()) return null;
    const img = await view.webContents.capturePage();
    return { b: view.getBounds(), png: img.toPNG().toString('base64') };
  });
  if (!v) return;
  const page = join(out, `${name}-page.png`);
  writeFileSync(page, Buffer.from(v.png, 'base64'));
  execFileSync('python3', [
    '-c',
    `from PIL import Image;a=Image.open(${JSON.stringify(ui)});b=Image.open(${JSON.stringify(page)}).resize((${v.b.width},${v.b.height}));a.paste(b,(${v.b.x},${v.b.y}));a.save(${JSON.stringify(join(out, `${name}.png`))})`,
  ]);
}
const input = win.locator('.browser-start-search input');
await input.click();
await input.fill(url);
await input.press('Enter');
await win.waitForTimeout(3500);
await composite('browser-page');
await app.close();
