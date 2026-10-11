import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import { api, openFile, setState, toast, useStore } from '../store';
import { fileIcon } from './icons';
import { runInTerminal } from './Terminal';
import { Icon } from './Icon';

export interface RunTask {
  /** Short name shown on the row ("dev", "make build", "docker compose up"). */
  label: string;
  /** Exact shell command sent to the terminal. */
  command: string;
  /** Config file the task came from (workspace-relative). */
  file: string;
  /** Lower runs first when "Detect & run" picks automatically. */
  priority: number;
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
]);

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
  const add = (label: string, cmd: string, priority: number): RunTask | null => {
    const command = inDir(dir, cmd);
    return command ? { label, command, file: path, priority: priority + extra } : null;
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
      .map((s) => add(`${pm} run ${s}`, `${pm} run ${s}`, scriptPriority(s)))
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
      .map((s) => add(`deno task ${s}`, `deno task ${s}`, scriptPriority(s)))
      .filter((x): x is RunTask => x !== null);
  }
  // A plain static site: only when nothing else in the repo says how to run it.
  if (name === 'index.html' && ![...all].some((f) => nameOf(f) === 'package.json'))
    return [add('python3 -m http.server 8000', 'python3 -m http.server 8000', 5)].filter(
      (x): x is RunTask => x !== null,
    );
  return [];
}

export interface Detection {
  tasks: RunTask[];
  files: string[];
}

/** Scans the workspace for run configs and builds the list of runnable commands. */
export async function detectRunTasks(): Promise<Detection> {
  const files = await api().workspace.listFiles();
  const all = new Set(files);
  const configs = files
    .filter((f) => CONFIG_NAMES.has(nameOf(f).toLowerCase()))
    .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
  const tasks: RunTask[] = [];
  for (const f of configs.slice(0, 40)) tasks.push(...(await tasksFor(f, all)));
  tasks.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  return { tasks, files: configs };
}

/** Opens the terminal panel and types the command into it. */
export function runTask(task: RunTask): void {
  setState({ panelOpen: true });
  setTimeout(() => void runInTerminal(task.command), 300);
  toast(t('runStarted', { cmd: task.command }));
}

const TASKS_SHOWN = 8;
const FILES_SHOWN = 8;

export function RunPanel() {
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [busy, setBusy] = useState(false);
  const [allTasks, setAllTasks] = useState(false);
  const [allFiles, setAllFiles] = useState(false);

  const detect = useCallback(async (): Promise<Detection | null> => {
    setBusy(true);
    try {
      const d = await detectRunTasks();
      setDetection(d);
      return d;
    } catch {
      setDetection({ tasks: [], files: [] });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setDetection(null);
    setAllTasks(false);
    setAllFiles(false);
    if (workspace) void detect();
  }, [workspace, fsVersion, detect]);

  if (!workspace) {
    return (
      <div className="sidebar-empty">
        <p>{t('noFolder')}</p>
        <button className="primary" onClick={() => void api().workspace.openDialog()}>
          {t('openFolder')}
        </button>
      </div>
    );
  }

  const detectAndRun = async () => {
    const d = detection ?? (await detect());
    const best = d?.tasks[0];
    if (best) runTask(best);
    else toast(t('runNone'));
  };

  const tasks = detection?.tasks ?? [];
  const files = detection?.files ?? [];
  const shownTasks = allTasks ? tasks : tasks.slice(0, TASKS_SHOWN);
  const shownFiles = allFiles ? files : files.slice(0, FILES_SHOWN);

  return (
    <div className="run-panel">
      <div className="sidebar-title">
        <span>{t('runTitle').toUpperCase()}</span>
        <span className="sidebar-actions">
          <button title={t('refresh')} onClick={() => void detect()}>
            <Icon name="refresh" size={14} />
          </button>
        </span>
      </div>
      <div className="run-body">
        <p className="dim small">{t('runHint')}</p>
        <button className="primary run-main" disabled={busy} onClick={() => void detectAndRun()}>
          <Icon name="play" size={14} /> {t('runAndRun')}
        </button>
        {busy && <p className="dim small">{t('runDetecting')}</p>}
        {!busy && detection && tasks.length === 0 && <p className="dim small">{t('runNone')}</p>}
        {tasks.length > 0 && (
          <>
            <div className="run-section">{t('runTasks')}</div>
            {shownTasks.map((task, i) => (
              <div key={`${task.file}:${task.label}`} className="run-row" title={task.command}>
                <button
                  className="run-go"
                  title={`${t('runRun')}: ${task.command}`}
                  onClick={() => runTask(task)}
                >
                  <Icon name="play" size={14} />
                </button>
                <span className="run-label" onClick={() => runTask(task)}>
                  {task.label}
                  {i === 0 && <span className="run-badge">{t('runSuggested')}</span>}
                </span>
                <span
                  className="run-file dim small"
                  title={task.file}
                  onClick={() => void openFile(task.file)}
                >
                  {task.file}
                </span>
              </div>
            ))}
            {tasks.length > TASKS_SHOWN && (
              <button className="link" onClick={() => setAllTasks((v) => !v)}>
                {allTasks ? t('runLess') : `${t('runMoreTasks')} (${tasks.length - TASKS_SHOWN})`}
              </button>
            )}
          </>
        )}
        {files.length > 0 && (
          <>
            <div className="run-section">{t('runFilesSeen')}</div>
            {shownFiles.map((f) => (
              <div key={f} className="run-row" title={f} onClick={() => void openFile(f)}>
                <span className="file-icon">{fileIcon(nameOf(f))}</span>
                <span className="run-label">{f}</span>
              </div>
            ))}
            {files.length > FILES_SHOWN && (
              <button className="link" onClick={() => setAllFiles((v) => !v)}>
                {allFiles ? t('runLess') : `${t('runMoreFiles')} (${files.length - FILES_SHOWN})`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
