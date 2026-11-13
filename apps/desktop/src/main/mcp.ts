/**
 * MCP (Model Context Protocol) client: Zinarix's own agent can use the tools of MCP servers
 * the user configures (Slack, Figma, databases…), like Cursor or Claude Desktop.
 *
 * Config (same shape as Cursor / Claude Desktop):
 *   { "mcpServers": { "name": { "command": "npx", "args": [...], "env": {...} }
 *                     "other": { "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } } } }
 * - global:  <userData>/mcp.json (edited from Settings)
 * - project: <root>/.zinarix/mcp.json or <root>/.cursor/mcp.json — only used once the user
 *   trusts that exact file (a project file can make the app run commands), and again after
 *   every change to it.
 *
 * Transports: stdio (newline-delimited JSON-RPC) and Streamable HTTP (POST, JSON or SSE
 * answers, Mcp-Session-Id). Every tool call goes through the agent's approval cards.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '@omni/shared';
import { registerSecret } from '@omni/security';
import { childEnv } from './env.js';

export const MCP_PROTOCOL = '2025-06-18';
const FALLBACK_PROTOCOLS = ['2025-03-26', '2024-11-05'];
const CONNECT_TIMEOUT = 20_000;
const CALL_TIMEOUT = 120_000;
const MAX_RESULT = 60_000;
export const MCP_PREFIX = 'mcp__';

// ---------------------------------------------------------------- config

export interface McpStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
}
export interface McpHttpConfig {
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}
export type McpServerConfig = McpStdioConfig | McpHttpConfig;

export interface ParsedConfig {
  servers: Record<string, McpServerConfig>;
  errors: string[];
}

const strMap = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
  return out;
};

/** Reads a Cursor / Claude style config. Bad entries are reported, the rest still load. */
export function parseMcpConfig(text: string): ParsedConfig {
  const errors: string[] = [];
  const servers: Record<string, McpServerConfig> = {};
  if (!text.trim()) return { servers, errors };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { servers, errors: [`JSON inválido: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const list = (root.mcpServers ?? root.servers) as unknown;
  if (!list || typeof list !== 'object' || Array.isArray(list)) {
    errors.push('Falta el objeto "mcpServers".');
    return { servers, errors };
  }
  for (const [name, raw] of Object.entries(list as Record<string, unknown>)) {
    if (!/^[\w.-]{1,40}$/.test(name)) {
      errors.push(`"${name}": el nombre solo puede tener letras, números, ".", "_" y "-" (máx. 40).`);
      continue;
    }
    if (!raw || typeof raw !== 'object') {
      errors.push(`"${name}": debe ser un objeto.`);
      continue;
    }
    const r = raw as Record<string, unknown>;
    const disabled = r.disabled === true ? { disabled: true } : {};
    if (typeof r.url === 'string') {
      let u: URL;
      try {
        u = new URL(r.url);
      } catch {
        errors.push(`"${name}": url inválida.`);
        continue;
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        errors.push(`"${name}": la url debe ser http(s).`);
        continue;
      }
      const headers = strMap(r.headers);
      servers[name] = { url: u.toString(), ...(headers ? { headers } : {}), ...disabled };
    } else if (typeof r.command === 'string' && r.command.trim()) {
      const args = Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === 'string') : [];
      const env = strMap(r.env);
      servers[name] = {
        command: r.command,
        args,
        ...(env ? { env } : {}),
        ...(typeof r.cwd === 'string' ? { cwd: r.cwd } : {}),
        ...disabled,
      };
    } else errors.push(`"${name}": necesita "command" (stdio) o "url" (HTTP).`);
  }
  return { servers, errors };
}

const SECRETISH = /key|token|secret|password|passwd|pwd|credential|auth|cookie|pat$/i;

/** Values of env vars / headers that look like credentials: masked wherever they appear. */
export function secretValues(cfg: McpServerConfig): string[] {
  const map = 'url' in cfg ? cfg.headers : cfg.env;
  const out: string[] = [];
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!SECRETISH.test(k) || v.length < 8) continue;
    out.push(v);
    const bearer = /^bearer\s+(.+)$/i.exec(v);
    if (bearer?.[1] && bearer[1].length >= 8) out.push(bearer[1]);
  }
  return out;
}

// ---------------------------------------------------------------- names

/** Provider limits: ^[a-zA-Z0-9_-]{1,64}$ */
export function sanitizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

/**
 * The agent-visible name of a tool, `mcp__<server>__<tool>`, at most 64 characters and
 * unique among `taken` (a short hash keeps long or clashing names apart).
 */
export function toolName(server: string, tool: string, taken: Set<string>): string {
  let name = `${MCP_PREFIX}${sanitizeName(server)}__${sanitizeName(tool)}`;
  if (name.length > 64 || taken.has(name)) {
    const h = createHash('sha1').update(`${server}\0${tool}`).digest('hex').slice(0, 6);
    name = `${name.slice(0, 57)}_${h}`;
  }
  taken.add(name);
  return name;
}

// ---------------------------------------------------------------- JSON-RPC framing

export interface RpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Splits a byte stream into newline-delimited JSON messages (stdio transport). */
export class LineDecoder {
  private buf = '';
  push(chunk: string): RpcMessage[] {
    this.buf += chunk;
    const out: RpcMessage[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        const v = JSON.parse(line) as unknown;
        for (const m of Array.isArray(v) ? v : [v])
          if (m && typeof m === 'object') out.push(m as RpcMessage);
      } catch {
        // not JSON (a server writing logs to stdout): ignored
      }
    }
    if (this.buf.length > 64 * 1024 * 1024) this.buf = '';
    return out;
  }
}

/** Parses Server-Sent Events text into the JSON-RPC messages of its `data:` fields. */
export class SseDecoder {
  private buf = '';
  push(chunk: string): RpcMessage[] {
    this.buf += chunk.replace(/\r\n?/g, '\n');
    const out: RpcMessage[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      try {
        const v = JSON.parse(data) as unknown;
        for (const m of Array.isArray(v) ? v : [v])
          if (m && typeof m === 'object') out.push(m as RpcMessage);
      } catch {
        // ignored
      }
    }
    return out;
  }
  flush(): RpcMessage[] {
    return this.buf.trim() ? this.push('\n\n') : [];
  }
}

// ---------------------------------------------------------------- results

interface ContentItem {
  type: string;
  text?: string;
  mimeType?: string;
  resource?: { uri?: string; text?: string; mimeType?: string };
  uri?: string;
  name?: string;
}

/** An MCP tools/call result as text for the model. */
export function resultText(result: unknown): { text: string; isError: boolean } {
  const r = (result ?? {}) as {
    content?: ContentItem[];
    structuredContent?: unknown;
    isError?: boolean;
  };
  const parts: string[] = [];
  for (const c of r.content ?? []) {
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
    else if (c.type === 'image') parts.push(`[image ${c.mimeType ?? ''}]`.replace(' ]', ']'));
    else if (c.type === 'audio') parts.push(`[audio ${c.mimeType ?? ''}]`.replace(' ]', ']'));
    else if (c.type === 'resource' && c.resource)
      parts.push(
        c.resource.text !== undefined
          ? `[resource ${c.resource.uri ?? ''}]\n${c.resource.text}`
          : `[resource ${c.resource.uri ?? ''} ${c.resource.mimeType ?? ''}]`,
      );
    else if (c.type === 'resource_link') parts.push(`[resource link ${c.name ?? ''} ${c.uri ?? ''}]`);
  }
  if (!parts.length && r.structuredContent !== undefined)
    parts.push(JSON.stringify(r.structuredContent, null, 2));
  let text = parts.join('\n\n') || '(empty result)';
  if (text.length > MAX_RESULT)
    text = `${text.slice(0, MAX_RESULT)}\n… [${text.length - MAX_RESULT} characters truncated]`;
  return { text, isError: r.isError === true };
}

// ---------------------------------------------------------------- transports

interface Transport {
  send(msg: RpcMessage): Promise<void>;
  close(): void;
  onMessage?: (m: RpcMessage) => void;
  onClose?: (reason: string) => void;
}

class StdioTransport implements Transport {
  onMessage?: (m: RpcMessage) => void;
  onClose?: (reason: string) => void;
  private proc: ChildProcess;
  private stderr = '';

  constructor(cfg: McpStdioConfig, cwd: string | undefined) {
    const env = { ...childEnv(process.env), ...(cfg.env ?? {}) };
    // On Windows, npx / uvx / node scripts are .cmd files: they need a shell to start. A
    // real .exe (node.exe, python.exe…) runs directly, with its arguments passed as-is.
    const shell = process.platform === 'win32' && !/\.(exe|com)$/i.test(cfg.command);
    const q = (a: string) => (/[\s"&|<>^%]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    const args = shell ? (cfg.args ?? []).map(q) : (cfg.args ?? []);
    this.proc = spawn(shell ? q(cfg.command) : cfg.command, args, {
      cwd: cfg.cwd ?? cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell,
      windowsHide: true,
    });
    const dec = new LineDecoder();
    this.proc.stdout!.setEncoding('utf8');
    this.proc.stdout!.on('data', (d: string) => {
      for (const m of dec.push(d)) this.onMessage?.(m);
    });
    this.proc.stderr!.setEncoding('utf8');
    this.proc.stderr!.on('data', (d: string) => {
      this.stderr = (this.stderr + d).slice(-4000);
    });
    this.proc.on('error', (e) => this.onClose?.(e.message));
    this.proc.on('exit', (code, sig) =>
      this.onClose?.(
        `el proceso terminó (${sig ?? code})${this.stderr.trim() ? `: ${this.stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`,
      ),
    );
  }

  send(msg: RpcMessage): Promise<void> {
    return new Promise((ok, fail) => {
      if (!this.proc.stdin?.writable) return fail(new Error('el servidor no está en marcha'));
      this.proc.stdin.write(`${JSON.stringify(msg)}\n`, (e) => (e ? fail(e) : ok()));
    });
  }

  close(): void {
    try {
      this.proc.stdin?.end();
    } catch {
      // already closed
    }
    const p = this.proc;
    setTimeout(() => {
      if (p.exitCode === null) p.kill();
    }, 1500).unref();
  }
}

