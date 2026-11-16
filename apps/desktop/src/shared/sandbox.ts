/**
 * Fase 5B: the sandbox for a background task's commands. Pure (no Electron, no I/O): what
 * this machine's sandbox protects, the bubblewrap arguments (Linux) and the sandbox-exec
 * profile (macOS) that confine a command to its worktree, and the clean environment every
 * task command gets. main/sandbox.ts detects the sandbox and builds the command with these.
 *
 * Rules: writes only in the worktree and the temp folder; no network; no ~/.ssh, no app data
 * folder (it holds the other worktrees and the tokens). A sandbox that is missing is never
 * faked: when a protection is not active, the command goes back to asking for approval.
 *
 * Network: none, or (Linux, macOS) only through a local proxy that lets through the hosts
 * of NET_ALLOW (npm and PyPI registries). The proxy runs in the app (main/netProxy.ts);
 * the sandbox can reach nothing but it.
 *
 * Windows (first version, like the plan says): a low-integrity token without admin rights
 * inside a Job Object (process count, memory, kill on close). Low integrity cannot write
 * anything of medium integrity (almost the whole disk, the registry, other processes); only
 * the worktree and its temp folder are labeled low. The hidden folders get a no-read-up
 * label, so ~/.ssh and the app data cannot be read either. The network is not restricted
 * (that needs admin: a firewall rule or AppContainer), and the caps say so.
 */

export type SandboxKind = 'bwrap' | 'sandbox-exec' | 'windows' | 'none';

/** What the sandbox of this machine protects. */
export interface SandboxCaps {
  kind: SandboxKind;
  /** Writes are limited to the worktree and the temp folder. */
  write: boolean;
  /** No network access. */
  network: boolean;
  /** ~/.ssh, ~/.aws… and the app data folder (other worktrees, tokens) cannot be read. */
  secrets: boolean;
  /** Why something is missing (shown in the Tasks panel). */
  reason?: string;
  /** Windows: the helper's C# source and its launcher script (main/sandboxWin.ts). */
  helper?: WinHelper;
  /** Network is not cut entirely: these hosts are reachable through the allow-list proxy
   * (Linux and macOS; missing = no network at all). */
  netAllow?: readonly string[];
}

/** Windows: the launcher script and the helper's C# source it compiles in memory. */
export interface WinHelper {
  launcher: string;
  source: string;
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
  /** The allow-list proxy (Linux, macOS). Missing = no network at all. */
  proxy?: SandboxProxy;
  /** Windows: the folder of all the worktrees. Hiding never relabels it or what is below it
   * (the worktrees are labeled low; a medium label on top would take their writes away). */
  keep?: string;
}

/** Where a confined command reaches the allow-list proxy. */
export interface SandboxProxy {
  /** The loopback TCP port the command's HTTP(S)_PROXY points at. macOS: the proxy itself;
   * Linux: a bridge inside the sandbox that forwards to `socket`. */
  port: number;
  /** Linux: the proxy's unix socket outside, bound into the sandbox (bwrap --unshare-net
   * leaves only loopback; a socket file is the one way out). */
  socket?: string;
}

/** Hosts a confined command may reach (through the proxy) where the sandbox supports it:
 * the npm and PyPI registries, so installs work and nothing else leaves the machine. */
export const NET_ALLOW: readonly string[] = [
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'pypi.org',
  'files.pythonhosted.org',
];

/** Whether `host` (no port) is in the list: exact, or under a `*.domain` entry. */
export function hostAllowed(host: string, allow: readonly string[]): boolean {
  const h = host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  if (!h) return false;
  return allow.some((a) => {
    const e = a.toLowerCase();
    return e.startsWith('*.') ? h.endsWith(e.slice(1)) : h === e;
  });
}

/** The variables that send a command's HTTP(S) traffic through the proxy (npm, pip, curl,
 * git, Node's fetch with NODE_USE_ENV_PROXY). Programs that ignore them get no network. */
export function proxyEnv(port: number): Record<string, string> {
  const url = `http://127.0.0.1:${port}`;
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    ALL_PROXY: url,
    NO_PROXY: '',
    no_proxy: '',
    npm_config_proxy: url,
    npm_config_https_proxy: url,
    PIP_PROXY: url,
    NODE_USE_ENV_PROXY: '1',
  };
}

/** Windows: at most this many processes in a confined command's tree (the Job Object). */
export const MAX_PROCESSES = 256;

export const NO_SANDBOX: SandboxCaps = {
  kind: 'none',
  write: false,
  network: false,
  secrets: false,
  reason: 'Este sistema no tiene sandbox disponible.',
};

/** Only a sandbox with every protection lets commands run without approval. */
export function sandboxComplete(c: SandboxCaps | undefined): boolean {
  return !!c && c.kind !== 'none' && c.write && c.network && c.secrets;
}

/** Whether approved commands of "Auto in the worktree" can at least run with writes confined
 * (an incomplete sandbox still confines what it can; it just asks first). */
