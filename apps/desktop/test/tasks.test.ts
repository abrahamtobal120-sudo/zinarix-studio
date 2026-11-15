import { describe, expect, it } from 'vitest';
import {
  afterRestart,
  branchName,
  canTransition,
  fmtBytes,
  isInside,
  mergeClash,
  parseShortstat,
  porcelainPaths,
  toArchive,
  safeBase,
  taskCommitMessage,
  taskCwd,
  taskPort,
  taskTitle,
  toStart,
  transition,
  type TaskView,
} from '../src/shared/tasks';

const task = (over: Partial<TaskView>): TaskView => ({
  id: 'abcd1234',
  prompt: 'x',
  title: 'x',
  state: 'queued',
  mode: 'agent',
  repo: '/r',
  path: '/w',
  branch: 'zinarix/x-abcd',
  baseRef: 'HEAD',
  baseCommit: 'f00',
  createdAt: 0,
  workedMs: 0,
  usd: 0,
  port: 4100,
  pending: [],
  ...over,
});

describe('task states', () => {
  it('allows the normal path and resuming', () => {
    expect(canTransition('queued', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'working')).toBe(true);
    expect(canTransition('working', 'waiting')).toBe(true);
    expect(canTransition('waiting', 'working')).toBe(true);
    expect(canTransition('working', 'done')).toBe(true);
    expect(canTransition('interrupted', 'working')).toBe(true);
    expect(canTransition('paused', 'working')).toBe(true);
    expect(canTransition('done', 'working')).toBe(true);
  });

  it('refuses transitions that make no sense', () => {
    expect(canTransition('cancelled', 'working')).toBe(false);
    expect(canTransition('cancelled', 'queued')).toBe(false);
    expect(canTransition('queued', 'done')).toBe(false);
    expect(canTransition('done', 'waiting')).toBe(false);
    expect(() => transition(task({ state: 'cancelled' }), 'working')).toThrow(/no permitido/);
    expect(transition(task({ state: 'queued' }), 'preparing').state).toBe('preparing');
  });

  it('marks what was left halfway as interrupted after a restart', () => {
    const out = afterRestart([
      task({ id: 'a', state: 'working', pending: [{ id: '1', name: 'run_command', detail: '' }] }),
      task({ id: 'b', state: 'queued' }),
      task({ id: 'c', state: 'done' }),
      task({ id: 'd', state: 'waiting' }),
    ]);
    expect(out.map((t) => t.state)).toEqual(['interrupted', 'interrupted', 'done', 'interrupted']);
    expect(out[0]!.pending).toEqual([]);
  });
});

describe('branch names', () => {
  it('are safe git refs', () => {
    expect(branchName('Añade el botón de "Exportar" @{u}..', '9f3a-77')).toBe(
      'zinarix/anade-el-boton-de-exportar-u-9f3a',
    );
    expect(branchName('   ', 'zz')).toBe('zinarix/tarea-zz');
    expect(branchName('x'.repeat(200), 'abcd')).toMatch(/^zinarix\/x{40}-abcd$/);
    for (const p of ['a..b', 'feat.lock', 'a b\tc', '~^:?*[\\', 'ñ/ü'])
      expect(branchName(p, 'abcd')).toMatch(/^zinarix\/[a-z0-9-]+-abcd$/);
  });

  it('refuses bases that are not refs', () => {
    expect(safeBase(undefined)).toBe('HEAD');
    expect(safeBase(' main ')).toBe('main');
    expect(safeBase('origin/release-2')).toBe('origin/release-2');
    for (const b of ['--upload-pack=x', 'a..b', 'a b', 'x@{1}', 'a:b', 'main.lock', 'a\u0000'])
      expect(() => safeBase(b)).toThrow();
  });

  it('titles and commit messages carry the trailer', () => {
    expect(taskTitle('\n  Arregla   el login \nmás detalles')).toBe('Arregla el login');
    const msg = taskCommitMessage({ id: 't1', prompt: 'Arregla el login\nen móvil' });
    expect(msg.startsWith('Arregla el login\n\n')).toBe(true);
    expect(msg.trimEnd().endsWith('Zinarix-Task: t1')).toBe(true);
  });
});

