import { OmniError } from '@omni/shared';
import { request, requestJson } from '../http.js';
import type { ProviderConfig } from '../types.js';
import { findMediaModel } from './catalog.js';
import { base64ToBytes, extFor, styledPrompt } from './types.js';
import type { MediaAspect, MediaGenProvider, MediaRequest, MediaResult } from './types.js';

/**
 * OpenAI images and speech:
 *   POST /images/generations  { model, prompt, n, size, quality, output_format, background }
 *        -> { data: [{ b64_json, revised_prompt? }] }
 *   POST /audio/speech        { model, input, voice, instructions?, response_format } -> audio
 * The Videos API (Sora) was shut down on 2026-09-24, so there is no video here.
 */

const SIZE: Record<MediaAspect, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '4:3': '1536x1024',
  '9:16': '1024x1536',
  '3:4': '1024x1536',
};
/** Sizes that are not exactly the asked ratio (the price table only has these three). */
const APPROX: ReadonlySet<MediaAspect> = new Set(['16:9', '9:16', '4:3', '3:4']);
const LONG = 10 * 60_000;

export function openAiImageBody(req: MediaRequest): {
  body: Record<string, unknown>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const model = findMediaModel('openai', req.model);
  const aspect = req.aspect ?? '1:1';
  const n = Math.max(1, Math.min(model?.maxCount ?? 4, req.count ?? 1));
  if ((req.count ?? 1) > n) warnings.push(`Se piden ${n} imágenes como máximo con este modelo.`);
  if (APPROX.has(aspect))
    warnings.push(
      `${aspect} se generó como ${SIZE[aspect]} (3:2); recórtala si necesitas la proporción exacta.`,
    );
  if (req.seed !== undefined) warnings.push('OpenAI no acepta semilla en imágenes: no se envió.');
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: styledPrompt(req),
    n,
    size: SIZE[aspect],
    output_format: 'png',
  };
  if (req.quality) body.quality = req.quality;
  if (req.transparent) {
    if (model?.transparent) body.background = 'transparent';
    else warnings.push('Este modelo no hace fondos transparentes: se generó con fondo.');
  }
  return { body, warnings };
}

export function openAiSpeechBody(req: MediaRequest): {
  body: Record<string, unknown>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const model = findMediaModel('openai', req.model);
  const voice =
    req.voice && (!model?.voices || model.voices.includes(req.voice)) ? req.voice : undefined;
  if (req.voice && !voice)
    warnings.push(
      `La voz "${req.voice}" no existe en ${req.model}: se usó ${model?.voices?.[0] ?? 'alloy'}.`,
    );
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.prompt.trim(),
    voice: voice ?? model?.voices?.[0] ?? 'alloy',
    response_format: 'mp3',
  };
  const style = req.style?.trim();
  if (style) {
    // Only the gpt-*-tts models read instructions; tts-1 ignores them.
    if (req.model.startsWith('tts-1')) warnings.push(`${req.model} no acepta estilo: no se envió.`);
    else body.instructions = style;
  }
  return { body, warnings };
}

async function image(
  cfg: ProviderConfig,
  req: MediaRequest,
  signal: AbortSignal,
): Promise<MediaResult> {
  const { body, warnings } = openAiImageBody(req);
  const res = await requestJson<{ data?: { b64_json?: string; url?: string }[] }>(
    { ...cfg, timeoutMs: Math.max(cfg.timeoutMs ?? 0, LONG) },
    { method: 'POST', path: '/images/generations', body, signal },
  );
  const files = [];
  for (const d of res.data ?? []) {
    if (d.b64_json)
      files.push({ data: base64ToBytes(d.b64_json), mediaType: 'image/png', ext: 'png' });
    else if (d.url) {
      const r = await request(cfg, { path: d.url, noAuth: true, signal });
      files.push({
        data: new Uint8Array(await r.arrayBuffer()),
        mediaType: 'image/png',
        ext: 'png',
      });
    }
  }
  if (!files.length)
    throw new OmniError('server', 'OpenAI no devolvió ninguna imagen', { provider: cfg.entry.id });
  return { kind: 'image', model: req.model, files, warnings };
}

async function speech(
  cfg: ProviderConfig,
  req: MediaRequest,
  signal: AbortSignal,
): Promise<MediaResult> {
  const { body, warnings } = openAiSpeechBody(req);
  const res = await request(
    { ...cfg, timeoutMs: Math.max(cfg.timeoutMs ?? 0, LONG) },
    { method: 'POST', path: '/audio/speech', body, signal, headers: { accept: 'audio/*' } },
  );
  const mediaType = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
  const data = new Uint8Array(await res.arrayBuffer());
  if (!data.length)
    throw new OmniError('server', 'OpenAI devolvió un audio vacío', { provider: cfg.entry.id });
  return {
    kind: 'speech',
    model: req.model,
    files: [{ data, mediaType, ext: extFor(mediaType, 'mp3') }],
    warnings,
  };
}

export const openAiMedia: MediaGenProvider = {
  id: 'openai',
  kinds: ['image', 'speech'],
  async generate(cfg, req, signal, onProgress) {
    onProgress?.({ stage: 'sending' });
    if (req.kind === 'image') return image(cfg, req, signal);
    if (req.kind === 'speech') return speech(cfg, req, signal);
    throw new OmniError(
      'unsupported',
      req.kind === 'video'
        ? 'OpenAI cerró su API de video (Sora) el 24 de septiembre de 2026.'
        : `OpenAI no genera ${req.kind} desde Zinarix.`,
      { provider: cfg.entry.id, retryable: false },
    );
  },
};
