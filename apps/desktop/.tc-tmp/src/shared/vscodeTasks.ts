/**
 * `.vscode/tasks.json` (VS Code Tasks 2.0) → commands typed into the terminal. Pure: the
 * renderer reads the file and runs the result in its terminal.
 */
import { parseJsonc } from './jsonc.js';

export interface VsTask {
  label: string;
  /** Command line typed into the terminal (dependencies first, joined with &&). */
  command: string;
  /** Workspace-relative folder ('' = root), already part of `command`. */
  cwd: string;
  group?: 'build' | 'test';
  isDefault?: boolean;
  background?: boolean;
  dependsOn: string[];
  /** Why it cannot run here (unknown ${input:…} variables, a dependency loop…). */
  problem?: string;
}

export interface TaskContext {
  /** Absolute folder of the workspace. */
  root: string;
  /** Active file, workspace-relative. */
  file?: string;
  platform: 'windows' | 'osx' | 'linux';
  /** npm / pnpm / yarn / bun for "type": "npm" tasks. */
  packageManager?: string;
}

interface RawTask {
  label?: unknown;
  taskName?: unknown;
  type?: unknown;
  command?: unknown;
  args?: unknown;
  script?: unknown;
  path?: unknown;
  options?: { cwd?: unknown };
  group?: unknown;
  dependsOn?: unknown;
  dependsOrder?: unknown;
  isBackground?: unknown;
  windows?: Partial<RawTask>;
  osx?: Partial<RawTask>;
  linux?: Partial<RawTask>;
}

const SAFE_DIR = /^[\w@+. /-]*$/;

