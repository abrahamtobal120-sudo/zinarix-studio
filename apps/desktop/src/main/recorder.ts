/**
 * Fase 4A: screen recording (like OBS / Loom) for Video Studio.
 *
 * The renderer records with MediaRecorder (screen or window, the computer's sound, the
 * microphone and the camera) and streams the chunks here; this file writes them to disk and,
 * when it ends, remuxes the WebM with FFmpeg (no re-encode) so it gets a duration and seek
 * points. getDisplayMedia() only gets the screen or window the user picked in Zinarix's own
 * picker: the request handler answers with that choice and refuses anything else.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync, type WriteStream } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesktopCapturerSource, Display, Session } from 'electron';
import type { CaptureSourceView } from '../shared/api.js';
import { desktopCapturer, screen } from 'electron';
import { CURSOR_RATE, type CursorTrack, cursorFile } from '../shared/videoZoom.js';

/** Recording files are this big at most (a few hours of screen at 8 Mbit/s). */
export const REC_MAX_BYTES = 16 * 1024 ** 3;

/** "grabacion-2026-11-20_20-41-07" (local time), the base name of a recording. */
export function recordingName(d = new Date(), suffix = ''): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `grabacion-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}${suffix}`
  );
}

/** A name not taken yet in `dir` ("x.webm", "x-2.webm"…). */
export function freeName(dir: string, base: string, ext: string): string {
  let name = `${base}.${ext}`;
  // A recording still being written exists only as its .part file.
  for (let i = 2; existsSync(join(dir, name)) || existsSync(join(dir, `${name}.part`)); i++)
    name = `${base}-${i}.${ext}`;
  return join(dir, name);
}

interface Rec {
  path: string;
  part: string;
  out: WriteStream;
  bytes: number;
  /** The previous write, so chunks land in order. */
  last: Promise<void>;
  failed?: Error;
  cursor?: CursorRec;
}

/** Fase 4 (mejora): where the mouse was during a screen recording (for the auto zoom). */
interface CursorRec {
  display: Display;
  timer: ReturnType<typeof setInterval>;
  /** Recording time = now − start − paused. */
  start: number;
  pausedMs: number;
  pausedAt: number;
  samples: [number, number, number][];
}
/** At most this many samples (4 hours at the sampling rate). */
const CURSOR_MAX = 4 * 3600 * CURSOR_RATE;

export class Recorder {
  /** The source picked in Zinarix's picker, for the next getDisplayMedia() (valid 30 s). */
  private pick: { id: string; audio: boolean; at: number } | null = null;
  private recs = new Map<string, Rec>();
  private seq = 0;
  /** The screen getDisplayMedia() was answered with (null for a window). */
  private display: Display | null = null;

  constructor(private readonly ffmpeg: () => string | null) {}