export function sandboxConfines(c: SandboxCaps | undefined): boolean {
  return !!c && c.kind !== 'none' && c.write && (c.kind !== 'windows' || !!c.helper);
}

/** PowerShell's -EncodedCommand: base64 of the UTF-16LE text (no quoting problems). */
export function encodePowerShell(command: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < command.length; i++) {
    const c = command.charCodeAt(i);
    bytes.push(c & 0xff, c >> 8);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Windows: how to start a command confined. Windows PowerShell 5.1 (always installed) runs
 * the launcher, which compiles the helper in memory, labels the worktree and the temp folder as the only
 * writable places and starts `powershell -EncodedCommand` at low integrity in a Job Object
 * that kills the whole tree when the launcher ends (cancel, timeout). `memBytes` caps the
 * memory of the whole tree (0 = no cap).
 */
export function winLauncherArgs(
  helper: WinHelper,
  p: Pick<SandboxPaths, 'root' | 'tmp'> & Partial<Pick<SandboxPaths, 'hidden' | 'keep'>>,
  command: string,
  memBytes = 0,
  maxProcesses = MAX_PROCESSES,
): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    helper.launcher,
    '-Src',
    helper.source,
    '-Root',
    p.root,
    '-Tmp',
    p.tmp,
    '-Mem',
    String(Math.max(0, Math.floor(memBytes))),
    '-Procs',
    String(Math.max(1, Math.floor(maxProcesses))),
    // Windows paths cannot contain `|`, so it separates them and stands for "none" (an empty
    // argument can get lost on the way to `powershell -File`).
    '-Hide',
    (p.hidden ?? []).join('|') || '|',
    '-Keep',
    p.keep || '|',
    '-B64',
    encodePowerShell(command),
  ];
}

/** The note on the approval card of a command that will run confined. */
export function sandboxNote(c: SandboxCaps): string {
  const missing = [
    !c.network && 'la red no está restringida',
    !c.secrets && 'puede leer archivos fuera del worktree (como ~/.ssh)',
  ].filter(Boolean);
  if (c.network && c.netAllow?.length) missing.push(`la red solo llega a ${c.netAllow.join(', ')}`);
  return `Corre en el sandbox: solo puede escribir en el worktree y en su carpeta temporal${
    missing.length ? `; ${missing.join(' y ')}` : ''
  }.`;
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
  // The proxy's socket is the only way out of the network namespace.
  if (p.proxy?.socket) args.push('--bind', p.proxy.socket, p.proxy.socket);
  args.push('--unshare-net', '--unshare-ipc', '--die-with-parent', '--new-session');
  // With the bridge, a pid namespace too: when the command ends, the bridge goes with it.
  if (p.proxy?.socket) args.push('--unshare-pid');
  args.push('--setenv', 'TMPDIR', p.tmp);
  if (p.proxy)
    for (const [k, v] of Object.entries(proxyEnv(p.proxy.port))) args.push('--setenv', k, v);
  return args;
}

/**
 * Linux, with the allow-list proxy: a small Node script that runs inside the sandbox, listens
 * on 127.0.0.1:<port> (loopback is up in bwrap's network namespace), forwards every
 * connection to the proxy's unix socket, and then runs the command (its exit code is passed
 * on). argv: <port> <socket> <file> <args...>.
 */
export const BRIDGE_JS = [
  "const net = require('net'), cp = require('child_process');",
  'const [port, sock, file, ...args] = process.argv.slice(1);',
  'const s = net.createServer((c) => {',
  '  const u = net.connect(sock);',
  "  c.on('error', () => u.destroy()); u.on('error', () => c.destroy());",
  '  c.pipe(u).pipe(c);',
  '});',
  "s.on('error', (e) => { console.error('proxy bridge: ' + e.message); process.exit(125); });",
  "s.listen(Number(port), '127.0.0.1', () => {",
  '  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;',
  "  const ch = cp.spawn(file, args, { stdio: 'inherit', env });",
  "  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => ch.kill(sig));",
  "  ch.on('error', () => process.exit(127));",
  "  ch.on('exit', (code, sig) => process.exit(code ?? (sig ? 128 : 1)));",
  '});',
].join('\n');

/** The whole bwrap command line (after `bwrap`). With the proxy, the bridge runs first with
 * `node` (Electron's own binary as Node) and starts the shell. */
export function bwrapCommand(p: SandboxPaths, command: string, node: string): string[] {
  const shell = ['/bin/bash', '-lc', command];
  if (!p.proxy?.socket) return [...bwrapArgs(p), '--', ...shell];
  return [
    ...bwrapArgs(p),
    '--setenv',
    'ELECTRON_RUN_AS_NODE',
    '1',
    '--',
    node,
    '-e',
    BRIDGE_JS,
    String(p.proxy.port),
    p.proxy.socket,
    ...shell,
  ];
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
    // The allow-list proxy is the only host it may reach (the proxy decides what goes out).
    ...(p.proxy ? [`(allow network-outbound (remote ip "localhost:${p.proxy.port}"))`] : []),
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
