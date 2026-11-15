import { describe, expect, it } from 'vitest';
import {
  failuresText,
  isJsTestFile,
  isPyTestFile,
  namePattern,
  parseJestJson,
  parseJsTests,
  parseJunitXml,
  parsePyTests,
  pytestNodeId,
  relativeTo,
  statusByItem,
  summarize,
} from '../src/shared/testing.js';

const JS = `import { describe, it, expect } from 'vitest';
// it('commented out', () => {});
const s = "it('inside a string')";
describe('math', () => {
  it('adds', () => {
    expect(1 + 1).toBe(2);
  });
  describe.skip("nested { braces }", () => {
    test('works', () => {
      const o = { a: { b: 1 } };
    });
  });
  it.each([1, 2])('doubles %s', (n) => {});
});
test.only('top level', async () => {});
`;

describe('parseJsTests', () => {
  const items = parseJsTests('src/a.test.ts', JS);

  it('finds tests and suites with their nesting and lines', () => {
    expect(items.map((i) => [i.kind, i.fullName, i.line])).toEqual([
      ['suite', 'math', 4],
      ['test', 'math adds', 5],
      ['suite', 'math nested { braces }', 8],
      ['test', 'math nested { braces } works', 9],
      ['test', 'math doubles %s', 13],
      ['test', 'top level', 15],
    ]);
  });

  it('ignores calls in comments and strings', () => {
    expect(items.some((i) => i.name.includes('commented') || i.name.includes('inside'))).toBe(
      false,
    );
  });

  it('marks templated names as dynamic', () => {
    expect(items.find((i) => i.name === 'doubles %s')?.dynamic).toBe(true);
    expect(items.find((i) => i.name === 'adds')?.dynamic).toBeUndefined();
  });
});

describe('parsePyTests', () => {
  const PY = [
    'import pytest',
    '',
    'def test_one():',
    '    def test_inner():',
    '        pass',
    '',
    'class TestMath:',
    '    def test_add(self):',
    '        pass',
    '    def helper(self):',
    '        def test_nested(): pass',
    '',
    'class Helper:',
    '    def test_not_collected(self):',
    '        pass',
    '',
    'async def test_async():',
    '    pass',
  ].join('\n');

  it('finds module tests, Test classes and their methods only', () => {
    expect(parsePyTests('tests/test_m.py', PY).map((i) => [i.kind, i.fullName, i.line])).toEqual([
      ['test', 'test_one', 3],
      ['suite', 'TestMath', 7],
      ['test', 'TestMath::test_add', 8],
      ['test', 'test_async', 17],
    ]);
  });
});

describe('file patterns', () => {
  it('recognises test files', () => {
    expect(isJsTestFile('a/b.test.ts')).toBe(true);
    expect(isJsTestFile('a/b.spec.mjs')).toBe(true);
    expect(isJsTestFile('a/__tests__/b.tsx')).toBe(true);
    expect(isJsTestFile('a/b.ts')).toBe(false);
    expect(isPyTestFile('tests/test_x.py')).toBe(true);
    expect(isPyTestFile('x_test.py')).toBe(true);
    expect(isPyTestFile('testing.py')).toBe(false);
  });
});

describe('namePattern', () => {
  it('anchors a test so it does not run others with the same prefix', () => {
    const p = new RegExp(namePattern({ fullName: 'math adds (x)', kind: 'test' }));
    expect(p.test('math adds (x)')).toBe(true);
    expect(p.test('math adds (x) twice')).toBe(false);
  });

  it('a suite runs everything inside it', () => {
    const p = new RegExp(namePattern({ fullName: 'math', kind: 'suite' }));
    expect(p.test('math adds')).toBe(true);
    expect(p.test('mathematics adds')).toBe(false);
  });

  it('templated names match every row', () => {
    const p = new RegExp(namePattern({ fullName: 'math doubles %s', kind: 'test', dynamic: true }));
    expect(p.test('math doubles 1')).toBe(true);
    expect(p.test('math doubles 2')).toBe(true);
  });
});

