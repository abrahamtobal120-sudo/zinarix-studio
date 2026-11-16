/**
 * Fase 5A: background tasks. Each task is a normal agent run whose workspace is a git
 * worktree of its own (outside the repository). This module is pure (no fs, no git): the
 * states and their transitions, the branch name, the cwd limit and the queue.
 */

import type { SandboxCaps } from './sandbox.js';

export type TaskState =
  | 'queued'
  | 'preparing'
  | 'working'
  | 'waiting'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** Where each state may go. Ended tasks (cancelled) never work again. */
const NEXT: Record<TaskState, readonly TaskState[]> = {
  queued: ['preparing', 'cancelled', 'interrupted'],
  preparing: ['working', 'failed', 'cancelled', 'interrupted'],
  working: ['waiting', 'paused', 'done', 'failed', 'cancelled', 'interrupted'],
  waiting: ['working', 'paused', 'done', 'failed', 'cancelled', 'interrupted'],
  // Paused (cost / time limit) and interrupted (the app closed) are resumed.
  paused: ['working', 'cancelled', 'done'],
  interrupted: ['working', 'queued', 'cancelled'],
  // A finished task can get a follow-up ("continue / fix this").
  done: ['working'],
  failed: ['working', 'queued', 'cancelled'],
  cancelled: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return NEXT[from].includes(to);
}

/** States in which the task holds one of the parallel slots. */
export const RUNNING: readonly TaskState[] = ['preparing', 'working', 'waiting'];
/** A task in one of these states is left halfway when the app closes. */
export const LIVE: readonly TaskState[] = ['queued', ...RUNNING];

export interface TaskView {
  id: string;
  prompt: string;
  /** Short title (first line of the prompt). */
  title: string;
  state: TaskState;
  model?: string;
  /** agent = approvals as usual; auto = project file edits need no approval. */
  mode: 'agent' | 'auto';
  /** The repository the task was created from (absolute). */
  repo: string;
  /** The worktree folder (absolute, outside the repository). */
  path: string;
  branch: string;
  /** What the base was called (HEAD, main…) and the commit it pointed to. */
  baseRef: string;
  baseCommit: string;
  /** The conversation of the task (open it in the chat). */
  conversationId?: string;
  createdAt: number;
  /** When its last run ended (or it was cancelled): how long it has been idle. */
  endedAt?: number;
  /** Time worked so far (ms, without queue or pauses). */
  workedMs: number;
  startedAt?: number;
  usd: number | null;
  /** Limits: the task pauses when it reaches them. */
  maxUsd?: number;
  maxMinutes?: number;
  port: number;
  /** Last thing it did (tool result, notice…). */
  last?: string;
  error?: string;
  /** Changes against the base commit (after it finishes). */
  stats?: { files: number; added: number; removed: number };
  /** Approvals the task waits for (shown in the Tasks panel). */
  pending: TaskApprovalView[];
  /** The worktree was removed (kept branch, merged, discarded). */
  closed?: 'merged' | 'kept' | 'discarded';
  /** Copy the user's uncommitted changes into the worktree. */
  copyChanges?: boolean;
  /** Run .zinarix/worktree-setup after creating the worktree (the user said yes). */
  setup?: boolean;
}

export interface TaskApprovalView {
  id: string;
  name: string;
  /** What it is about: the command, the file… */
  detail: string;
  /** ask_user: a question with options instead of approve / deny. */
  question?: { question: string; options: string[]; multiple: boolean };
}

/** Disk taken by the worktrees (bytes). `partial`: the walk stopped at its file limit. */
export interface TasksUsageView {
  total: number;
  byTask: Record<string, number>;
  partial: boolean;
}

/** Above this the panel suggests freeing space. */
export const USAGE_WARN_BYTES = 5 * 1024 ** 3;
/** Cancelled and failed tasks idle this long lose their worktree at start (the branch stays). */
export const AUTO_ARCHIVE_MS = 7 * 24 * 3_600_000;

