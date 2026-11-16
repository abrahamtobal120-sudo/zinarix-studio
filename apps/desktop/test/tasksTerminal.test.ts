import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEventView, ChatRequestView, ToolDecision } from '../src/shared/api.js';
import {
  clampParallel,
  DEFAULT_PARALLEL,
  MAX_PARALLEL,
  splitDiff,
  tailText,
  taskModel,
  terminalChunk,
} from '../src/shared/tasks.js';
import type { Scope } from '../src/main/ai.js';
import { TaskManager, type TaskRunner } from '../src/main/tasks.js';

/** Fase 5A gaps: concurrency setting, model per task, a task's terminal and diff. */

describe('pure helpers', () => {
  it('clampParallel keeps 1–8 and defaults to 3', () => {
    expect(DEFAULT_PARALLEL).toBe(3);
    expect(clampParallel(undefined)).toBe(3);
    expect(clampParallel(Number.NaN)).toBe(3);
    expect(clampParallel(0)).toBe(1);
    expect(clampParallel(-4)).toBe(1);
    expect(clampParallel(2.6)).toBe(3);
    expect(clampParallel(99)).toBe(MAX_PARALLEL);
    expect(clampParallel('5')).toBe(3);
  });

  it('taskModel: the chosen model wins, else the chat’s, else none', () => {
    expect(taskModel('openai/gpt-5', 'anthropic/claude')).toBe('openai/gpt-5');
    expect(taskModel('  ', 'anthropic/claude')).toBe('anthropic/claude');
    expect(taskModel(undefined, undefined)).toBeUndefined();
    expect(taskModel('', ' ')).toBeUndefined();
  });

  it('terminalChunk keeps only run_command lines, output and exit', () => {
    const ids = new Set<string>();
    const evs: ChatEventView[] = [
      { type: 'tool_call', id: 'r1', name: 'read_file', args: { path: 'a' } },
      { type: 'tool_output', id: 'r1', chunk: 'nope' },
      { type: 'tool_call', id: 'c1', name: 'run_command', args: { command: 'pnpm test' } },
      { type: 'tool_output', id: 'c1', chunk: 'ok 3 tests\n' },
      { type: 'tool_result', id: 'c1', ok: true, summary: 'exit 0' },
      { type: 'tool_output', id: 'c1', chunk: 'late' },
      { type: 'text', delta: 'hola' },
    ];
    const out = evs.map((e) => terminalChunk(e, ids) ?? '').join('');
    expect(out).toBe('\n$ pnpm test\nok 3 tests\n\n[exit 0]\n');
    expect(ids.size).toBe(0);
  });

  it('tailText keeps the newest part, from a line start', () => {
    expect(tailText('abc', 10)).toBe('abc');
    const t = tailText('line1\nline2\nline3\n', 10);
    expect(t.length).toBeLessThanOrEqual(10);
    expect(t).toBe('line3\n');
  });

  it('splitDiff splits by file with +/− counts', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      'index 1..2 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1,2 @@',
      ' uno',
      '+dos',
      'diff --git a/b.ts b/b.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/b.ts',
      '@@ -0,0 +1 @@',
      '+x',
      '-y',
      '',
    ].join('\n');
    const f = splitDiff(patch);
    expect(f.map((x) => [x.path, x.added, x.removed])).toEqual([
      ['a.txt', 1, 0],
      ['b.ts', 1, 1],
    ]);
    expect(f[0]!.lines).toEqual(['@@ -1 +1,2 @@', ' uno', '+dos']);
    expect(splitDiff('')).toEqual([]);
  });
});

const git = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const gitAsync = (args: string[], cwd: string) =>
  new Promise<string>((res, rej) => {
    try {
      res(git(args, cwd));
    } catch (e) {
      rej(new Error(String((e as { stderr?: string }).stderr || e)));
    }
  });

let tmp: string;
let repo: string;
let data: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'zx-tasks5a-'));
  repo = join(tmp, 'repo');
  data = join(tmp, 'data');
  mkdirSync(repo);
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 't@t'], repo);
  git(['config', 'user.name', 't'], repo);
  git(['config', 'core.autocrlf', 'false'], repo);
  writeFileSync(join(repo, 'a.txt'), 'uno\n');
  git(['add', '.'], repo);
  git(['commit', '-qm', 'init'], repo);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const until = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Runs a command (output streamed), writes a file, and may wait for an approval first. */
