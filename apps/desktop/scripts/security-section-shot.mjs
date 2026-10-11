import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const home = mkdtempSync(join(tmpdir(), 'zs-secsec-'));
const proj = join(home, 'app');
mkdirSync(join(proj, 'src'), { recursive: true });
const key = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
writeFileSync(
  join(proj, 'src', 'db.js'),
  `const k="${key}";\nexport const q=(id)=>db.query(\`SELECT * FROM t WHERE id=\${id}\`);\n`,
);
writeFileSync(join(proj, '.env'), 'SECRET=abc123def456\n');
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForTimeout(2500);
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
    type: 'command',
    command: 'security.center',
  }),
);
await win.waitForSelector('.sec-section', { timeout: 10000 });
await win.waitForTimeout(400);
await win.screenshot({ path: join(out, 'secsection-dashboard.png') });
// Run all local analyses from the dashboard
await win.locator('.sv-dash .primary', { hasText: 'Ejecutar todo' }).click();
await win.waitForSelector('.sv-section-block', { timeout: 40000 });
await win.waitForTimeout(1500);
await win.screenshot({ path: join(out, 'secsection-dashboard-full.png') });
// Project findings
await win.locator('.sv-nav-item', { hasText: 'Proyecto' }).click();
await win.waitForSelector('.sv-finding', { timeout: 20000 });
await win.waitForTimeout(400);
await win.screenshot({ path: join(out, 'secsection-project.png') });
const findings = await win.locator('.sv-finding-head strong').allTextContents();
// History
await win.locator('.sv-nav-item', { hasText: 'Historial' }).click();
await win.waitForTimeout(400);
await win.screenshot({ path: join(out, 'secsection-history.png') });
const leaked = await win.evaluate((k) => document.body.innerText.includes(k), key);
console.log(JSON.stringify({ findings, leaked }));
await app.close();
console.log(findings.length >= 2 && !leaked ? 'SECSECTION OK' : 'SECSECTION FAILED');
