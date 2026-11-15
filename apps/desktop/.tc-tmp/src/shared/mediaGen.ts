/**
 * Fase 10: media generation, the part shared by main, the renderer and the agent tools.
 * Pure (no Node, no DOM) so it is tested with Vitest.
 */
export type GenKind = 'image' | 'video' | 'speech' | 'music';
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
}

export type GenEvent =
  | { type: 'progress'; stage: 'sending' | 'waiting' | 'downloading'; percent?: number }
  | { type: 'done'; result: GenResult }
  | { type: 'error'; message: string };

export const GEN_KINDS: readonly GenKind[] = ['image', 'video', 'speech', 'music'];
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
  if (!model.connected)
    return `Conecta ${model.providerName} (Ajustes → Proveedores) para usar ${model.label}.`;
  if (!req.prompt.trim())
    return req.kind === 'speech'
      ? 'Escribe el texto que se va a leer.'
      : 'Describe lo que quieres generar.';
  if (req.prompt.length > MAX_PROMPT) return `El texto pasa de ${MAX_PROMPT} caracteres.`;
  return null;
}

/** "$0.106", "~$0.0012", "precio no publicado" — for buttons and approvals. */
export function formatEstimate(e: GenEstimate, lang: 'es' | 'en' = 'es'): string {
  if (e.usd === null) return lang === 'en' ? 'price not published' : 'precio no publicado';
  const n = e.usd < 0.01 ? e.usd.toFixed(4) : e.usd.toFixed(3);
  return `${e.approximate ? '~' : ''}$${n}`;
}