function runner(opts: { approve?: boolean } = {}) {
  const decisions = new Map<string, (d: ToolDecision) => void>();
  const models: (string | undefined)[] = [];
  let conv = 0;
  const r: TaskRunner & { models: typeof models } = {
    models,
    async chat(rid: string, req: ChatRequestView, emit, scope: Scope) {
      models.push(req.model);
      const send = (ev: ChatEventView) => emit(rid, ev);
      send({ type: 'conversation', id: `conv-${++conv}` });
      if (opts.approve) {
        send({ type: 'tool_approval', id: 'c0', name: 'run_command', args: {}, preview: {} });
        await new Promise<ToolDecision>((res) => decisions.set(`${rid}:c0`, res));
      }
      send({ type: 'tool_call', id: 'c1', name: 'run_command', args: { command: 'echo hola' } });
      send({ type: 'tool_output', id: 'c1', chunk: 'hola\n' });
      send({ type: 'tool_result', id: 'c1', ok: true, summary: 'exit 0' });
      writeFileSync(join(scope.workspace()!.root, 'nuevo.txt'), 'nuevo\n');
      writeFileSync(join(scope.workspace()!.root, 'a.txt'), 'uno\ndos\n');
      send({ type: 'done', stopReason: 'stop' });
    },
    abort: () => undefined,
    toolDecision: (rid, id, d) => decisions.get(`${rid}:${id}`)?.(d),
    answerQuestion: () => undefined,
    conversation: () => ({ messages: [] }),
  };
  return r;
}

describe('task manager: model, concurrency, terminal and diff', () => {
  it('passes the chosen model to the run, and keeps its terminal and diff', async () => {
    const r = runner();
    const m = new TaskManager({ dir: data, runner: r, git: gitAsync });
    const t = await m.create({ folder: repo, prompt: 'cambia algo', model: 'openai/gpt-5' });
    await until(() => m.status().tasks[0]!.state === 'done');
    expect(r.models).toEqual(['openai/gpt-5']);
    expect(m.status().tasks[0]!.model).toBe('openai/gpt-5');
    expect(m.output(t.id)).toContain('$ echo hola\nhola\n');
    expect(m.output(t.id)).toContain('[exit 0]');
    const files = splitDiff(await m.diff(t.id));
    expect(files.map((f) => [f.path, f.added, f.removed]).sort()).toEqual([
      ['a.txt', 1, 0],
      ['nuevo.txt', 1, 0],
    ]);
    // A new manager (app restart) still reads the terminal from disk.
    await new Promise((res) => setTimeout(res, 100));
    const again = new TaskManager({ dir: data, runner: runner(), git: gitAsync });
    expect(again.output(t.id)).toContain('$ echo hola');
  });

  it('shows uncommitted work and new files in the diff while the task waits', async () => {
    const r = runner({ approve: true });
    const m = new TaskManager({ dir: data, runner: r, git: gitAsync });
    const t = await m.create({ folder: repo, prompt: 'espera algo' });
    await until(() => m.status().tasks[0]!.state === 'waiting');
    const path = m.status().tasks[0]!.path;
    writeFileSync(join(path, 'suelto.txt'), 'a\nb\n');
    const files = splitDiff(await m.diff(t.id));
    expect(files).toEqual([
      { path: 'suelto.txt', added: 2, removed: 0, lines: ['@@ -0,0 +1,2 @@', '+a', '+b'] },
    ]);
    m.decide(t.id, 'c0', 'approve');
    await until(() => m.status().tasks[0]!.state === 'done');
  });

  it('the concurrency limit is a setting: raising it starts queued tasks', async () => {
    const m = new TaskManager({
      dir: data,
      runner: runner({ approve: true }),
      git: gitAsync,
      maxParallel: 1,
    });
    await m.create({ folder: repo, prompt: 'uno a' });
    await m.create({ folder: repo, prompt: 'dos b' });
    await until(() => m.status().tasks[0]!.state === 'waiting');
    expect(m.status().tasks[1]!.state).toBe('queued');
    expect(m.status().maxParallel).toBe(1);
    m.setMaxParallel(2);
    expect(m.status().maxParallel).toBe(2);
    await until(() => m.status().tasks[1]!.state === 'waiting');
    m.setMaxParallel(50);
    expect(m.status().maxParallel).toBe(8);
    for (const x of m.status().tasks) m.decide(x.id, 'c0', 'approve');
    await until(() => m.status().tasks.every((x) => x.state === 'done'));
  });
});
