import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import { formatProblems, parseMentions, stripMentions } from '../src/shared/mentions.js';
import { ignoreFilesIn, isIgnored, parseIgnore } from '../src/shared/ignore.js';
import {
  applyOffsetChanges,
  looksLikeMissingName,
  pickImportCandidate,
} from '../src/shared/autoImport.js';
import { Knowledge } from '../src/main/knowledge.js';
import { Workspace } from '../src/main/workspace.js';

describe('chat mentions (Fase 8)', () => {
  it('finds @git, @terminal, @problems, @web and @docs with their arguments', () => {
    const m = parseMentions(
      'why does @git:HEAD~1 break? see @terminal:2, @problems:errors and @web:https://vitest.dev/api. Also @docs and @docs:react @git',
    );
    expect(m).toEqual([
      { kind: 'git', arg: 'HEAD~1' },
      { kind: 'terminal', arg: '2' },
      { kind: 'problems', arg: 'errors' },
      { kind: 'web', arg: 'https://vitest.dev/api' },
      { kind: 'docs' },
      { kind: 'docs', arg: 'react' },
      { kind: 'git' },
    ]);
  });

  it('ignores invalid arguments, e-mails and duplicates', () => {
    expect(parseMentions('@git:; rm -rf / and @web:file:///etc/passwd and me@git')).toEqual([]);
    expect(parseMentions('@terminal @terminal')).toEqual([{ kind: 'terminal' }]);
    expect(parseMentions('@gitlab and @webpack.config.js')).toEqual([]);
  });

  it('strips the mentions from the question', () => {
    expect(stripMentions('@docs:react how do hooks work? @git')).toBe('how do hooks work?');
  });

  it('formats Problems: errors first, grouped, capped', () => {
    const text = formatProblems([
      {
        path: 'b.ts',
        line: 3,
        column: 1,
        message: 'unused',
        severity: 'warning',
        source: 'ts',
        code: '6133',
      },
      {
        path: 'a.ts',
        line: 9,
        column: 5,
        message: "Cannot find\n name 'x'.",
        severity: 'error',
        source: 'ts',
        code: '2304',
      },
    ]);
    expect(text.split('\n')).toEqual([
      '1 error, 1 warning',
      "a.ts:9:5 error [ts 2304]: Cannot find name 'x'.",
      'b.ts:3:1 warning [ts 6133]: unused',
    ]);
    expect(formatProblems([], 'all')).toBe('');
    expect(
      formatProblems(
        [{ path: 'b', line: 1, column: 1, message: 'w', severity: 'warning' }],
        'errors',
      ),
    ).toBe('');
  });
});

describe('.gitignore / .zinarixignore (Fase 8)', () => {
  const rules = [
    ...parseIgnore('# deps\nnode_modules/\n*.log\n!keep.log\n/build\ndocs/**/*.tmp\n'),
    ...parseIgnore('generated/\n', 'pkg'),
    ...parseIgnore('secret-notes.md\nfixtures/big/\n'),
  ];

  it('follows git rules: folders, anchors, negation, ** and nested files', () => {
    expect(isIgnored('node_modules/a/index.js', rules)).toBe(true);
    expect(isIgnored('src/node_modules/x.js', rules)).toBe(true);
    expect(isIgnored('app.log', rules)).toBe(true);
    expect(isIgnored('logs/keep.log', rules)).toBe(false);
    expect(isIgnored('build/out.js', rules)).toBe(true);
    expect(isIgnored('src/build/out.js', rules)).toBe(false); // "/build" is anchored
    expect(isIgnored('docs/a/b/c.tmp', rules)).toBe(true);
    expect(isIgnored('pkg/generated/x.ts', rules)).toBe(true);
    expect(isIgnored('generated/x.ts', rules)).toBe(false); // only under pkg/
    expect(isIgnored('src/secret-notes.md', rules)).toBe(true);
    expect(isIgnored('src/index.ts', rules)).toBe(false);
  });

  it('a file inside an ignored folder cannot be re-included', () => {
    const r = parseIgnore('out/\n!out/keep.js\n');
    expect(isIgnored('out/keep.js', r)).toBe(true);
  });

  it('applies .gitignore files root-first and .zinarixignore last', () => {
    expect(ignoreFilesIn(['a/b/.gitignore', 'src/x.ts', 'a/.gitignore', '.gitignore'])).toEqual([
      '.gitignore',
      'a/.gitignore',
      'a/b/.gitignore',
      '.zinarixignore',
    ]);
  });
});

