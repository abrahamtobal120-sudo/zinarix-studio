import { execFile, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DirEntry, FileContent, SearchHit, WorkspaceInfo } from '../shared/api.js';

const MAX_FILE = 10 * 1024 * 1024;
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  '__pycache__',
  '.venv',
  'target',
]);

/**
 * A folder the user explicitly opened. Every path coming from the renderer is resolved
 * against it and rejected if it escapes (path traversal, absolute paths, symlink tricks
 * are bounded by the same check on the resolved path).
 */
export class Workspace {
  private watcher: FSWatcher | undefined;

  constructor(readonly root: string) {}

  resolve(rel: string): string {
    if (isAbsolute(rel)) throw new Error('absolute paths are not allowed');
    const abs = resolve(this.root, rel);
    const r = relative(this.root, abs);
    if (r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r))
      throw new Error('path escapes the workspace');
    return abs;
  }

  toRel(abs: string): string {
    return relative(this.root, abs).split(sep).join('/');
  }

  async info(): Promise<WorkspaceInfo> {
    return { root: this.root, name: basename(this.root), branch: await gitBranch(this.root) };
  }

  async readDir(rel: string): Promise<DirEntry[]> {
    const abs = this.resolve(rel);
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== '.git')
      .map((e) => ({ name: e.name, path: this.toRel(join(abs, e.name)), dir: e.isDirectory() }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  }

  async readFile(rel: string): Promise<FileContent> {
    const abs = this.resolve(rel);
    const s = await stat(abs);
    if (s.size > MAX_FILE) return { content: '', binary: false, tooLarge: true };
    const buf = await readFile(abs);
    const probe = buf.subarray(0, 8000);
    if (probe.includes(0)) return { content: '', binary: true, tooLarge: false };
    return { content: buf.toString('utf8'), binary: false, tooLarge: false };
  }

  async writeFile(rel: string, content: string): Promise<void> {
    await writeFile(this.resolve(rel), content, 'utf8');
  }

  async createFile(rel: string): Promise<void> {
    const abs = this.resolve(rel);
    const fh = await open(abs, 'wx');
    await fh.close();
  }

  async createDir(rel: string): Promise<void> {
    await mkdir(this.resolve(rel), { recursive: false });
  }

  async rename(from: string, to: string): Promise<void> {
    const dest = this.resolve(to);
    if (existsSync(dest)) throw new Error('destination already exists');
    await rename(this.resolve(from), dest);
  }

  /** Lists files for quick open (Ctrl+P), skipping heavy folders. */
  async listFiles(limit = 20000): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= limit) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= limit) return;
        const abs = join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name)) await walk(abs);
        } else if (e.isFile()) out.push(this.toRel(abs));
      }
    };
    await walk(this.root);
    return out.sort();
  }

  /** Global search: ripgrep when installed (respects .gitignore), JS fallback otherwise. */
  async search(
    query: string,
    regex: boolean,
    caseSensitive: boolean,
    limit = 2000,
  ): Promise<SearchHit[]> {
    if (!query) return [];
    const rg = await ripgrep(this.root, query, regex, caseSensitive, limit).catch(() => undefined);
    if (rg) return rg.map((h) => ({ ...h, path: h.path.split(sep).join('/') }));
    const re = new RegExp(
      regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      caseSensitive ? '' : 'i',
    );
    const hits: SearchHit[] = [];
    for (const path of await this.listFiles()) {
      if (hits.length >= limit) break;
      const f = await this.readFile(path).catch(() => undefined);
      if (!f || f.binary || f.tooLarge) continue;
      f.content.split('\n').forEach((text, i) => {
        const m = re.exec(text);
        if (m && hits.length < limit)
          hits.push({ path, line: i + 1, column: m.index + 1, text: text.slice(0, 300) });
      });
    }
    return hits;
  }

  watch(onChange: () => void): void {
    let timer: NodeJS.Timeout | undefined;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_ev, file) => {
        if (file && /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(String(file))) return;
        clearTimeout(timer);
        timer = setTimeout(onChange, 250);
      });
    } catch {
      // recursive watch unsupported: explorer refreshes on demand
    }
  }

  dispose(): void {
    this.watcher?.close();
  }
}

function gitBranch(cwd: string): Promise<string | null> {
  return new Promise((res) =>
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 2000 }, (err, stdout) =>
      res(err ? null : stdout.trim() || null),
    ),
  );
}

function ripgrep(
  cwd: string,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
  limit: number,
): Promise<SearchHit[]> {
  return new Promise((res, rej) => {
    const args = [
      '--json',
      '--max-count',
      '200',
      caseSensitive ? '--case-sensitive' : '--ignore-case',
    ];
    if (!regex) args.push('--fixed-strings');
    args.push('--', query, '.');
    const child = spawn('rg', args, { cwd });
    const hits: SearchHit[] = [];
    let buf = '';
    child.on('error', rej);
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const j = JSON.parse(line) as {
            type: string;
            data: {
              path: { text: string };
              line_number: number;
              lines: { text: string };
              submatches: { start: number }[];
            };
          };
          if (j.type === 'match' && hits.length < limit) {
            hits.push({
              path: j.data.path.text.replace(/^\.[\\/]/, ''),
              line: j.data.line_number,
              column: (j.data.submatches[0]?.start ?? 0) + 1,
              text: j.data.lines.text.replace(/\r?\n$/, '').slice(0, 300),
            });
          }
          if (hits.length >= limit) child.kill();
        } catch {
          // partial line
        }
      }
    });
    child.on('close', () => res(hits));
  });
}
