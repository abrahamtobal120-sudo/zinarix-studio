import './run.css';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { confirmDialog } from '../confirm';
import { pressable } from '../a11y';
import { t, type Key } from '../i18n';
import { api, attachToChat, getState, openFile, setState, toast, useStore } from '../store';
import { fileIcon } from './icons';
import { openRunTerminal, runInTerminal, showTerminal, terminalContext } from './Terminal';
import { Icon, type IconName } from './Icon';
import { parseTasksJson } from '../../shared/vscodeTasks';

export interface RunTask {
  /** Short name shown on the row ("dev", "make build", "docker compose up"). */
  label: string;
  /** Exact shell command sent to the terminal. */
  command: string;
  /** Config file the task came from (workspace-relative). */
  file: string;
  /** Lower runs first when "Detect & run" picks automatically. */
  priority: number;
  /** What the command really runs, when it is an alias (the body of an npm script). */
  detail?: string;
}

/** Config files worth opening when reviewing how a project runs. */
const CONFIG_NAMES = new Set([
  'package.json',
  'makefile',
  'gnumakefile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'dockerfile',
  'cargo.toml',
  'go.mod',
  'manage.py',
  'main.py',
  'app.py',
  'pyproject.toml',
  'requirements.txt',
  'gradlew',
  'pom.xml',
  'cmakelists.txt',
  'deno.json',
  'deno.jsonc',
  'index.html',
  'index.js',
  'server.js',
  'main.js',
  'app.js',
  'pubspec.yaml',
  'index.php',
]);

/** Config files matched by extension rather than by name (a .csproj can be called anything). */
const CONFIG_EXT = /\.csproj$/i;

/** Script/target names that run without extra input; anything else could inject into the shell. */
const SAFE_NAME = /^[\w:.-]+$/;
/** Folders safe to interpolate inside "cd \"…\" &&" (no quotes, $, backticks…). */
const SAFE_DIR = /^[\w@+. /-]*$/;

const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');
const nameOf = (path: string) => path.split('/').pop() ?? path;
const depthOf = (path: string) => path.split('/').length - 1;

/** Wraps a command so it runs inside the file's folder (the terminal opens at the root). */
function inDir(dir: string, cmd: string): string | null {
  if (!dir) return cmd;
  if (!SAFE_DIR.test(dir)) return null;
  return `cd "${dir}" && ${cmd}`;
}

/** npm / pnpm / yarn / bun, decided by the lockfile next to (or above) the package.json. */
function packageManager(dir: string, all: Set<string>): string {
  const near = (name: string) => all.has(dir ? `${dir}/${name}` : name) || all.has(name);
  if (near('pnpm-lock.yaml')) return 'pnpm';
  if (near('yarn.lock')) return 'yarn';
  if (near('bun.lockb') || near('bun.lock')) return 'bun';
  return 'npm';
}

function scriptPriority(name: string): number {
  if (name === 'dev') return 0;
  if (name === 'start') return 1;
  if (/^(serve|preview|watch)$/.test(name)) return 2;
  if (name === 'build') return 5;
  if (name === 'test') return 6;
  return 8;
}

async function readText(path: string): Promise<string | null> {
  try {
    const f = await api().workspace.readFile(path);
    return f.binary || f.tooLarge ? null : f.content;
  } catch {
    return null;
  }
}

