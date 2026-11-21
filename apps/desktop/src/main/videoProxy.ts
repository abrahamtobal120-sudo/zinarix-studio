/**
 * Fase 4C: proxy files. A light H.264 copy (540p by default, a keyframe every half second) of a
 * heavy video, so the preview stays smooth while editing. The export always reads the original:
 * proxies only change the zmedia:// URL the renderer plays.
 *
 * Proxies live in the video cache, keyed by the original's path, size and mtime (editing or
 * replacing the original makes a new one). FFmpeg is spawned with an argument list, no shell.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const PROXY_HEIGHTS = [360, 540, 720] as const;
export type ProxyHeight = (typeof PROXY_HEIGHTS)[number];
export const PROXY_DEFAULT: ProxyHeight = 540;

/** Videos worth a proxy: bigger than this on their short side (1080p and below play fine). */
export const PROXY_AUTO_MIN = 1081;

/** The cache file of a proxy (exported for the tests). */
export function proxyFile(cacheDir: string, path: string, height: number): string {
  let tag = '0';
  try {
    const st = statSync(path);
    tag = `${st.size}|${st.mtimeMs}`;
  } catch {
    // missing: the key still works, the encode will fail
  }
  const key = createHash('sha256')
    .update(`${path}|${tag}|proxy${height}`)
    .digest('hex')
    .slice(0, 24);
  return join(cacheDir, `${key}.proxy${height}.mp4`);
}

/** Scale filter keeping the aspect: the short side becomes `height` (even sizes for H.264). */
export function proxyScale(width: number, heightPx: number, target: number): string {
  if (width > 0 && heightPx > 0 && width < heightPx) return `scale=${target}:-2:flags=bilinear`;
  return `scale=-2:${target}:flags=bilinear`;
}

/** FFmpeg arguments of a proxy encode (exported for the tests). */
export function proxyArgs(
  input: string,
  out: string,
  opts: { width: number; height: number; target: number; hasAudio: boolean },
): string[] {
  return [
    '-hide_banner',
    '-v',
    'error',
    '-nostdin',
    '-i',
    input,
    '-map',
    '0:v:0',
    ...(opts.hasAudio ? ['-map', '0:a:0?'] : []),
    '-sn',
    '-dn',
    '-vf',
    `${proxyScale(opts.width, opts.height, opts.target)},format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '27',
    // Short GOP: seeking (scrubbing the timeline) decodes at most half a second.
    '-g',
    '15',
    '-keyint_min',
    '15',
    '-sc_threshold',
    '0',
    ...(opts.hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-y',
    out,
  ];
}

/** Progress (0–1) out of FFmpeg's `-progress` lines, null when the chunk has none. */
export function parseProgress(chunk: string, duration: number): number | null {
  const all = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  const last = all[all.length - 1];
  if (!last || !(duration > 0)) return null;
  return Math.min(1, Number(last[1]) / 1e6 / duration);
}

export interface ProxyRequest {
  path: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  target?: number;
}

/** Makes proxies one at a time (they are CPU-heavy) and remembers which are running. */
export class ProxyMaker {
  private running = new Map<string, ReturnType<typeof spawn>>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Asked to stop before their turn came. */
  private canceled = new Set<string>();

  constructor(
    private readonly cacheDir: () => string,
    private readonly ffmpeg: () => string,
  ) {}

  /** The proxy of a file when it already exists. */
  existing(path: string, target: number = PROXY_DEFAULT): string | null {
    const f = proxyFile(this.cacheDir(), path, target);
    return existsSync(f) ? f : null;
  }

  isRunning(path: string): boolean {
    return this.running.has(path);
  }

  /** Makes (or reuses) the proxy of a file; resolves with its path. */
  make(req: ProxyRequest, onProgress: (p: number) => void): Promise<string> {
    const target = req.target ?? PROXY_DEFAULT;
    const done = this.existing(req.path, target);
    if (done) return Promise.resolve(done);
    this.canceled.delete(req.path);
    const job = this.queue.then(() => {
      if (this.canceled.delete(req.path)) throw new Error('Se canceló el proxy.');
      return this.encode(req, target, onProgress);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private encode(
    req: ProxyRequest,
    target: number,
    onProgress: (p: number) => void,
  ): Promise<string> {
    const dir = this.cacheDir();
    mkdirSync(dir, { recursive: true });
    const out = proxyFile(dir, req.path, target);
    if (existsSync(out)) return Promise.resolve(out);
    const tmp = `${out}.${process.pid}.tmp.mp4`;
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg(), proxyArgs(req.path, tmp, { ...req, target }), {
        windowsHide: true,
      });
      this.running.set(req.path, p);
      let err = '';
      p.stdout.on('data', (d: Buffer) => {
        const v = parseProgress(d.toString(), req.duration);
        if (v != null) onProgress(v);
      });
      p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-3000)));
      p.on('error', (e) => {
        this.running.delete(req.path);
        reject(e);
      });
      p.on('close', (code, signal) => {
        this.running.delete(req.path);
        if (code === 0 && existsSync(tmp)) {
          rename(tmp, out).then(
            () => resolve(out),
            (e: Error) => reject(e),
          );
          return;
        }
        void unlink(tmp).catch(() => undefined);
        reject(
          new Error(
            signal || code === null
              ? 'Se canceló el proxy.'
              : err.trim().split('\n').slice(-2).join('\n') || `FFmpeg terminó con código ${code}`,
          ),
        );
      });
    });
  }

  /** Stops the proxy of a file (or every one). */
  cancel(path?: string): void {
    if (path) this.canceled.add(path);
    for (const [k, p] of this.running) if (!path || k === path) p.kill('SIGKILL');
  }
}
