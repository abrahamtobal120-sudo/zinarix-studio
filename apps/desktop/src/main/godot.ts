import { fileURLToPath } from 'node:url';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { childEnv } from './env.js';
import {
  cleanGodotOutput,
  gameTemplateFiles,
  parseExportPresets,
  parseGodotOutput,
  parseGodotVersion,
  parseProjectGodot,
  parseUnityVersion,
  parseUproject,
  pngSize,
  validNewFolder,
  validPresetName,
  validProjectDir,
  validScene,
  type GameTemplate,
  type GamesScan,
  type GodotProblem,
  type GodotProject,
  type GodotStatus,
  type OtherEngineProject,
  type WebGameProject,
} from '../shared/games.js';
import {
  hasPlaytest,
  overrideWithPlaytest,
  parsePlaytestOutput,
  PLAYTEST_GD,
  stripPlaytest,
  type PlayOutput,
  type PlayPlan,
} from '../shared/godotPlaytest.js';

export type { GamesScan, GodotProject, GodotStatus, WebGameProject };

/**
 * Fase 6 (plan de funciones): video games. Godot is driven through its command line (the same
 * binary the user downloads): open the editor, run the game or one scene with the output
 * streamed, render frames with the movie writer so the AI can see the game, check scripts,
 * export, and a headless editor that serves the GDScript language server. Unity and Unreal
 * projects are detected and opened in their editors. Never a shell; arguments are checked.
 */

export interface GodotRunResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  problems: (GodotProblem & { count: number })[];
  seconds: number;
  /** Stopped by the time limit (normal for a game). */
  timedOut: boolean;
}

export interface GodotFrame {
  png: Buffer;
  width: number;
  height: number;
  /** Second of the game the frame shows. */
  at: number;
}

const OUT_KEEP = 512 * 1024;

/**
 * Godot's GDScript language server runs inside a (headless) Godot editor and speaks TCP: this
 * tiny bridge, run as Node (Electron with ELECTRON_RUN_AS_NODE), joins the LSP client's
 * stdio to that port. Argument: the port.
 */
export const LSP_TCP_BRIDGE =
  "const s=require('net').connect(+process.argv[1],'127.0.0.1');process.stdin.pipe(s);s.pipe(process.stdout);" +
  "s.on('error',e=>{process.stderr.write(String(e));process.exit(1)});s.on('close',()=>process.exit(0));process.stdin.on('end',()=>s.end());";
const SKIP_DIRS = new Set([
  '.godot',
  '.import',
  'node_modules',
  '.git',
  'Library',
  'Temp',
  'Intermediate',
  'Saved',
  'DerivedDataCache',
  'Binaries',
  'build',
  'dist',
]);

function exec(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((ok, fail) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, env: childEnv(process.env), maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) fail(err);
        else ok(`${stdout}${stderr}`);
      },
    );
  });
}

/** A free TCP port on 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      s.close(() => ok(port));
    });
  });
}

function onPath(names: string[]): string | null {
  const dirs = (process.env.PATH ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of dirs)
    for (const n of names)
      for (const e of exts) {
        const p = join(d, n + e);
        try {
          if (statSync(p).isFile()) return p;
        } catch {
          /* next */
        }
      }
  return null;
}

/** Godot executables in a folder (and one level of subfolders): Godot_v4.x…exe, godot… */
function godotIn(dir: string, depth = 1): string[] {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const win = process.platform === 'win32';
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isFile()) {
      if (
        win
          ? /^godot.*\.exe$/i.test(e.name) && !/_console\.exe$/i.test(e.name)
          : /^godot[\w.-]*$/i.test(e.name) && !/\.(zip|txt|tpz)$/i.test(e.name)
      )
        out.push(full);
    } else if (e.isDirectory() && depth > 0 && /godot/i.test(e.name)) {
      if (process.platform === 'darwin' && e.name.endsWith('.app')) {
        const mac = join(full, 'Contents', 'MacOS', 'Godot');
        if (existsSync(mac)) out.push(mac);
      } else out.push(...godotIn(full, depth - 1));
    }
  }
  // Newest version first (Godot_v4.7… before Godot_v4.2…), Godot 4 before 3.
  return out.sort((a, b) => basename(b).localeCompare(basename(a), undefined, { numeric: true }));
}

