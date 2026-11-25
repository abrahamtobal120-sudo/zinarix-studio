import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ToolDefinition } from '@omni/shared';
import type { AgentToolName } from './agentPolicy.js';
import { applyEdits, editNote, editSteps } from './editMatch.js';

/**
 * Fase 15 — the tools of the headless agent. Every path is confined to the run's folder
 * (no "..", no absolute paths elsewhere, no symlinks or junctions that lead out, never .git).
 */

export const TOOL_DEFS: Record<AgentToolName, ToolDefinition> = {
  list_files: {
    name: 'list_files',
    description:
      'List files and folders under a folder of the project (recursive, skips node_modules, .git, dist and build output).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder relative to the project root ("." = root).' },
        depth: { type: 'integer', description: 'How many levels to go down (default 3).' },
      },
    },
  },
  read_file: {
    name: 'read_file',
    description: 'Read a text file of the project. Lines are numbered.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', description: 'First line (1-based).' },
        limit: { type: 'integer', description: 'Number of lines (default 2000).' },
      },
      required: ['path'],
    },
  },
  search: {
    name: 'search',
    description:
      'Search the project files for a regular expression. Returns "path:line: text" for each match.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression.' },
        path: { type: 'string', description: 'Folder or file to search (default the root).' },
        ignore_case: { type: 'boolean' },
      },
      required: ['pattern'],
    },
  },
  write_file: {
    name: 'write_file',
    description: 'Create a file or replace all its content.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  edit_file: {
    name: 'edit_file',
    description:
      'Replace an exact piece of text in a file. old_string must appear exactly once unless replace_all is true. For several changes to the same file, pass them all in edits.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
        edits: {
          type: 'array',
          description:
            'Several replacements in this file in one call, applied in order; all or nothing. Use instead of old_string / new_string.',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
              replace_all: { type: 'boolean' },
            },
            required: ['old_string', 'new_string'],
          },
        },
      },
      required: ['path'],
    },
  },
  run_command: {
    name: 'run_command',
    description:
      'Run a shell command in the project folder (tests, builds, linters). No API keys or tokens are passed to it. Output is cut to the last 30,000 characters.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_seconds: { type: 'integer', description: 'Default 120, maximum 600.' },
      },
      required: ['command'],
    },
  },
};

export interface ToolOutcome {
  ok: boolean;
  content: string;
  /** Project-relative path written by write_file / edit_file. */
  changed?: string;
}

export interface ToolContext {
  /** Absolute project root. */
  root: string;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /**
   * Files (absolute paths) the model has read or written in this run. When given, a file
   * that exists cannot be edited or overwritten before it was read: models that guess the
   * contents of a file break it.
   */
  seen?: Set<string>;
}

function unread(ctx: ToolContext, a: Record<string, unknown>): ToolOutcome | undefined {
  if (!ctx.seen) return undefined;
  const abs = resolveInside(ctx.root, a.path);
  if (!existsSync(abs) || ctx.seen.has(abs)) return undefined;
  return {
    ok: false,
    content: `You have not read ${str(a.path)} yet. Call read_file on it first, then change it: old_string must be copied from the real file.`,
  };
}

function markSeen(ctx: ToolContext, a: Record<string, unknown>, out: ToolOutcome): ToolOutcome {
  if (out.ok) ctx.seen?.add(resolveInside(ctx.root, a.path));
  return out;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  '.venv',
  '__pycache__',
]);
const MAX_READ_BYTES = 512 * 1024;
const MAX_OUTPUT = 30_000;
const MAX_LIST = 800;
const MAX_MATCHES = 200;

export class ToolError extends Error {}

const posix = (p: string) => p.split(sep).join('/');

function inside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolves a model-given path inside the root. Rejects anything outside it, including a
 * symlink or junction (in the path or any existing parent) whose real target is outside,
 * and anything under .git.
 */
export function resolveInside(root: string, p: unknown): string {
  if (typeof p !== 'string' || !p.trim()) throw new ToolError('path is required');
  const realRoot = realpathSync(root);
  const abs = resolve(realRoot, p.trim());
  if (!inside(realRoot, abs)) throw new ToolError(`path is outside the project: ${p}`);
  // Walk up to the deepest part that exists and check where it really points.
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  if (existsSync(probe) && !inside(realRoot, realpathSync(probe)))
    throw new ToolError(`path leads outside the project (link or junction): ${p}`);
  const rel = posix(relative(realRoot, abs));
  if (rel === '.git' || rel.startsWith('.git/'))
    throw new ToolError('the .git folder is not accessible to the agent');
  return abs;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown, def: number, min: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : def;
  return Math.max(min, Math.min(max, n));
};

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Every file under the root (skipping build output), as project-relative paths. */
function allFiles(root: string, max: number): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (e.isFile()) out.push(posix(relative(root, p)));
    }
  };
  walk(root);
  return out;
}

const stem = (name: string) => name.replace(/\.[^.]*$/, '').toLowerCase();

/**
 * Files of the project whose name looks like a path that does not exist: models often guess a
 * path ("src/app.js") instead of listing the folder. Best matches first, at most five.
 */
