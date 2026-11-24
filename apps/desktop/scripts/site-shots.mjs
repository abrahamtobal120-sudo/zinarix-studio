// Generates ALL the website screenshots (light theme, Pro plan) from the real app (demo data, scripted demo model).
//   node scripts/marketing-shots.mjs <out>                      dark theme, the landing page
//   SHOT_THEME=light SHOT_PLAN=pro node scripts/marketing-shots.mjs <out>
// SHOT_THEME / SHOT_PLAN (a plan code: free, pro, ai, proai) also take the two-chat (split)
// and plan-panel shots, for the sales page.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { OmniCore, recordUsage } from '@omni/core';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const steps = [
  { say: 'Voy a revisar la estructura del proyecto.', name: 'list_dir', args: { path: '.' } },
  { say: 'Leo el validador actual.', name: 'read_file', args: { path: 'src/validate.js' } },
  {
    say: 'Agrego la validación de email.',
    name: 'edit_file',
    args: {
      path: 'src/validate.js',
      old_string: 'export function isValidUser(user) {\n  return Boolean(user.name);\n}',
      new_string:
        "const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n\nexport function isValidUser(user) {\n  return Boolean(user.name) && EMAIL.test(user.email ?? '');\n}",
    },
  },
  {
    say: 'Corro las pruebas para verificar.',
    name: 'run_command',
    args: { command: 'node --test' },
  },
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
      send({
        choices: [
          {
            delta: {
              content:
                '✅ Listo. `isValidUser` ahora exige un email válido y **las 3 pruebas pasan**.\n\n- Regex simple y sin dependencias\n- Si quieres, también puedo normalizar el email a minúsculas.',
            },
            finish_reason: 'stop',
          },
        ],
      });
    }
    send({ choices: [], usage: { prompt_tokens: 1800, completion_tokens: 220 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));

const home = mkdtempSync(join(tmpdir(), 'zs-mkt-'));
// Outside OMNI_HOME: the agent never touches the app's own data folder.
const proj = join(mkdtempSync(join(tmpdir(), 'zs-ws-')), 'tienda-api');
mkdirSync(join(proj, 'src'), { recursive: true });
mkdirSync(join(proj, 'test'));
writeFileSync(
  join(proj, 'package.json'),
  JSON.stringify({ name: 'tienda-api', type: 'module', scripts: { test: 'node --test' } }, null, 2),
);
writeFileSync(join(proj, 'README.md'), '# Tienda API\n\nAPI de ejemplo.\n');
writeFileSync(
  join(proj, 'src/validate.js'),
  'export function isValidUser(user) {\n  return Boolean(user.name);\n}\n',
);
writeFileSync(
  join(proj, 'src/server.js'),
  "import { createServer } from 'node:http';\nimport { isValidUser } from './validate.js';\n\nconst users = [];\n\ncreateServer((req, res) => {\n  if (req.method === 'POST' && req.url === '/users') {\n    let body = '';\n    req.on('data', (c) => (body += c));\n    req.on('end', () => {\n      const user = JSON.parse(body);\n      if (!isValidUser(user)) {\n        res.writeHead(400).end('usuario inválido');\n        return;\n      }\n      users.push(user);\n      res.writeHead(201).end(JSON.stringify(user));\n    });\n    return;\n  }\n  res.end(JSON.stringify(users));\n}).listen(3000);\n",
);
writeFileSync(
  join(proj, 'test/validate.test.js'),
  "import test from 'node:test';\nimport assert from 'node:assert';\nimport { isValidUser } from '../src/validate.js';\n\ntest('nombre obligatorio', () => assert.equal(isValidUser({ email: 'a@b.co' }), false));\ntest('email válido', () => assert.equal(isValidUser({ name: 'Ana', email: 'ana@mail.com' }), true));\ntest('email inválido', () => assert.equal(isValidUser({ name: 'Ana', email: 'ana' }), false));\n",
);

// Extra project files so every panel has something to show.
writeFileSync(
  join(proj, 'index.html'),
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tienda</title><style>body{font-family:system-ui;margin:0;background:#f7f4ee;color:#1c1b19}header{padding:64px 48px;background:#1f3a5f;color:#fff}h1{font-size:48px;margin:0 0 12px}p{font-size:20px;opacity:.85}.cards{display:flex;gap:24px;padding:48px}.card{flex:1;background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 10px #0001}button{background:#f2a541;border:0;padding:14px 24px;border-radius:10px;font-size:16px}</style></head><body><header><h1>Tienda de café</h1><p>Granos de Veracruz y Chiapas, tostados cada semana.</p><button>Ver productos</button></header><section class="cards"><div class="card"><h2>Veracruz</h2><p>Notas de chocolate.</p></div><div class="card"><h2>Chiapas</h2><p>Notas de frutos rojos.</p></div><div class="card"><h2>Oaxaca</h2><p>Notas de caramelo.</p></div></section></body></html>\n',
);
mkdirSync(join(proj, 'modelos'));
writeFileSync(
  join(proj, 'modelos/caja.scad'),
  '// Caja con tapa\nancho = 60; // [20:120]\nlargo = 40; // [20:120]\nalto = 30; // [10:80]\npared = 2;\n\ndifference() {\n  cube([ancho, largo, alto]);\n  translate([pared, pared, pared]) cube([ancho - 2 * pared, largo - 2 * pared, alto]);\n}\ntranslate([0, largo + 10, 0]) cube([ancho, largo, pared]);\n',
);
try {
  execSync(
    'git init -q && git add -A && git -c user.name=Demo -c user.email=demo@example.com commit -qm "Primera versión de la API"',
    { cwd: proj },
  );
  writeFileSync(
    join(proj, 'README.md'),
    '# Tienda API\n\nAPI de ejemplo con validación de usuarios.\n',
  );
} catch (e) {
  console.warn('git', e.message);
}

const core = OmniCore.open({ home, env: { OMNI_NO_KEYCHAIN: '1' } });
const day = 86_400_000;
const sample = [
  ['anthropic', 'claude-sonnet-5-5', 0.42],
  ['openai', 'gpt-6.1-sol', 0.21],
  ['deepseek', 'deepseek-flash', 0.04],
  ['groq', 'llama', 0.03],
];
for (let d = 0; d < 30; d++)
  for (const [p, m, c] of sample)
    if ((d * 7 + p.length) % 4)
      recordUsage(
        core.db,
        {
          provider: p,
          model: m,
          inputTokens: 52000 + d * 1300,
          outputTokens: 7000 + d * 90,
          costUsd: c * (1 + ((d * 3) % 7) / 4),
        },
        Date.now() - d * day,
      );
core.saveConfig({
  ...core.config,
  defaultModel: 'demo/demo-coder',
  providers: { demo: { params: {}, headers: {} } },
  customProviders: [
    {
      id: 'demo',
      name: 'Demo',
      adapter: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      baseUrlParams: [],
      auth: { type: 'none', optional: true },
      envVars: [],
      region: 'local',
      category: 'custom',
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
      fallbackModels: [],
      status: 'active',
      verifiedAt: null,
    },
  ],
  budgets: {
    anthropic: { monthly: 30, hardStop: false },
    openai: { monthly: 10, hardStop: false },
  },
});
core.close();

writeFileSync(
  join(home, 'desktop.json'),
  JSON.stringify({ theme: process.env.SHOT_THEME ?? 'light', codePlan: 'pro' }),
);

const require = createRequire(import.meta.url);
const { ELECTRON_RUN_AS_NODE: _asNode, ...env } = process.env;
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', proj],
  env: { ...env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.waitForTimeout(1500);
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
});
const cmd = (command) =>
  app.evaluate(
    ({ BrowserWindow }, command) =>
      BrowserWindow.getAllWindows()[0].webContents.send('omni:event', { type: 'command', command }),
    command,
  );
const shot = async (name, wait = 900) => {
  await win.waitForTimeout(wait);
  await win.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.warn('FAIL', name, e.message.split('\n')[0]);
  }
  await win.keyboard.press('Escape').catch(() => {});
  await win.waitForTimeout(300);
};
await win.waitForSelector('.tree-row');
await win.locator('.tree-row', { hasText: 'src' }).first().click();
await win.locator('.tree-row', { hasText: 'server.js' }).first().click();
await win.waitForTimeout(700);
const ask = async (text) => {
  await win.locator('.chat-input textarea').last().fill(text);
  await win.keyboard.press('Enter');
};
await step('agent', async () => {
  await ask('Agrega validación de email al usuario y corre las pruebas');
  for (let i = 0; i < 2; i++) {
    await win.waitForSelector('.tool-card.approval', { timeout: 20000 });
    await win.waitForTimeout(600);
    if (i === 0) await shot('approval', 100);
    await win.locator('.tool-actions button.primary').click();
  }
  await win.waitForSelector('text=las 3 pruebas pasan', { timeout: 20000 });
  await win.locator('.tree-row', { hasText: 'validate.js' }).first().click();
  await shot('agent');
});
await step('models', async () => {
  await cmd('ai.pickModel');
  await win.waitForSelector('.mp-card');
  await shot('models', 1500);
});
await step('usage', async () => {
  await cmd('ai.usage');
  await win.waitForSelector('.usage-table', { timeout: 8000 });
  await shot('usage');
  await win
    .locator('.modal-x')
    .first()
    .click()
    .catch(() => {});
});
const sidebars = [
  ['git', 'view.git'],
  ['security', 'security.center'],
  ['scanner', 'security.scanner'],
  ['design', 'view.design'],
  ['graphics', 'graphics.open'],
  ['cad', 'cad.open'],
  ['games', 'games.open'],
  ['mobile', 'mobile.open'],
  ['hardware', 'hardware.open'],
  ['docker', 'docker.open'],
  ['mail', 'view.mail'],
  ['vercel', 'view.vercel'],
  ['supabase', 'view.supabase'],
  ['watch', 'view.watch'],
  ['tests', 'tests.open'],
  ['browser', 'view.browser'],
  ['playground', 'view.playgroundCompare'],
  ['settings', 'app.settings'],
  ['providers', 'ai.providers'],
  ['palette', 'palette'],
];
for (const [name, id] of sidebars)
  await step(name, async () => {
    await cmd(id);
    await shot(name, 1600);
    await win
      .locator('.modal-x')
      .first()
      .click({ timeout: 800 })
      .catch(() => {});
  });
await step('studio3d', async () => {
  await cmd('app.studio3d');
  await shot('studio3d', 3000);
  await cmd('app.studio3d');
});
await step('video', async () => {
  await cmd('video.toggle');
  await shot('video', 2500);
  await cmd('video.toggle');
});
await step('split', async () => {
  await cmd('view.explorer');
  await win.locator('button[title^="Nuevo chat en paralelo"]').first().click();
  await win.waitForTimeout(400);
  await win.locator('button[title^="Ver dos chats a la par"]').first().click();
  await win.waitForTimeout(400);
  await ask('Agrega validación de email al usuario');
  await win.locator('.tool-card.approval').first().waitFor({ timeout: 20000 });
  await shot('split');
});
await app.close();
server.close();
console.log('ok');