export interface TaskCreateView {
  /** The repository (absolute); omitted = the window's open folder. */
  folder?: string;
  prompt: string;
  model?: string;
  mode?: 'agent' | 'auto';
  /** Branch, tag or commit to start from (default HEAD). */
  base?: string;
  copyChanges?: boolean;
  setup?: boolean;
  maxUsd?: number;
  maxMinutes?: number;
}

export interface TasksStatusView {
  tasks: TaskView[];
  /** How many run at the same time. */
  maxParallel: number;
  /** Fase 5B: what this machine's sandbox protects (undefined while it is detected). */
  sandbox?: SandboxCaps;
}

/** Changes a task's state, refusing transitions that make no sense (a bug, not the user). */
export function transition<T extends { state: TaskState }>(task: T, to: TaskState): T {
  if (task.state === to) return task;
  if (!canTransition(task.state, to)) throw new Error(`tarea: ${task.state} → ${to} no permitido`);
  task.state = to;
  return task;
}

/**
 * A safe branch name: zinarix/<slug>-<id4>. Only [a-z0-9-] in the slug, so it never hits
 * git's ref rules (no "..", "@{", spaces, trailing ".lock", control characters…).
 */
export function branchName(prompt: string, id: string): string {
  const slug =
    prompt
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'tarea';
  const tag =
    id
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 4) || '0000';
  return `zinarix/${slug}-${tag}`;
}

/** The title shown in the panel: first non-empty line, cut short. */
export function taskTitle(prompt: string): string {
  const line = prompt.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const t = line.trim().replace(/\s+/g, ' ');
  return t.length > 80 ? `${t.slice(0, 79)}…` : t || 'Tarea';
}

