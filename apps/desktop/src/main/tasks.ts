/**
 * Fase 5A: background tasks in git worktrees. A task is a normal agent run (AiService.chat)
 * whose workspace is a worktree outside the repository, in <dataDir>/worktrees/<repo>/<id>.
 * Several run at once (a queue beyond maxParallel); their approvals wait in the Tasks panel
 * without blocking the app. Tasks are saved to disk: after a restart the ones left halfway
 * are "interrupted", with their worktree intact, and can be resumed.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile, copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ChatEventView, ChatRequestView, ToolDecision } from '../shared/api.js';
import {
  afterRestart,
  branchName,
  canTransition,
  clampParallel,
  tailText,
  terminalChunk,
  TASK_OUTPUT_MAX,
  isIdle,
  isInside,
  mergeClash,
  parseShortstat,
  porcelainPaths,
  RUNNING,
  safeBase,
  taskCommitMessage,
  taskPort,
  taskTitle,
  toArchive,
  toStart,
  transition,
  type TaskCreateView,
  type TaskState,
  type TaskView,
  type TasksStatusView,
  type TasksUsageView,
} from '../shared/tasks.js';
import { TASK_LIMIT_NOTICE, runCommand, type TaskScope } from './agent.js';
import type { Scope } from './ai.js';
import { run, runUntrustedGit } from './git.js';
import { Workspace } from './workspace.js';
import { sandboxCaps, sandboxPaths } from './sandbox.js';
import type { SandboxCaps } from '../shared/sandbox.js';

/** What the manager needs from AiService (an interface, so tests can fake it). */
export interface TaskRunner {
  chat(
    requestId: string,
    req: ChatRequestView,
    emit: (requestId: string, ev: ChatEventView) => void,
    scope: Scope,
  ): Promise<void>;
  abort(requestId: string): void;
  toolDecision(requestId: string, toolCallId: string, decision: ToolDecision): void;
  answerQuestion(requestId: string, toolCallId: string, answer: string[] | null): void;
  conversation(id: string): { messages: { role: 'user' | 'assistant'; content: string }[] } | null;
}

export interface TaskManagerOptions {
  /** Where worktrees and tasks.json live (outside every repository). */
  dir: string;
  runner: TaskRunner;
  /** The tasks changed (state, cost, a pending approval…). */
  onChange?: (status: TasksStatusView) => void;
  /** A task needs the user (approval) or ended: a system notification. */
  notify?: (title: string, body: string) => void;
  maxParallel?: number;
  /** git (tests can point it elsewhere). */
  git?: (args: string[], cwd: string) => Promise<string>;
  /** Fase 5B: this machine's sandbox (tests fake it). Default: detected once. */
  sandbox?: () => Promise<SandboxCaps>;
}

/** Name of the optional setup script the repository may ship (run in the new worktree). */
export const SETUP_SCRIPT = '.zinarix/worktree-setup';
const SETUP_TIMEOUT = 10 * 60_000;
/** The disk walk stops after this many entries (node_modules can be huge). */
const USAGE_MAX_ENTRIES = 300_000;
const USAGE_TTL = 60_000;

export class TaskManager {
  private tasks: TaskView[] = [];
  /** The request in progress per task (abort, approvals). */
  private readonly live = new Map<string, string>();
  /** Fase 5A: each task's terminal (run_command lines and output), and its open commands. */
  private readonly terminal = new Map<string, string>();
  private readonly commandIds = new Map<string, Set<string>>();
  private logWrite: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  private readonly git: (args: string[], cwd: string) => Promise<string>;
  maxParallel: number;
  private seq = 0;
  private usageCache?: { at: number; value: Promise<TasksUsageView> };
  /** Fase 5B: what the sandbox protects on this machine (undefined until detected). */
  private box?: SandboxCaps;
  private readonly boxReady: Promise<SandboxCaps>;

