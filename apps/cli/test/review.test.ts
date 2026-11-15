import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OmniConfig } from '@omni/core';
import type { ReviewResult } from '@omni/core';
import { annotations, parseSeverity, prFromActions } from '../src/commands/review.js';
import { mockServer, openAiStream, sse } from '../../../tests/helpers/mock-server.js';

describe('omni review helpers', () => {
  it('turns findings into GitHub Actions annotations', () => {
    const r = {
      findings: [
        {
          id: 'a',
          file: 'src/a,b.ts',
          line: 7,
          severity: 'high',
          category: 'bug',
          title: 'Off-by-one: <=',
          detail: 'line1\nline2',
          models: ['m'],
          source: 'ai',
          verdict: 'confirmed',
        },
      ],
    } as unknown as ReviewResult;
    expect(annotations(r)).toEqual([
      '::error file=src/a%2Cb.ts,line=7,title=[high] Off-by-one%3A <=::line1%0Aline2',
    ]);
  });

  it('reads the PR number of a pull_request run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-ev-'));
    const p = join(dir, 'event.json');
    writeFileSync(p, JSON.stringify({ pull_request: { number: 42 } }));
    expect(prFromActions({ GITHUB_EVENT_PATH: p })).toBe(42);
    expect(prFromActions({})).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('validates --fail-on', () => {
    expect(parseSeverity('HIGH')).toBe('high');
    expect(parseSeverity(undefined)).toBeUndefined();
    expect(() => parseSeverity('urgent')).toThrow(/fail-on/);
  });
});

// End to end against the built CLI and a fake model (skipped when dist is missing).
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe.skipIf(!existsSync(CLI))('omni review end to end (seeded off-by-one)', () => {
  let home: string;
  let repo: string;
  let server: Awaited<ReturnType<typeof mockServer>>;

  beforeAll(async () => {
    // The fake model reports the line it sees carrying "<=" in the annotated diff, and the
    // verifier rejects a decoy finding.
    server = await mockServer((req, res) => {
      const body = JSON.parse(req.body) as { messages: { role: string; content: string }[] };
      const system = body.messages[0]!.content;
      const user = body.messages.at(-1)!.content;
      if (system.startsWith('You verify'))
        return sse(
          res,
          openAiStream(
            JSON.stringify(
              user.includes('DECOY')
                ? { verdict: 'false_positive', reason: 'handled' }
                : { verdict: 'real', reason: 'reads past the end' },
            ),
          ),
        );
      const hit = user.split('\n').find((l) => /^\s*\d+ \+/.test(l) && l.includes('<= xs.length'));
      const line = hit ? Number(hit.trim().split(' ')[0]) : 0;
      return sse(
        res,
        openAiStream(
          JSON.stringify({
            findings: [
              {
                file: 'list.ts',
                line,
                severity: 'high',
                category: 'bug',
                title: 'Off-by-one in loop bound',
                detail: 'xs[xs.length] is undefined',
              },
              {
                file: 'list.ts',
                line: 1,
                severity: 'low',
                category: 'bug',
                title: 'DECOY: comment',
                detail: '',
              },
            ],
          }),
        ),
      );
    });
    home = mkdtempSync(join(tmpdir(), 'omni-rv-home-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify(
        OmniConfig.parse({
          defaultModel: 'mock/m',
          customProviders: [
            {
              id: 'mock',
              name: 'mock',
              adapter: 'openai-compatible',
              baseUrl: server.url,
              baseUrlParams: [],
              auth: { type: 'bearer', header: 'Authorization' },
              envVars: ['MOCK_KEY'],
              region: 'global',
              category: 'custom',
              modelsEndpoint: '/models',
              supports: {
                listModels: true,
                streaming: true,
                tools: true,
                vision: false,
                jsonMode: true,
                embeddings: false,
                fim: false,
              },
              fallbackModels: [{ id: 'm', label: 'M', inputPrice: 1, outputPrice: 1 }],
              status: 'active',
              verifiedAt: null,
            },
          ],
        }),
      ),
    );
    repo = mkdtempSync(join(tmpdir(), 'omni-rv-repo-'));
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: repo, encoding: 'utf8' });
    const src = (cond: string) =>
      `/** Last n items. */\nexport function lastN<T>(xs: T[], n: number): T[] {\n  const out: T[] = [];\n  for (let i = xs.length - n; ${cond}; i++) out.push(xs[i]!);\n  return out;\n}\n`;
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    writeFileSync(join(repo, 'list.ts'), src('i < xs.length'));
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    writeFileSync(join(repo, 'list.ts'), src('i <= xs.length'));
    git('commit', '-qam', 'bug');
  });
  afterAll(async () => {
    await server?.close();
    for (const d of [home, repo]) if (d) rmSync(d, { recursive: true, force: true });
  });

  function run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        cwd: repo,
        env: {
          PATH: process.env.PATH ?? '',
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
          HOME: home,
          OMNI_HOME: home,
          OMNI_NO_KEYCHAIN: '1',
          OMNI_VAULT_PASSWORD: 'pw',
          MOCK_KEY: 'mock-key-1234567890',
          NO_COLOR: '1',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end();
    });
  }

  it('flags the bug on its exact line and drops the decoy', async () => {
    const r = await run(['review', '--base', 'main', '--format', 'json']);
    expect(r.stderr).toBe('');
    const out = JSON.parse(r.stdout) as ReviewResult;
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ file: 'list.ts', line: 4, verdict: 'confirmed' });
    expect(out.stats.falsePositives).toBe(1);
  });

  it('--fail-on exits with 6 and --format github prints annotations', async () => {
    const r = await run(['review', '--base', 'main', '--format', 'github', '--fail-on', 'high']);
    expect(r.code).toBe(6);
    expect(r.stdout).toContain('::error file=list.ts,line=4,');
  });

  it('honours .zinarix/review-ignore.json (and --no-project skips it)', async () => {
    const first = JSON.parse(
      (await run(['review', '--base', 'main', '--format', 'json'])).stdout,
    ) as ReviewResult;
    const fp = first.findings[0]!.fingerprint!;
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    const dir = join(repo, '.zinarix');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'review-ignore.json'),
      JSON.stringify({ ignore: [{ fingerprint: fp, file: 'list.ts', title: 'x' }] }),
    );
    try {
      const hidden = JSON.parse(
        (await run(['review', '--base', 'main', '--format', 'json'])).stdout,
      ) as ReviewResult;
      expect(hidden.findings).toEqual([]);
      expect(hidden.stats.ignored).toBe(1);
      const all = JSON.parse(
        (await run(['review', '--base', 'main', '--format', 'json', '--no-project'])).stdout,
      ) as ReviewResult;
      expect(all.findings).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
