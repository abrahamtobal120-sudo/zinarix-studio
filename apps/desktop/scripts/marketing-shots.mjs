// Generates the website screenshots from the real app (demo data, scripted demo model).
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OmniCore, recordUsage } from '@omni/core';

const out = process.argv[2];
const steps = [
  { say: 'Voy a revisar la estructura del proyecto.', name: 'list_dir', args: { path: '.' } },
  { say: 'Leo el validador actual.', name: 'read_file', args: { path: 'src/validate.js' } },
  {
    say: 'Agrego la validación de email.',
    name: 'edit_file',
    args: {
      path: 'src/validate.js',
      old_string: "export function isValidUser(user) {\n  return Boolean(user.name);\n}",
      new_string:
        "const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n\nexport function isValidUser(user) {\n  return Boolean(user.name) && EMAIL.test(user.email ?? '');\n}",
    },
  },
  { say: 'Corro las pruebas para verificar.', name: 'run_command', args: { command: 'node --test' } },
];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'demo-coder', context_length: 262144 }] }));
    }
    const j = JSON.parse(body);
    const done = j.messages.filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (done < steps.length) {
      const s = steps[done];
      send({ choices: [{ delta: { content: s.say } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${done}`, function: { name: s.name, arguments: JSON.stringify(s.args) } }] }, finish_reason: 'tool_calls' }] });
    } else {
      send({ choices: [{ delta: { content: '✅ Listo. `isValidUser` ahora exige un email válido y **las 3 pruebas pasan**.\n\n- Regex simple y sin dependencias\n- Si quieres, también puedo normalizar el email a minúsculas.' }, finish_reason: 'stop' }] });
    }
    send({ choices: [], usage: { prompt_tokens: 1800, completion_tokens: 220 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));

const home = mkdtempSync(join(tmpdir(), 'zs-mkt-'));
const proj = join(home, 'tienda-api');
mkdirSync(join(proj, 'src'), { recursive: true });
mkdirSync(join(proj, 'test'));
writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'tienda-api', type: 'module', scripts: { test: 'node --test' } }, null, 2));
writeFileSync(join(proj, 'README.md'), '# Tienda API\n\nAPI de ejemplo.\n');
writeFileSync(join(proj, 'src/validate.js'), "export function isValidUser(user) {\n  return Boolean(user.name);\n}\n");
writeFileSync(join(proj, 'src/server.js'), "import { createServer } from 'node:http';\nimport { isValidUser } from './validate.js';\n\nconst users = [];\n\ncreateServer((req, res) => {\n  if (req.method === 'POST' && req.url === '/users') {\n    let body = '';\n    req.on('data', (c) => (body += c));\n    req.on('end', () => {\n      const user = JSON.parse(body);\n      if (!isValidUser(user)) {\n        res.writeHead(400).end('usuario inválido');\n        return;\n      }\n      users.push(user);\n      res.writeHead(201).end(JSON.stringify(user));\n    });\n    return;\n  }\n  res.end(JSON.stringify(users));\n}).listen(3000);\n");
writeFileSync(join(proj, 'test/validate.test.js'), "import test from 'node:test';\nimport assert from 'node:assert';\nimport { isValidUser } from '../src/validate.js';\n\ntest('nombre obligatorio', () => assert.equal(isValidUser({ email: 'a@b.co' }), false));\ntest('email válido', () => assert.equal(isValidUser({ name: 'Ana', email: 'ana@mail.com' }), true));\ntest('email inválido', () => assert.equal(isValidUser({ name: 'Ana', email: 'ana' }), false));\n");

const core = OmniCore.open({ home, env: { OMNI_NO_KEYCHAIN: '1' } });
const day = 86_400_000;
const sample = [['anthropic', 'claude-sonnet-5-5', 0.42], ['openai', 'gpt-6.1-sol', 0.21], ['deepseek', 'deepseek-flash', 0.04], ['groq', 'llama', 0.03]];
for (let d = 0; d < 30; d++) for (const [p, m, c] of sample) if ((d * 7 + p.length) % 4) recordUsage(core.db, { provider: p, model: m, inputTokens: 52000 + d * 1300, outputTokens: 7000 + d * 90, costUsd: c * (1 + ((d * 3) % 7) / 4) }, Date.now() - d * day);
core.saveConfig({
  ...core.config,
  defaultModel: 'demo/demo-coder',
  providers: { demo: { params: {}, headers: {} } },
  customProviders: [{ id: 'demo', name: 'Demo', adapter: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, baseUrlParams: [], auth: { type: 'none', optional: true }, envVars: [], region: 'local', category: 'custom', modelsEndpoint: '/models', supports: { listModels: true, streaming: true, tools: true, vision: false, jsonMode: false, embeddings: false, fim: false }, fallbackModels: [], status: 'active', verifiedAt: null }],
  budgets: { anthropic: { monthly: 30, hardStop: false }, openai: { monthly: 10, hardStop: false } },
});
core.close();

const app = await electron.launch({ executablePath: 'node_modules/electron/dist/electron', args: ['.', proj], env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' } });
const win = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1600, 960); w.center(); });
await win.waitForSelector('.tree-row');
await win.locator('.tree-row', { hasText: 'src' }).first().click();
await win.locator('.tree-row', { hasText: 'server.js' }).first().click();
await win.waitForTimeout(700);
const ask = async (text) => {
  await win.locator('.chat-input textarea').fill(text);
  await win.keyboard.press('Enter');
};
await ask('Agrega validación de email al usuario y corre las pruebas');
for (let i = 0; i < 2; i++) {
  await win.waitForSelector('.tool-card.approval', { timeout: 20000 });
  await win.waitForTimeout(600);
  if (i === 0) await win.screenshot({ path: join(out, 'screenshot-approval.png') });
  await win.locator('.tool-actions button.primary').click();
}
await win.waitForSelector('text=las 3 pruebas pasan', { timeout: 20000 });
await win.locator('.tree-row', { hasText: 'validate.js' }).first().click();
await win.waitForTimeout(900);
await win.screenshot({ path: join(out, 'screenshot-agent.png') });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('omni:event', { type: 'command', command: 'ai.pickModel' }));
await win.waitForSelector('.mp-card');
await win.waitForTimeout(1500);
await win.screenshot({ path: join(out, 'screenshot-models.png') });
await win.keyboard.press('Escape');
await win.waitForTimeout(300);
await win.locator('.status-item', { hasText: '📊' }).click();
await win.waitForSelector('.usage-table');
await win.waitForTimeout(600);
await win.screenshot({ path: join(out, 'screenshot-usage.png') });
await app.close();
server.close();
console.log('ok');