class HttpTransport implements Transport {
  onMessage?: (m: RpcMessage) => void;
  onClose?: (reason: string) => void;
  private session?: string;
  protocol = MCP_PROTOCOL;
  private readonly aborts = new Set<AbortController>();

  constructor(private readonly cfg: McpHttpConfig) {}

  async send(msg: RpcMessage): Promise<void> {
    const ctrl = new AbortController();
    this.aborts.add(ctrl);
    try {
      const res = await fetch(this.cfg.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.session ? { 'mcp-session-id': this.session } : {}),
          ...(msg.method !== 'initialize' ? { 'mcp-protocol-version': this.protocol } : {}),
          ...(this.cfg.headers ?? {}),
        },
        body: JSON.stringify(msg),
        signal: ctrl.signal,
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.session = sid;
      if (res.status === 202 || res.status === 204) return;
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        const hint =
          res.status === 401 || res.status === 403
            ? ' (falta autorización: añade "headers": {"Authorization": "Bearer …"})'
            : '';
        throw new Error(`HTTP ${res.status}${hint}${body ? `: ${body}` : ''}`);
      }
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream') && res.body) {
        const dec = new SseDecoder();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const m of dec.push(value)) this.onMessage?.(m);
        }
        for (const m of dec.flush()) this.onMessage?.(m);
        return;
      }
      const text = await res.text();
      if (!text.trim()) return;
      const v = JSON.parse(text) as unknown;
      for (const m of Array.isArray(v) ? v : [v]) this.onMessage?.(m as RpcMessage);
    } finally {
      this.aborts.delete(ctrl);
    }
  }

  close(): void {
    for (const c of this.aborts) c.abort();
    if (this.session)
      void fetch(this.cfg.url, {
        method: 'DELETE',
        headers: { 'mcp-session-id': this.session, ...(this.cfg.headers ?? {}) },
      }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- connection

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export type McpState = 'off' | 'connecting' | 'connected' | 'error' | 'untrusted';

class McpConnection {
  state: McpState = 'connecting';
  error?: string;
  tools: McpToolInfo[] = [];
  serverName?: string;
  private transport?: Transport;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { ok: (v: unknown) => void; fail: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  ready: Promise<void>;

  constructor(
    readonly name: string,
    readonly cfg: McpServerConfig,
    private readonly cwd: string | undefined,
    private readonly changed: () => void,
  ) {
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    try {
      const t: Transport = 'url' in this.cfg ? new HttpTransport(this.cfg) : new StdioTransport(this.cfg, this.cwd);
      this.transport = t;
      t.onMessage = (m) => this.onMessage(m);
      t.onClose = (reason) => {
        if (this.state === 'off') return;
        this.fail(reason);
      };
      let init: { protocolVersion?: string; serverInfo?: { name?: string }; capabilities?: unknown };
      init = (await this.request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL,
          capabilities: {},
          clientInfo: { name: 'zinarix-studio', version: '1.0' },
        },
        CONNECT_TIMEOUT,
      )) as typeof init;
      const v = init.protocolVersion;
      if (v && v !== MCP_PROTOCOL && !FALLBACK_PROTOCOLS.includes(v)) {
        // An unknown (newer) version: keep going, most of the protocol is the same.
      }
      if (t instanceof HttpTransport && v) t.protocol = v;
      this.serverName = init.serverInfo?.name;
      await this.notify('notifications/initialized');
      await this.refreshTools();
      this.state = 'connected';
      this.error = undefined;
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    } finally {
      this.changed();
    }
  }

  private fail(reason: string): void {
    this.state = 'error';
    this.error = reason.slice(0, 500);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.fail(new Error(reason));
    }
    this.pending.clear();
    this.changed();
  }

  async refreshTools(): Promise<void> {
    const all: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = (await this.request('tools/list', cursor ? { cursor } : {}, CONNECT_TIMEOUT)) as {
        tools?: McpToolInfo[];
        nextCursor?: string;
      };
      all.push(...(r.tools ?? []).filter((t) => t && typeof t.name === 'string'));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    this.tools = all;
  }

  private onMessage(m: RpcMessage): void {
    if (m.method && (m.id === undefined || m.id === null)) {
      if (m.method === 'notifications/tools/list_changed')
        void this.refreshTools()
          .then(() => this.changed())
          .catch(() => undefined);
      return;
    }
    if (m.method && m.id !== undefined) {
      // Requests from the server (sampling, roots, elicitation): not offered.
      if (m.method === 'ping') void this.reply(m.id!, {});
      else if (m.method === 'roots/list') void this.reply(m.id!, { roots: [] });
      else
        void this.transport
          ?.send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not supported' } })
          .catch(() => undefined);
      return;
    }
    if (typeof m.id !== 'number') return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.fail(new Error(`${m.error.message} (${m.error.code})`));
    else p.ok(m.result);
  }

  private reply(id: number | string, result: unknown): Promise<void> {
    return this.transport?.send({ jsonrpc: '2.0', id, result }).catch(() => undefined) ?? Promise.resolve();
  }

  request(method: string, params: unknown, timeout = CALL_TIMEOUT, signal?: AbortSignal): Promise<unknown> {
    const t = this.transport;
    if (!t) return Promise.reject(new Error('no conectado'));
    const id = this.nextId++;
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        void this.notify('notifications/cancelled', { requestId: id, reason: 'timeout' });
        fail(new Error(`${method}: sin respuesta en ${Math.round(timeout / 1000)} s`));
      }, timeout);
      this.pending.set(id, { ok, fail, timer });
      signal?.addEventListener(
        'abort',
        () => {
          const p = this.pending.get(id);
          if (!p) return;
          this.pending.delete(id);
          clearTimeout(p.timer);
          void this.notify('notifications/cancelled', { requestId: id, reason: 'cancelled' });
          fail(new Error('Cancelled by the user.'));
        },
        { once: true },
      );
      t.send({ jsonrpc: '2.0', id, method, params }).catch((e: unknown) => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        clearTimeout(p.timer);
        fail(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    return (
      this.transport
        ?.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) })
        .catch(() => undefined) ?? Promise.resolve()
    );
  }

  close(): void {
    this.state = 'off';
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.fail(new Error('servidor detenido'));
    }
    this.pending.clear();
    this.transport?.close();
    this.transport = undefined;
  }
}

