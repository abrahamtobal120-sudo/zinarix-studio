import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { DebugConfig, DebugKind } from '../../shared/devtools.js';

/** Removes // and /* *\/ comments and trailing commas (JSONC → JSON), respecting strings. */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i]!;
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return dropTrailingCommas(out);
}

/** Removes commas right before } or ] (outside strings). */
function dropTrailingCommas(text: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(stripJsonc((text.charCodeAt(0) === 0xfeff ? text.slice(1) : text))) as T;
}

/** Which backend a launch.json "type" means. */
export function kindOf(type: string): DebugKind | null {
  const t = type.toLowerCase();
  if (['node', 'pwa-node', 'node2', 'javascript', 'typescript'].includes(t)) return 'node';
  if (['python', 'debugpy', 'py'].includes(t)) return 'python';
  if (['go', 'delve', 'dlv'].includes(t)) return 'go';
  if (['lldb', 'codelldb', 'lldb-dap', 'lldb-vscode', 'cppdbg', 'cppvsdbg', 'rust'].includes(t))
    return 'lldb';
  return null;
}

/** The configuration used with no launch.json: debug the open file. */
export function autoConfig(file: string): DebugConfig | null {
  const ext = extname(file).toLowerCase();
  const name = basename(file);
  if (['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'].includes(ext))
    return { name, type: 'node', request: 'launch', program: '${file}' };
  if (ext === '.py') return { name, type: 'python', request: 'launch', program: '${file}' };
  if (ext === '.go') return { name, type: 'go', request: 'launch', program: '${fileDirname}' };
  return null;
}

/** Expands ${workspaceFolder}, ${file}… in a value. */
export function substitute(value: string, root: string, file?: string): string {
  const abs = file ? (isAbsolute(file) ? file : join(root, file)) : '';
  const vars: Record<string, string> = {
    workspaceFolder: root,
    workspaceRoot: root,
    workspaceFolderBasename: basename(root),
    file: abs,
    fileDirname: abs ? dirname(abs) : root,
    fileBasename: abs ? basename(abs) : '',
    fileExtname: abs ? extname(abs) : '',
    fileBasenameNoExtension: abs ? basename(abs, extname(abs)) : '',
    relativeFile: file && !isAbsolute(file) ? file : '',
    pathSeparator: process.platform === 'win32' ? '\\' : '/',
  };
  return value.replace(/\$\{(env:)?([\w]+)\}/g, (all, env: string | undefined, k: string) =>
    env ? (process.env[k] ?? '') : (vars[k] ?? all),
  );
}

/** A config with every variable expanded and paths made absolute. */
export function resolveConfig(cfg: DebugConfig, root: string, file?: string): DebugConfig {
  const sub = (v: string) => substitute(v, root, file);
  const cwd = cfg.cwd ? resolve(root, sub(cfg.cwd)) : root;
  return {
    ...cfg,
    program: cfg.program ? resolve(cwd, sub(cfg.program)) : undefined,
    args: (cfg.args ?? []).map(sub),
    cwd,
    env: Object.fromEntries(Object.entries(cfg.env ?? {}).map(([k, v]) => [k, sub(String(v))])),
  };
}

/** Configurations from a launch.json text (unknown types are dropped). */
export function parseLaunchJson(text: string): DebugConfig[] {
  const data = parseJsonc<{ configurations?: unknown[] }>(text);
  const out: DebugConfig[] = [];
  for (const raw of data.configurations ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.type !== 'string' || !kindOf(c.type)) continue;
    const port =
      typeof c.port === 'number'
        ? c.port
        : typeof (c.connect as { port?: unknown })?.port === 'number'
          ? ((c.connect as { port: number }).port)
          : undefined;
    const host =
      typeof c.host === 'string'
        ? c.host
        : typeof (c.connect as { host?: unknown })?.host === 'string'
          ? (c.connect as { host: string }).host
          : undefined;
    out.push({
      name: typeof c.name === 'string' ? c.name : c.type,
      type: c.type,
      request: c.request === 'attach' ? 'attach' : 'launch',
      program: typeof c.program === 'string' ? c.program : undefined,
      args: Array.isArray(c.args) ? c.args.map(String) : undefined,
      cwd: typeof c.cwd === 'string' ? c.cwd : undefined,
      env:
        c.env && typeof c.env === 'object'
          ? Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, String(v)]))
          : undefined,
      port,
      host,
      stopOnEntry: c.stopOnEntry === true,
    });
  }
  return out;
}
