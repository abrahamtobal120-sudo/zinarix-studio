/**
 * Fase 14: turns 3D scenes into video files.
 * - Viewer renders: the renderer draws each frame with three.js and sends raw RGBA here; FFmpeg
 *   encodes them as they arrive (WebM VP9 with alpha, MP4 or PNG frames).
 * - Blender renders: writes the bridge script (scene3dBpy.ts), runs Blender without a window and
 *   encodes its PNG frames the same way.
 * - Agent scripts: a bpy script the user approved, run the same way.
 * No Electron imports (main.ts wires IPC), so the tests drive it with the real FFmpeg.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import {
  encodeArgs,
  frameCount,
  modelPaths,
  type Render3DFormat,
  type Scene3D,
} from '../shared/scene3d.js';
import { blenderProgress, FRAME_PATTERN, toBpy, type BlenderEngine } from '../shared/scene3dBpy.js';
import { taskEnv } from '../shared/sandbox.js';

export interface BlenderInfo {
  path: string;
  version: string;
}

/** Blender 3.6 LTS is the oldest the script supports. */
export const BLENDER_MIN: [number, number] = [3, 6];

export function parseBlenderVersion(out: string): string | null {
  const m = /Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
  return m ? `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}` : null;
}

export function versionOk(v: string): boolean {
  const [a = 0, b = 0] = v.split('.').map(Number);
  return a > BLENDER_MIN[0] || (a === BLENDER_MIN[0] && b >= BLENDER_MIN[1]);
}

/** Where Blender usually is (newest version first), plus ZINARIX_BLENDER and the PATH. */
export function blenderCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const out: string[] = [];
  if (env.ZINARIX_BLENDER) out.push(env.ZINARIX_BLENDER);
  const exe = platform === 'win32' ? 'blender.exe' : 'blender';
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter))
    if (dir) out.push(join(dir, exe));
  const byVersion = (root: string, sub: (d: string) => string) => {
    try {
      const dirs = readdirSync(root)
        .filter((d) => /^Blender\s*\d/i.test(d) || /^\d+\.\d+/.test(d))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const d of dirs) out.push(sub(join(root, d)));
    } catch {
      // not installed there
    }
  };
  if (platform === 'win32') {
    for (const pf of [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files']) {
      if (!pf) continue;
      byVersion(join(pf, 'Blender Foundation'), (d) => join(d, 'blender.exe'));
    }
    if (env.LOCALAPPDATA)
      byVersion(join(env.LOCALAPPDATA, 'Programs', 'Blender Foundation'), (d) =>
        join(d, 'blender.exe'),
      );
    out.push('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe');
  } else if (platform === 'darwin') {
    out.push('/Applications/Blender.app/Contents/MacOS/Blender');
    out.push(join(homedir(), 'Applications/Blender.app/Contents/MacOS/Blender'));
  } else {
    out.push('/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender');
  }
  return [...new Set(out)];
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

function runText(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, env: taskEnv(process.env) });
    let out = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d: Buffer) => (out = (out + d.toString()).slice(-8000)));
    p.stderr.on('data', (d: Buffer) => (out = (out + d.toString()).slice(-8000)));
    p.on('error', (e) => (clearTimeout(timer), reject(e)));
    p.on('close', () => (clearTimeout(timer), resolve(out)));
  });
}

export interface RenderResult {
  path: string;
  format: Render3DFormat;
  frames: number;
  ms: number;
}

interface Session {
  proc: ChildProcess;
  out: string;
  format: Render3DFormat;
  bytes: number;
  frames: number;
  started: number;
  err: string;
  done: Promise<number | null>;
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'escena-3d';

const stamp = () =>
  new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

export class Scene3DService {
  private sessions = new Map<string, Session>();
  private blender: BlenderInfo | null | undefined;
  private jobs = new Map<string, ChildProcess>();

  constructor(
    private readonly userData: string,
    private readonly ffmpeg: () => string | null,
  ) {}

