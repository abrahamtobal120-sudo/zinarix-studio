import { OmniError } from '@omni/shared';
import { abortError, request, requestJson } from '../http.js';
import { base64ToBytes, extFor, styledPrompt } from './types.js';
import type { MediaAspect, MediaFile, MediaGenProvider, MediaRequest, MediaResult } from './types.js';

/**
 * Fase 10C: local generators the user already runs. Zinarix installs nothing; it connects to
 * the address in Settings (defaults below) and pays nothing.
 *
 * ComfyUI:            GET /object_info/CheckpointLoaderSimple (checkpoints), POST /prompt
 *                     { prompt: graph, client_id } -> { prompt_id }, GET /history/{id},
 *                     GET /view?filename&subfolder&type -> image
 * AUTOMATIC1111/Forge: POST /sdapi/v1/txt2img { prompt, seed, width, height, steps, batch_size }
 *                     -> { images: [b64], info: '{"seed": …}' }
 * OpenAI-compatible speech (Kokoro, LocalAI…): POST /audio/speech { model, input, voice }
 */
export const LOCAL_DEFAULTS = {
  comfyui: 'http://127.0.0.1:8188',
  a1111: 'http://127.0.0.1:7860',
  'local-speech': 'http://127.0.0.1:8880/v1',
} as const;

const LONG = 30 * 60_000;
const POLL_MS = 1000;

/** SDXL-friendly sizes per aspect (multiples of 64). */
export const LOCAL_SIZE: Record<MediaAspect, [number, number]> = {
  '1:1': [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** A seed for the request: the asked one, else a new random one (recorded in .gen.json). */
export function seedFor(req: MediaRequest): number {
  return req.seed ?? Math.floor(Math.random() * 2 ** 31);
}

function noEdits(req: MediaRequest, warnings: string[]): void {
  if (req.edit || req.reference)
    warnings.push('El servidor local recibe solo texto desde Zinarix: la imagen no se envió.');
  if (req.transparent) warnings.push('Fondo transparente no disponible en local: se generó con fondo.');
}

// ---------------------------------------------------------------------------- ComfyUI

/** The default text-to-image graph (API format) of ComfyUI, with our values filled in. */
export function comfyGraph(
  req: MediaRequest,
  ckpt: string,
  seed: number,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const [width, height] = LOCAL_SIZE[req.aspect ?? '1:1'];
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: Math.max(1, Math.min(4, req.count ?? 1)) },
    },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: styledPrompt(req), clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'zinarix', images: ['8', 0] } },
  };
}

/** First checkpoint name, in the old ([names]) or the new ("COMBO", { options }) format. */
export function comfyCheckpoint(spec: unknown[] | undefined): string | undefined {
  const a = spec?.[0];
  if (Array.isArray(a)) return typeof a[0] === 'string' ? a[0] : undefined;
  if (a === 'COMBO') {
    const opts = (spec?.[1] as { options?: unknown[] } | undefined)?.options;
    return typeof opts?.[0] === 'string' ? opts[0] : undefined;
  }
  return undefined;
}

interface ComfyImage {
  filename: string;
  subfolder?: string;
  type?: string;
}

