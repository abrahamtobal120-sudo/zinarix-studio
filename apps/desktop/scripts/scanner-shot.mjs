// Screenshot of the port-scanner panel after a real scan of two local servers.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { createServer as net } from 'node:net';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const web = createServer((_q, r) => {
  r.writeHead(200, { server: 'nginx/1.25.3' });
  r.end('ok');
});
const banner = net((s) => {
  s.on('error', () => {});
  s.write('SSH-2.0-OpenSSH_9.6\r\n');
});
await new Promise((r) => web.listen(0, r));
await new Promise((r) => banner.listen(0, r));
const webPort = web.address().port;
const bannerPort = banner.address().port;
const home = mkdtempSync(join(tmpdir(), 'zs-scan-'));
mkdirSync(join(home, 'p'));
const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', join(home, 'p')],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForTimeout(2500);
await win.evaluate(
  () =>
    new Promise((res) => {
      const el = document.querySelector('.activity[title="Centro de seguridad"]');
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      setTimeout(res, 300);
    }),
);
await win.waitForSelector('.security');
await win.locator('.sec-card', { hasText: 'nmap' }).locator('button').click();
await win.waitForSelector('.scanner');
await win.locator('.scan-target input').fill('127.0.0.1');
await win.locator('.scan-chip', { hasText: 'Personalizado' }).click();
await win.locator('.scan-ports').fill(`${webPort},${bannerPort}`);
await win.locator('.scan-actions button.primary').click();
await win.waitForSelector('.scan-table', { timeout: 25000 });
await win.waitForTimeout(600);
await win.screenshot({ path: join(out, 'scanner.png') });
const rows = await win.locator('.scan-table tbody tr').allTextContents();
// Also capture the authorization gate for a public target.
await win.locator('.scan-target input').fill('scanme.example.com');
await win.waitForSelector('.scan-authorize');
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'scanner-authorize.png') });
console.log(JSON.stringify(rows));
await app.close();
web.close();
banner.close();
console.log(
  rows.join(' ').includes('nginx') && rows.join(' ').includes('OpenSSH')
    ? 'SHOT OK'
    : 'SHOT FAILED',
);
