/**
 * Zinarix Video Studio, main-process side: finds FFmpeg, probes media, makes timeline
 * thumbnails and waveforms, serves media to the renderer through the zmedia:// protocol and
 * runs the export queue. No Electron imports (main.ts wires dialogs, IPC and the protocol), so
 * the tests can drive it directly.
 *
 * Every FFmpeg call is spawn() with an argument list: paths and names never reach a shell.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ExportOptions, MediaItem, VideoProject } from '../shared/video.js';
import { mediaKindOf, uid } from '../shared/video.js';
import { buildRender, parseLoudnorm } from '../shared/videoRender.js';
import type { LoudnessMeasure } from '../shared/videoRender.js';
import { LUT_MAX_BYTES, cleanGrade, lutKey, mixLut, parseCube, serializeCube } from '../shared/videoColor.js';
import { findExecutable } from './lspProtocol.js';

export interface FfmpegInfo {
  ffmpeg: string | null;
  ffprobe: string | null;
  version: string | null;
}

export interface VideoJob {
  id: string;
  name: string;
  out: string;
  state: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  /** 0–1. */
  progress: number;
  /** Seconds left (estimated), null until known. */
  eta: number | null;
  error?: string;
  startedAt?: number;
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

/**
 * The bundled binaries (resources/ffmpeg in an installed app, node_modules in development),
 * else the ones on PATH.
 */
export function findFfmpeg(appRoot: string, resourcesPath?: string): FfmpegInfo {
  const ffprobeArch = join('bin', process.platform, process.arch, exe('ffprobe'));
  const candidates = {
    ffmpeg: [
      resourcesPath && join(resourcesPath, 'ffmpeg', exe('ffmpeg')),
      join(appRoot, 'node_modules', 'ffmpeg-static', exe('ffmpeg')),
    ],
    ffprobe: [
      resourcesPath && join(resourcesPath, 'ffmpeg', exe('ffprobe')),
      join(appRoot, 'node_modules', 'ffprobe-static', ffprobeArch),
    ],
  };
  const pick = (list: (string | undefined)[], name: string): string | null => {
    for (const p of list) if (p && existsSync(p)) return p;
    // The system one, by absolute path from PATH (never a planted copy in the working folder).
    return findExecutable(name);
  };
  const ffmpeg = pick(candidates.ffmpeg, 'ffmpeg');
  const ffprobe = pick(candidates.ffprobe, 'ffprobe');
  let version: string | null = null;
  if (ffmpeg) {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    version = /ffmpeg version (\S+)/.exec(r.stdout ?? '')?.[1] ?? null;
  }
  return { ffmpeg, ffprobe, version };
}

/** Runs a binary and collects stdout (Buffer) — rejects with the end of stderr on failure. */
function run(bin: string, args: string[], timeoutMs = 120_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
    p.on('error', (e) => (clearTimeout(timer), reject(e)));
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(err.trim().split('\n').slice(-3).join('\n') || `exit ${code}`));
    });
  });
}

/** Reads a .cube LUT for the preview (only .cube files, bounded size). */
export async function readLut(path: string): Promise<string> {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.cube')
    throw new Error('Solo se admiten archivos .cube.');
  const st = await stat(path);
  if (!st.isFile() || st.size > LUT_MAX_BYTES) throw new Error('El LUT es demasiado grande.');
  const text = await readFile(path, 'utf8');
  parseCube(text); // refuse anything that is not a 3D LUT before the renderer sees it
  return text;
}

/**
 * Writes every LUT the project uses into `dir` as a clean .cube (strength baked in) and returns
 * lutKey → file name. FFmpeg runs inside `dir`, so the filter graph only ever names "lut0.cube"
 * (no drive letters or quotes to escape).
 */
