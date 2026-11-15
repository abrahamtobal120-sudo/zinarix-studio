import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isJsTestFile,
  isPyTestFile,
  namePattern,
  namesPattern,
  parseJestJson,
  parseJunitXml,
  parseTests,
  pytestNodeId,
  summarize,
  targetsOf,
  type TestEvent,
  type TestFramework,
  type TestItem,
  type TestResult,
  type TestRunRequest,
  type TestRunSummary,
  type TestDiscovery,
  type TestProject,
} from '../shared/testing.js';
import { findPython, which } from './debug/backend.js';
import { childEnv } from './env.js';

export type { TestDiscovery, TestEvent, TestProject, TestRunRequest } from '../shared/testing.js';

/** How to start the runner of a request (also used to debug a test). */
export interface TestCommand {
  command: string;
  args: string[];
  /** Absolute folder. */
  cwd: string;
  /** The JS file node runs (Vitest / Jest), to debug it through Node's inspector. */
  script?: string;
  /** Report written by the runner. */
  report: string;
}

const MAX_FILES = 3000;
const MAX_FILE_BYTES = 512 * 1024;
const OUTPUT_TAIL = 20_000;

const VITEST_CONFIG = /^vitest\.(config|workspace)\.[cm]?[jt]s$|^vite\.config\.[cm]?[jt]s$/;
const JEST_CONFIG = /^jest\.config\.[cm]?[jt]s(on)?$/;
const PYTEST_ROOT = new Set(['pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini']);

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const absOf = (root: string, rel: string) => (rel ? join(root, ...rel.split('/')) : root);

/** Last results of each folder (merged across partial runs), for the panel and the agent. */
const lastRuns = new Map<string, TestRunSummary>();
/** Folder where the last results of each workspace are kept between sessions (unset = memory only). */
let storeDir: string | undefined;
const MAX_STORED_RESULTS = 5000;

/** Keeps the last results on disk (in the app data), so they survive a restart. */
export function setTestResultsDir(dir: string): void {
  storeDir = dir;
}

function storeFile(root: string): string | undefined {
  if (!storeDir) return undefined;
  const key = createHash('sha256').update(root.replace(/\\/g, '/').toLowerCase()).digest('hex');
  return join(storeDir, `${key.slice(0, 24)}.json`);
}

function isSummary(v: unknown): v is TestRunSummary {
  const s = v as TestRunSummary | null;
  return Boolean(s && typeof s === 'object' && Array.isArray(s.results) && s.framework);
}

/** The merged results of the last test runs in a folder (undefined = never run). */
export function lastTestRun(root: string): TestRunSummary | undefined {
  return lastRuns.get(root);
}

/** Like lastTestRun, but also reads what an earlier session left on disk. */
export async function loadLastRun(root: string): Promise<TestRunSummary | undefined> {
  const mem = lastRuns.get(root);
  if (mem) return mem;
  const f = storeFile(root);
  if (!f) return undefined;
  try {
    const data = JSON.parse(await readFile(f, 'utf8')) as { root?: string; summary?: unknown };
    if (data.root !== root || !isSummary(data.summary)) return undefined;
    if (!lastRuns.has(root)) lastRuns.set(root, data.summary);
    return lastRuns.get(root);
  } catch {
    return undefined;
  }
}

/** Disk writes of each folder, one after another (a late write must not undo a newer one). */
const writes = new Map<string, Promise<void>>();

function queued(root: string, job: () => Promise<void>): Promise<void> {
  const next = (writes.get(root) ?? Promise.resolve()).then(job, job);
  writes.set(root, next);
  void next.finally(() => {
    if (writes.get(root) === next) writes.delete(root);
  });
  return next;
}