async function tasksFor(path: string, all: Set<string>): Promise<RunTask[]> {
  const dir = dirOf(path);
  const name = nameOf(path).toLowerCase();
  const extra = depthOf(path) * 2; // root configs win over nested ones
  const add = (label: string, cmd: string, priority: number, detail?: string): RunTask | null => {
    const command = inDir(dir, cmd);
    return command ? { label, command, file: path, priority: priority + extra, detail } : null;
  };

  if (name === 'package.json') {
    const text = await readText(path);
    if (!text) return [];
    let scripts: Record<string, unknown> = {};
    try {
      scripts = (JSON.parse(text) as { scripts?: Record<string, unknown> }).scripts ?? {};
    } catch {
      return [];
    }
    const pm = packageManager(dir, all);
    return Object.keys(scripts)
      .filter((s) => SAFE_NAME.test(s))
      .map((s) => {
        const body = scripts[s];
        return add(
          `${pm} run ${s}`,
          `${pm} run ${s}`,
          scriptPriority(s),
          typeof body === 'string' ? body : undefined,
        );
      })
      .filter((x): x is RunTask => x !== null);
  }

  if (name === 'makefile' || name === 'gnumakefile') {
    const text = await readText(path);
    if (!text) return [];
    const targets: string[] = [];
    for (const m of text.matchAll(/^([A-Za-z0-9][\w.-]*)\s*:(?!=)/gm)) {
      const target = m[1]!;
      if (SAFE_NAME.test(target) && !targets.includes(target)) targets.push(target);
      if (targets.length >= 10) break;
    }
    return targets
      .map((target) =>
        add(
          `make ${target}`,
          `make ${target}`,
          /^(run|dev|start|serve)$/.test(target) ? 1 : target === 'all' ? 4 : 7,
        ),
      )
      .filter((x): x is RunTask => x !== null);
  }

  if (/^(docker-)?compose\.ya?ml$/.test(name))
    return [add('docker compose up', 'docker compose up', 3)].filter(
      (x): x is RunTask => x !== null,
    );
  if (name === 'dockerfile')
    return [add('docker build', 'docker build -t app .', 7)].filter(
      (x): x is RunTask => x !== null,
    );
  if (name === 'cargo.toml')
    return [add('cargo run', 'cargo run', 1)].filter((x): x is RunTask => x !== null);
  if (name === 'go.mod')
    return [add('go run .', 'go run .', 1)].filter((x): x is RunTask => x !== null);
  if (name === 'manage.py')
    return [add('python manage.py runserver', 'python manage.py runserver', 1)].filter(
      (x): x is RunTask => x !== null,
    );
  if (name === 'main.py' || name === 'app.py')
    return [add(`python ${name}`, `python ${nameOf(path)}`, 2)].filter(
      (x): x is RunTask => x !== null,
    );
  if (name === 'requirements.txt')
    return [add('pip install -r requirements.txt', 'pip install -r requirements.txt', 9)].filter(
      (x): x is RunTask => x !== null,
    );
  if (name === 'gradlew')
    return [add('./gradlew run', './gradlew run', 4)].filter((x): x is RunTask => x !== null);
  if (name === 'pom.xml')
    return [add('mvn package', 'mvn package', 6)].filter((x): x is RunTask => x !== null);
  if (name === 'cmakelists.txt')
    return [add('cmake build', 'cmake -B build && cmake --build build', 6)].filter(
      (x): x is RunTask => x !== null,
    );
  if (name === 'deno.json' || name === 'deno.jsonc') {
    const text = await readText(path);
    if (!text) return [];
    let tasks: Record<string, unknown> = {};
    try {
      tasks = (JSON.parse(text) as { tasks?: Record<string, unknown> }).tasks ?? {};
    } catch {
      return []; // jsonc with comments: skip rather than mis-parse
    }
    return Object.keys(tasks)
      .filter((s) => SAFE_NAME.test(s))
      .map((s) => {
        const body = tasks[s];
        const cmd =
          typeof body === 'string'
            ? body
            : typeof (body as { command?: unknown } | null)?.command === 'string'
              ? (body as { command: string }).command
              : undefined;
        return add(`deno task ${s}`, `deno task ${s}`, scriptPriority(s), cmd);
      })
      .filter((x): x is RunTask => x !== null);
  }
  // A Node entry file without a package.json next to it (with one, its scripts say how to run).
  if (
    /^(index|server|main|app)\.js$/.test(name) &&
    depthOf(path) <= 1 &&
    !/^(dist|build|out|public|static|vendor|assets)\//.test(path) &&
    !all.has(dir ? `${dir}/package.json` : 'package.json')
  )
    return [add(`node ${name}`, `node ${nameOf(path)}`, name === 'server.js' ? 2 : 3)].filter(
      (x): x is RunTask => x !== null,
    );
  if (CONFIG_EXT.test(name))
    return [add('dotnet run', 'dotnet run', 2)].filter((x): x is RunTask => x !== null);
  if (name === 'pubspec.yaml')
    return [add('flutter run', 'flutter run', 2)].filter((x): x is RunTask => x !== null);
  if (name === 'index.php')
    return [add('php -S localhost:8000', 'php -S localhost:8000', 4)].filter(
      (x): x is RunTask => x !== null,
    );
  // A plain static site: only when nothing else in the repo says how to run it.
  if (name === 'index.html' && ![...all].some((f) => nameOf(f) === 'package.json'))
    return [add('python3 -m http.server 8000', 'python3 -m http.server 8000', 5)].filter(
      (x): x is RunTask => x !== null,
    );
  return [];
}

const VSCODE_TASKS = '.vscode/tasks.json';

function platformName(): 'windows' | 'osx' | 'linux' {
  const p = navigator.platform.toLowerCase();
  return p.includes('win') ? 'windows' : p.includes('mac') ? 'osx' : 'linux';
}

/** VS Code tasks of the workspace (only those that can run here). */
async function vscodeTasks(all: Set<string>): Promise<RunTask[]> {
  if (!all.has(VSCODE_TASKS)) return [];
  const text = await readText(VSCODE_TASKS);
  const root = getState().workspace?.root;
  if (!text || !root) return [];
  const active = getState().active;
  const tasks = parseTasksJson(text, {
    root,
    file: active && all.has(active) ? active : undefined,
    platform: platformName(),
    packageManager: packageManager('', all),
  });
  return tasks
    .filter((x) => !x.problem && x.command)
    .map((x) => {
      const notes = [
        x.dependsOn.length ? t('taskDepends', { list: x.dependsOn.join(', ') }) : '',
        x.background ? t('taskBackground') : '',
      ].filter(Boolean);
      return {
        label: `task: ${x.label}`,
        command: x.command,
        file: VSCODE_TASKS,
        // The default build task first, then the other build / test tasks.
        priority:
          x.isDefault && x.group === 'build'
            ? 0.5
            : x.group === 'build'
              ? 3
              : x.group === 'test'
                ? 6
                : 4,
        ...(notes.length ? { detail: `${x.command} (${notes.join(' · ')})` } : {}),
      };
    });
}

