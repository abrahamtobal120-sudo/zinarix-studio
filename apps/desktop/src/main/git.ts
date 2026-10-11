import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type {
  GitBranchView,
  GitCommitView,
  GitFileView,
  GitHubStatus,
  GitHubRepoView,
  GitStatusView,
} from '../shared/api.js';
import type { Workspace } from './workspace.js';

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Runs git (or gh) with an argument vector (never a shell string). Prompts are disabled so a
 * missing credential fails fast instead of hanging; the user signs in from the terminal.
 */
export function run(
  bin: 'git' | 'gh',
  args: string[],
  cwd: string,
  timeout = 120_000,
): Promise<string> {
  return new Promise((res, rej) =>
    execFile(
      bin,
      args,
      {
        cwd,
        timeout,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GH_PROMPT_DISABLED: '1',
          GH_NO_UPDATE_NOTIFIER: '1',
          LC_ALL: 'C',
        },
      },
      (err, stdout, stderr) => {
        if (!err) return res(stdout);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT')
          return rej(new Error(bin === 'git' ? 'Git no está instalado.' : 'gh no está instalado.'));
        rej(new Error((stderr || err.message).trim().split('\n').slice(-6).join('\n')));
      },
    ),
  );
}

/** Branch names the user types: git's own rules, and never something that looks like a flag. */
export async function checkBranch(name: string, cwd: string): Promise<string> {
  const n = name.trim();
  if (!n || n.startsWith('-')) throw new Error('Nombre de rama no válido.');
  await run('git', ['check-ref-format', '--branch', n], cwd).catch(() => {
    throw new Error(`Nombre de rama no válido: ${n}`);
  });
  return n;
}

/** Clone sources: https / ssh URLs or GitHub "owner/repo". Rejects transports like ext::. */
export function checkRepoSpec(spec: string): { kind: 'url' | 'gh'; value: string } {
  const s = spec.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return { kind: 'gh', value: s };
  if (/^https:\/\/[^\s]+$/.test(s) || /^git@[\w.-]+:[\w./-]+$/.test(s) || /^ssh:\/\/\S+$/.test(s))
    return { kind: 'url', value: s };
  throw new Error('Usa una URL https://… o git@…, o el formato usuario/repositorio.');
}

/** Folder name git would create for a clone source. */
export function repoName(spec: string): string {
  const last = spec.replace(/\/+$/, '').split(/[/:]/).pop() ?? 'repo';
  return last.replace(/\.git$/, '') || 'repo';
}

export class Git {
  constructor(private readonly ws: Workspace) {}

  private git(args: string[], timeout?: number): Promise<string> {
    return run('git', args, this.ws.root, timeout);
  }

  /** Workspace-relative paths, each checked against the workspace (no traversal). */
  private paths(list: string[]): string[] {
    return list.map((p) => this.ws.toRel(this.ws.resolve(p)));
  }

  async status(): Promise<GitStatusView> {
    let out: string;
    try {
      out = await this.git(['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
    } catch (e) {
      const msg = (e as Error).message;
      if (/not a git repository/i.test(msg)) return emptyStatus(false);
      throw e;
    }
    const st = emptyStatus(true);
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i]!;
      if (!entry) continue;
      if (entry.startsWith('## ')) {
        parseBranchLine(entry.slice(3), st);
        continue;
      }
      const x = entry[0]!;
      const y = entry[1]!;
      const path = entry.slice(3);
      let from: string | undefined;
      // Renames/copies carry the original path in the next NUL-separated field.
      if (x === 'R' || x === 'C') from = parts[++i];
      const f: GitFileView = {
        path,
        from,
        index: x,
        work: y,
        untracked: x === '?',
        conflict: x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D'),
      };
      st.files.push(f);
    }
    st.hasCommits = await this.git(['rev-parse', '--verify', '-q', 'HEAD'])
      .then(() => true)
      .catch(() => false);
    st.remotes = (await this.git(['remote']).catch(() => ''))
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    return st;
  }

  async init(): Promise<void> {
    await this.git(['init', '-b', 'main']).catch(() => this.git(['init']));
  }

  async stage(paths: string[]): Promise<void> {
    if (!paths.length) await this.git(['add', '-A']);
    else await this.git(['add', '-A', '--', ...this.paths(paths)]);
  }

