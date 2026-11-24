/**
 * Fase 7 (mejora): slicing with PrusaSlicer / SuperSlicer through their command line, and
 * opening a model in a desktop slicer (Orca, Bambu Studio, Cura, PrusaSlicer). The slicer is a
 * separate program the user installs (AGPL): Zinarix only runs it.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { parseGcode, type GcodeStats } from '../shared/gcode.js';
import { slicerProblems, sliceIni, bedOf, type SliceSettings } from '../shared/slicer.js';
import { taskEnv } from '../shared/sandbox.js';

export interface SlicerInfo {
  path: string;
  name: string;
  version: string;
}

export interface DesktopSlicer {
  id: string;
  name: string;
  path: string;
}

export interface SliceInput {
  model: string;
  out: string;
  settings: SliceSettings;
  /** A PrusaSlicer config (.ini) to load first: the user's tuned printer. */
  profile?: string;
  timeoutMs?: number;
}

export interface SliceResult {
  out: string;
  stats: GcodeStats;
  warnings: string[];
  ms: number;
  slicer: string;
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Where the command-line slicers usually are, in order. */
export function slicerCandidates(env = process.env, platform = process.platform): string[] {
  const out: string[] = [];
  if (env.ZINARIX_PRUSASLICER) out.push(env.ZINARIX_PRUSASLICER);
  const names =
    platform === 'win32'
      ? ['prusa-slicer-console.exe', 'superslicer_console.exe']
      : ['prusa-slicer', 'PrusaSlicer', 'superslicer', 'SuperSlicer'];
  for (const d of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean))
    for (const n of names) out.push(join(d, n));
  if (platform === 'win32') {
    for (const base of [
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'),
    ]) {
      if (!base) continue;
      out.push(
        join(base, 'Prusa3D', 'PrusaSlicer', 'prusa-slicer-console.exe'),
        join(base, 'PrusaSlicer', 'prusa-slicer-console.exe'),
      );
      out.push(join(base, 'SuperSlicer', 'superslicer_console.exe'));
    }
    out.push(
      join(homedir(), 'scoop', 'apps', 'prusa-slicer', 'current', 'prusa-slicer-console.exe'),
    );
  } else if (platform === 'darwin') {
    out.push(
      '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
      '/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
    );
    out.push('/Applications/SuperSlicer.app/Contents/MacOS/SuperSlicer');
  } else out.push('/usr/bin/prusa-slicer', '/usr/local/bin/prusa-slicer', '/snap/bin/prusa-slicer');
  return [...new Set(out)];
}

/** Desktop slicers a model can be opened in (their own window). */
export function desktopSlicerCandidates(
  env = process.env,
  platform = process.platform,
): { id: string; name: string; path: string }[] {
  const out: { id: string; name: string; path: string }[] = [];
  if (platform === 'win32') {
    for (const base of [
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'),
    ]) {
      if (!base) continue;
      out.push({
        id: 'orca',
        name: 'OrcaSlicer',
        path: join(base, 'OrcaSlicer', 'orca-slicer.exe'),
      });
      out.push({
        id: 'bambu',
        name: 'Bambu Studio',
        path: join(base, 'Bambu Studio', 'bambu-studio.exe'),
      });
      out.push({
        id: 'prusa',
        name: 'PrusaSlicer',
        path: join(base, 'Prusa3D', 'PrusaSlicer', 'prusa-slicer.exe'),
      });
      out.push({
        id: 'cura',
        name: 'UltiMaker Cura',
        path: join(base, 'UltiMaker Cura', 'UltiMaker-Cura.exe'),
      });
    }
  } else if (platform === 'darwin') {
    out.push({ id: 'orca', name: 'OrcaSlicer', path: '/Applications/OrcaSlicer.app' });
    out.push({ id: 'bambu', name: 'Bambu Studio', path: '/Applications/BambuStudio.app' });
    out.push({ id: 'prusa', name: 'PrusaSlicer', path: '/Applications/PrusaSlicer.app' });
    out.push({ id: 'cura', name: 'UltiMaker Cura', path: '/Applications/UltiMaker Cura.app' });
  } else {
    out.push(
      { id: 'orca', name: 'OrcaSlicer', path: '/usr/bin/orca-slicer' },
      { id: 'prusa', name: 'PrusaSlicer', path: '/usr/bin/prusa-slicer' },
      { id: 'cura', name: 'UltiMaker Cura', path: '/usr/bin/cura' },
    );
  }
  return out;
}

function runText(
  exe: string,
  args: string[],
  ms: number,
  signal?: AbortSignal,
): Promise<{ text: string; code: number | null }> {
  return new Promise((res, rej) => {
    const p = spawn(exe, args, { windowsHide: true, env: taskEnv(process.env) });
    let t = '';
    const kill = () => p.kill('SIGKILL');
    const timer = setTimeout(kill, ms);
    signal?.addEventListener('abort', kill, { once: true });
    p.stdout.on('data', (d: Buffer) => (t = (t + d.toString()).slice(-80_000)));
    p.stderr.on('data', (d: Buffer) => (t = (t + d.toString()).slice(-80_000)));
    p.on('error', (e) => (clearTimeout(timer), rej(e)));
    p.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      res({ text: t, code });
    });
  });
}

