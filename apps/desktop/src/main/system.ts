import { spawn } from 'node:child_process';
import dnsCb, { promises as dns } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir, networkInterfaces, platform } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ToolDefinition } from '@omni/shared';
import { redact, registerSecret } from '@omni/security';

/**
 * Tools that reach beyond the project folder: the network, external services and
 * databases, system files and environment variables. Every one of them is shown to the
 * user with a risk level and a plain-language warning before it runs; high-risk ones are
 * approved one by one (never "always"), and system file changes are backed up so they can
 * be reverted.
 */

export type Risk = 'medium' | 'high';

export const SYSTEM_TOOLS: ToolDefinition[] = [
  {
    name: 'network_status',
    description:
      'Inspect the network: active connections and listening ports (with the process when available), network interfaces, and optionally test a host (DNS, TCP connect latency, HTTP status). Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            'Optional host, host:port or URL to test, e.g. "api.example.com" or "localhost:5432"',
        },
        connections: {
          type: 'boolean',
          description: 'Include active connections/ports (default true)',
        },
      },
    },
  },
  {
    name: 'http_request',
    description:
      'Send an HTTP request to an external service or local API (REST, Supabase, webhooks, health checks) and return status, headers and body (truncated). GET needs approval per site; POST/PUT/PATCH/DELETE need approval every time.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        url: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { type: 'string', description: 'Raw body (e.g. JSON text)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'sql_query',
    description:
      'Run a SQL query against a database. "database" is a SQLite file path, or a postgres://… / mysql://… connection URL (uses the psql / mysql client if installed). SELECT-only queries need approval once per database; any other statement needs approval every time.',
    parameters: {
      type: 'object',
      properties: {
        database: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['database', 'query'],
    },
  },
  {
    name: 'read_system_file',
    description:
      'Read a file outside the project (absolute path or ~/…), e.g. ~/.bashrc, /etc/hosts, a config file. Credential stores (SSH keys, keychains, browser profiles, cloud credentials) are always refused. Requires user approval.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_system_file',
    description:
      'Create or change a file outside the project (absolute path or ~/…). Either give "content" (whole file) or "old_string"+"new_string" (exact unique replacement). A backup is kept and the change can be reverted. Requires approval every time. Root-owned files fail: then use run_command with admin=true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'set_env_var',
    description:
      'Set an environment variable. scope "session" applies it to the commands you run in this conversation; scope "user" makes it permanent for the user (shell profile on Linux/macOS, user environment on Windows; new terminals pick it up). Requires approval every time.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'string' },
        scope: { type: 'string', enum: ['session', 'user'] },
      },
      required: ['name', 'value', 'scope'],
    },
  },
];

export const SYSTEM_PROMPT_PART = `- Beyond the project (always shown to the user with a risk warning and approval):
  - network_status: active connections, listening ports, interfaces, and DNS/TCP/HTTP tests to a host.
  - http_request: call external services and APIs (REST, Supabase, webhooks). Methods other than GET/HEAD can change remote data: say so before using them.
  - sql_query: query SQLite files or postgres:// / mysql:// databases. Prefer SELECT; explain any statement that changes data first.
  - read_system_file / write_system_file: files outside the project (shell profiles, /etc/hosts, app configs). Changes are backed up and reversible.
  - set_env_var: environment variables for this session or permanently for the user.
  - run_command also accepts "cwd" (a folder outside the project) and "admin": true, which asks the operating system for the user's administrator password in its own dialog (you never see it). Use admin only when truly needed and explain why.
  Before any of these, tell the user in one sentence what you will do and why. Never touch credentials, keys or password stores.`;

// ---------------------------------------------------------------------------------------
// Paths

export function expandPath(p: string): string {
  const s = p.trim();
  if (s === '~') return homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return join(homedir(), s.slice(2));
  if (!isAbsolute(s)) throw new Error('Usa una ruta absoluta o que empiece con ~/');
  return normalize(s);
}

function realish(p: string): string {
  // Resolve symlinks of the longest existing prefix (a link must not dodge the deny list).
  let cur = p;
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(cur.slice(parent.length).replace(/^[\\/]/, ''));
    cur = parent;
  }
  try {
    return join(realpathSync(cur), ...rest);
  } catch {
    return p;
  }
}

/** Credential stores and secrets: never read or written by the AI. */
/** The app's own data folders (config, vault, history), wherever paths.ts placed them. */
let appDirs: string[] = [];
export function setAppDataDirs(dirs: string[]): void {
  appDirs = [...new Set(dirs)].map((d) => realish(resolve(d)).replace(/\\/g, '/'));
}

