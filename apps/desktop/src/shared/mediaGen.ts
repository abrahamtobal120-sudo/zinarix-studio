/**
 * Fase 10: media generation, the part shared by main, the renderer and the agent tools.
 * Pure (no Node, no DOM) so it is tested with Vitest.
 */
export type GenKind = 'image' | 'video' | 'speech' | 'music' | 'sound';
export type GenAspect = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
export type GenQuality = 'low' | 'medium' | 'high';

export interface GenRequest {
  kind: GenKind;
  provider: string;
  model: string;
  prompt: string;
  style?: string;
  aspect?: GenAspect;
  durationSec?: number;
  seed?: number;
  count?: number;
  quality?: GenQuality;
  voice?: string;
  transparent?: boolean;
  /** Fase 10C: a script "Ana: …" with one voice per speaker. */
  speakers?: GenSpeaker[];
  /** Fase 10C: music without singing. */
  instrumental?: boolean;
  /** Fase 10D: a library image as first frame (video) or style reference. */
  referencePath?: string;
  referenceRole?: 'first_frame' | 'style';
  /** Fase 10D: the image to edit, and an optional mask PNG (transparent = change it). */
  editPath?: string;
  maskPath?: string;
}

export interface GenSpeaker {
  name: string;
  voice: string;
}

/** One model as the Generate panel sees it. */
export interface GenModelView {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  kind: GenKind;
  /** The provider has a key in Zinarix. */
  connected: boolean;
  /** A unit price is published (otherwise the cost shows as unknown). */
  priced: boolean;
  aspects?: GenAspect[];
  duration?: { min: number; max: number; default: number };
  voices?: string[];
  maxCount?: number;
  qualities?: GenQuality[];
  transparent?: boolean;
  note?: string;
  /** Fase 10C: runs on this machine (0 USD, no internet). */
  local?: boolean;
  /** Fase 10C: listed but not usable, with the reason. */
  unavailable?: string;
  /** Fase 10C: local server state ("no responde en http://127.0.0.1:8188"). */
  status?: string;
  multiSpeaker?: boolean;
  /** Fase 10D. */
  reference?: ('first_frame' | 'style')[];
  edit?: boolean;
  mask?: boolean;
  /** Mark the provider leaves in the file (SynthID, C2PA). */
  watermark?: string;
  /** Accepts a seed (otherwise the seed is only recorded). */
  seed?: boolean;
  maxSeconds?: number;
  source: string;
  verifiedAt: string;
}

export interface GenEstimate {
  usd: number | null;
  approximate: boolean;
  detail: string;
}

export interface GenResult {
  /** Absolute paths of the saved files. */
  paths: string[];
  warnings: string[];
  estimate: GenEstimate;
  ms: number;
  /** Fase 10D: the .gen.json written next to each file. */
  sidecars?: string[];
  /** Seed recorded for the files (null = the model takes none). */
  seed?: number | null;
}

export type GenEvent =
  | { type: 'progress'; stage: 'sending' | 'waiting' | 'downloading'; percent?: number }
  | { type: 'done'; result: GenResult }
  | { type: 'error'; message: string };