  async unstage(paths: string[]): Promise<void> {
    const hasHead = await this.git(['rev-parse', '--verify', '-q', 'HEAD'])
      .then(() => true)
      .catch(() => false);
    const list = paths.length ? this.paths(paths) : ['.'];
    if (hasHead) await this.git(['reset', '-q', 'HEAD', '--', ...list]);
    else await this.git(['rm', '-r', '-q', '--cached', '--', ...list]);
  }

  /** Throws away working-tree changes of tracked files (untracked files go to the trash in main). */
  async discard(paths: string[]): Promise<void> {
    if (!paths.length) return;
    await this.git(['checkout', '-q', '--', ...this.paths(paths)]);
  }

  /** Text before/after for the diff view: index vs working tree, or HEAD vs index when staged. */
  async diff(path: string, staged: boolean): Promise<{ before: string; after: string }> {
    const rel = this.paths([path])[0]!;
    const show = (rev: string) => this.git(['show', `${rev}:${rel}`]).catch(() => '');
    if (staged) return { before: await show('HEAD'), after: await show('') };
    const indexed = await this.git(['ls-files', '--', rel]).catch(() => '');
    const before = indexed.trim() ? await show('') : '';
    const abs = this.ws.resolve(rel);
    const after = existsSync(abs) ? await readFile(abs, 'utf8').catch(() => '') : '';
    return { before, after };
  }

  /** Patch text for the AI commit message (staged changes, or everything if nothing is staged). */
  async patch(staged: boolean, max = 60_000): Promise<string> {
    const args = ['diff', '--no-color', '--no-ext-diff', '--stat', '--patch'];
    const text = await this.git(staged ? [...args, '--cached'] : args);
    return text.length > max ? `${text.slice(0, max)}\n… [diff truncado]` : text;
  }

  async commit(message: string, amend: boolean): Promise<void> {
    if (!message.trim() && !amend) throw new Error('Escribe un mensaje de commit.');
    const args = ['commit', '-q'];
    if (amend) args.push('--amend');
    if (message.trim()) args.push('-m', message.trim());
    else args.push('--no-edit');
    await this.git(args);
  }

  async log(limit = 80): Promise<GitCommitView[]> {
    const out = await this.git([
      'log',
      `-n${limit}`,
      '--date=relative',
      '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D%x1e',
    ]).catch(() => '');
    return out
      .split('\x1e')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [hash, short, author, date, subject, refs] = r.split('\x1f');
        return {
          hash: hash!,
          short: short!,
          author: author ?? '',
          date: date ?? '',
          subject: subject ?? '',
          refs: refs ?? '',
        };
      });
  }

  async show(hash: string): Promise<string> {
    if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error('commit no válido');
    const out = await this.git(['show', '--stat', '--patch', '--no-color', hash]);
    return out.length > 200_000 ? `${out.slice(0, 200_000)}\n…` : out;
  }

  async branches(): Promise<GitBranchView[]> {
    const out = await this.git([
      'branch',
      '-a',
      '--format=%(HEAD)%1f%(refname:short)%1f%(refname)%1f%(upstream:short)',
    ]).catch(() => '');
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [head, name, ref, upstream] = l.split('\x1f');
        return {
          name: name!,
          current: head === '*',
          remote: ref!.startsWith('refs/remotes/'),
          upstream: upstream || undefined,
        };
      })
      .filter((b) => !b.name.endsWith('/HEAD') && b.name !== 'origin');
  }

  async checkout(name: string, create: boolean): Promise<void> {
    const n = await checkBranch(name, this.ws.root);
    if (create) return void (await this.git(['switch', '-c', n]));
    // A remote branch ("origin/feat") is checked out as a local tracking branch.
    const remote = /^[\w.-]+\/(.+)$/.exec(n);
    const local = (await this.branches()).some((b) => !b.remote && b.name === n);
    if (!local && remote) await this.git(['switch', '--track', n]);
    else await this.git(['switch', n]);
  }

  async deleteBranch(name: string, force: boolean): Promise<void> {
    const n = await checkBranch(name, this.ws.root);
    await this.git(['branch', force ? '-D' : '-d', n]);
  }

  async sync(op: 'pull' | 'push' | 'fetch'): Promise<string> {
    if (op === 'fetch') return this.git(['fetch', '--all', '--prune'], 300_000);
    if (op === 'pull') return this.git(['pull', '--ff-only'], 300_000);
    const st = await this.status();
    if (!st.remotes.length) throw new Error('El repositorio no tiene remoto. Usa "Publicar".');
    const args = st.upstream ? ['push'] : ['push', '-u', st.remotes[0]!, 'HEAD'];
    return this.git(args, 300_000);
  }

  async addRemote(url: string): Promise<void> {
    const spec = checkRepoSpec(url);
    const value = spec.kind === 'gh' ? `https://github.com/${spec.value}.git` : spec.value;
    const remotes = (await this.git(['remote']).catch(() => '')).split('\n');
    if (remotes.includes('origin')) await this.git(['remote', 'set-url', 'origin', value]);
    else await this.git(['remote', 'add', 'origin', value]);
  }

  async stash(op: 'push' | 'pop'): Promise<void> {
    await this.git(op === 'push' ? ['stash', 'push', '-u'] : ['stash', 'pop']);
  }
}

