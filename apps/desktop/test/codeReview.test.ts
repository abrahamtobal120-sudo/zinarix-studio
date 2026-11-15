import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '@omni/core';
import type { OmniCore } from '@omni/core';
import {
  ReviewManager,
  addedOnlyText,
  newDeps,
  scanAddedLines,
  untrackedPatch,
} from '../src/main/review.js';

/** Fase 6: "Revisar cambios" — the security center on added lines, and the manager with git. */

const KEY = 'sk-ant-' + 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV';

describe('security scanners on the diff', () => {
  const patch = [
    'diff --git a/src/config.ts b/src/config.ts',
    '--- a/src/config.ts',
    '+++ b/src/config.ts',
    '@@ -1,3 +1,4 @@',
    " export const url = 'https://api.example.com';",
    `-export const old = '${KEY}';`,
    ' export const retries = 3;',
    `+export const key = '${KEY}';`,
    ' export const done = true;',
    '',
  ].join('\n');

  it('keeps added lines at their real line numbers', () => {
    const [f] = parseUnifiedDiff(patch);
    expect(addedOnlyText(f!).split('\n')).toEqual(['', '', `export const key = '${KEY}';`]);
  });

  it('reports a secret the change adds, on its line, and ignores removed ones', () => {
    const found = scanAddedLines(parseUnifiedDiff(patch));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.file === 'src/config.ts' && f.line === 3)).toBe(true);
    expect(found[0]).toMatchObject({
      source: 'scanner',
      category: 'security',
      severity: 'critical',
    });
    // The full secret never ends up in the finding text.
    expect(JSON.stringify(found)).not.toContain(KEY);
  });

  it('only new or upgraded dependencies are checked', () => {
    const lock = (v: string) =>
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/left-pad': { version: '1.0.0' },
          'node_modules/lodash': { version: v },
        },
      });
    expect(newDeps('package-lock.json', lock('4.17.20'), lock('4.17.21'))).toEqual([
      expect.objectContaining({ name: 'lodash', version: '4.17.21' }),
    ]);
    expect(newDeps('package-lock.json', undefined, lock('4.17.21'))).toHaveLength(2);
  });

  it('builds a diff for untracked files', () => {
    const files = parseUnifiedDiff(untrackedPatch('a/b.ts', 'one\r\ntwo\n'));
    expect(files[0]).toMatchObject({ path: 'a/b.ts', status: 'added' });
    expect(files[0]!.hunks[0]!.lines.map((l) => [l.kind, l.newLine, l.text])).toEqual([
      ['+', 1, 'one'],
      ['+', 2, 'two'],
    ]);
  });
});