export function deniedPath(input: string, mode: 'read' | 'write'): string | null {
  const p = realish(resolve(input)).replace(/\\/g, '/');
  if (appDirs.some((d) => p === d || p.startsWith(`${d}/`)))
    return 'Por seguridad la IA no puede acceder a contraseñas, llaves ni credenciales.';
  const home = homedir().replace(/\\/g, '/');
  const rel = p.startsWith(`${home}/`) ? p.slice(home.length + 1) : null;
  const H = (re: RegExp) => rel !== null && re.test(rel);
  const secret =
    H(/^\.ssh\/(?!config$|known_hosts$)/) ||
    H(/^\.gnupg(\/|$)/) ||
    H(/^\.omni(\/|$)/) ||
    H(/^\.config\/Zinarix Studio(\/|$)/) ||
    H(/^\.aws\/(credentials$|sso\/cache\/|cli\/cache\/)/) ||
    H(/^\.kube\/config$/) ||
    H(/^\.npmrc$/) ||
    H(/^\.pypirc$/) ||
    H(/^\.pgpass$/) ||
    H(/^\.config\/gh\/hosts\.ya?ml$/) ||
    H(/^\.(bash|zsh|sh|python|psql|mysql|node_repl|sqlite)_history$/) ||
    H(/^\.local\/share\/fish\/fish_history$/) ||
    H(/^\.azure(\/|$)/) ||
    H(/^\.config\/gcloud(\/|$)/) ||
    H(/^\.netrc$/) ||
    H(/^\.git-credentials$/) ||
    H(/^\.docker\/config\.json$/) ||
    H(/^\.password-store(\/|$)/) ||
    H(/^\.local\/share\/keyrings(\/|$)/) ||
    H(/^\.mozilla(\/|$)/) ||
    H(/^\.config\/(google-chrome|chromium|BraveSoftware|microsoft-edge|vivaldi|opera)(\/|$)/) ||
    H(/^Library\/(Keychains|Cookies)(\/|$)/) ||
    H(
      /^Library\/Application Support\/(Google|Firefox|BraveSoftware|Microsoft Edge|Zinarix Studio)(\/|$)/,
    ) ||
    H(
      /^AppData\/(Roaming|Local)\/(Microsoft\/(Credentials|Protect|Vault)|Google\/Chrome|Mozilla|BraveSoftware|Zinarix Studio)(\/|$)/i,
    ) ||
    /^\/etc\/(shadow|gshadow|sudoers)(\.d)?(\/|$)/.test(p) ||
    // Another process's environment and memory hold the keys it was started with.
    /^\/proc\/(?:[^/]+\/)*(environ|mem)$/.test(p) ||
    /^\/(root|private\/var\/db)(\/|$)/.test(p);
  if (secret) return 'Por seguridad la IA no puede acceder a contraseñas, llaves ni credenciales.';
  if (
    mode === 'write' &&
    (/^\/(bin|sbin|boot|lib|lib32|lib64|usr\/(bin|sbin|lib)|System|proc|sys|dev)(\/|$)/.test(p) ||
      /^[a-z]:\/windows(\/|$)/i.test(p))
  )
    return 'Por seguridad la IA no modifica archivos del sistema operativo.';
  return null;
}

// ---------------------------------------------------------------------------------------
// Risk and warnings shown in the approval card

export interface SystemPreview {
  risk: Risk;
  warning: string;
  /** Key for "always allow" in this conversation; absent = must be approved every time. */
  allowKey?: string;
  action: string;
  url?: string;
  path?: string;
  before?: string;
  after?: string;
  command?: string;
}

/**
 * Conservative: anything that is not clearly a single read statement counts as a write
 * (reads are additionally executed in read-only mode by the database itself).
 */
export function isWriteSql(query: string): boolean {
  const q = query
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .replace(/;\s*$/, '');
  if (q.includes(';')) return true;
  if (!/^(select|with|explain|show|describe|desc|pragma\s+\w+\s*$|values)\b/i.test(q)) return true;
  return /\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|merge|attach|detach|vacuum|copy|call|exec|execute|lock|reindex|rename|into)\b/i.test(
    q,
  );
}

/**
 * psql and the mysql client run their own commands besides SQL: `\! cmd` / `system cmd`
 * start a shell, `\o |cmd` / `pager cmd` pipe output to one, `\i` / `source` read files.
 * sql_query is for SQL only; a query carrying any of them is refused (run_command exists
 * for shell work, with its own approval).
 */