function emptyStatus(isRepo: boolean): GitStatusView {
  return {
    isRepo,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    hasCommits: false,
    remotes: [],
  };
}

/** "main...origin/main [ahead 1, behind 2]" / "No commits yet on main" / "HEAD (no branch)". */
function parseBranchLine(line: string, st: GitStatusView): void {
  const noCommits = /^No commits yet on (.+)$/.exec(line);
  if (noCommits) {
    st.branch = noCommits[1]!;
    return;
  }
  const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(line);
  if (!m) return;
  st.branch = m[1] === 'HEAD (no branch)' ? null : m[1]!;
  st.upstream = m[2] ?? null;
  const track = m[3] ?? '';
  st.ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0);
  st.behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0);
}

// ---------------- GitHub (through the user's own `gh` login) ----------------

export async function githubStatus(): Promise<GitHubStatus> {
  try {
    await run('gh', ['--version'], process.cwd(), 10_000);
  } catch {
    return { installed: false, loggedIn: false, user: null };
  }
  try {
    const user = (await run('gh', ['api', 'user', '--jq', '.login'], process.cwd(), 15_000)).trim();
    return { installed: true, loggedIn: Boolean(user), user: user || null };
  } catch {
    return { installed: true, loggedIn: false, user: null };
  }
}

export async function githubRepos(): Promise<GitHubRepoView[]> {
  const out = await run(
    'gh',
    [
      'repo',
      'list',
      '--limit',
      '200',
      '--json',
      'nameWithOwner,description,isPrivate,updatedAt,url',
    ],
    process.cwd(),
    30_000,
  );
  const list = JSON.parse(out) as {
    nameWithOwner: string;
    description: string | null;
    isPrivate: boolean;
    updatedAt: string;
    url: string;
  }[];
  return list.map((r) => ({
    name: r.nameWithOwner,
    description: r.description ?? '',
    private: r.isPrivate,
    updatedAt: r.updatedAt,
    url: r.url,
  }));
}

/** Clones into `dest` (a folder that must not exist yet). */
export async function cloneRepo(spec: string, dest: string, viaGh: boolean): Promise<void> {
  if (existsSync(dest)) throw new Error(`Ya existe la carpeta ${dest}`);
  const s = checkRepoSpec(spec);
  if (s.kind === 'gh' && viaGh) await run('gh', ['repo', 'clone', s.value, dest], process.cwd(), 0);
  else {
    const url = s.kind === 'gh' ? `https://github.com/${s.value}.git` : s.value;
    await run('git', ['clone', '--', url, dest], process.cwd(), 0);
  }
}

/** Creates a GitHub repository from the open folder and pushes it (gh repo create). */
export async function publishRepo(
  ws: Workspace,
  name: string,
  visibility: 'private' | 'public',
  description: string,
): Promise<string> {
  const n = name.trim();
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(n)) throw new Error('Nombre de repositorio no válido.');
  const args = ['repo', 'create', n, `--${visibility}`, '--source', '.', '--remote', 'origin'];
  if (description.trim()) args.push('--description', description.trim().slice(0, 300));
  const hasHead = await run('git', ['rev-parse', '--verify', '-q', 'HEAD'], ws.root)
    .then(() => true)
    .catch(() => false);
  if (hasHead) args.push('--push');
  const out = await run('gh', args, ws.root, 300_000);
  return out.trim().split('\n').pop() ?? '';
}
