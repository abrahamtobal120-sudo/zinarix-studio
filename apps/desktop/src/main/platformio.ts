import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { childEnv } from './env.js';
import {
  keepTail,
  libName,
  parseBoards,
  parseDevices,
  parseLibSearch,
  parsePlatformioIni,
  parseResult,
  runArgs,
  starterSketch,
  validBaud,
  validBoardId,
  validEnvName,
  validLibQuery,
  validLibSpec,
  validPort,
  validProjectDir,
  type PioBoard,
  type PioInstalledLibs,
  type PioLibrary,
  type PioDevice,
  type PioJob,
  type PioProject,
  type PioResult,
  type PioStatus,
} from '../shared/platformio.js';

/**
 * Fase 5A (plan de funciones): Arduino and other boards through PlatformIO Core (`pio`), the
 * same CLI the PlatformIO IDE uses. Builds and uploads stream their output; the serial
 * monitor is a small pyserial loop run with PlatformIO's own Python (pyserial comes with it),
 * so no native Node module is needed. Never a shell; arguments are checked first.
 */

const SERIAL_KEEP = 256 * 1024;

/** Reads the port to stdout and writes stdin to it; "READY" / errors on stderr. */
const SERIAL_SCRIPT = String.raw`
import sys, threading
try:
    import serial
except Exception as e:
    sys.stderr.write("NOPYSERIAL " + str(e) + "\n"); sys.stderr.flush(); sys.exit(3)
port, baud = sys.argv[1], int(sys.argv[2])
try:
    s = serial.serial_for_url(port, baudrate=baud, timeout=0.05)
except Exception as e:
    sys.stderr.write("OPENFAIL " + str(e) + "\n"); sys.stderr.flush(); sys.exit(2)
sys.stderr.write("READY\n"); sys.stderr.flush()
alive = True
def writer():
    global alive
    inp = sys.stdin.buffer
    while alive:
        try:
            b = inp.read1(4096) if hasattr(inp, "read1") else inp.read(1)
        except Exception:
            b = b""
        if not b:
            alive = False
            break
        try:
            s.write(b)
        except Exception as e:
            sys.stderr.write("WRITEFAIL " + str(e) + "\n"); sys.stderr.flush()
threading.Thread(target=writer, daemon=True).start()
out = sys.stdout.buffer
while alive:
    try:
        b = s.read(s.in_waiting or 1)
    except Exception as e:
        sys.stderr.write("READFAIL " + str(e) + "\n"); sys.stderr.flush()
        break
    if b:
        out.write(b); out.flush()
try:
    s.close()
except Exception:
    pass
`;

interface Serial {
  proc: ChildProcess;
  baud: number;
  text: string;
  ready: Promise<void>;
}

export class PlatformioService {
  private found: { bin: string; python: string | null; version: string } | null | undefined;
  private jobs = new Map<string, ChildProcess>();
  private serials = new Map<string, Serial>();
  /** Lets main forward serial output and state to the windows. */
  onSerial: (port: string, chunk: string) => void = () => undefined;
  onSerialState: (port: string, open: boolean, error?: string) => void = () => undefined;

  constructor(private readonly home = homedir()) {}

