import type { ToolDefinition } from '@omni/shared';
import { formatEstimate, GEN_ASPECTS } from '../shared/mediaGen.js';
import type { GenKind, GenModelView, GenRequest } from '../shared/mediaGen.js';
import type { MediaService } from './media.js';
import type { SystemPreview } from './system.js';

/**
 * Fase 10: agent tools that generate media. Each call spends money on the user's provider
 * account, so every one is approved with its estimated cost (no "always").
 */
const MODEL_ARG = {
  type: 'string',
  description:
    'Optional "provider/model" (e.g. "openai/gpt-image-2"). Omit it to use the first connected model of that kind.',
};

export const MEDIA_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_image',
    description:
      "Generate images from a description with a connected image model and save them to media/generated in the project. Costs money on the user's provider account: the user approves each call after seeing the estimated cost. Returns the file paths.",
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the image shows' },
        style: {
          type: 'string',
          description: 'Visual style (watercolor, photo, flat illustration…)',
        },
        aspect: { type: 'string', enum: [...GEN_ASPECTS] },
        count: { type: 'integer', minimum: 1, maximum: 4 },
        quality: { type: 'string', enum: ['low', 'medium', 'high'] },
        model: MODEL_ARG,
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a short video clip from a description with a connected video model and save it to media/generated. Costs money; approved with the estimated cost. Returns the file path.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Shot, subject, action, setting and lighting' },
        style: { type: 'string' },
        aspect: { type: 'string', enum: ['16:9', '9:16'] },
        duration: { type: 'integer', minimum: 1, maximum: 60, description: 'Seconds' },
        model: MODEL_ARG,
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_speech',
    description:
      'Turn text into spoken audio (voice-over) with a connected text-to-speech model and save it to media/generated. Costs money; approved with the estimated cost. Returns the file path.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Exactly what the voice says' },
        voice: { type: 'string', description: 'Voice name of the model (optional)' },
        style: { type: 'string', description: 'How to say it (calm, excited, whispering…)' },
        model: MODEL_ARG,
      },
      required: ['text'],
    },
  },
];

export const MEDIA_TOOL_NAMES = new Set(MEDIA_TOOLS.map((t) => t.name));

export const MEDIA_PROMPT_PART =
  '- generate_image, generate_video and generate_speech: create media with the models the user connected. Each call costs money and needs approval with its estimated cost, so ask for exactly what is needed (one image unless more are useful). Files land in media/generated; tell the user the paths.';

const KIND: Record<string, GenKind> = {
  generate_image: 'image',
  generate_video: 'video',
  generate_speech: 'speech',
};

const text = (a: Record<string, unknown>, k: string) =>
  typeof a[k] === 'string' ? (a[k] as string).trim() : '';
const int = (a: Record<string, unknown>, k: string) =>
  typeof a[k] === 'number' && Number.isFinite(a[k]) ? Math.round(a[k] as number) : undefined;

/** The request a tool call stands for, with the model picked (or an error for the model). */
export async function mediaRequest(
  media: MediaService,
  name: string,
  a: Record<string, unknown>,
): Promise<{ req: GenRequest; model: GenModelView } | { error: string }> {
  const kind = KIND[name];
  if (!kind) return { error: `Unknown media tool ${name}` };
  const models = (await media.models()).filter((m) => m.kind === kind);
  const asked = text(a, 'model');
  let model: GenModelView | undefined;
  if (asked) {
    const [provider, ...rest] = asked.split('/');
    model = models.find((m) => m.provider === provider && m.id === rest.join('/'));
    if (!model)
      return {
        error: `"${asked}" is not a ${kind} model in Zinarix. Available: ${models.map((m) => `${m.provider}/${m.id}`).join(', ')}.`,
      };
  } else {
    // Connected first, then with a published price (so the user sees a real cost).
    model = models.find((m) => m.connected && m.priced) ?? models.find((m) => m.connected);
    if (!model)
      return {
        error: `No ${kind} model is connected. Ask the user to connect ${[...new Set(models.map((m) => m.providerName))].join(' or ')} in Settings → Providers.`,
      };
  }
  const aspect = text(a, 'aspect');
  const quality = text(a, 'quality');
  const req: GenRequest = {
    kind,
    provider: model.provider,
    model: model.id,
    prompt: kind === 'speech' ? text(a, 'text') : text(a, 'prompt'),
    ...(text(a, 'style') ? { style: text(a, 'style') } : {}),
    ...((GEN_ASPECTS as readonly string[]).includes(aspect)
      ? { aspect: aspect as GenRequest['aspect'] }
      : {}),
    ...(int(a, 'count') ? { count: Math.max(1, Math.min(4, int(a, 'count')!)) } : {}),
    ...(['low', 'medium', 'high'].includes(quality)
      ? { quality: quality as GenRequest['quality'] }
      : {}),
    ...(int(a, 'duration') ? { durationSec: int(a, 'duration') } : {}),
    ...(text(a, 'voice') ? { voice: text(a, 'voice') } : {}),
  };
  return { req, model };
}

const WHAT: Record<GenKind, (n: number) => string> = {
  image: (n) => (n > 1 ? `${n} imágenes` : 'una imagen'),
  video: () => 'un video',
  speech: () => 'una voz en off',
  music: () => 'música',
  sound: () => 'un efecto de sonido',
};

/** Approval card: what will be generated, with which model and how much it costs. */
export async function mediaPreview(
  media: MediaService,
  name: string,
  a: Record<string, unknown>,
): Promise<SystemPreview> {
  const r = await mediaRequest(media, name, a);
  if ('error' in r) return { risk: 'medium', warning: r.error, action: `generar (${name})` };
  const { req, model } = r;
  const est = media.estimate(req);
  const cost = formatEstimate(est);
  return {
    risk: 'medium',
    action: `generar ${WHAT[req.kind](req.count ?? 1)} con ${model.providerName} · ${model.label}`,
    warning:
      est.usd === null
        ? `${model.providerName} no publica un precio por unidad para ${model.label}: no se puede estimar el costo. Se cobrará a tu cuenta de ${model.providerName}.`
        : `Costo estimado: ${cost} (${est.detail}). Se cobra a tu cuenta de ${model.providerName}. El archivo se guarda en media/generated.`,
    command: req.prompt,
  };
}

export async function runMediaTool(
  media: MediaService,
  name: string,
  a: Record<string, unknown>,
  workspaceRoot: string | undefined,
  signal: AbortSignal,
  callId: string,
): Promise<{ ok: boolean; content: string; summary: string }> {
  const r = await mediaRequest(media, name, a);
  if ('error' in r) return { ok: false, content: r.error, summary: 'modelo no disponible' };
  try {
    const res = await media.generate(`agent:${callId}`, r.req, workspaceRoot, undefined, signal);
    const lines = [
      `Generated with ${r.model.provider}/${r.model.id} in ${(res.ms / 1000).toFixed(1)} s.`,
      `Estimated cost: ${formatEstimate(res.estimate, 'en')}.`,
      'Files:',
      ...res.paths.map((p) => `- ${p}`),
      ...(res.warnings.length ? ['Notes:', ...res.warnings.map((w) => `- ${w}`)] : []),
    ];
    return {
      ok: true,
      content: lines.join('\n'),
      summary: `${res.paths.length} archivo(s) · ${formatEstimate(res.estimate)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, content: `Generation failed: ${msg}`, summary: 'falló' };
  }
}
