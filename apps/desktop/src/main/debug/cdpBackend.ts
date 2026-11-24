import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Breakpoint, type DebugVariable, logpointCondition } from '../../shared/devtools.js';
import { lineSplitter, type BackendEvents, type DebugBackend, type RawFrame } from './backend.js';
import { loadSourceMap, pathKey, type SourceMap } from './sourceMap.js';

interface RemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
}

/** The fields this backend reads from CDP event params (scriptParsed, paused). */
interface CdpEventParams {
  scriptId?: string;
  url?: string;
  sourceMapURL?: string;
  callFrames?: CallFrame[];
  hitBreakpoints?: string[];
  reason?: string;
  data?: unknown;
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
  /** sourceMappingURL of each script that has one. */
  private readonly mapUrls = new Map<string, string>();
  /** Parsed maps by scriptId (null = could not be read). */
  private readonly maps = new Map<string, Promise<SourceMap | null>>();
  /** Breakpoints wanted per file (absolute path), to bind them in scripts that load later. */
  private readonly wanted = new Map<string, Breakpoint[]>();
  /** Breakpoint ids set by script id (through a source map), per file. */
  private readonly mappedIds = new Map<string, string[]>();
  /** Files whose own URL runs transformed code: their URL breakpoints would bind wrong lines. */
  private readonly transformed = new Set<string>();

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
      /**
       * Start this process and attach to the inspector it opens on `port` (a test runner run
       * with --inspect-brk opens it in its worker). Stopping kills the whole process.
       */
      spawn?: { command: string; args: string[] };
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
    if (o.spawn) return this.spawnAndWait(o.spawn);
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