  /** <project>/media/3d, or the app data folder when no folder is open. */
  outDir(workspaceRoot: string | undefined): string {
    const d = workspaceRoot
      ? join(workspaceRoot, 'media', '3d')
      : join(this.userData, '3d-renders');
    mkdirSync(d, { recursive: true });
    return d;
  }

  private target(workspaceRoot: string | undefined, name: string, format: Render3DFormat): string {
    const base = join(this.outDir(workspaceRoot), `${slug(name)}-${stamp()}`);
    if (format !== 'png') return `${base}.${format}`;
    mkdirSync(base, { recursive: true });
    return join(base, FRAME_PATTERN);
  }

  private need(): string {
    const f = this.ffmpeg();
    if (!f) throw new Error('FFmpeg no está disponible en este equipo.');
    return f;
  }

  private spawnEncoder(
    args: string[],
    stdin: boolean,
  ): Pick<Session, 'proc' | 'done'> & { err: () => string } {
    const proc = spawn(this.need(), args, {
      windowsHide: true,
      stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    });
    let err = '';
    proc.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
    const done = new Promise<number | null>((resolve) => {
      proc.on('error', (e) => ((err += `\n${e.message}`), resolve(-1)));
      proc.on('close', (code) => resolve(code));
    });
    return { proc, done, err: () => err };
  }

  // ---------------- Viewer frames ----------------

  begin(
    o: { width: number; height: number; fps: number; format: Render3DFormat; name: string },
    workspaceRoot: string | undefined,
  ): { id: string; path: string } {
    if (this.sessions.size >= 2) throw new Error('Ya hay renders 3D en curso.');
    const out = this.target(workspaceRoot, o.name, o.format);
    const enc = this.spawnEncoder(
      encodeArgs({ width: o.width, height: o.height, fps: o.fps, format: o.format, out }),
      true,
    );
    const id = randomUUID();
    const s: Session = {
      proc: enc.proc,
      out,
      format: o.format,
      bytes: o.width * o.height * 4,
      frames: 0,
      started: Date.now(),
      err: '',
      done: enc.done,
    };
    enc.proc.stderr?.on('data', () => (s.err = enc.err()));
    this.sessions.set(id, s);
    return { id, path: out };
  }

