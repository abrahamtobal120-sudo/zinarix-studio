import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Git, checkRepoSpec, repoName, run, webUrl } from '../src/main/git.js';
import { cleanCompletion } from '../src/main/ai.js';
import { Workspace } from '../src/main/workspace.js';

const dirs: string[] = [];
async function repo(): Promise<Git> {
  const dir = mkdtempSync(join(tmpdir(), 'zs-git-'));
  dirs.push(dir);
  const g = new Git(new Workspace(dir));
  await g.init();
  await run('git', ['config', 'user.email', 't@example.com'], dir);
  await run('git', ['config', 'user.name', 'Test'], dir);
  return g;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Git panel backend', () => {
  it('status, stage, diff, commit and log', async () => {
    const g = await repo();
    const root = (g as unknown as { ws: Workspace }).ws.root;
    writeFileSync(join(root, 'a.txt'), 'uno\n');
    let st = await g.status();
    expect(st.isRepo).toBe(true);
    expect(st.hasCommits).toBe(false);
    expect(st.files).toMatchObject([{ path: 'a.txt', untracked: true }]);
    await g.stage(['a.txt']);
    st = await g.status();
    expect(st.files[0]).toMatchObject({ index: 'A' });
    await g.commit('primero', false);
    writeFileSync(join(root, 'a.txt'), 'dos\n');
    expect(await g.diff('a.txt', false)).toEqual({ before: 'uno\n', after: 'dos\n' });
    expect(await g.patch(false)).toContain('+dos');
    const log = await g.log();
    expect(log[0]!.subject).toBe('primero');
    await g.checkout('feat/x', true);
    expect((await g.status()).branch).toBe('feat/x');
  });

  it('rejects paths outside the workspace and flag-like branch names', async () => {
    const g = await repo();
    await expect(g.stage(['../fuera'])).rejects.toThrow(/escapes/);
    await expect(g.checkout('--orphan', true)).rejects.toThrow(/no válido/);
  });

  it('accepts only safe clone sources', () => {
    expect(checkRepoSpec('octo/repo')).toEqual({ kind: 'gh', value: 'octo/repo' });
    expect(checkRepoSpec('https://github.com/a/b.git').kind).toBe('url');
    expect(() => checkRepoSpec('ext::sh -c touch /tmp/x')).toThrow();
    expect(() => checkRepoSpec('--upload-pack=x')).toThrow();
    expect(repoName('https://github.com/a/proyecto.git')).toBe('proyecto');
  });
});

describe('Git panel extras', () => {
  it('named stash list, apply/drop, undo commit and revert', async () => {
    const g = await repo();
    const root = (g as unknown as { ws: Workspace }).ws.root;
    writeFileSync(join(root, 'a.txt'), 'uno\n');
    await g.stage([]);
    await g.commit('primero', false);
    writeFileSync(join(root, 'a.txt'), 'dos\n');
    await g.stash('push', 'mi trabajo');
    const list = await g.stashList();
    expect(list).toMatchObject([{ ref: 'stash@{0}', message: 'mi trabajo' }]);
    await g.stash('apply', 'stash@{0}');
    expect((await g.status()).files).toHaveLength(1);
    await g.stash('drop', 'stash@{0}');
    expect(await g.stashList()).toEqual([]);
    await expect(g.stash('pop', '--all')).rejects.toThrow();

    await g.stage([]);
    await g.commit('segundo', false);
    await g.undoCommit();
    expect((await g.log()).map((c) => c.subject)).toEqual(['primero']);
    expect((await g.status()).files[0]).toMatchObject({ index: 'M' });
    await g.commit('segundo', false);
    await g.revert((await g.log())[0]!.hash);
    expect((await g.log())[0]!.subject).toContain('Revert');
    await expect(g.revert('-n')).rejects.toThrow();
  });

  it('derives the web page of a remote without credentials', () => {
    expect(webUrl('git@github.com:me/app.git')).toBe('https://github.com/me/app');
    expect(webUrl('https://tok@github.com/me/app.git')).toBe('https://github.com/me/app');
    expect(webUrl('ssh://git@gitlab.com/g/sub/app.git')).toBe('https://gitlab.com/g/sub/app');
    expect(webUrl('/tmp/local')).toBeNull();
  });
});

describe('inline completion cleanup', () => {
  it('strips fences and echoes of the surrounding code', () => {
    expect(cleanCompletion('```ts\nreturn a + b;\n```', 'function f() {\n  ', '\n}')).toBe(
      'return a + b;',
    );
    expect(cleanCompletion('const x = 1;', 'const x', '')).toBe(' = 1;');
  });
});
