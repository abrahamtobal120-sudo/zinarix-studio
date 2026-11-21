import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  Breakpoint,
  DebugConfig,
  DebugConfigList,
  DebugEvent,
  DebugFrame,
  DebugVariable,
} from '../../shared/devtools.js';
import { childEnv } from '../env.js';
import { findPython, which, type BackendEvents, type DebugBackend } from './backend.js';

export { findPython } from './backend.js';
import { CdpBackend } from './cdpBackend.js';
import { autoConfig, kindOf, parseLaunchJson, resolveConfig, substitute } from './config.js';
import { DapBackend } from './dapBackend.js';
import { testCommand, type TestRunRequest } from '../testing.js';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const LAUNCH_FILES = ['.zinarix/launch.json', '.vscode/launch.json'];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function hasDebugpy(py: { cmd: string; pre: string[] }): boolean {
  const r = spawnSync(py.cmd, [...py.pre, '-c', 'import debugpy'], {
    timeout: 15_000,
    windowsHide: true,
  });
  return r.status === 0;
}

export class DebugError extends Error {}

/** Fase 6: finds the Godot 4 executable (set by main from the Games service). */
let godotLocator: (() => Promise<string | null>) | null = null;
export function setGodotLocator(fn: () => Promise<string | null>): void {
  godotLocator = fn;
}

interface GodotPrep {
  exe: string;
  project: string;
  port: number;
}

/** Nearest folder with project.godot from a file up to the root (or the root's own). */
function godotProjectOf(root: string, file: string | undefined): string | null {
  let d = file ? dirname(file) : root;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(d, 'project.godot'))) return d;
    const up = dirname(d);
    if (up === d || !up.startsWith(root)) break;
    d = up;
  }
  return existsSync(join(root, 'project.godot')) ? root : null;
}

/**
 * The debug session of one window: picks the backend for a configuration, keeps the
 * breakpoints in sync and turns backend events into DebugEvents for the renderer.
 */
export class DebugManager {
  private backend?: DebugBackend;
  private root = '';
  private thread = 1;
  private last?: {
    root: string;
    config: DebugConfig | null;
    file?: string;
    breakpoints: Record<string, Breakpoint[]>;
    /** Set when the session debugs a test (restart runs the same test). */
    test?: TestRunRequest;
  };
  /** Bumped per session so events of a stopped session are ignored. */
  private generation = 0;

  constructor(private readonly emit: (ev: DebugEvent) => void) {}