interface Saved {
  exe?: string;
  profile?: string;
}

export class SlicerService {
  private found: SlicerInfo | null | undefined;

  constructor(private readonly configFile: string) {}

  private saved(): Saved {
    try {
      return JSON.parse(readFileSync(this.configFile, 'utf8')) as Saved;
    } catch {
      return {};
    }
  }

  private async save(s: Saved): Promise<void> {
    await mkdir(dirname(this.configFile), { recursive: true });
    await writeFile(this.configFile, JSON.stringify(s));
  }

  private async probe(path: string): Promise<SlicerInfo | null> {
    if (!isAbsolute(path) || !isFile(path)) return null;
    try {
      const { text } = await runText(path, ['--help'], 30_000);
      const m = /^(PrusaSlicer|SuperSlicer|Slic3r)[- ]([\w.+-]+)/im.exec(text);
      if (!m) return null;
      return { path, name: m[1]!, version: m[2]!.replace(/\+.*$/, '') };
    } catch {
      return null;
    }
  }

  async info(
    refresh = false,
  ): Promise<{ slicer: SlicerInfo | null; profile: string | null; desktop: DesktopSlicer[] }> {
    const s = this.saved();
    if (this.found === undefined || refresh) {
      this.found = null;
      for (const c of [...(s.exe ? [s.exe] : []), ...slicerCandidates()]) {
        const n = await this.probe(c);
        if (n) {
          this.found = n;
          break;
        }
      }
    }
    const desktop = desktopSlicerCandidates().filter((d) => existsSync(d.path));
    return {
      slicer: this.found,
      profile: s.profile && isFile(s.profile) ? s.profile : null,
      desktop,
    };
  }

  /** The user chose this program. null = it is not PrusaSlicer / SuperSlicer. */
  async use(path: string): Promise<SlicerInfo | null> {
    const n = await this.probe(path);
    if (!n) return null;
    await this.save({ ...this.saved(), exe: path });
    this.found = n;
    return n;
  }

  /** A PrusaSlicer config exported from its window (File > Export > Export Config). */
  async setProfile(path: string | null): Promise<void> {
    if (path) {
      const t = await readFile(path, 'utf8');
      if (!/^\s*(bed_shape|printer_model|gcode_flavor|nozzle_diameter)\s*=/m.test(t))
        throw new Error(
          'Ese archivo no parece una configuración de PrusaSlicer (.ini con bed_shape, nozzle_diameter…).',
        );
    }
    const s = this.saved();
    if (path) s.profile = path;
    else delete s.profile;
    await this.save(s);
  }

  /** Opens a model in a desktop slicer's own window. */
  openIn(id: string, file: string): void {
    const d = desktopSlicerCandidates().find((x) => x.id === id && existsSync(x.path));
    if (!d) throw new Error('Ese programa no está instalado.');
    const p =
      process.platform === 'darwin'
        ? spawn('open', ['-a', d.path, file], { detached: true, stdio: 'ignore' })
        : spawn(d.path, [file], { detached: true, stdio: 'ignore', windowsHide: false });
    p.on('error', () => {});
    p.unref();
  }

  async slice(
    input: SliceInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SliceResult> {
    const started = Date.now();
    const { slicer } = await this.info();
    if (!slicer)
      throw new Error(
        'No hay un rebanador instalado: instala PrusaSlicer (prusa3d.com) o elígelo en el panel CAD 3D.',
      );
    const profile = input.profile ?? this.saved().profile;
    const useProfile = !!profile && isFile(profile);
    const work = await mkdtemp(join(tmpdir(), 'zinarix-slice-'));
    try {
      const ini = join(work, 'zinarix.ini');
      await writeFile(ini, sliceIni(input.settings, !useProfile), 'utf8');
      const [bx, by] = bedOf(input.settings);
      const tmpOut = join(work, 'out.gcode');
      const args = [
        ...(useProfile ? ['--load', profile] : []),
        '--load',
        ini,
        '--export-gcode',
        ...(useProfile ? [] : ['--center', `${bx / 2},${by / 2}`]),
        '--output',
        tmpOut,
        input.model,
      ];
      const { text, code } = await runText(
        slicer.path,
        args,
        input.timeoutMs ?? 10 * 60_000,
        signal,
      );
      if (signal.aborted) throw new Error('Cancelado.');
      const probs = slicerProblems(text);
      if (!existsSync(tmpOut)) {
        if (code === null) throw new Error('El rebanador tardó demasiado y se detuvo.');
        throw new Error(
          probs.errors.join('\n') ||
            text.trim().split(/\r?\n/).slice(-4).join('\n') ||
            `El rebanador falló (código ${code}).`,
        );
      }
      const data = await readFile(tmpOut);
      await mkdir(dirname(input.out), { recursive: true });
      await writeFile(input.out, data);
      // Only the numbers are needed here, not the moves.
      const stats = {
        ...parseGcode(data.toString('utf8'), { maxSegments: 1 }).stats,
        truncated: false,
      };
      return {
        out: input.out,
        stats,
        warnings: probs.warnings,
        ms: Date.now() - started,
        slicer: `${slicer.name} ${slicer.version}`,
      };
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }
}