function persist(root: string, summary: TestRunSummary): Promise<void> {
  const f = storeFile(root);
  const dir = storeDir;
  if (!f || !dir) return Promise.resolve();
  // Over the limit, failures first so a huge suite never drops the ones that matter.
  const results =
    summary.results.length > MAX_STORED_RESULTS
      ? [...summary.results]
          .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'))
          .slice(0, MAX_STORED_RESULTS)
      : summary.results;
  return queued(root, async () => {
    try {
      await mkdir(dir, { recursive: true });
      const tmp = `${f}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmp, JSON.stringify({ root, summary: { ...summary, results } }));
      await rename(tmp, f);
    } catch {
      // best effort: the results stay in memory
    }
  });
}

/** Drops the in-memory copy only (as after a restart). For tests. */
export function dropCachedRun(root: string): void {
  lastRuns.delete(root);
}

/** Forgets the last results of a folder (memory and disk). */
export async function clearLastRun(root: string): Promise<void> {
  lastRuns.delete(root);
  const f = storeFile(root);
  if (f) await queued(root, () => rm(f, { force: true }).catch(() => undefined));
}

/** Folders from `dir` up to the root: "a/b" → ["a/b", "a", ""]. */
function upward(dir: string): string[] {
  const out = [dir];
  let d = dir;
  while (d) {
    d = dirOf(d);
    out.push(d);
  }
  return out;
}

/** The runner's entry script, looked up in node_modules from `cwd` to the root. */
function nodeRunner(root: string, cwd: string, framework: 'vitest' | 'jest'): string | null {
  const rel = framework === 'vitest' ? ['vitest', 'vitest.mjs'] : ['jest', 'bin', 'jest.js'];
  for (const d of upward(cwd)) {
    const p = join(absOf(root, d), 'node_modules', ...rel);
    if (existsSync(p)) return p;
  }
  return null;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function depsOf(pkg: Record<string, unknown> | null): Set<string> {
  const out = new Set<string>();
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const v = pkg?.[k];
    if (v && typeof v === 'object') for (const name of Object.keys(v)) out.add(name);
  }
  return out;
}

/**
 * Finds the test files of the project, which runner each one belongs to (the nearest folder
 * with its config or dependency) and the tests inside them.
 */
export async function discoverTests(root: string, files: string[]): Promise<TestDiscovery> {
  const all = new Set(files);
  const pkgCache = new Map<string, Promise<Record<string, unknown> | null>>();
  const pkg = (dir: string) => {
    const f = dir ? `${dir}/package.json` : 'package.json';
    if (!all.has(f)) return Promise.resolve(null);
    let p = pkgCache.get(f);
    if (!p) pkgCache.set(f, (p = readJson(absOf(root, f))));
    return p;
  };
  const configsIn = new Map<string, string[]>();
  for (const f of files) {
    const n = nameOf(f);
    if (VITEST_CONFIG.test(n) || JEST_CONFIG.test(n) || PYTEST_ROOT.has(n)) {
      const d = dirOf(f);
      configsIn.set(d, [...(configsIn.get(d) ?? []), n]);
    }
  }

  /** Nearest folder that says which JS runner to use. */
  const jsProject = async (
    file: string,
  ): Promise<{ framework: 'vitest' | 'jest'; cwd: string }> => {
    for (const d of upward(dirOf(file))) {
      const cfg = configsIn.get(d) ?? [];
      if (cfg.some((n) => /^vitest\./.test(n))) return { framework: 'vitest', cwd: d };
      if (cfg.some((n) => JEST_CONFIG.test(n))) return { framework: 'jest', cwd: d };
      const deps = depsOf(await pkg(d));
      if (deps.has('vitest')) return { framework: 'vitest', cwd: d };
      if (deps.has('jest')) return { framework: 'jest', cwd: d };
      if (cfg.some((n) => /^vite\.config/.test(n)) && deps.size)
        return { framework: 'vitest', cwd: d };
    }
    return {
      framework:
        nodeRunner(root, '', 'jest') && !nodeRunner(root, '', 'vitest') ? 'jest' : 'vitest',
      cwd: '',
    };
  };
  const pyProject = (file: string): string => {
    for (const d of upward(dirOf(file)))
      if ((configsIn.get(d) ?? []).some((n) => PYTEST_ROOT.has(n))) return d;
    return '';
  };

  const groups = new Map<string, TestProject>();
  const add = (framework: TestFramework, cwd: string, file: string) => {
    const key = `${framework}:${cwd}`;
    const g = groups.get(key) ?? { framework, cwd, files: [] };
    g.files.push(file);
    groups.set(key, g);
  };
  const tests = files
    .filter((f) => !f.includes('node_modules/') && (isJsTestFile(f) || isPyTestFile(f)))
    .slice(0, MAX_FILES);
  for (const f of tests) {
    if (isPyTestFile(f)) add('pytest', pyProject(f), f);
    else {
      const p = await jsProject(f);
      add(p.framework, p.cwd, f);
    }
  }

  const python = [...groups.values()].some((g) => g.framework === 'pytest') ? findPython() : null;
  for (const g of groups.values()) {
    if (g.framework === 'pytest') {
      if (!python) g.problem = 'Python no está en el PATH.';
    } else if (!nodeRunner(root, g.cwd, g.framework)) {
      g.problem = `No encontré ${g.framework} en node_modules. Instala las dependencias (npm/pnpm install).`;
    } else if (!which('node')) g.problem = 'Node.js no está en el PATH.';
  }

  const items: TestItem[] = [];
  for (const f of tests) {
    try {
      const abs = absOf(root, f);
      if ((await stat(abs)).size > MAX_FILE_BYTES) continue;
      items.push(...parseTests(f, await readFile(abs, 'utf8')));
    } catch {
      // unreadable: listed without tests
    }
  }
  const projects = [...groups.values()].sort(
    (a, b) => a.cwd.localeCompare(b.cwd) || a.framework.localeCompare(b.framework),
  );
  return { projects, items };
}

/** Path relative to the runner's folder. */
function fromCwd(cwd: string, file: string): string {
  return cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The exact command a request runs (no shell: arguments are never interpreted). */
export function testCommand(root: string, req: TestRunRequest, report: string): TestCommand {
  const cwd = absOf(root, req.cwd);
  const items = targetsOf(req);
  const files = items.length ? [...new Set(items.map((i) => i.file))] : (req.files ?? []);
  if (req.framework === 'pytest') {
    if (req.related?.length) throw new Error('Pytest no sabe qué pruebas usan un archivo.');
    const py = findPython();
    if (!py) throw new Error('Python no está en el PATH.');
    const targets = items.length
      ? items.map((i) => pytestNodeId(i.file, i.fullName, req.cwd))
      : files.map((f) => fromCwd(req.cwd, f));
    return {
      command: py.cmd,
      args: [
        ...py.pre,
        '-m',
        'pytest',
        ...targets,
        '-o',
        'junit_family=xunit1',
        `--junitxml=${report}`,
        '-q',
      ],
      cwd,
      report,
    };
  }
  const script = nodeRunner(root, req.cwd, req.framework);
  if (!script)
    throw new Error(`No encontré ${req.framework} en node_modules. Instala las dependencias.`);
  const node = which('node');
  if (!node) throw new Error('Node.js no está en el PATH.');
  const pattern = items.length ? ['-t', namesPattern(items)] : [];
  const related = (req.related ?? []).map((f) => fromCwd(req.cwd, f));
  const rel = files.map((f) => fromCwd(req.cwd, f));
  const args =
    req.framework === 'vitest'
      ? [
          ...(related.length ? ['related', ...related, '--run'] : ['run', ...rel]),
          ...pattern,
          '--reporter=default',
          '--reporter=json',
          `--outputFile.json=${report}`,
          '--passWithNoTests',
        ]
      : [
          ...(related.length ? ['--findRelatedTests', ...related] : rel.map((f) => escapeRegex(f))),
          ...pattern,
          '--json',
          `--outputFile=${report}`,
          '--testLocationInResults',
          '--passWithNoTests',
        ];
  return { command: node, args: [script, ...args], cwd, script, report };
}

/** Whether a result belongs to what a request ran (the whole file, or only the items). */
export function coveredBy(req: TestRunRequest, r: TestResult): boolean {
  const py = req.framework === 'pytest';
  if (py !== isPyTestFile(r.file)) return false;
  // Which tests a "related" run reaches is only known from its results (see mergeRuns).
  if (req.related?.length) return false;
  const items = targetsOf(req);
  if (items.length)
    return items.some((item) => {
      if (r.file !== item.file) return false;
      if (!r.fullName) return true;
      if (py) {
        const name = r.fullName.replace(/\[[^\]]*\]$/, '');
        return (
          r.fullName === item.fullName ||
          name === item.fullName ||
          name.startsWith(item.fullName + '::')
        );
      }
      try {
        return new RegExp(namePattern(item)).test(r.fullName);
      } catch {
        return r.fullName === item.fullName;
      }
    });
  if (req.files?.length) return req.files.includes(r.file);
  return !req.cwd || r.file.startsWith(req.cwd + '/'); // the whole project
}

/** New results replace the old ones they cover. */
export function mergeRuns(
  prev: TestRunSummary | undefined,
  next: TestRunSummary,
  req: TestRunRequest,
): TestRunSummary {
  if (!prev) return next;
  // A related run reran whole files: those files' old results are replaced.
  const rerun = req.related?.length ? new Set(next.results.map((r) => r.file)) : null;
  const kept = prev.results.filter((r) => (rerun ? !rerun.has(r.file) : !coveredBy(req, r)));
  return {
    ...summarize(next.framework, next.cwd, [...kept, ...next.results], next.durationMs, next.error),
    finishedAt: next.finishedAt,
  };
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32')
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    }).on('error', () => child.kill());
  else child.kill('SIGTERM');
}

/** Runs tests for one window; one run at a time. */
export class TestManager {
  private child?: ChildProcess;
  private cancelled = false;

  constructor(private readonly emit: (ev: TestEvent) => void) {}

  get running(): boolean {
    return Boolean(this.child);
  }

  cancel(): void {
    this.cancelled = true;
    if (this.child) killTree(this.child);
  }

  async run(root: string, req: TestRunRequest): Promise<TestRunSummary> {
    if (this.child) throw new Error('Ya hay pruebas corriendo. Espera o cancélalas.');
    const report = join(
      tmpdir(),
      `zinarix-tests-${randomBytes(6).toString('hex')}.${req.framework === 'pytest' ? 'xml' : 'json'}`,
    );
    const cmd = testCommand(root, req, report);
    const started = Date.now();
    this.cancelled = false;
    const items = targetsOf(req);
    const label =
      (items.length === 1 ? items[0]!.fullName : '') ||
      (items.length > 1 ? `${items.length} pruebas` : '') ||
      req.related?.join(', ') ||
      req.files?.join(', ') ||
      req.cwd ||
      req.framework;
    this.emit({ kind: 'state', running: true, label });
    this.emit({ kind: 'output', text: `$ ${[cmd.command, ...cmd.args].map(quote).join(' ')}\n` });
    let tail = '';
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(cmd.command, cmd.args, {
        cwd: cmd.cwd,
        env: childEnv({
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          CI: process.env.CI ?? '',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;
      const out = (d: Buffer) => {
        const text = d.toString('utf8');
        tail = (tail + text).slice(-OUTPUT_TAIL);
        this.emit({ kind: 'output', text });
      };
      child.stdout!.on('data', out);
      child.stderr!.on('data', out);
      child.on('error', (e) => {
        tail += `\n${e.message}`;
        this.emit({ kind: 'output', text: `${e.message}\n` });
      });
      child.on('close', (c) => resolve(c));
    });
    this.child = undefined;
    let results: TestResult[] = [];
    let error: string | undefined;
    try {
      const text = await readFile(report, 'utf8');
      results = (
        req.framework === 'pytest' ? parseJunitXml(text, req.cwd, root) : parseJestJson(text, root)
      )
        // Tests left out by the name filter come back as skipped: they did not run.
        .filter((r) => !items.length || r.status !== 'skipped' || coveredBy(req, r));
    } catch {
      error = this.cancelled
        ? 'Cancelado.'
        : `El ejecutor terminó (código ${code ?? '?'}) sin dejar resultados.\n${tail.trim().split('\n').slice(-15).join('\n')}`;
    }
    await rm(report, { force: true }).catch(() => undefined);
    const summary = summarize(req.framework, req.cwd, results, Date.now() - started, error);
    const prev = await loadLastRun(root);
    const merged = error ? (prev ?? summary) : mergeRuns(prev, summary, req);
    if (!error) {
      lastRuns.set(root, merged);
      await persist(root, merged);
    }
    this.emit({ kind: 'done', summary, merged });
    this.emit({ kind: 'state', running: false });
    return summary;
  }
}

function quote(a: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`;
}
