// Checks "replace all" in the search panel really rewrites the matching files.
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'zs-replace-'));
const proj = join(home, 'proyecto');
mkdirSync(join(proj, 'src'), { recursive: true });
writeFileSync(join(proj, 'src', 'a.js'), 'const color = "rojo";\nlet rojoClaro = 1;\n');
writeFileSync(join(proj, 'src', 'b.js'), 'export const rojo = "rojo";\n');
writeFileSync(join(proj, 'notas.md'), 'rojo\n');
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForSelector('.tree-row');
await win.locator('.activity[title="Buscar"]').click();
await win.locator('.sx-field input').first().fill('rojo');
await win.locator('.sx-toggle[title^="Solo palabras"]').click(); // whole word: skip rojoClaro
await win.locator('.sx-filters-btn').click();
await win.locator('.sx-filters input').nth(1).fill('*.md'); // exclude notas.md
await win.locator('.sx-chevron').click();
await win.locator('.sx-field input').nth(1).fill('azul');
await win.waitForSelector('.sx-hit');
win.once('dialog', (d) => d.accept());
await win.locator('.sx-toggle[title="Reemplazar todo"]').click();
await win.waitForTimeout(1200);
const a = readFileSync(join(proj, 'src', 'a.js'), 'utf8');
const b = readFileSync(join(proj, 'src', 'b.js'), 'utf8');
const md = readFileSync(join(proj, 'notas.md'), 'utf8');
console.log(JSON.stringify({ a, b, md }));
await app.close();
const ok =
  a.includes('"azul"') &&
  a.includes('rojoClaro') &&
  b === 'export const azul = "azul";\n' &&
  md === 'rojo\n';
console.log(ok ? 'REPLACE OK' : 'REPLACE FAILED');
if (!ok) process.exit(1);