/** Quotes one argument for the terminal (POSIX-like double quotes, fine for pwsh too). */
function quoteArg(a: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(a)) return a;
  return `"${a.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** An args entry: a string, or { value, quoting } ("weak" = typed as is). */
function argOf(a: unknown): { text: string; quote: boolean } | null {
  if (typeof a === 'string') return { text: a, quote: true };
  if (a && typeof a === 'object' && typeof (a as { value?: unknown }).value === 'string') {
    const o = a as { value: string; quoting?: string };
    return { text: o.value, quote: o.quoting !== 'weak' };
  }
  return null;
}

function commandText(c: unknown): string | null {
  if (typeof c === 'string') return c;
  // { value, quoting } or an array of parts.
  if (Array.isArray(c)) return c.filter((x) => typeof x === 'string').join(' ');
  if (c && typeof c === 'object' && typeof (c as { value?: unknown }).value === 'string')
    return (c as { value: string }).value;
  return null;
}

function dirOf(p: string): string {
  return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
}

/** Expands ${workspaceFolder}, ${file}…; returns null with the name of an unsupported one. */
export function expandVars(
  value: string,
  ctx: TaskContext,
): { value: string } | { unsupported: string } {
  const root = ctx.root.replace(/[\\/]+$/, '');
  const file = ctx.file ?? '';
  const sep = ctx.platform === 'windows' ? '\\' : '/';
  const abs = file ? `${root}${sep}${file.split('/').join(sep)}` : '';
  const base = file.split('/').pop() ?? '';
  const vars: Record<string, string> = {
    workspaceFolder: root,
    workspaceRoot: root,
    workspaceFolderBasename: root.split(/[\\/]/).pop() ?? '',
    cwd: root,
    file: abs,
    relativeFile: file,
    relativeFileDirname: dirOf(file),
    fileDirname: file
      ? `${root}${dirOf(file) ? sep + dirOf(file).split('/').join(sep) : ''}`
      : root,
    fileBasename: base,
    fileBasenameNoExtension: base.replace(/\.[^.]*$/, ''),
    fileExtname: base.includes('.') ? base.slice(base.lastIndexOf('.')) : '',
    pathSeparator: sep,
    '/': sep,
  };
  let bad: string | null = null;
  const out = value.replace(/\$\{([^}]+)\}/g, (all, name: string) => {
    if (name in vars) return vars[name]!;
    if (name.startsWith('env:'))
      return ctx.platform === 'windows' ? `$env:${name.slice(4)}` : `$${name.slice(4)}`;
    bad ??= name;
    return all;
  });
  return bad ? { unsupported: bad } : { value: out };
}

/** Folder of `options.cwd` relative to the workspace ('' = root, null = outside / unsafe). */
function relCwd(cwd: string, root: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  let c = norm(cwd);
  if (c === r || c === '.' || c === '') return '';
  if (c.toLowerCase().startsWith(`${r.toLowerCase()}/`)) c = c.slice(r.length + 1);
  else if (/^([A-Za-z]:)?\//.test(c)) return null;
  c = c.replace(/^\.\//, '');
  if (c.split('/').includes('..') || !SAFE_DIR.test(c)) return null;
  return c;
}

function inDir(dir: string, cmd: string): string {
  return dir ? `cd "${dir}" && ${cmd}` : cmd;
}

/** One task with its OS-specific overrides applied. */
function forPlatform(t: RawTask, platform: TaskContext['platform']): RawTask {
  const o = t[platform];
  return o && typeof o === 'object' ? { ...t, ...o, options: { ...t.options, ...o.options } } : t;
}

/** Tasks of a tasks.json text (unparseable text → []). */
export function parseTasksJson(text: string, ctx: TaskContext): VsTask[] {
  let data: { tasks?: unknown };
  try {
    data = parseJsonc(text);
  } catch {
    return [];
  }
  const raws = Array.isArray(data?.tasks) ? (data.tasks as RawTask[]) : [];
  /** Own command of each task (without dependencies), by label. */
  const own = new Map<string, { cmd: string | null; problem?: string; raw: RawTask }>();
  const order: string[] = [];
  for (const raw0 of raws) {
    if (!raw0 || typeof raw0 !== 'object') continue;
    const raw = forPlatform(raw0, ctx.platform);
    const type = typeof raw.type === 'string' ? raw.type : 'process';
    let label =
      typeof raw.label === 'string'
        ? raw.label
        : typeof raw.taskName === 'string'
          ? raw.taskName
          : '';
    if (!label && type === 'npm' && typeof raw.script === 'string') label = `npm: ${raw.script}`;
    if (!label || own.has(label)) continue;
    order.push(label);
    let problem: string | undefined;
    let cmd: string | null = null;
    let cwd = '';
    if (type === 'npm') {
      if (typeof raw.script === 'string' && /^[\w:.-]+$/.test(raw.script)) {
        cmd = `${ctx.packageManager ?? 'npm'} run ${raw.script}`;
        const p = typeof raw.path === 'string' ? relCwd(raw.path, ctx.root) : '';
        if (p === null) problem = 'path';
        else cwd = p;
      } else if (raw.script !== undefined) problem = 'script';
    } else if (raw.command !== undefined) {
      const c = commandText(raw.command);
      const args = Array.isArray(raw.args) ? raw.args.map(argOf) : [];
      if (c === null || args.includes(null)) problem = 'command';
      else {
        // Variables first, then quoting: a path with spaces stays one argument.
        const parts: string[] = [];
        const all = [{ text: c, quote: false }, ...(args as { text: string; quote: boolean }[])];
        for (const part of all) {
          const e = expandVars(part.text, ctx);
          if ('unsupported' in e) {
            problem = `\${${e.unsupported}}`;
            break;
          }
          parts.push(part.quote ? quoteArg(e.value) : e.value);
        }
        if (!problem) cmd = parts.join(' ');
      }
    }
    if (!problem && typeof raw.options?.cwd === 'string') {
      const e = expandVars(raw.options.cwd, ctx);
      const r = 'value' in e ? relCwd(e.value, ctx.root) : null;
      if (r === null) problem = 'options.cwd';
      else cwd = r;
    }
    own.set(label, { cmd: cmd && !problem ? inDir(cwd, cmd) : null, problem, raw });
  }

  const out: VsTask[] = [];
  for (const label of order) {
    const { raw, problem: ownProblem } = own.get(label)!;
    const deps = (
      Array.isArray(raw.dependsOn) ? raw.dependsOn : raw.dependsOn ? [raw.dependsOn] : []
    )
      .map((d) =>
        typeof d === 'string'
          ? d
          : typeof (d as { label?: unknown })?.label === 'string'
            ? (d as { label: string }).label
            : '',
      )
      .filter(Boolean);
    // Expands dependencies depth-first (each one once), refusing loops.
    const parts: string[] = [];
    const seen = new Set<string>();
    let problem = ownProblem;
    const visit = (l: string, path: string[]): void => {
      if (problem) return;
      if (path.includes(l)) {
        problem = 'dependsOn loop';
        return;
      }
      if (seen.has(l)) return;
      const t = own.get(l);
      if (!t) {
        problem = `dependsOn: ${l}`;
        return;
      }
      const tDeps = (
        Array.isArray(t.raw.dependsOn) ? t.raw.dependsOn : t.raw.dependsOn ? [t.raw.dependsOn] : []
      ).filter((d): d is string => typeof d === 'string');
      for (const d of tDeps) visit(d, [...path, l]);
      seen.add(l);
      if (t.problem && l !== label) problem = `${l}: ${t.problem}`;
      else if (t.cmd) parts.push(t.cmd);
    };
    visit(label, []);
    const g = raw.group;
    const kind =
      typeof g === 'string'
        ? g
        : g && typeof g === 'object'
          ? (g as { kind?: unknown }).kind
          : undefined;
    out.push({
      label,
      command: parts.join(' && '),
      cwd: '',
      dependsOn: deps,
      ...(kind === 'build' || kind === 'test' ? { group: kind } : {}),
      ...(g && typeof g === 'object' && (g as { isDefault?: unknown }).isDefault === true
        ? { isDefault: true }
        : {}),
      ...(raw.isBackground === true ? { background: true } : {}),
      ...(problem ? { problem } : !parts.length ? { problem: 'command' } : {}),
    });
  }
  return out;
}
