import type { ContentPart } from '@omni/shared';

type FilePart = Extract<ContentPart, { type: 'file' }>;

/** Text that stands in for an attachment the provider can't take natively. */
export function unsupportedPart(p: FilePart, provider: string): string {
  return `[Adjunto no enviado: ${p.name ?? 'archivo'} (${p.mediaType}) — ${provider} no acepta este tipo de archivo]`;
}

export const isPdf = (p: FilePart): boolean => p.mediaType === 'application/pdf';

/** Plain-text attachments (txt, md, csv, json…) are inlined as text by every adapter. */
export function isTextual(p: FilePart): boolean {
  return /^text\//.test(p.mediaType) || /^application\/(json|xml|x-yaml|yaml)$/.test(p.mediaType);
}

export function decodeText(p: FilePart): string {
  return `<attachment name="${(p.name ?? 'file').replace(/"/g, "'")}">\n${Buffer.from(p.data, 'base64').toString('utf8')}\n</attachment>`;
}

/** OpenAI `input_audio` formats by MIME type. */
export function audioFormat(mediaType: string): 'wav' | 'mp3' | null {
  if (/^audio\/(wav|x-wav|wave)$/.test(mediaType)) return 'wav';
  if (/^audio\/(mpeg|mp3)$/.test(mediaType)) return 'mp3';
  return null;
}

/** A schema name every provider accepts: [a-zA-Z0-9_-], 1–64 chars. */
export function schemaName(name: string): string {
  const n = name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64);
  return n || 'response';
}
