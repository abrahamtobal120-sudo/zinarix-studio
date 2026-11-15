// Opens an image, a binary and huge text files in the editor and screenshots each viewer.
// Usage: node scripts/viewer-shot.mjs <outDir>
import { _electron as electron } from 'playwright';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const home = mkdtempSync(join(tmpdir(), 'zs-viewer-'));
const proj = mkdtempSync(join(tmpdir(), 'zs-viewer-proj-'));
copyFileSync('build/icon.png', join(proj, 'icon.png'));
const bin = Buffer.alloc(300_000);
for (let i = 0; i < bin.length; i++) bin[i] = (i * 31 + (i >> 8)) & 0xff;
writeFileSync(join(proj, 'data.bin'), bin);
const line = (i) => `${i}\t{"id":${i},"name":"row ${i}","ok":true}\n`;
let big = '';
for (let i = 0; big.length < 30 * 1024 * 1024; i++) big += line(i);
writeFileSync(join(proj, 'big.jsonl'), big);
writeFileSync(join(proj, 'huge.log'), big + big + big); // ~90 MB: paged only

const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.tree-row');
await win.waitForTimeout(800);
if (await win.locator('.onboarding-backdrop').count()) await win.keyboard.press('Escape');
await win.evaluate(() => document.querySelector('.onboarding-backdrop')?.remove());
const open = async (name) => {
  await win.locator('.tree-row', { hasText: name }).first().click();
  await win.waitForSelector('.viewer-pane', { timeout: 20000 });
};

await open('icon.png');
await win.waitForSelector('.image-stage img', { timeout: 10000 });
await win.waitForTimeout(400);
await win.screenshot({ path: join(out, 'viewer-image.png') });
console.log('image:', await win.locator('.image-tools').innerText());

await open('data.bin');
await win.waitForTimeout(600);
await win.screenshot({ path: join(out, 'viewer-hex.png') });
console.log('hex row:', await win.locator('.hex-row').first().innerText());
await win.locator('.viewer-input').fill('50%');
await win.keyboard.press('Enter');
await win.waitForTimeout(600);
console.log('hex @50%:', await win.locator('.hex-row').first().innerText());

await open('huge.log');
await win.waitForTimeout(1500);
console.log('huge:', await win.locator('.large-viewer .image-tools').innerText());
await win.getByRole('button', { name: /Siguiente|Next/ }).click();
await win.waitForTimeout(800);
console.log('huge p2:', await win.locator('.large-viewer .viewer-dim').innerText());
await win.screenshot({ path: join(out, 'viewer-large.png') });

await open('big.jsonl');
await win.waitForTimeout(1500);
await win.getByRole('button', { name: /Abrir completo|Open whole/ }).click();
await win.waitForSelector('.editor-host[style*="block"]', { timeout: 30000 });
await win.waitForTimeout(800);
await win.screenshot({ path: join(out, 'viewer-full.png') });
console.log('full editor lines visible:', (await win.locator('.view-line').count()) > 0);

console.log('errors:', errors.length ? errors : 'none');
await app.close();
