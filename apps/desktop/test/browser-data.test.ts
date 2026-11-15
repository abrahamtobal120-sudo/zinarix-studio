import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserData, HISTORY_MAX } from '../src/main/browserData.js';
import { browserUserAgent } from '../src/main/browser.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zx-bdata-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('browser history', () => {
  it('keeps the latest visit of each address, newest first, and survives a restart', () => {
    const d = BrowserData.inDir(dir);
    d.visit('https://a.com/', 'A', 1);
    d.visit('https://b.com/', 'B', 2);
    d.visit('https://a.com/', '', 3);
    d.visit('about:blank', 'x', 4);
    expect(d.history().map((e) => [e.url, e.title, e.visits])).toEqual([
      ['https://a.com/', 'A', 2],
      ['https://b.com/', 'B', 1],
    ]);
    d.flush();
    expect(JSON.parse(readFileSync(join(dir, 'browser-data.json'), 'utf8')).history).toHaveLength(2);
    expect(BrowserData.inDir(dir).history()).toHaveLength(2);
  });

  it('searches, forgets one, clears all and is capped', () => {
    const d = BrowserData.inDir(dir);
    for (let i = 0; i < HISTORY_MAX + 10; i++) d.visit(`https://s${i}.com/`, `Site ${i}`, i);
    expect(d.history('', 10000)).toHaveLength(HISTORY_MAX);
    expect(d.history('site 5009').map((e) => e.url)).toEqual(['https://s5009.com/']);
    d.forget('https://s5009.com/');
    expect(d.history('site 5009')).toHaveLength(0);
    d.clearHistory();
    expect(d.history()).toHaveLength(0);
  });

  it('suggests addresses that start with what was typed first, bookmarks marked', () => {
    const d = BrowserData.inDir(dir);
    d.visit('https://docs.github.com/x', 'Docs', 1);
    d.visit('https://github.com/', 'GitHub', 2);
    d.toggleBookmark('https://github.com/', 'GitHub');
    const s = d.suggest('git');
    expect(s[0]).toMatchObject({ url: 'https://github.com/', bookmark: true });
    expect(s.map((e) => e.url)).toContain('https://docs.github.com/x');
  });

  it('toggles bookmarks', () => {
    const d = BrowserData.inDir(dir);
    expect(d.toggleBookmark('https://x.com/', 'X')).toBe(true);
    expect(d.isBookmarked('https://x.com/')).toBe(true);
    expect(d.toggleBookmark('https://x.com/', 'X')).toBe(false);
    expect(d.bookmarks()).toHaveLength(0);
  });
});

describe('browser user agent', () => {
  it('drops the Electron and app tokens, keeps the Chrome ones', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ZinarixStudio/0.6.1 Chrome/140.0.0.0 Electron/44.11.3 Safari/537.36';
    expect(browserUserAgent(ua)).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    );
  });
});
