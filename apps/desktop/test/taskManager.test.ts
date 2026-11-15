import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import type { ChatEventView, ChatRequestView, ToolDecision } from '../src/shared/api.js';
import type { TasksStatusView } from '../src/shared/tasks.js';
import { Agent, TASK_LIMIT_NOTICE } from '../src/main/agent.js';
import type { Scope } from '../src/main/ai.js';
import { TaskManager, type TaskRunner } from '../src/main/tasks.js';
import { Workspace } from '../src/main/workspace.js';

/** Fase 5A with real git: worktrees, the queue, merge / discard, restart. */

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
  tmp = mkdtempSync(join(tmpdir(), 'zx-tasks-'));
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

/**
 * A runner that plays a scripted agent: writes a file in the task's workspace, may ask for
 * an approval (resolved through decide), and reports cost.
 */
function fakeRunner(opts: { approve?: boolean; hold?: Promise<void> } = {}) {
  const decisions = new Map<string, (d: ToolDecision) => void>();
  const scopes: Scope[] = [];
  let conv = 0;
  const runner: TaskRunner & { scopes: Scope[] } = {
    scopes,
    async chat(rid: string, req: ChatRequestView, emit, scope: Scope) {
      scopes.push(scope);
      const send = (ev: ChatEventView) => emit(rid, ev);
      send({ type: 'conversation', id: req.conversationId ?? `conv-${++conv}` });
      const ws = scope.workspace()!;
      if (opts.hold) await opts.hold;
      if (opts.approve) {
        send({
          type: 'tool_approval',
          id: 'c1',
          name: 'run_command',
          args: { command: 'pnpm test' },
          preview: {},
        });
        const d = await new Promise<ToolDecision>((r) => decisions.set(`${rid}:c1`, r));
        send({ type: 'tool_result', id: 'c1', ok: d !== 'deny', summary: d });
      }
      writeFileSync(join(ws.root, `${req.prompt.split(' ')[0]}.txt`), `${req.prompt}\n`);
      send({ type: 'cost', usd: 0.01, inputTokens: 1, outputTokens: 1, latencyMs: 1 });
      send({ type: 'done', stopReason: 'stop' });
    },
    abort: () => undefined,
    toolDecision: (rid, id, d) => decisions.get(`${rid}:${id}`)?.(d),
    answerQuestion: () => undefined,
    conversation: () => ({ messages: [] }),
  };
  return runner;
}