describe('results', () => {
  const root = 'C:\\repo';
  const json = JSON.stringify({
    testResults: [
      {
        name: 'C:\\repo\\src\\a.test.ts',
        status: 'failed',
        message: '',
        assertionResults: [
          {
            ancestorTitles: ['math'],
            title: 'adds',
            fullName: 'math adds',
            status: 'passed',
            duration: 3.4,
          },
          {
            ancestorTitles: ['math'],
            title: 'doubles 2',
            fullName: 'math doubles 2',
            status: 'failed',
            failureMessages: ['\u001b[31mAssertionError: expected 3 to be 4\u001b[39m'],
            location: { line: 13, column: 3 },
          },
          {
            ancestorTitles: ['math'],
            title: 'doubles 1',
            fullName: 'math doubles 1',
            status: 'passed',
          },
          { ancestorTitles: [], title: 'top level', fullName: 'top level', status: 'skipped' },
        ],
      },
      {
        name: 'c:/repo/src/broken.test.ts',
        status: 'failed',
        message: 'SyntaxError: x',
        assertionResults: [],
      },
    ],
  });

  it('reads the Vitest / Jest JSON report', () => {
    const r = parseJestJson(json, root);
    expect(r).toHaveLength(5);
    expect(r[1]).toMatchObject({
      file: 'src/a.test.ts',
      fullName: 'math doubles 2',
      status: 'failed',
      message: 'AssertionError: expected 3 to be 4',
      line: 13,
    });
    expect(r[4]).toMatchObject({ file: 'src/broken.test.ts', fullName: '', status: 'failed' });
    const s = summarize('vitest', '', r, 10);
    expect([s.passed, s.failed, s.skipped]).toEqual([2, 2, 1]);
    expect(failuresText(s)).toContain('✗ math doubles 2 — src/a.test.ts:13');
  });

  it('maps results to the items found in the file (rows of .each, suites)', () => {
    const items = parseJsTests('src/a.test.ts', JS);
    const st = statusByItem(items, parseJestJson(json, root));
    expect(st.get('src/a.test.ts::math adds')).toBe('passed');
    expect(st.get('src/a.test.ts::math doubles %s')).toBe('failed');
    expect(st.get('src/a.test.ts::math')).toBe('failed');
    expect(st.get('src/a.test.ts::top level')).toBe('skipped');
  });

  it('reads pytest JUnit XML (xunit1), with parameters and a cwd', () => {
    const xml = `<?xml version="1.0"?><testsuites><testsuite>
      <testcase classname="tests.test_m.TestMath" name="test_add" file="tests/test_m.py" line="7" time="0.002"/>
      <testcase classname="tests.test_m" name="test_one[1]" file="tests/test_m.py" line="2" time="0.1"><failure message="assert 1 == 2">def test_one():
&gt;   assert 1 == 2</failure></testcase>
      <testcase classname="tests.test_m" name="test_one[2]" file="tests/test_m.py" line="2" time="0.1"/>
      <testcase classname="tests.test_m" name="test_skip" file="tests/test_m.py" line="9"><skipped message="no"/></testcase>
    </testsuite></testsuites>`;
    const r = parseJunitXml(xml, 'py');
    expect(r.map((x) => [x.file, x.fullName, x.status, x.line])).toEqual([
      ['py/tests/test_m.py', 'TestMath::test_add', 'passed', 8],
      ['py/tests/test_m.py', 'test_one[1]', 'failed', 3],
      ['py/tests/test_m.py', 'test_one[2]', 'passed', 3],
      ['py/tests/test_m.py', 'test_skip', 'skipped', 10],
    ]);
    expect(r[1]!.message).toContain('>   assert 1 == 2');
    const items = parsePyTests(
      'py/tests/test_m.py',
      'def test_one():\n    pass\nclass TestMath:\n    def test_add(self): pass\n',
    );
    const st = statusByItem(items, r);
    expect(st.get('py/tests/test_m.py::test_one')).toBe('failed');
    expect(st.get('py/tests/test_m.py::TestMath')).toBe('passed');
  });

  it('builds pytest node ids relative to its folder', () => {
    expect(pytestNodeId('py/tests/test_m.py', 'TestMath::test_add', 'py')).toBe(
      'tests/test_m.py::TestMath::test_add',
    );
    expect(pytestNodeId('tests/test_m.py', '')).toBe('tests/test_m.py');
  });

  it('relativeTo ignores drive letter case and slashes', () => {
    expect(relativeTo('C:\\Repo', 'c:/repo/a/b.ts')).toBe('a/b.ts');
    expect(relativeTo('/repo', '/repo/a.ts')).toBe('a.ts');
    expect(relativeTo('/repo', '/other/a.ts')).toBe('/other/a.ts');
  });
});