  async configs(root: string, file?: string): Promise<DebugConfigList> {
    for (const f of LAUNCH_FILES) {
      try {
        const text = await readFile(join(root, f), 'utf8');
        return { configs: parseLaunchJson(text), file: f };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new DebugError(`${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const auto = file ? autoConfig(file) : null;
    return { configs: auto ? [auto] : [] };
  }

  get running(): boolean {
    return Boolean(this.backend);
  }

  private rel(abs: string | undefined): string | undefined {
    if (!abs) return undefined;
    const r = relative(this.root, abs);
    if (!r || r.startsWith('..') || isAbsolute(r)) return undefined;
    return r.split(sep).join('/');
  }

  private abs(rel: string): string {
    return join(this.root, ...rel.split('/'));
  }

  async start(
    root: string,
    config: DebugConfig | null,
    file: string | undefined,
    breakpoints: Record<string, Breakpoint[]>,
  ): Promise<void> {
    if (this.backend) await this.stop();
    this.last = { root, config, file, breakpoints };
    this.root = root;
    const cfg0 = config ?? (file ? autoConfig(file) : null);
    if (!cfg0)
      throw new DebugError(
        'No sé cómo depurar este archivo. Abre un archivo .js/.ts, .py, .go o .gd (Godot), o crea .zinarix/launch.json.',
      );
    const cfg = resolveConfig(cfg0, root, file);
    let godot: GodotPrep | undefined;
    if (kindOf(cfg.type) === 'godot') {
      const exe = await godotLocator?.().catch(() => null);
      if (!exe)
        throw new DebugError('No encontré Godot 4. Descárgalo de godotengine.org y elígelo en Más → Juegos.');
      const project = godotProjectOf(root, cfg.program);
      if (!project) throw new DebugError('No encontré project.godot en la carpeta abierta.');
      godot = { exe, project, port: await freePort() };
      if (cfg.scene) cfg.scene = substitute(cfg.scene, root, file);
    }
    await this.launch(cfg.name, (ev) => this.create(cfg, ev, godot), breakpoints);
  }

  /**
   * Debugs one test (or a describe / file) with its runner: Vitest through the inspector it opens
   * in its worker, Jest in band under Node's inspector, Pytest through debugpy.
   */
  async startTest(
    root: string,
    req: TestRunRequest,
    breakpoints: Record<string, Breakpoint[]>,
  ): Promise<void> {
    if (this.backend) await this.stop();
    this.last = { root, config: null, breakpoints, test: req };
    this.root = root;
    const report = join(
      tmpdir(),
      `zinarix-debug-${randomBytes(6).toString('hex')}.${req.framework === 'pytest' ? 'xml' : 'json'}`,
    );
    const cmd = testCommand(root, req, report);
    const env = childEnv({ ...process.env, FORCE_COLOR: '0' });
    const name = req.item?.fullName || req.files?.[0] || req.framework;
    if (req.framework === 'vitest') {
      const port = await freePort();
      await this.launch(
        name,
        (ev) =>
          new CdpBackend(
            {
              request: 'launch',
              node: cmd.command,
              args: [],
              cwd: cmd.cwd,
              env,
              host: '127.0.0.1',
              port,
              stopOnEntry: false,
              spawn: {
                command: cmd.command,
                args: [
                  ...cmd.args,
                  `--inspect-brk=127.0.0.1:${port}`,
                  '--no-file-parallelism',
                  '--test-timeout=0',
                  '--hook-timeout=0',
                ],
              },
            },
            ev,
          ),
        breakpoints,
      );
      return;
    }
    if (req.framework === 'jest') {
      const [script, ...args] = cmd.args;
      await this.launch(
        name,
        (ev) =>
          new CdpBackend(
            {
              request: 'launch',
              node: cmd.command,
              program: script,
              args: [...args, '--runInBand', '--testTimeout=2147483647'],
              cwd: cmd.cwd,
              env,
              host: '127.0.0.1',
              stopOnEntry: false,
            },
            ev,
          ),
        breakpoints,
      );
      return;
    }
    const py = findPython();
    if (!py)
      throw new DebugError('No encontré Python en el PATH. Instálalo desde https://python.org.');
    if (!hasDebugpy(py))
      throw new DebugError(
        'Falta el depurador de Python (debugpy). Instálalo con:  pip install debugpy',
      );
    // cmd.args = [...pre, '-m', 'pytest', ...rest]
    const rest = cmd.args.slice(py.pre.length + 2);
    await this.launch(
      name,
      (ev) =>
        new DapBackend(
          {
            kind: 'stdio',
            command: py.cmd,
            args: [...py.pre, '-m', 'debugpy.adapter'],
            cwd: cmd.cwd,
            env,
          },
          'debugpy',
          'launch',
          {
            type: 'python',
            request: 'launch',
            module: 'pytest',
            args: rest,
            cwd: cmd.cwd,
            console: 'internalConsole',
            redirectOutput: true,
            justMyCode: true,
          },
          ev,
        ),
      breakpoints,
    );
  }

  private async launch(
    name: string,
    make: (ev: BackendEvents) => DebugBackend,
    breakpoints: Record<string, Breakpoint[]>,
  ): Promise<void> {
    const cfg = { name };
    const gen = ++this.generation;
    const ev: BackendEvents = {
      stopped: (reason, threadId, description) => {
        if (gen !== this.generation) return;
        this.thread = threadId;
        void this.reportStop(gen, reason, threadId, description);
      },
      continued: () => {
        if (gen === this.generation) this.emit({ kind: 'state', state: 'running' });
      },
      output: (category, text) => {
        if (gen === this.generation && text) this.emit({ kind: 'output', category, text });
      },
      exited: (code) => {
        if (gen !== this.generation) return;
        this.backend = undefined;
        if (code !== undefined)
          this.emit({ kind: 'output', category: 'info', text: `\n[proceso terminado: ${code}]\n` });
        this.emit({ kind: 'state', state: 'idle' });
      },
    };
    this.backend = make(ev);
    this.emit({ kind: 'state', state: 'starting', name: cfg.name });
    const map = new Map<string, Breakpoint[]>();
    for (const [rel, bps] of Object.entries(breakpoints)) if (bps.length) map.set(this.abs(rel), bps);
    try {
      await this.backend.start(map);
      if (gen === this.generation && this.backend)
        this.emit({ kind: 'state', state: 'running', name: cfg.name });
    } catch (e) {
      const b = this.backend;
      this.backend = undefined;
      this.generation++;
      await b?.stop().catch(() => undefined);
      this.emit({ kind: 'state', state: 'idle' });
      throw e;
    }
  }

  private async reportStop(
    gen: number,
    reason: string,
    threadId: number,
    description?: string,
  ): Promise<void> {
    const raw = await this.backend?.frames(threadId).catch(() => []);
    if (gen !== this.generation) return;
    const frames: DebugFrame[] = (raw ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      path: this.rel(f.absPath),
      absPath: f.absPath,
      line: f.line,
      column: f.column,
    }));
    this.emit({ kind: 'state', state: 'stopped' });
    this.emit({ kind: 'stopped', reason, threadId, frames, description });
  }

  private create(cfg: DebugConfig, ev: BackendEvents, godot?: GodotPrep): DebugBackend {
    const kind = kindOf(cfg.type);
    const env = childEnv({ ...process.env, ...cfg.env });
    const cwd = cfg.cwd ?? this.root;
    const host = cfg.host ?? '127.0.0.1';
    const attach = cfg.request === 'attach';
    if (!attach && !cfg.program && kind !== 'go' && kind !== 'godot')
      throw new DebugError('La configuración no dice qué programa ejecutar ("program").');
    switch (kind) {
      case 'node': {
        const node = which('node');
        if (!node && !attach)
          throw new DebugError('No encontré Node.js en el PATH. Instálalo desde https://nodejs.org.');
        return new CdpBackend(
          {
            request: cfg.request,
            node: node ?? 'node',
            program: cfg.program,
            args: cfg.args ?? [],
            cwd,
            env,
            host,
            port: cfg.port,
            stopOnEntry: cfg.stopOnEntry === true,
          },
          ev,
        );
      }
      case 'python': {
        const py = findPython();
        if (!py)
          throw new DebugError('No encontré Python en el PATH. Instálalo desde https://python.org.');
        if (!hasDebugpy(py))
          throw new DebugError(
            'Falta el depurador de Python (debugpy). Instálalo con:  pip install debugpy',
          );
        const args = attach
          ? { request: 'attach', connect: { host, port: cfg.port ?? 5678 }, justMyCode: true }
          : {
              type: 'python',
              request: 'launch',
              program: cfg.program,
              args: cfg.args,
              cwd,
              env: cfg.env,
              console: 'internalConsole',
              redirectOutput: true,
              justMyCode: true,
              stopOnEntry: cfg.stopOnEntry === true,
            };
        return new DapBackend(
          { kind: 'stdio', command: py.cmd, args: [...py.pre, '-m', 'debugpy.adapter'], cwd, env },
          'debugpy',
          cfg.request,
          args,
          ev,
        );
      }
      case 'go': {
        if (attach)
          return new DapBackend(
            { kind: 'tcp', host, port: cfg.port ?? 2345 },
            'go',
            'attach',
            { request: 'attach', mode: 'remote' },
            ev,
          );
        const dlv = which('dlv');
        if (!dlv)
          throw new DebugError(
            'No encontré Delve (dlv). Instálalo con:  go install github.com/go-delve/delve/cmd/dlv@latest',
          );
        return new DapBackend(
          {
            kind: 'server',
            command: dlv,
            args: ['dap', '--listen=127.0.0.1:0'],
            cwd,
            env,
            portPattern: /listening at:?\s*\[?[\w.:]*?\]?:(\d+)/i,
          },
          'go',
          'launch',
          {
            request: 'launch',
            mode: 'debug',
            program: cfg.program ?? cwd,
            args: cfg.args,
            cwd,
            env: cfg.env,
            stopOnEntry: cfg.stopOnEntry === true,
          },
          ev,
        );
      }
      case 'lldb': {
        if (attach && cfg.port)
          return new DapBackend(
            { kind: 'tcp', host, port: cfg.port },
            'lldb',
            'attach',
            { request: 'attach', program: cfg.program },
            ev,
          );
        const lldbDap = which('lldb-dap') ?? which('lldb-vscode');
        const launch = {
          request: 'launch',
          program: cfg.program,
          args: cfg.args ?? [],
          cwd,
          stopOnEntry: cfg.stopOnEntry === true,
        };
        if (lldbDap)
          return new DapBackend(
            { kind: 'stdio', command: lldbDap, args: [], cwd, env },
            'lldb-dap',
            'launch',
            { ...launch, env: Object.entries(cfg.env ?? {}).map(([k, v]) => `${k}=${v}`) },
            ev,
          );
        const codelldb = which('codelldb');
        if (codelldb) return new LazyCodelldb(codelldb, cwd, env, { ...launch, env: cfg.env }, ev);
        throw new DebugError(
          'No encontré un depurador LLDB (lldb-dap, lldb-vscode o codelldb) en el PATH. Instala LLVM.',
        );
      }
      case 'godot': {
        if (!godot) throw new DebugError('No encontré Godot 4.');
        // Godot's debug adapter lives in its editor: a headless one serves it on a free port and
        // runs the game when it gets "launch". Scene: "main", or the .tscn as res://.
        let scene = cfg.scene || 'main';
        if (/\.tscn$/i.test(scene)) {
          const rel = relative(godot.project, isAbsolute(scene) ? scene : join(this.root, scene));
          scene = rel.startsWith('..') ? 'main' : `res://${rel.split(sep).join('/')}`;
        }
        return new DapBackend(
          {
            kind: 'fixedServer',
            command: godot.exe,
            args: ['--editor', '--headless', '--path', godot.project, '--dap-port', String(godot.port)],
            cwd: godot.project,
            env,
            port: godot.port,
            quiet: true,
          },
          'godot',
          'launch',
          { project: godot.project.split(sep).join('/'), scene, ...(cfg.args?.length ? { additional_options: cfg.args.join(' ') } : {}) },
          ev,
        );
      }
      default:
        throw new DebugError(`Tipo de depuración no soportado: "${cfg.type}".`);
    }
  }

