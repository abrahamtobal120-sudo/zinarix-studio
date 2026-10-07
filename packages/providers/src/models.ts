import type { CatalogEntry, ModelInfo, ModelKind } from '@omni/shared';

/** Classifies a model id so non-chat models are filtered out of the chat selector. */
export function classifyModel(id: string): ModelKind {
  const s = id.toLowerCase();
  if (/embed|bge-|e5-|gte-|nomic-embed|text-similarity/.test(s)) return 'embedding';
  if (/rerank/.test(s)) return 'rerank';
  if (/moderation|guard|shield|safety/.test(s)) return 'moderation';
  if (/whisper|tts|transcri|speech|audio|voice|realtime/.test(s)) return 'audio';
  if (/dall-e|image|imagen|flux|stable-diffusion|sdxl|veo|sora|video/.test(s)) return 'image';
  return 'chat';
}

export function guessReasoning(id: string): boolean | null {
  return /reason|think|\bo[1-9]\b|o[1-9]-|r1|qwq|deepseek-reasoner|-t1|magistral/.test(
    id.toLowerCase(),
  )
    ? true
    : null;
}

export function guessVision(id: string): boolean | null {
  return /vision|-vl|vl-|llava|pixtral|gemini|gpt-4o|gpt-[5-9]|claude|-omni|multimodal/.test(
    id.toLowerCase(),
  )
    ? true
    : null;
}

/** Baseline ModelInfo from an id, then enriched with catalog data. */
export function baseModel(
  entry: CatalogEntry,
  id: string,
  extra: Partial<ModelInfo> = {},
): ModelInfo {
  const cat = entry.fallbackModels.find((m) => m.id === id);
  return {
    provider: entry.id,
    id,
    label: extra.label ?? cat?.label,
    kind: extra.kind ?? classifyModel(id),
    context: extra.context ?? cat?.context ?? null,
    maxOutput: extra.maxOutput ?? null,
    inputPrice: extra.inputPrice ?? cat?.inputPrice ?? null,
    outputPrice: extra.outputPrice ?? cat?.outputPrice ?? null,
    capabilities: {
      tools: extra.capabilities?.tools ?? cat?.tools ?? (entry.supports.tools ? null : false),
      vision:
        extra.capabilities?.vision ?? cat?.vision ?? (entry.supports.vision ? guessVision(id) : false),
      reasoning: extra.capabilities?.reasoning ?? cat?.reasoning ?? guessReasoning(id),
      fim: extra.capabilities?.fim ?? (entry.supports.fim ? null : false),
    },
    source: extra.source ?? 'live',
  };
}

export function catalogModels(entry: CatalogEntry): ModelInfo[] {
  return entry.fallbackModels.map((m) => baseModel(entry, m.id, { source: 'catalog' }));
}