export const comfyMedia: MediaGenProvider = {
  id: 'comfyui',
  kinds: ['image'],
  async generate(cfg, req, signal, onProgress): Promise<MediaResult> {
    if (req.kind !== 'image')
      throw new OmniError('unsupported', 'ComfyUI solo genera imágenes desde Zinarix.', {
        provider: cfg.entry.id,
        retryable: false,
      });
    const warnings: string[] = [];
    noEdits(req, warnings);
    onProgress?.({ stage: 'sending' });
    const info = await requestJson<Record<string, { input?: { required?: { ckpt_name?: unknown[] } } }>>(
      cfg,
      { path: '/object_info/CheckpointLoaderSimple', signal },
    );
    const ckpt = comfyCheckpoint(info.CheckpointLoaderSimple?.input?.required?.ckpt_name);
    if (!ckpt)
      throw new OmniError('config', 'ComfyUI no tiene ningún checkpoint instalado (models/checkpoints).', {
        provider: cfg.entry.id,
        retryable: false,
      });
    const seed = seedFor(req);
    const queued = await requestJson<{ prompt_id?: string }>(
      { ...cfg, timeoutMs: Math.max(cfg.timeoutMs ?? 0, LONG) },
      {
        method: 'POST',
        path: '/prompt',
        body: { prompt: comfyGraph(req, ckpt, seed), client_id: 'zinarix-studio' },
        signal,
      },
    );
    const id = queued.prompt_id;
    if (!id) throw new OmniError('server', 'ComfyUI no aceptó el trabajo.', { provider: cfg.entry.id });
    const started = Date.now();
    let images: ComfyImage[] = [];
    for (;;) {
      onProgress?.({ stage: 'waiting' });
      const h = await requestJson<
        Record<
          string,
          {
            outputs?: Record<string, { images?: ComfyImage[] }>;
            status?: { status_str?: string; completed?: boolean };
          }
        >
      >(cfg, { path: `/history/${encodeURIComponent(id)}`, signal });
      const job = h[id];
      if (job?.status?.status_str === 'error')
        throw new OmniError('server', 'ComfyUI falló al generar (mira su consola).', {
          provider: cfg.entry.id,
          retryable: false,
        });
      if (job?.outputs) {
        images = Object.values(job.outputs).flatMap((o) => o.images ?? []);
        if (images.length || job.status?.completed) break;
      }
      if (Date.now() - started > LONG)
        throw new OmniError('timeout', 'ComfyUI tardó más de 30 minutos.', { provider: cfg.entry.id });
      await sleep(POLL_MS, signal);
    }
    onProgress?.({ stage: 'downloading' });
    const files: MediaFile[] = [];
    for (const img of images) {
      const res = await request(cfg, {
        path: '/view',
        query: { filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' },
        signal,
        headers: { accept: 'image/*' },
      });
      const mediaType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
      files.push({ data: new Uint8Array(await res.arrayBuffer()), mediaType, ext: extFor(mediaType, 'png') });
    }
    if (!files.length)
      throw new OmniError('server', 'ComfyUI no devolvió ninguna imagen.', { provider: cfg.entry.id });
    return { kind: 'image', model: req.model, files, warnings, seed };
  },
};

// ---------------------------------------------------------------------------- A1111 / Forge

export function a1111Body(req: MediaRequest, seed: number): Record<string, unknown> {
  const [width, height] = LOCAL_SIZE[req.aspect ?? '1:1'];
  return {
    prompt: styledPrompt(req),
    negative_prompt: '',
    seed,
    width,
    height,
    steps: 25,
    batch_size: Math.max(1, Math.min(4, req.count ?? 1)),
  };
}

export const a1111Media: MediaGenProvider = {
  id: 'a1111',
  kinds: ['image'],
  async generate(cfg, req, signal, onProgress): Promise<MediaResult> {
    if (req.kind !== 'image')
      throw new OmniError('unsupported', 'AUTOMATIC1111 solo genera imágenes desde Zinarix.', {
        provider: cfg.entry.id,
        retryable: false,
      });
    const warnings: string[] = [];
    noEdits(req, warnings);
    onProgress?.({ stage: 'sending' });
    const seed = seedFor(req);
    const r = await requestJson<{ images?: string[]; info?: string }>(
      { ...cfg, timeoutMs: Math.max(cfg.timeoutMs ?? 0, LONG) },
      { method: 'POST', path: '/sdapi/v1/txt2img', body: a1111Body(req, seed), signal },
    );
    let used = seed;
    try {
      const info = JSON.parse(r.info ?? '{}') as { seed?: unknown };
      if (typeof info.seed === 'number') used = info.seed;
    } catch {
      /* no info: keep the one sent */
    }
    const files = (r.images ?? []).map((b64) => ({
      data: base64ToBytes(b64.replace(/^data:image\/\w+;base64,/, '')),
      mediaType: 'image/png',
      ext: 'png',
    }));
    if (!files.length)
      throw new OmniError('server', 'AUTOMATIC1111 no devolvió ninguna imagen.', { provider: cfg.entry.id });
    return { kind: 'image', model: req.model, files, warnings, seed: used };
  },
};

// ---------------------------------------------------------------------------- OpenAI-compatible speech

export function localSpeechBody(req: MediaRequest, model: string): Record<string, unknown> {
  return {
    model,
    input: req.prompt.trim(),
    voice: req.voice?.trim() || 'af_heart',
    response_format: 'mp3',
  };
}

/** `cfg.params.model` holds the server's model name (Settings; "kokoro" by default). */
export const localSpeechMedia: MediaGenProvider = {
  id: 'local-speech',
  kinds: ['speech'],
  async generate(cfg, req, signal, onProgress): Promise<MediaResult> {
    onProgress?.({ stage: 'sending' });
    const res = await request(
      { ...cfg, timeoutMs: Math.max(cfg.timeoutMs ?? 0, LONG) },
      {
        method: 'POST',
        path: '/audio/speech',
        body: localSpeechBody(req, cfg.params?.model || 'kokoro'),
        signal,
        headers: { accept: 'audio/*' },
      },
    );
    const mediaType = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.length)
      throw new OmniError('server', 'El servidor de voz devolvió un audio vacío.', { provider: cfg.entry.id });
    const warnings = req.style?.trim() ? ['El servidor local no recibe estilo: no se envió.'] : [];
    return { kind: 'speech', model: req.model, files: [{ data, mediaType, ext: extFor(mediaType, 'mp3') }], warnings };
  },
};

// ---------------------------------------------------------------------------- detection

export interface LocalStatus {
  ok: boolean;
  /** Why it is greyed out ("no responde en http://127.0.0.1:8188"). */
  detail: string;
}

/** Asks the server a cheap question; short timeout so a closed port does not slow the panel. */
export async function probeLocal(
  provider: 'comfyui' | 'a1111' | 'local-speech',
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<LocalStatus> {
  const path =
    provider === 'comfyui' ? '/system_stats' : provider === 'a1111' ? '/sdapi/v1/sd-models' : '/models';
  const url = baseUrl.replace(/\/+$/, '') + path;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return { ok: true, detail: `conectado en ${baseUrl}` };
    return { ok: false, detail: `${baseUrl} respondió HTTP ${res.status}` };
  } catch {
    return { ok: false, detail: `no responde en ${baseUrl}` };
  }
}