  async setBreakpoints(rel: string, bps: Breakpoint[]): Promise<void> {
    if (this.last) this.last.breakpoints[rel] = bps;
    if (!this.backend) return;
    const lines = await this.backend.setBreakpoints(this.abs(rel), bps);
    this.emit({ kind: 'breakpoints', path: rel, lines });
  }

  private need(): DebugBackend {
    if (!this.backend) throw new DebugError('No hay ninguna sesión de depuración.');
    return this.backend;
  }

  async resume(): Promise<void> {
    await this.need().resume(this.thread);
  }

  async pause(): Promise<void> {
    await this.need().pause(this.thread);
  }

  async step(kind: 'over' | 'into' | 'out'): Promise<void> {
    await this.need().step(kind, this.thread);
  }

  scopes(frameId: number): Promise<DebugVariable[]> {
    return this.need().scopes(frameId);
  }

  variables(ref: number): Promise<DebugVariable[]> {
    return this.need().variables(ref);
  }

  evaluate(expression: string, frameId?: number): Promise<DebugVariable> {
    return this.need().evaluate(expression, frameId);
  }

  async stop(): Promise<void> {
    const b = this.backend;
    this.backend = undefined;
    this.generation++;
    if (b) await b.stop().catch(() => undefined);
    this.emit({ kind: 'state', state: 'idle' });
  }