describe('cwd limit', () => {
  const id = (p: string) => p;

  it('accepts the worktree and its sub-folders', () => {
    expect(taskCwd('/w/t1', undefined, id)).toEqual({ cwd: '/w/t1' });
    expect(taskCwd('/w/t1', 'packages/a', id)).toEqual({ cwd: '/w/t1/packages/a' });
    expect(taskCwd('/w/t1', '/w/t1/src', id)).toEqual({ cwd: '/w/t1/src' });
  });

  it('refuses .., absolute paths, home and other worktrees', () => {
    for (const c of ['..', '../t2', 'src/../../t2', '/etc', '~', '~/.ssh', '/w/t10'])
      expect(taskCwd('/w/t1', c, id)).toHaveProperty('error');
  });

  it('refuses symlinks and junctions that point outside', () => {
    const real = (p: string) => (p.includes('link') ? '/home/me/.ssh' : p);
    expect(taskCwd('/w/t1', 'link', real)).toHaveProperty('error');
  });

  it('handles Windows paths (case, drive, backslashes, \\\\?\\ prefix)', () => {
    const root = 'C:\\Users\\me\\AppData\\worktrees\\t1';
    expect(taskCwd(root, 'src\\app', id, true)).toEqual({ cwd: `${root}/src\\app` });
    expect(taskCwd(root, 'c:\\users\\ME\\appdata\\worktrees\\t1\\x', id, true)).not.toHaveProperty(
      'error',
    );
    for (const c of ['C:\\Users\\me\\Desktop', 'D:\\', '..\\t2', '\\\\?\\C:\\Windows'])
      expect(taskCwd(root, c, id, true)).toHaveProperty('error');
    // Junction inside the worktree pointing to the Desktop.
    const real = (p: string) => (p.endsWith('j') ? 'C:\\Users\\me\\Desktop' : p);
    expect(taskCwd(root, 'j', real, true)).toHaveProperty('error');
    expect(isInside(root, `\\\\?\\${root}\\src`, true)).toBe(true);
  });
});

describe('queue and helpers', () => {
  it('starts at most maxParallel tasks, oldest first', () => {
    const tasks = [
      task({ id: 'run', state: 'working' }),
      task({ id: 'q2', createdAt: 2 }),
      task({ id: 'q1', createdAt: 1 }),
      task({ id: 'q3', createdAt: 3 }),
      task({ id: 'w', state: 'waiting' }),
    ];
    expect(toStart(tasks, 3)).toEqual(['q1']);
    expect(toStart(tasks, 5)).toEqual(['q1', 'q2', 'q3']);
    expect(toStart(tasks, 1)).toEqual([]);
  });

  it('gives each task its own port', () => {
    expect(taskPort([])).toBe(4100);
    expect(taskPort([4100, 4101, 4103])).toBe(4102);
  });

  it('reads git shortstat', () => {
    expect(parseShortstat(' 3 files changed, 10 insertions(+), 2 deletions(-)\n')).toEqual({
      files: 3,
      added: 10,
      removed: 2,
    });
    expect(parseShortstat(' 1 file changed, 1 deletion(-)')).toEqual({
      files: 1,
      added: 0,
      removed: 1,
    });
    expect(parseShortstat('')).toEqual({ files: 0, added: 0, removed: 0 });
  });

  it('blocks a merge that touches the user’s uncommitted files', () => {
    expect(mergeClash(['src/a.ts', 'b.ts'], ['src\\a.ts', 'c.ts'])).toEqual(['src/a.ts']);
    expect(mergeClash(['a'], [])).toEqual([]);
  });
});

describe('tasks: disk and archive helpers', () => {
  it('porcelainPaths skips the second path of renames', () => {
    expect(porcelainPaths(' M a.txt\0R  nuevo.ts\0viejo.ts\0?? dir/x.ts\0')).toEqual([
      'a.txt',
      'nuevo.ts',
      'dir/x.ts',
    ]);
  });

  it('toArchive: automatic only for old cancelled / failed; "all" takes every idle task', () => {
    const day = 24 * 3_600_000;
    const now = 100 * day;
    const tasks = [
      task({ id: '1', state: 'cancelled', endedAt: now - 8 * day }),
      task({ id: '2', state: 'failed', endedAt: now - 1000 }),
      task({ id: '3', state: 'done', endedAt: now - 8 * day }),
      task({ id: '4', state: 'working' }),
      task({ id: '5', state: 'failed', endedAt: now - 8 * day, closed: 'kept' }),
    ];
    expect(toArchive(tasks, now)).toEqual(['1']);
    expect(toArchive(tasks, now, { all: true })).toEqual(['1', '2', '3']);
  });

  it('fmtBytes', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  });
});
