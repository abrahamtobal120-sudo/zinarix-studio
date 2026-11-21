/**
 * Fase 7: CAD with OpenSCAD. Uses an installed OpenSCAD when there is one (faster, Manifold
 * backend) and the built-in WebAssembly one otherwise, so it works without installing
 * anything. Both get a private copy of the model and the files it uses (only files inside the
 * project), render to a temp folder, and are killed on timeout or cancel.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  parseScadLog,
  parseScadParams,
  scadDefines,
  scadDependencies,
  type CadFormat,
  type ScadLog,
  type ScadParam,
} from '../shared/cad.js';
import { taskEnv } from '../shared/sandbox.js';
import type { WasmRequest, WasmResponse } from './cadWorker.js';

export interface NativeScad {
  path: string;
  version: string;
  /** --backend=manifold is available (2024+ builds): much faster booleans. */
  manifold: boolean;
}

export interface CadEngines {
  native: NativeScad | null;
  builtin: boolean;
}

export type CadEngine = 'auto' | 'native' | 'builtin';

export interface CadRenderInput {
  /** The .scad on disk (its folder is where relative files are looked up). */
  file?: string;
  /** Source to render instead of the file's saved text (unsaved editor). */
  code?: string;
  /** Customizer values by parameter name. */
  values?: Record<string, unknown>;
  format?: CadFormat;
  /** Project folder: files outside it are never read. */
  root?: string;
  engine?: CadEngine;
  timeoutMs?: number;
}

export interface CadRenderResult {
  data: Buffer;
  format: CadFormat;
  log: ScadLog;
  /** What OpenSCAD printed, with temp paths turned back into the real ones. */
  raw: string;
  engine: 'native' | 'builtin';
  ms: number;
  params: ScadParam[];
}

export type BuiltinRunner = (req: WasmRequest, signal: AbortSignal, timeoutMs: number) => Promise<WasmResponse>;

const MAX_FILES = 300;
const MAX_BYTES = 150 * 1024 * 1024;

/** Runs dist/main/cadWorker.mjs as a Node process (Electron with ELECTRON_RUN_AS_NODE). */
export function builtinViaProcess(exe: string, script: string, env: Record<string, string> = {}): BuiltinRunner {
  return (req, signal, timeoutMs) =>
    new Promise((resolveP, reject) => {
      const p = spawn(exe, [script], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...taskEnv(process.env), ...env },
      });
      const out: Buffer[] = [];
      let err = '';
      const kill = () => p.kill('SIGKILL');
      const timer = setTimeout(kill, timeoutMs);
      signal.addEventListener('abort', kill, { once: true });
      p.stdout.on('data', (d: Buffer) => out.push(d));
      p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
      p.on('error', (e) => (clearTimeout(timer), reject(e)));
      p.on('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', kill);
        if (signal.aborted) return reject(new Error('Cancelado.'));
        try {
          resolveP(JSON.parse(Buffer.concat(out).toString('utf8')) as WasmResponse);
        } catch {
          reject(
            new Error(
              code === null
                ? `OpenSCAD tardó más de ${Math.round(timeoutMs / 1000)} s y se detuvo.`
                : `El OpenSCAD incluido falló (código ${code}): ${err.trim().slice(-400)}`,
            ),
          );
        }
      });
      p.stdin.end(JSON.stringify(req));
    });
}

/** Where OpenSCAD usually is, in order. */
export function openscadCandidates(env = process.env, platform = process.platform): string[] {
  const out: string[] = [];
  if (env.ZINARIX_OPENSCAD) out.push(env.ZINARIX_OPENSCAD);
  const names = platform === 'win32' ? ['openscad.exe', 'openscad.com'] : ['openscad'];
  for (const d of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) for (const n of names) out.push(join(d, n));
  if (platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')])
      if (base) for (const d of ['OpenSCAD', 'OpenSCAD (Nightly)']) out.push(join(base, d, 'openscad.exe'));
    out.push(join(homedir(), 'scoop', 'apps', 'openscad', 'current', 'openscad.exe'));
  } else if (platform === 'darwin') {
    out.push('/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD', join(homedir(), 'Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'));
  } else out.push('/usr/bin/openscad', '/usr/local/bin/openscad', '/snap/bin/openscad');
  return [...new Set(out)];
}

