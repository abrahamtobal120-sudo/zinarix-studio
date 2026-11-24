/**
 * SketchUp: finds the installed SketchUp, installs the Zinarix extension in its Plugins
 * folder, and drives it through a job folder (~/.zinarix-sketchup, see sketchupRuby.ts).
 * SketchUp has no headless mode, so the ops run in the user's open SketchUp; when it is not
 * open, Zinarix starts it (with the model) and waits for the extension to answer.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { taskEnv } from '../shared/sandbox.js';
import {
  sketchupYear,
  type SketchupJob,
  type SketchupResult,
  type SketchupStatusView,
} from '../shared/sketchup.js';
import {
  SKETCHUP_EXT_VERSION,
  SKETCHUP_LOADER_NAME,
  SKETCHUP_LOADER_RB,
  SKETCHUP_MAIN_DIR,
  SKETCHUP_MAIN_RB,
} from './sketchupRuby.js';

export interface SketchupInstall {
  /** SketchUp.exe, or the SketchUp.app bundle on macOS. */
  exe: string;
  year: number | null;
}

interface Alive {
  time: number;
  version: string;
  extension?: string;
  model: string;
  title: string;
}

const ALIVE_MS = 8_000;

/** Where Zinarix and the extension meet (ZINARIX_SKETCHUP_HOME overrides it, for tests). */
export function bridgeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZINARIX_SKETCHUP_HOME?.trim() || join(homedir(), '.zinarix-sketchup');
}

