import { OmniError } from '@omni/shared';
import { request, requestJson } from '../http.js';
import type { ProviderConfig } from '../types.js';
import { findMediaModel } from './catalog.js';
import { extFor, styledPrompt } from './types.js';
import type { MediaGenProvider, MediaRequest, MediaResult } from './types.js';

/**
 * Fase 10C: ElevenLabs voice, sound effects and music (key header `xi-api-key`):
 *
 *   GET  /v1/voices                                   -> { voices: [{ voice_id, name }] }
 *   POST /v1/text-to-speech/{voice_id}?output_format  { text, model_id, seed? } -> audio
 *   POST /v1/sound-generation?output_format           { text, duration_seconds? } -> audio
 *   POST /v1/music?output_format                      { prompt, music_length_ms, model_id,
 *                                                       force_instrumental? } -> audio
 *
 * Billing is in credits of the user's plan, so the catalog has no USD price for it.
 * Several speakers are generated line by line by the media service and joined with FFmpeg.
 */
export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
const FORMAT = 'mp3_44100_128';
const LONG = 10 * 60_000;

export interface ElevenVoice {
  id: string;
  name: string;
}

/** Voices of the user's account (premade and their own). */
export async function elevenVoices(cfg: ProviderConfig, signal?: AbortSignal): Promise<ElevenVoice[]> {
  const r = await requestJson<{ voices?: { voice_id?: string; name?: string }[] }>(cfg, {
    path: '/v1/voices',
    signal,
  });
  return (r.voices ?? [])
    .filter((v) => typeof v.voice_id === 'string')
    .map((v) => ({ id: v.voice_id!, name: v.name ?? v.voice_id! }));
}

/** Path and body of a request (exported for the tests). */
export function elevenRequest(
  req: MediaRequest,
  voiceId?: string,
): { path: string; body: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const model = findMediaModel('elevenlabs', req.model);
  const max = model?.maxSeconds;
  const secs = (asked: number | undefined, min: number) => {
    if (asked === undefined) return undefined;
    const v = Math.max(min, Math.min(max ?? asked, asked));
    if (v !== asked) warnings.push(`La duración va de ${min} a ${max} s: se pidió de ${v} s.`);
    return v;
  };
  if (req.kind === 'speech') {
    if (!voiceId) throw new OmniError('config', 'Falta la voz de ElevenLabs.', { provider: 'elevenlabs' });
    if (req.style?.trim())
      warnings.push('ElevenLabs no recibe el estilo por separado: escríbelo en el texto.');
    return {
      path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      body: {
        text: req.prompt.trim(),
        model_id: req.model,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
      warnings,
    };
  }
  if (req.kind === 'sound') {
    const d = secs(req.durationSec, 1);
    return {
      path: '/v1/sound-generation',
      body: { text: styledPrompt(req), ...(d !== undefined ? { duration_seconds: d } : {}) },
      warnings,
    };
  }
  if (req.kind === 'music') {
    const d = secs(req.durationSec ?? 30, 3)!;
    return {
      path: '/v1/music',
      body: {
        prompt: styledPrompt(req),
        music_length_ms: Math.round(d * 1000),
        model_id: req.model,
        ...(req.instrumental ? { force_instrumental: true } : {}),
      },
      warnings,
    };
  }
  throw new OmniError('unsupported', `ElevenLabs no genera ${req.kind} desde Zinarix.`, {
    provider: 'elevenlabs',
    retryable: false,
  });
}

export const elevenLabsMedia: MediaGenProvider = {
  id: 'elevenlabs',
  kinds: ['speech', 'sound', 'music'],
  async generate(cfg, req, signal, onProgress): Promise<MediaResult> {
    onProgress?.({ stage: 'sending' });
    let voice = req.voice?.trim();
    const warnings: string[] = [];
    if (req.kind === 'speech' && !voice) {
      const voices = await elevenVoices(cfg, signal);
      if (!voices.length)
        throw new OmniError('config', 'Tu cuenta de ElevenLabs no tiene voces.', {
          provider: cfg.entry.id,
          retryable: false,
        });
      voice = voices[0]!.id;
      warnings.push(`Se usó la voz "${voices[0]!.name}" de tu cuenta.`);
    }
    const r = elevenRequest(req, voice);
    onProgress?.({ stage: 'waiting' });
    const res = await request(
      { ...cfg, timeoutMs: Math.max(cfg.timeoutMs ?? 0, LONG) },
      {
        method: 'POST',
        path: r.path,
        query: { output_format: FORMAT },
        body: r.body,
        signal,
        headers: { accept: 'audio/*' },
      },
    );
    const mediaType = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.length)
      throw new OmniError('server', 'ElevenLabs devolvió un audio vacío', { provider: cfg.entry.id });
    return {
      kind: req.kind,
      model: req.model,
      files: [{ data, mediaType, ext: extFor(mediaType, 'mp3') }],
      warnings: [...warnings, ...r.warnings],
    };
  },
};