/** The base must look like a ref or a commit (it goes to git as an argument, never a shell). */
export function safeBase(base: string | undefined): string {
  const b = (base ?? '').trim() || 'HEAD';
  if (
    b.startsWith('-') ||
    b.length > 200 ||
    /[\s~^:?*[\\]|\.\.|@\{|\.lock$|\/$/.test(b) ||
    /[\x00-\x1f\x7f]/.test(b)
  )
    throw new Error(`Rama base no válida: ${b}`);
  return b;
}

function norm(p: string, win: boolean): string {
  let s = p.replace(/\\/g, '/');
  // Windows long-path and device prefixes (\\?\C:\…): the same folder.
  s = s.replace(/^\/\/[?.]\/(?:UNC\/)?/i, (m) => (/UNC/i.test(m) ? '//' : ''));
  const parts: string[] = [];
  const lead = s.match(/^([a-z]:)?\/+/i)?.[0] ?? '';
  for (const part of s.slice(lead.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const out = (lead.replace(/\/+$/, '/') || '') + parts.join('/');
  return win ? out.toLowerCase() : out;
}

/** True when `path` is `root` or inside it (lexically; resolve symlinks before calling). */
export function isInside(root: string, path: string, win = false): boolean {
  const r = norm(root, win).replace(/\/+$/, '');
  const p = norm(path, win).replace(/\/+$/, '');
  return p === r || p.startsWith(`${r}/`);
}

/**
 * The folder a task's run_command may use: relative paths start at the worktree, and the
 * result (after resolving symlinks and junctions with `real`) must stay inside it.
 * Returns the folder, or an error message for the model.
 */
export function taskCwd(
  root: string,
  cwd: string | undefined,
  real: (p: string) => string,
  win = false,
): { cwd: string } | { error: string } {
  const raw = (cwd ?? '').trim();
  const absolute = /^([a-z]:[\\/]|[\\/])/i.test(raw) || raw.startsWith('~');
  const joined = !raw ? root : absolute ? raw : `${root.replace(/[\\/]+$/, '')}/${raw}`;
  const outside = {
    error: `cwd fuera de la carpeta de la tarea (${raw}). En una tarea en segundo plano los comandos solo corren dentro de su worktree: ${root}`,
  };
  if (raw.startsWith('~') || !isInside(root, joined, win)) return outside;
  let realRoot: string;
  let realCwd: string;
  try {
    realRoot = real(root);
    realCwd = real(joined);
  } catch {
    return { error: `La carpeta ${raw} no existe dentro de la tarea.` };
  }
  // A symlink or junction inside the worktree that points elsewhere is still outside.
  if (!isInside(realRoot, realCwd, win)) return outside;
  return { cwd: joined };
}

/** Which queued tasks start now (oldest first), given how many may run at once. */
export function toStart(tasks: readonly TaskView[], maxParallel: number): string[] {
  const running = tasks.filter((t) => RUNNING.includes(t.state)).length;
  const free = Math.max(0, maxParallel - running);
  return tasks
    .filter((t) => t.state === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, free)
    .map((t) => t.id);
}

/** A port of its own per task (dev servers of three tasks do not collide). */
export function taskPort(used: readonly number[], from = 4100): number {
  let p = from;
  while (used.includes(p)) p++;
  return p;
}

/** `git diff --shortstat` → files, insertions, deletions. */
export function parseShortstat(out: string): { files: number; added: number; removed: number } {
  const n = (re: RegExp) => Number(out.match(re)?.[1] ?? 0);
  return {
    files: n(/(\d+) files? changed/),
    added: n(/(\d+) insertions?\(\+\)/),
    removed: n(/(\d+) deletions?\(-\)/),
  };
}

/** The commit message of a task: its title, the prompt and the Zinarix-Task trailer. */
export function taskCommitMessage(task: Pick<TaskView, 'id' | 'prompt'>): string {
  const title = taskTitle(task.prompt).slice(0, 72);
  const body = task.prompt.trim() === title ? '' : `\n\n${task.prompt.trim().slice(0, 2000)}`;
  return `${title}${body}\n\nZinarix-Task: ${task.id}\n`;
}

/** After a restart, what was left halfway is "interrupted" (its worktree is intact). */
export function isIdle(t: Pick<TaskView, 'state' | 'closed'>): boolean {
  return !t.closed && !LIVE.includes(t.state);
}

/**
 * Tasks whose worktree can go (their work is committed to the branch first). `all`: every
 * idle task (the user asked to free space); otherwise only cancelled / failed ones idle for
 * longer than `maxIdle` (automatic, at start).
 */
export function toArchive(
  tasks: readonly TaskView[],
  now: number,
  o: { all?: boolean; maxIdle?: number } = {},
): string[] {
  const maxIdle = o.maxIdle ?? AUTO_ARCHIVE_MS;
  return tasks
    .filter((t) => isIdle(t))
    .filter(
      (t) =>
        o.all ||
        ((t.state === 'cancelled' || t.state === 'failed') &&
          now - (t.endedAt ?? t.createdAt) > maxIdle),
    )
    .map((t) => t.id);
}

/** Bytes for people: 1.2 GB, 340 MB… */
export function fmtBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** `git status --porcelain -z` → paths (the second path of a rename entry is skipped). */
export function porcelainPaths(out: string): string[] {
  const parts = out.split(' ');
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]!;
    if (e.length < 4) continue;
    paths.push(e.slice(3));
    if (e[0] === 'R' || e[0] === 'C') i++; // "R  new old"
  }
  return paths;
}

export function afterRestart(tasks: TaskView[]): TaskView[] {
  return tasks.map((t) =>
    LIVE.includes(t.state)
      ? { ...t, state: 'interrupted' as const, pending: [], startedAt: undefined }
      : { ...t, pending: [] },
  );
}

/**
 * Files changed by the task that also have uncommitted changes in the user's tree: merging
 * would mix them, so it is blocked.
 */
export function mergeClash(taskFiles: readonly string[], dirty: readonly string[]): string[] {
  const d = new Set(dirty.map((f) => f.replace(/\\/g, '/')));
  return taskFiles.map((f) => f.replace(/\\/g, '/')).filter((f) => d.has(f));
}