/** Every SketchUp under the usual install folders. */
export function findSketchups(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): SketchupInstall[] {
  const out: SketchupInstall[] = [];
  const add = (exe: string) => {
    if (existsSync(exe) && !out.some((x) => x.exe.toLowerCase() === exe.toLowerCase()))
      out.push({ exe, year: sketchupYear(exe) });
  };
  const list = (dir: string) => {
    try {
      return readdirSync(dir).filter((n) => /^SketchUp (20\d\d)$/i.test(n));
    } catch {
      return [];
    }
  };
  if (platform === 'win32') {
    const bases = [env.ProgramW6432, env.ProgramFiles, 'C:\\Program Files'].filter(
      (b): b is string => !!b,
    );
    for (const base of new Set(bases)) {
      const root = join(base, 'SketchUp');
      for (const n of list(root)) {
        add(join(root, n, 'SketchUp', 'SketchUp.exe'));
        add(join(root, n, 'SketchUp.exe'));
      }
    }
  } else if (platform === 'darwin') {
    for (const n of list('/Applications')) add(join('/Applications', n, 'SketchUp.app'));
  }
  return out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

/** SketchUp's Plugins folder for one version (where extensions go). */
export function pluginsDir(
  year: number,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  if (platform === 'darwin')
    return join(
      homedir(),
      'Library',
      'Application Support',
      `SketchUp ${year}`,
      'SketchUp',
      'Plugins',
    );
  const appData = env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'SketchUp', `SketchUp ${year}`, 'SketchUp', 'Plugins');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SketchupService {
  private picked: string | null = null;

  constructor(private readonly configPath: string) {
    try {
      const c = JSON.parse(readFileSync(configPath, 'utf8')) as { exe?: string };
      if (c.exe && existsSync(c.exe)) this.picked = c.exe;
    } catch {
      // no choice saved yet
    }
  }

  get home(): string {
    return bridgeDir();
  }

  installs(): SketchupInstall[] {
    const all = findSketchups();
    const extra = [process.env.ZINARIX_SKETCHUP?.trim(), this.picked].filter(
      (p): p is string => !!p && existsSync(p),
    );
    for (const exe of extra.reverse())
      if (!all.some((x) => x.exe === exe)) all.unshift({ exe, year: sketchupYear(exe) });
    return all;
  }

  /** The SketchUp Zinarix uses: ZINARIX_SKETCHUP, then the one the user picked, then the newest. */
  active(): SketchupInstall | null {
    const env = process.env.ZINARIX_SKETCHUP?.trim();
    const all = this.installs();
    return (
      all.find((x) => x.exe === env) ?? all.find((x) => x.exe === this.picked) ?? all[0] ?? null
    );
  }

  async pick(exe: string): Promise<boolean> {
    const p = process.platform === 'darwin' ? exe.replace(/(SketchUp\.app).*/i, '$1') : exe;
    if (!existsSync(p) || !/sketchup/i.test(p)) return false;
    this.picked = p;
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify({ exe: p }), 'utf8');
    return true;
  }

  private loaderPath(year: number | null): string | null {
    return year ? join(pluginsDir(year), SKETCHUP_LOADER_NAME) : null;
  }

  extension(install = this.active()): SketchupStatusView['extension'] {
    const path = this.loaderPath(install?.year ?? null);
    if (!path || !existsSync(path)) return { installed: false, outdated: false, path };
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      // unreadable: treat as outdated
    }
    const main = join(dirname(path), SKETCHUP_MAIN_DIR, 'main.rb');
    return {
      installed: true,
      outdated: !text.includes(`'${SKETCHUP_EXT_VERSION}'`) || !existsSync(main),
      path,
    };
  }

  /** Writes the extension into SketchUp's Plugins folder (SketchUp loads it the next time it starts). */
  async installExtension(year?: number): Promise<string> {
    const y = year ?? this.active()?.year ?? null;
    if (!y)
      throw new Error(
        'SketchUp is not installed (or its version is unknown). Pick SketchUp in the SketchUp panel first.',
      );
    const dir = pluginsDir(y);
    await mkdir(join(dir, SKETCHUP_MAIN_DIR), { recursive: true });
    await writeFile(join(dir, SKETCHUP_MAIN_DIR, 'main.rb'), SKETCHUP_MAIN_RB, 'utf8');
    await writeFile(join(dir, SKETCHUP_LOADER_NAME), SKETCHUP_LOADER_RB, 'utf8');
    await mkdir(join(this.home, 'jobs'), { recursive: true });
    await mkdir(join(this.home, 'results'), { recursive: true });
    return join(dir, SKETCHUP_LOADER_NAME);
  }

  /** SketchUp open with the extension, from its heartbeat file. */
  alive(): Alive | null {
    const f = join(this.home, 'alive.json');
    try {
      const st = statSync(f);
      const a = JSON.parse(readFileSync(f, 'utf8')) as Alive;
      const t = Math.max(Number(a.time) || 0, st.mtimeMs);
      return Date.now() - t < ALIVE_MS ? a : null;
    } catch {
      return null;
    }
  }

  status(): SketchupStatusView {
    const active = this.active();
    const a = this.alive();
    return {
      installs: this.installs(),
      active,
      extension: this.extension(active),
      connected: !!a,
      ...(a ? { running: { version: a.version, model: a.model, title: a.title } } : {}),
      bridgeDir: this.home,
    };
  }

  /** Starts SketchUp (optionally with a model). */
  launch(file?: string): void {
    const s = this.active();
    if (!s)
      throw new Error(
        'SketchUp is not installed. Install it from sketchup.com or pick SketchUp.exe in the SketchUp panel.',
      );
    const args = file && existsSync(file) ? [file] : [];
    const p =
      process.platform === 'darwin'
        ? spawn('open', ['-a', s.exe, ...args], { detached: true, stdio: 'ignore' })
        : spawn(s.exe, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
            env: taskEnv(process.env),
          });
    p.on('error', () => {});
    p.unref();
  }

  private async waitAlive(signal?: AbortSignal, ms = 120_000): Promise<Alive> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (signal?.aborted) throw new Error('Cancelado.');
      const a = this.alive();
      if (a) return a;
      await sleep(700);
    }
    throw new Error(
      'SketchUp did not answer. Is the Zinarix extension installed (SketchUp panel → Install extension) and enabled in Extension Manager?',
    );
  }

  /** Opens a model in SketchUp (in the running one when it is connected). */
  async open(file: string, signal?: AbortSignal): Promise<void> {
    if (this.alive()) {
      await this.run({ path: file, units: 'mm', ops: [], save: false }, { signal, launch: false });
      return;
    }
    this.launch(file);
  }

  /**
   * Sends a job to SketchUp and waits for the result. launch: start SketchUp when it is not
   * open (with the model when it exists) and wait for the extension.
   */
  async run(
    job: Omit<SketchupJob, 'id' | 'created'>,
    opts: { signal?: AbortSignal; launch?: boolean; timeoutMs?: number } = {},
  ): Promise<SketchupResult & { shot?: Buffer }> {
    if (!this.alive()) {
      if (opts.launch === false)
        throw new Error('SketchUp is not open with the Zinarix extension.');
      const ext = this.extension();
      if (!ext.installed)
        throw new Error(
          'The Zinarix extension is not installed in SketchUp. Use sketchup_install_extension (or the SketchUp panel) first.',
        );
      this.launch(job.path);
      await this.waitAlive(opts.signal);
    }
    const id = randomUUID();
    const jobs = join(this.home, 'jobs');
    const results = join(this.home, 'results');
    await mkdir(jobs, { recursive: true });
    await mkdir(results, { recursive: true });
    const shots = join(this.home, 'shots');
    if (job.shot) await mkdir(shots, { recursive: true });
    const full: SketchupJob = {
      ...job,
      id,
      created: Date.now(),
      ...(job.shot ? { shot: { ...job.shot, path: join(shots, `${id}.png`) } } : {}),
    };
    const jobFile = join(jobs, `${Date.now()}-${id}.json`);
    await writeFile(`${jobFile}.tmp`, JSON.stringify(full), 'utf8');
    await rename(`${jobFile}.tmp`, jobFile);
    const resFile = join(results, `${id}.json`);
    const end = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
    try {
      for (;;) {
        if (opts.signal?.aborted) throw new Error('Cancelado.');
        if (existsSync(resFile)) {
          const r = JSON.parse(await readFile(resFile, 'utf8')) as SketchupResult;
          const shotPath = full.shot?.path;
          const shot = shotPath && existsSync(shotPath) ? await readFile(shotPath) : undefined;
          if (shotPath) await rm(shotPath, { force: true }).catch(() => {});
          if (r.report?.shot) r.report.shot = undefined;
          return { ...r, ...(shot ? { shot } : {}) };
        }
        if (Date.now() > end)
          throw new Error('SketchUp did not finish in time (is a dialog open in SketchUp?).');
        if (existsSync(jobFile) && !this.alive())
          throw new Error('SketchUp closed or stopped answering before taking the job.');
        await sleep(250);
      }
    } finally {
      await rm(jobFile, { force: true }).catch(() => {});
      await rm(resFile, { force: true }).catch(() => {});
    }
  }
}
