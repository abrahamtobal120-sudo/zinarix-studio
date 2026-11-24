/**
 * Fase 7: runs the fixed Blender runner (shared/blenderOps.ts) without a window: open or create
 * a .blend (or import a mesh), apply validated ops, export, render a Workbench preview and save.
 * Blender starts with --disable-autoexec, so scripts packed in a .blend never run.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { BLENDER_RUNNER_PY, type BlenderOp, type BlenderReport } from '../shared/blenderOps.js';
import { taskEnv } from '../shared/sandbox.js';

export interface BlenderModelJob {
  /** .blend to open, or a mesh (.glb/.fbx/.obj/.stl/.ply) to import into an empty scene. */
  input?: string;
  /** Start from an empty scene (when there is no input). */
  fresh?: boolean;
  ops: BlenderOp[];
  /** .blend to save to (absent = save nothing). */
  save?: string;
  preview?: boolean;
  previewSize?: number;
}

export interface BlenderModelResult {
  report: BlenderReport;
  /** PNG bytes of the preview, when it rendered. */
  preview?: Buffer;
  ms: number;
}

/** "ZINARIX_ERROR op #2 (modifier): ..." -> that message; else the last error lines. */
export function blenderFailure(log: string): string {
  const m = /ZINARIX_ERROR (.+)/.exec(log);
  if (m) return m[1]!.trim();
  const lines = log
    .split(/\r?\n/)
    .filter((l) => /Error|Traceback|Exception/i.test(l))
    .slice(-4);
  return (lines.join('\n') || log.slice(-600)).trim();
}

export class BlenderModelService {
  constructor(private readonly blender: () => Promise<{ path: string; version: string } | null>) {}

  async run(
    job: BlenderModelJob,
    signal?: AbortSignal,
    timeoutMs = 10 * 60_000,
  ): Promise<BlenderModelResult> {
    const b = await this.blender();
    if (!b)
      throw new Error(
        'Blender no está instalado (necesita Blender 3.6 o más nuevo). Elígelo en el estudio 3D o descárgalo de blender.org.',
      );
    if (job.input && !existsSync(job.input)) throw new Error(`No existe ${job.input}.`);
    const started = Date.now();
    const work = await mkdtemp(join(tmpdir(), 'zinarix-blend-'));
    try {
      const runner = join(work, 'runner.py');
      const jobFile = join(work, 'job.json');
      const report = join(work, 'report.json');
      const preview = join(work, 'preview.png');
      const isBlend = !!job.input && extname(job.input).toLowerCase() === '.blend';
      await writeFile(runner, BLENDER_RUNNER_PY, 'utf8');
      await writeFile(
        jobFile,
        JSON.stringify({
          input: job.input && !isBlend ? job.input : undefined,
          new: !job.input,
          ops: job.ops,
          save: job.save,
          preview: job.preview ? preview : undefined,
          preview_size: job.previewSize ?? 768,
          report,
        }),
        'utf8',
      );
      const args = [
        '-b',
        ...(isBlend ? [job.input!] : []),
        '--factory-startup',
        '--disable-autoexec',
        '-noaudio',
        '--python-exit-code',
        '1',
        '--python',
        runner,
        '--',
        jobFile,
      ];
      const log = await new Promise<string>((resolve, reject) => {
        const p = spawn(b.path, args, { windowsHide: true, cwd: work, env: taskEnv(process.env) });
        let text = '';
        const onAbort = () => p.kill('SIGKILL');
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
        const read = (d: Buffer) => (text = (text + d.toString()).slice(-16_000));
        p.stdout.on('data', read);
        p.stderr.on('data', read);
        p.on('error', (e) => (clearTimeout(timer), reject(e)));
        p.on('close', (code) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (signal?.aborted) reject(new Error('Cancelado.'));
          else if (code === 0 && text.includes('ZINARIX_OK')) resolve(text);
          else reject(new Error(blenderFailure(text) || `Blender terminó con código ${code}.`));
        });
      });
      void log;
      const r = JSON.parse(await readFile(report, 'utf8')) as BlenderReport;
      const png = r.preview && existsSync(preview) ? await readFile(preview) : undefined;
      if (png) r.preview = undefined;
      return { report: r, ...(png ? { preview: png } : {}), ms: Date.now() - started };
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }
}
