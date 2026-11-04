import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OmniCore } from '@omni/core';
import { Watcher, parseReview } from '../src/main/watch.js';
import { run } from '../src/main/git.js';
import { Workspace } from '../src/main/workspace.js';

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ANSWER =
  '{"summary":"ok","items":[{"kind":"fix","title":"Bug en a.ts","detail":"x","file":"a.ts:3"}]}';

function watcher(projects: Workspace[]) {
  const complete = vi.fn(async () => ({
    text: ANSWER,
    provider: 'p',
    model: 'm',
    usd: 0.001,
  }));
  const found = vi.fn();
  const w = new Watcher({
    home: tmp('zs-watch-home-'),
    core: { complete } as unknown as OmniCore,
    projects: () => projects,
    changed: () => undefined,
    found,
  });
  return { w, complete, found };
}

describe('Watcher', () => {
  it('parses the JSON answer, with fences or junk around it', () => {
    const r = parseReview('```json\n' + ANSWER + '\n```');
    expect(r.items).toEqual([{ kind: 'fix', title: 'Bug en a.ts', detail: 'x', file: 'a.ts:3' }]);
    expect(parseReview('no json here').items).toEqual([]);
  });

  it('spends tokens only after a change has settled, and not again until the next change', async () => {
    const dir = tmp('zs-watch-');
    await run('git', ['init', '-q'], dir);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    const { w, complete, found } = watcher([new Workspace(dir)]);
    w.configure({ everyMin: 15 });

    vi.useFakeTimers({ toFake: ['Date'] });
    await w.tick(); // first look: just remembers the project
    expect(complete).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 4 * 60_000); // settled
    await w.tick();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(found).toHaveBeenCalledTimes(1);
    expect(w.status().reports[0]!.items[0]!.title).toBe('Bug en a.ts');

    vi.setSystemTime(Date.now() + 60 * 60_000); // time passed, nothing changed: free
    await w.tick();
    expect(complete).toHaveBeenCalledTimes(1);

    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    await w.tick(); // changed just now: waits for it to settle
    expect(complete).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 4 * 60_000);
    await w.tick();
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('respects the daily limit and the off switch', async () => {
    const dir = tmp('zs-watch-');
    writeFileSync(join(dir, 'a.txt'), '1');
    const { w, complete } = watcher([new Workspace(dir)]);
    w.configure({ enabled: false });
    vi.useFakeTimers({ toFake: ['Date'] });
    await w.tick();
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await w.tick();
    expect(complete).not.toHaveBeenCalled();

    w.configure({ enabled: true, maxPerDay: 1 });
    await w.runNow(new Workspace(dir)); // the button counts too
    writeFileSync(join(dir, 'a.txt'), '2');
    await w.tick();
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await w.tick();
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
