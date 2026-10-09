// End-to-end check of the agent's actions beyond the project (network, HTTP, SQL, system
// files, environment variables), each one approved in the UI with its risk warning.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'zs-system-'));
const proj = join(home, 'proyecto');
const outside = join(home, 'fuera');
mkdirSync(proj);
mkdirSync(outside);
const sysFile = join(outside, 'app.conf');
writeFileSync(sysFile, 'modo=lento\n');
const dbFile = join(outside, 'tienda.db');
const db = new DatabaseSync(dbFile);
db.exec(
  "CREATE TABLE productos (id INTEGER, nombre TEXT); INSERT INTO productos VALUES (1,'silla'),(2,'mesa');",
);
db.close();

let base = '';
const posts = [];
const steps = () => [
  { name: 'network_status', args: { target: base, connections: false } },
  { name: 'http_request', args: { method: 'POST', url: `${base}/api/pedidos`, body: '{"id":7}' } },
  { name: 'sql_query', args: { database: dbFile, query: 'SELECT * FROM productos' } },
  {
    name: 'sql_query',
    args: { database: dbFile, query: "DELETE FROM productos WHERE nombre = 'mesa'" },
  },
  {
    name: 'write_system_file',
    args: { path: sysFile, old_string: 'modo=lento', new_string: 'modo=rapido' },
  },
  { name: 'set_env_var', args: { name: 'ZX_DEMO', value: 'hola-zinarix', scope: 'session' } },
  { name: 'run_command', args: { command: 'echo "variable: $ZX_DEMO"' } },
];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url === '/api/pedidos') {
      posts.push(body);
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.method === 'HEAD') return res.writeHead(200).end();
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
                  id: `call_${done}`,
                  function: { name: s.name, arguments: JSON.stringify(s.args) },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    } else {
      const last = j.messages.filter((m) => m.role === 'tool').at(-1).content;
      send({
        choices: [
          {
            delta: { content: `Listo ✅ ${last.match(/variable: [\w-]+/)?.[0] ?? '?'}` },
            finish_reason: 'stop',
          },
        ],
      });
    }
    send({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));
base = `http://127.0.0.1:${server.address().port}`;
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
        baseUrl: `${base}/v1`,
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
await win.waitForSelector('.welcome, .tree-row');
await win
  .locator('.chat-input textarea')
  .fill('revisa la red, la API, la base de datos y la configuración');
await win.keyboard.press('Enter');
const approvals = [];
const out = process.argv[2] ?? tmpdir();
for (let i = 0; i < 20; i++) {
  const card = win.locator('.tool-card.approval');
  const done = win.locator('text=Listo ✅');
  await Promise.race([
    card.first().waitFor({ timeout: 20000 }),
    done.first().waitFor({ timeout: 20000 }),
  ]);
  if (await done.count()) break;
  const info = await card.first().evaluate((el) => ({
    name: el.querySelector('.tool-name')?.textContent,
    risk: el.className.match(/risk-(\w+)/)?.[1] ?? 'normal',
    always: [...el.querySelectorAll('.tool-actions button')].length === 3,
    warning: el.querySelector('.tool-warning')?.textContent?.slice(0, 90) ?? '',
  }));
  approvals.push(info);
  if (info.name === 'http_request')
    await win.screenshot({ path: join(out, 'system-approval.png') });
  const idx = await card
    .first()
    .evaluate((el) => [...document.querySelectorAll('.tool-card')].indexOf(el));
  await card.first().locator('button.primary').click();
  // Wait until that approval is resolved before looking for the next one.
  await win.waitForFunction(
    (i) => !document.querySelectorAll('.tool-card')[i]?.classList.contains('approval'),
    idx,
    { timeout: 20000 },
  );
}
await win.waitForSelector('text=Listo ✅', { timeout: 20000 });
const answer = await win.locator('text=Listo ✅').first().textContent();
const conf = readFileSync(sysFile, 'utf8');
const db2 = new DatabaseSync(dbFile, { readOnly: true });
const rows = db2
  .prepare('SELECT nombre FROM productos')
  .all()
  .map((r) => r.nombre);
db2.close();
win.once('dialog', (d) => d.accept());
await win.locator('.agent-changes button').click();
await win.waitForTimeout(800);
const reverted = readFileSync(sysFile, 'utf8');
console.table(approvals);
console.log({ answer, posts, conf, rows, reverted, errors });
await app.close();
server.close();
const ok =
  answer.includes('hola-zinarix') &&
  posts[0] === '{"id":7}' &&
  conf === 'modo=rapido\n' &&
  rows.join() === 'silla' &&
  reverted === 'modo=lento\n' &&
  approvals.find((a) => a.name === 'http_request')?.always === false &&
  approvals.find((a) => a.name === 'network_status')?.always === true;
console.log(ok ? 'SYSTEM OK' : 'SYSTEM FAILED');
if (!ok) process.exit(1);
