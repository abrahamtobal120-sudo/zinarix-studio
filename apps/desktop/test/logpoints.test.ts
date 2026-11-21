import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, describe, expect, it } from 'vitest';
import { DebugManager } from '../src/main/debug/manager.js';
import { logpointCondition, type DebugEvent } from '../src/shared/devtools.js';

describe('logpoints', () => {
  it('become a condition that prints and never stops', () => {
    const logs: string[] = [];
    const scope = { x: 5, items: [1, 2], console: { log: (s: string) => logs.push(s) } };
    expect(runInNewContext(logpointCondition('x = {x}, n {items.length * 10}, `ok` \\ ${open'), scope)).toBe(false);
    expect(logs).toEqual(['x = 5, n 20, `ok` \\ ${open']);
    // A bad expression prints its error instead of breaking the program.
    expect(runInNewContext(logpointCondition('{nope.x}'), scope)).toBe(false);
    expect(logs[1]).toMatch(/^<ReferenceError/);
    // With a condition: prints only when it holds.
    expect(runInNewContext(logpointCondition('big {x}', 'x > 10'), scope)).toBe(false);
    expect(logs).toHaveLength(2);
    expect(runInNewContext(logpointCondition('{x}{', 'x > 1'), scope)).toBe(false);
    expect(logs[2]).toBe('5{');
  });

  const root = mkdtempSync(join(tmpdir(), 'zinarix-logpoint-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('print in a real Node program without stopping it', { timeout: 60_000 }, async () => {
    writeFileSync(join(root, 'app.js'), 'let s = 0;\nfor (let i = 0; i < 3; i++) {\n  s += i;\n}\nconsole.log("fin", s);\n');
    const events: DebugEvent[] = [];
    let onIdle: () => void = () => undefined;
    const idle = new Promise<void>((r) => (onIdle = r));
    const dm = new DebugManager((e) => {
      events.push(e);
      if (e.kind === 'state' && e.state === 'idle') onIdle();
    });
    try {
      await dm.start(root, null, 'app.js', { 'app.js': [{ line: 3, logMessage: 'i={i} s={s}' }] });
      await idle;
    } finally {
      await dm.stop();
    }
    const out = events
      .filter((e): e is Extract<DebugEvent, { kind: 'output' }> => e.kind === 'output')
      .map((e) => e.text)
      .join('');
    expect(out).toContain('i=0 s=0');
    expect(out).toContain('i=2 s=1');
    expect(out).toContain('fin 3');
    expect(events.some((e) => e.kind === 'stopped')).toBe(false);
  });
});
