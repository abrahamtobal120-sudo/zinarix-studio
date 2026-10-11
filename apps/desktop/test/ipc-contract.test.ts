import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../src/shared/api.js';

/**
 * IPC lint: the renderer reaches the main process only through the whitelisted channels,
 * each one registered with handle() (Zod schema + app:// sender check) and exposed by the
 * preload. A new channel that skips any of this fails here, before review.
 */
const src = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8');
const main = src('main/main.ts');
const preload = src('preload/preload.ts');

describe('IPC contract', () => {
  it('every channel is handled once in main, through handle() with a Zod tuple', () => {
    for (const ch of CHANNELS) {
      const uses = main.match(new RegExp(`handle\\(\\s*'${ch}',\\s*z\\.tuple\\(`, 'g')) ?? [];
      expect(uses.length, ch).toBe(1);
    }
  });

  it('main registers no channel outside the whitelist', () => {
    const registered = [...main.matchAll(/(?<![.\w])handle\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(registered.filter((c) => !(CHANNELS as readonly string[]).includes(c!))).toEqual([]);
  });

  it('the only ipcMain listener is the checked wrapper', () => {
    const raw = main.match(/ipcMain\.(handle|handleOnce|on|once|addListener)\(/g) ?? [];
    expect(raw).toEqual(['ipcMain.handle(']);
    // The wrapper validates the sender and parses the arguments before calling the handler.
    const wrapper = main.slice(
      main.indexOf('ipcMain.handle('),
      main.indexOf('ipcMain.handle(') + 400,
    );
    expect(wrapper).toMatch(/senderFrame\?\.url\.startsWith\('app:\/\/'\)/);
    expect(wrapper).toMatch(/schema\.parse\(args\)/);
  });

  it('the preload exposes exactly the whitelisted channels and nothing raw', () => {
    const exposed = [...preload.matchAll(/call\('([^']+)'\)/g)].map((m) => m[1]).sort();
    expect(exposed).toEqual([...CHANNELS].sort());
    expect(preload).not.toMatch(/ipcRenderer\.(send|sendSync|postMessage)\(/);
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/);
    expect(preload.match(/exposeInMainWorld\(/g)).toHaveLength(1);
  });

  it('windows keep the Electron hardening flags', () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/webviewTag:\s*false/);
    expect(main).not.toMatch(/webSecurity:\s*false/);
    expect(main).not.toMatch(/allowRunningInsecureContent:\s*true/);
    expect(main).toMatch(/setWindowOpenHandler/);
    expect(main).toMatch(/will-navigate/);
    // DevTools only in development builds.
    expect(main).toMatch(/app\.isPackaged\s*\?\s*\[\]/);
  });

  it('the renderer keeps a strict CSP', () => {
    const html = src('renderer/index.html');
    const csp = /Content-Security-Policy"\s*content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'none'/);
    expect(csp).not.toMatch(/unsafe-eval/);
  });
});