export interface Detection {
  tasks: RunTask[];
  files: string[];
}

/** Config files of the workspace, shallowest first. */
function configsOf(files: string[]): string[] {
  return files
    .filter((f) => CONFIG_NAMES.has(nameOf(f).toLowerCase()) || CONFIG_EXT.test(f))
    .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
}

/** Configs whose content (not only their presence) decides the tasks. */
const READ_CONFIGS = /^(package\.json|(gnu)?makefile|deno\.jsonc?)$/;

/**
 * Cheap fingerprint of what detection depends on (which config files exist and the content of
 * those it reads), to skip a rescan when a save touched some other file.
 */
async function configFingerprint(): Promise<string> {
  const listed = await api().workspace.listFiles();
  const configs = configsOf(listed).slice(0, 40);
  const parts: string[] = [];
  if (listed.includes(VSCODE_TASKS)) parts.push(VSCODE_TASKS, (await readText(VSCODE_TASKS)) ?? '');
  for (const f of configs)
    parts.push(f, READ_CONFIGS.test(nameOf(f).toLowerCase()) ? ((await readText(f)) ?? '') : '');
  return parts.join('\0');
}

/** Scans the workspace for run configs and builds the list of runnable commands. */
export async function detectRunTasks(): Promise<Detection> {
  const files = await api().workspace.listFiles();
  const all = new Set(files);
  const configs = configsOf(files);
  const tasks: RunTask[] = [];
  for (const f of configs.slice(0, 40)) tasks.push(...(await tasksFor(f, all)));
  tasks.push(...(await vscodeTasks(all)));
  tasks.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  return { tasks, files: all.has(VSCODE_TASKS) ? [VSCODE_TASKS, ...configs] : configs };
}

/** The command as the user should see it before running: "npm run dev → vite --host". */
export function describeTask(task: RunTask): string {
  return task.detail ? `${task.command} → ${task.detail}` : task.command;
}

const CONFIRMED_KEY = 'zs.runConfirmed';

/** Workspaces where "Detect & run" was already confirmed once (the choice is remembered). */
function confirmedRoots(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CONFIRMED_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberConfirmed(root: string): void {
  try {
    localStorage.setItem(
      CONFIRMED_KEY,
      JSON.stringify([...confirmedRoots().filter((r) => r !== root), root].slice(-200)),
    );
  } catch {
    // storage unavailable: it will ask again next time
  }
}

// ---------------- runs: started from here, followed in their own terminal ----------------

/** How a run is going. 'sent': typed into a terminal we cannot follow (no exit code). */
export type RunStatus = 'starting' | 'running' | 'ok' | 'failed' | 'stopped' | 'sent';

export interface RunRecord {
  id: number;
  task: RunTask;
  /** Workspace the run belongs to. */
  root: string;
  status: RunStatus;
  code?: number;
  startedAt: number;
  endedAt?: number;
  /** Terminal session running it (while that session is open). */
  termId?: number;
  /** The shell reports the exit code (see wrapCommand); false: only Stop ends it. */
  tracked?: boolean;
  /** Loaded from the history of an earlier session (no terminal, no live state). */
  old?: boolean;
}

type ShellKind = 'pwsh' | 'cmd' | 'posix' | 'fish' | 'unknown';

/** The shell family of a terminal profile name ("PowerShell 7", "Git Bash", "zsh"…). */
function shellKind(name: string): ShellKind {
  if (/powershell/i.test(name)) return 'pwsh';
  if (/\bcmd\b/i.test(name)) return 'cmd';
  if (/fish/i.test(name)) return 'fish';
  if (/bash|zsh|ksh|dash|wsl|msys|cygwin|^sh$/i.test(name)) return 'posix';
  return 'unknown';
}

/** Printed by the shell when the command ends (ASCII so every code page shows it). */
const END_MARK = /\[Zinarix\] Terminado\. Codigo de salida: (-?\d+)/;
const END_TEXT = '[Zinarix] Terminado. Codigo de salida:';

/**
 * The command plus a line that prints its exit code when it ends, in the syntax of the shell.
 * The echoed input never matches END_MARK: the code there is still a variable ($?, %errorlevel%).
 */
function wrapCommand(cmd: string, kind: ShellKind): string {
  switch (kind) {
    case 'pwsh':
      return `${cmd}; Write-Host "${END_TEXT} $(if ($?) {0} elseif ($LASTEXITCODE) {$LASTEXITCODE} else {1})"`;
    case 'cmd':
      // %^errorlevel% survives the parse of the typed line; `call` expands it once the command ran.
      return `${cmd} & call echo ${END_TEXT} %^errorlevel%`;
    case 'posix':
      return `${cmd}; echo "${END_TEXT} $?"`;
    case 'fish':
      return `${cmd}; echo "${END_TEXT} $status"`;
    default:
      return cmd;
  }
}

const ANSI =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|\r/g;

let runs: RunRecord[] = [];
const runListeners = new Set<() => void>();
/** Recent output (escape codes stripped) of the terminals running something from here. */
const tails = new Map<number, string>();
const kinds = new Map<number, ShellKind>();
/** Terminals that printed something (their shell is up and reading input). */
const talked = new Set<number>();
/** cmd terminals told to stop: answer its "Terminate batch job (Y/N)?" question. */
const stoppingCmd = new Set<number>();
let listening = false;
let lastId = Date.now();

function setRuns(next: RunRecord[]): void {
  runs = next;
  for (const l of runListeners) l();
}

function patchRun(id: number, patch: Partial<RunRecord>): void {
  setRuns(runs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const r = runs.find((x) => x.id === id);
  if (r && !isLive(r)) saveHistory(r.root);
}

export const isLive = (r: RunRecord): boolean => r.status === 'starting' || r.status === 'running';

/** Runs of every workspace, newest first. */
export function useRuns(): RunRecord[] {
  return useSyncExternalStore(
    (l) => {
      runListeners.add(l);
      return () => runListeners.delete(l);
    },
    () => runs,
  );
}

const HISTORY_KEY = 'zs.runHistory:';
const HISTORY_MAX = 8;

function saveHistory(root: string): void {
  try {
    const done = runs
      .filter((r) => r.root === root && !isLive(r))
      .slice(0, HISTORY_MAX)
      .map(({ termId: _t, old: _o, ...r }) => r);
    localStorage.setItem(HISTORY_KEY + root, JSON.stringify(done));
  } catch {
    // storage unavailable: the history lasts until the app closes
  }
}

/** Adds the saved history of a workspace (once) to the list. */
function loadHistory(root: string): void {
  if (runs.some((r) => r.root === root)) return;
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY + root) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return;
    const old = (raw as RunRecord[])
      .filter((r) => r && typeof r.id === 'number' && r.task && typeof r.task.command === 'string')
      .map((r) => ({ ...r, root, old: true }));
    if (old.length) setRuns([...runs, ...old]);
  } catch {
    // corrupt or unavailable: start with an empty history
  }
}

