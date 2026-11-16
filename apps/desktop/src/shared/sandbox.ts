/**
 * Fase 5B: the sandbox for a background task's commands. Pure (no Electron, no I/O): what
 * this machine's sandbox protects, the bubblewrap arguments (Linux) and the sandbox-exec
 * profile (macOS) that confine a command to its worktree, and the clean environment every
 * task command gets. main/sandbox.ts detects the sandbox and builds the command with these.
 *
 * Rules: writes only in the worktree and the temp folder; no network; no ~/.ssh, no app data
 * folder (it holds the other worktrees and the tokens). A sandbox that is missing is never
 * faked: when a protection is not active, the command goes back to asking for approval.
 */

export type SandboxKind = 'bwrap' | 'sandbox-exec' | 'none';

/** What the sandbox of this machine protects. */
export interface SandboxCaps {
  kind: SandboxKind;
  /** Writes are limited to the worktree and the temp folder. */
  write: boolean;
  /** No network access. */
  network: boolean;
  /** Why something is missing (shown in the Tasks panel). */
  reason?: string;
}

/** The paths a confined command needs. All absolute. */
export interface SandboxPaths {
  /** The task's worktree (read and write). */
  root: string;
  /** A temp folder of its own (read and write). */
  tmp: string;
  /** Hidden entirely (only folders that exist: bwrap cannot create mount points on a
   * read-only system): the app's data folder (other worktrees, tokens) and secretDirs(). */
  hidden: readonly string[];
}

export const NO_SANDBOX: SandboxCaps = {
  kind: 'none',
  write: false,
  network: false,
  reason: 'Este sistema no tiene sandbox disponible.',
};

/** Only a sandbox with every protection lets commands run without approval. */
export function sandboxComplete(c: SandboxCaps | undefined): boolean {
  return !!c && c.kind !== 'none' && c.write && c.network;
}

/** Folders under the home folder that hold keys; hidden from confined commands. */
export const HOME_SECRETS = ['.ssh', '.aws', '.gnupg', '.docker', '.kube', '.config/gh', '.azure'];

const join = (a: string, b: string): string => `${a.replace(/\/+$/, '')}/${b}`;

/** The folders under the home folder that hold keys (callers keep the ones that exist). */
export function secretDirs(home: string): string[] {
  return HOME_SECRETS.map((s) => join(home, s));
}

/** Whether `p` is `dir` or inside it (POSIX paths). */
const under = (p: string, dir: string): boolean =>
  p === dir || p.startsWith(dir.replace(/\/+$/, '') + '/');

/**
 * bubblewrap arguments (before `--`): the whole system read-only, a fresh /tmp, the worktree
 * and the task's temp folder writable, the secrets folders and the app data folder replaced
 * by empty ones, and no network. Order matters: later mounts go on top of earlier ones, so
 * the worktree (inside the app data folder) is bound after the data folder is hidden.
 */
export function bwrapArgs(p: SandboxPaths): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp'];
  for (const h of p.hidden) args.push('--tmpfs', h);
  args.push('--bind', p.tmp, p.tmp, '--bind', p.root, p.root);
  args.push('--unshare-net', '--unshare-ipc', '--die-with-parent', '--new-session');
  args.push('--setenv', 'TMPDIR', p.tmp);
  return args;
}

/** A string literal for a sandbox-exec (SBPL) profile. */
export function sbplString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * sandbox-exec profile (macOS). In SBPL the last matching rule wins: everything is allowed,
 * then network and writes are denied, then writes to the worktree, the temp folders and the
 * terminal devices are allowed again; reading the secrets and the app data folder is denied
 * last, except the worktree itself (it lives inside the data folder).
 */
export function macProfile(p: SandboxPaths): string {
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(allow network* (remote unix-socket))',
    '(deny file-write*)',
    `(allow file-write* (subpath ${sbplString(p.root)}) (subpath ${sbplString(p.tmp)}) (subpath "/private/var/folders") (literal "/dev/null") (literal "/dev/zero") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`,
  ];
  if (p.hidden.length)
    lines.push(
      `(deny file-read* file-write* ${p.hidden.map((h) => `(subpath ${sbplString(h)})`).join(' ')})`,
    );
  // The worktree is inside the data folder: give it back.
  if (p.hidden.some((h) => under(p.root, h)))
    lines.push(`(allow file-read* file-write* (subpath ${sbplString(p.root)}))`);
  return lines.join('\n');
}

/** Variables that hold credentials by their name (GITHUB_TOKEN, OPENAI_API_KEY, NPM_TOKEN…). */
const SECRET_NAME =
  /(^|_)(KEY|KEYS|TOKEN|TOKENS|SECRET|SECRETS|PASSWORD|PASSWD|PASS|CREDENTIAL|CREDENTIALS|AUTH|PAT|COOKIE|SESSION|PRIVATE)(_|$)|APIKEY|ACCESSKEY|^OMNI_/i;

/** Credential variables that do not follow the naming pattern. */
const SECRET_EXACT = new Set([
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SUDO_ASKPASS',
  'DATABASE_URL',
  'NODE_AUTH_TOKEN',
  'NPM_CONFIG__AUTH',
  'VSCODE_GIT_ASKPASS_NODE',
  'VSCODE_GIT_IPC_HANDLE',
]);

/** Ordinary variables that the pattern would catch by mistake. */
const NOT_SECRET = new Set([
  'PWD',
  'OLDPWD',
  'XDG_SESSION_TYPE',
  'XDG_SESSION_ID',
  'XDG_SESSION_CLASS',
  'XDG_SESSION_DESKTOP',
  'DESKTOP_SESSION',
  'KEYTIMEOUT',
]);

/** Whether a variable may hold a credential (removed from every task command). */
export function isSecretEnv(name: string): boolean {
  const n = name.toUpperCase();
  if (NOT_SECRET.has(n)) return false;
  return SECRET_EXACT.has(n) || SECRET_NAME.test(n);
}

/**
 * The environment of a task's commands, with or without sandbox: no tokens, no keys, no
 * ssh agent. `extra` (PORT, ZINARIX_TASK, variables the user approved) is added after.
 */
export function taskEnv(
  base: Record<string, string | undefined>,
  extra: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !isSecretEnv(k)) out[k] = v;
  return { ...out, ...extra };
}