/** Fonts for text() in the built-in engine (the installed one finds them by itself). */
export function fontFiles(platform = process.platform): string[] {
  const c =
    platform === 'win32'
      ? ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'segoeui.ttf', 'segoeuib.ttf', 'times.ttf', 'cour.ttf'].map((f) =>
          join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', f),
        )
      : platform === 'darwin'
        ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc']
        : [
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
            '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/TTF/DejaVuSans.ttf',
          ];
  return c.filter((f) => existsSync(f));
}

function runText(exe: string, args: string[], ms = 20_000): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(exe, args, { windowsHide: true, env: taskEnv(process.env) });
    let t = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), ms);
    p.stdout.on('data', (d: Buffer) => (t += d.toString()));
    p.stderr.on('data', (d: Buffer) => (t += d.toString()));
    p.on('error', (e) => (clearTimeout(timer), rej(e)));
    p.on('close', () => (clearTimeout(timer), res(t)));
  });
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const inside = (root: string, p: string) => {
  const r = relative(root, p);
  return !!r && !r.startsWith('..') && !isAbsolute(r);
};

const FLAG: Record<CadFormat, string> = { stl: 'binstl', '3mf': '3mf', obj: 'obj', off: 'off', amf: 'amf' };

export class CadService {
  private native: NativeScad | null | undefined;

  constructor(
    private readonly pickedFile: string,
    private readonly builtin: BuiltinRunner | null,
  ) {}

  private picked(): string | null {
    try {
      const j = JSON.parse(readFileSync(this.pickedFile, 'utf8')) as { path?: unknown };
      return typeof j.path === 'string' ? j.path : null;
    } catch {
      return null;
    }
  }

  private async probe(path: string): Promise<NativeScad | null> {
    if (!isAbsolute(path) || !isFile(path)) return null;
    try {
      const v = /OpenSCAD version\s+([\w.\-]+)/i.exec(await runText(path, ['--version']));
      if (!v) return null;
      const help = await runText(path, ['--help']).catch(() => '');
      return { path, version: v[1]!, manifold: /--backend/.test(help) };
    } catch {
      return null;
    }
  }

  async engines(refresh = false): Promise<CadEngines> {
    if (this.native === undefined || refresh) {
      this.native = null;
      const p = this.picked();
      for (const c of [...(p ? [p] : []), ...openscadCandidates()]) {
        const n = await this.probe(c);
        if (n) {
          this.native = n;
          break;
        }
      }
    }
    return { native: this.native, builtin: !!this.builtin };
  }

  /** The user chose this OpenSCAD in the panel. null = it is not OpenSCAD. */
  async useNative(path: string): Promise<NativeScad | null> {
    const n = await this.probe(path);
    if (!n) return null;
    await mkdir(dirname(this.pickedFile), { recursive: true });
    await writeFile(this.pickedFile, JSON.stringify({ path }));
    this.native = n;
    return n;
  }