function clearHistory(root: string): void {
  setRuns(runs.filter((r) => r.root !== root || isLive(r)));
  try {
    localStorage.removeItem(HISTORY_KEY + root);
  } catch {
    // nothing to clear
  }
}

function listen(): void {
  if (listening) return;
  listening = true;
  api().on((ev) => {
    if (ev.type === 'term:data') {
      talked.add(ev.id);
      if (!kinds.has(ev.id)) return;
      const tail = ((tails.get(ev.id) ?? '') + ev.data.replace(ANSI, '')).slice(-4000);
      if (stoppingCmd.has(ev.id)) {
        const ask = /\(([A-Z])\/[A-Z]\)\?\s*$/.exec(tail);
        if (ask) {
          stoppingCmd.delete(ev.id);
          void api().terminal.write(ev.id, `${ask[1]}\r`);
        }
      }
      const m = END_MARK.exec(tail);
      tails.set(ev.id, m ? tail.slice(m.index + m[0].length) : tail);
      if (!m) return;
      const run = runs.find((r) => r.termId === ev.id && isLive(r));
      if (!run) return;
      const code = Number(m[1]);
      patchRun(run.id, { status: code === 0 ? 'ok' : 'failed', code, endedAt: Date.now() });
    }
    if (ev.type === 'term:exit') {
      kinds.delete(ev.id);
      tails.delete(ev.id);
      talked.delete(ev.id);
      stoppingCmd.delete(ev.id);
      for (const r of runs.filter((x) => x.termId === ev.id)) {
        patchRun(
          r.id,
          isLive(r)
            ? { status: 'stopped', endedAt: Date.now(), termId: undefined }
            : { termId: undefined },
        );
      }
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) return false;
    await sleep(80);
  }
  return true;
}

/** Starts a task in a terminal of its own (or `reuse`, the terminal of the run it restarts). */
async function startRun(task: RunTask, reuse?: number): Promise<void> {
  listen();
  const root = getState().workspace?.root ?? '';
  // Running the same command again: reuse the terminal of its last run if nothing runs there.
  if (reuse === undefined) {
    const busyTerms = new Set(runs.filter(isLive).map((r) => r.termId));
    reuse = runs.find(
      (r) =>
        r.root === root &&
        r.task.command === task.command &&
        r.termId !== undefined &&
        kinds.has(r.termId) &&
        !busyTerms.has(r.termId),
    )?.termId;
  }
  const rec: RunRecord = { id: ++lastId, task, root, status: 'starting', startedAt: Date.now() };
  setRuns([rec, ...runs]);
  setState({ panelOpen: true, panelView: 'terminal' });
  let term: { id: number; kind: ShellKind } | null =
    reuse !== undefined && kinds.has(reuse) ? { id: reuse, kind: kinds.get(reuse)! } : null;
  if (!term && (await waitFor(() => openRunTerminal !== null, 3000)) && openRunTerminal) {
    const opened = await openRunTerminal().catch(() => null);
    if (opened) term = { id: opened.id, kind: shellKind(opened.shell) };
  }
  if (!term) {
    // No terminal we can follow: type it into the panel's terminal, as before.
    await runInTerminal(task.command);
    patchRun(rec.id, { status: 'sent', endedAt: Date.now() });
    toast(t('runStarted', { cmd: task.command }));
    return;
  }
  const { id, kind } = term;
  // A shell that just opened: wait for its prompt so the typed command is not lost.
  await waitFor(() => talked.has(id), 4000);
  if (term.id !== reuse) await sleep(150);
  kinds.set(id, kind);
  tails.set(id, '');
  showTerminal(id);
  try {
    await api().terminal.write(id, wrapCommand(task.command, kind) + '\r');
  } catch (e) {
    patchRun(rec.id, { status: 'failed', endedAt: Date.now() });
    toast(String((e as Error).message ?? e));
    return;
  }
  // Superseded runs in the same terminal (a restart) are not live any more.
  setRuns(
    runs.map((r) =>
      r.id === rec.id
        ? {
            ...r,
            status: 'running',
            termId: id,
            tracked: kind !== 'unknown',
            startedAt: Date.now(),
          }
        : r,
    ),
  );
  toast(t('runStarted', { cmd: task.command }));
}

/** Stops a run: Ctrl+C in its terminal (the terminal stays open with the output). */
export function stopRun(run: RunRecord): void {
  if (!isLive(run)) return;
  if (run.termId !== undefined) {
    if (kinds.get(run.termId) === 'cmd') {
      stoppingCmd.add(run.termId);
      const id = run.termId;
      setTimeout(() => stoppingCmd.delete(id), 4000);
    }
    void api().terminal.write(run.termId, '\x03');
  }
  patchRun(run.id, { status: 'stopped', endedAt: Date.now() });
}

/** Stops a run (when it still runs) and starts it again in the same terminal. */
export function restartRun(run: RunRecord): void {
  const live = isLive(run);
  stopRun(run);
  const term = run.termId;
  setTimeout(() => void startRun(run.task, term), live ? 900 : 0);
}

/** Opens the terminal panel and runs the command there, following it in the Run panel. */
export function runTask(task: RunTask): void {
  void startRun(task);
}

/** The run of this task still going in the workspace, if any. */
function liveRunOf(task: RunTask, list: RunRecord[], root: string): RunRecord | undefined {
  return list.find(
    (r) =>
      r.root === root && isLive(r) && r.task.command === task.command && r.task.file === task.file,
  );
}

// ---------------- presentation helpers ----------------

const taskKey = (task: RunTask) => `${task.file}\0${task.label}`;

/** The short name of a task: "dev" for "npm run dev", "build" for "make build". */
function taskName(task: RunTask): string {
  return task.label.replace(/^(npm|pnpm|yarn|bun) run |^deno task |^make |^task: /, '');
}

/** Icon and family of a task ("Script de npm", "Python", "Docker"…). */
function taskKind(task: RunTask): { icon: IconName; kind: string } {
  const l = task.label;
  const pm = /^(npm|pnpm|yarn|bun) run /.exec(l);
  if (pm) return { icon: 'package', kind: t('runKindScript', { pm: pm[1]! }) };
  if (l.startsWith('deno task')) return { icon: 'package', kind: 'Deno' };
  if (l.startsWith('task: ')) return { icon: 'settings', kind: t('runKindVscode') };
  if (l.startsWith('make ')) return { icon: 'wrench', kind: 'Makefile' };
  if (l.startsWith('docker')) return { icon: 'cube', kind: 'Docker' };
  if (l.startsWith('cargo')) return { icon: 'cpu', kind: 'Rust' };
  if (l.startsWith('go ')) return { icon: 'bolt', kind: 'Go' };
  if (/^python3? -m http\.server/.test(l)) return { icon: 'globe', kind: t('runKindStatic') };
  if (/^(python|pip)/.test(l)) return { icon: 'code', kind: 'Python' };
  if (l.startsWith('node ')) return { icon: 'code', kind: 'Node.js' };
  if (l.startsWith('dotnet')) return { icon: 'hash', kind: '.NET' };
  if (l.startsWith('flutter')) return { icon: 'smartphone', kind: 'Flutter' };
  if (l.startsWith('php')) return { icon: 'globe', kind: 'PHP' };
  if (/gradlew|mvn/.test(l)) return { icon: 'layers', kind: 'Java' };
  if (l.startsWith('cmake')) return { icon: 'wrench', kind: 'CMake' };
  return { icon: 'terminal', kind: t('runKindCommand') };
}

const SCRIPT_DESC: Record<string, Key> = {
  dev: 'runDescDev',
  start: 'runDescStart',
  serve: 'runDescStart',
  preview: 'runDescPreview',
  watch: 'runDescWatch',
  build: 'runDescBuild',
  all: 'runDescBuild',
  test: 'runDescTest',
  lint: 'runDescLint',
  format: 'runDescFormat',
  typecheck: 'runDescTypecheck',
};

/** One plain line on what a task does, when the name is a common one. */
function taskDesc(task: RunTask): string | null {
  const name = taskName(task);
  if (SCRIPT_DESC[name]) return t(SCRIPT_DESC[name]!);
  if (/^(cargo|go) run|^python manage\.py runserver|^(dotnet|flutter) run|^node /.test(task.label))
    return t('runDescStart');
  if (/http\.server|php -S/.test(task.label)) return t('runDescStatic');
  if (task.label.startsWith('docker compose')) return t('runDescCompose');
  if (task.label.startsWith('pip install')) return t('runDescInstall');
  return null;
}

/** 0:42, 12:05, 1:02:09 */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function ago(at: number): string {
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return t('runJustNow');
  if (min < 60) return t('runAgo', { time: `${min} min` });
  const h = Math.floor(min / 60);
  if (h < 24) return t('runAgo', { time: `${h} h` });
  return t('runAgo', { time: `${Math.floor(h / 24)} d` });
}

function statusText(r: RunRecord, now: number): string {
  const time = clock((r.endedAt ?? now) - r.startedAt);
  switch (r.status) {
    case 'starting':
      return t('runStatusStarting');
    case 'running':
      return t('runStatusRunning', { time });
    case 'ok':
      return t('runStatusOk', { time });
    case 'failed':
      return r.code === undefined
        ? t('runStatusError')
        : t('runStatusFailed', { code: r.code, time });
    case 'stopped':
      return t('runStatusStopped', { time });
    default:
      return t('runStatusSent');
  }
}

function StatusIcon({ status }: { status: RunStatus }) {
  if (status === 'starting' || status === 'running')
    return <span className="rp-spinner" aria-hidden="true" />;
  const icon: IconName =
    status === 'ok'
      ? 'check'
      : status === 'failed'
        ? 'x'
        : status === 'stopped'
          ? 'stop'
          : 'terminal';
  return <Icon name={icon} size={13} />;
}

/** Attaches the run's terminal output to the chat, asking what went wrong. */
function askAiAboutRun(run: RunRecord): void {
  const ctx = run.termId !== undefined ? terminalContext(run.termId, 'session') : null;
  attachToChat({
    source: `run:${run.id}`,
    content: `${t('runFixPrompt', { cmd: run.task.command, code: run.code ?? '?' })}\n\n${ctx?.content ?? t('runNoOutput')}`,
  });
  toast(t('runAttached'));
}

function askAiHowToRun(files: string[]): void {
  const listed = files.length ? files.join('\n') : t('runNoConfigs');
  attachToChat({ source: 'run:help', content: `${t('runHelpPrompt')}\n\n${listed}` });
  toast(t('runAttached'));
}

const SELECTED_KEY = 'zs.runSelected:';

function savedSelection(root: string): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY + root);
  } catch {
    return null;
  }
}

