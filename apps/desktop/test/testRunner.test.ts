import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  failureLine,
  namesPattern,
  parseJestJson,
  parseJunitXml,
  targetsOf,
  type TestRunRequest,
  type TestRunSummary,
} from '../src/shared/testing.js';
import {
  clearLastRun,
  coveredBy,
  discoverTests,
  dropCachedRun,
  loadLastRun,
  mergeRuns,
  setTestResultsDir,
  TestManager,
  testCommand,
} from '../src/main/testing.js';

describe('failureLine', () => {
  it('reads the first frame of the test file from a JS stack (absolute, file://, Windows)', () => {
    const msg = [
      'AssertionError: expected 3 to be 4',
      '    at C:/repo/src/util.ts:3:9',
      '    at C:/repo/src/a.test.ts:12:15',
      '    at C:/repo/src/a.test.ts:30:1',
    ].join('\n');
    expect(failureLine(msg, 'src/a.test.ts', 'C:\\repo')).toBe(12);
    expect(failureLine('at file:///C:/Repo/src/a.test.ts:7:3', 'src/a.test.ts', 'c:/repo')).toBe(7);
    expect(failureLine('at /home/u/p/a.test.ts:5:1', 'a.test.ts', '/home/u/p')).toBe(5);
    expect(failureLine('no frames here', 'a.test.ts', '/p')).toBeUndefined();
  });

  it('takes the last frame of the file in a pytest traceback, relative to its folder', () => {
    const tb = 'tests/test_a.py:4: in test_x\n    helper()\ntests/test_a.py:9: AssertionError';
    expect(failureLine(tb, 'py/tests/test_a.py', '/p', 'py')).toBe(9);
  });

  it('is filled in by the report readers', () => {
    const json = JSON.stringify({
      testResults: [
        {
          name: '/p/a.test.ts',
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: [],
              title: 'x',
              status: 'failed',
              failureMessages: ['Error: boom\n    at /p/a.test.ts:4:11'],
            },
          ],
        },
      ],
    });
    expect(parseJestJson(json, '/p')[0]).toMatchObject({ fullName: 'x', failLine: 4 });
    const xml =
      '<testsuite><testcase classname="test_a" name="test_x" file="test_a.py" line="1">' +
      '<failure message="assert 1 == 2">test_a.py:3: AssertionError</failure></testcase></testsuite>';
    expect(parseJunitXml(xml, '', '/p')[0]).toMatchObject({ status: 'failed', failLine: 3 });
  });
});

describe('several items and related runs', () => {
  const a = { file: 'src/a.test.ts', fullName: 'math adds', kind: 'test' as const };
  const b = { file: 'src/b.test.ts', fullName: 'io reads', kind: 'test' as const };

  it('one -t pattern runs any of the items', () => {
    const re = new RegExp(namesPattern([a, b]));
    expect(re.test('math adds')).toBe(true);
    expect(re.test('io reads')).toBe(true);
    expect(re.test('math adds twice')).toBe(false);
    expect(targetsOf({ framework: 'vitest', cwd: '', item: a, items: [b] })).toEqual([a, b]);
  });

  it('builds the commands (vitest related, jest --findRelatedTests, several pytest ids)', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const v = testCommand(root, { framework: 'vitest', cwd: '', related: ['src/math.ts'] }, 'r');
    expect(v.args.slice(1, 4)).toEqual(['related', 'src/math.ts', '--run']);
    const many = testCommand(root, { framework: 'vitest', cwd: '', items: [a, b] }, 'r');
    expect(many.args).toContain('src/a.test.ts');
    expect(many.args).toContain('src/b.test.ts');
    expect(many.args[many.args.indexOf('-t') + 1]).toBe(namesPattern([a, b]));
  });

  it('merging: items replace only their results; a related run replaces the files it ran', () => {
    const summary = (results: TestRunSummary['results']): TestRunSummary => ({
      framework: 'vitest',
      cwd: '',
      results,
      passed: 0,
      failed: 0,
      skipped: 0,
      finishedAt: 1,
      durationMs: 1,
    });
    const prev = summary([
      { file: a.file, fullName: 'math adds', status: 'failed' },
      { file: a.file, fullName: 'math subs', status: 'passed' },
      { file: b.file, fullName: 'io reads', status: 'failed' },
    ]);
    const req: TestRunRequest = { framework: 'vitest', cwd: '', items: [a] };
    expect(coveredBy(req, prev.results[0]!)).toBe(true);
    expect(coveredBy(req, prev.results[1]!)).toBe(false);
    const m = mergeRuns(
      prev,
      summary([{ file: a.file, fullName: 'math adds', status: 'passed' }]),
      req,
    );
    expect(m.passed).toBe(2);
    expect(m.failed).toBe(1);
    const rel = mergeRuns(
      prev,
      summary([{ file: b.file, fullName: 'io reads', status: 'passed' }]),
      { framework: 'vitest', cwd: '', related: ['src/io.ts'] },
    );
    expect(rel.results.filter((r) => r.file === b.file)).toEqual([
      expect.objectContaining({ status: 'passed' }),
    ]);
    expect(rel.results.filter((r) => r.file === a.file)).toHaveLength(2);
  });
});

