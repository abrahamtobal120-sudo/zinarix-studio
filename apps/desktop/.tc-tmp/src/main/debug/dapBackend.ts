import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import type { Breakpoint, DebugVariable } from '../../shared/devtools.js';
import type { BackendEvents, DebugBackend, RawFrame } from './backend.js';
import { DapConnection, type DapMessage } from './dap.js';

/** How to reach the debug adapter. */
export type AdapterSpec =
  | { kind: 'stdio'; command: string; args: string[]; cwd: string; env: Record<string, string> }
  /** Spawn a server that prints its port (matched by `portPattern`), then connect over TCP. */
  | {
      kind: 'server';
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      portPattern: RegExp;
    }
  /** Spawn a server on a port chosen beforehand, then connect (retrying while it starts). */
  | {
      kind: 'fixedServer';
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      port: number;
    }
  /** An adapter already listening (attach to `dlv --headless`, etc.). */
  | { kind: 'tcp'; host: string; port: number };

const INIT_TIMEOUT = 20_000;

/** A session with any Debug Adapter Protocol adapter (debugpy, dlv dap, lldb-dap, codelldb). */
export class DapBackend implements DebugBackend {
  private conn?: DapConnection;
  private proc?: ChildProcess;
  private socket?: Socket;
  private caps: Record<string, unknown> = {};
  private exited = false;

  constructor(
    private readonly adapter: AdapterSpec,
    private readonly adapterId: string,
    private readonly request: 'launch' | 'attach',
    private readonly requestArgs: Record<string, unknown>,
    private readonly ev: BackendEvents,
  ) {}

  private async open(): Promise<DapConnection> {
    const a = this.adapter;
    if (a.kind === 'tcp') return this.connectTcp(a.host, a.port);
    const proc = spawn(a.command, a.args, {
      cwd: a.cwd,
      env: a.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = proc;
    proc.on('exit', (code) => this.finish(code ?? undefined));
    proc.on('error', (e) => {
      this.ev.output('stderr', `${e.message}\n`);
      this.finish();
    });
    if (a.kind === 'stdio') {
      const conn = new DapConnection(proc.stdin!);
      proc.stdout!.on('data', (d: Buffer) => conn.receive(d));
      proc.stderr!.on('data', (d: Buffer) => this.ev.output('stderr', d.toString('utf8')));
      return conn;
    }
    if (a.kind === 'fixedServer') {
      proc.stdout!.on('data', (d: Buffer) => this.ev.output('stdout', d.toString('utf8')));
      proc.stderr!.on('data', (d: Buffer) => this.ev.output('stderr', d.toString('utf8')));
      const until = Date.now() + INIT_TIMEOUT;
      for (;;) {
        try {
          return await this.connectTcp('127.0.0.1', a.port);
        } catch (e) {
          if (Date.now() > until || this.exited) throw e;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    }
    // Server mode: wait for the port in its output.
    const port = await new Promise<number>((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(
        () => reject(new Error('The debug adapter did not start (no port).')),
        INIT_TIMEOUT,
      );
      const onData = (d: Buffer) => {
        const text = d.toString('utf8');
        seen += text;
        const m = a.portPattern.exec(seen);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        } else this.ev.output('info', text);
      };
      proc.stdout!.on('data', onData);
      proc.stderr!.on('data', onData);
      proc.on('exit', () => reject(new Error(`The debug adapter exited: ${seen.slice(-500)}`)));
    });
    proc.stdout!.removeAllListeners('data');
    proc.stderr!.removeAllListeners('data');
    proc.stdout!.on('data', (d: Buffer) => this.ev.output('stdout', d.toString('utf8')));
    proc.stderr!.on('data', (d: Buffer) => this.ev.output('stderr', d.toString('utf8')));
    return this.connectTcp('127.0.0.1', port);
  }

  private connectTcp(host: string, port: number): Promise<DapConnection> {
    return new Promise((resolve, reject) => {
      const sock = connect({ host, port });
      this.socket = sock;
      const conn = new DapConnection(sock);
      sock.once('connect', () => resolve(conn));
      sock.once('error', (e) => reject(e));
      sock.on('data', (d: Buffer) => conn.receive(d));
      sock.on('close', () => {
        conn.close();
        if (this.adapter.kind === 'tcp') this.finish();
      });
    });
  }

  private finish(code?: number): void {
    if (this.exited) return;
    this.exited = true;
    this.conn?.close();
    this.ev.exited(code);
  }

  async start(breakpoints: Map<string, Breakpoint[]>): Promise<void> {
    const conn = await this.open();
    this.conn = conn;
    conn.on('event', (m: DapMessage) => this.onEvent(m));
    conn.on('request', (m: DapMessage) =>
      // runInTerminal / startDebugging: not offered (the program runs in the adapter).
      conn.respond(m, false, undefined, 'not supported by Zinarix'),
    );
    const initialized = new Promise<void>((resolve) => conn.once('initialized', resolve));
    this.caps =
      (await conn.request<Record<string, unknown>>(
        'initialize',
        {
          clientID: 'zinarix',
          clientName: 'Zinarix Studio',
          adapterID: this.adapterId,
          locale: 'es',
          linesStartAt1: true,
          columnsStartAt1: true,
          pathFormat: 'path',
          supportsVariableType: true,
          supportsRunInTerminalRequest: false,
          supportsStartDebuggingRequest: false,
        },
        INIT_TIMEOUT,
      )) ?? {};
    // Many adapters (debugpy) answer launch only after configurationDone: don't await yet.
    const launched = conn.request(this.request, this.requestArgs);
    launched.catch(() => undefined);
    await Promise.race([
      initialized,
      launched.then(() => initialized),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('The debug adapter did not initialize.')), INIT_TIMEOUT),
      ),
    ]);
    for (const [path, bps] of breakpoints) await this.setBreakpoints(path, bps).catch(() => []);
    if (this.caps.supportsConfigurationDoneRequest) await conn.request('configurationDone');
    await launched;
  }