const until = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('task manager (real git)', () => {
  it('runs 3 tasks in parallel in worktrees outside the repo; merge and discard leave nothing behind', async () => {
    let status: TasksStatusView | undefined;
    const runner = fakeRunner();
    const m = new TaskManager({ dir: data, runner, git: gitAsync, onChange: (s) => (status = s) });
    const a = await m.create({ folder: repo, prompt: 'alfa cambia algo' });
    const b = await m.create({ folder: repo, prompt: 'beta otra cosa' });
    const c = await m.create({ folder: repo, prompt: 'gamma tercera' });
    await until(() => m.status().tasks.every((t) => t.state === 'done'));
    expect(status?.tasks).toHaveLength(3);

    for (const t of m.status().tasks) {
      expect(t.path.startsWith(data)).toBe(true);
      expect(t.path.startsWith(repo)).toBe(false);
      expect(t.stats).toEqual({ files: 1, added: 1, removed: 0 });
      expect(git(['log', '-1', '--format=%B', t.branch], repo)).toContain(`Zinarix-Task: ${t.id}`);
    }
    // Each run got its worktree as workspace and the task scope (cwd limit, own port).
    expect(new Set(runner.scopes.map((s) => s.task?.root)).size).toBe(3);
    expect(new Set(runner.scopes.map((s) => s.task?.env?.PORT)).size).toBe(3);
    // The user's tree is untouched while the tasks work.
    expect(existsSync(join(repo, 'alfa.txt'))).toBe(false);

    // The user edits their own tree meanwhile (another file): merge still works.
    writeFileSync(join(repo, 'a.txt'), 'uno\ndos\n');
    expect(await m.merge(a.id)).toEqual({ ok: true });
    expect(readFileSync(join(repo, 'alfa.txt'), 'utf8')).toBe('alfa cambia algo\n');
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('uno\ndos\n');

    // b after main advanced (a was merged): rebased first, then fast-forward.
    expect(await m.merge(b.id)).toEqual({ ok: true });
    expect(existsSync(join(repo, 'beta.txt'))).toBe(true);

    await m.discard(c.id);
    const worktrees = git(['worktree', 'list'], repo).trim().split('\n');
    expect(worktrees).toHaveLength(1);
    expect(git(['branch', '--list', 'zinarix/*'], repo).trim()).toBe('');
    expect(m.status().tasks.map((t) => t.closed)).toEqual(['merged', 'merged', 'discarded']);
  });

  it('blocks a merge over the user’s uncommitted changes in the same file', async () => {
    const m = new TaskManager({ dir: data, runner: fakeRunner(), git: gitAsync });
    const t = await m.create({ folder: repo, prompt: 'alfa x' });
    await until(() => m.status().tasks[0]!.state === 'done');
    writeFileSync(join(repo, 'alfa.txt'), 'mío\n');
    git(['add', 'alfa.txt'], repo);
    const r = await m.merge(t.id);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ files: ['alfa.txt'] });
    expect(readFileSync(join(repo, 'alfa.txt'), 'utf8')).toBe('mío\n');
  });

  it('waits for approvals without blocking other tasks, and respects maxParallel', async () => {
    const m = new TaskManager({
      dir: data,
      runner: fakeRunner({ approve: true }),
      git: gitAsync,
      maxParallel: 2,
    });
    await m.create({ folder: repo, prompt: 'uno a' });
    await m.create({ folder: repo, prompt: 'dos b' });
    await m.create({ folder: repo, prompt: 'tres c' });
    await until(() => m.status().tasks.filter((t) => t.state === 'waiting').length === 2);
    expect(m.status().tasks[2]!.state).toBe('queued');
    const [first] = m.status().tasks;
    expect(first!.pending).toEqual([{ id: 'c1', name: 'run_command', detail: 'pnpm test' }]);
    m.decide(first!.id, 'c1', 'approve');
    await until(() => m.status().tasks[0]!.state === 'done');
    // Its slot went to the queued one.
    await until(() => m.status().tasks[2]!.state === 'waiting');
  });

  it('after a restart, a task left halfway is interrupted and resumes in the same worktree', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const m1 = new TaskManager({ dir: data, runner: fakeRunner({ hold }), git: gitAsync });
    const t = await m1.create({ folder: repo, prompt: 'alfa larga' });
    await until(() => m1.status().tasks[0]!.state === 'working');
    writeFileSync(join(m1.status().tasks[0]!.path, 'parcial.txt'), 'hecho a medias\n');

    // "The app closed": a new manager reads tasks.json.
    const m2 = new TaskManager({ dir: data, runner: fakeRunner(), git: gitAsync });
    const saved = m2.status().tasks[0]!;
    expect(saved.state).toBe('interrupted');
    expect(existsSync(join(saved.path, 'parcial.txt'))).toBe(true);
    m2.resume(t.id);
    await until(() => m2.status().tasks[0]!.state === 'done');
    expect(m2.status().tasks[0]!.stats?.files).toBe(2); // the half-done work was kept
    release();
  });

  it('refuses to resume a cancelled task', async () => {
    const m = new TaskManager({ dir: data, runner: fakeRunner(), git: gitAsync, maxParallel: 0 });
    const t = await m.create({ folder: repo, prompt: 'alfa' });
    m.cancel(t.id);
    expect(() => m.resume(t.id)).toThrow();
  });

  it('refuses a folder that is not a git repository and a bad base', async () => {
    const m = new TaskManager({ dir: data, runner: fakeRunner(), git: gitAsync });
    await expect(m.create({ folder: tmp, prompt: 'x' })).rejects.toThrow(/repositorio git/);
    await expect(m.create({ folder: repo, prompt: 'x', base: 'no-existe' })).rejects.toThrow(
      /no-existe/,
    );
    await expect(
      m.create({ folder: repo, prompt: 'x', base: '--upload-pack=x' }),
    ).rejects.toThrow();
  });
});

