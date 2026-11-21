import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GodotService } from '../src/main/godot.js';
import { WebGameServers } from '../src/main/webGame.js';
import { gameTemplateFiles, isGameTemplate } from '../src/shared/games.js';

const root = mkdtempSync(join(tmpdir(), 'zinarix-phaser-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// The app's own Electron (Chromium) runs the game, driven by Playwright.
const appDir = join(fileURLToPath(new URL('..', import.meta.url)));
const req = createRequire(join(appDir, 'package.json'));
const electronExe = (() => {
  try {
    return req('electron') as unknown as string;
  } catch {
    return null;
  }
})();

describe('Phaser web game template', () => {
  it('is a known template and copies Phaser for offline use', async () => {
    expect(isGameTemplate('web-phaser')).toBe(true);
    const files = gameTemplateFiles('web-phaser', 'Saltos <b>');
    expect(files['index.html']).toContain('<title>Saltos &lt;b&gt;</title>');
    expect(files['index.html']).toContain('src="lib/phaser.min.js"');
    const g = new GodotService(mkdtempSync(join(root, 'data-')));
    const written = await g.create(root, 'saltos', 'web-phaser', 'Saltos');
    expect(written).toContain('saltos/lib/phaser.min.js');
    expect(readFileSync(join(root, 'saltos/lib/phaser.min.js'), 'utf8').length).toBeGreaterThan(1_000_000);
  });

  it.skipIf(!electronExe)('runs in a real browser: no errors, the player walks, jumps and picks a coin', { timeout: 90_000 }, async () => {
    const { _electron } = req('playwright') as typeof import('playwright');
    const web = new WebGameServers();
    const url = await web.url(root, 'saltos/');
    const main = join(root, 'open-game.cjs');
    writeFileSync(
      main,
      "const { app, BrowserWindow } = require('electron');\n" +
        'app.whenReady().then(() => new BrowserWindow({ width: 1000, height: 640 }).loadURL(process.argv.at(-1)));\n',
    );
    const app = await _electron.launch({ executablePath: electronExe!, args: [main, url] });
    try {
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.waitForFunction(() => {
        const j = (window as unknown as { juego?: { scene?: { isActive(k: string): boolean } } }).juego;
        return !!j?.scene?.isActive('nivel');
      });
      type Body = { x: number; y: number };
      const state = () =>
        page.evaluate(() => {
          const s = (window as unknown as { juego: { scene: { getScene(k: string): unknown } } }).juego.scene.getScene('nivel') as {
            jugador: Body;
            puntos: number;
          };
          return { x: s.jugador.x, y: s.jugador.y, puntos: s.puntos };
        });
      await page.waitForTimeout(800); // lands on the ground
      const start = await state();
      await page.locator('canvas').click();
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(600);
      await page.keyboard.up('ArrowRight');
      const walked = await state();
      expect(walked.x - start.x).toBeGreaterThan(80);
      await page.keyboard.down('Space');
      await page.waitForTimeout(250);
      const jumped = await state();
      await page.keyboard.up('Space');
      expect(jumped.y).toBeLessThan(walked.y - 30);
      // Walk to the coin on the ground (x 520) and pick it.
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(1200);
      await page.keyboard.up('ArrowRight');
      await page.waitForTimeout(300);
      expect((await state()).puntos).toBeGreaterThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      web.stop();
    }
  });
});
