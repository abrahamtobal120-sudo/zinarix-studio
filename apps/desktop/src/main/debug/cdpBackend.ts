import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Breakpoint, DebugVariable } from '../../shared/devtools.js';
import { lineSplitter, type BackendEvents, type DebugBackend, type RawFrame } from './backend.js';

interface RemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
}

interface CallFrame {
  callFrameId: string;
  functionName: string;
  url?: string;
  location: { scriptId: string; lineNumber: number; columnNumber?: number };
  scopeChain: { type: string; name?: string; object: RemoteObject }[];
}

/** Lines Node prints about the inspector itself (not the program's output). */
const INSPECTOR_NOISE =
  /^(Debugger listening on |For help, see: https:\/\/nodejs\.org|Debugger attached\.|Waiting for the debugger to disconnect\.\.\.)/;

/** The regex CDP matches script URLs against for a file (drive letter case-insensitive). */
export function urlRegexFor(absPath: string): string {
  const href = pathToFileURL(absPath).href;
  const esc = href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  // file:///C:/… — Windows drive letters may come in either case.
  return `^${esc.replace(/^(file:\\\/\\\/\\\/)([A-Za-z]):/, (_, p: string, d: string) => `${p}[${d.toLowerCase()}${d.toUpperCase()}]:`)}$`;
}

/** Display text for a CDP value. */
export function describe(o: RemoteObject): string {
  if (o.type === 'undefined') return 'undefined';
  if (o.unserializableValue) return o.unserializableValue;
  if (o.type === 'string') return JSON.stringify(o.value);
  if (o.type === 'number' || o.type === 'boolean' || o.type === 'bigint')
    return String(o.value ?? o.description);
  if (o.subtype === 'null') return 'null';
  if (o.type === 'function') return `ƒ ${(o.description ?? '').split('\n')[0]!.slice(0, 120)}`;
  return o.description ?? o.className ?? o.type;
}

/**
 * Node.js through its own inspector (Chrome DevTools Protocol): no extra adapter to install.
 * Launch runs `node --inspect-brk=127.0.0.1:0`; attach connects to a running `--inspect` port.
 */
export class CdpBackend implements DebugBackend {
  private ws?: WebSocket;
  private proc?: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly scripts = new Map<string, string>();
  private frameIds = new Map<number, CallFrame>();
  private refs = new Map<number, string>();
  private nextRef = 1;
  private paused?: CallFrame[];
  private readonly bpIds = new Map<string, string[]>();
  private exited = false;
  private sawStartPause = false;

  constructor(
    private readonly opts: {
      request: 'launch' | 'attach';
      node: string;
      program?: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      host: string;
      port?: number;
      stopOnEntry: boolean;
    },
    private readonly ev: BackendEvents,
  ) {}

