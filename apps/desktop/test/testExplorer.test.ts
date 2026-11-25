import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DebugEvent } from '../src/shared/devtools.js';
import { parseTests } from '../src/shared/testing.js';
import { DebugManager } from '../src/main/debug/manager.js';
import { SourceMap, decodeMappings } from '../src/main/debug/sourceMap.js';
import { discoverTests, lastTestRun, TestManager, type TestEvent } from '../src/main/testing.js';

// Acceptance (Fase 7): this same repo, Vitest from the Test Explorer, and debugging a test with
// a breakpoint. The target is a real test of this repo (test/testing.test.ts).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TARGET = 'apps/desktop/test/testing.test.ts';
const TEXT = readFileSync(join(ROOT, TARGET), 'utf8');
const ITEM = parseTests(TARGET, TEXT).find(
  (i) => i.fullName === 'results relativeTo ignores drive letter case and slashes',
)!;
const BP_LINE =
  TEXT.split(/\r?\n/).findIndex((l) => l.includes("relativeTo('/repo', '/repo/a.ts')")) + 1;

describe('source maps', () => {
  it('decodes VLQ mappings and maps lines both ways', () => {
    // "AAAA;AACA" = gen 0:0 → src 0 line 0; gen 1:0 → src 0 line 1.
    expect(decodeMappings('AAAA;AACA').map((s) => [s.genLine, s.line])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    // A file URL of this system: "file:///C:/…" is not a Windows path on macOS or Linux.
    const win = process.platform === 'win32';
    const map = new SourceMap(
      { version: 3, sources: ['a.ts'], mappings: 'AAAA;;AACA;AACA' },
      win ? 'file:///C:/p/a.js' : 'file:///p/a.js',
    );
    expect(map.hasSource(win ? 'C:\\p\\a.ts' : '/p/a.ts')).toBe(true);
    expect(map.generatedFor(win ? 'C:/p/a.ts' : '/p/a.ts', 2)).toEqual({ line: 2, column: 0 });
    expect(map.originalFor(3, 5)).toMatchObject({ line: 3 });
  });
});

describe('Test Explorer on this repo', () => {
  it('finds the Vitest project and the tests of a file', async () => {
    const d = await discoverTests(ROOT, [TARGET, 'package.json', 'vitest.config.ts']);
    expect(d.projects).toEqual([{ framework: 'vitest', cwd: '', files: [TARGET] }]);
    expect(d.items.some((i) => i.id === ITEM.id)).toBe(true);
  });

  it('runs one test with Vitest and reads its result', { timeout: 120_000 }, async () => {
    const events: TestEvent[] = [];
    const tm = new TestManager((e) => events.push(e));
    const s = await tm.run(ROOT, { framework: 'vitest', cwd: '', item: ITEM });
    expect(s.error).toBeUndefined();
    expect(s.results).toEqual([
      expect.objectContaining({ file: TARGET, fullName: ITEM.fullName, status: 'passed' }),
    ]);
    expect(lastTestRun(ROOT)?.passed).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.kind === 'output')).toBe(true);
    expect(events.at(-1)).toEqual({ kind: 'state', running: false });
  });

  it(
    'debugs that test and stops at a breakpoint on the .ts line',
    { timeout: 120_000 },
    async () => {
      expect(BP_LINE).toBeGreaterThan(0);
      const events: DebugEvent[] = [];
      let onStop: (e: Extract<DebugEvent, { kind: 'stopped' }>) => void = () => undefined;
      let onIdle: () => void = () => undefined;
      const dm = new DebugManager((e) => {
        events.push(e);
        if (e.kind === 'stopped') onStop(e);
        if (e.kind === 'state' && e.state === 'idle') onIdle();
      });
      const stopped = new Promise<Extract<DebugEvent, { kind: 'stopped' }>>((r) => (onStop = r));
      const idle = new Promise<void>((r) => (onIdle = r));
      try {
        await dm.startTest(
          ROOT,
          { framework: 'vitest', cwd: '', item: ITEM },
          {
            [TARGET]: [{ line: BP_LINE }],
          },
        );
        const stop = await stopped;
        const top = stop.frames[0]!;
        expect(stop.reason).toBe('breakpoint');
        expect(top.path).toBe(TARGET);
        expect(top.line).toBe(BP_LINE);
        // The paused test can be inspected.
        const v = await dm.evaluate('[1, 2].length + 40', top.id);
        expect(v.value).toBe('42');
        await dm.resume();
        await idle;
      } finally {
        await dm.stop();
      }
    },
  );
});