export function sqlClientCommand(query: string): string | null {
  const q = query.replace(/'(?:[^'\\]|''|\\.)*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (q.includes('\\'))
    return 'La consulta contiene comandos del cliente (\\…), que pueden ejecutar programas. Solo se permite SQL.';
  if (/^\s*(system|source|pager|tee|edit|connect|delimiter)\b/im.test(q))
    return 'La consulta contiene comandos del cliente mysql (system, source, pager…). Solo se permite SQL.';
  return null;
}

/** Max size of a request body the AI can send (the approval card shows the start of it). */
const MAX_REQUEST_BODY = 1024 * 1024;

const CREDENTIAL_HEADER = /authorization|api[-_]?key|token|cookie|secret|password|session/i;

/** Request headers as shown to the user: credential values masked, the rest redacted. */
export function headerLines(h: unknown): string[] {
  if (!h || typeof h !== 'object') return [];
  return Object.entries(h as Record<string, unknown>).map(([k, v]) => {
    const value = String(v);
    return `${k}: ${CREDENTIAL_HEADER.test(k) ? `••• (${value.length} caracteres)` : redact(value).slice(0, 500)}`;
  });
}

function isSecretName(name: string): boolean {
  return /key|token|secret|password|passwd|pwd|credential|auth/i.test(name);
}

function dbLabel(db: string): string {
  try {
    const u = new URL(db);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return db;
  }
}

