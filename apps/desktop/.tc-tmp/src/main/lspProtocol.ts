import { existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WS_URI } from '../shared/lsp.js';

/** One JSON-RPC message with its Content-Length header (the LSP base protocol). */
export function encodeMessage(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/** Splits a byte stream into the JSON messages it carries (handles partial chunks). */
export class MessageReader {
  private buf: Buffer = Buffer.alloc(0);
  /** Largest message accepted (a broken server must not eat all the memory). */
  constructor(private readonly max = 64 * 1024 * 1024) {}

  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: unknown[] = [];
    for (;;) {
      const headEnd = this.buf.indexOf('\r\n\r\n');
      if (headEnd < 0) {
        if (this.buf.length > 8192) this.buf = Buffer.alloc(0); // garbage without a header
        break;
      }
      const head = this.buf.subarray(0, headEnd).toString('ascii');
      const m = /content-length:\s*(\d+)/i.exec(head);
      if (!m) {
        // Not a header (a server printing logs on stdout): skip it.
        this.buf = this.buf.subarray(headEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      if (len > this.max) {
        this.buf = Buffer.alloc(0);
        throw new Error(`LSP message too large (${len} bytes)`);
      }
      const start = headEnd + 4;
      if (this.buf.length < start + len) break;
      const body = this.buf.subarray(start, start + len).toString('utf8');
      this.buf = this.buf.subarray(start + len);
      try {
        out.push(JSON.parse(body));
      } catch {
        // malformed body: dropped
      }
    }
    return out;
  }
}

/** file:// URI of an absolute path, the way most servers write it. */
export function fileUri(abs: string): string {
  return pathToFileURL(abs).href;
}

/** Workspace-relative path ('/'-separated) of a file:// URI, or null when outside the root. */
export function uriToRel(uri: string, root: string): string | null {
  let abs: string;
  try {
    abs = fileURLToPath(uri);
  } catch {
    return null;
  }
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[fn(k)] = mapStrings(v, fn);
    return out;
  }
  return value;
}

/**
 * Server → renderer: every file:// URI inside the workspace becomes `zx-ws:/<rel path>`
 * (strings and object keys, e.g. WorkspaceEdit.changes). URIs outside it stay as they are.
 */
export function toClientUris<T>(value: T, root: string): T {
  return mapStrings(value, (s) => {
    if (!s.startsWith('file:')) return s;
    const rel = uriToRel(s, root);
    return rel === null ? s : WS_URI + rel;
  }) as T;
}

/** Renderer → server: `zx-ws:/<rel path>` back to file:// URIs under the root. */
export function toServerUris<T>(value: T, root: string): T {
  return mapStrings(value, (s) => {
    if (!s.startsWith(WS_URI)) return s;
    const rel = s.slice(WS_URI.length);
    const abs = join(root, ...rel.split('/'));
    // A path that climbs out of the root is not a workspace document.
    if (relative(root, abs).startsWith('..')) return s;
    return fileUri(abs);
  }) as T;
}

/**
 * Finds an executable on PATH, like `which`. On Windows also tries the PATHEXT extensions
 * (.cmd shims of npm packages, .exe…). Returns the absolute path or null.
 */
export function findExecutable(
  command: string,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = isFile,
): string | null {
  const win = platform === 'win32';
  const exts = win
    ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  const withExt = (base: string) => {
    for (const ext of exts) {
      const p = base + ext.toLowerCase();
      if (exists(p)) return p;
      if (ext && exists(base + ext)) return base + ext;
    }
    return null;
  };
  if (command.includes('/') || command.includes('\\')) return withExt(command);
  const pathVar = env.PATH ?? env.Path ?? '';
  const dirs = pathVar.split(win ? ';' : delimiter).filter(Boolean);
  // Common install folders that are not always on the PATH of a GUI app.
  const home = env.HOME ?? env.USERPROFILE;
  if (home) {
    dirs.push(join(home, 'go', 'bin'), join(home, '.cargo', 'bin'), join(home, '.local', 'bin'));
    if (!win) dirs.push('/usr/local/bin', '/opt/homebrew/bin');
  }
  if (win && env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
  if (win && env.USERPROFILE) dirs.push(join(env.USERPROFILE, '.dotnet', 'tools'));
  for (const d of dirs) {
    const hit = withExt(join(d, command));
    if (hit) return hit;
  }
  return null;
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}
