// End-to-end check of the owner's remote switch (app-config.json), plans, notices and new
// versions, against a local copy of the control file:
//  1. charging off: no plan badge, nothing limited, the first-run guide appears;
//  2. the owner turns charging on (trialDays 0) and sends a notice and a version: the running
//     app picks it up, shows the notice and the version, and limits chats to the free plan;
//  3. handing work to another AI still opens a chat on the free plan (agents are never limited);
//  4. the owner word "tobal" unlocks everything and survives a restart.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
let config = { billing: false };
const server = createServer((req, res) => {
  if (req.url === '/app-config.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(config));
  }
  if (req.url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'rapido' }, { id: 'otro' }] }));
  }
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ choices: [{ delta: { content: 'Respuesta rápida ✅' } }] });
    send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const configUrl = `${base}/app-config.json`;

const home = mkdtempSync(join(tmpdir(), 'zs-plan-'));
const proj = join(mkdtempSync(join(tmpdir(), 'zs-ws-')), 'proyecto');
mkdirSync(proj);
writeFileSync(join(proj, 'README.md'), '# Proyecto de prueba\n');

const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) process.exitCode = 1;
};
const launch = () =>
  electron.launch({
    executablePath: 'node_modules/electron/dist/electron',
    args: ['.', proj],
    env: {
      ...process.env,
      OMNI_HOME: home,
      OMNI_NO_KEYCHAIN: '1',
      ZINARIX_CONFIG_URL: configUrl,
      ZINARIX_NO_INTRO: '',
    },
  });

let app = await launch();
let win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.tree-row');

// 1. charging off
await win.waitForSelector('.onboarding', { timeout: 10000 });
ok(true, 'la guía de inicio aparece la primera vez');
await win.screenshot({ path: join(out, 'onboarding-1.png') });
await win.locator('.onb-nav .primary').click();
await win.locator('.onb-nav .primary').click();
await win.waitForTimeout(300);
ok(
  /gratis|free/i.test(await win.locator('.onboarding').textContent()),
  'la guía dice que todo es gratis',
);
await win.screenshot({ path: join(out, 'onboarding-3.png') });
await win.locator('.onb-nav button:not(.primary)').first().click(); // back
await win.locator('.onb-nav button:not(.primary)').first().click(); // back
await win.locator('.onb-nav .link').click(); // skip
ok((await win.locator('.onboarding').count()) === 0, 'la guía se puede saltar');
let st = await win.evaluate(() => window.omni.license.status());
ok(st.plan === 'open' && st.features.maxChats > 10, 'sin cobro: todo abierto');
ok((await win.locator('.plan-badge').count()) === 0, 'sin cobro no se ve ningún plan');
// (the built-in shortcuts are menu accelerators, which synthetic keys do not reach)
const plus = () => win.locator('.chat-tabs-bar button[title*="Ctrl+Alt+N"]').click();
for (let i = 0; i < 3; i++) await plus();
await win.waitForTimeout(300);
ok(
  (await win.locator('.chat-tab').count()) === 4 &&
    (await win.locator('.plan-panel.upgrade').count()) === 0,
  'sin cobro se abren chats sin límite',
);

// 2. the owner switches charging on, sends a notice and announces a version
config = {
  billing: true,
  trialDays: 0,
  free: { maxChats: 2, split: false, windows: false },
  notice: { id: 'aviso-1', text: 'Aviso de prueba para todos', url: 'https://example.com' },
  latestVersion: '9.9.9',
};
await app.close();
// …and this person connects an AI
writeFileSync(
  join(home, 'config.json'),
  JSON.stringify({
    defaultModel: 'mock/rapido',
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

app = await launch();
win = await app.firstWindow();
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.tree-row');
await win.waitForSelector('.notice-banner', { timeout: 15000 });
ok(
  (await win.locator('.notice-banner').textContent()).includes('Aviso de prueba'),
  'el aviso llega a la app instalada',
);
await win.waitForSelector('.update-banner', { timeout: 15000 });
ok(
  (await win.locator('.update-banner').textContent()).includes('9.9.9'),
  'la app avisa de la versión nueva',
);
await win.waitForSelector('.plan-badge', { timeout: 15000 });
st = await win.evaluate(() => window.omni.license.status());
ok(
  st.plan === 'free' && st.billing,
  'con cobro encendido y la prueba terminada queda en el plan gratis',
);
await win.screenshot({ path: join(out, 'billing-on.png') });

const chats = () => win.locator('.chat-tab').count();
ok((await chats()) > 2, 'los chats que ya estaban abiertos se conservan');
await plus();
await win.waitForSelector('.plan-panel.upgrade', { timeout: 5000 });
ok(true, 'un chat más allá del plan gratis ofrece Pro');
await win.screenshot({ path: join(out, 'upgrade.png') });
await win.locator('.plan-panel.upgrade .link').click();

// 3. agents are never limited: hand the conversation to another AI
const before = await chats();
await win.locator('.chat-session:visible .chat-input textarea').fill('hola');
await win.keyboard.press('Enter');
await win.waitForSelector('.chat-session:visible >> text=Respuesta rápida ✅', { timeout: 15000 });
await win
  .locator('.chat-session:visible button')
  .filter({ hasText: /Pasar a otra IA|Hand off to another AI/ })
  .first()
  .click();
await win.locator('.mp-search').fill('otro');
await win.locator('.mp-row:not(.mp-header)').filter({ hasText: 'otro' }).first().dblclick();
await win.waitForTimeout(400);
ok(
  (await chats()) === before + 1,
  'pasar el trabajo a otra IA abre un chat aunque el plan gratis esté lleno',
);
ok(
  (await win.locator('.plan-panel.upgrade').count()) === 0,
  'pasar trabajo a otra IA nunca pide Pro',
);
await win.screenshot({ path: join(out, 'handoff-free.png') });

// 4. the owner word
await win.locator('.plan-badge').click();
await win.locator('#plan-key').fill('Tobal');
await win.locator('.plan-activate .primary').click();
await win.waitForTimeout(500);
st = await win.evaluate(() => window.omni.license.status());
ok(st.plan === 'owner', 'la palabra "tobal" activa todo');
await win.screenshot({ path: join(out, 'owner.png') });
await app.close();

app = await launch();
win = await app.firstWindow();
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.tree-row');
st = await win.evaluate(() => window.omni.license.status());
ok(st.plan === 'owner', 'sigue como dueño después de reiniciar');
console.log('errors:', errors.length ? errors : 'none');
await app.close();
server.close();
