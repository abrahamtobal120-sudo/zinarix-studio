// End-to-end: chats are saved, restored after restarting the app, and listed in the history panel.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'demo' }] }));
    }
    const j = JSON.parse(body);
    const tools = j.messages.filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (j.tools && tools === 0) {
      send({ choices: [{ delta: { content: 'Reviso el proyecto.' } }] });
      send({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'c0', function: { name: 'list_dir', arguments: '{"path":"."}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    } else {
      const last = j.messages.at(-1).content;
      send({
        choices: [
          { delta: { content: `Respuesta a: ${String(last).slice(-40)}` }, finish_reason: 'stop' },
        ],
      });
    }
    send({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));

const home = mkdtempSync(join(tmpdir(), 'zs-hist-'));
const proj = join(home, 'proyecto');
mkdirSync(proj);
writeFileSync(join(proj, 'a.txt'), 'hola');
writeFileSync(
  join(home, 'config.json'),
  JSON.stringify({
    defaultModel: 'mock/demo',
    providers: { mock: {} },
    customProviders: [
      {
        id: 'mock',
        name: 'Mock',
        adapter: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
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
const launch = () =>
  electron.launch({
    executablePath: 'node_modules/electron/dist/electron',
    args: ['.', proj],
    env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
  });
const ask = async (win, text) => {
  await win.locator('.chat-input textarea').fill(text);
  await win.keyboard.press('Enter');
};

// Session 1: an agent chat, then a second plain chat.
let app = await launch();
let win = await app.firstWindow();
await win.waitForSelector('.tree-row');
await ask(win, 'primer chat con el agente');
await win.waitForSelector('text=Respuesta a:', { timeout: 20000 });
await ask(win, 'segunda pregunta en el mismo chat');
await win.waitForFunction(() => document.querySelectorAll('.turn.assistant').length === 2, null, {
  timeout: 20000,
});
await win.waitForTimeout(500);
await win.locator('button[title="Nueva conversación"], button[title="New conversation"]').click();
await win.locator('.agent-toggle input').uncheck();
await ask(win, 'otro chat distinto sin agente');
await win.waitForSelector('text=Respuesta a:', { timeout: 20000 });
await win.waitForTimeout(500);
await app.close();

// Session 2: the last conversation is restored; history lists both.
app = await launch();
win = await app.firstWindow();
await win.waitForSelector('.turn.user', { timeout: 15000 });
const restored = await win.locator('.turn-user').allTextContents();
await win.locator('button[title="Historial de chats"], button[title="Chat history"]').click();
await win.waitForSelector('.ch-item');
const items = await win.locator('.ch-name').allTextContents();
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'history-panel.png') });
await win.locator('.ch-item', { hasText: 'primer chat' }).click();
await win.waitForSelector('.tool-card');
const agentTurns = await win.locator('.turn-user').allTextContents();
const toolCards = await win.locator('.tool-card').count();
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'history-reopened.png') });
console.log(JSON.stringify({ restored, items, agentTurns, toolCards }, null, 1));
await app.close();
server.close();