// End to end with the real Vitest of this repo, in a throwaway project outside it.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MATH =
  'export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a + b; // bug\n';
const TEST = `import { describe, expect, it } from 'vitest';
import { add, sub } from './math';

describe('math', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3);
  });
  it('subs', () => {
    expect(sub(5, 2)).toBe(3);
  });
  it.each([1, 2])('doubles %s', (n) => {
    expect(add(n, n)).toBe(n * 2);
  });
});
`;

describe('Test Explorer runs (real Vitest)', () => {
  let root = '';
  let store = '';
  beforeAll(() => {
    // The real path (no /var link on macOS, no RUNNER~1 short name on Windows): Vitest
    // reports files by their real path and the results are matched by path.
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'zs-tests-')));
    store = mkdtempSync(join(tmpdir(), 'zs-results-'));
    symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'junction');
    writeFileSync(join(root, 'package.json'), '{"type":"module","devDependencies":{"vitest":"*"}}');
    writeFileSync(join(root, 'math.ts'), MATH);
    writeFileSync(join(root, 'math.test.ts'), TEST);
    setTestResultsDir(store);
  });
  afterAll(() => {
    // Remove the link itself first: never walk into the repo's node_modules.
    const link = join(root, 'node_modules');
    try {
      unlinkSync(link);
    } catch {
      rmdirSync(link);
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  });

  it(
    'finds where a test failed, reruns only the failed one, runs related tests and keeps results',
    { timeout: 180_000 },
    async () => {
      const d = await discoverTests(root, ['package.json', 'math.ts', 'math.test.ts']);
      expect(d.projects).toEqual([{ framework: 'vitest', cwd: '', files: ['math.test.ts'] }]);
      const tm = new TestManager(() => undefined);

      // 1. The whole project: one test fails, at the line of its assertion.
      const all = await tm.run(root, { framework: 'vitest', cwd: '' });
      expect(all.error).toBeUndefined();
      const subs = all.results.find((r) => r.fullName === 'math subs')!;
      expect(subs).toMatchObject({ status: 'failed', failLine: 9 });
      // The rows of it.each come back one by one.
      expect(
        all.results.filter((r) => r.fullName.startsWith('math doubles')).map((r) => r.fullName),
      ).toEqual(['math doubles 1', 'math doubles 2']);

      // 2. Fix the bug and rerun only the failed test: the others keep their result.
      writeFileSync(join(root, 'math.ts'), MATH.replace('a + b; // bug', 'a - b;'));
      const again = await tm.run(root, {
        framework: 'vitest',
        cwd: '',
        items: [{ file: 'math.test.ts', fullName: 'math subs', kind: 'test' }],
      });
      expect(again.results).toEqual([
        expect.objectContaining({ fullName: 'math subs', status: 'passed' }),
      ]);
      const merged = await loadLastRun(root);
      expect(merged).toMatchObject({ passed: 4, failed: 0 });

      // 3. Saving the source file runs the tests that import it.
      const rel = await tm.run(root, { framework: 'vitest', cwd: '', related: ['math.ts'] });
      expect(rel.error).toBeUndefined();
      expect(rel.passed).toBe(4);

      // 4. The results survive a restart (they are read back from disk).
      expect(readdirSync(store).some((f) => f.endsWith('.json'))).toBe(true);
      dropCachedRun(root);
      expect(await loadLastRun(root)).toMatchObject({ passed: 4, failed: 0 });
      await clearLastRun(root);
      expect(await loadLastRun(root)).toBeUndefined();
      expect(existsSync(join(store, readdirSync(store)[0] ?? 'none'))).toBe(false);
    },
  );
});
