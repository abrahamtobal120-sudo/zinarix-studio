import type { ImageQuality, MediaAspect, MediaKind, MediaRequest } from './types.js';

/**
 * Media models and their unit prices. This lives here and not in catalog/providers.json
 * because that file is signed (Ed25519) and its schema has token prices only.
 *
 * `price: null` means the provider does not publish a unit price we could check; the cost is
 * then shown as unknown, never guessed. Every entry records where the price was read and when.
 */
export type MediaPrice =
  | { per: 'image'; usd: number }
  /** Per image by quality, for square (1024×1024) and non-square (1536×1024 / 1024×1536). */
  | { per: 'image_quality'; usd: Record<ImageQuality, { square: number; other: number }> }
  | { per: 'second'; usd: number }
  | { per: 'million_chars'; usd: number }
  /** Speech billed by output audio tokens; the length is estimated from the text. */
  | { per: 'million_audio_tokens'; usd: number; tokensPerSecond: number }
  | { per: 'song'; usd: number };

export interface MediaModel {
  provider: string;
  id: string;
  label: string;
  kind: MediaKind;
  price: MediaPrice | null;
  aspects?: readonly MediaAspect[];
  /** Allowed video length, whole seconds. */
  duration?: { min: number; max: number; default: number };
  voices?: readonly string[];
  maxCount?: number;
  qualities?: readonly ImageQuality[];
  transparent?: boolean;
  seed?: boolean;
  /** Free text shown next to the model (shutdown dates, price changes). */
  note?: string;
  verifiedAt: string;
  source: string;
}

const OPENAI_IMAGES = 'https://developers.openai.com/api/docs/guides/image-generation';
const OPENAI_PRICING = 'https://developers.openai.com/api/docs/pricing';
const OPENAI_TTS = 'https://developers.openai.com/api/docs/guides/text-to-speech';
const GOOGLE_PRICING = 'https://aistudio.google.com/docs/pricing';
const GOOGLE_OMNI = 'https://aistudio.google.com/docs/omni';
const CHECKED = '2026-11-15';

const OPENAI_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;
const TTS1_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'] as const;
const GEMINI_VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir', 'Leda', 'Aoede', 'Algieba'] as const;
const ALL_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
const QUALITIES = ['low', 'medium', 'high'] as const;

function q(
  low: [number, number],
  medium: [number, number],
  high: [number, number],
): MediaPrice {
  const p = ([square, other]: [number, number]) => ({ square, other });
  return { per: 'image_quality', usd: { low: p(low), medium: p(medium), high: p(high) } };
}

export const MEDIA_MODELS: readonly MediaModel[] = [
  // ---- OpenAI: images ----
  {
    provider: 'openai',
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    kind: 'image',
    price: q([0.006, 0.005], [0.053, 0.041], [0.211, 0.165]),
    aspects: ALL_ASPECTS,
    maxCount: 4,
    qualities: QUALITIES,
    verifiedAt: CHECKED,
    source: OPENAI_IMAGES,
  },
  {
    provider: 'openai',
    id: 'gpt-image-1.5',
    label: 'GPT Image 1.5',
    kind: 'image',
    price: q([0.009, 0.013], [0.034, 0.05], [0.133, 0.2]),
    aspects: ALL_ASPECTS,
    maxCount: 4,
    qualities: QUALITIES,
    verifiedAt: CHECKED,
    source: OPENAI_IMAGES,
  },
  {
    provider: 'openai',
    id: 'gpt-image-1-mini',
    label: 'GPT Image 1 mini',
    kind: 'image',
    price: q([0.005, 0.006], [0.011, 0.015], [0.036, 0.052]),
    aspects: ALL_ASPECTS,
    maxCount: 4,
    qualities: QUALITIES,
    verifiedAt: CHECKED,
    source: OPENAI_IMAGES,
  },
  {
    provider: 'openai',
    id: 'gpt-image-2.6-flare',
    label: 'GPT Image 2.6 Flare',
    kind: 'image',
    // Billed per output token ($30 / 1M); OpenAI publishes no per-image figure.
    price: null,
    aspects: ALL_ASPECTS,
    maxCount: 4,
    qualities: QUALITIES,
    transparent: true,
    verifiedAt: CHECKED,
    source: OPENAI_IMAGES,
  },
  // ---- OpenAI: speech ----
  {
    provider: 'openai',
    id: 'gpt-4o-mini-tts',
    label: 'GPT-4o mini TTS',
    kind: 'speech',
    price: null,
    voices: OPENAI_VOICES,
    note: 'OpenAI lo cierra el 6 de enero de 2027.',
    verifiedAt: CHECKED,
    source: OPENAI_TTS,
  },
  {
    provider: 'openai',
    id: 'tts-1-hd',
    label: 'TTS-1 HD',
    kind: 'speech',
    price: { per: 'million_chars', usd: 30 },
    voices: TTS1_VOICES,
    verifiedAt: CHECKED,
    source: OPENAI_PRICING,
  },
  {
    provider: 'openai',
    id: 'tts-1',
    label: 'TTS-1',
    kind: 'speech',
    price: { per: 'million_chars', usd: 15 },
    voices: TTS1_VOICES,
    verifiedAt: CHECKED,
    source: OPENAI_PRICING,
  },
  // ---- Google Gemini: images (Interactions API) ----
  {
    provider: 'google-gemini',
    id: 'gemini-nano-banana-2.1',
    label: 'Nano Banana 2.1',
    kind: 'image',
    price: { per: 'image', usd: 0.034 },
    aspects: ALL_ASPECTS,
    maxCount: 4,
    verifiedAt: CHECKED,
    source: GOOGLE_PRICING,
  },
  {
    provider: 'google-gemini',
    id: 'gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    kind: 'image',
    price: { per: 'image', usd: 0.067 },
    aspects: ALL_ASPECTS,
    maxCount: 4,
    verifiedAt: CHECKED,
    source: GOOGLE_PRICING,
  },
  {
    provider: 'google-gemini',
    id: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    kind: 'image',
    price: { per: 'image', usd: 0.134 },
    aspects: ALL_ASPECTS,
    maxCount: 4,
    verifiedAt: CHECKED,
    source: GOOGLE_PRICING,
  },
  // ---- Google Gemini: speech ----
  {
    provider: 'google-gemini',
    id: 'gemini-3.8-flash-tts',
    label: 'Gemini 3.8 Flash TTS',
    kind: 'speech',
    price: { per: 'million_audio_tokens', usd: 9, tokensPerSecond: 32 },
    voices: GEMINI_VOICES,
    note: 'Google sube el precio a $18 / 1M tokens el 1 de enero de 2027.',
    verifiedAt: CHECKED,
    source: GOOGLE_PRICING,
  },
  {
    provider: 'google-gemini',
    id: 'gemini-3.8-flash-lite-tts',
    label: 'Gemini 3.8 Flash Lite TTS',
    kind: 'speech',
    price: { per: 'million_audio_tokens', usd: 6, tokensPerSecond: 32 },
    voices: GEMINI_VOICES,
    note: 'Google sube el precio a $12 / 1M tokens el 1 de enero de 2027.',
    verifiedAt: CHECKED,
    source: GOOGLE_PRICING,
  },
  // ---- Google Gemini: video ----
  {
    provider: 'google-gemini',
    id: 'gemini-omni-1.2-flash',
    label: 'Gemini Omni 1.2 Flash',
    kind: 'video',
    price: null,
    aspects: ['16:9', '9:16'],
    duration: { min: 3, max: 15, default: 5 },
    verifiedAt: CHECKED,
    source: GOOGLE_OMNI,
  },
];

