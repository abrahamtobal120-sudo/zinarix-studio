// End-to-end check of the "read many files" tools and the AI-controlled browser, against a
// scripted OpenAI-compatible mock model: tree + read_many_files (parallel) -> browser_open
// (approved once for the site) -> browser_type -> browser_click -> final answer.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const PAGE = `<!doctype html><html><head><title>Página de prueba</title></head><body style="font:16px sans-serif;padding:30px">
<h1>Buscador de prueba</h1>
<input name="q" placeholder="¿Qué buscas?" style="font-size:16px;padding:6px">
<button id="go" onclick="document.getElementById('r').textContent='Resultado: '+document.querySelector('input').value">Buscar</button>
<p id="r"></p><a href="/otra">Otra página</a></body></html>`;

const lastTool = (j) => j.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '';
const refOf = (text, re) =>
  Number(
    text
      .split('\n')
      .find((l) => re.test(l))
      ?.match(/^\[(\d+)\]/)?.[1],
  );
let base = '';
const steps = [
  () => [
    { name: 'tree', args: { path: '.', depth: 3 } },
    { name: 'read_many_files', args: { pattern: '**/*.txt' } },
    { name: 'glob', args: { pattern: 'src/**/*.js' } },
  ],
  () => [{ name: 'browser_open', args: { url: `${base}/page` } }],
  (j) => [{ name: 'browser_type', args: { ref: refOf(lastTool(j), /input/), text: 'zinarix' } }],
  (j) => [{ name: 'browser_click', args: { ref: refOf(lastTool(j), /"Buscar"/) } }],
];

const server = createServer((req, res) => {
  if (req.url === '/page') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'agente-demo' }] }));
    }
    const j = JSON.parse(body);
    const turn =
      j.messages.filter((m) => m.role === 'assistant').length -
      j.messages.filter((m) => m.role === 'assistant' && !m.tool_calls).length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (turn < steps.length) {
      const calls = steps[turn](j);
      send({
        choices: [
          { delta: { content: `Paso ${turn + 1}: ${calls.map((c) => c.name).join(', ')}.` } },
        ],
      });
      send({
        choices: [
          {
            delta: {
              tool_calls: calls.map((c, i) => ({
                index: i,
                id: `call_${turn}_${i}`,
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    } else {
      const line =
        lastTool(j)
          .split('\n')
          .find((l) => l.includes('Resultado:')) ?? '(sin resultado)';
      send({ choices: [{ delta: { content: `Listo ✅ ${line}` }, finish_reason: 'stop' }] });
    }
    send({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));
base = `http://127.0.0.1:${server.address().port}`;
const url = `${base}/v1`;

const home = mkdtempSync(join(tmpdir(), 'zs-browser-'));
const proj = join(home, 'proyecto');
mkdirSync(join(proj, 'src', 'lib'), { recursive: true });
writeFileSync(join(proj, 'notas.txt'), 'Notas del proyecto');
writeFileSync(join(proj, 'src', 'leeme.txt'), 'Otro archivo de texto');
writeFileSync(join(proj, 'src', 'app.js'), 'console.log(1)');
writeFileSync(join(proj, 'src', 'lib', 'util.js'), 'export {}');
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
        baseUrl: url,
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
await win.locator('.chat-input textarea').fill('lee el proyecto y prueba la página de búsqueda');
await win.keyboard.press('Enter');
await win.waitForSelector('.tool-card.approval', { timeout: 20000 });
await win.waitForSelector('.browser-pane', { timeout: 5000 });
await win.screenshot({ path: join(out, 'browser-approval.png') });
// "Always for this site": the following click/type on the same host need no approval.
await win.locator('.tool-actions button', { hasText: /siempre|always/i }).click();
await win.waitForSelector('text=Listo ✅', { timeout: 30000 });
await win.waitForTimeout(800);
await win.screenshot({ path: join(out, 'browser-done.png') });
// The page is a native view (not in the renderer screenshot): check it is placed and capture it.
const view = await app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  const v = w.contentView.children[0];
  const img = await v.webContents.capturePage();
  return { bounds: v.getBounds(), visible: v.getVisible(), png: img.toPNG().toString('base64') };
});
writeFileSync(join(out, 'browser-page.png'), Buffer.from(view.png, 'base64'));
console.log('view:', JSON.stringify(view.bounds), 'visible:', view.visible);
const answer = await win.locator('text=Listo ✅').first().textContent();
const cards = await win
  .locator('.tool-card')
  .evaluateAll((els) => els.map((e) => e.className + ' | ' + e.textContent));
console.log(cards.join('\n'));
console.log('answer:', answer);
console.log('errors:', errors.length ? errors : 'none');
await app.close();
server.close();
if (!answer?.includes('Resultado: zinarix')) process.exit(1);