export async function systemPreview(
  name: string,
  a: Record<string, unknown>,
): Promise<SystemPreview> {
  switch (name) {
    case 'network_status':
      return {
        risk: 'medium',
        warning:
          'La IA verá las conexiones de red activas y los puertos abiertos de tu equipo (y qué programas los usan). No cambia nada.',
        allowKey: 'network_status',
        action: a.target ? `revisar la red y probar ${String(a.target)}` : 'revisar la red',
      };
    case 'http_request': {
      const method = String(a.method ?? 'GET').toUpperCase();
      const url = String(a.url ?? '');
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        // shown as typed
      }
      const safe = method === 'GET' || method === 'HEAD';
      const headers = headerLines(a.headers);
      const body = a.body !== undefined && !safe ? String(a.body) : '';
      if (body.length > MAX_REQUEST_BODY)
        throw new Error(`El cuerpo de la petición supera ${MAX_REQUEST_BODY / 1024} KB.`);
      // Everything the request carries is shown: a header or the query string can carry data
      // out as well as a body. "Always" covers only this exact request (URL and headers), so
      // a later call cannot reuse it to send something else to the same host.
      const shown = [
        headers.length ? `Cabeceras:\n${headers.join('\n')}` : '',
        body ? `Cuerpo:\n${redact(body.slice(0, 4000))}${body.length > 4000 ? '\n…' : ''}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      return {
        risk: safe ? 'medium' : 'high',
        warning: safe
          ? `La IA se conectará a ${host}. Ese servicio verá la petición (y tu dirección IP).${headers.length ? ' Revisa las cabeceras: también pueden llevar datos.' : ''}`
          : `⚠️ ${method} puede crear, modificar o borrar datos en ${host}. Revisa el contenido antes de aprobar.`,
        allowKey: safe ? `http:${method} ${url} ${headers.join('\n')}` : undefined,
        action: `${method} ${url}`,
        url,
        command: shown || undefined,
      };
    }
    case 'sql_query': {
      const query = String(a.query ?? '');
      const client = /^(postgres(ql)?|mysql):\/\//i.test(String(a.database ?? ''))
        ? sqlClientCommand(query)
        : null;
      if (client) throw new Error(client);
      const writes = isWriteSql(query);
      const db = dbLabel(String(a.database ?? ''));
      return {
        risk: writes ? 'high' : 'medium',
        warning: writes
          ? `⚠️ Esta consulta puede MODIFICAR o BORRAR datos de ${db}. Asegúrate de tener un respaldo.`
          : `La IA leerá datos de ${db}.`,
        allowKey: writes ? undefined : `sql:${db}`,
        action: writes ? 'modificar la base de datos' : 'consultar la base de datos',
        command: query,
      };
    }
    case 'read_system_file':
      return {
        risk: 'medium',
        warning:
          'La IA leerá un archivo fuera de tu proyecto. Puede contener información personal.',
        action: 'leer archivo del sistema',
        path: String(a.path ?? ''),
      };
    case 'write_system_file': {
      const path = String(a.path ?? '');
      let before = '';
      try {
        before = await readFile(expandPath(path), 'utf8');
      } catch {
        // new file
      }
      const after =
        typeof a.content === 'string'
          ? a.content
          : before.replace(String(a.old_string ?? ''), () => String(a.new_string ?? ''));
      return {
        risk: 'high',
        warning:
          '⚠️ La IA modificará un archivo FUERA de tu proyecto. Esto puede cambiar cómo funciona tu sistema o tus programas. Se guarda un respaldo y puedes revertirlo.',
        action: 'modificar archivo del sistema',
        path,
        before,
        after,
      };
    }
    case 'set_env_var': {
      const n = String(a.name ?? '');
      // Refused before the approval card: approving it would not run anyway.
      validateEnvName(n);
      const v = String(a.value ?? '');
      const shown = isSecretName(n) ? `${v.slice(0, 3)}…(${v.length} caracteres)` : v;
      const exec = execEnvVar(n);
      return {
        risk: a.scope === 'user' || exec ? 'high' : 'medium',
        warning: exec
          ? `⚠️ ${n} decide qué programa se ejecuta o qué carga al arrancar. Con este valor, comandos que ya aprobaste podrían ejecutar otra cosa${a.scope === 'user' ? ' (y quedará PERMANENTE en tu perfil)' : ''}. Apruébalo solo si entiendes el valor.`
          : a.scope === 'user'
            ? `⚠️ La variable ${n} quedará guardada de forma PERMANENTE para tu usuario (perfil de la terminal). Afecta a todos tus programas nuevos. Puedes revertirlo.`
            : `La variable ${n} se usará solo en los comandos de esta conversación.`,
        allowKey: undefined,
        action: `${n}=${shown} (${a.scope === 'user' ? 'permanente' : 'esta sesión'})`,
      };
    }
  }
  return { risk: 'high', warning: 'Acción fuera del proyecto.', action: name };
}

/** Warning for run_command when it leaves the project or asks for admin rights. */
export function commandWarning(
  a: Record<string, unknown>,
  workspaceRoot: string | undefined,
): SystemPreview | null {
  const admin = a.admin === true;
  const cwd = typeof a.cwd === 'string' && a.cwd.trim() ? expandPath(a.cwd) : undefined;
  const outside = cwd && (!workspaceRoot || !(cwd + sep).startsWith(workspaceRoot + sep));
  if (!admin && !outside) return null;
  return {
    risk: 'high',
    warning: admin
      ? '⚠️ Este comando se ejecutará como ADMINISTRADOR. Tu sistema te pedirá tu contraseña en su propia ventana (la IA nunca la ve). Un comando de administrador puede cambiar o dañar el sistema: léelo con cuidado.'
      : `⚠️ Este comando se ejecutará FUERA de tu proyecto, en ${cwd}.`,
    action: admin ? 'comando como administrador' : 'comando fuera del proyecto',
    command: String(a.command ?? ''),
  };
}

/** Wraps a command so the OS asks for the admin password in its own dialog. */
export function adminCommand(command: string): { file: string; args: string[] } {
  if (platform() === 'darwin') {
    const esc = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      file: 'osascript',
      args: ['-e', `do shell script "${esc}" with administrator privileges`],
    };
  }
  if (platform() === 'win32') {
    // UAC prompt; output is written to a temp file and printed afterwards.
    const tmp = join(process.env.TEMP ?? 'C:\\Windows\\Temp', `zinarix-admin-${Date.now()}.log`);
    const inner = `${command} *>&1 | Out-File -Encoding utf8 '${tmp}'`;
    const encoded = Buffer.from(inner, 'utf16le').toString('base64');
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-Command',
        `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'; if (Test-Path '${tmp}') { Get-Content '${tmp}'; Remove-Item '${tmp}' }; exit $p.ExitCode`,
      ],
    };
  }
  // Linux: pkexec shows the desktop's graphical password dialog (polkit).
  return { file: 'pkexec', args: ['/bin/sh', '-c', command] };
}

// ---------------------------------------------------------------------------------------
// Execution

const MAX_BODY = 30_000;