export function mediaModels(kind?: MediaKind, provider?: string): MediaModel[] {
  return MEDIA_MODELS.filter(
    (m) => (!kind || m.kind === kind) && (!provider || m.provider === provider),
  );
}

export function findMediaModel(provider: string, id: string): MediaModel | undefined {
  return MEDIA_MODELS.find((m) => m.provider === provider && m.id === id);
}

/** Spoken length of a text, in seconds (about 15 characters per second). */
export function speechSeconds(text: string): number {
  return Math.max(1, Math.round(text.trim().length / 15));
}

export interface MediaCostEstimate {
  /** null when the provider publishes no unit price for this model. */
  usd: number | null;
  /** True when the figure depends on a guess (speech length). */
  approximate: boolean;
  /** "3 imágenes × $0.053", for the approval dialog. */
  detail: string;
}

const money = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3).replace(/0$/, '')}`;

/** Cost before generating. Pure: the approval dialog and the agent tools both call it. */
export function estimateMediaCost(
  model: MediaModel | undefined,
  req: Pick<MediaRequest, 'prompt' | 'count' | 'quality' | 'aspect' | 'durationSec'>,
): MediaCostEstimate {
  const p = model?.price;
  if (!model || !p) return { usd: null, approximate: false, detail: 'precio no publicado' };
  const count = Math.max(1, Math.min(model.maxCount ?? 1, req.count ?? 1));
  switch (p.per) {
    case 'image':
      return { usd: p.usd * count, approximate: false, detail: `${count} × ${money(p.usd)}` };
    case 'image_quality': {
      const quality = req.quality ?? 'medium';
      const square = (req.aspect ?? '1:1') === '1:1';
      const each = p.usd[quality][square ? 'square' : 'other'];
      return {
        usd: each * count,
        approximate: false,
        detail: `${count} × ${money(each)} (${quality})`,
      };
    }
    case 'second': {
      const secs = req.durationSec ?? model.duration?.default ?? 5;
      return { usd: p.usd * secs, approximate: false, detail: `${secs} s × ${money(p.usd)}` };
    }
    case 'million_chars': {
      const chars = req.prompt.length;
      return {
        usd: (p.usd * chars) / 1e6,
        approximate: false,
        detail: `${chars} caracteres × $${p.usd} / 1M`,
      };
    }
    case 'million_audio_tokens': {
      const secs = speechSeconds(req.prompt);
      return {
        usd: (p.usd * secs * p.tokensPerSecond) / 1e6,
        approximate: true,
        detail: `~${secs} s de audio × ${p.tokensPerSecond} tokens/s × $${p.usd} / 1M`,
      };
    }
    case 'song':
      return { usd: p.usd, approximate: false, detail: `1 canción × ${money(p.usd)}` };
  }
}