function saveSelection(root: string, key: string): void {
  try {
    localStorage.setItem(SELECTED_KEY + root, key);
  } catch {
    // storage unavailable: the suggested one is picked next time
  }
}

const TASKS_SHOWN = 8;

// ---------------- the panel ----------------

/** The latest run: what it runs, how it is going and what can be done with it. */
function RunStatusCard({ run, now }: { run: RunRecord; now: number }) {
  const live = isLive(run);
  const { icon } = taskKind(run.task);
  return (
    <div className={`rp-status rp-st-${run.status}`} role="status" aria-live="polite">
      <div className="rp-status-head">
        <StatusIcon status={run.status} />
        <span className="rp-status-text">{statusText(run, now)}</span>
      </div>
      <div className="rp-status-task">
        <Icon name={icon} size={13} />
        <span className="rp-status-name">{taskName(run.task)}</span>
        <code className="rp-cmd" title={describeTask(run.task)}>
          {run.task.command}
        </code>
      </div>
      {run.status === 'running' && !run.tracked && <p className="rp-note">{t('runUntracked')}</p>}
      <div className="rp-status-actions">
        {live ? (
          <>
            <button className="rp-btn danger" title={t('runStopHint')} onClick={() => stopRun(run)}>
              <Icon name="stop" size={13} /> {t('runStop')}
            </button>
            <button className="rp-btn" title={t('runRestartHint')} onClick={() => restartRun(run)}>
              <Icon name="refresh" size={13} /> {t('runRestart')}
            </button>
          </>
        ) : (
          <button className="rp-btn" onClick={() => restartRun(run)}>
            <Icon name="play" size={13} /> {t('runRerun')}
          </button>
        )}
        {run.termId !== undefined && (
          <button
            className="rp-btn"
            onClick={() => {
              setState({ panelOpen: true, panelView: 'terminal' });
              showTerminal(run.termId!);
            }}
          >
            <Icon name="terminal" size={13} /> {t('runShowTerminal')}
          </button>
        )}
        {run.status === 'failed' && (
          <button className="rp-btn ai" onClick={() => askAiAboutRun(run)}>
            <Icon name="sparkle" size={13} /> {t('runFixWithAi')}
          </button>
        )}
      </div>
    </div>
  );
}

