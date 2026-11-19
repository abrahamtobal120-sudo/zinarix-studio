import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
const { PhoneRemote } = await import('../src/main/phone.js');
const req = createRequire(import.meta.url);
const { chromium } = req('../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright');

it('phone page works', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zx-page-'));
  const actions: unknown[] = [];
  const r = new PhoneRemote(
    (a) => actions.push(a),
    () => undefined,
    { list: async () => [], pull: async () => '', open: async () => undefined },
    async () => true,
    () => join(dir, 'g.json'),
    {
      list: async () => ({ models: [], defaultModel: null, roles: {}, errors: [] }),
      setDefault: () => undefined,
    },
    { file: () => join(dir, 'p.json') },
  );
  const st = await r.start();
  const snap = {
    chats: [
      { id: 'c1', title: 'Arreglar login', busy: false, waiting: false },
      { id: 'c2', title: 'Otro chat', busy: false, waiting: true },
    ],
    chatId: 'c1',
    agent: true,
    mode: 'agent' as const,
    busy: false,
    turns: [
      { role: 'user' as const, text: 'Hola', tools: [] },
      {
        role: 'assistant' as const,
        text: '## Plan\n- uno **dos**\n- tres `x`\n```js\nconst a=1\n```\nfin',
        model: 'openai/gpt',
        tools: [
          { id: 't1', title: 'edit a.ts', status: 'approval' as const },
          { id: 't2', title: 'run npm test', status: 'approval' as const },
        ],
      },
    ],
    windows: [{ id: 1, name: 'proj', current: true }],
    todayUsd: 0.12,
  };
  r.push(snap);
  const browser = await chromium.launch({ executablePath: 'C:/Users/abrah/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('console', (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(st.url!);
  await page.fill('#pin', st.pin!);
  await page.waitForSelector('#log .turn');
  await page.screenshot({ path: join(tmpdir(), 'zx-phone-1.png') });
  expect(await page.textContent('#pn')).toContain('2');
  await page.click('#pyes');
  await page.click('.ubox .tacts button:nth-child(2)'); // resend
  await page.click('#gear');
  await page.waitForSelector('#mbody .seg');
  await page.click('#mbody .seg button:nth-child(3)');
  await page.screenshot({ path: join(tmpdir(), 'zx-phone-2.png') });
  await page.click('#mclose');
  await page.fill('#text', 'Mi atajo');
  await page.click('#bolt');
  await page.click('#mbody button.primary');
  expect(await page.locator('#mbody .ptext').first().textContent()).toBe('Mi atajo');
  await page.click('#mclose');
  await page.click('#menu');
  await page.fill('#csearch', 'otro');
  expect(await page.locator('#list .item').count()).toBe(1);
  // Restart of the computer side: the page reconnects by itself.
  r.stop();
  await page.waitForSelector('#offline:not(.hide)', { timeout: 10_000 });
  const r2 = new PhoneRemote(
    (a) => actions.push(a),
    () => undefined,
    { list: async () => [], pull: async () => '', open: async () => undefined },
    async () => true,
    () => join(dir, 'g.json'),
    undefined,
    { file: () => join(dir, 'p.json') },
  );
  await r2.start();
  r2.push({ ...snap, turns: [{ role: 'user' as const, text: 'Después del reinicio', tools: [] }] });
  await page.waitForSelector('text=Después del reinicio', { timeout: 15_000 });
  expect(await page.isVisible('#pair')).toBe(false);
  await page.screenshot({ path: join(tmpdir(), 'zx-phone-3.png') });
  await browser.close();
  r2.stop();
  console.log(JSON.stringify(actions));
  expect(errors).toEqual([]);
});
