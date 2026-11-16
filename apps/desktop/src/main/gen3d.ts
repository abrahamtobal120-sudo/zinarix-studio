import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { OmniCore } from '@omni/core';
import { request, requestJson, type ProviderConfig } from '@omni/providers';
import {
  GEN3D_FILE_MAX,
  GEN3D_IMAGE_MAX,
  GEN3D_PROVIDER,
  gen3dFileName,
  gen3dIssue,
  genInput,
  imageMime,
  logPercent,
  missingInputs,
  modelUrlOf,
  type Gen3DEvent,
  type Gen3DRequest,
  type InputProps,
} from '../shared/gen3d.js';

/**
 * Fase 14: generates a 3D model (GLB) on Replicate and saves it to <project>/media/3d (or the
 * app data folder without a project). The key is the one of the Replicate provider; nothing
 * else of the user leaves the machine except the description and the picture they chose.
 */
interface Prediction {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  logs?: unknown;
  urls?: { get?: string; cancel?: string };
}

const POLL_MS = 2000;
/** These models take 1–5 minutes; a queue on Replicate can add some. */
const MAX_MS = 25 * 60 * 1000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('Cancelado.'));
      },
      { once: true },
    );
  });

export class Gen3DService {
  private running = new Map<string, AbortController>();

  constructor(
    private core: OmniCore,
    private userData: string,
  ) {}

  async connected(): Promise<boolean> {
    return (await this.core.connectedProviders()).some((p) => p.id === GEN3D_PROVIDER);
  }

  outDir(workspaceRoot: string | undefined): string {
    return workspaceRoot ? join(workspaceRoot, 'media', '3d') : join(this.userData, 'media-3d');
  }

  async generate(
    id: string,
    req: Gen3DRequest,
    workspaceRoot: string | undefined,
    emit: (e: Gen3DEvent) => void = () => {},
    outer?: AbortSignal,
  ): Promise<{ path: string; warnings: string[]; ms: number }> {
    const fail = (message: string): never => {
      emit({ type: 'error', message });
      throw new Error(message);
    };
    const issue = gen3dIssue(req);
    if (issue) fail(issue);
    if (!(await this.connected()))
      fail('Replicate no está conectado. Agrégalo en Ajustes → Proveedores.');

    const ac = new AbortController();
    const stop = () => ac.abort();
    outer?.addEventListener('abort', stop, { once: true });
    this.running.set(id, ac);
    const started = Date.now();
    const signal = ac.signal;
    let cancelUrl: string | undefined;
    let cfg: ProviderConfig | undefined;
    try {
      cfg = await this.core.providerConfig(GEN3D_PROVIDER);
      emit({ type: 'progress', stage: 'sending' });
      const [owner, name] = req.model.split('/') as [string, string];
      const info = await requestJson<{
        latest_version?: { id?: string; openapi_schema?: unknown } | null;
      }>(cfg, { path: `/models/${owner}/${name}`, signal });
      const props = (
        info.latest_version?.openapi_schema as
          | { components?: { schemas?: { Input?: { properties?: InputProps } } } }
          | undefined
      )?.components?.schemas?.Input?.properties;

      let imageDataUrl: string | undefined;
      if (req.image) {
        const st = await stat(req.image);
        if (st.size > GEN3D_IMAGE_MAX) fail('La imagen pasa de 10 MB.');
        imageDataUrl = `data:${imageMime(req.image)};base64,${(await readFile(req.image)).toString('base64')}`;
      }
      const input = genInput(props, { prompt: req.prompt, imageDataUrl, seed: req.seed });
      const warnings = missingInputs(props, { prompt: req.prompt, imageDataUrl }).map(
        (w) => `El modelo no acepta ${w}: no se envió.`,
      );
      if (!Object.keys(input).length) fail('El modelo no acepta ni texto ni imagen.');

      const version = info.latest_version?.id;
      let pred = await requestJson<Prediction>(cfg, {
        method: 'POST',
        path: version ? '/predictions' : `/models/${owner}/${name}/predictions`,
        body: version ? { version, input } : { input },
        signal,
      });
      cancelUrl = pred.urls?.cancel;
      const getUrl = pred.urls?.get ?? (pred.id ? `/predictions/${pred.id}` : undefined);
      if (!getUrl) fail('Replicate no devolvió la predicción.');
      while (!['succeeded', 'failed', 'canceled', 'aborted'].includes(pred.status ?? '')) {
        if (Date.now() - started > MAX_MS) fail('Replicate tardó más de 25 minutos.');
        await sleep(POLL_MS, signal);
        pred = await requestJson<Prediction>(cfg, { path: getUrl!, signal });
        const percent = logPercent(pred.logs);
        emit({ type: 'progress', stage: 'waiting', ...(percent !== undefined ? { percent } : {}) });
      }
      cancelUrl = undefined;
      if (pred.status !== 'succeeded')
        fail(
          typeof pred.error === 'string' && pred.error
            ? pred.error.slice(0, 500)
            : `La generación terminó como "${pred.status}".`,
        );
      const file = modelUrlOf(pred.output);
      if (!file) fail('La respuesta no trae un archivo GLB, OBJ ni FBX.');

      emit({ type: 'progress', stage: 'downloading' });
      const dir = this.outDir(workspaceRoot);
      await mkdir(dir, { recursive: true });
      const path = join(dir, gen3dFileName(req.prompt, file!.ext, new Date()));
      await this.download(cfg, file!.url, path, signal);
      const ms = Date.now() - started;
      emit({ type: 'done', path, warnings, ms });
      return { path, warnings, ms };
    } catch (e) {
      if (signal.aborted && cfg && cancelUrl)
        await request(cfg, { method: 'POST', path: cancelUrl }).catch(() => {});
      const message = signal.aborted ? 'Cancelado.' : e instanceof Error ? e.message : String(e);
      emit({ type: 'error', message });
      throw e instanceof Error ? e : new Error(message);
    } finally {
      outer?.removeEventListener('abort', stop);
      this.running.delete(id);
    }
  }

  /** Streams the file to disk with a size cap. Replicate's own API host gets the key. */
  private async download(cfg: ProviderConfig, url: string, dest: string, signal: AbortSignal) {
    const host = new URL(url).host;
    const res =
      host === new URL(cfg.baseUrl).host
        ? await request(cfg, { path: url, signal })
        : await fetch(url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`No se pudo descargar el modelo (HTTP ${res.status}).`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > GEN3D_FILE_MAX) throw new Error('El modelo generado pasa de 300 MB.');
    const out = createWriteStream(dest);
    let total = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > GEN3D_FILE_MAX) throw new Error('El modelo generado pasa de 300 MB.');
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    } catch (e) {
      out.destroy();
      await rm(dest, { force: true });
      throw e;
    }
  }

  abort(id: string): void {
    this.running.get(id)?.abort();
  }
}