export function RunPanel() {
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const allRuns = useRuns();
  const [detection, setDetection] = useState<Detection | null>(null);
  const [busy, setBusy] = useState(false);
  const [allTasks, setAllTasks] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Fingerprint of the configs behind the current detection (see configFingerprint).
  const seen = useRef<string | null>(null);

  /** quiet: a background refresh that keeps the current list on screen (no "Detecting…"). */
  const detect = useCallback(async (quiet = false): Promise<Detection | null> => {
    if (!quiet) setBusy(true);
    try {
      const [d, fp] = await Promise.all([detectRunTasks(), configFingerprint().catch(() => null)]);
      seen.current = fp;
      setDetection(d);
      return d;
    } catch {
      if (!quiet) setDetection({ tasks: [], files: [] });
      return null;
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  useEffect(() => {
    setDetection(null);
    setAllTasks(false);
    seen.current = null;
    setSelected(workspace ? savedSelection(workspace.root) : null);
    if (workspace) {
      loadHistory(workspace.root);
      void detect();
    }
  }, [workspace, detect]);

  // File changes (every save): wait for a pause, and rescan only if a run config changed.
  useEffect(() => {
    if (!workspace || fsVersion === 0) return;
    let live = true;
    const timer = setTimeout(async () => {
      const fp = await configFingerprint().catch(() => null);
      if (live && fp !== null && fp !== seen.current) await detect(true);
    }, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [fsVersion, workspace, detect]);

  const root = workspace?.root ?? '';
  const runsHere = allRuns.filter((r) => r.root === root);
  const anyLive = runsHere.some(isLive);

  // The clock of a running command (and the "5 min ago" of the history).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), anyLive ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [anyLive]);

  if (!workspace) {
    return (
      <div className="run-panel">
        <div className="sidebar-title">
          <span>{t('runTitle')}</span>
        </div>
        <div className="rp-empty">
          <div className="rp-empty-icon">
            <Icon name="play" size={22} />
          </div>
          <h3>{t('runNoFolderTitle')}</h3>
          <p>{t('runNoFolderBody')}</p>
          <button className="primary" onClick={() => void api().workspace.openDialog()}>
            <Icon name="folder" size={14} /> {t('openFolder')}
          </button>
        </div>
      </div>
    );
  }

  const tasks = detection?.tasks ?? [];
  const files = detection?.files ?? [];
  const target = tasks.find((x) => taskKey(x) === selected) ?? tasks[0];
  const targetRun = target ? liveRunOf(target, runsHere, root) : undefined;
  const shownTasks = allTasks ? tasks : tasks.slice(0, TASKS_SHOWN);
  // The card shows the newest run of this session; the history lists the rest.
  const latest = runsHere.find((r) => !r.old);
  const history = runsHere.filter((r) => r !== latest).slice(0, HISTORY_MAX);

  const pick = (task: RunTask) => {
    setSelected(taskKey(task));
    saveSelection(root, taskKey(task));
  };

  const runTarget = async () => {
    if (!target) return;
    if (targetRun) return restartRun(targetRun);
    // The first time in each project, show what will really run (it may be someone else's repo).
    if (!confirmedRoots().includes(root)) {
      const ok = await confirmDialog(
        t('runConfirmFirst', { cmd: describeTask(target), file: target.file }),
        { okLabel: t('runRun') },
      );
      if (!ok) return;
      rememberConfirmed(root);
    }
    runTask(target);
  };

  const targetKind = target ? taskKind(target) : null;
  const targetDesc = target ? taskDesc(target) : null;

  return (
    <div className="run-panel rp">
      <div className="sidebar-title">
        <span>{t('runTitle')}</span>
        <span className="sidebar-actions">
          <button title={t('runRescan')} aria-label={t('runRescan')} onClick={() => void detect()}>
            <Icon name="refresh" size={14} />
          </button>
        </span>
      </div>
      <div className="rp-body">
        {busy && !detection && (
          <p className="rp-detecting">
            <span className="rp-spinner" aria-hidden="true" /> {t('runDetecting')}
          </p>
        )}

        {target && targetKind && (
          <div className="rp-hero">
            <div className="rp-hero-head">
              <span className="rp-hero-icon">
                <Icon name={targetKind.icon} size={18} />
              </span>
              <div className="rp-hero-titles">
                <span className="rp-hero-name">{taskName(target)}</span>
                <span className="rp-hero-kind">
                  {targetKind.kind}
                  {target === tasks[0] && <span className="rp-badge">{t('runSuggested')}</span>}
                </span>
              </div>
            </div>
            {targetDesc && <p className="rp-hero-desc">{targetDesc}</p>}
            <code className="rp-cmd block" title={describeTask(target)}>
              {describeTask(target)}
            </code>
            <button
              className="primary rp-go"
              disabled={busy && !detection}
              title={describeTask(target)}
              onClick={() => void runTarget()}
            >
              <Icon name={targetRun ? 'refresh' : 'play'} size={15} />{' '}
              {targetRun ? t('runRestart') : t('runPrimary')}
            </button>
            <p className="rp-hint">
              {t('runWhere')}{' '}
              <span className="rp-file" {...pressable(() => void openFile(target.file))}>
                {target.file}
              </span>
            </p>
          </div>
        )}

        {latest && <RunStatusCard run={latest} now={now} />}

        {!busy && detection && tasks.length === 0 && (
          <div className="rp-empty">
            <div className="rp-empty-icon">
              <Icon name="info" size={22} />
            </div>
            <h3>{t('runEmptyTitle')}</h3>
            <p>{t('runEmptyBody')}</p>
            <ol className="rp-steps">
              <li>{t('runEmptyStep1')}</li>
              <li>{t('runEmptyStep2')}</li>
              <li>{t('runEmptyStep3')}</li>
            </ol>
            <div className="rp-empty-actions">
              <button className="primary" onClick={() => askAiHowToRun(files)}>
                <Icon name="sparkle" size={14} /> {t('runAskAi')}
              </button>
              <button onClick={() => setState({ panelOpen: true, panelView: 'terminal' })}>
                <Icon name="terminal" size={14} /> {t('runOpenTerminal')}
              </button>
            </div>
          </div>
        )}

        {tasks.length > 1 && (
          <section className="rp-section">
            <h4 className="rp-section-title">{t('runTargets')}</h4>
            <p className="rp-section-help">{t('runTargetsHint')}</p>
            <div className="rp-list" role="listbox" aria-label={t('runTargets')}>
              {shownTasks.map((task, i) => {
                const { icon } = taskKind(task);
                const on = target === task;
                const live = liveRunOf(task, runsHere, root);
                return (
                  <div
                    key={taskKey(task)}
                    role="option"
                    aria-selected={on}
                    tabIndex={0}
                    className={`rp-target ${on ? 'on' : ''}`}
                    title={describeTask(task)}
                    onClick={() => pick(task)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(task);
                      }
                    }}
                  >
                    <span className="rp-target-icon">
                      <Icon name={icon} size={14} />
                    </span>
                    <span className="rp-target-text">
                      <span className="rp-target-name">
                        {taskName(task)}
                        {i === 0 && <span className="rp-badge">{t('runSuggested')}</span>}
                        {live && <span className="rp-live-dot" title={t('runStatusStarting')} />}
                      </span>
                      <code className="rp-cmd">{task.command}</code>
                    </span>
                    <button
                      className="rp-target-go"
                      title={`${t('runRun')}: ${describeTask(task)}`}
                      aria-label={`${t('runRun')}: ${describeTask(task)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        pick(task);
                        if (live) restartRun(live);
                        else runTask(task);
                      }}
                    >
                      <Icon name={live ? 'refresh' : 'play'} size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
            {tasks.length > TASKS_SHOWN && (
              <button className="link rp-more" onClick={() => setAllTasks((v) => !v)}>
                {allTasks ? t('runLess') : `${t('runMoreTasks')} (${tasks.length - TASKS_SHOWN})`}
              </button>
            )}
          </section>
        )}

        {history.length > 0 && (
          <section className="rp-section">
            <h4 className="rp-section-title">
              {t('runRecent')}
              <button className="link rp-clear" onClick={() => clearHistory(root)}>
                {t('runClearRecent')}
              </button>
            </h4>
            <div className="rp-list">
              {history.map((r) => (
                <div
                  key={r.id}
                  className={`rp-recent rp-st-${r.status}`}
                  title={describeTask(r.task)}
                >
                  <span className="rp-recent-icon">
                    <StatusIcon status={r.status} />
                  </span>
                  <span className="rp-target-text">
                    <span className="rp-target-name">{taskName(r.task)}</span>
                    <span className="rp-recent-meta">
                      {ago(r.startedAt)} · {statusText(r, now)}
                    </span>
                  </span>
                  {isLive(r) ? (
                    <button
                      className="rp-target-go"
                      title={t('runStop')}
                      aria-label={t('runStop')}
                      onClick={() => stopRun(r)}
                    >
                      <Icon name="stop" size={13} />
                    </button>
                  ) : (
                    <button
                      className="rp-target-go"
                      title={t('runRerun')}
                      aria-label={`${t('runRerun')}: ${r.task.command}`}
                      onClick={() => runTask(r.task)}
                    >
                      <Icon name="play" size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {files.length > 0 && (
          <details className="rp-files">
            <summary>
              {t('runFilesSeen')} ({files.length})
            </summary>
            {files.map((f) => (
              <div key={f} className="rp-file-row" title={f} {...pressable(() => void openFile(f))}>
                <span className="file-icon">{fileIcon(nameOf(f))}</span>
                <span className="rp-file-name">{f}</span>
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