  /** The model plus every file it includes, uses or imports, relative to `root`. */
  private async collect(root: string, mainRel: string, code: string): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>();
    files.set(mainRel, Buffer.from(code, 'utf8'));
    let bytes = code.length;
    const queue: [string, string][] = [[mainRel, code]];
    while (queue.length) {
      const [rel, src] = queue.shift()!;
      for (const dep of scadDependencies(src)) {
        if (isAbsolute(dep) || /^[a-z]:/i.test(dep))
          throw new Error(`"${dep}": usa rutas relativas a archivos dentro del proyecto.`);
        const abs = resolve(root, dirname(rel), dep);
        if (!inside(root, abs)) throw new Error(`"${dep}" está fuera del proyecto; solo se leen archivos dentro de él.`);
        const r = relative(root, abs).split(sep).join('/');
        // Missing ones may be libraries OpenSCAD has (MCAD); it reports what it cannot find.
        if (files.has(r) || !isFile(abs)) continue;
        const data = await readFile(abs);
        bytes += data.length;
        if (files.size >= MAX_FILES || bytes > MAX_BYTES) throw new Error('El modelo usa demasiados archivos (o muy grandes).');
        files.set(r, data);
        if (/\.scad$/i.test(r)) queue.push([r, data.toString('utf8')]);
      }
    }
    return files;
  }

  async render(input: CadRenderInput, signal: AbortSignal = new AbortController().signal): Promise<CadRenderResult> {
    const started = Date.now();
    const format = input.format ?? 'stl';
    const code = input.code ?? (input.file ? await readFile(input.file, 'utf8') : null);
    if (code === null) throw new Error('Falta el modelo (.scad).');
    if (code.length > 2_000_000) throw new Error('El archivo .scad es demasiado grande.');
    const params = parseScadParams(code);
    const defines = scadDefines(params, input.values ?? {});
    // Files are looked up from the project root (or the model's folder when it is outside).
    const root = input.file
      ? input.root && inside(input.root, input.file)
        ? input.root
        : dirname(input.file)
      : (input.root ?? tmpdir());
    const mainRel = input.file ? relative(root, input.file).split(sep).join('/') : 'modelo.scad';
    const files = await this.collect(root, mainRel, code);
    const { native } = await this.engines();
    const useNative = input.engine === 'native' ? true : input.engine === 'builtin' ? false : !!native;
    if (useNative && !native) throw new Error('OpenSCAD no está instalado.');
    if (!useNative && !this.builtin) throw new Error('El OpenSCAD incluido no está disponible.');
    const timeoutMs = input.timeoutMs ?? 180_000;
    const toReal = (s: string, prefix: string) =>
      s.split(prefix).join(root.endsWith(sep) ? root : root + sep).replace(/\/work\//g, '');
    if (useNative) {
      const work = await mkdtemp(join(tmpdir(), 'zinarix-scad-'));
      try {
        for (const [rel, data] of files) {
          const p = join(work, ...rel.split('/'));
          await mkdir(dirname(p), { recursive: true });
          await writeFile(p, data);
        }
        const mainTmp = join(work, ...mainRel.split('/'));
        const out = join(work, `.zinarix-out.${format}`);
        const args = [mainTmp, '-o', out, '--export-format', FLAG[format], ...(native!.manifold ? ['--backend=manifold'] : []), ...defines];
        const raw = await new Promise<string>((res, rej) => {
          const p = spawn(native!.path, args, { windowsHide: true, cwd: dirname(mainTmp), env: taskEnv(process.env) });
          let t = '';
          const kill = () => p.kill('SIGKILL');
          const timer = setTimeout(kill, timeoutMs);
          signal.addEventListener('abort', kill, { once: true });
          p.stdout.on('data', (d: Buffer) => (t = (t + d.toString()).slice(-60_000)));
          p.stderr.on('data', (d: Buffer) => (t = (t + d.toString()).slice(-60_000)));
          p.on('error', (e) => (clearTimeout(timer), rej(e)));
          p.on('close', (c) => {
            clearTimeout(timer);
            signal.removeEventListener('abort', kill);
            if (signal.aborted) rej(new Error('Cancelado.'));
            else if (c === null) rej(new Error(`OpenSCAD tardó más de ${Math.round(timeoutMs / 1000)} s y se detuvo.`));
            else res(t);
          });
        });
        const text = toReal(raw, work + sep);
        const data = existsSync(out) ? await readFile(out) : null;
        return this.finish(data, format, text, 'native', started, params);
      } finally {
        await rm(work, { recursive: true, force: true }).catch(() => {});
      }
    }
    const req: WasmRequest = {
      files: Object.fromEntries([...files].map(([k, v]) => [k, v.toString('base64')])),
      main: mainRel,
      args: defines,
      out: `out.${format === 'stl' ? 'stl' : format}`,
      fonts: fontFiles(),
    };
    // binstl in the built-in one too: smaller and what slicers like.
    if (format === 'stl') req.args = [...req.args, '--export-format', 'binstl'];
    // Its build has Manifold (much faster booleans than CGAL).
    req.args = [...req.args, '--backend=manifold'];
    const r = await this.builtin!(req, signal, timeoutMs);
    const text = toReal(r.log, '/work/');
    return this.finish(r.output !== undefined ? Buffer.from(r.output, 'base64') : null, format, text, 'builtin', started, params);
  }

  private finish(
    data: Buffer | null,
    format: CadFormat,
    raw: string,
    engine: 'native' | 'builtin',
    started: number,
    params: ScadParam[],
  ): CadRenderResult {
    const log = parseScadLog(raw);
    if (!data || !data.length) {
      const errs = log.messages.filter((m) => m.severity === 'error');
      const why =
        errs.map((e) => `${e.message}${e.line ? ` (línea ${e.line})` : ''}`).join('\n') ||
        (log.dimension === 'empty' ? 'El modelo está vacío: no dibuja nada.' : log.dimension === '2d' ? 'El modelo es 2D: usa linear_extrude() para darle grosor.' : raw.trim().split(/\r?\n/).slice(-3).join('\n'));
      const e = new Error(why || 'OpenSCAD no generó el modelo.') as Error & { log?: ScadLog; raw?: string };
      e.log = log;
      e.raw = raw;
      throw e;
    }
    return { data, format, log, raw, engine, ms: Date.now() - started, params };
  }
}