  constructor(private readonly o: TaskManagerOptions) {
    this.file = join(o.dir, 'tasks.json');
    this.maxParallel = clampParallel(o.maxParallel ?? 3);
    this.git = o.git ?? ((args, cwd) => runUntrustedGit(args, cwd));
    this.tasks = afterRestart(this.load());
    this.save();
    this.boxReady = (o.sandbox ?? sandboxCaps)().then((c) => {
      this.box = c;
      this.changed();
      return c;
    });
  }

  /**
   * At start: clears worktrees git no longer has (deleted by hand) and frees the worktrees of
   * cancelled / failed tasks idle for a week (their work is committed to the branch first).
   */
  async prune(): Promise<void> {
    for (const repo of new Set(this.tasks.map((t) => t.repo)))
      if (existsSync(repo)) await this.git(['worktree', 'prune'], repo).catch(() => '');
    const n = await this.archive(toArchive(this.tasks, Date.now()));
    if (n)
      this.notice(
        `Liberé el worktree de ${n} tarea(s) cancelada(s) o fallida(s) de hace más de una semana. Sus ramas siguen ahí.`,
      );
  }

  status(): TasksStatusView {
    return {
      tasks: this.tasks.map((t) => ({ ...t, pending: [...t.pending] })),
      maxParallel: this.maxParallel,
      sandbox: this.box,
    };
  }

  /** Creates a task: checks the repository and the base, then queues it. */
  async create(req: TaskCreateView & { folder: string }): Promise<TaskView> {
    const prompt = req.prompt.trim();
    if (!prompt) throw new Error('La tarea necesita una descripción.');
    const top = (
      await this.git(['rev-parse', '--show-toplevel'], req.folder).catch(() => '')
    ).trim();
    if (!top) throw new Error('La carpeta no es un repositorio git: las tareas usan worktrees.');
    const repo = resolve(top);
    const baseRef = safeBase(req.base);
    const baseCommit = (
      await this.git(['rev-parse', '--verify', `${baseRef}^{commit}`], repo).catch(() => {
        throw new Error(`No encontré la rama o commit base "${baseRef}".`);
      })
    ).trim();
    if (existsSync(join(repo, '.gitmodules')))
      this.notice('El repositorio tiene submódulos: el worktree no los incluye.');
    const id = randomUUID();
    const repoKey = createHash('sha256').update(repo.toLowerCase()).digest('hex').slice(0, 12);
    const t: TaskView = {
      id,
      prompt,
      title: taskTitle(prompt),
      state: 'queued',
      model: req.model,
      mode: req.mode === 'auto' ? 'auto' : 'agent',
      repo,
      path: join(this.o.dir, repoKey, id.slice(0, 8)),
      branch: branchName(prompt, id),
      baseRef,
      baseCommit,
      createdAt: Date.now(),
      workedMs: 0,
      usd: 0,
      maxUsd: req.maxUsd,
      maxMinutes: req.maxMinutes,
      port: taskPort(this.tasks.filter((x) => !x.closed).map((x) => x.port)),
      pending: [],
      copyChanges: req.copyChanges,
      setup: req.setup,
    };
    this.tasks.push(t);
    this.changed();
    this.pump();
    return t;
  }

  /** Approves or denies a pending action of a task (the panel's Y / N). */
  decide(id: string, toolCallId: string, decision: ToolDecision): void {
    const t = this.get(id);
    const rid = this.live.get(id);
    if (!rid) return;
    t.pending = t.pending.filter((p) => p.id !== toolCallId);
    if (t.state === 'waiting' && !t.pending.length) transition(t, 'working');
    this.o.runner.toolDecision(rid, toolCallId, decision);
    this.changed();
  }

  /** Answers an ask_user question of a task (null = "let the agent decide"). */
  answer(id: string, toolCallId: string, answer: string[] | null): void {
    const t = this.get(id);
    const rid = this.live.get(id);
    if (!rid) return;
    t.pending = t.pending.filter((p) => p.id !== toolCallId);
    if (t.state === 'waiting' && !t.pending.length) transition(t, 'working');
    this.o.runner.answerQuestion(rid, toolCallId, answer?.length ? answer : null);
    this.changed();
  }