export function similarFiles(root: string, wanted: string): string[] {
  const want = posix(wanted.trim()).replace(/^\.\//, '');
  const base = want.split('/').pop() ?? '';
  if (!base) return [];
  const wantStem = stem(base);
  const wantDir = want.includes('/') ? want.slice(0, want.lastIndexOf('/')).toLowerCase() : '';
  const scored: { path: string; score: number }[] = [];
  for (const path of allFiles(realpathSync(root), 5000)) {
    const name = path.split('/').pop()!;
    const s = stem(name);
    let score = 0;
    if (name.toLowerCase() === base.toLowerCase()) score = 100;
    else if (s === wantStem) score = 80;
    else if (
      wantStem.length >= 3 &&
      (s.includes(wantStem) || wantStem.includes(s)) &&
      s.length >= 3
    )
      score = 50;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')).toLowerCase() : '';
    // Same folder: the model had the place right and the name wrong.
    if (dir === wantDir) score += score ? 10 : 30;
    if (score) scored.push({ path, score });
  }
  scored.sort((x, y) => y.score - x.score || x.path.length - y.path.length);
  return scored.slice(0, 5).map((x) => x.path);
}

function notFound(root: string, p: string): ToolError {
  const near = similarFiles(root, p);
  return new ToolError(
    near.length
      ? `file not found: ${p}. Files that exist: ${near.join(', ')}`
      : `file not found: ${p}. Call list_files to see what exists.`,
  );
}

/**
 * A short map of the project for the start of a run, so the model does not have to guess
 * paths: folders and files up to `depth` levels, cut at `max` lines. Empty for an empty folder.
 */
export function projectTree(root: string, max = 150, depth = 3): string {
  const out = listFiles(realpathSync(root), { path: '.', depth }, max);
  return out.content === '(empty)' ? '' : out.content;
}

/** Build files of other ecosystems: with one of these the project has its own way to test. */
const MANIFESTS = [
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Makefile',
  'composer.json',
  'Gemfile',
  'deno.json',
];

/**
 * What the project can run, for the start of a run: the scripts of its package.json, or a
 * plain statement that it has no test setup. Without it small models answer "run the tests"
 * by inventing a package.json and installing a test runner. Empty when it cannot tell.
 */
export function projectCommands(root: string): string {
  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) {
    let scripts: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { scripts?: unknown };
      if (parsed.scripts && typeof parsed.scripts === 'object')
        scripts = parsed.scripts as Record<string, unknown>;
    } catch {
      return '';
    }
    const lines = Object.entries(scripts)
      .filter(([, v]) => typeof v === 'string')
      .slice(0, 20)
      .map(([k, v]) => `npm run ${k}: ${String(v).slice(0, 120)}`);
    return lines.length
      ? lines.join('\n')
      : 'package.json has no scripts: there is no test command. Do not add a test runner unless the task asks for one.';
  }
  if (MANIFESTS.some((m) => existsSync(join(root, m)))) return '';
  return 'This project has no package.json and no test runner. Do not create one or install packages unless the task asks for it; to check a change, read the code again or run the file itself.';
}

function listFiles(root: string, a: Record<string, unknown>, max = MAX_LIST): ToolOutcome {
  const base = resolveInside(root, str(a.path) || '.');
  const depth = int(a.depth, 3, 1, 10);
  const lines: string[] = [];
  let cut = false;
  const walk = (dir: string, level: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((x, y) => x.name.localeCompare(y.name));
    for (const e of entries) {
      if (lines.length >= max) {
        cut = true;
        return;
      }
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      const rel = posix(relative(root, join(dir, e.name)));
      if (e.isDirectory()) {
        lines.push(`${rel}/`);
        if (level < depth) walk(join(dir, e.name), level + 1);
      } else lines.push(rel);
    }
  };
  walk(base, 1);
  if (cut) lines.push(`… (cut at ${max} entries; list a sub-folder)`);
  return { ok: true, content: lines.join('\n') || '(empty)' };
}

function readFile(root: string, a: Record<string, unknown>): ToolOutcome {
  const abs = resolveInside(root, a.path);
  if (!existsSync(abs)) throw notFound(root, str(a.path));
  if (statSync(abs).isDirectory())
    throw new ToolError(`${str(a.path)} is a folder; use list_files`);
  const buf = readFileSync(abs);
  if (isBinary(buf)) throw new ToolError(`${str(a.path)} is a binary file`);
  const all = buf.subarray(0, MAX_READ_BYTES).toString('utf8').split(/\r?\n/);
  const offset = int(a.offset, 1, 1, Math.max(1, all.length));
  const limit = int(a.limit, 2000, 1, 5000);
  const slice = all.slice(offset - 1, offset - 1 + limit);
  const body = slice.map((l, i) => `${String(offset + i).padStart(5)}\t${l}`).join('\n');
  const more =
    offset - 1 + limit < all.length || buf.length > MAX_READ_BYTES
      ? `\n… (file continues; read again with offset ${offset + limit})`
      : '';
  return { ok: true, content: body + more };
}

