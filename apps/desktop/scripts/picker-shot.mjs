// Screenshots the model picker with one mock provider connected (visual check).
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const out = process.argv[2] ?? tmpdir();
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      data: [
        { id: 'llama-local-8b', context_length: 131072 },
        { id: 'qwen-coder-32b', context_length: 32768 },
      ],
    }),
  );
}).listen(0);
await new Promise((r) => server.once('listening', r));
const home = mkdtempSync(join(tmpdir(), 'zs-picker-'));
mkdirSync(join(home, 'p'));
writeFileSync(
  join(home, 'config.json'),
  JSON.stringify({
    defaultModel: 'mi-servidor/qwen-coder-32b',
    providers: { 'mi-servidor': {} },
    customProviders: [
      {
        id: 'mi-servidor',
        name: 'Mi servidor (local)',
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
  args: ['.', join(home, 'p')],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForTimeout(1500);
await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].webContents.send('omni:event', {
    type: 'command',
    command: 'ai.pickModel',
  }),
);
await win.waitForSelector('.mp-row:not(.mp-header)');
await win.waitForTimeout(1200);
await win.screenshot({ path: join(out, 'picker-1.png') });
await win.locator('.mp-search').fill('claude');
await win.waitForTimeout(300);
await win.screenshot({ path: join(out, 'picker-2.png') });
const n = await win.locator('.mp-row:not(.mp-header)').count();
console.log('rows for "claude":', n, 'errors:', errors.length ? errors : 'none');
await app.close();
server.close();
