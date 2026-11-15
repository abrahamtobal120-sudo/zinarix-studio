import { OmniError } from '@omni/shared';
import { geminiMedia } from './gemini.js';
import { openAiMedia } from './openai.js';
import type { MediaGenProvider } from './types.js';

export * from './types.js';
export * from './catalog.js';
export { openAiMedia, openAiImageBody, openAiSpeechBody } from './openai.js';
export { geminiMedia, geminiMediaBody, findOutputs, fileId } from './gemini.js';

/** Media providers by catalog provider id (same key and base URL as the chat adapter). */
const MEDIA: Record<string, MediaGenProvider> = {
  openai: openAiMedia,
  'google-gemini': geminiMedia,
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
