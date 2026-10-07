// End-to-end check of agent mode against a scripted OpenAI-compatible mock model:
// list_dir -> read_file -> run_command (approved in the UI) -> final answer.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const steps = [
  { name: 'list_dir', args: { path: '.' } },
  { name: 'read_file', args: { path: 'hola.txt' } },
  { name: 'run_command', args: { command: 'echo "desde la terminal: $(cat hola.txt)" && ls' } },
  {
    name: 'edit_file',
    args: {
      path: 'hola.txt',
      old_string: 'Hola Zinarix',
      new_string: 'Hola Zinarix Studio — editado por la IA',
    },
  },
];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'agente-demo' }] }));
    }
    const j = JSON.parse(body);
    const done = j.messages.filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (done < steps.length) {
      const s = steps[done];
      send({ choices: [{ delta: { content: `Paso ${done + 1}: uso ${s.name}.` } }] });
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
            delta: {
              content: `Listo ✅. La terminal respondió:\n\n\`\`\`\n${last.split('\n').slice(2, 4).join('\n')}\n\`\`\``,
            },
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
const url = `http://127.0.0.1:${server.address().port}/v1`;

const home = mkdtempSync(join(tmpdir(), 'zs-agent-'));
const proj = join(home, 'proyecto');
mkdirSync(proj);
writeFileSync(join(proj, 'hola.txt'), 'Hola Zinarix');
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
await win
  .locator('.chat-input textarea')
  .fill('lista los archivos, lee hola.txt y ejecuta un comando');
await win.keyboard.press('Enter');
await win.waitForSelector('.tool-card.approval', { timeout: 15000 });
await win.screenshot({ path: join(out, 'agent-approval.png') });
await win.locator('.tool-actions button.primary').click();
await win.waitForSelector('.tool-card.approval .tool-diff', { timeout: 15000 });
await win.waitForTimeout(800);
await win.screenshot({ path: join(out, 'agent-diff.png') });
await win.locator('.tool-actions button.primary').click();
await win.waitForSelector('text=Listo ✅', { timeout: 20000 });
const { readFileSync } = await import('node:fs');
console.log('after edit:', readFileSync(join(proj, 'hola.txt'), 'utf8'));
win.once('dialog', (d) => d.accept());
await win.locator('.agent-changes button').click();
await win.waitForTimeout(800);
console.log('after revert:', readFileSync(join(proj, 'hola.txt'), 'utf8'));
await win.waitForTimeout(500);
await win.screenshot({ path: join(out, 'agent-done.png') });
const cards = await win
  .locator('.tool-card')
  .evaluateAll((els) => els.map((e) => e.className + ' | ' + e.textContent));
console.log(cards.join('\n'));
console.log('errors:', errors.length ? errors : 'none');
await app.close();
server.close();
