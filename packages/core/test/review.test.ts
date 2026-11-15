import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  anchor,
  annotateFile,
  batchFiles,
  commentableLines,
  extractJson,
  githubReview,
  mergeFindings,
  parseFindings,
  parseUnifiedDiff,
  parseVerdict,
  reviewDiff,
  reviewable,
} from '@omni/core';
import type { ReviewComplete, ReviewFinding } from '@omni/core';

const PATCH = [
  'diff --git a/src/sum.ts b/src/sum.ts',
  'index 1111111..2222222 100644',
  '--- a/src/sum.ts',
  '+++ b/src/sum.ts',
  '@@ -1,5 +1,6 @@',
  ' export function sum(xs: number[]): number {',
  '   let t = 0;',
  '-  for (let i = 0; i < xs.length; i++) t += xs[i];',
  '+  for (let i = 0; i <= xs.length; i++) t += xs[i]!;',
  '+  // total',
  '   return t;',
  ' }',
  '',
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1,2 @@',
  '+hola',
  '+mundo',
  'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml',
  '--- a/pnpm-lock.yaml',
  '+++ b/pnpm-lock.yaml',
  '@@ -3 +3 @@',
  '-a: 1',
  '+a: 2',
  '',
].join('\r\n');

describe('parseUnifiedDiff', () => {
  it('reads files, statuses and new line numbers (CRLF too)', () => {
    const files = parseUnifiedDiff(PATCH);
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/sum.ts', 'modified'],
      ['new.txt', 'added'],
      ['pnpm-lock.yaml', 'modified'],
    ]);
    const sum = files[0]!;
    const added = sum.hunks[0]!.lines.filter((l) => l.kind === '+');
    expect(added.map((l) => l.newLine)).toEqual([3, 4]);
    expect([...commentableLines(sum)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(files[1]!.hunks[0]!.lines.map((l) => l.newLine)).toEqual([1, 2]);
    // The lockfile is not shown to the models.
    expect(files.filter(reviewable).map((f) => f.path)).toEqual(['src/sum.ts', 'new.txt']);
  });

  it('handles renames and binary files', () => {
    const files = parseUnifiedDiff(
      [
        'diff --git a/old.ts b/lib/new.ts',
        'similarity index 90%',
        'rename from old.ts',
        'rename to lib/new.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        'diff --git a/logo.png b/logo.png',
        'Binary files a/logo.png and b/logo.png differ',
      ].join('\n'),
    );
    expect(files[0]).toMatchObject({ path: 'lib/new.ts', oldPath: 'old.ts', status: 'renamed' });
    expect(files[1]).toMatchObject({ path: 'logo.png', binary: true });
  });

  it('annotates every line with its new-file number', () => {
    const text = annotateFile(parseUnifiedDiff(PATCH)[0]!);
    expect(text).toContain('    3 +   for (let i = 0; i <= xs.length; i++) t += xs[i]!;');
    expect(text).toContain('    - -   for (let i = 0; i < xs.length; i++) t += xs[i];');
    expect(batchFiles(parseUnifiedDiff(PATCH), 200).length).toBeGreaterThan(1);
  });
});

describe('model output', () => {
  it('extracts JSON from fences or prose', () => {
    expect(extractJson('Aquí:\n```json\n{"findings":[]}\n```')).toEqual({ findings: [] });
    expect(extractJson('blah {"a":1} blah')).toEqual({ a: 1 });
    expect(extractJson('nada')).toBeUndefined();
  });

  it('parses and normalizes findings, skipping broken ones', () => {
    const f = parseFindings(
      JSON.stringify({
        findings: [
          { file: 'src/sum.ts', line: 3, severity: 'Alto', category: 'bug', title: 'off-by-one' },
          { file: 'x', line: 'no', title: 't' },
          { file: 'x', line: 2 },
        ],
      }),
    );
    expect(f).toEqual([
      expect.objectContaining({
        file: 'src/sum.ts',
        line: 3,
        severity: 'high',
        title: 'off-by-one',
      }),
    ]);
  });

  it('parses verdicts', () => {
    expect(parseVerdict('{"verdict":"false positive","reason":"guarded"}').verdict).toBe(
      'false_positive',
    );
    expect(parseVerdict('{"verdict":"real","line":4}')).toMatchObject({ verdict: 'real', line: 4 });
    expect(parseVerdict('???').verdict).toBe('unsure');
  });
});

