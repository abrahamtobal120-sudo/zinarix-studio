// End-to-end check of the security tools driven by a scripted mock model, plus a screenshot
// of the security center. Usage: node scripts/security-smoke.mjs <outDir>
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const home = mkdtempSync(join(tmpdir(), 'zs-sec-'));
const proj = join(home, 'tienda');
mkdirSync(join(proj, 'src'), { recursive: true });
const fakeKey = ['AKIA', 'QWERTYUIOPASDFGH'].join('');
writeFileSync(
  join(proj, 'src', 'db.js'),
  `const key = "${fakeKey}";\nexport const q = (id) => db.query(\`SELECT * FROM t WHERE id = \${id}\`);\n`,
);
writeFileSync(join(proj, 'notas.txt'), 'hola');

let port = 0;
const steps = () => [
  { name: 'security_scan_project', args: {} },
  { name: 'port_scan', args: { target: 'localhost', ports: `${port},6379` } },
  { name: 'check_site_security', args: { url: `http://127.0.0.1:${port}/` } },
  { name: 'file_hash', args: { path: 'notas.txt' } },
];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (!req.url.startsWith('/v1')) {
      res.writeHead(200, { 'content-type': 'text/html', 'x-powered-by': 'Express 4.17.1' });
      return res.end('<h1>tienda</h1>');
    }
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'agente-demo' }] }));
    }
    const j = JSON.parse(body);
    const done = j.messages.filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const list = steps();
    if (done < list.length) {
      const s = list[done];
      send({ choices: [{ delta: { content: `Paso ${done + 1}: ${s.name}.` } }] });
      send({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `c${done}`,
                  function: { name: s.name, arguments: JSON.stringify(s.args) },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    } else {
      const tools = j.messages.filter((m) => m.role === 'tool').map((m) => m.content);
      const summary = [
        tools[0].includes('Llave de AWS') && 'aws',
        tools[0].includes('inyección SQL') && 'sql',
        !tools[0].includes(fakeKey) && 'masked',
        tools[1].includes(`${port}`) && 'port',
        tools[2].includes('no usa HTTPS') && 'nohttps',
        tools[2].includes('revela su software') && 'server',
        /SHA-256: [0-9a-f]{64}/.test(tools[3]) && 'hash',
      ].filter(Boolean);
      send({
        choices: [{ delta: { content: `Listo ✅ ${summary.join(',')}` }, finish_reason: 'stop' }],
      });
    }
    send({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));
port = server.address().port;
writeFileSync(
  join(home, 'config.json'),
  JSON.stringify({
    defaultModel: 'mock/agente-demo',
    providers: { mock: {} },
    customProviders: [
      {
        id: 'mock',
        name: 'Mock',
        adapter: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        auth: { type: 'none', optional: true },
        region: 'local',
        category: 'local',
        modelsEndpoint: '/models',
        supports: {
          listModels: true,
          streaming: true,
          tools: true,
          vision: false,
          jsonMode: false,
          embeddings: false,
          fim: false,
        },
        status: 'active',
        verifiedAt: null,
      },
    ],
  }),
);

const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.tree-row');
await win.locator('.activity[title="Centro de seguridad"]').click();
await win.waitForSelector('.security');
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'security-center.png') });
await win.locator('.sec-card button.primary').first().click();
const approvals = [];
for (let i = 0; i < 10; i++) {
  const card = win.locator('.tool-card.approval');
  const done = win.locator('text=Listo ✅');
  await Promise.race([
    card.first().waitFor({ timeout: 20000 }),
    done.first().waitFor({ timeout: 20000 }),
  ]);
  if (await done.count()) break;
  approvals.push(await card.first().locator('.tool-name').textContent());
  const idx = await card
    .first()
    .evaluate((el) => [...document.querySelectorAll('.tool-card')].indexOf(el));
  await card.first().locator('button.primary').click();
  await win.waitForFunction(
    (k) => !document.querySelectorAll('.tool-card')[k]?.classList.contains('approval'),
    idx,
  );
}
await win.waitForSelector('text=Listo ✅', { timeout: 30000 });
await win.waitForTimeout(400);
await win.screenshot({ path: join(out, 'security-done.png') });
const answer = await win.locator('text=Listo ✅').first().textContent();
console.log({ approvals, answer, errors });
await app.close();
server.close();
const ok =
  ['aws', 'sql', 'masked', 'port', 'nohttps', 'server', 'hash'].every((k) => answer.includes(k)) &&
  approvals.join() === 'port_scan,check_site_security';
console.log(ok ? 'SECURITY OK' : 'SECURITY FAILED');
if (!ok) process.exit(1);
