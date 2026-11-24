/**
 * Fase 1B (plan de funciones): background removal on this PC. The fast model ships with the app
 * (resources/bgremove); the precise one is downloaded once, on request, into the user's data
 * folder and checked against its SHA-256 before use. The model runs in bgWorker (its own
 * process); the pure pre/post-processing is in shared/bgRemove.ts.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BG_MODELS,
  maskFromOutput,
  modelInput,
  type BgModelId,
  type BgModelState,
} from '../shared/bgRemove.js';
import type { Rgba } from '../shared/imageEdit.js';
import { taskEnv } from '../shared/sandbox.js';
import type { BgRequest, BgResponse } from './bgWorker.js';

export type BgRunner = (req: BgRequest, signal?: AbortSignal) => Promise<BgResponse>;

/** Runs dist/bgremove/bgWorker.mjs as a Node process (Electron with ELECTRON_RUN_AS_NODE). */
export function bgViaProcess(
  exe: string,
  script: string,
  env: Record<string, string> = {},
): BgRunner {
  return (req, signal) =>
    new Promise((done, fail) => {
      const p = spawn(exe, [script], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...taskEnv(process.env), ...env },
      });
      const out: Buffer[] = [];
      let err = '';
      const kill = () => p.kill('SIGKILL');
      const timer = setTimeout(kill, 180_000);
      signal?.addEventListener('abort', kill, { once: true });
      p.stdout.on('data', (d: Buffer) => out.push(d));
      p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
      p.stdin.on('error', () => {});
      p.on('error', (e) => (clearTimeout(timer), fail(e)));
      p.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', kill);
        if (signal?.aborted) return fail(new Error('Cancelado.'));
        try {
          done(JSON.parse(Buffer.concat(out).toString('utf8')) as BgResponse);
        } catch {
          fail(
            new Error(
              code === null
                ? 'Quitar el fondo tardó demasiado y se detuvo.'
                : `El modelo falló (código ${code}): ${err.trim().slice(-400)}`,
            ),
          );
        }
      });
      p.stdin.end(JSON.stringify(req));
    });
}

export class BgRemoveService {
  private readonly downloads = new Map<
    BgModelId,
    { got: number; ac: AbortController; done: Promise<void> }
  >();

  constructor(
    /** Folder with the models that ship with the app (null in tests without it). */
    private readonly bundledDir: string | null,
    /** Where downloaded models go (userData/models). */
    private readonly userDir: string,
    private readonly runner: BgRunner | null,
  ) {}

  /** Path of a model on disk (shipped or downloaded and complete), else null. */
  modelPath(id: BgModelId): string | null {
    const m = BG_MODELS[id];
    for (const dir of [this.bundledDir, this.userDir]) {
      if (!dir) continue;
      const p = join(dir, m.file);
      try {
        if (statSync(p).size === m.bytes) return p;
      } catch {
        /* not there */
      }
    }
    return null;
  }

  get available(): boolean {
    return !!this.runner;
  }

  status(): BgModelState[] {
    return (Object.keys(BG_MODELS) as BgModelId[]).map((id) => {
      const d = this.downloads.get(id);
      return {
        id,
        ready: !!this.modelPath(id),
        bytes: BG_MODELS[id].bytes,
        ...(d ? { downloading: d.got } : {}),
      };
    });
  }

  /** Downloads a model (once; a second call joins the running download). */
  download(id: BgModelId, onProgress?: (got: number, total: number) => void): Promise<void> {
    if (this.modelPath(id)) return Promise.resolve();
    const running = this.downloads.get(id);
    if (running) return running.done;
    const ac = new AbortController();
    const entry = { got: 0, ac, done: Promise.resolve() };
    entry.done = this.fetchModel(id, ac.signal, (got) => {
      entry.got = got;
      onProgress?.(got, BG_MODELS[id].bytes);
    }).finally(() => this.downloads.delete(id));
    this.downloads.set(id, entry);
    return entry.done;
  }

  cancelDownload(id: BgModelId): void {
    this.downloads.get(id)?.ac.abort();
  }

  private async fetchModel(id: BgModelId, signal: AbortSignal, progress: (got: number) => void) {
    const m = BG_MODELS[id];
    await mkdir(this.userDir, { recursive: true });
    const dest = join(this.userDir, m.file);
    const part = `${dest}.part`;
    const res = await fetch(m.url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body)
      throw new Error(`No se pudo descargar el modelo (HTTP ${res.status}).`);
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    let got = 0;
    let last = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        got += chunk.byteLength;
        if (got > m.bytes) throw new Error('El modelo descargado es más grande de lo esperado.');
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
        if (got - last > 1_000_000) {
          last = got;
          progress(got);
        }
      }
      await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())));
      if (got !== m.bytes || hash.digest('hex') !== m.sha256)
        throw new Error('El modelo descargado no pasó la verificación (SHA-256). No se usará.');
      await rename(part, dest);
      progress(got);
    } catch (e) {
      out.destroy();
      await rm(part, { force: true });
      if (signal.aborted) throw new Error('Descarga cancelada.');
      throw e;
    }
  }

  /** Runs a model on its prepared input; returns its side × side output. */
  async infer(id: BgModelId, input: Float32Array, signal?: AbortSignal): Promise<Float32Array> {
    if (!this.runner) throw new Error('Quitar el fondo no está disponible en esta instalación.');
    const model = this.modelPath(id);
    if (!model)
      throw new Error(
        id === 'precise'
          ? 'El modelo preciso no está descargado. Descárgalo primero (179 MB, una sola vez).'
          : 'Falta el modelo rápido de quitar fondo en esta instalación.',
      );
    const side = BG_MODELS[id].side;
    if (input.length !== 3 * side * side)
      throw new Error('Entrada del modelo con tamaño incorrecto.');
    const res = await this.runner(
      {
        model,
        side,
        input: Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('base64'),
      },
      signal,
    );
    if (res.error || !res.output) throw new Error(res.error ?? 'El modelo no devolvió nada.');
    const buf = Buffer.from(res.output, 'base64');
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  }

  /** The alpha mask (w × h, 0…255) of a picture. */
  async mask(img: Rgba, id: BgModelId, signal?: AbortSignal): Promise<Uint8Array> {
    const m = BG_MODELS[id];
    const out = await this.infer(id, modelInput(img, m), signal);
    return maskFromOutput(out, m.side, img.width, img.height);
  }
}