  private candidates(): { bin: string; python: string | null }[] {
    const penv = join(this.home, '.platformio', 'penv');
    const win = process.platform === 'win32';
    const py = join(penv, win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');
    const python = existsSync(py) ? py : null;
    const own = join(penv, win ? 'Scripts' : 'bin', win ? 'pio.exe' : 'pio');
    return [
      ...(existsSync(own) ? [{ bin: own, python }] : []),
      { bin: 'pio', python },
      { bin: 'platformio', python },
    ];
  }

  async status(force = false): Promise<PioStatus> {
    if (force) this.found = undefined;
    if (this.found === undefined) {
      this.found = null;
      for (const c of this.candidates()) {
        try {
          const out = await exec(c.bin, ['--version'], 20_000);
          const version = /version\s+([\w.+-]+)/i.exec(out)?.[1] ?? out.trim();
          this.found = { ...c, version };
          break;
        } catch {
          /* next */
        }
      }
    }
    return this.found
      ? { state: 'ready', version: this.found.version, bin: this.found.bin, python: this.found.python }
      : { state: 'missing' };
  }

  private async bin(): Promise<string> {
    const st = await this.status();
    if (st.state !== 'ready')
      throw new Error('PlatformIO no está instalado (pip install platformio, o la extensión de VS Code).');
    return st.bin;
  }

  /** platformio.ini of the folder itself and of the folders one and two levels down. */
  async projects(root: string): Promise<PioProject[]> {
    const dirs: string[] = [];
    const look = async (dir: string, depth: number) => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'platformio.ini')) dirs.push(dir);
      if (depth > 0)
        for (const e of entries)
          if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '.pio')
            await look(join(dir, e.name), depth - 1);
    };
    await look(root, 2);
    const out: PioProject[] = [];
    for (const dir of dirs) {
      const text = await readFile(join(dir, 'platformio.ini'), 'utf8').catch(() => '');
      const { envs, defaultEnvs } = parsePlatformioIni(text);
      out.push({
        dir: relative(root, dir).replace(/\\/g, '/'),
        envs,
        defaultEnvs,
        compileDb: existsSync(join(dir, 'compile_commands.json')),
      });
    }
    return out;
  }

  async devices(): Promise<PioDevice[]> {
    return parseDevices(await exec(await this.bin(), ['device', 'list', '--serial', '--json-output'], 30_000));
  }

  /** Boards PlatformIO knows (search words, e.g. "esp32" or "uno"). */
  async boards(query: string): Promise<PioBoard[]> {
    const q = query.trim().slice(0, 80);
    if (q && !/^[\w .+-]+$/.test(q)) throw new Error('Búsqueda no válida.');
    const args = ['boards', '--json-output', ...(q ? q.split(/\s+/) : [])];
    return parseBoards(await exec(await this.bin(), args, 60_000));
  }

  private absDir(root: string, dir: string): string {
    if (!validProjectDir(dir)) throw new Error('Carpeta de proyecto no válida.');
    const abs = dir ? join(root, dir) : root;
    if (!existsSync(join(abs, 'platformio.ini'))) throw new Error('Esa carpeta no tiene platformio.ini.');
    return abs;
  }

  /** Streams a build / upload / clean: output to onData, then onEnd. */
  async startJob(
    key: string,
    root: string,
    job: PioJob,
    onData: (chunk: string) => void,
    onEnd: (result: PioResult) => void,
  ): Promise<void> {
    const args = runArgs(this.absDir(root, job.dir), job);
    const bin = await this.bin();
    this.stopJob(key);
    // Uploading needs the port: the monitor lets it go and comes back afterwards.
    const reopen = job.target === 'upload' ? await this.releasePorts(job.port ?? null) : [];
    const p = spawn(bin, args, { windowsHide: true, env: pioEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    this.jobs.set(key, p);
    let all = '';
    const take = (b: Buffer) => {
      const s = b.toString('utf8');
      all = keepTail(all + s, 2 * 1024 * 1024);
      onData(s);
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    let ended = false;
    const end = (ok: boolean) => {
      if (ended) return;
      ended = true;
      if (this.jobs.get(key) === p) this.jobs.delete(key);
      for (const r of reopen) void this.openSerial(r.port, r.baud).catch(() => undefined);
      onEnd(parseResult(all, ok));
    };
    p.on('close', (code) => end(code === 0));
    p.on('error', (e) => {
      onData(`${e.message}\n`);
      end(false);
    });
  }

  /** The same, waited for (the agent's tools): result plus the end of the output. */
  async runJob(root: string, job: PioJob, signal?: AbortSignal): Promise<PioResult & { tail: string }> {
    return new Promise((resolve, reject) => {
      const key = `agent:${Math.random().toString(36).slice(2)}`;
      let out = '';
      const onAbort = () => this.stopJob(key);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.startJob(
        key,
        root,
        job,
        (c) => (out = keepTail(out + c, 1024 * 1024)),
        (r) => {
          signal?.removeEventListener('abort', onAbort);
          resolve({ ...r, tail: out.split(/\r?\n/).slice(-80).join('\n') });
        },
      ).catch(reject);
    });
  }

  stopJob(key: string): void {
    const p = this.jobs.get(key);
    if (!p) return;
    this.jobs.delete(key);
    killTree(p);
  }

  running(key: string): boolean {
    return this.jobs.has(key);
  }

  /** A new project: <root>/<name> with platformio.ini for the board and a starter sketch. */
  async createProject(root: string, name: string, board: string, framework: string): Promise<string> {
    if (!/^[\w][\w .-]{0,63}$/.test(name) || name.includes('..')) throw new Error('Nombre no válido.');
    if (!validBoardId(board)) throw new Error('Placa no válida.');
    if (!/^[\w-]{1,40}$/.test(framework)) throw new Error('Framework no válido.');
    const dir = join(root, name.trim());
    if (existsSync(join(dir, 'platformio.ini'))) throw new Error('Ya hay un proyecto con ese nombre.');
    await mkdir(dir, { recursive: true });
    const args = ['project', 'init', '-d', dir, '-b', board, '--project-option', `framework=${framework}`];
    await exec(await this.bin(), args, 10 * 60_000);
    const src = join(dir, 'src');
    await mkdir(src, { recursive: true });
    const files = await readdir(src).catch(() => [] as string[]);
    if (!files.some((f) => /\.(c|cpp|ino)$/i.test(f)))
      await writeFile(join(src, 'main.cpp'), starterSketch(framework), 'utf8');
    return relative(root, dir).replace(/\\/g, '/');
  }

  // ---------------- libraries ----------------

  /** The PlatformIO registry (needs internet). */
  async searchLibraries(query: string, page = 1): Promise<{ libraries: PioLibrary[]; total: number; pages: number }> {
    if (!validLibQuery(query)) throw new Error('Búsqueda no válida.');
    const p = Math.max(1, Math.min(100, Math.floor(page)));
    return parseLibSearch(await exec(await this.bin(), ['pkg', 'search', query.trim(), '-p', String(p)], 60_000));
  }

  /** lib_deps of the env and the libraries downloaded for it (.pio/libdeps/<env>). */
  async libraries(root: string, dir: string, env: string | null): Promise<PioInstalledLibs> {
    const abs = this.absDir(root, dir);
    const { envs, defaultEnvs } = parsePlatformioIni(await readFile(join(abs, 'platformio.ini'), 'utf8'));
    const e = envs.find((x) => x.name === env) ?? envs.find((x) => x.name === defaultEnvs[0]) ?? envs[0];
    if (!e) return { env: null, deps: [], installed: [] };
    const base = join(abs, '.pio', 'libdeps', e.name);
    const names = await readdir(base, { withFileTypes: true }).catch(() => []);
    const installed: { name: string; version: string }[] = [];
    for (const d of names) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;
      let version = '';
      const json = await readFile(join(base, d.name, 'library.json'), 'utf8').catch(() => null);
      if (json)
        try {
          version = String((JSON.parse(json) as { version?: unknown }).version ?? '');
        } catch {
          /* keep */
        }
      if (!version) {
        const props = await readFile(join(base, d.name, 'library.properties'), 'utf8').catch(() => '');
        version = /^version\s*=\s*(.+)$/m.exec(props)?.[1]?.trim() ?? '';
      }
      installed.push({ name: d.name, version });
    }
    return { env: e.name, deps: e.libDeps, installed };
  }

  /** pio pkg install / uninstall -l: downloads (or removes) it and saves lib_deps in platformio.ini. */
  async changeLibrary(
    root: string,
    dir: string,
    env: string | null,
    spec: string,
    remove: boolean,
  ): Promise<string> {
    if (!validLibSpec(spec)) throw new Error('Librería no válida (owner/nombre@versión).');
    if (env !== null && !validEnvName(env)) throw new Error('Entorno no válido.');
    const abs = this.absDir(root, dir);
    const args = ['pkg', remove ? 'uninstall' : 'install', '-d', abs, '-l', remove ? libName(spec) : spec.trim(), ...(env ? ['-e', env] : [])];
    return exec(await this.bin(), args, 10 * 60_000);
  }

  // ---------------- serial monitor ----------------

  async openSerial(port: string, baud: number): Promise<void> {
    if (!validPort(port)) throw new Error('Puerto no válido.');
    if (!validBaud(baud)) throw new Error('Velocidad no válida.');
    const cur = this.serials.get(port);
    if (cur && cur.baud === baud) return cur.ready;
    if (cur) this.closeSerial(port);
    const st = await this.status();
    const python = st.state === 'ready' ? st.python : null;
    if (!python) throw new Error('No se encontró el Python de PlatformIO (~/.platformio/penv) para el monitor serie.');
    const proc = spawn(python, ['-u', '-c', SERIAL_SCRIPT, port, String(baud)], {
      windowsHide: true,
      env: pioEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settle: { ok: () => void; fail: (e: Error) => void } | null = null;
    const ready = new Promise<void>((ok, fail) => (settle = { ok, fail }));
    const entry: Serial = { proc, baud, text: '', ready };
    this.serials.set(port, entry);
    let err = '';
    proc.stdout!.on('data', (b: Buffer) => {
      const s = b.toString('utf8');
      entry.text = keepTail(entry.text + s, SERIAL_KEEP);
      this.onSerial(port, s);
    });
    proc.stderr!.on('data', (b: Buffer) => {
      err += b.toString('utf8');
      if (/READY/.test(err) && settle) {
        settle.ok();
        settle = null;
        this.onSerialState(port, true);
      }
    });
    const timer = setTimeout(() => {
      if (settle) {
        settle.fail(new Error('El puerto no respondió.'));
        settle = null;
        this.closeSerial(port);
      }
    }, 15_000);
    proc.on('close', () => {
      clearTimeout(timer);
      const msg = serialError(err);
      if (settle) {
        settle.fail(new Error(msg || 'No se pudo abrir el puerto.'));
        settle = null;
      }
      if (this.serials.get(port) === entry) {
        this.serials.delete(port);
        this.onSerialState(port, false, msg || undefined);
      }
    });
    proc.on('error', (e) => {
      if (settle) {
        settle.fail(e);
        settle = null;
      }
    });
    proc.stdin!.on('error', () => undefined);
    return ready;
  }

  closeSerial(port: string): void {
    const s = this.serials.get(port);
    if (!s) return;
    this.serials.delete(port);
    try {
      s.proc.stdin?.end();
    } catch {
      /* gone */
    }
    // The loop ends when stdin closes; kill it if it does not within a moment.
    setTimeout(() => {
      if (s.proc.exitCode === null) s.proc.kill();
    }, 800);
    this.onSerialState(port, false);
  }

  async writeSerial(port: string, data: string): Promise<void> {
    const s = this.serials.get(port);
    if (!s) throw new Error('El monitor de ese puerto no está abierto.');
    if (data.length > 64 * 1024) throw new Error('Demasiado texto.');
    await s.ready;
    await new Promise<void>((ok, fail) => s.proc.stdin!.write(Buffer.from(data, 'utf8'), (e) => (e ? fail(e) : ok())));
  }

  serialText(port: string): string | null {
    return this.serials.get(port)?.text ?? null;
  }

  clearSerial(port: string): void {
    const s = this.serials.get(port);
    if (s) s.text = '';
  }

  openPorts(): { port: string; baud: number }[] {
    return [...this.serials].map(([port, s]) => ({ port, baud: s.baud }));
  }

  /** Closes the monitors an upload needs (that port, or all when it is not known). */
  private async releasePorts(port: string | null): Promise<{ port: string; baud: number }[]> {
    const list = this.openPorts().filter((p) => p.port !== 'loop://' && (!port || p.port === port));
    for (const p of list) this.closeSerial(p.port);
    if (list.length) await new Promise((r) => setTimeout(r, 900));
    return list;
  }

  dispose(): void {
    for (const k of [...this.jobs.keys()]) this.stopJob(k);
    for (const p of [...this.serials.keys()]) this.closeSerial(p);
  }
}

function serialError(stderr: string): string {
  const m = /(OPENFAIL|READFAIL|NOPYSERIAL)\s+(.+)/.exec(stderr);
  if (!m) return '';
  if (m[1] === 'NOPYSERIAL') return 'Falta pyserial en el Python de PlatformIO.';
  const msg = m[2]!.trim();
  if (/PermissionError|Access is denied|Acceso denegado|busy/i.test(msg))
    return 'El puerto está ocupado por otro programa (¿otro monitor serie abierto?).';
  if (/FileNotFoundError|could not open port|No such file/i.test(msg)) return 'El puerto no existe (¿la placa está conectada?).';
  return msg.slice(0, 300);
}

function pioEnv(): NodeJS.ProcessEnv {
  return {
    ...childEnv(process.env),
    PYTHONIOENCODING: 'utf-8',
    PLATFORMIO_DISABLE_PROGRESSBAR: 'true',
    PLATFORMIO_NO_ANSI: 'true',
  };
}

function exec(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: pioEnv() },
      (err, stdout, stderr) => {
        if (err) {
          const msg = `${String(stderr)}\n${String(stdout)}`.trim() || err.message;
          reject(new Error(msg.split('\n').slice(-6).join('\n')));
        } else resolve(String(stdout));
      },
    );
  });
}

/** pio starts SCons and compilers: on Windows only taskkill /T stops them all. */
function killTree(p: ChildProcess): void {
  if (process.platform === 'win32' && p.pid) {
    spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => p.kill());
  } else p.kill();
}