/** The real agent loop inside a task scope: run_command never leaves the worktree. */
describe('agent in a task scope', () => {
  function fakeCore(steps: { name: string; args: Record<string, unknown> }[][], usd = 0) {
    let step = 0;
    let n = 0;
    return {
      async *stream() {
        for (const c of steps[step++] ?? [])
          yield {
            type: 'tool_call',
            id: `c${++n}`,
            name: c.name,
            argsDelta: JSON.stringify(c.args),
          };
        yield { type: 'cost', usd, inputTokens: 1, outputTokens: 1, latencyMs: 1 };
        yield { type: 'done', stopReason: 'stop' };
      },
    } as unknown as OmniCore;
  }

  async function runIn(
    steps: { name: string; args: Record<string, unknown> }[][],
    task: Scope['task'],
    usd = 0,
  ) {
    const root = join(tmp, 'wt');
    mkdirSync(join(root, 'src'), { recursive: true });
    const ws = new Workspace(root);
    const agent = new Agent(fakeCore(steps, usd), () => ws);
    agent.userKitRoot = null;
    const events: ChatEventView[] = [];
    const asked: string[] = [];
    await agent.run({
      conversationId: 'c',
      userMessage: { role: 'user', content: 'go' },
      fallbackHistory: [],
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      ask: (id) => {
        asked.push(id);
        return Promise.resolve('approve');
      },
      scope: { workspace: () => ws, task: task && { ...task, root } },
    });
    const results = events.flatMap((e) => (e.type === 'tool_result' ? [e] : []));
    return { events, asked, results, root };
  }

  it('refuses a cwd outside the worktree (and admin) before asking', async () => {
    const outside = tmp;
    const r = await runIn(
      [
        [
          { name: 'run_command', args: { command: 'echo hi', cwd: outside } },
          { name: 'run_command', args: { command: 'echo hi', cwd: '..' } },
          { name: 'run_command', args: { command: 'echo hi', admin: true } },
        ],
      ],
      { root: '' },
    );
    expect(r.results.map((x) => x.ok)).toEqual([false, false, false]);
    expect(r.asked).toEqual([]);
  });

  it('runs commands inside the worktree with the task PORT', async () => {
    const cmd =
      process.platform === 'win32' ? 'Write-Output "port=$env:PORT"' : 'echo "port=$PORT"';
    const r = await runIn([[{ name: 'run_command', args: { command: cmd, cwd: 'src' } }]], {
      root: '',
      env: { PORT: '4123' },
    });
    expect(r.results[0], JSON.stringify(r.events)).toMatchObject({ ok: true });
    const out = r.events.flatMap((e) => (e.type === 'tool_output' ? [e.chunk] : [])).join('');
    expect(out).toContain('port=4123');
  });

  it('stops at the cost limit with a task-limit notice', async () => {
    const step = [{ name: 'read_file', args: { path: 'src/none.ts' } }];
    const r = await runIn([step, step, step, step], { root: '', maxUsd: 0.015 }, 0.01);
    const notices = r.events.filter((e) => e.type === 'notice' && e.kind === TASK_LIMIT_NOTICE);
    expect(notices).toHaveLength(1);
    // Two steps (0.02 ≥ 0.015), then it stopped.
    expect(r.results).toHaveLength(2);
  });
});