  /** One RGBA frame (straight alpha, top row first). Waits while FFmpeg catches up. */
  async frame(id: string, data: Uint8Array): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new Error('El render terminó o se canceló.');
    if (data.byteLength !== s.bytes) throw new Error('Tamaño de cuadro incorrecto.');
    const stdin = s.proc.stdin;
    if (!stdin || stdin.destroyed) throw new Error(`FFmpeg se detuvo: ${s.err.trim().slice(-300)}`);
    s.frames++;
    if (!stdin.write(data))
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => (stdin.off('error', onErr), resolve());
        const onErr = (e: Error) => (stdin.off('drain', onDrain), reject(e));
        stdin.once('drain', onDrain);
        stdin.once('error', onErr);
      });
  }

  async end(id: string): Promise<RenderResult> {
    const s = this.sessions.get(id);
    if (!s) throw new Error('El render terminó o se canceló.');
    s.proc.stdin?.end();
    const code = await s.done;
    this.sessions.delete(id);
    if (code !== 0)
      throw new Error(`FFmpeg falló: ${s.err.trim().slice(-300) || `código ${code}`}`);
    return { path: s.out, format: s.format, frames: s.frames, ms: Date.now() - s.started };
  }

  async cancel(id: string): Promise<void> {
    const s = this.sessions.get(id);
    const job = this.jobs.get(id);
    if (job) job.kill('SIGKILL');
    if (!s) return;
    this.sessions.delete(id);
    s.proc.kill('SIGKILL');
    await s.done;
    await rm(s.format === 'png' ? join(s.out, '..') : s.out, { recursive: true, force: true });
  }

  // ---------------- Blender ----------------

  /** The newest Blender found that the bridge supports (cached; `refresh` looks again). */
  /** Where the blender.exe the user picked by hand is remembered (portable builds, odd folders). */
  private get pickedFile(): string {
    return join(this.userData, 'blender-path.json');
  }

  private picked(): string | null {
    try {
      const p = (JSON.parse(readFileSync(this.pickedFile, 'utf8')) as { path?: unknown }).path;
      return typeof p === 'string' && isAbsolute(p) ? p : null;
    } catch {
      return null;
    }
  }

  /**
   * Uses this executable from now on, when it is Blender 3.6 or newer. Returns what it found
   * (null leaves the previous choice as it was).
   */
  async useBlender(path: string): Promise<BlenderInfo | null> {
    if (!isAbsolute(path) || !isFile(path)) return null;
    let v: string | null = null;
    try {
      v = parseBlenderVersion(await runText(path, ['--version'], 30_000));
    } catch {
      return null;
    }
    if (!v || !versionOk(v)) return null;
    await writeFile(this.pickedFile, JSON.stringify({ path }));
    this.blender = { path, version: v };
    return this.blender;
  }

  async findBlender(refresh = false): Promise<BlenderInfo | null> {
    if (this.blender !== undefined && !refresh) return this.blender;
    this.blender = null;
    const picked = this.picked();
    for (const c of [...(picked ? [picked] : []), ...blenderCandidates()]) {
      if (!isAbsolute(c) || !isFile(c)) continue;
      try {
        const v = parseBlenderVersion(await runText(c, ['--version'], 30_000));
        if (v && versionOk(v)) {
          this.blender = { path: c, version: v };
          break;
        }
      } catch {
        // not runnable: try the next one
      }
    }
    return this.blender;
  }

  private async runBlender(
    id: string,
    script: string,
    framesDir: string,
    frames: number,
    onProgress: (k: number) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const b = await this.findBlender();
    if (!b) throw new Error('No se encontró Blender 3.6 o más nuevo en este equipo.');
    const file = join(framesDir, '..', 'zinarix-scene.py');
    await writeFile(file, script, 'utf8');
    return new Promise((resolve, reject) => {
      const p = spawn(
        b.path,
        ['-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', file],
        { windowsHide: true, env: taskEnv(process.env), cwd: join(framesDir, '..') },
      );
      this.jobs.set(id, p);
      let log = '';
      const onAbort = () => p.kill('SIGKILL');
      signal?.addEventListener('abort', onAbort, { once: true });
      // Half an hour covers a long Cycles render; the user can cancel sooner.
      const timer = setTimeout(() => p.kill('SIGKILL'), 30 * 60_000);
      const read = (d: Buffer) => {
        const text = d.toString();
        log = (log + text).slice(-12_000);
        for (const line of text.split(/\r?\n/)) {
          const k = blenderProgress(line, frames);
          if (k !== null) onProgress(k * 0.9);
        }
      };
      p.stdout.on('data', read);
      p.stderr.on('data', read);
      p.on('error', (e) => (clearTimeout(timer), reject(e)));
      p.on('close', (code) => {
        clearTimeout(timer);
        this.jobs.delete(id);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) reject(new Error('Render cancelado.'));
        else if (code === 0) resolve(log);
        else {
          const lines = log
            .trim()
            .split(/\r?\n/)
            .filter((l) => /error|Traceback|Exception/i.test(l));
          reject(
            new Error(
              `Blender falló (código ${code}): ${(lines.slice(-4).join('\n') || log.slice(-500)).trim()}`,
            ),
          );
        }
      });
    });
  }

  private async encodeFrames(
    framesDir: string,
    o: { width: number; height: number; fps: number; format: Render3DFormat },
    out: string,
  ): Promise<number> {
    const files = (await readdir(framesDir)).filter((f) => /^f_\d{4,}\.png$/.test(f)).sort();
    if (!files.length) throw new Error('Blender no produjo ningún cuadro.');
    const first = Number(/\d+/.exec(files[0]!)![0]);
    const enc = this.spawnEncoder(
      encodeArgs({ ...o, out, pngInput: join(framesDir, FRAME_PATTERN), startNumber: first }),
      false,
    );
    const code = await enc.done;
    if (code !== 0) throw new Error(`FFmpeg falló: ${enc.err().trim().slice(-300)}`);
    return files.length;
  }

  /** Renders a scene with Blender (EEVEE or Cycles) into the project's media/3d. */
  async renderWithBlender(
    scene: Scene3D,
    o: { engine: BlenderEngine; format: Render3DFormat; name: string; samples?: number },
    workspaceRoot: string | undefined,
    onProgress: (k: number) => void = () => {},
    signal?: AbortSignal,
    id: string = randomUUID(),
  ): Promise<RenderResult> {
    for (const m of modelPaths(scene))
      if (!existsSync(m)) throw new Error(`No se encuentra el modelo ${m}.`);
    const started = Date.now();
    const work = await mkdtemp(join(tmpdir(), 'zinarix-3d-'));
    try {
      const framesDir = join(work, 'frames');
      mkdirSync(framesDir, { recursive: true });
      const frames = frameCount(scene);
      const script = toBpy(scene, { framesDir, engine: o.engine, samples: o.samples });
      await this.runBlender(id, script, framesDir, frames, onProgress, signal);
      const out = this.target(workspaceRoot, o.name, o.format);
      const n = await this.encodeFrames(framesDir, { ...scene, format: o.format }, out);
      onProgress(1);
      return { path: out, format: o.format, frames: n, ms: Date.now() - started };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /**
   * Runs a bpy script the user approved (from the agent). It renders to `ZINARIX_OUT` (a folder
   * it receives in the environment); PNG frames there become a video, any other files are
   * copied to media/3d as they are.
   */
  async runScript(
    script: string,
    o: { fps: number; format: Render3DFormat; name: string },
    workspaceRoot: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ paths: string[]; log: string }> {
    const b = await this.findBlender();
    if (!b) throw new Error('No se encontró Blender 3.6 o más nuevo en este equipo.');
    const work = await mkdtemp(join(tmpdir(), 'zinarix-bpy-'));
    try {
      const outDir = join(work, 'out');
      mkdirSync(outDir, { recursive: true });
      const file = join(work, 'script.py');
      await writeFile(file, script, 'utf8');
      const log = await new Promise<string>((resolve, reject) => {
        const p = spawn(
          b.path,
          ['-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', file],
          {
            windowsHide: true,
            cwd: work,
            env: taskEnv(process.env, { ZINARIX_OUT: outDir }),
          },
        );
        let text = '';
        const onAbort = () => p.kill('SIGKILL');
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => p.kill('SIGKILL'), 30 * 60_000);
        p.stdout.on('data', (d: Buffer) => (text = (text + d.toString()).slice(-12_000)));
        p.stderr.on('data', (d: Buffer) => (text = (text + d.toString()).slice(-12_000)));
        p.on('error', (e) => (clearTimeout(timer), reject(e)));
        p.on('close', (code) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (code === 0) resolve(text);
          else reject(new Error(`Blender falló (código ${code}):\n${text.slice(-1500)}`));
        });
      });
      const files = await readdir(outDir);
      const pngs = files.filter((f) => /^f_\d{4,}\.png$/.test(f));
      const paths: string[] = [];
      if (pngs.length > 1) {
        const out = this.target(workspaceRoot, o.name, o.format);
        // Size comes from the frames themselves (FFmpeg reads it from the PNGs).
        await this.encodeFrames(outDir, { width: 0, height: 0, fps: o.fps, format: o.format }, out);
        paths.push(out);
      }
      const { copyFile } = await import('node:fs/promises');
      for (const f of files) {
        if (pngs.length > 1 && pngs.includes(f)) continue;
        if (
          !/^[\w.-]+$/.test(f) ||
          ![
            '.png',
            '.jpg',
            '.exr',
            '.glb',
            '.gltf',
            '.obj',
            '.fbx',
            '.mp4',
            '.webm',
            '.blend',
          ].includes(extname(f).toLowerCase())
        )
          continue;
        const dest = join(this.outDir(workspaceRoot), `${stamp()}-${f}`);
        await copyFile(join(outDir, f), dest);
        paths.push(dest);
      }
      return { paths, log: log.slice(-3000) };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  cancelJob(id: string): void {
    this.jobs.get(id)?.kill('SIGKILL');
  }
}