// ---------------------------------------------------------------- manager

export interface McpServerStatus {
  /** `global:<name>` or `project:<name>` */
  id: string;
  name: string;
  scope: 'global' | 'project';
  kind: 'stdio' | 'http';
  /** Command line or URL (secrets are not in it). */
  target: string;
  state: McpState;
  error?: string;
  tools: { name: string; description?: string }[];
  disabled: boolean;
}

export interface McpProjectInfo {
  root: string;
  file: string | null;
  trusted: boolean;
  errors: string[];
}

export interface McpToolBinding {
  connection: McpConnection;
  server: string;
  scope: 'global' | 'project';
  tool: McpToolInfo;
}

const PROJECT_FILES = ['.zinarix/mcp.json', '.cursor/mcp.json'];

export class McpManager {
  private readonly conns = new Map<string, McpConnection>();
  /** Exposed tool name → binding, rebuilt by tools(). */
  private bindings = new Map<string, McpToolBinding>();
  private trust: Record<string, string> = {};
  private listeners = new Set<() => void>();
  private projectRoot?: string;

  constructor(private readonly dir: string) {
    try {
      this.trust = JSON.parse(readFileSync(join(dir, 'mcp-trust.json'), 'utf8')) as Record<string, string>;
    } catch {
      this.trust = {};
    }
  }