describe('ReviewManager (real git, fake model)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function repo(): string {
    dir = mkdtempSync(join(tmpdir(), 'zx-cr-'));
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    writeFileSync(
      join(dir, 'list.ts'),
      'export function f(xs: number[]) {\n  for (let i = 0; i < xs.length; i++) console.log(xs[i]);\n}\n',
    );
    git('add', '.');
    git('commit', '-qm', 'base');
    return dir;
  }

  /** Reports the "<=" line it sees in the annotated diff; the verifier always agrees. */
  const fakeCore = (seen: string[]) =>
    ({
      complete: async (req: { model?: string; messages: { content: string }[] }) => {
        const user = req.messages.at(-1)!.content;
        seen.push(user);
        if (req.messages[0]!.content.startsWith('You verify'))
          return {
            text: '{"verdict":"real","reason":"yes"}',
            provider: 'fake',
            model: 'judge',
            usd: 0,
          };
        const hit = user.split('\n').find((l) => /^\s*\d+ \+/.test(l) && l.includes('<='));
        const findings = hit
          ? [
              {
                file: 'list.ts',
                line: Number(hit.trim().split(' ')[0]),
                severity: 'high',
                title: 'Off-by-one',
              },
            ]
          : [];
        return { text: JSON.stringify({ findings }), provider: 'fake', model: 'm', usd: 0.01 };
      },
    }) as unknown as OmniCore;

  it('reviews local changes, untracked files included, and flags the right line', async () => {
    const root = repo();
    writeFileSync(
      join(root, 'list.ts'),
      'export function f(xs: number[]) {\n  for (let i = 0; i <= xs.length; i++) console.log(xs[i]);\n}\n',
    );
    writeFileSync(join(root, 'secret.ts'), `export const k = '${KEY}';\n`);
    const seen: string[] = [];
    const m = new ReviewManager(() => fakeCore(seen));
    const progress: string[] = [];
    const r = await m.run('w:1', root, { source: { kind: 'local' }, models: [] }, (p) =>
      progress.push(p.phase),
    );
    const ai = r.findings.filter((f) => f.source === 'ai');
    expect(ai).toEqual([
      expect.objectContaining({ file: 'list.ts', line: 2, verdict: 'confirmed' }),
    ]);
    // The untracked file is reviewed too, and its secret is caught by the scanner.
    expect(r.files.map((f) => f.path).sort()).toEqual(['list.ts', 'secret.ts']);
    expect(
      r.findings.some((f) => f.source === 'scanner' && f.file === 'secret.ts' && f.line === 1),
    ).toBe(true);
    // The verifier saw the real file around the line.
    expect(seen.some((s) => s.includes('Finding (') && s.includes('i <= xs.length'))).toBe(true);
    expect(r.canPublish).toBe(false);
    expect(progress).toContain('verify');
    await expect(m.preview(root, r.id, [])).rejects.toThrow(/pull request/);
  });

  it('reviews a branch against its base and says when there is nothing to review', async () => {
    const root = repo();
    const m = new ReviewManager(() => fakeCore([]));
    await expect(
      m.run('w:2', root, { source: { kind: 'local' }, models: [] }, () => undefined),
    ).rejects.toThrow(/No hay cambios/);
    execFileSync('git', ['checkout', '-qb', 'feature'], { cwd: root });
    writeFileSync(
      join(root, 'list.ts'),
      'export function f(xs: number[]) {\n  for (let i = 0; i <= xs.length; i++) console.log(xs[i]);\n}\n',
    );
    execFileSync('git', ['-c', 'core.autocrlf=false', 'commit', '-qam', 'bug'], { cwd: root });
    const r = await m.run(
      'w:3',
      root,
      { source: { kind: 'branch', base: 'main' }, models: ['fake/m'], verify: false },
      () => undefined,
    );
    expect(r.findings).toEqual([
      expect.objectContaining({ file: 'list.ts', line: 2, verdict: 'plausible' }),
    ]);
    await expect(
      m.run(
        'w:4',
        root,
        { source: { kind: 'branch', base: '--evil' }, models: [] },
        () => undefined,
      ),
    ).rejects.toThrow(/no válido/);
  });

  it('saves reviews to disk, hides ignored findings next time and passes the project rules', async () => {
    const root = repo();
    const store = mkdtempSync(join(tmpdir(), 'zx-cr-store-'));
    try {
      writeFileSync(join(root, 'AGENTS.md'), 'Use tabs.\n');
      execFileSync('git', ['add', 'AGENTS.md'], { cwd: root });
      execFileSync('git', ['-c', 'core.autocrlf=false', 'commit', '-qm', 'rules'], { cwd: root });
      execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
      writeFileSync(
        join(root, 'list.ts'),
        'export function f(xs: number[]) {\n  for (let i = 0; i <= xs.length; i++) console.log(xs[i]);\n}\n',
      );
      const seen: string[] = [];
      const systems: string[] = [];
      type Req = { model?: string; messages: { content: string }[] };
      const inner = fakeCore(seen) as unknown as { complete: (req: Req) => Promise<unknown> };
      const core = {
        complete: async (req: Req) => {
          systems.push(req.messages[0]!.content);
          return inner.complete(req);
        },
      } as unknown as OmniCore;
      const m = new ReviewManager(() => core, { dir: store });
      const paths: string[][] = [];
      const r = await m.run(
        'w:5',
        root,
        { source: { kind: 'local' }, models: [], security: false },
        () => undefined,
        (p) => {
          paths.push(p);
          return 'RULES: use tabs';
        },
      );
      expect(paths[0]).toContain('list.ts');
      expect(systems.some((x) => x.includes('RULES: use tabs'))).toBe(true);
      expect(r.guidance).toEqual(['rules']);
      const bug = r.findings.find((f) => f.source === 'ai')!;
      expect(bug.fingerprint).toMatch(/^[0-9a-f]{16}$/);

      // A fresh manager (app restarted) finds the saved review.
      const again = new ReviewManager(() => core, { dir: store });
      expect(again.history(root)).toEqual([
        expect.objectContaining({ id: r.id, findings: r.findings.length }),
      ]);
      expect(again.get(root, r.id).findings.map((f) => f.id)).toContain(bug.id);

      // "Not a problem": saved in the project's ignore file and gone from the review…
      const after = await again.ignore(root, r.id, [bug.id], 'on purpose');
      expect(after.findings.some((f) => f.id === bug.id)).toBe(false);
      expect(after.stats.ignored).toBe(1);
      const file = join(root, '.zinarix', 'review-ignore.json');
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8')).ignore).toEqual([
        expect.objectContaining({
          fingerprint: bug.fingerprint,
          file: 'list.ts',
          reason: 'on purpose',
        }),
      ]);

      // …and in the next review, before any verification is paid for.
      seen.length = 0;
      const next = await again.run(
        'w:6',
        root,
        { source: { kind: 'local' }, models: [], security: false },
        () => undefined,
      );
      expect(next.findings.filter((f) => f.source === 'ai')).toEqual([]);
      expect(next.stats.ignored).toBe(1);
      expect(seen.some((x) => x.startsWith('Finding ('))).toBe(false);

      again.delete(root, r.id);
      expect(new ReviewManager(() => core, { dir: store }).history(root).map((h) => h.id)).toEqual([
        next.id,
      ]);
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});