  async sources(): Promise<CaptureSourceView[]> {
    const list = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return list.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
    }));
  }

  /** Remembers what the user picked; the renderer calls getDisplayMedia() right after. */
  select(id: string, audio: boolean): void {
    this.pick = { id, audio, at: Date.now() };
  }

  /** Answers getDisplayMedia() with the picked source (and nothing when there is no pick). */
  install(ses: Session): void {
    ses.setDisplayMediaRequestHandler((_req, cb) => {
      const pick = this.pick;
      this.pick = null;
      if (!pick || Date.now() - pick.at > 30_000) return cb(null);
      void desktopCapturer
        .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then((list: DesktopCapturerSource[]) => {
          const src = list.find((s) => s.id === pick.id);
          if (!src) return cb(null);
          this.display = displayOf(src);
          // "loopback" is the computer's sound (Windows; on other systems Chromium ignores it).
          cb(
            pick.audio && process.platform === 'win32'
              ? { video: src, audio: 'loopback' }
              : { video: src },
          );
        })
        .catch(() => cb(null));
    });
  }

  /** Starts a file in `dir`; the chunks arrive with write(). */
  start(dir: string, base: string): { id: string; path: string } {
    mkdirSync(dir, { recursive: true });
    // The .part file is created asynchronously: also skip the names of recordings still open.
    const taken = new Set([...this.recs.values()].map((r) => r.path));
    let path = freeName(dir, base, 'webm');
    for (let i = 2; taken.has(path); i++) path = freeName(dir, `${base}-${i}`, 'webm');
    const part = `${path}.part`;
    const id = `rec${++this.seq}_${Date.now().toString(36)}`;
    const out = createWriteStream(part);
    const rec: Rec = { path, part, out, bytes: 0, last: Promise.resolve() };
    out.on('error', (e) => (rec.failed = e));
    this.recs.set(id, rec);
    return { id, path };
  }

  /**
   * Starts saving the mouse position of a screen recording (CURSOR_RATE times a second, only
   * when it moves). Does nothing for windows: their place on the screen is not known.
   */
  trackCursor(id: string): boolean {
    const rec = this.recs.get(id);
    const display = this.display;
    if (!rec || !display || rec.cursor) return false;
    const c: CursorRec = {
      display,
      start: Date.now(),
      pausedMs: 0,
      pausedAt: 0,
      samples: [],
      timer: 0 as never,
    };
    let lx = NaN;
    let ly = NaN;
    c.timer = setInterval(
      () => {
        if (c.pausedAt || c.samples.length >= CURSOR_MAX) return;
        let pt: { x: number; y: number };
        try {
          pt = screen.getCursorScreenPoint();
        } catch {
          return;
        }
        const b = c.display.bounds;
        const x = Math.round(((pt.x - b.x) / b.width) * 1e4) / 1e4;
        const y = Math.round(((pt.y - b.y) / b.height) * 1e4) / 1e4;
        const t = Date.now() - c.start - c.pausedMs;
        if (
          x === lx &&
          y === ly &&
          c.samples.length &&
          t - c.samples[c.samples.length - 1]![0] < 1000
        )
          return;
        lx = x;
        ly = y;
        c.samples.push([t, x, y]);
      },
      Math.round(1000 / CURSOR_RATE),
    );
    rec.cursor = c;
    return true;
  }

  /** The recording was paused or resumed (the cursor clock stops with it). */
  pauseCursor(id: string, paused: boolean): void {
    const c = this.recs.get(id)?.cursor;
    if (!c) return;
    if (paused && !c.pausedAt) c.pausedAt = Date.now();
    if (!paused && c.pausedAt) {
      c.pausedMs += Date.now() - c.pausedAt;
      c.pausedAt = 0;
    }
  }

  write(id: string, chunk: Uint8Array): Promise<void> {
    const rec = this.recs.get(id);
    if (!rec) return Promise.reject(new Error('La grabación ya terminó.'));
    if (rec.failed) return Promise.reject(rec.failed);
    rec.bytes += chunk.byteLength;
    if (rec.bytes > REC_MAX_BYTES)
      return Promise.reject(new Error('La grabación es demasiado grande.'));
    rec.last = rec.last.then(
      () =>
        new Promise<void>((resolve, reject) =>
          rec.out.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), (e) =>
            e ? reject(e) : resolve(),
          ),
        ),
    );
    return rec.last;
  }

  /** Closes the file and remuxes it (keeps the raw file when FFmpeg is missing or fails). */
  async finish(id: string): Promise<string> {
    const rec = this.recs.get(id);
    if (!rec) throw new Error('No existe esa grabación.');
    this.recs.delete(id);
    if (rec.cursor) clearInterval(rec.cursor.timer);
    await rec.last.catch(() => undefined);
    await new Promise<void>((r) => rec.out.end(() => r()));
    if (!existsSync(rec.part) || statSync(rec.part).size === 0) {
      await unlink(rec.part).catch(() => undefined);
      throw new Error('La grabación quedó vacía.');
    }
    const bin = this.ffmpeg();
    if (bin && (await remux(bin, rec.part, rec.path)))
      await unlink(rec.part).catch(() => undefined);
    else await rename(rec.part, rec.path);
    if (rec.cursor?.samples.length) {
      const b = rec.cursor.display.bounds;
      const track: CursorTrack = { v: 1, w: b.width, h: b.height, samples: rec.cursor.samples };
      // Without it the recording still works (just no auto zoom).
      await writeFile(cursorFile(rec.path), JSON.stringify(track)).catch(() => undefined);
    }
    return rec.path;
  }

  async abort(id: string): Promise<void> {
    const rec = this.recs.get(id);
    if (!rec) return;
    this.recs.delete(id);
    if (rec.cursor) clearInterval(rec.cursor.timer);
    await rec.last.catch(() => undefined);
    await new Promise<void>((r) => rec.out.end(() => r()));
    await unlink(rec.part).catch(() => undefined);
  }

  dispose(): void {
    for (const id of [...this.recs.keys()]) void this.abort(id);
  }
}

/** The display a screen source shows (null for windows, or when it cannot be told). */
function displayOf(src: DesktopCapturerSource): Display | null {
  if (!src.id.startsWith('screen:')) return null;
  try {
    const all = screen.getAllDisplays();
    return all.find((d) => String(d.id) === src.display_id) ?? (all.length === 1 ? all[0]! : null);
  } catch {
    return null;
  }
}

/** Copies the streams into a new WebM (duration and cues written): true when it worked. */
export function remux(ffmpeg: string, input: string, out: string): Promise<boolean> {
  const tmp = `${out}.remux.webm`;
  return new Promise((resolve) => {
    const p = spawn(
      ffmpeg,
      [
        '-hide_banner',
        '-v',
        'error',
        '-nostdin',
        '-fflags',
        '+genpts',
        '-i',
        input,
        '-c',
        'copy',
        '-y',
        tmp,
      ],
      { windowsHide: true },
    );
    const timer = setTimeout(() => p.kill('SIGKILL'), 10 * 60_000);
    p.on('error', () => (clearTimeout(timer), resolve(false)));
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(tmp) && statSync(tmp).size > 0)
        rename(tmp, out).then(
          () => resolve(true),
          () => resolve(false),
        );
      else
        void unlink(tmp).then(
          () => resolve(false),
          () => resolve(false),
        );
    });
  });
}
