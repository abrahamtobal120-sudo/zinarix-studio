import { OmniError } from '@omni/shared';
import { elevenLabsMedia } from './elevenlabs.js';
import { geminiMedia } from './gemini.js';
import { a1111Media, comfyMedia, localSpeechMedia } from './local.js';
import { openAiMedia } from './openai.js';
import type { MediaGenProvider } from './types.js';

export * from './types.js';
export * from './catalog.js';
export { openAiMedia, openAiImageBody, openAiSpeechBody, openAiEditForm } from './openai.js';
export { ELEVENLABS_BASE_URL, elevenLabsMedia, elevenRequest, elevenVoices } from './elevenlabs.js';
export type { ElevenVoice } from './elevenlabs.js';
export {
  LOCAL_DEFAULTS,
  LOCAL_SIZE,
  a1111Body,
  a1111Media,
  comfyCheckpoint,
  comfyGraph,
  comfyMedia,
  localSpeechBody,
  localSpeechMedia,
  probeLocal,
  seedFor,
} from './local.js';
export type { LocalStatus } from './local.js';
export { geminiMedia, geminiMediaBody, findOutputs, fileId } from './gemini.js';

/** Media providers by catalog provider id (same key and base URL as the chat adapter). */
const MEDIA: Record<string, MediaGenProvider> = {
  openai: openAiMedia,
  'google-gemini': geminiMedia,
  elevenlabs: elevenLabsMedia,
  comfyui: comfyMedia,
  a1111: a1111Media,
  'local-speech': localSpeechMedia,
};

export function getMediaProvider(providerId: string): MediaGenProvider {
  const p = MEDIA[providerId];
  if (!p)
    throw new OmniError('unsupported', `${providerId} no genera medios desde Zinarix`, {
      provider: providerId,
      retryable: false,
    });
  return p;
}

export function mediaProviderIds(): string[] {
  return Object.keys(MEDIA);
}
