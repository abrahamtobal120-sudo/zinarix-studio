import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmniCore } from '@omni/core';
import type { ChatMessage, ContentPart } from '@omni/shared';

/** An image pasted or dropped into the chat (base64, no data: prefix). */
export interface ChatImage {
  mediaType: string;
  data: string;
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_IMAGES = 6;
/** Base64 characters of one image (about 5 MB of bytes). */
export const MAX_IMAGE_B64 = Math.ceil((5 * 1024 * 1024 * 4) / 3) + 8;

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** What the model can do with images: send them, write them to files (CLI agents), or not. */
export type VisionMode = 'parts' | 'files' | 'none';

export function visionMode(core: OmniCore, model: string | undefined, role: 'chat' | 'agent'): VisionMode {
  try {
    const ref = core.resolveModel(model, role);
    const entry = core.provider(ref.provider);
    if (entry.adapter === 'cli-agent') return 'files';
    const live = core.models.find(ref.provider, ref.model)?.capabilities.vision;
    const cat = (entry.fallbackModels.find((m) => m.id === ref.model) as { vision?: boolean } | undefined)
      ?.vision;
    return (live ?? cat) === false ? 'none' : 'parts';
  } catch {
    return 'parts';
  }
}

/** Adds the images to a user message as content parts (text first). */
export function addImageParts(message: ChatMessage, images: ChatImage[]): ChatMessage {
  if (message.role !== 'user' || !images.length) return message;
  const parts: ContentPart[] =
    typeof message.content === 'string'
      ? message.content
        ? [{ type: 'text', text: message.content }]
        : []
      : [...message.content];
  for (const img of images) parts.push({ type: 'image', mediaType: img.mediaType, data: img.data });
  return { role: 'user', content: parts };
}

/** CLI agents (Claude Code, Codex…) read images from disk: writes them and names the files. */
export function imagesAsFiles(message: ChatMessage, images: ChatImage[]): ChatMessage {
  if (message.role !== 'user' || !images.length) return message;
  const dir = join(tmpdir(), 'zinarix-chat-images');
  mkdirSync(dir, { recursive: true });
  const paths = images.map((img, i) => {
    const p = join(
      dir,
      `${Date.now().toString(36)}-${i}.${EXT[img.mediaType] ?? 'png'}`,
    );
    writeFileSync(p, Buffer.from(img.data, 'base64'));
    return p;
  });
  const note = `The user attached ${paths.length} image(s); open them with your file/image tools:\n${paths.map((p) => `- ${p}`).join('\n')}`;
  const text = typeof message.content === 'string' ? message.content : '';
  return { role: 'user', content: text ? `${text}\n\n${note}` : note };
}

/**
 * Images of older turns are replaced by a short note, so a long chat does not resend
 * (and pay for) every screenshot on every step.
 */
export function dropOldImages(messages: ChatMessage[], keepLast = 1): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    if (!m.content.some((p) => p.type === 'image')) continue;
    if (seen++ < keepLast) continue;
    messages[i] = {
      role: 'user',
      content: m.content
        .map((p) => (p.type === 'text' ? p.text : '[image attached earlier]'))
        .join('\n'),
    };
  }
}