export async function prepareLuts(
  project: VideoProject,
  dir: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of project.clips) {
    const g = cleanGrade(c.color);
    const key = lutKey(g);
    if (!g?.lut || !key || out[key]) continue;
    let text: string;
    try {
      text = await readLut(g.lut);
    } catch (e) {
      throw new Error(`No se pudo leer el LUT ${basename(g.lut)}: ${(e as Error).message}`);
    }
    const name = `lut${Object.keys(out).length}.cube`;
    await writeFile(join(dir, name), serializeCube(mixLut(parseCube(text), g.lutMix ?? 1)), 'utf8');
    out[key] = name;
  }
  return out;
}

interface ProbeJson {
  format?: { duration?: string; size?: string };
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: string;
    disposition?: { attached_pic?: number };
  }[];
}

function rate(s: string | undefined): number {
  if (!s) return 0;
  const [a, b] = s.split('/').map(Number);
  return b ? a! / b : Number(a) || 0;
}

/** Media facts from ffprobe's JSON (exported for the tests). */
export function parseProbe(path: string, j: ProbeJson, size: number): Omit<MediaItem, 'id'> {
  const kind = mediaKindOf(path) ?? 'video';
  const streams = j.streams ?? [];
  // Cover art in an MP3 is a "video" stream: not a picture track.
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(j.format?.duration ?? v?.duration ?? 0) || 0;
  const fps = rate(v?.avg_frame_rate) || rate(v?.r_frame_rate);
  return {
    path,
    name: basename(path),
    kind: kind === 'video' && !v && a ? 'audio' : kind,
    duration: kind === 'image' ? 0 : duration,
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: fps > 0 && fps < 1000 ? Math.round(fps * 1000) / 1000 : 0,
    hasVideo: kind !== 'audio' && Boolean(v),
    hasAudio: kind !== 'image' && Boolean(a),
    size,
  };
}

export class VideoService {
  private info: FfmpegInfo | null = null;
  /** zmedia:// token → absolute path (only files the user picked, and our cache). */
  private allowed = new Map<string, string>();
  private jobs: VideoJob[] = [];
  private procs = new Map<string, ReturnType<typeof spawn>>();
  private pending = new Map<string, () => Promise<void>>();
  private waveCache = new Map<string, number[]>();

  constructor(
    private readonly appRoot: string,
    private readonly dataDir: string,
    private readonly onJob: (job: VideoJob) => void,
    private readonly resourcesPath?: string,
  ) {}

  get cacheDir(): string {
    const d = join(this.dataDir, 'video-cache');
    mkdirSync(d, { recursive: true });
    return d;
  }

  tools(): FfmpegInfo {
    this.info ??= findFfmpeg(this.appRoot, this.resourcesPath);
    return this.info;
  }

  private need(which: 'ffmpeg' | 'ffprobe'): string {
    const bin = this.tools()[which];
    if (!bin) throw new Error('FFmpeg no está disponible en este equipo.');
    return bin;
  }

  /** A zmedia:// URL for a file (registering it as allowed). */
  urlFor(path: string): string {
    const token = createHash('sha256').update(path).digest('hex').slice(0, 40);
    this.allowed.set(token, path);
    return `zmedia://media/${token}${extname(path).toLowerCase()}`;
  }

  async probe(path: string): Promise<MediaItem & { url: string }> {
    if (!mediaKindOf(path)) throw new Error(`Formato no compatible: ${basename(path)}`);
    const st = statSync(path);
    if (!st.isFile()) throw new Error('No es un archivo.');
    let j: ProbeJson = {};
    try {
      j = JSON.parse(
        (
          await run(
            this.need('ffprobe'),
            ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
            30_000,
          )
        ).toString(),
      ) as ProbeJson;
    } catch (e) {
      // SVG (and other images FFmpeg may not read) are still usable as pictures.
      if (mediaKindOf(path) !== 'image') throw e;
    }
    return { id: uid('md'), ...parseProbe(path, j, st.size), url: this.urlFor(path) };
  }