export class GodotService {
  private found: GodotStatus | undefined;
  private custom: string | null = null;
  private runs = new Map<string, ChildProcess>();
  private lsps = new Map<string, { proc: ChildProcess; port: number; ready: Promise<number> }>();

  constructor(
    private readonly home = homedir(),
    /** JSON file where the chosen executable is remembered. */
    private readonly configFile?: string,
  ) {}

  private async loadConfig(): Promise<void> {
    if (!this.configFile || this.custom !== null) return;
    try {
      const j = JSON.parse(await readFile(this.configFile, 'utf8')) as { exe?: string };
      this.custom = typeof j.exe === 'string' ? j.exe : '';
    } catch {
      this.custom = '';
    }
  }

  /** The user picked the executable (null forgets it). Returns the new status. */
  async setExecutable(exe: string | null): Promise<GodotStatus> {
    if (exe) {
      const v = parseGodotVersion(await exec(exe, ['--version'], 30_000).catch(() => ''));
      if (!v) throw new Error('Ese archivo no parece Godot (no respondió a --version).');
    }
    this.custom = exe ?? '';
    if (this.configFile) {
      await mkdir(dirname(this.configFile), { recursive: true });
      await writeFile(this.configFile, JSON.stringify({ exe: this.custom }), 'utf8');
    }
    return this.status(true);
  }

