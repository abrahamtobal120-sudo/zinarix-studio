// End-to-end: a terminal session (or its selection) is attached to the chat and reaches the model.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const received = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'demo' }] }));
    }
    const j = JSON.parse(body);
    received.push(JSON.stringify(j.messages));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ choices: [{ delta: { content: 'Vi la terminal.' }, finish_reason: 'stop' }] });
    send({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 4 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));

const home = mkdtempSync(join(tmpdir(), 'zs-term-'));
// Outside OMNI_HOME: the agent never touches the app's own data folder.
const proj = join(mkdtempSync(join(tmpdir(), 'zs-ws-')), 'proyecto');
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

const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForSelector('.tree-row');
// The checkboxes are drawn as pills: click the label (the input itself is hidden).
if (await win.locator('.agent-toggle input').isChecked())
  await win.locator('.agent-toggle').click();
const fileCheck = win.locator('.chat-input label.check:not(.agent-toggle)');
if (await fileCheck.locator('input').isChecked()) await fileCheck.click();

// Open the terminal and print a marker.
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
    type: 'command',
    command: 'view.terminal',
  }),
);
await win.waitForSelector('.xterm-host .xterm');
await win.waitForTimeout(1500);
await win.locator('.terminal-host').click();
await win.keyboard.type('echo MARCA-$((40+2))');
await win.keyboard.press('Enter');
await win.waitForTimeout(1000);

// 1) Whole session via the terminal header button.
await win.locator('button.term-to-chat').click();
await win.waitForSelector('.chat-attachment');
const chip1 = await win.locator('.chat-attachment').allTextContents();
await win.screenshot({ path: join(out, 'terminal-chat-chip.png') });
await win.locator('.chat-input textarea').fill('¿qué imprimió?');
await win.keyboard.press('Enter');
await win.waitForSelector('text=Vi la terminal.', { timeout: 20000 });
const chipsAfterSend = await win.locator('.chat-attachment').count();
const turnContext = await win.locator('.turn-context').allTextContents();

// 2) Session picker in the chat.
await win.locator('button.term-pick[aria-label*="erminal"]').click();
await win.waitForSelector('.term-menu');
const menu = await win.locator('.term-menu button').allTextContents();
await win.screenshot({ path: join(out, 'terminal-chat-menu.png') });
await win.locator('.term-menu button').first().click();
const chip2 = await win.locator('.chat-attachment').allTextContents();

const sawMarker = received.some((m) => m.includes('MARCA-42'));
console.log(
  JSON.stringify({ chip1, chipsAfterSend, turnContext, menu, chip2, sawMarker }, null, 1),
);
await app.close();
server.close();
