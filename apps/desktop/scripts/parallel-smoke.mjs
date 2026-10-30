// End-to-end check of parallel chats, AI-to-AI delegation and multiple windows, against
// scripted OpenAI-compatible mock models:
//  1. chat A (slow model) keeps streaming while chat B (fast model) answers in another tab;
//  2. both chats side by side;
//  3. a "boss" model delegates to a helper model WITHOUT native tools: the user approves the
//     delegation, the helper opens a page with the text protocol (approved too), and its
//     answer goes back to the boss;
//  4. a second window opens with its own chats.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const PAGE = `<!doctype html><html><head><title>Página de prueba</title></head><body style="font:16px sans-serif;padding:30px"><h1>Hola desde la página</h1></body></html>`;
let base = '';
const seen = { helperTools: [], helperSystem: '' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = createServer((req, res) => {
  if (req.url === '/page') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    if (req.url.endsWith('/models')) {
      const ids = req.url.includes('/v2/') ? ['ayudante'] : ['rapido', 'lento', 'jefe'];
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
    }
    const j = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const text = (t) => send({ choices: [{ delta: { content: t } }] });
    const done = () => {
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      send({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } });
      res.end('data: [DONE]\n\n');
    };
    const tools = j.messages.filter((m) => m.role === 'tool');
    switch (j.model) {
      case 'rapido':
        text('Respuesta rápida ✅');
        return done();
      case 'lento':
        for (const w of ['Respuesta ', 'lenta ', 'en ', 'camino… ']) {
          text(w);
          await sleep(900);
        }
        text('Respuesta lenta completa ✅');
        return done();
      case 'jefe':
        if (!tools.length) {
          text('Le pido ayuda a otra IA.');
          send({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_d',
                      function: {
                        name: 'delegate_to_ai',
                        arguments: JSON.stringify({
                          model: 'mock2/ayudante',
                          task: 'Abre la página de prueba y dime su título.',
                          mode: 'agent',
                        }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          });
          send({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } });
          return res.end('data: [DONE]\n\n');
        }
        text(
          `El ayudante dijo: ${tools.at(-1).content.includes('Página de prueba') ? 'título correcto ✅' : 'algo raro ❌'}`,
        );
        return done();
      case 'ayudante': {
        // A model without native tools: no "tools" in the request, the protocol in the prompt.
        seen.helperTools.push(Boolean(j.tools));
        seen.helperSystem = j.messages.find((m) => m.role === 'system')?.content ?? '';
        const results = j.messages.find(
          (m) => m.role === 'user' && String(m.content).includes('<tool_results>'),
        );
        if (!results) {
          text('Voy a abrir la página.\n<tool_call>\n');
          text(JSON.stringify({ name: 'browser_open', arguments: { url: `${base}/page` } }));
          text('\n</tool_call>\nResultado inventado que no debe verse.');
          return done();
        }
        const title = /Title: (.*)/.exec(String(results.content))?.[1] ?? '?';
        text(`El título es "${title}".`);
        return done();
      }
    }
    text('modelo desconocido');
    done();
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));
base = `http://127.0.0.1:${server.address().port}`;

const provider = (id, url, tools) => ({
  id,
  name: id === 'mock' ? 'Mock' : 'Mock sin herramientas',
  adapter: 'openai-compatible',
  baseUrl: url,
  auth: { type: 'none', optional: true },
  region: 'local',
  category: 'local',
  modelsEndpoint: '/models',
  supports: {
    listModels: true,
    streaming: true,
    tools,
    vision: false,
    jsonMode: false,
    embeddings: false,
    fim: false,
  },
  status: 'active',
  verifiedAt: null,
});
const home = mkdtempSync(join(tmpdir(), 'zs-par-'));
const proj = join(mkdtempSync(join(tmpdir(), 'zs-ws-')), 'proyecto');
mkdirSync(proj);
writeFileSync(join(proj, 'README.md'), '# Proyecto de prueba\n');
writeFileSync(
  join(home, 'config.json'),
  JSON.stringify({
    defaultModel: 'mock/rapido',
    providers: { mock: {}, mock2: {} },
    customProviders: [provider('mock', `${base}/v1`, true), provider('mock2', `${base}/v2`, false)],
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
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) process.exitCode = 1;
};
const visible = '.chat-session:visible';
const pickModel = async (q) => {
  await win.locator(`${visible} .model-chip`).first().click();
  await win.locator('.mp-search').fill(q);
  await win.waitForTimeout(300);
  await win.locator('.mp-search').press('Enter');
  await win.waitForTimeout(300);
};
const say = async (prompt) => {
  await win.locator(`${visible} .chat-input textarea`).first().fill(prompt);
  await win.locator(`${visible} .chat-input textarea`).first().press('Enter');
};

// 1. two chats at the same time
await pickModel('lento');
await say('Cuéntame algo despacio');
await win.waitForTimeout(600);
await win.locator('.chat-tabs-bar .sidebar-actions button').first().click(); // new chat
await win.waitForTimeout(300);
await say('Y tú, rápido');
await win.waitForSelector(`${visible} >> text=Respuesta rápida ✅`, { timeout: 10000 });
ok(
  (await win.locator('.chat-tab .chat-tab-spin').count()) === 1,
  'el chat lento sigue trabajando mientras el rápido ya respondió',
);
await win.screenshot({ path: join(out, 'parallel-tabs.png') });
await win.waitForFunction(
  () => document.body.textContent.includes('Respuesta lenta completa ✅'),
  null,
  { timeout: 15000 },
);
ok(true, 'el chat lento terminó en segundo plano sin pausarse');
ok((await win.locator('.chat-tab .chat-tab-dot').count()) === 1, 'su pestaña avisa que terminó');

// 2. side by side
await win.locator('.chat-tabs-bar .sidebar-actions button').nth(1).click();
await win.waitForTimeout(500);
ok((await win.locator('.chat-session:visible').count()) === 2, 'dos chats a la par');
await win.screenshot({ path: join(out, 'parallel-split.png') });
await win.locator('.chat-tabs-bar .sidebar-actions button').nth(1).click(); // back to one

// 3. delegation with approval; the helper has no native tools
await win.locator('.chat-tabs-bar .sidebar-actions button').first().click();
await win.waitForTimeout(300);
await pickModel('jefe');
await say('Pídele a otra IA que revise la página');
await win.waitForSelector(`${visible} .tool-card.approval .tool-delegate`, { timeout: 15000 });
await win.screenshot({ path: join(out, 'delegate-approval.png') });
await win.locator(`${visible} .tool-card.approval .tool-actions button.primary`).click();
await win.waitForSelector(`${visible} .tool-card.approval .tool-helper`, { timeout: 15000 });
await win.screenshot({ path: join(out, 'helper-browser-approval.png') });
await win.locator(`${visible} .tool-card.approval .tool-actions button.primary`).click();
await win.waitForSelector(`${visible} >> text=El ayudante dijo: título correcto ✅`, {
  timeout: 30000,
});
ok(true, 'el jefe recibió la respuesta del ayudante');
ok(
  seen.helperTools.every((t) => !t),
  'al ayudante (sin herramientas nativas) no se le mandaron tools',
);
ok(
  seen.helperSystem.includes('<zinarix-tools>'),
  'el ayudante recibió el protocolo de herramientas por texto',
);
const page = await win.locator(`${visible}`).textContent();
ok(!page.includes('Resultado inventado'), 'el texto inventado después de <tool_call> no se mostró');
ok(!page.includes('<tool_call>'), 'los bloques <tool_call> no se ven en el chat');
const tabs = await win.evaluate(() => window.omni.browser.tabs());
ok(
  tabs.tabs.some((t) => t.ai && t.label.includes('ayudante')),
  'el ayudante usó su propia pestaña del navegador',
);
await win.locator(`${visible} .tool-card .tool-head`).first().click();
await win.waitForTimeout(400);
await win.screenshot({ path: join(out, 'delegate-done.png') });

// 4. a second window
const second = app.waitForEvent('window');
await win.evaluate(() => window.omni.app.newWindow());
const w2 = await second;
await w2.waitForSelector('.chat-input textarea', { timeout: 15000 });
ok(
  (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 2,
  'se abrió una segunda ventana',
);
await w2.locator('.chat-input textarea').first().fill('hola desde la ventana 2');
await w2.locator('.chat-input textarea').first().press('Enter');
await w2.waitForSelector('text=Respuesta rápida ✅', { timeout: 10000 });
ok(true, 'la segunda ventana chatea por su cuenta');
await w2.screenshot({ path: join(out, 'second-window.png') });

console.log('errors:', errors.length ? errors : 'none');
await app.close();
server.close();
