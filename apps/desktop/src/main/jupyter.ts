import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, posix } from 'node:path';
import { childEnv } from './env.js';
import { which } from './debug/backend.js';
import {
  executeRequest,
  kernelMessage,
  parseCompleteReply,
  parseVariables,
  PY_VARIABLES_CODE,
  PY_VARIABLES_EXPR,
  stripAnsi,
  toCodePoints,
  type JsonObject,
  type NbCompletions,
  type NbVariable,
  type JupyterStatus,
  type KernelInfo,
  type KernelMessage,
  type NotebookEvent,
} from '../shared/notebook.js';

/**
 * Notebook kernels through a local Jupyter Server: one `python -m jupyter_server` per window,
 * bound to 127.0.0.1 with a random token, rooted at the open folder. Each open notebook gets a
 * Jupyter session (its kernel runs in the notebook's folder) and a WebSocket to the kernel's
 * channels (Jupyter messaging protocol v5, JSON frames). Nothing is faked: without Python +
 * jupyter_server + ipykernel the status says so and no cell runs.
 */

interface Runner {
  cmd: string;
  pre: string[];
  label: string;
}

const PROBE =
  'import sys, jupyter_server, ipykernel; print(jupyter_server.__version__); print(sys.executable)';

function run(cmd: string, args: string[], timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout, windowsHide: true, env: childEnv(process.env) },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    );
  });
}

