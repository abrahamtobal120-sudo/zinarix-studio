/**
 * Fase 13: transcription and audio / picture analysis for the video editor.
 *
 * - Engines: whisper.cpp on this machine (when its program and a ggml model are found) or an
 *   OpenAI-compatible speech-to-text API of a connected provider (OpenAI whisper-1, Groq
 *   whisper-large-v3-turbo), both with word times.
 * - Silences (`silencedetect`) and scene changes (`select='gt(scene,T)',showinfo`) with FFmpeg.
 *
 * Every program runs with spawn() and an argument list (paths never reach a shell). Audio is
 * sent to a provider only when the user picks that engine.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { OmniCore } from '@omni/core';
import { applyAuth, errorFromResponse, joinUrl } from '@omni/providers';
import type { Transcript } from '../shared/video.js';
import type { Range } from '../shared/videoAi.js';
import {
  parseScenes,
  parseSilences,
  parseVerboseJson,
  parseWhisperCpp,
} from '../shared/videoAi.js';

export type TranscribeEngineId = 'local' | 'openai' | 'groq';

export interface TranscribeEngineView {
  id: TranscribeEngineId;
  label: string;
  ready: boolean;
  /** Why it is not ready, or where the audio goes. */
  note: string;
  /** Leaves the machine (the audio is uploaded). */
  cloud: boolean;
}

const CLOUD: Record<Exclude<TranscribeEngineId, 'local'>, { label: string; model: string }> = {
  openai: { label: 'OpenAI · whisper-1', model: 'whisper-1' },
  groq: { label: 'Groq · whisper-large-v3-turbo', model: 'whisper-large-v3-turbo' },
};

/** Providers take 25 MB per file; the upload is 32 kb/s mono MP3 (≈ 100 min). */
const UPLOAD_MAX = 24 * 1024 * 1024;

interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

