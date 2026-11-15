import { describe, expect, it } from 'vitest';
import {
  addToIgnoreFile,
  fingerprintOf,
  githubReview,
  parseIgnoreFile,
  parseUnifiedDiff,
  postedFingerprints,
  projectReviewGuidance,
  reviewDiff,
  scanAddedLines,
} from '@omni/core';
import type { ReviewComplete, ReviewFinding } from '@omni/core';

/** Fase 6 (mejoras): fingerprints, the ignore list, no repeated PR comments, multi-line. */

const diff = (start: number, lines: string[]) =>
  [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    `@@ -${start},2 +${start},${lines.length + 2} @@`,
    ' const a = 1;',
    ...lines.map((l) => `+${l}`),
    ' const z = 2;',
    '',
  ].join('\n');

const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  id: 'f1',
  file: 'src/a.ts',
  line: 11,
  severity: 'high',
  category: 'bug',
  title: 'Off-by-one',
  detail: 'reads past the end',
  models: ['m'],
  source: 'ai',
  verdict: 'confirmed',
  ...over,
});

describe('fingerprints', () => {
  it('stay the same when the line moves, and change with the code or the category', () => {
    const before = parseUnifiedDiff(diff(10, ['for (let i = 0; i <= n; i++) {}']));
    const after = parseUnifiedDiff(diff(40, ['for (let i = 0;  i <= n; i++) {}']));
    const a = fingerprintOf(finding({ line: 11 }), before);
    const b = fingerprintOf(finding({ line: 41, title: 'Loop bound wrong' }), after);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a); // same code (whitespace aside), same category, other line and title
    expect(fingerprintOf(finding({ line: 41, category: 'security' }), after)).not.toBe(a);
    const other = parseUnifiedDiff(diff(10, ['for (let i = 0; i < n; i++) {}']));
    expect(fingerprintOf(finding(), other)).not.toBe(a);
  });
});

describe('ignore file', () => {
  it('adds entries without duplicates and tolerates bad input', () => {
    const one = addToIgnoreFile(
      undefined,
      [{ fingerprint: '0123456789abcdef', file: 'a.ts', title: 'x' }],
      'por diseño',
      new Date('2026-11-15T10:00:00Z'),
    );
    const two = addToIgnoreFile(one, [
      { fingerprint: '0123456789abcdef', file: 'a.ts', title: 'x' },
      { fingerprint: 'fedcba9876543210', file: 'b.ts', title: 'y' },
    ]);
    expect(parseIgnoreFile(two)).toEqual([
      {
        fingerprint: '0123456789abcdef',
        file: 'a.ts',
        title: 'x',
        reason: 'por diseño',
        at: '2026-11-15',
      },
      expect.objectContaining({ fingerprint: 'fedcba9876543210', file: 'b.ts' }),
    ]);
    expect(parseIgnoreFile('not json')).toEqual([]);
    expect(parseIgnoreFile('[{"fingerprint":"short"},{"fingerprint":"0123456789abcdef"}]')).toEqual(
      [expect.objectContaining({ fingerprint: '0123456789abcdef' })],
    );
  });

  it('drops ignored findings before verification (no model call for them)', async () => {
    const patch = diff(10, ['for (let i = 0; i <= n; i++) {}', 'const k = eval(input);']);
    const files = parseUnifiedDiff(patch);
    const ignored = fingerprintOf(finding({ line: 11 }), files);
    const verified: string[] = [];
    const complete: ReviewComplete = async (_m, messages) => {
      const user = messages.at(-1)!.content;
      if (messages[0]!.content.startsWith('You verify')) {
        verified.push(user);
        return { text: '{"verdict":"real","reason":"ok"}' };
      }
      return {
        text: JSON.stringify({
          findings: [
            { file: 'src/a.ts', line: 11, severity: 'high', category: 'bug', title: 'Off-by-one' },
            { file: 'src/a.ts', line: 12, severity: 'high', category: 'bug', title: 'Throws' },
          ],
        }),
      };
    };
    const r = await reviewDiff(patch, complete, { ignore: [ignored] });
    expect(r.stats.ignored).toBe(1);
    expect(r.findings.map((f) => f.line)).toEqual([12]);
    expect(verified).toHaveLength(1);
    expect(r.findings[0]!.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    // Scanner findings (extra) honour the ignore list too.
    const scan = scanAddedLines(files);
    expect(scan.some((f) => f.line === 12 && f.source === 'scanner')).toBe(true);
    const fp = fingerprintOf(
      scan.find((f) => f.line === 12)!,
      files,
    );
    const r2 = await reviewDiff(patch, async () => ({ text: '{"findings":[]}' }), {
      extra: scan,
      ignore: [fp],
      verifier: null,
    });
    expect(r2.findings.some((f) => f.source === 'scanner' && f.line === 12)).toBe(false);
  });
});

describe('publishing on GitHub', () => {
  const files = parseUnifiedDiff(diff(10, ['one();', 'two();', 'three();']));
  const result = (list: ReviewFinding[]) => ({
    findings: list.map((f) => ({ ...f, fingerprint: fingerprintOf(f, files) })),
    stats: {
      files: 1,
      reviewedFiles: 1,
      skippedFiles: [],
      raw: 0,
      offDiff: 0,
      merged: 0,
      falsePositives: 0,
    },
    errors: [],
    models: [],
    usd: 0,
  });

  it('marks each comment and skips the ones the PR already has', () => {
    const r = result([
      finding({ id: 'a', line: 11 }),
      finding({ id: 'b', line: 12, title: 'Two' }),
    ]);
    const first = githubReview(r, files);
    expect(first.comments).toHaveLength(2);
    expect(first.skipped).toBe(0);
    const posted = postedFingerprints(first.comments.map((c) => c.body));
    expect(posted.size).toBe(2);
    const again = githubReview(r, files, undefined, 'es', posted);
    expect(again.comments).toEqual([]);
    expect(again.skipped).toBe(2);
    // Only the new finding goes out the next time.
    const more = result([...r.findings, finding({ id: 'c', line: 13, category: 'security' })]);
    const third = githubReview(more, files, undefined, 'es', posted);
    expect(third.comments.map((c) => c.line)).toEqual([13]);
    expect(third.skipped).toBe(2);
  });

  it('posts a multi-line comment when the whole range is on the diff', () => {
    const r = result([
      finding({ id: 'a', line: 11, endLine: 13 }),
      finding({ id: 'b', line: 12, endLine: 99, title: 'too far', category: 'security' }),
    ]);
    const gh = githubReview(r, files);
    expect(gh.comments[0]).toMatchObject({ start_line: 11, line: 13, start_side: 'RIGHT' });
    expect(gh.comments[1]).toMatchObject({ line: 12 });
    expect(gh.comments[1]!.start_line).toBeUndefined();
  });
});

describe('project guidance for the CLI', () => {
  it('reads .zinarix/review.md and AGENTS.md (or CLAUDE.md)', async () => {
    const fs: Record<string, string> = {
      '.zinarix/review.md': 'Ignore generated code.',
      'CLAUDE.md': 'Use tabs.',
    };
    const g = await projectReviewGuidance(async (p) => fs[p]);
    expect(g).toContain('Ignore generated code.');
    expect(g).toContain('Use tabs.');
    expect(await projectReviewGuidance(async () => undefined)).toBe('');
  });
});