  cancel(id: string): void {
    const t = this.get(id);
    if (t.state === 'cancelled' || t.state === 'done') return;
    const rid = this.live.get(id);
    this.stopClock(t);
    transition(t, 'cancelled');
    t.endedAt = Date.now();
    t.pending = [];
    if (rid) this.o.runner.abort(rid);
    this.changed();
    this.pump();
  }

  /** Pauses a running task (it can be resumed later). */
  pause(id: string): void {
    const t = this.get(id);
    const rid = this.live.get(id);
    if (!rid || !RUNNING.includes(t.state)) return;
    this.stopClock(t);
    transition(t, 'paused');
    t.pending = [];
    this.o.runner.abort(rid);
    this.changed();
  }

  /** Resumes an interrupted, paused or failed task, or gives a finished one a follow-up. */
  resume(id: string, prompt?: string): void {
    const t = this.get(id);
    if (t.closed) throw new Error('El worktree de esta tarea ya no existe.');
    if (this.live.has(id)) return;
    t.error = undefined;
    // Interrupted before its worktree existed (it was still in the queue): queued again.
    if (!existsSync(t.path) && !t.conversationId && canTransition(t.state, 'queued')) {
      transition(t, 'queued');
      this.changed();
      this.pump();
      return;
    }
    if (!existsSync(t.path)) throw new Error('El worktree de esta tarea ya no existe.');
    if (!canTransition(t.state, 'working'))
      throw new Error('Esta tarea no se puede reanudar (está cancelada o sigue trabajando).');
    void this.work(
      t,
      prompt?.trim() ||
        'Continúa con la tarea donde la dejaste. Revisa lo que ya está hecho en los archivos antes de seguir.',
    );
  }