describe('auto-import pick (Fase 8)', () => {
  it('applies a single import fix, or the only preferred one', () => {
    expect(pickImportCandidate([{ title: 'Add import from "./math"' }])?.title).toBe(
      'Add import from "./math"',
    );
    expect(
      pickImportCandidate([
        { title: 'Add import from "./a"', isPreferred: true },
        { title: 'Add import from "./b"' },
      ])?.title,
    ).toBe('Add import from "./a"');
  });

  it('never guesses between several modules, and ignores non-import fixes', () => {
    expect(
      pickImportCandidate([{ title: 'Add import from "./a"' }, { title: 'Add import from "./b"' }]),
    ).toBeNull();
    expect(
      pickImportCandidate([
        { title: 'Remove unused import' },
        { title: "Change spelling to 'map'" },
      ]),
    ).toBeNull();
    expect(pickImportCandidate([{ title: 'Import `std::fs`', kind: 'quickfix' }])?.title).toBe(
      'Import `std::fs`',
    );
    expect(pickImportCandidate([{ title: 'Add import', kind: 'refactor.rewrite' }])).toBeNull();
  });

  it('recognises "missing name" diagnostics of other languages and applies offset edits', () => {
    expect(looksLikeMissingName('"Path" is not defined')).toBe(true);
    expect(looksLikeMissingName('undefined: strings')).toBe(true);
    expect(looksLikeMissingName('cannot find value `fs` in this scope')).toBe(true);
    expect(looksLikeMissingName('expected one argument')).toBe(false);
    expect(looksLikeMissingName("Cannot find name 'sum'.")).toBe(true);
    expect(
      applyOffsetChanges('const x = sum(1);', [
        { start: 0, length: 0, newText: "import { sum } from './m';\n" },
        { start: 10, length: 3, newText: 'add' },
      ]),
    ).toBe("import { sum } from './m';\nconst x = add(1);");
  });
});

describe('incremental code index (Fase 8)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  it('embeds only the changed chunks and honours .gitignore and .zinarixignore', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zx-index-'));
    const data = await mkdtemp(join(tmpdir(), 'zx-know-'));
    dirs.push(root, data);
    const big = (name: string) =>
      Array.from(
        { length: 120 },
        (_, i) => `export const ${name}${i} = ${i}; // ${name} value ${i}`,
      ).join('\n');
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), big('alpha'));
    await writeFile(join(root, 'src', 'b.ts'), big('beta'));
    await writeFile(join(root, 'dist', 'a.js'), big('built'));
    await writeFile(join(root, 'src', 'private.ts'), big('hidden'));
    await writeFile(join(root, '.gitignore'), 'dist/\n');
    await writeFile(join(root, '.zinarixignore'), 'src/private.ts\n');

    const embedded: string[] = [];
    const core = {
      config: { roles: { embeddings: 'local/emb' } },
      async embed(texts: string[]) {
        // the search query is embedded too: only count the index's chunks
        if (!(texts.length === 1 && texts[0] === 'alpha value')) embedded.push(...texts);
        return { vectors: texts.map((t) => [t.length % 7, 1, 0]) };
      },
    } as unknown as OmniCore;
    const k = new Knowledge(data, core);
    const ws = new Workspace(root);

    const first = await k.codeSearch(ws, 'alpha value', 5, new AbortController().signal);
    expect(first.files).toBe(3); // a.ts, b.ts and .gitignore — not dist/ nor private.ts
    expect(first.ignored).toBeGreaterThanOrEqual(2);
    expect(embedded.some((t) => t.includes('built'))).toBe(false);
    expect(embedded.some((t) => t.includes('hidden'))).toBe(false);
    const chunks = first.chunks!;
    expect(first.embedded).toBe(chunks);
    const firstCount = embedded.length;
    expect(firstCount).toBe(chunks);

    // Edit one line at the end of a.ts: only the chunk(s) around it are embedded again.
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(join(root, 'src', 'a.ts'), `${big('alpha')}\nexport const changed = true;`);
    await k.refreshCode(ws, new AbortController().signal, true);
    const again = embedded.length - firstCount;
    expect(again).toBeGreaterThan(0);
    expect(again).toBeLessThan(chunks / 2);
  });
});