describe('anchoring and merging', () => {
  const files = parseUnifiedDiff(PATCH);
  const raw = (file: string, line: number) => ({
    file,
    line,
    severity: 'high' as const,
    category: 'bug' as const,
    title: 't',
    detail: '',
  });

  it('keeps diff lines, snaps near misses and drops the rest', () => {
    expect(anchor(files, raw('src/sum.ts', 3))).toEqual({ file: 'src/sum.ts', line: 3 });
    expect(anchor(files, raw('./src/sum.ts', 8))).toEqual({ file: 'src/sum.ts', line: 6 });
    expect(anchor(files, raw('sum.ts', 3))).toEqual({ file: 'src/sum.ts', line: 3 });
    expect(anchor(files, raw('src/sum.ts', 40))).toBeUndefined();
    expect(anchor(files, raw('other.ts', 3))).toBeUndefined();
  });

  it('merges the same finding from two models', () => {
    const base: ReviewFinding = {
      id: 'a',
      file: 'f.ts',
      line: 3,
      severity: 'medium',
      category: 'bug',
      title: 'Loop goes past the end',
      detail: 'short',
      models: ['m1'],
      source: 'ai',
      verdict: 'plausible',
    };
    const out = mergeFindings([
      base,
      { ...base, id: 'b', line: 4, severity: 'high', detail: 'longer detail', models: ['m2'] },
      { ...base, id: 'c', line: 30, models: ['m2'] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      severity: 'high',
      models: ['m1', 'm2'],
      detail: 'longer detail',
    });
  });
});

/** A fake model: the reviewer reports what `pick` finds in the annotated diff it receives. */
function fakeModels(
  pick: (diff: string, model: string) => object[],
  verdict: (finding: string) => object = () => ({ verdict: 'real', reason: 'ok' }),
): { complete: ReviewComplete; calls: string[] } {
  const calls: string[] = [];
  const complete: ReviewComplete = async (model, messages) => {
    const m = model ?? 'default';
    const user = messages.at(-1)!.content;
    if (messages[0]!.content.startsWith('You verify')) {
      calls.push(`verify:${m}`);
      return { text: JSON.stringify(verdict(user)), model: m, usd: 0.001 };
    }
    calls.push(`review:${m}`);
    return { text: JSON.stringify({ findings: pick(user, m) }), model: m, usd: 0.01 };
  };
  return { complete, calls };
}

/** New-file line number of the annotated line containing `needle`. */
function lineOf(diff: string, needle: string): number | undefined {
  const l = diff.split('\n').find((x) => x.includes(needle) && /^\s*\d+ \+/.test(x));
  return l ? Number(l.trim().split(' ')[0]) : undefined;
}

describe('reviewDiff', () => {
  it('runs several models, merges, verifies and drops false positives', async () => {
    const { complete, calls } = fakeModels(
      (diff, m) => {
        const at = lineOf(diff, '<= xs.length');
        return [
          {
            file: 'src/sum.ts',
            line: at,
            severity: 'high',
            category: 'bug',
            title: 'Off-by-one: <= reads past the end',
            detail: 'xs[xs.length] is undefined → NaN',
          },
          ...(m === 'a/one'
            ? [
                {
                  file: 'src/sum.ts',
                  line: 5,
                  severity: 'low',
                  category: 'bug',
                  title: 'FALSO: return may be wrong',
                  detail: '',
                },
                {
                  file: 'src/sum.ts',
                  line: 99,
                  severity: 'high',
                  category: 'bug',
                  title: 'Outside the diff',
                  detail: '',
                },
              ]
            : []),
        ];
      },
      (f) =>
        f.includes('FALSO')
          ? { verdict: 'false_positive', reason: 'fine' }
          : { verdict: 'real', reason: 'yes' },
    );
    const r = await reviewDiff(PATCH, complete, {
      models: ['a/one', 'b/two'],
      verifier: 'c/judge',
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      file: 'src/sum.ts',
      line: 3,
      verdict: 'confirmed',
      models: ['a/one', 'b/two'],
    });
    expect(r.stats).toMatchObject({ raw: 4, offDiff: 1, falsePositives: 1, reviewedFiles: 2 });
    expect(calls.filter((c) => c.startsWith('review'))).toHaveLength(2);
    expect(calls.filter((c) => c === 'verify:c/judge')).toHaveLength(2);
    expect(r.usd).toBeCloseTo(0.022);
  });

  it('a model that fails does not sink the review; all failing does', async () => {
    const ok = fakeModels(() => []).complete;
    const flaky: ReviewComplete = async (model, msgs, signal) => {
      if (model === 'bad/x') throw new Error('rate limited');
      return ok(model, msgs, signal);
    };
    const r = await reviewDiff(PATCH, flaky, { models: ['bad/x', 'good/y'] });
    expect(r.errors).toEqual([{ model: 'bad/x', error: 'rate limited' }]);
    await expect(reviewDiff(PATCH, flaky, { models: ['bad/x'] })).rejects.toThrow(/rate limited/);
  });

  it('keeps unverified findings when the verifier is off', async () => {
    const { complete, calls } = fakeModels(() => [
      { file: 'new.txt', line: 2, severity: 'low', title: 'typo' },
    ]);
    const r = await reviewDiff(PATCH, complete, { verifier: null });
    expect(r.findings[0]).toMatchObject({ verdict: 'plausible', line: 2 });
    expect(calls.some((c) => c.startsWith('verify'))).toBe(false);
  });

  it('builds a GitHub review with inline comments only on diff lines', async () => {
    const { complete } = fakeModels(() => [
      { file: 'src/sum.ts', line: 3, severity: 'high', title: 'Off-by-one' },
    ]);
    const files = parseUnifiedDiff(PATCH);
    const r = await reviewDiff(files, complete, {
      verifier: null,
      extra: [
        {
          id: 's1',
          file: 'config.ts',
          line: 7,
          severity: 'critical',
          category: 'security',
          title: 'Secret',
          detail: '',
          models: ['scanner'],
          source: 'scanner',
          verdict: 'confirmed',
        },
      ],
    });
    const gh = githubReview(r, files);
    expect(gh.comments).toEqual([
      expect.objectContaining({ path: 'src/sum.ts', line: 3, side: 'RIGHT' }),
    ]);
    expect(gh.body).toContain('config.ts:7');
    // Only what the user selected is published.
    expect(githubReview(r, files, new Set(['s1'])).comments).toHaveLength(0);
  });
});

describe('acceptance: seeded off-by-one in a PR (real git)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('points at the exact line of the bug', async () => {
    dir = mkdtempSync(join(tmpdir(), 'zx-review-'));
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    const body = (cond: string) =>
      [
        '/** Last n items of a list. */',
        'export function lastN<T>(xs: T[], n: number): T[] {',
        '  const out: T[] = [];',
        `  for (let i = xs.length - n; ${cond}; i++) out.push(xs[i]!);`,
        '  return out;',
        '}',
        '',
        'export const VERSION = 1;',
        '',
      ].join('\n');
    writeFileSync(join(dir, 'list.ts'), body('i < xs.length'));
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    // The PR: a harmless change plus the seeded bug on line 4.
    writeFileSync(
      join(dir, 'list.ts'),
      body('i <= xs.length').replace('VERSION = 1', 'VERSION = 2'),
    );
    git('commit', '-qam', 'feature');
    const patch = git('diff', 'main...feature');

    const { complete } = fakeModels((diff) => {
      const at = lineOf(diff, 'i <= xs.length');
      return at
        ? [{ file: 'list.ts', line: at, severity: 'high', title: 'Off-by-one in loop bound' }]
        : [];
    });
    const r = await reviewDiff(patch, complete, {
      readFile: async (p) => readFileSync(join(dir!, p), 'utf8'),
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ file: 'list.ts', line: 4, verdict: 'confirmed' });
    const src = readFileSync(join(dir, 'list.ts'), 'utf8').split('\n');
    expect(src[r.findings[0]!.line - 1]).toContain('i <= xs.length');
  });
});