  /** Runs the command and polls its inspector port until a target shows up. */
  private async spawnAndWait(cmd: { command: string; args: string[] }): Promise<string> {
    const o = this.opts;
    // Vitest stops at the first line of the test file by itself: skipped like --inspect-brk.
    const proc = spawn(cmd.command, cmd.args, {
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
    const err = lineSplitter((line) => {
      if (!INSPECTOR_NOISE.test(line)) this.ev.output('stderr', `${line}\n`);
    });
    proc.stderr!.on('data', (d: Buffer) => err.push(d.toString('utf8')));
    proc.on('exit', () => err.flush());
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (this.exited) throw new Error('The program exited before the debugger could attach.');
      try {
        const r = await fetch(`http://${o.host}:${o.port ?? 9229}/json/list`);
        const list = (await r.json()) as { webSocketDebuggerUrl?: string }[];
        const url = list.find((x) => x.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
        if (url) return url;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('The program did not open its inspector.');
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
      if (this.opts.request === 'attach' && !this.opts.spawn) this.finish();
    };
    await this.send('Runtime.enable');
    await this.send('Debugger.enable');
    // Pause each script that has a source map before it runs, to bind breakpoints in it.
    await this.send('Debugger.setInstrumentationBreakpoint', {
      instrumentation: 'beforeScriptWithSourceMapExecution',
    }).catch(() => undefined);
    for (const [path, bps] of breakpoints) await this.setBreakpoints(path, bps).catch(() => []);
    await this.send('Runtime.runIfWaitingForDebugger');
  }

  private onMessage(raw: string): void {
    let m: {
      id?: number;
      method?: string;
      params?: CdpEventParams;
      result?: unknown;
      error?: { message?: string };
    };
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
        if (params.url && params.scriptId) this.scripts.set(params.scriptId, params.url);
        if (params.scriptId && params.sourceMapURL)
          this.mapUrls.set(params.scriptId, params.sourceMapURL);
        break;
      case 'Debugger.paused': {
        const frames = params.callFrames ?? [];
        if (params.reason === 'instrumentation') {
          const id = (params.data as { scriptId?: string } | undefined)?.scriptId;
          void this.bindScript(id).finally(
            () => void this.send('Debugger.resume').catch(() => undefined),
          );
          return;
        }
        // --inspect-brk stops before the first line: go on unless asked to stop on entry.
        if (!this.sawStartPause && this.opts.request === 'launch') {
          this.sawStartPause = true;
          if (!this.opts.stopOnEntry && !((params.hitBreakpoints?.length ?? 0) > 0)) {
            void this.send('Debugger.resume');
            return;
          }
        }
        this.paused = frames;
        this.frameIds = new Map();
        frames.forEach((f, i) => this.frameIds.set(i + 1, f));
        const reason =
          (params.hitBreakpoints?.length ?? 0) > 0
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

  private map(scriptId: string): Promise<SourceMap | null> | undefined {
    const url = this.mapUrls.get(scriptId);
    if (!url) return undefined;
    let m = this.maps.get(scriptId);
    if (!m) {
      const scriptUrl = this.scripts.get(scriptId) ?? '';
      m = loadSourceMap(url, scriptUrl, (p) => readFile(p, 'utf8'));
      this.maps.set(scriptId, m);
    }
    return m;
  }

  /** A script with a source map is about to run: binds the wanted breakpoints of its sources. */
  private async bindScript(scriptId: string | undefined): Promise<void> {
    if (!scriptId || !this.wanted.size) return;
    const map = await this.map(scriptId);
    if (!map) return;
    const own = this.pathOf(this.scripts.get(scriptId));
    for (const [file, bps] of this.wanted) {
      if (!map.hasSource(file)) continue;
      if (own && pathKey(own) === pathKey(file) && !this.transformed.has(file)) {
        // The file's own URL runs transformed code: drop the URL breakpoints (wrong lines).
        this.transformed.add(file);
        for (const id of this.bpIds.get(file) ?? [])
          await this.send('Debugger.removeBreakpoint', { breakpointId: id }).catch(() => undefined);
        this.bpIds.set(file, []);
      }
      await this.bindInScript(scriptId, map, file, bps);
    }
  }

  private async bindInScript(
    scriptId: string,
    map: SourceMap,
    file: string,
    bps: Breakpoint[],
  ): Promise<number[]> {
    const lines: number[] = [];
    const ids = this.mappedIds.get(file) ?? [];
    for (const b of bps) {
      const at = map.generatedFor(file, b.line);
      if (!at) continue;
      const r = await this.send<{
        breakpointId: string;
        actualLocation: { lineNumber: number; columnNumber?: number };
      }>('Debugger.setBreakpoint', {
        location: { scriptId, lineNumber: at.line, columnNumber: at.column },
        ...cdpCondition(b),
      }).catch(() => undefined);
      if (!r) continue;
      ids.push(r.breakpointId);
      const orig = map.originalFor(r.actualLocation.lineNumber, r.actualLocation.columnNumber ?? 0);
      lines.push(orig && pathKey(orig.path) === pathKey(file) ? orig.line : b.line);
    }
    this.mappedIds.set(file, ids);
    return lines;
  }

  async setBreakpoints(absPath: string, bps: Breakpoint[]): Promise<number[]> {
    this.wanted.set(absPath, bps);
    for (const id of [...(this.bpIds.get(absPath) ?? []), ...(this.mappedIds.get(absPath) ?? [])])
      await this.send('Debugger.removeBreakpoint', { breakpointId: id }).catch(() => undefined);
    this.mappedIds.set(absPath, []);
    // Scripts already loaded whose source map includes the file.
    const mapped: number[] = [];
    for (const scriptId of this.mapUrls.keys()) {
      const map = await this.map(scriptId);
      if (map?.hasSource(absPath))
        mapped.push(...(await this.bindInScript(scriptId, map, absPath, bps)));
    }
    if (this.transformed.has(absPath)) {
      this.bpIds.set(absPath, []);
      return mapped;
    }
    const ids: string[] = [];
    const lines: number[] = [...mapped];
    const urlRegex = urlRegexFor(absPath);
    for (const b of bps) {
      const r = await this.send<{
        breakpointId: string;
        locations: { lineNumber: number }[];
      }>('Debugger.setBreakpointByUrl', {
        lineNumber: b.line - 1,
        urlRegex,
        ...cdpCondition(b),
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
      kind === 'over'
        ? 'Debugger.stepOver'
        : kind === 'into'
          ? 'Debugger.stepInto'
          : 'Debugger.stepOut',
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
    const out: RawFrame[] = [];
    for (const [id, f] of this.frameIds) {
      const map = await this.map(f.location.scriptId);
      const orig = map?.originalFor(f.location.lineNumber, f.location.columnNumber ?? 0);
      out.push({
        id,
        name: f.functionName || '(anonymous)',
        absPath: orig?.path ?? this.pathOf(f.url || this.scripts.get(f.location.scriptId)),
        line: orig?.line ?? f.location.lineNumber + 1,
        column: orig?.column ?? (f.location.columnNumber ?? 0) + 1,
      });
    }
    return out;
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
    const r = await this.send<{
      result: RemoteObject;
      exceptionDetails?: { exception?: RemoteObject; text?: string };
    }>(
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
    const proc = this.proc;
    if (proc && proc.exitCode === null) {
      // A test runner has workers: on Windows kill() would only end the parent.
      if (this.opts.spawn && process.platform === 'win32' && proc.pid)
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).on('error', () => proc.kill());
      else proc.kill();
    }
    if (!proc) this.finish();
  }
}

/** The CDP condition of a breakpoint (logpoints become a condition that prints, see logpointCondition). */
function cdpCondition(b: Breakpoint): { condition?: string } {
  if (b.logMessage?.trim()) return { condition: logpointCondition(b.logMessage, b.condition) };
  return b.condition ? { condition: b.condition } : {};
}