  /**
   * Merges the task's branch into the repository's current branch. The branch is rebased
   * onto it first (inside the worktree); conflicts are reported, never left half-applied in
   * the user's tree. Blocked when the user has uncommitted changes in the same files.
   */
  async merge(id: string): Promise<{ ok: true } | { ok: false; reason: string; files?: string[] }> {
    const t = this.get(id);
    if (t.state !== 'done' || t.closed) return { ok: false, reason: 'La tarea no ha terminado.' };
    const head = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], t.repo)).trim();
    if (head === 'HEAD')
      return { ok: false, reason: 'Tu repositorio no está en una rama (HEAD separado).' };
    // What was written in the task's chat after it finished is part of the task too.
    try {
      await this.commit(t);
    } catch (e) {
      return { ok: false, reason: `No se pudo hacer commit en el worktree: ${msg(e)}` };
    }
    const files = (await this.git(['diff', '--name-only', `${t.baseCommit}..${t.branch}`], t.repo))
      .split('\n')
      .filter(Boolean);
    const dirty = porcelainPaths(
      await this.git(['status', '--porcelain', '-z', '--untracked-files=all'], t.repo),
    );
    const clash = mergeClash(files, dirty);
    try {
      await this.git(['rebase', head], t.path);
    } catch (e) {
      await this.git(['rebase', '--abort'], t.path).catch(() => '');
      return {
        ok: false,
        reason: `Hay conflictos con ${head}. Usa "Resolver con el agente" o resuélvelos a mano en el worktree. (${msg(e)})`,
      };
    }
    // An uncommitted file of the user only clashes when it differs from the task's version
    // (with "copy my changes" the task starts from those very changes).
    const same: string[] = [];
    const real: string[] = [];
    for (const f of clash) ((await this.sameAsBranch(t, f)) ? same : real).push(f);
    if (real.length)
      return {
        ok: false,
        reason:
          'Tienes cambios sin commit en archivos que la tarea también cambió. Haz commit o guárdalos (stash) primero.',
        files: real,
      };
    // Identical copies are set aside while merging (the merge brings the same content back).
    let stashed = false;
    if (same.length) {
      try {
        await this.git(
          ['stash', 'push', '--include-untracked', '-m', `zinarix-task ${t.id}`, '--', ...same],
          t.repo,
        );
        stashed = true;
      } catch (e) {
        return {
          ok: false,
          reason: `No pude apartar tus cambios sin commit (iguales a los de la tarea): ${msg(e)}`,
          files: same,
        };
      }
    }
    try {
      await this.git(['merge', '--ff-only', t.branch], t.repo);
    } catch (e) {
      if (stashed) await this.git(['stash', 'pop'], t.repo).catch(() => '');
      return { ok: false, reason: `No se pudo fusionar en ${head}: ${msg(e)}` };
    }
    if (stashed) await this.git(['stash', 'drop'], t.repo).catch(() => '');
    await this.removeWorktree(t);
    await this.git(['branch', '-D', t.branch], t.repo).catch(() => '');
    t.closed = 'merged';
    this.changed();
    return { ok: true };
  }

  /** A follow-up task run that rebases and resolves the conflicts itself. */
  resolveWithAgent(id: string): void {
    const t = this.get(id);
    void (async () => {
      const head = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], t.repo)).trim();
      this.resume(
        id,
        `La rama ${head} avanzó. Haz \`git rebase ${head}\` en este worktree, resuelve los conflictos conservando la intención de ambos lados, corre las pruebas y termina el rebase (git rebase --continue).`,
      );
    })().catch((e) => {
      t.error = msg(e);
      this.changed();
    });
  }

  /** Pushes the branch and opens a pull request (the UI asked the user first). */
  async openPr(id: string): Promise<string> {
    const t = this.get(id);
    if (t.state !== 'done' || t.closed) throw new Error('La tarea no ha terminado.');
    await this.commit(t);
    await run('git', ['push', '-u', 'origin', t.branch], t.path);
    const out = await run(
      'gh',
      ['pr', 'create', '--head', t.branch, '--title', t.title, '--body', taskCommitMessage(t)],
      t.path,
    );
    const url = out.trim().split('\n').pop() ?? '';
    t.last = `PR: ${url}`;
    this.changed();
    return url;
  }

  /**
   * Removes the worktree, keeps the branch. Whatever was not committed yet (a paused or
   * failed run, edits from the task's chat) is committed first: nothing is lost.
   */
  async keep(id: string): Promise<void> {
    const t = this.get(id);
    if (this.live.has(id)) this.cancel(id);
    await this.saveWork(t);
    await this.removeWorktree(t);
    t.closed = 'kept';
    this.usageCache = undefined;
    this.changed();
  }

  /** A kept task gets its worktree back (from its branch) and can be resumed or merged. */
  async reopen(id: string): Promise<void> {
    const t = this.get(id);
    if (t.closed !== 'kept') throw new Error('Solo se reabren tareas con la rama guardada.');
    const ok = await this.git(['rev-parse', '--verify', `${t.branch}^{commit}`], t.repo).then(
      () => true,
      () => false,
    );
    if (!ok) throw new Error(`La rama ${t.branch} ya no existe.`);
    await mkdir(dirname(t.path), { recursive: true });
    await this.git(['worktree', 'prune'], t.repo).catch(() => '');
    await this.git(['worktree', 'add', t.path, t.branch], t.repo);
    t.closed = undefined;
    this.usageCache = undefined;
    this.changed();
  }

  /**
   * Frees disk: the worktrees of the given idle tasks go (work committed first, branch kept).
   * A task whose work cannot be committed (a rebase halfway…) is left alone. Returns how many.
   */
  async archive(ids: readonly string[]): Promise<number> {
    let n = 0;
    for (const id of ids) {
      const t = this.tasks.find((x) => x.id === id);
      if (!t || !isIdle(t) || this.live.has(id)) continue;
      try {
        await this.saveWork(t);
        await this.removeWorktree(t);
        t.closed = 'kept';
        n++;
      } catch (e) {
        t.error = `No liberé su espacio: ${msg(e)}`;
      }
    }
    if (ids.length) {
      this.usageCache = undefined;
      this.changed();
    }
    return n;
  }

  /** "Free space" in the panel: every idle task. */
  archiveIdle(): Promise<number> {
    return this.archive(toArchive(this.tasks, Date.now(), { all: true }));
  }

  /** Disk taken by the open worktrees (cached for a minute: the walk is not free). */
  usage(fresh = false): Promise<TasksUsageView> {
    const now = Date.now();
    if (!fresh && this.usageCache && now - this.usageCache.at < USAGE_TTL)
      return this.usageCache.value;
    const value = (async () => {
      const byTask: Record<string, number> = {};
      let total = 0;
      let partial = false;
      for (const t of this.tasks) {
        if (t.closed || !existsSync(t.path)) continue;
        const r = await dirSize(t.path, USAGE_MAX_ENTRIES);
        byTask[t.id] = r.bytes;
        total += r.bytes;
        partial ||= r.partial;
      }
      return { total, byTask, partial };
    })();
    this.usageCache = { at: now, value };
    return value;
  }

  /**
   * The limits for a chat opened on a task's worktree ("Open chat"): its commands stay in
   * the worktree, never as admin. `busy`: the task itself is running there right now.
   */
  scopeFor(folder: string): { scope: TaskScope; busy: boolean; title: string } | undefined {
    const win = process.platform === 'win32';
    const t = this.tasks.find((x) => !x.closed && isInside(x.path, resolve(folder), win));
    if (!t) return undefined;
    return {
      scope: { root: t.path, env: { PORT: String(t.port), ZINARIX_TASK: t.id } },
      busy: this.live.has(t.id) || t.state === 'preparing',
      title: t.title,
    };
  }

  /** Removes the worktree and the branch (the UI confirmed it). */
  async discard(id: string): Promise<void> {
    const t = this.get(id);
    if (this.live.has(id)) this.cancel(id);
    await this.removeWorktree(t);
    await this.git(['branch', '-D', t.branch], t.repo).catch(() => '');
    t.closed = 'discarded';
    this.changed();
  }

  /** How many tasks run at once (the user's setting, 1–8); more start now if there is room. */
  setMaxParallel(n: number): void {
    const v = clampParallel(n);
    if (v === this.maxParallel) return;
    this.maxParallel = v;
    this.changed();
    this.pump();
  }

  /** The task's terminal: its run_command lines and output (kept on disk, newest part). */
  output(id: string): string {
    const t = this.get(id);
    const live = this.terminal.get(t.id);
    if (live !== undefined) return live;
    try {
      return tailText(readFileSync(this.logFile(t.id), 'utf8'));
    } catch {
      return '';
    }
  }

  /** The task's diff against its base commit (uncommitted work included, new files too). */
  async diff(id: string): Promise<string> {
    const t = this.get(id);
    const max = 400_000;
    let out: string;
    if (!t.closed && existsSync(t.path)) {
      out = await this.git(['diff', '--no-color', t.baseCommit], t.path).catch(() => '');
      const untracked = (
        await this.git(['ls-files', '--others', '--exclude-standard'], t.path).catch(() => '')
      )
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean)
        .slice(0, 50);
      for (const f of untracked) {
        let text = '';
        try {
          text = readFileSync(join(t.path, f), 'utf8');
        } catch {
          continue;
        }
        if (text.includes('\0')) continue;
        const lines = text.split('\n');
        if (lines.at(-1) === '') lines.pop();
        const body = lines.map((l) => `+${l}`).join('\n');
        out += `diff --git a/${f} b/${f}\nnew file mode 100644\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
      }
    } else {
      out = await this.git(['diff', '--no-color', t.baseCommit, t.branch], t.repo).catch(() => '');
    }
    return out.length > max ? `${out.slice(0, max)}\n… (diff truncated)` : out;
  }

  private logFile(id: string): string {
    return join(this.o.dir, 'logs', `${id}.log`);
  }

  /** Adds to the task's terminal (memory) and its log on disk. */
  private appendTerminal(t: TaskView, chunk: string): void {
    const cur = this.terminal.get(t.id) ?? this.output(t.id);
    this.terminal.set(t.id, tailText(cur + chunk, TASK_OUTPUT_MAX));
    const file = this.logFile(t.id);
    this.logWrite = this.logWrite
      .then(() => mkdir(dirname(file), { recursive: true }))
      .then(() => appendFile(file, chunk))
      .catch(() => undefined);
  }

  /** Forgets closed tasks (the list gets long). */
  clearClosed(): void {
    this.tasks = this.tasks.filter((t) => !t.closed);
    this.changed();
  }

  private get(id: string): TaskView {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error('Tarea no encontrada.');
    return t;
  }

  private pump(): void {
    for (const id of toStart(this.tasks, this.maxParallel)) {
      const t = this.get(id);
      transition(t, 'preparing');
      this.changed();
      void this.prepare(t)
        .then(() => {
          if (t.state !== 'preparing') return; // cancelled meanwhile
          return this.work(t, t.prompt);
        })
        .catch((e) => {
          if (t.state === 'preparing') {
            transition(t, 'failed');
            t.error = msg(e);
            this.o.notify?.('Tarea fallida', `${t.title}: ${t.error}`);
            this.changed();
          }
          this.pump();
        });
    }
  }

  /** git worktree add, the user's uncommitted changes (if asked), the setup script. */
  private async prepare(t: TaskView): Promise<void> {
    await mkdir(dirname(t.path), { recursive: true });
    if (!existsSync(t.path))
      await this.git(['worktree', 'add', '-b', t.branch, t.path, t.baseCommit], t.repo);
    if (process.platform === 'win32')
      await this.git(['config', 'core.longpaths', 'true'], t.path).catch(() => '');
    if (t.copyChanges) {
      const patch = await this.git(['diff', 'HEAD', '--binary'], t.repo);
      if (patch.trim()) {
        const p = join(dirname(t.path), `${t.id}.patch`);
        writeFileSync(p, patch);
        try {
          await this.git(['apply', '--binary', '--whitespace=nowarn', p], t.path);
        } finally {
          rmSync(p, { force: true });
        }
      }
      const untracked = (
        await this.git(['ls-files', '--others', '--exclude-standard', '-z'], t.repo)
      )
        .split('\0')
        .filter(Boolean);
      for (const f of untracked.slice(0, 2000)) {
        const to = join(t.path, f);
        await mkdir(dirname(to), { recursive: true });
        await copyFile(join(t.repo, f), to).catch(() => undefined);
      }
    }
    const script = join(t.path, SETUP_SCRIPT);
    if (t.setup && existsSync(script)) {
      t.last = 'Preparando el entorno (worktree-setup)…';
      this.changed();
      const command = readFileSync(script, 'utf8').trim();
      const r = await runCommand(
        command,
        t.path,
        SETUP_TIMEOUT,
        new AbortController().signal,
        () => undefined,
        // The repository's own setup script (the user turned it on): no sandbox, since it
        // usually installs packages, but no tokens or keys either.
        { env: { PORT: String(t.port) }, strict: true },
      );
      if (r.code !== 0)
        throw new Error(`${SETUP_SCRIPT} falló (exit ${r.code}): ${r.output.slice(-400)}`);
    } else if (
      !existsSync(join(t.path, 'node_modules')) &&
      existsSync(join(t.path, 'package.json'))
    )
      t.last = `Sin node_modules en el worktree (crea ${SETUP_SCRIPT} para instalarlas al crear la tarea).`;
  }

  /** One agent run of the task (the first one, or a resume / follow-up). */
  private async work(t: TaskView, prompt: string): Promise<void> {
    transition(t, 'working');
    t.startedAt = Date.now();
    const rid = `task:${t.id}:${++this.seq}`;
    this.live.set(t.id, rid);
    this.changed();
    let failed: string | undefined;
    let limited = false;
    const history = t.conversationId
      ? (this.o.runner.conversation(t.conversationId)?.messages ?? []).map((m) => ({
          role: m.role,
          content: m.content,
        }))
      : [];
    const ws = new Workspace(t.path);
    const caps = await this.boxReady;
    // The sandbox hides the app data folder (other worktrees, tokens) from the command.
    const box =
      caps.kind === 'none'
        ? undefined
        : { caps, paths: sandboxPaths(t.path, dirname(this.o.dir), t.id) };
    const left = t.maxMinutes ? t.maxMinutes * 60_000 - t.workedMs : undefined;
    try {
      await this.o.runner.chat(
        rid,
        {
          agent: true,
          mode: t.mode,
          model: t.model,
          prompt,
          history,
          context: [],
          conversationId: t.conversationId,
        },
        (_r, ev) => {
          if (ev.type === 'notice' && ev.kind === TASK_LIMIT_NOTICE) limited = true;
          if (ev.type === 'error') failed = ev.message;
          this.onEvent(t, rid, ev);
        },
        {
          workspace: () => ws,
          task: {
            root: t.path,
            env: { PORT: String(t.port), ZINARIX_TASK: t.id },
            maxUsd: t.maxUsd !== undefined ? Math.max(0, t.maxUsd - (t.usd ?? 0)) : undefined,
            deadline: left !== undefined ? Date.now() + Math.max(0, left) : undefined,
            sandbox: box,
          },
        },
      );
    } catch (e) {
      failed = msg(e);
    }
    this.live.delete(t.id);
    this.stopClock(t);
    t.endedAt = Date.now();
    t.pending = [];
    // Cancelled or paused by the user meanwhile: that state stays.
    if (t.state === 'working' || t.state === 'waiting') {
      if (failed) {
        transition(t, 'failed');
        t.error = failed;
        this.o.notify?.('Tarea fallida', `${t.title}: ${failed}`);
      } else if (limited) {
        transition(t, 'paused');
        this.o.notify?.('Tarea pausada', `${t.title}: llegó a su tope. ¿Sigue?`);
      } else {
        try {
          await this.commit(t);
        } catch (e) {
          t.error = `No se pudo hacer commit: ${msg(e)}`;
        }
        transition(t, 'done');
        this.o.notify?.('Tarea terminada', t.title);
      }
    }
    this.changed();
    this.pump();
  }

  private onEvent(t: TaskView, rid: string, ev: ChatEventView): void {
    if (this.live.get(t.id) !== rid) return;
    let ids = this.commandIds.get(t.id);
    if (!ids) this.commandIds.set(t.id, (ids = new Set()));
    const chunk = terminalChunk(ev, ids);
    if (chunk) this.appendTerminal(t, chunk);
    switch (ev.type) {
      case 'conversation':
        t.conversationId = ev.id;
        break;
      case 'tool_approval':
        if (ev.name === 'ask_user') {
          // Questions wait in the panel like approvals ("let the agent decide" answers none).
          const q = ev.preview.question;
          if (!q) {
            this.o.runner.answerQuestion(rid, ev.id, null);
            return;
          }
          t.pending.push({
            id: ev.id,
            name: ev.name,
            detail: q.question.slice(0, 300),
            question: q,
          });
          if (t.state === 'working') transition(t, 'waiting');
          this.o.notify?.('Una tarea te hace una pregunta', `${t.title}: ${q.question}`);
          break;
        }
        t.pending.push({ id: ev.id, name: ev.name, detail: approvalDetail(ev) });
        if (t.state === 'working') transition(t, 'waiting');
        this.o.notify?.('Una tarea espera tu aprobación', `${t.title}: ${ev.name}`);
        break;
      case 'tool_result':
        t.last = ev.summary.slice(0, 160);
        break;
      case 'notice':
        t.last = ev.message.slice(0, 160);
        break;
      case 'cost':
        t.usd = t.usd === null || ev.usd === null ? null : t.usd + ev.usd;
        break;
      default:
        return;
    }
    this.changed();
  }

  /** The agent's work, committed on its branch with the Zinarix-Task trailer. */
  private async commit(t: TaskView): Promise<void> {
    await this.git(['add', '-A'], t.path);
    const staged = (await this.git(['diff', '--cached', '--name-only'], t.path)).trim();
    if (staged)
      await this.git(
        [
          '-c',
          'user.name=Zinarix',
          '-c',
          'user.email=tasks@zinarix.local',
          'commit',
          '--no-verify',
          '-m',
          taskCommitMessage(t),
        ],
        t.path,
      );
    t.stats = parseShortstat(await this.git(['diff', '--shortstat', t.baseCommit, 'HEAD'], t.path));
  }

  /** Commits what the worktree has pending (fails rather than lose it). */
  private async saveWork(t: TaskView): Promise<void> {
    if (!existsSync(t.path)) return;
    try {
      await this.commit(t);
    } catch (e) {
      throw new Error(`No pude guardar el trabajo del worktree en su rama: ${msg(e)}`);
    }
  }

  /** The user's uncommitted copy of `file` is the task branch's version, byte for byte. */
  private async sameAsBranch(t: TaskView, file: string): Promise<boolean> {
    const want = await this.git(['rev-parse', '--verify', '-q', `${t.branch}:${file}`], t.repo)
      .then((s) => s.trim())
      .catch(() => '');
    if (!existsSync(join(t.repo, file))) return !want;
    if (!want) return false;
    const have = await this.git(['hash-object', '--', file], t.repo)
      .then((s) => s.trim())
      .catch(() => '');
    return have === want;
  }

  private async removeWorktree(t: TaskView): Promise<void> {
    if (existsSync(t.path))
      await this.git(['worktree', 'remove', '--force', t.path], t.repo).catch(() => {
        rmSync(t.path, { recursive: true, force: true });
      });
    await this.git(['worktree', 'prune'], t.repo).catch(() => '');
  }

  private stopClock(t: TaskView): void {
    if (t.startedAt) t.workedMs += Date.now() - t.startedAt;
    t.startedAt = undefined;
  }

  private notice(text: string): void {
    this.o.notify?.('Tareas', text);
  }

  private changed(): void {
    this.save();
    this.o.onChange?.(this.status());
  }

  private load(): TaskView[] {
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as { tasks?: TaskView[] };
      return Array.isArray(v.tasks) ? v.tasks : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      mkdirSync(this.o.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ tasks: this.tasks }, null, 1));
      renameSync(tmp, this.file);
    } catch (e) {
      console.error('could not save tasks', msg(e));
    }
  }
}

/** What an approval is about, in one line (command, file, host…). */
function approvalDetail(ev: Extract<ChatEventView, { type: 'tool_approval' }>): string {
  const a = ev.args;
  const v = a.command ?? a.path ?? a.url ?? a.to ?? a.name ?? '';
  return String(v).slice(0, 300);
}

/** Size of a folder (files only, symlinks not followed), stopping after `max` entries. */
async function dirSize(root: string, max: number): Promise<{ bytes: number; partial: boolean }> {
  let bytes = 0;
  let seen = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (++seen > max) return { bytes, partial: true };
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) bytes += (await lstat(p).catch(() => null))?.size ?? 0;
    }
  }
  return { bytes, partial: false };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type { TaskState };