  private onEvent(m: DapMessage): void {
    const b = (m.body ?? {}) as Record<string, unknown>;
    switch (m.event) {
      case 'initialized':
        this.conn?.emit('initialized');
        break;
      case 'stopped':
        void (async () => {
          let thread = typeof b.threadId === 'number' ? b.threadId : undefined;
          if (thread === undefined) {
            const t = await this.conn
              ?.request<{ threads: { id: number }[] }>('threads')
              .catch(() => undefined);
            thread = t?.threads[0]?.id ?? 1;
          }
          this.ev.stopped(
            String(b.reason ?? 'pause'),
            thread,
            typeof b.text === 'string'
              ? b.text
              : typeof b.description === 'string'
                ? b.description
                : undefined,
          );
        })();
        break;
      case 'continued':
        this.ev.continued();
        break;
      case 'output': {
        const cat = String(b.category ?? 'console');
        if (cat === 'telemetry') break;
        this.ev.output(
          cat === 'stdout' || cat === 'stderr' ? cat : cat === 'important' ? 'info' : 'console',
          String(b.output ?? ''),
        );
        break;
      }
      case 'exited':
        this.ev.output('info', `\n[exit code ${String(b.exitCode ?? '?')}]\n`);
        break;
      case 'terminated':
        void this.stop();
        break;
    }
  }

  private req<T>(command: string, args?: unknown): Promise<T> {
    if (!this.conn) return Promise.reject(new Error('not started'));
    return this.conn.request<T>(command, args, 15_000);
  }

  async setBreakpoints(absPath: string, bps: Breakpoint[]): Promise<number[]> {
    const r = await this.req<{ breakpoints: { verified: boolean; line?: number }[] }>(
      'setBreakpoints',
      {
        source: { path: absPath },
        breakpoints: bps.map((b) => ({
          line: b.line,
          ...(b.condition && this.caps.supportsConditionalBreakpoints
            ? { condition: b.condition }
            : {}),
        })),
        lines: bps.map((b) => b.line),
      },
    );
    return (r?.breakpoints ?? []).map((x, i) => x.line ?? bps[i]?.line ?? 0).filter(Boolean);
  }

  async resume(threadId: number): Promise<void> {
    await this.req('continue', { threadId });
    this.ev.continued();
  }

  async pause(threadId: number): Promise<void> {
    await this.req('pause', { threadId });
  }

  async step(kind: 'over' | 'into' | 'out', threadId: number): Promise<void> {
    await this.req(kind === 'over' ? 'next' : kind === 'into' ? 'stepIn' : 'stepOut', {
      threadId,
    });
    this.ev.continued();
  }

  async frames(threadId: number): Promise<RawFrame[]> {
    const r = await this.req<{
      stackFrames: {
        id: number;
        name: string;
        line: number;
        column: number;
        source?: { path?: string };
      }[];
    }>('stackTrace', { threadId, startFrame: 0, levels: 60 });
    return (r?.stackFrames ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      absPath: f.source?.path,
      line: f.line,
      column: f.column,
    }));
  }

  async scopes(frameId: number): Promise<DebugVariable[]> {
    const r = await this.req<{ scopes: { name: string; variablesReference: number }[] }>(
      'scopes',
      { frameId },
    );
    return (r?.scopes ?? []).map((s) => ({ name: s.name, value: '', ref: s.variablesReference }));
  }

  async variables(ref: number): Promise<DebugVariable[]> {
    const r = await this.req<{
      variables: { name: string; value: string; type?: string; variablesReference: number }[];
    }>('variables', { variablesReference: ref });
    return (r?.variables ?? []).map((v) => ({
      name: v.name,
      value: v.value,
      type: v.type,
      ref: v.variablesReference,
    }));
  }

  async evaluate(expression: string, frameId?: number): Promise<DebugVariable> {
    const r = await this.req<{ result: string; type?: string; variablesReference: number }>(
      'evaluate',
      { expression, frameId, context: 'repl' },
    );
    return { name: expression, value: r.result, type: r.type, ref: r.variablesReference };
  }

  async stop(): Promise<void> {
    if (this.conn && !this.exited) {
      await this.conn
        .request(
          'disconnect',
          { terminateDebuggee: this.request === 'launch', restart: false },
          2500,
        )
        .catch(() => undefined);
    }
    this.socket?.destroy();
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
    this.finish();
  }
}