  private cacheKey(path: string, what: string): string {
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      // missing: the key still works
    }
    return createHash('sha1').update(`${path}|${mtime}|${what}`).digest('hex').slice(0, 24);
  }

  /** A strip of `count` frames (one image) for the timeline; returns its URL. */
  async thumbnails(path: string, duration: number, count = 24): Promise<string> {
    const file = join(this.cacheDir, `${this.cacheKey(path, `thumbs${count}`)}.jpg`);
    if (!existsSync(file)) {
      const tmp = `${file}.${process.pid}.tmp.jpg`;
      const rateArg = `${count}/${Math.max(0.1, duration).toFixed(3)}`;
      const strip = (keyframesOnly: boolean) =>
        run(
          this.need('ffmpeg'),
          [
            '-hide_banner',
            '-v',
            'error',
            ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
            '-i',
            path,
            '-an',
            '-sn',
            '-vf',
            `fps=${rateArg},scale=-2:72,tile=${count}x1`,
            '-frames:v',
            '1',
            '-update',
            '1',
            '-q:v',
            '5',
            '-y',
            tmp,
          ],
          300_000,
        );
      // Long files: decode keyframes only (fast). Short ones may have a single keyframe.
      if (duration > 300) await strip(true).catch(() => undefined);
      if (!existsSync(tmp)) await strip(false);
      if (!existsSync(tmp)) throw new Error('No se pudieron sacar miniaturas.');
      await rename(tmp, file);
    }
    return this.urlFor(file);
  }

  /** Peak per 1/50 s (0–255) of the mixed-down audio. */
  async waveform(path: string): Promise<{ peaksPerSecond: number; peaks: number[] }> {
    const PPS = 50;
    const key = this.cacheKey(path, 'wave');
    const cached = this.waveCache.get(key);
    if (cached) return { peaksPerSecond: PPS, peaks: cached };
    const file = join(this.cacheDir, `${key}.wave.json`);
    if (existsSync(file)) {
      const peaks = JSON.parse(await readFile(file, 'utf8')) as number[];
      this.waveCache.set(key, peaks);
      return { peaksPerSecond: PPS, peaks };
    }
    const SR = 4000;
    const raw = await run(
      this.need('ffmpeg'),
      [
        '-hide_banner',
        '-v',
        'error',
        '-i',
        path,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(SR),
        '-f',
        's16le',
        '-',
      ],
      300_000,
    );
    const per = SR / PPS;
    const samples = Math.floor(raw.length / 2);
    const peaks: number[] = [];
    for (let i = 0; i < samples; i += per) {
      let max = 0;
      for (let k = i; k < Math.min(samples, i + per); k++)
        max = Math.max(max, Math.abs(raw.readInt16LE(k * 2)));
      peaks.push(Math.min(255, Math.round(Math.sqrt(max / 32768) * 255)));
    }
    this.waveCache.set(key, peaks);
    await writeFile(file, JSON.stringify(peaks));
    return { peaksPerSecond: PPS, peaks };
  }

  /** Answers a zmedia:// request (with byte ranges, so the player can seek). */
  async serve(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const token = url.pathname.replace(/^\//, '').replace(/\.[a-z0-9]+$/i, '');
    const path = this.allowed.get(token);
    if (!path) return new Response('forbidden', { status: 403 });
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return new Response('not found', { status: 404 });
    }
    const headers: Record<string, string> = {
      'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
    if (m && size > 0) {
      let start = m[1] ? Number(m[1]) : size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end)
        return new Response('range', {
          status: 416,
          headers: { 'content-range': `bytes */${size}` },
        });
      const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
      return new Response(body, {
        status: 206,
        headers: {
          ...headers,
          'content-range': `bytes ${start}-${end}/${size}`,
          'content-length': String(end - start + 1),
        },
      });
    }
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new Response(body, {
      status: 200,
      headers: { ...headers, 'content-length': String(size) },
    });
  }

  // ---------------- export queue ----------------

  list(): VideoJob[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  /** Queues an export; jobs run one after another. */
  enqueue(
    project: VideoProject,
    opts: ExportOptions,
    out: string,
    /** Clip id → PNG bytes of each title, drawn by the renderer at the export size. */
    textPngs: Record<string, Buffer> = {},
  ): VideoJob {
    const job: VideoJob = {
      id: uid('job'),
      name: project.name,
      out,
      state: 'queued',
      progress: 0,
      eta: null,
    };
    this.jobs = [
      ...this.jobs.filter(
        (j) =>
          j.state === 'running' ||
          j.state === 'queued' ||
          Date.now() - (j.startedAt ?? 0) < 3600_000,
      ),
      job,
    ];
    this.pending.set(job.id, () => this.render(job, project, opts, textPngs));
    this.onJob({ ...job });
    void this.pump();
    return job;
  }

  private pumping = false;
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const next = this.jobs.find((j) => j.state === 'queued');
        if (!next) break;
        const task = this.pending.get(next.id);
        this.pending.delete(next.id);
        if (task) await task();
      }
    } finally {
      this.pumping = false;
    }
  }

  cancel(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.state === 'queued') {
      this.pending.delete(id);
      this.update(job, { state: 'canceled' });
    }
    this.procs.get(id)?.kill('SIGKILL');
  }

  private update(job: VideoJob, patch: Partial<VideoJob>): void {
    Object.assign(job, patch);
    this.onJob({ ...job });
  }

  private async render(
    job: VideoJob,
    project: VideoProject,
    opts: ExportOptions,
    textPngs: Record<string, Buffer> = {},
  ): Promise<void> {
    let ffmpeg: string;
    try {
      ffmpeg = this.need('ffmpeg');
    } catch (e) {
      return this.update(job, { state: 'error', error: (e as Error).message });
    }
    const tmpOut = `${job.out}.part${extname(job.out)}`;
    // Titles: one PNG each in the temp folder (only clips that are titles, ids as file names).
    const textImages: Record<string, string> = {};
    for (const [id, png] of Object.entries(textPngs)) {
      if (!/^[\w-]{1,64}$/.test(id) || !project.clips.some((c) => c.id === id && c.text)) continue;
      const file = join(tmpdir(), `zinarix-${job.id}-${id}.png`);
      await writeFile(file, png);
      textImages[id] = file;
    }
    // A folder of its own: LUT files and the graph script live there, FFmpeg runs inside it.
    const work = await mkdtemp(join(tmpdir(), `zinarix-${job.id}-`));
    const script = join(work, 'graph.ffgraph');
    let result: { ok: boolean; error?: string; log?: string };
    this.update(job, { state: 'running', startedAt: Date.now(), progress: 0 });
    try {
      const lutFiles = await prepareLuts(project, work);
      // Loudness: a quick audio-only pass measures the mix, the export then applies the gain.
      let loudness: LoudnessMeasure | null = null;
      if (opts.loudness != null) {
        const m = buildRender(project, opts, tmpOut, undefined, textImages, {
          lutFiles,
          measure: true,
        });
        await writeFile(script, m.filter, 'utf8');
        const r = await this.ffmpegRun(job, ffmpeg, work, [
          '-hide_banner',
          '-nostats',
          '-v',
          'info',
          '-y',
          ...m.inputs,
          '-filter_complex_script',
          script,
          ...m.output,
        ]);
        if (!r.ok) throw new Error(r.error === 'canceled' ? 'canceled' : r.error);
        loudness = parseLoudnorm(r.log ?? '');
      }
      const plan = buildRender(project, opts, tmpOut, undefined, textImages, {
        lutFiles,
        loudness,
      });
      await writeFile(script, plan.filter, 'utf8');
      result = await this.ffmpegRun(
        job,
        ffmpeg,
        work,
        [
          '-hide_banner',
          '-v',
          'error',
          '-y',
          ...plan.inputs,
          '-filter_complex_script',
          script,
          ...plan.output.slice(0, -1),
          '-progress',
          'pipe:1',
          '-nostats',
          plan.output.at(-1)!,
        ],
        plan.duration,
      );
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }
    rmSync(work, { recursive: true, force: true });
    for (const f of Object.values(textImages)) await unlink(f).catch(() => undefined);
    if (result.ok) {
      try {
        await rm(job.out);
        await rename(tmpOut, job.out);
        this.update(job, { state: 'done', progress: 1, eta: 0 });
      } catch (e) {
        this.update(job, { state: 'error', error: (e as Error).message });
      }
    } else {
      await unlink(tmpOut).catch(() => undefined);
      this.update(
        job,
        result.error === 'canceled'
          ? { state: 'canceled' }
          : { state: 'error', error: result.error },
      );
    }
  }

  /**
   * One FFmpeg run of a job (cancelable). With `duration`, `-progress` lines on stdout move the
   * job's progress bar. `log` is the end of stderr (loudnorm prints its measure there).
   */
  private ffmpegRun(
    job: VideoJob,
    ffmpeg: string,
    cwd: string,
    args: string[],
    duration = 0,
  ): Promise<{ ok: boolean; error?: string; log?: string }> {
    return new Promise((resolve) => {
      if (job.state === 'canceled') return resolve({ ok: false, error: 'canceled' });
      const p = spawn(ffmpeg, args, { windowsHide: true, cwd });
      this.procs.set(job.id, p);
      let err = '';
      let buf = '';
      let lastSent = 0;
      p.stdout.on('data', (d: Buffer) => {
        if (!duration) return;
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
          if (!m) continue;
          const done = Math.min(1, Number(m[1]) / 1e6 / duration);
          const now = Date.now();
          if (now - lastSent < 250 && done < 1) continue;
          lastSent = now;
          const elapsed = (now - (job.startedAt ?? now)) / 1000;
          this.update(job, {
            progress: done,
            eta: done > 0.02 ? Math.max(0, (elapsed / done) * (1 - done)) : null,
          });
        }
      });
      p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-20000)));
      p.on('error', (e) => resolve({ ok: false, error: e.message }));
      p.on('close', (code, signal) => {
        this.procs.delete(job.id);
        if (signal) resolve({ ok: false, error: 'canceled' });
        else
          resolve(
            code === 0
              ? { ok: true, log: err }
              : { ok: false, error: err.trim().split('\n').slice(-4).join('\n') || `exit ${code}` },
          );
      });
    });
  }

  // ---------------- cache ----------------

  cacheSize(): number {
    let total = 0;
    for (const f of readdirSync(this.cacheDir)) {
      try {
        total += statSync(join(this.cacheDir, f)).size;
      } catch {
        // gone meanwhile
      }
    }
    return total;
  }

  clearCache(): void {
    rmSync(this.cacheDir, { recursive: true, force: true });
    this.waveCache.clear();
  }

  dispose(): void {
    for (const p of this.procs.values()) p.kill('SIGKILL');
  }
}

async function rm(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

// ---------------- project files ----------------

/** Media paths relative to the project's folder (forward slashes), plus the absolute one as a fallback. */
export function toStored(project: VideoProject, projectDir: string): unknown {
  return {
    ...project,
    media: project.media.map((m) => {
      const { missing: _m, ...rest } = m as MediaItem & { url?: string };
      delete (rest as { url?: string }).url;
      return { ...rest, path: relative(projectDir, m.path).split('\\').join('/'), absPath: m.path };
    }),
  };
}

/** Back to absolute paths; media found at neither place is marked missing. */
export function fromStored(stored: VideoProject, projectDir: string): VideoProject {
  return {
    ...stored,
    media: stored.media.map((m) => {
      const abs = (m as MediaItem & { absPath?: string }).absPath;
      const rel = isAbsolute(m.path) ? m.path : resolve(projectDir, m.path);
      const path = existsSync(rel) ? rel : abs && existsSync(abs) ? abs : rel;
      const { absPath: _a, ...rest } = m as MediaItem & { absPath?: string };
      return { ...rest, path, missing: !existsSync(path) };
    }),
  };
}