  async restart(): Promise<void> {
    const l = this.last;
    if (!l) throw new DebugError('No hay una sesión anterior que reiniciar.');
    await this.stop();
    if (l.test) await this.startTest(l.root, l.test, l.breakpoints);
    else await this.start(l.root, l.config, l.file, l.breakpoints);
  }
}

/** codelldb listens on a port we pick; the port is only known once it is free. */
class LazyCodelldb implements DebugBackend {
  private inner?: DapBackend;
  constructor(
    private readonly cmd: string,
    private readonly cwd: string,
    private readonly env: Record<string, string>,
    private readonly launch: Record<string, unknown>,
    private readonly ev: BackendEvents,
  ) {}
  private get b(): DapBackend {
    if (!this.inner) throw new Error('not started');
    return this.inner;
  }
  async start(bps: Map<string, Breakpoint[]>): Promise<void> {
    const port = await freePort();
    this.inner = new DapBackend(
      {
        kind: 'fixedServer',
        command: this.cmd,
        args: ['--port', String(port)],
        cwd: this.cwd,
        env: this.env,
        port,
      },
      'lldb',
      'launch',
      { type: 'lldb', ...this.launch },
      this.ev,
    );
    await this.inner.start(bps);
  }
  setBreakpoints(p: string, bps: Breakpoint[]) {
    return this.b.setBreakpoints(p, bps);
  }
  resume(t: number) {
    return this.b.resume(t);
  }
  pause(t: number) {
    return this.b.pause(t);
  }
  step(k: 'over' | 'into' | 'out', t: number) {
    return this.b.step(k, t);
  }
  frames(t: number) {
    return this.b.frames(t);
  }
  scopes(f: number) {
    return this.b.scopes(f);
  }
  variables(r: number) {
    return this.b.variables(r);
  }
  evaluate(e: string, f?: number) {
    return this.b.evaluate(e, f);
  }
  async stop() {
    await this.inner?.stop();
  }
}