  get globalFile(): string {
    return join(this.dir, 'mcp.json');
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit = () => {
    for (const fn of this.listeners) fn();
  };

  readGlobal(): string {
    try {
      return readFileSync(this.globalFile, 'utf8');
    } catch {
      return '{\n  "mcpServers": {}\n}\n';
    }
  }

  /** Saves the global config (only when it parses) and reconnects what changed. */
  saveGlobal(text: string): { errors: string[] } {
    const p = parseMcpConfig(text);
    if (p.errors.length && !Object.keys(p.servers).length && text.trim()) return { errors: p.errors };
    writeFileSync(this.globalFile, text, 'utf8');
    this.sync();
    return { errors: p.errors };
  }

  private projectFile(root: string): string | null {
    for (const f of PROJECT_FILES) {
      const p = join(root, f);
      if (existsSync(p)) return p;
    }
    return null;
  }

  private projectText(root: string): { file: string | null; text: string } {
    const file = this.projectFile(root);
    if (!file) return { file: null, text: '' };
    try {
      return { file, text: readFileSync(file, 'utf8') };
    } catch {
      return { file, text: '' };
    }
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  project(root: string | undefined): McpProjectInfo | null {
    if (!root) return null;
    const { file, text } = this.projectText(root);
    if (!file) return { root, file: null, trusted: false, errors: [] };
    return {
      root,
      file,
      trusted: this.trust[root] === this.hash(text),
      errors: parseMcpConfig(text).errors,
    };
  }

  /** Trusts (or stops trusting) the current content of the project's MCP file. */
  trustProject(root: string, on: boolean): void {
    const { file, text } = this.projectText(root);
    if (on && file) this.trust[root] = this.hash(text);
    else delete this.trust[root];
    writeFileSync(join(this.dir, 'mcp-trust.json'), JSON.stringify(this.trust, null, 2), 'utf8');
    this.sync(root);
  }

  /** Turns a server of the global config on or off (writes "disabled" in mcp.json). */
  setEnabled(name: string, on: boolean): void {
    let json: { mcpServers?: Record<string, Record<string, unknown>> };
    try {
      json = JSON.parse(this.readGlobal()) as typeof json;
    } catch {
      return;
    }
    const s = json.mcpServers?.[name];
    if (!s) return;
    if (on) delete s.disabled;
    else s.disabled = true;
    writeFileSync(this.globalFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    this.sync();
  }

  restart(id: string): void {
    const c = this.conns.get(id);
    if (!c) return this.sync();
    c.close();
    this.conns.delete(id);
    this.sync();
  }

  /** What should run: the global servers, plus the project's when its file is trusted. */
  private wanted(root: string | undefined): Map<string, { name: string; cfg: McpServerConfig; scope: 'global' | 'project'; cwd?: string }> {
    const out = new Map<string, { name: string; cfg: McpServerConfig; scope: 'global' | 'project'; cwd?: string }>();
    for (const [name, cfg] of Object.entries(parseMcpConfig(this.readGlobal()).servers))
      out.set(`global:${name}`, { name, cfg, scope: 'global', cwd: root });
    if (root) {
      const { file, text } = this.projectText(root);
      if (file && this.trust[root] === this.hash(text))
        for (const [name, cfg] of Object.entries(parseMcpConfig(text).servers))
          out.set(`project:${name}`, { name, cfg, scope: 'project', cwd: root });
    }
    return out;
  }

  /**
   * Starts / stops connections to match the config. One project at a time: the most recent
   * one asked for (the open folder of the window the agent works in).
   */
  sync(root: string | undefined = this.projectRoot, quiet = false): void {
    const changedRoot = root !== this.projectRoot;
    this.projectRoot = root;
    const want = this.wanted(root);
    let changed = changedRoot;
    for (const [id, c] of this.conns) {
      const w = want.get(id);
      if (!w || w.cfg.disabled || JSON.stringify(w.cfg) !== JSON.stringify(c.cfg)) {
        c.close();
        this.conns.delete(id);
        changed = true;
      }
    }
    for (const [id, w] of want) {
      if (w.cfg.disabled || this.conns.has(id)) continue;
      for (const s of secretValues(w.cfg)) registerSecret(s);
      this.conns.set(id, new McpConnection(w.name, w.cfg, w.cwd, this.emit));
      changed = true;
    }
    if (changed || !quiet) this.emit();
  }

  status(root: string | undefined = this.projectRoot): McpServerStatus[] {
    const out: McpServerStatus[] = [];
    for (const [id, w] of this.wanted(root)) {
      const c = this.conns.get(id);
      out.push({
        id,
        name: w.name,
        scope: w.scope,
        kind: 'url' in w.cfg ? 'http' : 'stdio',
        target: 'url' in w.cfg ? w.cfg.url : [w.cfg.command, ...(w.cfg.args ?? [])].join(' '),
        state: w.cfg.disabled ? 'off' : (c?.state ?? 'connecting'),
        ...(c?.error ? { error: c.error } : {}),
        tools: (c?.tools ?? []).map((t) => ({ name: t.name, description: t.description?.slice(0, 200) })),
        disabled: Boolean(w.cfg.disabled),
      });
    }
    return out;
  }

  /**
   * Tool definitions for an agent run in `root` (waits a little for servers still starting).
   */
  async tools(root: string | undefined): Promise<ToolDefinition[]> {
    // Always re-checked: the project's file may have changed (and lost its trust) since the
    // last run, and a server started from the old content must not keep serving tools.
    this.sync(root, true);
    const conns = [...this.conns.entries()];
    if (!conns.length) return [];
    await Promise.race([
      Promise.allSettled(conns.map(([, c]) => c.ready)),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
    const taken = new Set<string>();
    const bindings = new Map<string, McpToolBinding>();
    const defs: ToolDefinition[] = [];
    for (const [id, c] of conns) {
      if (c.state !== 'connected') continue;
      const scope = id.startsWith('project:') ? 'project' : 'global';
      for (const tool of c.tools) {
        const name = toolName(c.name, tool.name, taken);
        bindings.set(name, { connection: c, server: c.name, scope, tool });
        const schema =
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? tool.inputSchema
            : { type: 'object', properties: {} };
        defs.push({
          name,
          description: `[MCP ${c.name}] ${(tool.description ?? tool.annotations?.title ?? tool.name).slice(0, 1000)}`,
          parameters: { type: 'object', ...schema },
        });
        if (defs.length >= 200) break;
      }
    }
    this.bindings = bindings;
    return defs;
  }

  binding(name: string): McpToolBinding | undefined {
    return this.bindings.get(name);
  }

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
    const b = this.bindings.get(name);
    if (!b) throw new Error(`Unknown MCP tool ${name}.`);
    if (b.connection.state !== 'connected')
      throw new Error(`The MCP server "${b.server}" is not connected${b.connection.error ? `: ${b.connection.error}` : ''}.`);
    const r = await b.connection.request('tools/call', { name: b.tool.name, arguments: args }, CALL_TIMEOUT, signal);
    return resultText(r);
  }

  shutdown(): void {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
  }
}