function search(root: string, a: Record<string, unknown>): ToolOutcome {
  let re: RegExp;
  try {
    re = new RegExp(str(a.pattern), a.ignore_case === true ? 'i' : '');
  } catch (e) {
    throw new ToolError(`invalid regular expression: ${(e as Error).message}`);
  }
  const base = resolveInside(root, str(a.path) || '.');
  const hits: string[] = [];
  const scan = (file: string) => {
    let buf: Buffer;
    try {
      if (statSync(file).size > MAX_READ_BYTES) return;
      buf = readFileSync(file);
    } catch {
      return;
    }
    if (isBinary(buf)) return;
    const rel = posix(relative(root, file));
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < MAX_MATCHES; i++)
      if (re.test(lines[i]!)) hits.push(`${rel}:${i + 1}: ${lines[i]!.slice(0, 300)}`);
  };
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= MAX_MATCHES) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (e.isFile()) scan(p);
    }
  };
  if (statSync(base).isDirectory()) walk(base);
  else scan(base);
  if (hits.length >= MAX_MATCHES) hits.push(`… (first ${MAX_MATCHES} matches)`);
  return { ok: true, content: hits.join('\n') || 'No matches.' };
}

function writeFile(root: string, a: Record<string, unknown>): ToolOutcome {
  const abs = resolveInside(root, a.path);
  if (typeof a.content !== 'string') throw new ToolError('content is required');
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, a.content);
  const rel = posix(relative(realpathSync(root), abs));
  return { ok: true, content: `Wrote ${rel} (${a.content.length} characters).`, changed: rel };
}

function editFile(root: string, a: Record<string, unknown>): ToolOutcome {
  const abs = resolveInside(root, a.path);
  if (!existsSync(abs)) throw notFound(root, str(a.path));
  const steps = editSteps(a);
  if (typeof steps === 'string') throw new ToolError(steps);
  const text = readFileSync(abs, 'utf8');
  const res = applyEdits(text, steps);
  if (!res.ok)
    throw new ToolError(
      res.error.includes(' times;')
        ? `${res.error.replace(/\.$/, '')} (or set replace_all: true)`
        : res.error,
    );
  writeFileSync(abs, res.text);
  const rel = posix(relative(realpathSync(root), abs));
  return {
    ok: true,
    content: `Edited ${rel} (${res.count} replacement${res.count > 1 ? 's' : ''}${editNote(res.how)}).`,
    changed: rel,
  };
}

/** Environment variables that look like credentials are never passed to commands. */
const SECRET_ENV =
  /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_KEY|ACCESS_KEY|AUTH)(?:_|$)/i;

export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_ENV.test(k) || k.startsWith('OMNI_VAULT')) continue;
    out[k] = v;
  }
  return out;
}

export function tail(s: string, max = MAX_OUTPUT): string {
  return s.length > max ? `… (${s.length - max} characters cut)\n${s.slice(-max)}` : s;
}

/**
 * Shell a command line runs in: PowerShell on Windows (passing the program's real exit code
 * on, so a hook's exit 2 still blocks), $SHELL or /bin/sh elsewhere. Same as the desktop app.
 */
export function shellCommand(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32')
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `${command}
$zxOk = $?; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $zxOk) { exit 1 }`,
      ],
    };
  return { file: process.env.SHELL || '/bin/sh', args: ['-c', command] };
}

function runCommand(ctx: ToolContext, a: Record<string, unknown>): Promise<ToolOutcome> {
  const command = str(a.command).trim();
  if (!command) throw new ToolError('command is required');
  const timeout = int(a.timeout_seconds, 120, 1, 600) * 1000;
  return new Promise((done) => {
    const sh = shellCommand(command);
    const child = spawn(sh.file, sh.args, {
      cwd: ctx.root,
      env: cleanEnv(ctx.env ?? process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    const add = (b: Buffer) => {
      output += b.toString('utf8');
      if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    let killedBy: string | null = null;
    const kill = (why: string) => {
      killedBy = why;
      if (process.platform === 'win32' && child.pid)
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => kill(`timed out after ${timeout / 1000}s`), timeout);
    const onAbort = () => kill('cancelled');
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    const finish = (code: number | null, error?: Error) => {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onAbort);
      const head = error
        ? `Could not run the command: ${error.message}`
        : killedBy
          ? `Command ${killedBy}.`
          : `Exit code ${String(code)}.`;
      done({
        ok: !error && !killedBy && code === 0,
        content: `${head}\n${tail(output)}`.trimEnd(),
      });
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
  });
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'list_files':
        return listFiles(ctx.root, args);
      case 'read_file':
        return markSeen(ctx, args, readFile(ctx.root, args));
      case 'search':
        return search(ctx.root, args);
      case 'write_file':
        return unread(ctx, args) ?? markSeen(ctx, args, writeFile(ctx.root, args));
      case 'edit_file':
        return unread(ctx, args) ?? markSeen(ctx, args, editFile(ctx.root, args));
      case 'run_command':
        return await runCommand(ctx, args);
      default:
        return { ok: false, content: `Unknown tool "${name}".` };
    }
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, content: e.message };
    return { ok: false, content: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
