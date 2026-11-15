import type { ProviderConfig } from '../types.js';

/**
 * Fase 10: media generation (image, video, speech, music) behind one interface.
 * Chat adapters stay as they are; a MediaGenProvider is a second, independent entry point for
 * the same catalog provider (same key, same base URL).
 */
export type MediaKind = 'image' | 'video' | 'speech' | 'music';
export type MediaAspect = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
export type ImageQuality = 'low' | 'medium' | 'high';

export interface MediaRequest {
  kind: MediaKind;
  /** Model id inside the provider (e.g. "gpt-image-2"). */
  model: string;
  /** What to draw / film, or the text to read aloud (speech). */
  prompt: string;
  /** Free-form style ("acuarela", "cinematográfico", "voz alegre"…). */
  style?: string;
  aspect?: MediaAspect;
  /** Video length in seconds. */
  durationSec?: number;
  seed?: number;
  /** Images per request (1–4). */
  count?: number;
  quality?: ImageQuality;
  /** Speech voice name (provider specific: "marin", "Kore"…). */
  voice?: string;
  /** PNG with transparent background, when the model supports it. */
  transparent?: boolean;
}

export interface MediaFile {
  data: Uint8Array;
  mediaType: string;
  /** File extension without the dot. */
  ext: string;
}

export interface MediaResult {
  kind: MediaKind;
  model: string;
  files: MediaFile[];
  /** Options that were not sent or were changed (shown to the user). */
  warnings: string[];
}

export interface MediaProgress {
  stage: 'sending' | 'waiting' | 'downloading';
  /** 0–100 when the provider reports it. */
  percent?: number;
}

export interface MediaGenProvider {
  /** Catalog provider id ("openai", "google-gemini"). */
  id: string;
  kinds: readonly MediaKind[];
  generate(
    cfg: ProviderConfig,
    req: MediaRequest,
    signal: AbortSignal,
    onProgress?: (p: MediaProgress) => void,
  ): Promise<MediaResult>;
}

/** Prompt with the style folded in (providers have no separate style field). */
export function styledPrompt(req: Pick<MediaRequest, 'prompt' | 'style'>): string {
  const style = req.style?.trim();
  return style ? `${req.prompt.trim()}\n\nStyle: ${style}` : req.prompt.trim();
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
};

export function extFor(mediaType: string, fallback: string): string {
  return EXT[mediaType.split(';')[0]!.trim().toLowerCase()] ?? fallback;
}