  private send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('not connected to the Node inspector'));
    const id = this.nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) =>
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }),
    );
  }

  private async wsUrl(): Promise<string> {
    const o = this.opts;
    if (o.request === 'attach') {
      const r = await fetch(`http://${o.host}:${o.port ?? 9229}/json/list`);
      const list = (await r.json()) as { webSocketDebuggerUrl?: string }[];
      const url = list.find((x) => x.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
      if (!url) throw new Error('No Node.js process is listening for a debugger there.');
      return url;
    }
    const proc = spawn(o.node, ['--inspect-brk=127.0.0.1:0', o.program!, ...o.args], {
      cwd: o.cwd,
      env: o.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = proc;
    proc.on('exit', (code) => this.finish(code ?? undefined));
    proc.on('error', (e) => {
      this.ev.output('stderr', `${e.message}\n`);
      this.finish();
    });
    proc.stdout!.on('data', (d: Buffer) => this.ev.output('stdout', d.toString('utf8')));
    return new Promise<string>((resolve, reject) => {
      let found = false;
      const timer = setTimeout(() => reject(new Error('Node did not open its inspector.')), 15_000);
      const lines = lineSplitter((line) => {
        const m = /ws:\/\/\S+/.exec(line);
        if (!found && m && line.startsWith('Debugger listening on')) {
          found = true;
          clearTimeout(timer);
          resolve(m[0]);
        }
        if (!INSPECTOR_NOISE.test(line)) this.ev.output('stderr', `${line}\n`);
      });
      proc.stderr!.on('data', (d: Buffer) => lines.push(d.toString('utf8')));
      proc.on('exit', () => {
        lines.flush();
        clearTimeout(timer);
        if (!found) reject(new Error('Node exited before the debugger could attach.'));
      });
    });
  }

  async start(breakpoints: Map<string, Breakpoint[]>): Promise<void> {
    const url = await this.wsUrl();
    const ws = new WebSocket(url);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not connect to the Node inspector.'));
    });
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('inspector closed'));
      this.pending.clear();
      if (this.opts.request === 'attach') this.finish();
    };
    await this.send('Runtime.enable');
    await this.send('Debugger.enable');
    for (const [path, bps] of breakpoints) await this.setBreakpoints(path, bps).catch(() => []);
    await this.send('Runtime.runIfWaitingForDebugger');
  }

  private onMessage(raw: string): void {
    let m: { id?: number; method?: string; params?: any; result?: unknown; error?: any };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(String(m.error.message ?? 'CDP error')));
      else p.resolve(m.result);
      return;
    }
    const params = m.params ?? {};
    switch (m.method) {
      case 'Debugger.scriptParsed':
        if (params.url) this.scripts.set(params.scriptId, params.url);
        break;
      case 'Debugger.paused': {
        const frames = params.callFrames as CallFrame[];
        // --inspect-brk stops before the first line: go on unless asked to stop on entry.
        if (!this.sawStartPause && this.opts.request === 'launch') {
          this.sawStartPause = true;
          if (!this.opts.stopOnEntry && !(params.hitBreakpoints?.length > 0)) {
            void this.send('Debugger.resume');
            return;
          }
        }
        this.paused = frames;
        this.frameIds = new Map();
        frames.forEach((f, i) => this.frameIds.set(i + 1, f));
        const reason =
          params.hitBreakpoints?.length > 0
            ? 'breakpoint'
            : params.reason === 'exception' || params.reason === 'promiseRejection'
              ? 'exception'
              : params.reason === 'other'
                ? 'step'
                : String(params.reason ?? 'pause');
        this.ev.stopped(
          reason,
          1,
          reason === 'exception' ? describe((params.data ?? {}) as RemoteObject) : undefined,
        );
        break;
      }
      case 'Debugger.resumed':
        this.paused = undefined;
        this.refs = new Map();
        this.ev.continued();
        break;
      case 'Runtime.executionContextDestroyed':
        // The program finished; Node waits for us to disconnect before exiting.
        if (this.opts.request === 'launch') this.ws?.close();
        break;
    }
  }

  private finish(code?: number): void {
    if (this.exited) return;
    this.exited = true;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ev.exited(code);
  }

  async setBreakpoints(absPath: string, bps: Breakpoint[]): Promise<number[]> {
    for (const id of this.bpIds.get(absPath) ?? [])
      await this.send('Debugger.removeBreakpoint', { breakpointId: id }).catch(() => undefined);
    const ids: string[] = [];
    const lines: number[] = [];
    const urlRegex = urlRegexFor(absPath);
    for (const b of bps) {
      const r = await this.send<{
        breakpointId: string;
        locations: { lineNumber: number }[];
      }>('Debugger.setBreakpointByUrl', {
        lineNumber: b.line - 1,
        urlRegex,
        ...(b.condition ? { condition: b.condition } : {}),
      }).catch(() => undefined);
      if (!r) continue;
      ids.push(r.breakpointId);
      lines.push(r.locations[0] ? r.locations[0].lineNumber + 1 : b.line);
    }
    this.bpIds.set(absPath, ids);
    return lines;
  }

  async resume(): Promise<void> {
    await this.send('Debugger.resume');
  }

  async pause(): Promise<void> {
    await this.send('Debugger.pause');
  }

  async step(kind: 'over' | 'into' | 'out'): Promise<void> {
    await this.send(
      kind === 'over' ? 'Debugger.stepOver' : kind === 'into' ? 'Debugger.stepInto' : 'Debugger.stepOut',
    );
  }

  private pathOf(url: string | undefined): string | undefined {
    if (!url) return undefined;
    if (url.startsWith('file:'))
      try {
        return fileURLToPath(url);
      } catch {
        return undefined;
      }
    if (/^([A-Za-z]:[\\/]|\/)/.test(url)) return url;
    return undefined; // node:internal…
  }

  async frames(): Promise<RawFrame[]> {
    return [...this.frameIds.entries()].map(([id, f]) => ({
      id,
      name: f.functionName || '(anonymous)',
      absPath: this.pathOf(f.url || this.scripts.get(f.location.scriptId)),
      line: f.location.lineNumber + 1,
      column: (f.location.columnNumber ?? 0) + 1,
    }));
  }

  private ref(objectId: string | undefined): number {
    if (!objectId) return 0;
    const r = this.nextRef++;
    this.refs.set(r, objectId);
    return r;
  }

  async scopes(frameId: number): Promise<DebugVariable[]> {
    const f = this.frameIds.get(frameId);
    if (!f) return [];
    const label: Record<string, string> = {
      local: 'Local',
      closure: 'Closure',
      block: 'Block',
      catch: 'Catch',
      module: 'Module',
      script: 'Script',
      global: 'Global',
      with: 'With',
      eval: 'Eval',
    };
    return f.scopeChain.map((s) => ({
      name: s.name ? `${label[s.type] ?? s.type}: ${s.name}` : (label[s.type] ?? s.type),
      value: '',
      ref: this.ref(s.object.objectId),
    }));
  }

  async variables(ref: number): Promise<DebugVariable[]> {
    const objectId = this.refs.get(ref);
    if (!objectId) return [];
    const r = await this.send<{
      result: { name: string; value?: RemoteObject; get?: RemoteObject }[];
    }>('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: false });
    return r.result
      .filter((p) => p.value)
      .slice(0, 500)
      .map((p) => {
        const v = p.value!;
        const expandable = v.objectId && (v.type === 'object' || v.type === 'function');
        return {
          name: p.name,
          value: describe(v),
          type: v.subtype ?? v.type,
          ref: expandable && v.subtype !== 'null' ? this.ref(v.objectId) : 0,
        };
      });
  }

  async evaluate(expression: string, frameId?: number): Promise<DebugVariable> {
    const f = frameId !== undefined ? this.frameIds.get(frameId) : this.paused?.[0];
    const r = await this.send<{ result: RemoteObject; exceptionDetails?: { exception?: RemoteObject; text?: string } }>(
      f ? 'Debugger.evaluateOnCallFrame' : 'Runtime.evaluate',
      f
        ? { callFrameId: f.callFrameId, expression, generatePreview: false }
        : { expression, replMode: true, generatePreview: false },
    );
    if (r.exceptionDetails)
      return {
        name: expression,
        value: r.exceptionDetails.exception
          ? describe(r.exceptionDetails.exception)
          : (r.exceptionDetails.text ?? 'error'),
        ref: 0,
      };
    const v = r.result;
    return {
      name: expression,
      value: describe(v),
      type: v.subtype ?? v.type,
      ref: v.objectId && v.type === 'object' && v.subtype !== 'null' ? this.ref(v.objectId) : 0,
    };
  }

  async stop(): Promise<void> {
    try {
      this.ws?.close();
    } catch {
      // closed
    }
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
    if (!this.proc) this.finish();
  }
}
