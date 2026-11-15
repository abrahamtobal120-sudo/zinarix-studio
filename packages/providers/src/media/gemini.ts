import { OmniError } from '@omni/shared';
import { abortError, request, requestJson } from '../http.js';
import type { ProviderConfig } from '../types.js';
import { findMediaModel } from './catalog.js';
import { base64ToBytes, extFor, styledPrompt } from './types.js';
import type {
  MediaFile,
  MediaGenProvider,
  MediaKind,
  MediaProgress,
  MediaRequest,
  MediaResult,
} from './types.js';

/**
 * Google Gemini media through the Interactions API (Imagen and the Veo previews are shut down):
 *
 *   POST /interactions { model, input, response_format: { type, ... }, generation_config? }
 *     -> { id, status, steps: [{ type: 'model_output', content: [{ type, data | uri, mime_type }] }] }
 *
 * Images and speech come back inline (base64). Video asks for `delivery: "uri"` (inline is
 * capped at ~4 MB): the file is polled until ACTIVE and downloaded from the Files API.
 * When the interaction is not finished yet, GET /interactions/{id} is polled.
 */

const API_REVISION = '2026-05-20';
const LONG = 15 * 60_000;
const POLL_MS = 5000;
const MAX_POLLS = 360;

interface Interaction {
  id?: string;
  status?: string;
  error?: { message?: string };
  steps?: unknown[];
}

interface Found {
  type: string;
  data?: string;
  uri?: string;
  mimeType?: string;
}

/** Every content block of the wanted type, in order (walks steps → content). */
export function findOutputs(json: unknown, type: 'image' | 'video' | 'audio'): Found[] {
  const out: Found[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.type === type && (typeof o.data === 'string' || typeof o.uri === 'string')) {
      out.push({
        type,
        data: typeof o.data === 'string' ? o.data : undefined,
        uri: typeof o.uri === 'string' ? o.uri : undefined,
        mimeType:
          typeof o.mime_type === 'string'
            ? o.mime_type
            : typeof o.mimeType === 'string'
              ? o.mimeType
              : undefined,
      });
      return;
    }
    for (const k of Object.keys(o)) if (k !== 'input') walk(o[k]);
  };
  walk(json);
  return out;
}

export function geminiMediaBody(req: MediaRequest): {
  body: Record<string, unknown>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const model = findMediaModel('google-gemini', req.model);
  if (req.seed !== undefined) warnings.push('La Interactions API no documenta semilla: no se envió.');
  if (req.transparent && req.kind === 'image')
    warnings.push('Gemini no hace fondos transparentes: se generó con fondo.');
  if (req.kind === 'image') {
    return {
      body: {
        model: req.model,
        input: styledPrompt(req),
        response_format: {
          type: 'image',
          mime_type: 'image/png',
          ...(req.aspect ? { aspect_ratio: req.aspect } : {}),
          image_size: '1K',
        },
      },
      warnings,
    };
  }
  if (req.kind === 'speech') {
    const voice =
      req.voice && (!model?.voices || model.voices.includes(req.voice)) ? req.voice : undefined;
    if (req.voice && !voice) warnings.push(`La voz "${req.voice}" no existe: se usó ${model?.voices?.[0] ?? 'Kore'}.`);
    const style = req.style?.trim();
    return {
      body: {
        model: req.model,
        input: [
          {
            type: 'user_input',
            content: [
              { type: 'text', text: req.prompt.trim(), ...(style ? { speech_metadata: { style } } : {}) },
            ],
          },
        ],
        response_format: { type: 'audio', mime_type: 'audio/wav' },
        generation_config: { speech_config: [{ voice: voice ?? model?.voices?.[0] ?? 'Kore' }] },
      },
      warnings,
    };
  }
  if (req.kind === 'video') {
    const range = model?.duration ?? { min: 3, max: 15, default: 5 };
    const asked = Math.round(req.durationSec ?? range.default);
    const secs = Math.max(range.min, Math.min(range.max, asked));
    if (secs !== asked) warnings.push(`El video dura entre ${range.min} y ${range.max} s: se pidió de ${secs} s.`);
    let aspect = req.aspect ?? '16:9';
    if (model?.aspects && !model.aspects.includes(aspect)) {
      warnings.push(`${aspect} no está disponible para video: se usó 16:9.`);
      aspect = '16:9';
    }
    return {
      body: {
        model: req.model,
        input: styledPrompt(req),
        response_format: {
          type: 'video',
          aspect_ratio: aspect,
          resolution: '720p',
          duration: `${secs}s`,
          delivery: 'uri',
        },
      },
      warnings,
    };
  }
  throw new OmniError('unsupported', 'Gemini todavía no genera música desde Zinarix.', {
    provider: 'google-gemini',
    retryable: false,
  });
}

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