function runText(
  bin: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let errLen = 0;
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => {
      // The logs we parse are small; a runaway one is cut to its last 8 MB.
      err.push(d);
      errLen += d.length;
      while (errLen > 8 * 1024 * 1024 && err.length > 1) errLen -= err.shift()!.length;
    });
    const kill = () => p.kill('SIGKILL');
    const timer = setTimeout(kill, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) return reject(new Error('Cancelado.'));
      resolve({
        code,
        out: Buffer.concat(out).toString('utf8'),
        err: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

const lastLine = (s: string) =>
  s.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' · ').slice(0, 400);

/** Seconds of work FFmpeg may take for a file of this length. */
const budget = (duration: number) => Math.max(120_000, duration * 2000);

/** whisper.cpp's program and a model: from env, the app's whisper folder or PATH. */
export function findWhisper(dataDir: string): { bin: string | null; model: string | null } {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const names = ['whisper-cli', 'whisper-cpp'].map((n) => n + exe);
  const own = join(dataDir, 'whisper');
  const dirs = [own, ...(process.env.PATH ?? '').split(delimiter).filter(Boolean)];
  let bin: string | null = null;
  const envBin = process.env.ZINARIX_WHISPER;
  if (envBin && existsSync(envBin)) bin = envBin;
  for (const d of dirs) {
    if (bin) break;
    for (const n of names)
      if (existsSync(join(d, n))) {
        bin = join(d, n);
        break;
      }
  }
  let model: string | null = null;
  const envModel = process.env.ZINARIX_WHISPER_MODEL;
  if (envModel && existsSync(envModel)) model = envModel;
  else if (existsSync(own)) {
    // The largest ggml model in the folder (usually the best one the user downloaded).
    const found = readdirSync(own)
      .filter((f) => /^ggml-.*\.bin$/i.test(f))
      .map((f) => ({ f: join(own, f), size: statSync(join(own, f)).size }))
      .sort((a, b) => b.size - a.size);
    model = found[0]?.f ?? null;
  }
  return { bin, model };
}

export class Transcriber {
  constructor(
    private readonly core: OmniCore,
    private readonly dataDir: string,
    private readonly ffmpeg: () => string | null,
  ) {}

  private need(): string {
    const bin = this.ffmpeg();
    if (!bin) throw new Error('FFmpeg no está disponible en este equipo.');
    return bin;
  }

  async engines(): Promise<TranscribeEngineView[]> {
    const w = findWhisper(this.dataDir);
    const connected = new Set((await this.core.connectedProviders()).map((p) => p.id));
    const folder = join(this.dataDir, 'whisper');
    return [
      {
        id: 'local',
        label: 'whisper.cpp (en este equipo)',
        ready: !!(w.bin && w.model),
        note: !w.bin
          ? `No se encontró whisper-cli. Ponlo en ${folder} o en el PATH.`
          : !w.model
            ? `Falta un modelo ggml-*.bin en ${folder}.`
            : 'El audio no sale de tu equipo.',
        cloud: false,
      },
      ...(['openai', 'groq'] as const).map((id) => ({
        id,
        label: CLOUD[id].label,
        ready: connected.has(id),
        note: connected.has(id)
          ? 'El audio se sube al proveedor para transcribirlo.'
          : 'Conecta este proveedor en Modelos para usarlo.',
        cloud: true,
      })),
    ];
  }

  async transcribe(
    path: string,
    engine: TranscribeEngineId,
    duration: number,
    lang?: string,
    signal?: AbortSignal,
  ): Promise<Transcript> {
    const language = lang && /^[a-z]{2,3}$/.test(lang) ? lang : undefined;
    const dir = await mkdtemp(join(tmpdir(), 'zinarix-stt-'));
    try {
      if (engine === 'local') return await this.local(path, dir, duration, language, signal);
      return await this.cloud(path, dir, engine, duration, language, signal);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async extract(
    path: string,
    out: string,
    codec: string[],
    duration: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const r = await runText(
      this.need(),
      [
        '-hide_banner',
        '-v',
        'error',
        '-i',
        path,
        '-vn',
        '-sn',
        '-ac',
        '1',
        '-ar',
        '16000',
        ...codec,
        '-y',
        out,
      ],
      budget(duration),
      signal,
    );
    if (r.code !== 0 || !existsSync(out))
      throw new Error(`No se pudo leer el audio: ${lastLine(r.err) || 'sin pista de audio'}`);
  }

  private async local(
    path: string,
    dir: string,
    duration: number,
    lang: string | undefined,
    signal?: AbortSignal,
  ): Promise<Transcript> {
    const w = findWhisper(this.dataDir);
    if (!w.bin || !w.model) throw new Error('whisper.cpp no está listo en este equipo.');
    const wav = join(dir, 'audio.wav');
    await this.extract(path, wav, ['-c:a', 'pcm_s16le'], duration, signal);
    const base = join(dir, 'out');
    const r = await runText(
      w.bin,
      ['-m', w.model, '-f', wav, '-l', lang ?? 'auto', '-ojf', '-of', base, '-np'],
      Math.max(600_000, duration * 6000),
      signal,
    );
    if (r.code !== 0 || !existsSync(`${base}.json`))
      throw new Error(`whisper.cpp falló: ${lastLine(r.err) || `código ${r.code}`}`);
    const parsed = parseWhisperCpp(JSON.parse(await readFile(`${base}.json`, 'utf8')));
    return { engine: 'whisper.cpp', ...parsed, at: Date.now() };
  }

  private async cloud(
    path: string,
    dir: string,
    engine: 'openai' | 'groq',
    duration: number,
    lang: string | undefined,
    signal?: AbortSignal,
  ): Promise<Transcript> {
    const mp3 = join(dir, 'audio.mp3');
    await this.extract(path, mp3, ['-c:a', 'libmp3lame', '-b:a', '32k'], duration, signal);
    const data = await readFile(mp3);
    if (data.length > UPLOAD_MAX)
      throw new Error('El audio es demasiado largo para subirlo de una vez (más de ~100 min).');
    const cfg = await this.core.providerConfig(engine);
    const { model } = CLOUD[engine];
    const url = new URL(joinUrl(cfg.baseUrl, '/audio/transcriptions'));
    const headers: Record<string, string> = { ...cfg.extraHeaders };
    applyAuth(cfg, url, headers);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (lang) form.append('language', lang);
    const ac = new AbortController();
    const stop = () => ac.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, Math.max(300_000, duration * 1000));
    try {
      const res = await fetch(url, { method: 'POST', headers, body: form, signal: ac.signal });
      if (!res.ok) throw await errorFromResponse(res, engine);
      const parsed = parseVerboseJson(await res.json());
      if (!parsed.words.length) throw new Error('El proveedor no devolvió palabras.');
      return { engine: `${engine}/${model}`, ...parsed, at: Date.now() };
    } catch (e) {
      if (ac.signal.aborted) throw new Error(signal?.aborted ? 'Cancelado.' : 'Tardó demasiado.');
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  }

  /** Silent ranges of a file's audio (seconds of the file). */
  async silences(
    path: string,
    duration: number,
    noiseDb: number,
    minDur: number,
    signal?: AbortSignal,
  ): Promise<Range[]> {
    const db = Math.min(-10, Math.max(-80, Math.round(noiseDb)));
    const d = Math.min(10, Math.max(0.1, minDur));
    const r = await runText(
      this.need(),
      [
        '-hide_banner',
        '-nostats',
        '-i',
        path,
        '-vn',
        '-sn',
        '-af',
        `silencedetect=noise=${db}dB:d=${d}`,
        '-f',
        'null',
        '-',
      ],
      budget(duration),
      signal,
    );
    if (r.code !== 0) throw new Error(`No se pudo analizar el audio: ${lastLine(r.err)}`);
    return parseSilences(r.err, duration);
  }

  /** Times where a new scene starts (seconds of the file). */
  async scenes(
    path: string,
    duration: number,
    threshold: number,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const t = Math.min(0.9, Math.max(0.05, threshold));
    const r = await runText(
      this.need(),
      [
        '-hide_banner',
        '-nostats',
        '-i',
        path,
        '-an',
        '-sn',
        '-vf',
        `scale=320:-2,select='gt(scene,${t})',showinfo`,
        '-f',
        'null',
        '-',
      ],
      budget(duration) * 2,
      signal,
    );
    if (r.code !== 0) throw new Error(`No se pudo analizar el video: ${lastLine(r.err)}`);
    return parseScenes(r.err);
  }
}