function exec(
  file: string,
  args: string[],
  opts: { input?: string; timeout?: number; env?: Record<string, string> } = {},
): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const child = spawn(file, args, {
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    const add = (d: Buffer) => {
      if (out.length < 2_000_000) out += d.toString('utf8');
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => child.kill(), opts.timeout ?? 30_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      res({ code: 127, out: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ code: code ?? 1, out });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

function cut(s: string, max = MAX_BODY): string {
  return s.length > max ? `${s.slice(0, max)}\n… [${s.length - max} caracteres más]` : s;
}

async function tcpProbe(host: string, port: number): Promise<string> {
  const t0 = Date.now();
  return new Promise((res) => {
    const sock = connect({ host, port, timeout: 5000 });
    sock.once('connect', () => {
      res(`TCP ${host}:${port} abierto (${Date.now() - t0} ms)`);
      sock.destroy();
    });
    sock.once('timeout', () => {
      res(`TCP ${host}:${port} sin respuesta (timeout 5 s)`);
      sock.destroy();
    });
    sock.once('error', (e) => res(`TCP ${host}:${port} error: ${e.message}`));
  });
}

export async function networkStatus(
  target: string | undefined,
  connections: boolean,
): Promise<string> {
  const parts: string[] = [];
  const ifs = Object.entries(networkInterfaces())
    .map(
      ([n, list]) =>
        `${n}: ${(list ?? []).map((i) => `${i.address}${i.internal ? ' (interna)' : ''}`).join(', ')}`,
    )
    .join('\n');
  parts.push(`== Interfaces ==\n${ifs}`);
  if (connections) {
    const os = platform();
    const r =
      os === 'win32'
        ? await exec('netstat', ['-ano'])
        : os === 'darwin'
          ? await exec('lsof', ['-nP', '-iTCP', '-iUDP'])
          : await exec('ss', ['-tunap']).then((x) =>
              x.code === 127 ? exec('netstat', ['-tunap']) : x,
            );
    parts.push(`== Conexiones y puertos ==\n${cut(r.out.trim(), 20_000)}`);
  }
  if (target) {
    let host = target.trim();
    let port = 443;
    let url: URL | undefined;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`);
      host = url.hostname;
      port = Number(url.port) || (url.protocol === 'http:' ? 80 : 443);
    } catch {
      // keep raw host
    }
    const lines: string[] = [];
    try {
      const addrs = await dns.lookup(host, { all: true });
      lines.push(`DNS ${host} → ${addrs.map((x) => x.address).join(', ')}`);
    } catch (e) {
      lines.push(`DNS ${host} falló: ${(e as Error).message}`);
    }
    lines.push(await tcpProbe(host, port));
    if (url && /^https?:/.test(url.protocol) && ![5432, 3306, 6379, 27017].includes(port)) {
      const t0 = Date.now();
      try {
        const r = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(8000),
          redirect: 'manual',
        });
        lines.push(`HTTP ${r.status} ${r.statusText} (${Date.now() - t0} ms)`);
      } catch (e) {
        lines.push(`HTTP falló: ${(e as Error).message}`);
      }
    }
    parts.push(`== Prueba de ${target} ==\n${lines.join('\n')}`);
  }
  return redact(parts.join('\n\n'));
}

export async function httpRequest(
  a: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ ok: boolean; text: string }> {
  const method = String(a.method ?? 'GET').toUpperCase();
  const url = new URL(String(a.url ?? ''));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Solo http(s).');
  await assertNotMetadata(url.hostname);
  const headers: Record<string, string> = {};
  if (a.headers && typeof a.headers === 'object')
    for (const [k, v] of Object.entries(a.headers as Record<string, unknown>)) {
      headers[k] = String(v);
      if (/authorization|api[-_]?key|token|cookie/i.test(k))
        registerSecret(String(v).replace(/^Bearer\s+/i, ''));
    }
  const body =
    a.body !== undefined && method !== 'GET' && method !== 'HEAD' ? String(a.body) : undefined;
  if (body !== undefined && Buffer.byteLength(body) > MAX_REQUEST_BODY)
    throw new Error(`El cuerpo de la petición supera ${MAX_REQUEST_BODY / 1024} KB.`);
  const t0 = Date.now();
  // Redirects are not followed: an approved host could bounce the request (with its
  // headers) to another one. The model gets the Location and must ask again. The address
  // actually connected to is checked too (guardedLookup), so a DNS answer that changes
  // between the check above and the connection cannot reach the metadata service.
  const r = await rawRequest(url, method, headers, body, signal);
  const hdrs = r.headers
    .filter(([k]) => !/set-cookie/i.test(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const location = r.status >= 300 && r.status < 400 ? r.location : null;
  let note = '';
  if (location) {
    let target = location;
    try {
      target = new URL(location, url).toString();
    } catch {
      // shown as sent
    }
    note = `\n\n(Redirección a ${target}: no se siguió. Si hace falta, pide esa URL con otra llamada a http_request; el usuario la aprobará.)`;
  }
  return {
    ok: r.status >= 200 && r.status < 300,
    text: redact(
      `${method} ${url.toString()}\nHTTP ${r.status} ${r.statusText} · ${Date.now() - t0} ms\n${hdrs}\n\n${cut(method === 'HEAD' ? '' : r.body)}${note}`,
    ),
  };
}

/** One HTTP(S) exchange, no redirects, response capped at MAX_RESPONSE bytes. */
function rawRequest(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  signal: AbortSignal,
): Promise<{
  status: number;
  statusText: string;
  headers: [string, string][];
  location: string | null;
  body: string;
}> {
  return new Promise((res, rej) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method,
        headers,
        lookup: guardedLookup,
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      },
      (resp) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let cutShort = false;
        resp.on('data', (d: Buffer) => {
          if (cutShort) return;
          chunks.push(d);
          size += d.length;
          if (size > MAX_RESPONSE) {
            cutShort = true;
            resp.destroy();
            finish();
          }
        });
        resp.on('end', () => finish());
        resp.on('error', (e) => (cutShort ? finish() : rej(e)));
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          const text = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_RESPONSE));
          const loc = resp.headers.location;
          res({
            status: resp.statusCode ?? 0,
            statusText: resp.statusMessage ?? '',
            headers: Object.entries(resp.headers).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(', ') : String(v ?? ''),
            ]),
            location: typeof loc === 'string' ? loc : null,
            body: cutShort ? `${text}\n… [respuesta cortada en ${MAX_RESPONSE} bytes]` : text,
          });
        };
      },
    );
    req.on('error', rej);
    req.end(body);
  });
}

/**
 * dns.lookup for outgoing AI requests that refuses cloud metadata addresses, so the check
 * applies to the address the socket really connects to (no DNS-rebinding window).
 */
export const guardedLookup = ((
  hostname: string,
  options: LookupOptions,
  cb: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => {
  dnsCb.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, '');
    const list = addrs as LookupAddress[];
    if (list.some((x) => isMetadataAddress(x.address)))
      return cb(Object.assign(new Error(METADATA_DENIED), { code: 'EACCES' }), '');
    if (options.all) return cb(null, list);
    const first = list[0];
    if (!first)
      return cb(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), '');
    cb(null, first.address, first.family);
  });
}) as unknown as LookupFunction;

const MAX_RESPONSE = 5 * 1024 * 1024;

/** Response body as text, at most `max` bytes (a hostile server cannot exhaust memory). */
export async function readCapped(r: Response, max: number): Promise<string> {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cutShort = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > max) {
      cutShort = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
  return cutShort ? `${text}\n… [respuesta cortada en ${max} bytes]` : text;
}

/**
 * Cloud metadata services hand out the machine's cloud credentials. Checked on every
 * address the name resolves to, so other spellings (decimal IP, IPv6-mapped, a DNS name
 * pointing there) are caught too. The LAN and localhost stay reachable on purpose.
 */
export async function assertNotMetadata(hostname: string): Promise<void> {
  const name = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    /^(metadata(\.google\.internal)?|metadata\.azure\.com|instance-data(\.ec2\.internal)?)\.?$/.test(
      name,
    )
  )
    throw new Error(METADATA_DENIED);
  let addrs: string[] = [name];
  try {
    addrs = (await dns.lookup(name, { all: true, verbatim: true })).map((x) => x.address);
  } catch {
    // unresolvable: fetch will fail on its own
  }
  if (addrs.some(isMetadataAddress)) throw new Error(METADATA_DENIED);
}

const METADATA_DENIED = 'Por seguridad no se permite el servicio de metadatos de la nube.';

export function isMetadataAddress(ip: string): boolean {
  const raw = ip
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  // IPv4 carried inside IPv6: mapped (::ffff:), compatible (::) and NAT64 (64:ff9b::).
  const a = raw.replace(/^(::ffff:(0:)?|::|64:ff9b::)(?=\d+\.\d+\.\d+\.\d+$)/, '');
  return (
    /^169\.254\./.test(a) || // link-local: AWS, GCP, Azure, OpenStack metadata
    a === '100.100.100.200' || // Alibaba Cloud
    /^fe[89ab][0-9a-f]:/.test(a) || // IPv6 link-local fe80::/10
    a === 'fd00:ec2::254' || // AWS IMDS over IPv6
    /^(::ffff:(0:)?|::|64:ff9b::)a9fe:/.test(raw) // the same IPv4 forms written in hex
  );
}

/**
 * `base` resolves a relative SQLite path (the open project); without it a relative path is
 * refused instead of landing wherever the app happened to start.
 */
export async function sqlQuery(
  database: string,
  query: string,
  base?: (rel: string) => string,
): Promise<string> {
  if (/^(postgres(ql)?|mysql):\/\//i.test(database)) {
    const client = sqlClientCommand(query);
    if (client) throw new Error(client);
  }
  if (/^postgres(ql)?:\/\//i.test(database)) {
    const u = new URL(database);
    // The password goes in the environment (PGPASSWORD), never in argv: every local user
    // can read a process's command line (ps, /proc/<pid>/cmdline).
    const env: Record<string, string> = {};
    if (u.password) {
      const pw = decodeURIComponent(u.password);
      registerSecret(pw);
      env.PGPASSWORD = pw;
      u.password = '';
    }
    const ro = isWriteSql(query)
      ? []
      : ['-c', 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'];
    const r = await exec(
      'psql',
      [u.toString(), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', ...ro, '-c', query],
      { timeout: 120_000, env },
    );
    if (r.code === 127)
      throw new Error('No está instalado el cliente psql. Instálalo o usa run_command.');
    return redact(cut(r.out));
  }
  if (/^mysql:\/\//i.test(database)) {
    const u = new URL(database);
    const env: Record<string, string> = {};
    if (u.password) {
      registerSecret(decodeURIComponent(u.password));
      env.MYSQL_PWD = decodeURIComponent(u.password);
    }
    const args = [
      '-h',
      u.hostname,
      '-P',
      u.port || '3306',
      '-u',
      decodeURIComponent(u.username),
      '--table',
    ];
    const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
    // Never let a URL part become a client option (e.g. "--plugin-dir=…").
    if ([db, u.hostname, decodeURIComponent(u.username)].some((v) => v.startsWith('-')))
      throw new Error('URL de base de datos inválida.');
    if (db) args.push(db);
    const input = isWriteSql(query) ? query : `SET SESSION TRANSACTION READ ONLY;\n${query}`;
    const r = await exec('mysql', args, { input, timeout: 120_000, env });
    if (r.code === 127)
      throw new Error('No está instalado el cliente mysql. Instálalo o usa run_command.');
    return redact(cut(r.out));
  }
  // SQLite file
  let path: string;
  if (database.startsWith('~') || isAbsolute(database)) path = expandPath(database);
  else if (base) path = base(database);
  else throw new Error('Abre una carpeta o usa una ruta absoluta para la base de datos SQLite.');
  const denied = deniedPath(path, 'read');
  if (denied) throw new Error(denied);
  if (!existsSync(path)) throw new Error(`No existe la base de datos ${path}`);
  const writes = isWriteSql(query);
  const db = new DatabaseSync(path, { readOnly: !writes });
  try {
    if (writes) {
      db.exec(query);
      return `OK: sentencia ejecutada en ${path}`;
    }
    const rows = db.prepare(query).all() as Record<string, unknown>[];
    if (!rows.length) return '(0 filas)';
    const cols = Object.keys(rows[0]!);
    const lines = [cols.join(' | '), cols.map(() => '---').join(' | ')];
    for (const row of rows.slice(0, 500))
      lines.push(cols.map((c) => String(row[c] ?? 'NULL')).join(' | '));
    if (rows.length > 500) lines.push(`… ${rows.length - 500} filas más`);
    return redact(cut(lines.join('\n')));
  } finally {
    db.close();
  }
}

export async function readSystemFile(path: string): Promise<string> {
  const abs = expandPath(path);
  const denied = deniedPath(abs, 'read');
  if (denied) throw new Error(denied);
  const st = await stat(abs);
  if (!st.isFile()) throw new Error(`${abs} no es un archivo normal.`);
  if (st.size > 20 * 1024 * 1024) throw new Error(`${abs} es demasiado grande (más de 20 MB).`);
  const text = await readFile(abs, 'utf8');
  return redact(cut(text, 200_000));
}

/** Writes a system file after backing it up; returns the previous content (null = new). */
export async function writeSystemFile(
  path: string,
  a: Record<string, unknown>,
  backupDir: string,
): Promise<{ abs: string; before: string | null; backup: string | null }> {
  const abs = expandPath(path);
  const denied = deniedPath(abs, 'write');
  if (denied) throw new Error(denied);
  const before = existsSync(abs) ? await readFile(abs, 'utf8') : null;
  let next: string;
  if (typeof a.content === 'string') next = a.content;
  else {
    const oldS = String(a.old_string ?? '');
    const count = oldS && before ? before.split(oldS).length - 1 : 0;
    if (count !== 1)
      throw new Error(
        count === 0
          ? 'old_string no se encontró en el archivo.'
          : `old_string aparece ${count} veces.`,
      );
    next = before!.replace(oldS, () => String(a.new_string ?? ''));
  }
  let backup: string | null = null;
  if (before !== null) {
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    await pruneBackups(backupDir);
    backup = join(backupDir, `${Date.now()}-${abs.replace(/[\\/:]+/g, '_')}`);
    await writeFile(backup, before, { mode: 0o600 });
  }
  try {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, next, 'utf8');
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code === 'EACCES' ||
      (e as NodeJS.ErrnoException).code === 'EPERM'
    )
      throw new Error(
        `Sin permiso para escribir ${abs}. Es un archivo protegido: usa run_command con admin=true (el sistema pedirá la contraseña al usuario).`,
      );
    throw e;
  }
  return { abs, before, backup };
}

const BACKUP_DAYS = 14;

/** Backups can hold secrets (config files): they are kept for two weeks, not forever. */
export async function pruneBackups(dir: string, now = Date.now()): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const ts = Number(name.split('-')[0]);
    if (Number.isFinite(ts) && now - ts > BACKUP_DAYS * 86_400_000)
      await rm(join(dir, name), { force: true });
  }
}

/** Shell profile used for permanent variables on Linux/macOS. */
export function profileFile(): string {
  const shell = process.env.SHELL ?? '';
  if (shell.endsWith('zsh')) return join(homedir(), '.zshrc');
  if (shell.endsWith('fish'))
    return join(homedir(), '.config', 'fish', 'conf.d', 'zinarix-env.fish');
  return join(homedir(), '.bashrc');
}

export function validateEnvName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Nombre de variable inválido.');
  if (/^OMNI_/i.test(name)) throw new Error('Las variables OMNI_* las administra Zinarix Studio.');
  if (blockedEnvVar(name)) throw new Error('Por seguridad la IA no puede cambiar esa variable.');
}

/**
 * Variables that make the shell, the dynamic loader or a common interpreter run other code
 * (or a different program) without the command saying so: a later approved command would
 * silently become something else. The AI never sets them; the user can, in a terminal.
 */
export function blockedEnvVar(name: string): boolean {
  return /^(LD_.*|DYLD_.*|BASH_ENV|ENV|PROMPT_COMMAND|ZDOTDIR|PS4|SHELLOPTS|BASHOPTS|IFS|PATH|NODE_OPTIONS|PYTHONSTARTUP|PYTHONPATH|PYTHONHOME|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|GIT_.*_COMMAND|GIT_SSH|GIT_ASKPASS|GIT_EXEC_PATH|GIT_CONFIG_.*|SSH_ASKPASS|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|DOTNET_STARTUP_HOOKS|ELECTRON_RUN_AS_NODE)$/i.test(
    name,
  );
}

/**
 * Variables with legitimate uses that also decide which program actually runs (or what it
 * loads first): a later approved command could silently become a different one.
 */
export function execEnvVar(name: string): boolean {
  return /^(PATH|HOME|NODE_OPTIONS|NODE_PATH|NPM_CONFIG_.*|GIT_(SSH|SSH_COMMAND|EXEC_PATH|PAGER|EDITOR|ASKPASS|CONFIG.*|DIR|WORK_TREE|PROXY_COMMAND)|SSH_ASKPASS|EDITOR|VISUAL|PAGER|PYTHONPATH|PYTHONSTARTUP|PYTHONHOME|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CARGO_HOME|RUSTC_WRAPPER|GOFLAGS|DOTNET_STARTUP_HOOKS|ELECTRON_RUN_AS_NODE)$/i.test(
    name,
  );
}

/** New content of the profile with NAME set (replacing a previous line it wrote). */
export function profileWithVar(
  content: string,
  name: string,
  value: string,
  fish: boolean,
): string {
  const quoted = `'${value.replace(/'/g, fish ? "\\'" : `'\\''`)}'`;
  const line = fish ? `set -gx ${name} ${quoted} # zinarix` : `export ${name}=${quoted} # zinarix`;
  const re = new RegExp(`^(export ${name}=|set -gx ${name} ).*# zinarix$`, 'm');
  if (re.test(content)) return content.replace(re, () => line);
  return `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`;
}

export async function setUserEnvWindows(name: string, value: string): Promise<string> {
  const r = await exec('setx', [name, value]);
  if (r.code !== 0) throw new Error(r.out.trim() || `setx terminó con código ${r.code}`);
  return 'Guardada en las variables de usuario de Windows (las terminales nuevas la verán).';
}

export { exec as execFile, isSecretName };