function failed(cfg: ProviderConfig, it: Interaction): OmniError {
  return new OmniError('server', `Gemini: ${it.error?.message ?? `la generación terminó como "${it.status}"`}`, {
    provider: cfg.entry.id,
    retryable: false,
  });
}

/** Files API id from a uri like ".../v1beta/files/abc123" or "files/abc123". */
export function fileId(uri: string): string | undefined {
  return /files\/([A-Za-z0-9_-]+)/.exec(uri)?.[1];
}

async function download(
  cfg: ProviderConfig,
  found: Found,
  fallbackType: string,
  signal: AbortSignal,
  onProgress?: (p: MediaProgress) => void,
): Promise<MediaFile> {
  const mediaType = found.mimeType ?? fallbackType;
  const ext = extFor(mediaType, fallbackType.split('/')[1] ?? 'bin');
  if (found.data) return { data: base64ToBytes(found.data), mediaType, ext };
  const id = found.uri ? fileId(found.uri) : undefined;
  if (!id) throw new OmniError('server', 'Gemini devolvió un archivo sin dirección válida', { provider: cfg.entry.id });
  for (let i = 0; i < MAX_POLLS; i++) {
    const f = await requestJson<{ state?: string }>(cfg, { path: `/files/${id}`, signal });
    if (!f.state || f.state === 'ACTIVE') break;
    if (f.state === 'FAILED') throw new OmniError('server', 'Gemini no pudo preparar el archivo', { provider: cfg.entry.id });
    onProgress?.({ stage: 'waiting' });
    await sleep(POLL_MS, signal);
  }
  onProgress?.({ stage: 'downloading' });
  const res = await request(
    { ...cfg, timeoutMs: LONG },
    { path: `/files/${id}:download`, query: { alt: 'media' }, signal, headers: { accept: '*/*' } },
  );
  return { data: new Uint8Array(await res.arrayBuffer()), mediaType, ext };
}

const OUTPUT: Record<Exclude<MediaKind, 'music'>, { type: 'image' | 'video' | 'audio'; mime: string }> = {
  image: { type: 'image', mime: 'image/png' },
  speech: { type: 'audio', mime: 'audio/wav' },
  video: { type: 'video', mime: 'video/mp4' },
};

async function once(
  cfg: ProviderConfig,
  req: MediaRequest,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onProgress?: (p: MediaProgress) => void,
): Promise<MediaFile[]> {
  const headers = { 'api-revision': API_REVISION };
  let it = await requestJson<Interaction>(
    { ...cfg, timeoutMs: Math.max(cfg.timeoutMs ?? 0, LONG) },
    { method: 'POST', path: '/interactions', body, signal, headers },
  );
  for (let i = 0; it.status && it.status !== 'completed'; i++) {
    if (it.status === 'failed' || it.status === 'cancelled' || it.status === 'canceled') throw failed(cfg, it);
    if (!it.id || i >= MAX_POLLS) throw failed(cfg, it);
    onProgress?.({ stage: 'waiting' });
    await sleep(POLL_MS, signal);
    it = await requestJson<Interaction>(cfg, { path: `/interactions/${it.id}`, signal, headers });
  }
  const out = OUTPUT[req.kind as Exclude<MediaKind, 'music'>];
  const found = findOutputs(it.steps ?? it, out.type);
  if (!found.length)
    throw new OmniError('server', `Gemini no devolvió ${req.kind === 'speech' ? 'audio' : req.kind}`, {
      provider: cfg.entry.id,
    });
  const files: MediaFile[] = [];
  for (const f of found) files.push(await download(cfg, f, out.mime, signal, onProgress));
  return files;
}

export const geminiMedia: MediaGenProvider = {
  id: 'google-gemini',
  kinds: ['image', 'speech', 'video'],
  async generate(cfg, req, signal, onProgress): Promise<MediaResult> {
    const { body, warnings } = geminiMediaBody(req);
    onProgress?.({ stage: 'sending' });
    // The Interactions API returns one image per call: several images are several calls.
    const model = findMediaModel('google-gemini', req.model);
    const n = req.kind === 'image' ? Math.max(1, Math.min(model?.maxCount ?? 4, req.count ?? 1)) : 1;
    const files: MediaFile[] = [];
    for (let i = 0; i < n; i++) {
      const got = await once(cfg, req, body, signal, onProgress);
      files.push(...(req.kind === 'image' ? got.slice(0, 1) : got));
    }
    return { kind: req.kind, model: req.model, files, warnings };
  },
};