describe('task manager: improvements (real git)', () => {
  it('a background ask_user waits in the panel and the answer reaches the agent', async () => {
    const answers: (string[] | null)[] = [];
    let reply: ((a: string[] | null) => void) | undefined;
    const runner: TaskRunner = {
      async chat(rid, _req, emit, scope) {
        emit(rid, { type: 'conversation', id: 'c-q' });
        emit(rid, {
          type: 'tool_approval',
          id: 'q1',
          name: 'ask_user',
          args: {},
          preview: {
            question: { question: '¿Qué librería?', options: ['A', 'B'], multiple: false },
          },
        });
        const a = await new Promise<string[] | null>((r) => (reply = r));
        answers.push(a);
        writeFileSync(join(scope.workspace()!.root, 'q.txt'), `${a?.join() ?? 'none'}\n`);
        emit(rid, { type: 'done', stopReason: 'stop' });
      },
      abort: () => undefined,
      toolDecision: () => undefined,
      answerQuestion: (_rid, _id, a) => reply?.(a),
      conversation: () => ({ messages: [] }),
    };
    const m = new TaskManager({ dir: data, runner, git: gitAsync });
    const t = await m.create({ folder: repo, prompt: 'pregunta algo' });
    await until(() => m.status().tasks[0]!.state === 'waiting');
    const p = m.status().tasks[0]!.pending[0]!;
    expect(p.question?.options).toEqual(['A', 'B']);
    m.answer(t.id, p.id, ['B']);
    await until(() => m.status().tasks[0]!.state === 'done');
    expect(answers).toEqual([['B']]);
    expect(m.status().tasks[0]!.pending).toEqual([]);
  });

  it('merges when "copy my changes" left the same uncommitted edits in the user tree', async () => {
    writeFileSync(join(repo, 'a.txt'), 'uno\nmio\n');
    writeFileSync(join(repo, 'nuevo.txt'), 'sin commit\n');
    const m = new TaskManager({ dir: data, runner: fakeRunner(), git: gitAsync });
    const t = await m.create({ folder: repo, prompt: 'copia trabaja', copyChanges: true });
    await until(() => m.status().tasks[0]!.state === 'done');
    expect(await m.merge(t.id)).toEqual({ ok: true });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('uno\nmio\n');
    expect(readFileSync(join(repo, 'nuevo.txt'), 'utf8')).toBe('sin commit\n');
    expect(readFileSync(join(repo, 'copia.txt'), 'utf8')).toBe('copia trabaja\n');
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
    expect(git(['stash', 'list'], repo).trim()).toBe('');
  });

  it('still blocks the merge when the user changed the copied file again', async () => {
    writeFileSync(join(repo, 'a.txt'), 'uno\nmio\n');
    const m = new TaskManager({ dir: data, runner: fakeRunner(), git: gitAsync });
    const t = await m.create({ folder: repo, prompt: 'copia trabaja', copyChanges: true });
    await until(() => m.status().tasks[0]!.state === 'done');
    writeFileSync(join(repo, 'a.txt'), 'uno\nmio\notra vez\n');
    const r = await m.merge(t.id);
    expect(r).toMatchObject({ ok: false, files: ['a.txt'] });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('uno\nmio\notra vez\n');
  });

  it('keep commits pending work first; reopen brings the worktree back and it merges', async () => {
    const m = new TaskManager({ dir: data, runner: fakeRunner(), git: gitAsync });
    const t = await m.create({ folder: repo, prompt: 'guarda algo' });
    await until(() => m.status().tasks[0]!.state === 'done');
    // Edited afterwards (as from the task's chat): not committed yet.
    writeFileSync(join(t.path, 'chat.txt'), 'desde el chat\n');
    await m.keep(t.id);
    expect(existsSync(t.path)).toBe(false);
    expect(git(['show', `${t.branch}:chat.txt`], repo)).toBe('desde el chat\n');

    await m.reopen(t.id);
    expect(m.status().tasks[0]!.closed).toBeUndefined();
    expect(readFileSync(join(t.path, 'chat.txt'), 'utf8')).toBe('desde el chat\n');
    expect(await m.merge(t.id)).toEqual({ ok: true });
    expect(readFileSync(join(repo, 'chat.txt'), 'utf8')).toBe('desde el chat\n');
  });

  it('merge commits what the task chat left uncommitted', async () => {
    const m = new TaskManager({ dir: data, runner: fakeRunner(), git: gitAsync });
    const t = await m.create({ folder: repo, prompt: 'base trabajo' });
    await until(() => m.status().tasks[0]!.state === 'done');
    writeFileSync(join(t.path, 'extra.txt'), 'extra\n');
    expect(await m.merge(t.id)).toEqual({ ok: true });
    expect(readFileSync(join(repo, 'extra.txt'), 'utf8')).toBe('extra\n');
  });

  it('usage measures the worktrees; old cancelled tasks are archived at start', async () => {
    const m = new TaskManager({
      dir: data,
      runner: fakeRunner({ hold: new Promise(() => undefined) }),
      git: gitAsync,
    });
    const t = await m.create({ folder: repo, prompt: 'larga espera' });
    await until(() => m.status().tasks[0]!.state === 'working');
    expect(m.scopeFor(t.path)).toMatchObject({ busy: true, scope: { root: t.path } });
    expect(m.scopeFor(repo)).toBeUndefined();
    m.cancel(t.id);
    writeFileSync(join(t.path, 'peso.bin'), Buffer.alloc(50_000));
    const u = await m.usage(true);
    expect(u.byTask[t.id]).toBeGreaterThanOrEqual(50_000);

    // Ten days later, after a restart.
    const file = join(data, 'tasks.json');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { tasks: { endedAt: number }[] };
    saved.tasks[0]!.endedAt = Date.now() - 10 * 24 * 3_600_000;
    writeFileSync(file, JSON.stringify(saved));
    const notes: string[] = [];
    const m2 = new TaskManager({
      dir: data,
      runner: fakeRunner(),
      git: gitAsync,
      notify: (_t, b) => notes.push(b),
    });
    expect(m2.scopeFor(t.path)?.busy).toBe(false);
    await m2.prune();
    expect(m2.status().tasks[0]!.closed).toBe('kept');
    expect(existsSync(t.path)).toBe(false);
    // Nothing lost: the uncommitted file went to the branch.
    expect(git(['cat-file', '-s', `${t.branch}:peso.bin`], repo).trim()).toBe('50000');
    expect(notes.join()).toMatch(/Liberé/);
  });
});