export const GEN_KINDS: readonly GenKind[] = ['image', 'video', 'speech', 'music', 'sound'];
export const GEN_ASPECTS: readonly GenAspect[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
export const MAX_PROMPT = 20_000;

/** "Un faro en la tormenta" → "un-faro-en-la-tormenta" (ASCII, 40 chars at most). */
export function slugify(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'medio';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** image-20261115-170412-un-faro-2.png — sortable, unique per second and index. */
export function genFileName(
  kind: GenKind,
  prompt: string,
  ext: string,
  index: number,
  at: Date,
): string {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin';
  return `${kind}-${stamp}-${slugify(prompt)}${index > 0 ? `-${index + 1}` : ''}.${safeExt}`;
}

/** Problems that make a request impossible, before spending anything (null = fine). */
export function genRequestIssue(req: GenRequest, model: GenModelView | undefined): string | null {
  if (!model) return `El modelo ${req.provider}/${req.model} no genera medios en Zinarix.`;
  if (model.kind !== req.kind) return `${model.label} genera ${model.kind}, no ${req.kind}.`;
  if (model.unavailable) return model.unavailable;
  if (!model.connected)
    return model.local
      ? `${model.label}: ${model.status ?? 'no está disponible'}. Ábrelo o revisa la dirección en Ajustes → IA → Generación.`
      : model.provider === 'elevenlabs'
        ? 'Agrega tu clave de ElevenLabs en Ajustes → IA → Generación.'
        : `Conecta ${model.providerName} (Ajustes → Proveedores) para usar ${model.label}.`;
  if (!req.prompt.trim())
    return req.kind === 'speech'
      ? 'Escribe el texto que se va a leer.'
      : 'Describe lo que quieres generar.';
  if (req.prompt.length > MAX_PROMPT) return `El texto pasa de ${MAX_PROMPT} caracteres.`;
  return null;
}

/** "$0.106", "~$0.0012", "costo no estimado" — for buttons and approvals. */
export function formatEstimate(e: GenEstimate, lang: 'es' | 'en' = 'es'): string {
  if (e.usd === null) return lang === 'en' ? 'cost not estimated' : 'costo no estimado';
  if (e.usd === 0) return lang === 'en' ? '$0 (local)' : '0 USD (local)';
  const n = e.usd < 0.01 ? e.usd.toFixed(4) : e.usd.toFixed(3);
  return `${e.approximate ? '~' : ''}$${n}`;
}

// ---------------------------------------------------------------- Fase 10B–10D

/** What a generated file was made with (`<file>.gen.json`): enough to repeat it or vary it. */
export interface GenSidecar {
  version: 1;
  kind: GenKind;
  provider: string;
  model: string;
  prompt: string;
  style?: string;
  /** The seed sent (or only recorded when the model takes none: `seedSent` false). */
  seed: number | null;
  seedSent: boolean;
  /** Every other option of the request (aspect, voice, speakers, reference…). */
  options: Omit<GenRequest, 'kind' | 'provider' | 'model' | 'prompt' | 'style' | 'seed'>;
  /** Estimated cost in USD (null = not estimated) and how it was computed. */
  usd: number | null;
  costDetail: string;
  /** ISO date. */
  at: string;
  /** Always true: what the library shows as "generado con IA". */
  aiGenerated: true;
  watermark?: string;
  /** The file this one varies or repeats. */
  from?: string;
}

/** One line of `<userData>/media-spend.jsonl`. */
export interface GenSpendEntry {
  at: string;
  kind: GenKind;
  provider: string;
  model: string;
  /** "2 × $0.053", "1200 caracteres × $15 / 1M". */
  units: string;
  usd: number | null;
  conversationId?: string;
  paths: string[];
  prompt: string;
}

/** Spending caps and local servers (Settings → AI → Generation). */
export interface GenSettings {
  /** USD per agent conversation (0 = every generation asks again). */
  capConversationUsd: number;
  capDayUsd: number;
  comfyUrl: string;
  a1111Url: string;
  localSpeechUrl: string;
  localSpeechModel: string;
  /** Piper executable ('' = look on PATH). */
  piperPath: string;
}

export const DEFAULT_GEN_SETTINGS: GenSettings = {
  capConversationUsd: 2,
  capDayUsd: 10,
  comfyUrl: 'http://127.0.0.1:8188',
  a1111Url: 'http://127.0.0.1:7860',
  localSpeechUrl: 'http://127.0.0.1:8880/v1',
  localSpeechModel: 'kokoro',
  piperPath: '',
};

/** What the Generate panel shows next to the button. */
export interface GenSpendView {
  todayUsd: number;
  /** Generations today whose cost could not be estimated. */
  todayUnknown: number;
  settings: GenSettings;
  elevenLabsKey: boolean;
}

export interface GenHistoryEntry extends GenSpendEntry {
  /** The request to reuse (from the .gen.json of the first file, when it is still there). */
  req: GenRequest | null;
}

/** A new random seed (31 bits, what every local server accepts). */
export function newSeed(rand: () => number = Math.random): number {
  return Math.floor(rand() * 2 ** 31);
}

/** The request a sidecar stands for: the same ("repeat") or with another seed ("variation"). */
export function reuseRequest(
  side: GenSidecar,
  mode: 'repeat' | 'variation',
  rand: () => number = Math.random,
): GenRequest {
  let seed = side.seed ?? undefined;
  if (mode === 'variation') {
    let next = newSeed(rand);
    for (let i = 0; next === seed && i < 5; i++) next = newSeed(rand);
    seed = next;
  }
  return {
    ...side.options,
    kind: side.kind,
    provider: side.provider,
    model: side.model,
    prompt: side.prompt,
    ...(side.style ? { style: side.style } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };
}

export type GenErrorKind = 'quota' | 'refused' | 'access' | 'auth' | 'network' | 'other';

/**
 * Fase 10D: a provider error in words the user can act on. Nothing is charged for a failed
 * call (the spend log only records successes) and POSTs are never retried automatically.
 */
export function genErrorKind(message: string): GenErrorKind {
  const m = message.toLowerCase();
  if (/\b(429|quota|insufficient_quota|rate.?limit|resource.?exhausted|credits?|billing)\b/.test(m))
    return 'quota';
  if (/(safety|moderation|content.?policy|blocked|refus|prohibited|violat)/.test(m))
    return 'refused';
  if (/\b(403|404)\b|not have access|model.*not.*found|not.*found.*model|permission/.test(m))
    return 'access';
  if (/\b401\b|invalid.*(key|api)|unauthori[sz]ed|authentication/.test(m)) return 'auth';
  if (/network|econnrefused|enotfound|timeout|no responde/.test(m)) return 'network';
  return 'other';
}

const ERR_TEXT: Record<GenErrorKind, { es: string; en: string }> = {
  quota: {
    es: 'Se acabó la cuota o el saldo de tu cuenta del proveedor. Esta generación no se cobró; revisa tu plan e inténtalo más tarde.',
    en: 'Your provider quota or balance ran out. This generation was not charged; check your plan and try again later.',
  },
  refused: {
    es: 'El proveedor rechazó el contenido por sus normas. Cambia la descripción; no se cobró.',
    en: 'The provider refused the content under its policies. Change the description; it was not charged.',
  },
  access: {
    es: 'Tu clave no tiene acceso a este modelo. Elige otro o habilítalo en la cuenta del proveedor.',
    en: 'Your key has no access to this model. Pick another one or enable it in the provider account.',
  },
  auth: {
    es: 'La clave no es válida o caducó. Cámbiala en Ajustes.',
    en: 'The key is not valid or expired. Change it in Settings.',
  },
  network: {
    es: 'No hubo conexión con el proveedor. No se cobró; inténtalo de nuevo.',
    en: 'Could not reach the provider. It was not charged; try again.',
  },
  other: { es: '', en: '' },
};

/** "Se acabó la cuota… (HTTP 429: …)": the clear message first, the provider's own after it. */
export function genErrorText(message: string, lang: 'es' | 'en' = 'es'): string {
  const head = ERR_TEXT[genErrorKind(message)][lang];
  return head ? `${head} (${message})` : message;
}