  private candidates(): { exe: string; source: GodotStatus['source'] }[] {
    const out: { exe: string; source: GodotStatus['source'] }[] = [];
    if (this.custom) out.push({ exe: this.custom, source: 'custom' });
    const env = process.env.ZINARIX_GODOT;
    if (env) out.push({ exe: env, source: 'env' });
    const p = onPath(['godot4', 'godot', 'Godot']);
    if (p) out.push({ exe: p, source: 'path' });
    const h = this.home;
    const scan: string[] = [];
    if (process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA ?? join(h, 'AppData', 'Local');
      const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
        Boolean,
      ) as string[];
      for (const link of [
        join(local, 'Microsoft', 'WinGet', 'Links', 'godot.exe'),
        join(h, 'scoop', 'shims', 'godot.exe'),
      ])
        if (existsSync(link)) out.push({ exe: link, source: 'scan' });
      scan.push(
        join(local, 'Programs'),
        join(local, 'Godot'),
        ...pf,
        ...pf.map((x) => join(x, 'Godot')),
      );
      for (const s of pf) {
        const steam = join(s, 'Steam', 'steamapps', 'common', 'Godot Engine');
        if (existsSync(steam)) scan.push(steam);
      }
      scan.push(join(local, 'Microsoft', 'WinGet', 'Packages'));
    } else if (process.platform === 'darwin') {
      for (const app of [
        '/Applications/Godot.app',
        '/Applications/Godot_mono.app',
        join(h, 'Applications', 'Godot.app'),
      ]) {
        const exe = join(app, 'Contents', 'MacOS', 'Godot');
        if (existsSync(exe)) out.push({ exe, source: 'scan' });
      }
    } else {
      for (const exe of [
        join(h, '.local', 'bin', 'godot'),
        '/usr/local/bin/godot',
        '/var/lib/flatpak/exports/bin/org.godotengine.Godot',
      ])
        if (existsSync(exe)) out.push({ exe, source: 'scan' });
      scan.push(join(h, '.local', 'share'), '/opt');
    }
    scan.push(join(h, 'Downloads'), join(h, 'Desktop'), join(h, 'Godot'), join(h, 'Applications'));
    for (const d of scan)
      for (const exe of godotIn(d, d.endsWith('Packages') ? 2 : 1))
        out.push({ exe, source: 'scan' });
    return out;
  }

  async status(force = false): Promise<GodotStatus> {
    await this.loadConfig();
    if (force) this.found = undefined;
    if (this.found) return this.found;
    const seen = new Set<string>();
    for (const c of this.candidates()) {
      if (seen.has(c.exe.toLowerCase())) continue;
      seen.add(c.exe.toLowerCase());
      const out = await exec(c.exe, ['--version'], 30_000).catch(() => '');
      const v = parseGodotVersion(out);
      // Godot 3 has a different command line and project format: keep looking for a 4.
      if (v && v.major >= 4) {
        this.found = {
          state: 'ready',
          exe: c.exe,
          version: v.text,
          mono: v.mono,
          source: c.source,
        };
        return this.found;
      }
    }
    this.found = { state: 'missing' };
    return this.found;
  }

  private async exe(): Promise<string> {
    const st = await this.status();
    if (st.state !== 'ready' || !st.exe)
      throw new Error(
        'Godot 4 no está instalado o no lo encontré. Descárgalo de godotengine.org y elígelo en Más → Juegos.',
      );
    return st.exe;
  }

  // ───────────── projects ─────────────

  /** Godot, Unity, Unreal and web game projects of the open folder (three levels down). */
  async scan(root: string): Promise<GamesScan> {
    const res: GamesScan = { godot: [], others: [], web: [] };
    const look = async (dir: string, depth: number) => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
      const rel = relative(root, dir).replace(/\\/g, '/');
      if (files.has('project.godot')) {
        res.godot.push(await this.project(root, rel));
        return;
      }
      const uproject = [...files].find((f) => f.toLowerCase().endsWith('.uproject'));
      if (uproject) {
        const u = parseUproject(await readFile(join(dir, uproject), 'utf8').catch(() => ''));
        res.others.push({
          kind: 'unreal',
          dir: rel,
          name: uproject.replace(/\.uproject$/i, ''),
          version: u.engine,
          file: uproject,
        });
        return;
      }
      if (
        entries.some((e) => e.isDirectory() && e.name === 'ProjectSettings') &&
        entries.some((e) => e.isDirectory() && e.name === 'Assets')
      ) {
        const v = parseUnityVersion(
          await readFile(join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8').catch(
            () => '',
          ),
        );
        res.others.push({ kind: 'unity', dir: rel, name: basename(dir), version: v });
        return;
      }
      if (files.has('index.html')) {
        const lib = await webLib(dir, files);
        if (lib) res.web.push({ dir: rel, entry: rel ? `${rel}/index.html` : 'index.html', lib });
      }
      if (depth > 0)
        for (const e of entries)
          if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
            await look(join(dir, e.name), depth - 1);
    };
    await look(root, 3);
    return res;
  }

  async project(root: string, dir: string): Promise<GodotProject> {
    const abs = this.absDir(root, dir);
    const info = parseProjectGodot(await readFile(join(abs, 'project.godot'), 'utf8'));
    const scenes: string[] = [];
    let scripts = 0;
    const walk = async (d: string, depth: number) => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (depth > 0 && !e.name.startsWith('.') && e.name !== 'addons' && !SKIP_DIRS.has(e.name))
            await walk(join(d, e.name), depth - 1);
        } else if (/\.tscn$/i.test(e.name) && scenes.length < 500)
          scenes.push(relative(root, join(d, e.name)).replace(/\\/g, '/'));
        else if (/\.(gd|cs)$/i.test(e.name)) scripts++;
      }
    };
    await walk(abs, 6);
    const main = info.mainScene.startsWith('res://')
      ? (dir ? `${dir}/` : '') + info.mainScene.slice(6)
      : '';
    scenes.sort((a, b) => (a === main ? -1 : b === main ? 1 : a.localeCompare(b)));
    const presets = parseExportPresets(
      await readFile(join(abs, 'export_presets.cfg'), 'utf8').catch(() => ''),
    );
    return { dir, info, scenes, scripts, presets };
  }

  private absDir(root: string, dir: string): string {
    if (!validProjectDir(dir)) throw new Error('Carpeta de proyecto no válida.');
    const abs = dir ? join(root, dir) : root;
    if (!existsSync(join(abs, 'project.godot')))
      throw new Error('Esa carpeta no tiene project.godot.');
    return abs;
  }

  /** res:// path of a scene given as res:// or relative to the open folder. */
  private sceneArg(dir: string, scene: string | null | undefined): string[] {
    if (!scene) return [];
    if (!validScene(scene)) throw new Error('Escena no válida (un .tscn del proyecto).');
    if (scene.startsWith('res://')) return [scene];
    const rel = scene.replace(/\\/g, '/');
    if (dir && !rel.startsWith(`${dir}/`)) throw new Error('La escena no es de ese proyecto.');
    return [`res://${dir ? rel.slice(dir.length + 1) : rel}`];
  }

  // ───────────── editor / run ─────────────

  async openEditor(root: string, dir: string, file?: string): Promise<void> {
    const abs = this.absDir(root, dir);
    const args = ['--editor', '--path', abs];
    if (file && validScene(file)) args.push(...this.sceneArg(dir, file));
    const p = spawn(await this.exe(), args, {
      cwd: abs,
      detached: true,
      stdio: 'ignore',
      env: childEnv(process.env),
    });
    p.on('error', () => undefined);
    p.unref();
  }

  /** Runs the game (or one scene) in its window, streaming the console. */
  async startRun(
    key: string,
    root: string,
    dir: string,
    opts: { scene?: string | null; debugCollisions?: boolean; debugNavigation?: boolean },
    onData: (chunk: string) => void,
    onEnd: (code: number | null) => void,
  ): Promise<void> {
    this.stopRun(key);
    const abs = this.absDir(root, dir);
    await this.cleanStale(abs);
    const args = ['--path', abs, ...this.sceneArg(dir, opts.scene)];
    if (opts.debugCollisions) args.push('--debug-collisions');
    if (opts.debugNavigation) args.push('--debug-navigation');
    const p = spawn(await this.exe(), args, {
      cwd: abs,
      env: childEnv(process.env),
      windowsHide: false,
    });
    this.runs.set(key, p);
    p.stdout?.on('data', (d: Buffer) => onData(d.toString('utf8')));
    p.stderr?.on('data', (d: Buffer) => onData(d.toString('utf8')));
    p.on('error', (e) => onData(`\n${e.message}\n`));
    p.on('exit', (code) => {
      if (this.runs.get(key) === p) this.runs.delete(key);
      onEnd(code);
    });
  }

  stopRun(key: string): boolean {
    const p = this.runs.get(key);
    if (!p) return false;
    this.runs.delete(key);
    p.kill();
    return true;
  }

  /** Stops every run whose key starts with prefix (a window that closed). */
  stopRunsOf(prefix: string): void {
    for (const k of [...this.runs.keys()]) if (k.startsWith(prefix)) this.stopRun(k);
  }

  isRunning(key: string): boolean {
    return this.runs.has(key);
  }

  /**
   * Runs the game for a while and returns what it printed. headless (default) runs the logic
   * without a window at a fixed 60 fps (faster than real time); otherwise in its window.
   */
  async runFor(
    root: string,
    dir: string,
    opts: { scene?: string | null; seconds?: number; headless?: boolean },
    signal?: AbortSignal,
  ): Promise<GodotRunResult> {
    const abs = this.absDir(root, dir);
    await this.cleanStale(abs);
    const secs = Math.max(0.5, Math.min(120, opts.seconds ?? 5));
    const headless = opts.headless !== false;
    const args = [
      ...(headless ? ['--headless'] : []),
      '--path',
      abs,
      '--fixed-fps',
      '60',
      '--quit-after',
      String(Math.round(secs * 60)),
      ...this.sceneArg(dir, opts.scene),
    ];
    return this.capture(await this.exe(), args, abs, secs * 4 + 30, signal);
  }

  private capture(
    exe: string,
    args: string[],
    cwd: string,
    limitSecs: number,
    signal?: AbortSignal,
  ): Promise<GodotRunResult> {
    const t0 = Date.now();
    return new Promise((ok) => {
      const p = spawn(exe, args, { cwd, env: childEnv(process.env), windowsHide: true });
      let out = '';
      let timedOut = false;
      const push = (d: Buffer) => {
        out += d.toString('utf8');
        if (out.length > OUT_KEEP * 2) out = out.slice(-OUT_KEEP);
      };
      p.stdout?.on('data', push);
      p.stderr?.on('data', push);
      const timer = setTimeout(() => {
        timedOut = true;
        p.kill();
      }, limitSecs * 1000);
      const abort = () => p.kill();
      signal?.addEventListener('abort', abort, { once: true });
      let done = false;
      const end = (code: number | null, extra = '') => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const output = cleanGodotOutput(out + extra);
        const problems = parseGodotOutput(out);
        ok({
          ok: code === 0 && !problems.some((x) => x.severity === 'error'),
          exitCode: code,
          output,
          problems,
          seconds: Math.round((Date.now() - t0) / 100) / 10,
          timedOut,
        });
      };
      p.on('error', (e) => end(null, `\n${e.message}`));
      p.on('exit', (code) => end(code));
    });
  }

  /**
   * Renders the game with Godot's movie writer (needs a GPU, opens the game window briefly)
   * and returns the frames at the asked seconds (the last second by default).
   */
  async frames(
    root: string,
    dir: string,
    opts: { scene?: string | null; at?: number[] },
    signal?: AbortSignal,
  ): Promise<{ frames: GodotFrame[]; run: GodotRunResult }> {
    const abs = this.absDir(root, dir);
    const fps = 30;
    const at = (opts.at?.length ? opts.at : [2])
      .map((s) => Math.max(0, Math.min(30, s)))
      .slice(0, 6);
    const last = Math.max(...at);
    const tmp = await mkdtemp(join(tmpdir(), 'zx-godot-shot-'));
    try {
      const args = [
        '--path',
        abs,
        '--write-movie',
        join(tmp, 'f.png'),
        '--fixed-fps',
        String(fps),
        '--quit-after',
        String(Math.round(last * fps) + 1),
        ...this.sceneArg(dir, opts.scene),
      ];
      const run = await this.capture(await this.exe(), args, abs, last * 6 + 40, signal);
      const files = (await readdir(tmp)).filter((f) => /^f\d+\.png$/.test(f)).sort();
      const frames: GodotFrame[] = [];
      for (const s of at) {
        if (!files.length) break;
        const i = Math.min(files.length - 1, Math.round(s * fps));
        const png = await readFile(join(tmp, files[i]!));
        const size = pngSize(png);
        if (size) frames.push({ png, ...size, at: Math.round((i / fps) * 100) / 100 });
      }
      return { frames, run };
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private playing = new Set<string>();

  /** A play test that crashed (or Zinarix closed mid-run) can leave our autoload in override.cfg. */
  private async cleanStale(abs: string): Promise<void> {
    if (this.playing.has(abs)) return;
    const f = join(abs, 'override.cfg');
    const text = await readFile(f, 'utf8').catch(() => null);
    if (text === null || !hasPlaytest(text)) return;
    const rest = stripPlaytest(text);
    if (rest) await writeFile(f, rest, 'utf8');
    else await rm(f, { force: true });
  }

  /**
   * Plays the game following a plan (pressed actions / keys, clicks, probes, screenshots) through
   * a temporary autoload added with override.cfg, which is restored afterwards. Screenshots need
   * the game window; without them it runs headless (faster than real time).
   */
  async playtest(
    root: string,
    dir: string,
    opts: { scene?: string | null; plan: PlayPlan; headless?: boolean },
    signal?: AbortSignal,
  ): Promise<{ run: GodotRunResult; play: PlayOutput; frames: GodotFrame[] }> {
    const abs = this.absDir(root, dir);
    if (this.playing.has(abs))
      throw new Error('Ya hay una prueba automática en curso en ese proyecto.');
    const sceneArgs = this.sceneArg(dir, opts.scene);
    const exe = await this.exe();
    await this.cleanStale(abs);
    this.playing.add(abs);
    const tmp = await mkdtemp(join(tmpdir(), 'zx-godot-play-'));
    const cfg = join(abs, 'override.cfg');
    const before = await readFile(cfg, 'utf8').catch(() => null);
    try {
      const shots = join(tmp, 'shots');
      await mkdir(shots);
      const driver = join(tmp, 'zs_playtest.gd');
      await writeFile(driver, PLAYTEST_GD, 'utf8');
      const planFile = join(tmp, 'plan.json');
      await writeFile(
        planFile,
        JSON.stringify({ fps: 60, shots: shots.replace(/\\/g, '/'), events: opts.plan.events }),
        'utf8',
      );
      await writeFile(cfg, overrideWithPlaytest(before, driver), 'utf8');
      const headless = opts.headless !== false && opts.plan.shots === 0;
      const frames = Math.round((opts.plan.seconds + 2) * 60);
      const args = [
        ...(headless ? ['--headless'] : []),
        '--path',
        abs,
        '--fixed-fps',
        '60',
        '--quit-after',
        String(frames),
        ...sceneArgs,
        '--',
        `--zs-plan=${planFile.replace(/\\/g, '/')}`,
      ];
      const run = await this.capture(exe, args, abs, opts.plan.seconds * 6 + 40, signal);
      const play = parsePlaytestOutput(run.output);
      const out: GodotFrame[] = [];
      for (const s of play.shots) {
        if (!s.file) continue;
        const png = await readFile(s.file).catch(() => null);
        const size = png ? pngSize(png) : null;
        if (png && size) out.push({ png, ...size, at: s.t });
      }
      return { run: { ...run, output: play.output }, play, frames: out };
    } finally {
      // Put override.cfg back exactly as it was.
      if (before === null) await rm(cfg, { force: true }).catch(() => undefined);
      else await writeFile(cfg, before, 'utf8').catch(() => undefined);
      this.playing.delete(abs);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Parses scripts without running the game (--check-only). files: res:// or relative; default every .gd. */
  async check(
    root: string,
    dir: string,
    files?: string[],
    signal?: AbortSignal,
  ): Promise<{ checked: number; problems: (GodotProblem & { count: number })[] }> {
    const abs = this.absDir(root, dir);
    let list: string[];
    if (files?.length) {
      list = files.map((f) => {
        const r = f.replace(/\\/g, '/');
        if (r.startsWith('res://')) return r;
        if (dir && !r.startsWith(`${dir}/`)) throw new Error(`${f} no es de ese proyecto.`);
        return `res://${dir ? r.slice(dir.length + 1) : r}`;
      });
    } else {
      list = [];
      const walk = async (d: string, depth: number) => {
        for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
          if (e.isDirectory()) {
            if (
              depth > 0 &&
              !e.name.startsWith('.') &&
              e.name !== 'addons' &&
              !SKIP_DIRS.has(e.name)
            )
              await walk(join(d, e.name), depth - 1);
          } else if (e.name.endsWith('.gd'))
            list.push(`res://${relative(abs, join(d, e.name)).replace(/\\/g, '/')}`);
        }
      };
      await walk(abs, 8);
    }
    list = list
      .filter((f) => /^res:\/\/[^"]+\.gd$/.test(f) && !f.split('/').includes('..'))
      .slice(0, 200);
    const exe = await this.exe();
    const problems: (GodotProblem & { count: number })[] = [];
    let i = 0;
    const worker = async () => {
      while (i < list.length && !signal?.aborted) {
        const f = list[i++]!;
        const r = await this.capture(
          exe,
          ['--headless', '--path', abs, '--check-only', '--script', f],
          abs,
          60,
          signal,
        );
        for (const p of r.problems)
          if (
            !problems.some((x) => x.file === p.file && x.line === p.line && x.message === p.message)
          )
            problems.push(p);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { checked: list.length, problems };
  }

  /** godot --headless --export-release / --export-debug "<preset>" <path>. */
  async exportGame(
    root: string,
    dir: string,
    preset: string,
    debug: boolean,
    signal?: AbortSignal,
  ): Promise<GodotRunResult & { path: string }> {
    const abs = this.absDir(root, dir);
    if (!validPresetName(preset)) throw new Error('Nombre de preset no válido.');
    const p = (await this.project(root, dir)).presets.find((x) => x.name === preset);
    if (!p)
      throw new Error(
        `No hay un preset "${preset}" en export_presets.cfg. Créalo en Godot: Proyecto → Exportar.`,
      );
    const out = p.exportPath
      ? join(abs, p.exportPath)
      : join(abs, 'build', preset.replace(/[^\w.-]+/g, '_'));
    await mkdir(dirname(out), { recursive: true });
    const r = await this.capture(
      await this.exe(),
      ['--headless', '--path', abs, debug ? '--export-debug' : '--export-release', preset, out],
      abs,
      900,
      signal,
    );
    const missing = /export templates?.*(not found|missing)|No export template found/i.test(
      r.output,
    );
    return {
      ...r,
      ok: r.exitCode === 0 && existsSync(out) && !missing,
      output: missing
        ? `${r.output}\nFaltan las plantillas de exportación de Godot: en el editor, Editor → Administrar plantillas de exportación → Descargar.`
        : r.output,
      path: out,
    };
  }

  /** Creates a new project from a template in <root>/<folder>. Returns the files written. */
  async create(
    root: string,
    folder: string,
    template: GameTemplate,
    name: string,
  ): Promise<string[]> {
    if (!validNewFolder(folder)) throw new Error('Nombre de carpeta no válido.');
    const abs = join(root, folder);
    if (existsSync(abs) && (await readdir(abs)).length)
      throw new Error(`La carpeta "${folder}" ya existe y no está vacía.`);
    const files = gameTemplateFiles(template, name.trim().slice(0, 80) || folder);
    if (template === 'web-phaser') {
      const lib = await phaserBuild();
      if (lib) files['lib/phaser.min.js'] = lib;
      else
        files['index.html'] = files['index.html']!.replace(
          'lib/phaser.min.js',
          'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.min.js',
        );
    }
    if (template === 'web-three') {
      const lib = await threeModule();
      if (lib) files['lib/three.module.min.js'] = lib.module;
      if (lib?.core) files['lib/three.core.min.js'] = lib.core;
      if (!lib)
        files['index.html'] = files['index.html']!.replace(
          './lib/three.module.min.js',
          'https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.module.min.js',
        );
    }
    const written: string[] = [];
    for (const [rel, text] of Object.entries(files)) {
      const p = join(abs, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, text, 'utf8');
      written.push(`${folder}/${rel}`);
    }
    return written;
  }

  // ───────────── GDScript language server ─────────────

  /**
   * Port of the GDScript language server of the project at abs, starting a headless Godot
   * editor that serves it (one per project; stopped by dispose()).
   */
  async lspPort(abs: string): Promise<number> {
    const have = this.lsps.get(abs);
    if (have && have.proc.exitCode === null) return have.ready;
    const exe = await this.exe();
    const port = await freePort();
    const proc = spawn(exe, ['--editor', '--headless', '--path', abs, '--lsp-port', String(port)], {
      cwd: abs,
      env: childEnv(process.env),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    proc.on('error', () => undefined);
    const ready = (async () => {
      const until = Date.now() + 90_000;
      while (Date.now() < until) {
        if (proc.exitCode !== null)
          throw new Error('El editor de Godot se cerró al iniciar el servidor de GDScript.');
        if (await canConnect(port)) return port;
        await new Promise((r) => setTimeout(r, 400));
      }
      proc.kill();
      throw new Error('El servidor de GDScript de Godot no respondió.');
    })();
    this.lsps.set(abs, { proc, port, ready });
    proc.on('exit', () => {
      if (this.lsps.get(abs)?.proc === proc) this.lsps.delete(abs);
    });
    return ready;
  }

  /** The Godot project a file belongs to (nearest project.godot above it, inside root). */
  static projectOf(root: string, abs: string): string | null {
    let d = dirname(abs);
    for (let i = 0; i < 12; i++) {
      if (existsSync(join(d, 'project.godot'))) return d;
      if (d === root || !d.startsWith(root)) break;
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
    return existsSync(join(root, 'project.godot')) ? root : null;
  }

  // ───────────── Unity / Unreal ─────────────

  /** Unity editors installed by Unity Hub: version → Unity executable. */
  unityEditors(): Record<string, string> {
    const out: Record<string, string> = {};
    const bases =
      process.platform === 'win32'
        ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
            .filter(Boolean)
            .map((p) => join(p!, 'Unity', 'Hub', 'Editor'))
        : process.platform === 'darwin'
          ? ['/Applications/Unity/Hub/Editor']
          : [join(this.home, 'Unity', 'Hub', 'Editor')];
    for (const b of bases) {
      let vs: string[] = [];
      try {
        vs = readdirSync(b);
      } catch {
        continue;
      }
      for (const v of vs) {
        const exe =
          process.platform === 'win32'
            ? join(b, v, 'Editor', 'Unity.exe')
            : process.platform === 'darwin'
              ? join(b, v, 'Unity.app', 'Contents', 'MacOS', 'Unity')
              : join(b, v, 'Editor', 'Unity');
        if (existsSync(exe)) out[v] = exe;
      }
    }
    return out;
  }

  /** Opens a Unity project with its editor version (or the newest one installed). */
  openUnity(root: string, p: OtherEngineProject): string {
    if (!validProjectDir(p.dir)) throw new Error('Carpeta no válida.');
    const eds = this.unityEditors();
    const exe =
      eds[p.version] ??
      Object.entries(eds).sort((a, b) =>
        b[0].localeCompare(a[0], undefined, { numeric: true }),
      )[0]?.[1];
    if (!exe) throw new Error('No encontré Unity instalado con Unity Hub.');
    const c = spawn(exe, ['-projectPath', p.dir ? join(root, p.dir) : root], {
      detached: true,
      stdio: 'ignore',
    });
    c.on('error', () => undefined);
    c.unref();
    return exe;
  }

  dispose(): void {
    for (const p of this.runs.values()) p.kill();
    this.runs.clear();
    for (const l of this.lsps.values()) l.proc.kill();
    this.lsps.clear();
  }
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('error', () => ok(false));
  });
}

/** Which web game library a folder with index.html uses (null when it doesn't look like a game). */
async function webLib(dir: string, files: Set<string>): Promise<WebGameProject['lib'] | null> {
  let text = await readFile(join(dir, 'index.html'), 'utf8').catch(() => '');
  for (const f of ['game.js', 'main.js', 'src/main.js', 'src/game.js', 'main.ts', 'src/main.ts'])
    if (files.has(f.split('/')[0]!) || existsSync(join(dir, f)))
      text += await readFile(join(dir, f), 'utf8').catch(() => '');
  if (existsSync(join(dir, 'package.json')))
    text += await readFile(join(dir, 'package.json'), 'utf8').catch(() => '');
  if (/\bphaser\b/i.test(text)) return 'phaser';
  if (/\bpixi(\.js)?\b/i.test(text)) return 'pixi';
  if (/\bbabylon(js)?\b/i.test(text)) return 'babylon';
  if (/\bthree(\.module)?(\.min)?(\.js)?\b|from ['"]three['"]/i.test(text)) return 'three';
  if (/<canvas\b/i.test(text) && /requestAnimationFrame|getContext\(['"](2d|webgl)/.test(text))
    return 'canvas';
  return null;
}

/**
 * Phaser build shipped with Zinarix (dist/vendor, copied by build.mjs; in development, from
 * node_modules), so the template works offline; null when neither is there.
 */
async function phaserBuild(): Promise<string | null> {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [
    join(here, '..', 'vendor', 'phaser.min.js'),
    join(here, '..', '..', 'node_modules', 'phaser', 'dist', 'phaser.min.js'),
  ]) {
    const text = await readFile(p, 'utf8').catch(() => null);
    if (text) return text;
  }
  return null;
}

/** three.js build shipped with Zinarix (so the template works offline), or null. */
async function threeModule(): Promise<{ module: string; core: string | null } | null> {
  try {
    // three's exports map hides package.json: its main entry lives in build/.
    const build = dirname(createRequire(import.meta.url).resolve('three'));
    const module = await readFile(join(build, 'three.module.min.js'), 'utf8');
    // r16x+ splits the build: three.module imports ./three.core.min.js.
    const core = module.includes('three.core')
      ? await readFile(join(build, 'three.core.min.js'), 'utf8').catch(() => null)
      : null;
    return { module, core };
  } catch {
    return null;
  }
}