/** Interpreters to try, best first: ZINARIX_PYTHON, the project's venv, then PATH. */
export function pythonCandidates(root: string | null): Runner[] {
  const out: Runner[] = [];
  const add = (cmd: string | null | undefined, pre: string[] = []) => {
    if (cmd && !out.some((r) => r.cmd === cmd && r.pre.join() === pre.join()))
      out.push({ cmd, pre, label: [cmd, ...pre].join(' ') });
  };
  add(process.env.ZINARIX_PYTHON);
  if (root)
    for (const v of ['.venv', 'venv', 'env'])
      for (const rel of process.platform === 'win32'
        ? ['Scripts/python.exe']
        : ['bin/python3', 'bin/python']) {
        const p = join(root, v, rel);
        if (existsSync(p)) add(p);
      }
  if (process.env.CONDA_PREFIX)
    add(join(process.env.CONDA_PREFIX, process.platform === 'win32' ? 'python.exe' : 'bin/python'));
  for (const n of ['python3', 'python']) {
    const p = which(n);
    // The Microsoft Store stub opens the Store instead of running.
    if (p && !/WindowsApps/i.test(p)) add(p);
  }
  const py = which('py');
  if (py) add(py, ['-3']);
  return out;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class JupyterServer {
  private constructor(
    private readonly proc: ChildProcess,
    readonly port: number,
    readonly token: string,
  ) {}

  get base(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get alive(): boolean {
    return this.proc.exitCode === null && !this.proc.killed;
  }

  static async start(runner: Runner, root: string): Promise<JupyterServer> {
    const port = await freePort();
    const token = randomBytes(24).toString('hex');
    const proc = spawn(
      runner.cmd,
      [
        ...runner.pre,
        '-m',
        'jupyter_server',
        '--no-browser',
        `--ServerApp.ip=127.0.0.1`,
        `--ServerApp.port=${port}`,
        '--ServerApp.port_retries=0',
        `--ServerApp.root_dir=${root}`,
      ],
      {
        cwd: root,
        windowsHide: true,
        // The token goes through the environment (not the command line, visible to others).
        env: { ...childEnv(process.env), JUPYTER_TOKEN: token, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let log = '';
    const keep = (b: Buffer) => {
      log = (log + b.toString('utf8')).slice(-4000);
    };
    proc.stdout?.on('data', keep);
    proc.stderr?.on('data', keep);
    const server = new JupyterServer(proc, port, token);
    const deadline = Date.now() + 60_000;
    let spawnErr: Error | null = null;
    proc.once('error', (e) => (spawnErr = e));
    for (;;) {
      if (spawnErr) throw spawnErr;
      if (proc.exitCode !== null)
        throw new Error(`Jupyter Server se cerró al iniciar:\n${log.trim().slice(-1500)}`);
      try {
        const r = await fetch(`${server.base}/api/status`, {
          headers: { Authorization: `token ${token}` },
          signal: AbortSignal.timeout(2000),
        });
        if (r.ok) return server;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        server.kill();
        throw new Error(`Jupyter Server no respondió en 60 s:\n${log.trim().slice(-1500)}`);
      }
      await sleep(300);
    }
  }

  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `token ${this.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try {
        msg = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // plain text error
      }
      throw new Error(`Jupyter: HTTP ${r.status} ${msg.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  kill(): void {
    if (!this.alive) return;
    if (process.platform === 'win32' && this.proc.pid)
      // Kernels are children of the server: take the whole tree down.
      execFile(
        'taskkill',
        ['/pid', String(this.proc.pid), '/T', '/F'],
        { windowsHide: true },
        () => undefined,
      );
    else this.proc.kill('SIGTERM');
  }

  async stop(): Promise<void> {
    if (!this.alive) return;
    try {
      await this.req('POST', '/api/shutdown');
      for (let i = 0; i < 20 && this.alive; i++) await sleep(100);
    } catch {
      // already gone, or old server without /api/shutdown
    }
    this.kill();
  }
}

interface Session {
  path: string;
  sessionId: string;
  kernelId: string;
  /** Client session id of our messages. */
  client: string;
  ws: WebSocket;
  info: KernelInfo;
  /** execute_request msg_id -> cell id. */
  pending: Map<string, string>;
  /** Other shell requests (complete, inspect, variables) waiting for their reply. */
  replies: Map<string, (content: JsonObject) => void>;
}

export class NotebookKernels {
  private server: Promise<JupyterServer> | null = null;
  private root: string | null = null;
  private sessions = new Map<string, Promise<Session>>();
  private status_: { root: string | null; at: number; value: JupyterStatus } | null = null;
  private runner: Runner | null = null;
  /** The running server, for the synchronous kill on exit. */
  private live: JupyterServer | null = null;

  /** Interpreter picked by the user (null = the first that has Jupyter). */
  private prefer: string | null = null;
  /** Extra listeners of the events (the agent's notebook_run waits on them). */
  private listeners = new Set<(e: NotebookEvent) => void>();
  private readonly emit: (e: NotebookEvent) => void;

  constructor(emit: (e: NotebookEvent) => void) {
    this.emit = (e) => {
      emit(e);
      for (const l of this.listeners) l(e);
    };
  }

  /** Listens to every event; returns the function that stops listening. */
  on(listener: (e: NotebookEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether a notebook has a running kernel session. */
  has(rel: string): boolean {
    return this.sessions.has(rel);
  }

  /** The interpreter in use (or wanted), for the picker. */
  get python(): string | null {
    return this.prefer ?? this.runner?.cmd ?? null;
  }

  /**
   * Interpreters found for this folder and whether each one has jupyter_server + ipykernel
   * (Python of the project venv, conda, PATH…).
   */
  async interpreters(
    root: string | null,
  ): Promise<{ cmd: string; label: string; ok: boolean; version?: string }[]> {
    const cands = pythonCandidates(root);
    if (this.prefer && !cands.some((c) => c.cmd === this.prefer))
      cands.unshift({ cmd: this.prefer, pre: [], label: this.prefer });
    return Promise.all(
      cands.map(async (r) => {
        try {
          const out = (await run(r.cmd, [...r.pre, '-c', PROBE], 15_000)).trim().split(/\r?\n/);
          return {
            cmd: out[1]?.trim() || r.cmd,
            label: r.label,
            ok: true,
            version: out[0]?.trim(),
          };
        } catch {
          return { cmd: r.cmd, label: r.label, ok: false };
        }
      }),
    );
  }

  /** Uses another interpreter: stops the server and every kernel (they start again on demand). */
  async usePython(cmd: string | null): Promise<void> {
    if (cmd === this.prefer) return;
    await this.dispose();
    this.prefer = cmd;
    this.status_ = null;
    this.runner = null;
  }

  /** Finds Python with jupyter_server + ipykernel (cached for a minute; force re-checks). */
  async status(root: string | null, force = false): Promise<JupyterStatus> {
    const c = this.status_;
    if (!force && c && c.root === root && Date.now() - c.at < 60_000) return c.value;
    const tried: string[] = [];
    let value: JupyterStatus | null = null;
    // The interpreter the user picked is the only one tried (a fallback would hide its problem).
    const all = pythonCandidates(root);
    const cands = this.prefer
      ? [
          all.find((c) => c.cmd === this.prefer) ?? {
            cmd: this.prefer,
            pre: [],
            label: this.prefer,
          },
        ]
      : all;
    for (const r of cands) {
      tried.push(r.label);
      try {
        const out = (await run(r.cmd, [...r.pre, '-c', PROBE])).trim().split(/\r?\n/);
        this.runner = { ...r, cmd: out[1]?.trim() || r.cmd, pre: out[1] ? [] : r.pre };
        value = { ok: true, python: this.runner.cmd, version: out[0]?.trim() ?? '' };
        break;
      } catch {
        // this interpreter lacks jupyter_server / ipykernel (or doesn't run)
      }
    }
    value ??= { ok: false, reason: cands.length ? 'no-jupyter' : 'no-python', tried };
    this.status_ = { root, at: Date.now(), value };
    return value;
  }

  private async serverFor(root: string): Promise<JupyterServer> {
    if (this.root !== root) {
      await this.dispose();
      this.root = root;
    }
    const current = this.server ? await this.server.catch(() => null) : null;
    if (current?.alive) return current;
    const st = await this.status(root);
    if (!st.ok || !this.runner)
      throw new Error(
        st.ok
          ? 'Jupyter no disponible'
          : 'Jupyter no está instalado (falta jupyter_server o ipykernel).',
      );
    const p = JupyterServer.start(this.runner, root);
    this.server = p;
    void p.then((s) => (this.live = s)).catch(() => undefined);
    p.catch(() => {
      if (this.server === p) this.server = null;
    });
    return p;
  }

  async kernelspecs(root: string): Promise<{ default: string; specs: KernelInfo[] }> {
    const srv = await this.serverFor(root);
    const r = await srv.req<{
      default: string;
      kernelspecs: Record<
        string,
        { name: string; spec: { display_name: string; language: string } }
      >;
    }>('GET', '/api/kernelspecs');
    return {
      default: r.default,
      specs: Object.values(r.kernelspecs).map((k) => ({
        name: k.name,
        displayName: k.spec.display_name,
        language: k.spec.language,
      })),
    };
  }

  /** Starts (or reuses) the kernel of a notebook. `rel` is the notebook path in the folder. */
  start(root: string, rel: string, kernel: string | null): Promise<KernelInfo> {
    let s = this.sessions.get(rel);
    if (!s) {
      s = this.open(root, rel, kernel);
      this.sessions.set(rel, s);
      s.catch(() => this.sessions.delete(rel));
    }
    return s.then((x) => x.info);
  }

  private async open(root: string, rel: string, kernel: string | null): Promise<Session> {
    this.emit({ kind: 'kernel', path: rel, state: 'starting' });
    try {
      const srv = await this.serverFor(root);
      const specs = await this.kernelspecs(root);
      if (!specs.specs.length)
        throw new Error('Jupyter no tiene ningún kernel instalado (instala ipykernel).');
      const spec =
        specs.specs.find((k) => k.name === kernel) ??
        specs.specs.find((k) => k.name === specs.default) ??
        specs.specs[0]!;
      const sess = await srv.req<{ id: string; kernel: { id: string } }>('POST', '/api/sessions', {
        path: rel,
        name: posix.basename(rel),
        type: 'notebook',
        kernel: { name: spec.name },
      });
      const client = randomUUID();
      const url = `ws://127.0.0.1:${srv.port}/api/kernels/${encodeURIComponent(
        sess.kernel.id,
      )}/channels?session_id=${client}&token=${srv.token}`;
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout connecting to the kernel')), 30_000);
        ws.addEventListener('open', () => {
          clearTimeout(t);
          resolve();
        });
        ws.addEventListener('error', () => {
          clearTimeout(t);
          reject(new Error('could not connect to the kernel'));
        });
      });
      const session: Session = {
        path: rel,
        sessionId: sess.id,
        kernelId: sess.kernel.id,
        client,
        ws,
        info: spec,
        pending: new Map(),
        replies: new Map(),
      };
      ws.addEventListener('message', (ev) => this.onMessage(session, ev.data));
      ws.addEventListener('close', () => {
        if (this.sessions.has(rel)) {
          this.failPending(session);
          this.sessions.delete(rel);
          this.emit({ kind: 'kernel', path: rel, state: 'dead', message: 'connection closed' });
        }
      });
      this.emit({ kind: 'kernel', path: rel, state: 'idle' });
      return session;
    } catch (e) {
      this.emit({ kind: 'kernel', path: rel, state: 'dead', message: (e as Error).message });
      throw e;
    }
  }

  private failPending(s: Session): void {
    for (const done of s.replies.values()) done({ status: 'aborted' });
    s.replies.clear();
    for (const cellId of s.pending.values())
      this.emit({ kind: 'done', path: s.path, cellId, status: 'aborted', executionCount: null });
    s.pending.clear();
  }

  private onMessage(s: Session, data: unknown): void {
    if (typeof data !== 'string') return; // binary frames (widget buffers): not used
    let m: KernelMessage;
    try {
      m = JSON.parse(data) as KernelMessage;
    } catch {
      return;
    }
    const type = m.header?.msg_type ?? (m as unknown as { msg_type?: string }).msg_type;
    const parent = m.parent_header?.msg_id;
    if (type === 'status' && m.channel === 'iopub') {
      const st = m.content.execution_state;
      // Only the kernel's own state changes (any request) drive the indicator.
      if (st === 'busy' || st === 'idle') this.emit({ kind: 'kernel', path: s.path, state: st });
      else if (st === 'restarting' || st === 'dead') {
        this.failPending(s);
        this.emit({ kind: 'kernel', path: s.path, state: st });
      }
      return;
    }
    if (m.channel === 'shell' && parent && s.replies.has(parent)) {
      const done = s.replies.get(parent)!;
      s.replies.delete(parent);
      done(m.content as JsonObject);
      return;
    }
    const cellId = parent ? s.pending.get(parent) : undefined;
    if (!cellId || !type) return;
    if (m.channel === 'shell' && type === 'execute_reply') {
      s.pending.delete(parent!);
      const status = m.content.status;
      this.emit({
        kind: 'done',
        path: s.path,
        cellId,
        status: status === 'ok' ? 'ok' : status === 'aborted' ? 'aborted' : 'error',
        executionCount:
          typeof m.content.execution_count === 'number' ? m.content.execution_count : null,
      });
      return;
    }
    if (m.channel === 'iopub' && type !== 'execute_input')
      this.emit({
        kind: 'output',
        path: s.path,
        cellId,
        msgType: type,
        content: m.content as JsonObject,
      });
  }

  private async session(rel: string): Promise<Session> {
    const s = this.sessions.get(rel);
    if (!s) throw new Error('El kernel de este notebook no está iniciado.');
    return s;
  }

  /** Queues a cell on the notebook's kernel; outputs and the end arrive as events. */
  async execute(rel: string, cellId: string, code: string): Promise<void> {
    const s = await this.session(rel);
    if (s.ws.readyState !== WebSocket.OPEN) throw new Error('El kernel está desconectado.');
    const msgId = randomUUID();
    s.pending.set(msgId, cellId);
    s.ws.send(JSON.stringify(executeRequest(code, { msgId, session: s.client })));
  }

  /**
   * A shell request answered by one reply (complete, inspect, a silent execute). Null when the
   * notebook has no kernel or it does not answer in time (busy with a long cell).
   */
  private async ask(
    rel: string,
    type: string,
    content: JsonObject,
    timeout: number,
  ): Promise<JsonObject | null> {
    const p = this.sessions.get(rel);
    if (!p) return null;
    const s = await p.catch(() => null);
    if (!s || s.ws.readyState !== WebSocket.OPEN) return null;
    const msgId = randomUUID();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        s.replies.delete(msgId);
        resolve(null);
      }, timeout);
      s.replies.set(msgId, (c) => {
        clearTimeout(t);
        resolve(c);
      });
      s.ws.send(JSON.stringify(kernelMessage(type, content, { msgId, session: s.client })));
    });
  }

  /** Completions of the kernel at a cursor (UTF-16 offset) of a cell's code. */
  async complete(rel: string, code: string, cursor: number): Promise<NbCompletions | null> {
    // The first completion of a kernel loads jedi (several seconds); later ones take ms.
    const r = await this.ask(
      rel,
      'complete_request',
      { code, cursor_pos: toCodePoints(code, cursor) },
      12_000,
    );
    return r ? parseCompleteReply(code, r) : null;
  }

  /** What the kernel knows of the name at a cursor (signature and docstring), as plain text. */
  async inspect(rel: string, code: string, cursor: number): Promise<string | null> {
    const r = await this.ask(
      rel,
      'inspect_request',
      { code, cursor_pos: toCodePoints(code, cursor), detail_level: 0 },
      4000,
    );
    if (!r || r.status !== 'ok' || r.found !== true) return null;
    const data = r.data as JsonObject | undefined;
    const text =
      data && typeof data['text/plain'] === 'string' ? stripAnsi(data['text/plain']) : '';
    return text.trim() ? text.trim().slice(0, 6000) : null;
  }

  /** Variables of a Python kernel (silent run: no history, no execution count). */
  async variables(rel: string, timeout = 10_000): Promise<NbVariable[] | null> {
    if ((await this.language(rel)) !== 'python') return null;
    const r = await this.ask(
      rel,
      'execute_request',
      {
        code: PY_VARIABLES_CODE,
        silent: true,
        store_history: false,
        user_expressions: { v: PY_VARIABLES_EXPR },
        allow_stdin: false,
        stop_on_error: false,
      },
      timeout,
    );
    if (!r || r.status !== 'ok') return null;
    const ue = r.user_expressions as JsonObject | undefined;
    return parseVariables(ue?.v);
  }

  /** Language of the notebook's running kernel (null = no kernel). */
  async language(rel: string): Promise<string | null> {
    const p = this.sessions.get(rel);
    const s = p ? await p.catch(() => null) : null;
    return s ? s.info.language.toLowerCase() : null;
  }

  async interrupt(rel: string): Promise<void> {
    const s = await this.session(rel);
    const srv = await this.server!;
    await srv.req('POST', `/api/kernels/${encodeURIComponent(s.kernelId)}/interrupt`);
  }

  async restart(rel: string): Promise<void> {
    const s = await this.session(rel);
    const srv = await this.server!;
    this.failPending(s);
    this.emit({ kind: 'kernel', path: rel, state: 'restarting' });
    await srv.req('POST', `/api/kernels/${encodeURIComponent(s.kernelId)}/restart`);
    this.emit({ kind: 'kernel', path: rel, state: 'idle' });
  }

  async shutdown(rel: string): Promise<void> {
    const p = this.sessions.get(rel);
    if (!p) return;
    this.sessions.delete(rel);
    const s = await p.catch(() => null);
    if (!s) return;
    this.failPending(s);
    try {
      s.ws.close();
    } catch {
      // closed
    }
    const srv = this.server ? await this.server.catch(() => null) : null;
    await srv
      ?.req('DELETE', `/api/sessions/${encodeURIComponent(s.sessionId)}`)
      .catch(() => undefined);
    this.emit({ kind: 'kernel', path: rel, state: 'dead' });
  }

  /** Stops every kernel and the server (window closed, folder changed, app quitting). */
  async dispose(): Promise<void> {
    const paths = [...this.sessions.keys()];
    for (const p of paths) await this.shutdown(p).catch(() => undefined);
    const srv = this.server ? await this.server.catch(() => null) : null;
    this.server = null;
    this.live = null;
    await srv?.stop();
  }

  /** Synchronous last resort (process exit): kill the server tree. */
  killNow(): void {
    this.live?.kill();
  }
}
