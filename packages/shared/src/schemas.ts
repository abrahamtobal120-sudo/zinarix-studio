import { z } from 'zod';

/** Families of provider APIs. Most providers are configured purely by catalog on top of these. */
export const AdapterId = z.enum([
  'openai-compatible',
  'openai-responses',
  'anthropic',
  'google-gemini',
  'google-vertex',
  'aws-bedrock',
  'azure-openai',
  'cohere',
  'huggingface',
]);
export type AdapterId = z.infer<typeof AdapterId>;

export const AuthSpec = z.object({
  type: z.enum(['bearer', 'header', 'query', 'none', 'aws-sigv4']),
  header: z.string().optional(),
  queryParam: z.string().optional(),
  /** "none" providers that still accept an optional bearer key (vLLM --api-key, etc). */
  optional: z.boolean().optional(),
});
export type AuthSpec = z.infer<typeof AuthSpec>;

export const CatalogModel = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  context: z.number().int().positive().nullable().optional(),
  /** USD per 1M input tokens. */
  inputPrice: z.number().nonnegative().nullable().optional(),
  /** USD per 1M output tokens. */
  outputPrice: z.number().nonnegative().nullable().optional(),
  tools: z.boolean().nullable().optional(),
  vision: z.boolean().nullable().optional(),
  reasoning: z.boolean().nullable().optional(),
});
export type CatalogModel = z.infer<typeof CatalogModel>;

export const Supports = z.object({
  listModels: z.boolean(),
  streaming: z.boolean(),
  tools: z.boolean(),
  vision: z.boolean(),
  jsonMode: z.boolean(),
  embeddings: z.boolean(),
  fim: z.boolean(),
});
export type Supports = z.infer<typeof Supports>;

export const CatalogEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be kebab-case'),
  name: z.string().min(1),
  adapter: AdapterId,
  baseUrl: z
    .string()
    .url()
    .or(z.string().regex(/^https?:\/\/.*\{[a-z_]+\}/)),
  baseUrlParams: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        default: z.string().optional(),
        /** May be left empty (a `{placeholder}` for it then resolves to ""). */
        optional: z.boolean().optional(),
      }),
    )
    .default([]),
  auth: AuthSpec,
  envVars: z.array(z.string()).default([]),
  extraHeaders: z.record(z.string(), z.string()).optional(),
  docsUrl: z.string().url().nullable().optional(),
  keyUrl: z.string().url().nullable().optional(),
  region: z.enum(['us', 'eu', 'cn', 'global', 'local']),
  category: z.enum(['lab', 'aggregator', 'enterprise', 'asia', 'local', 'custom']),
  modelsEndpoint: z.string().nullable(),
  supports: Supports,
  fallbackModels: z.array(CatalogModel).default([]),
  status: z.enum(['active', 'deprecated', 'unverified']),
  verifiedAt: z.string().nullable(),
  notes: z.string().optional(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const Catalog = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string(),
    providers: z.array(CatalogEntry).min(1),
  })
  .superRefine((cat, ctx) => {
    const seen = new Set<string>();
    for (const p of cat.providers) {
      if (seen.has(p.id))
        ctx.addIssue({ code: 'custom', message: `duplicate provider id ${p.id}` });
      seen.add(p.id);
    }
  });
export type Catalog = z.infer<typeof Catalog>;

export const ModelKind = z.enum([
  'chat',
  'embedding',
  'image',
  'audio',
  'moderation',
  'rerank',
  'other',
]);
export type ModelKind = z.infer<typeof ModelKind>;

export const ModelInfo = z.object({
  provider: z.string(),
  id: z.string(),
  label: z.string().optional(),
  kind: ModelKind,
  context: z.number().int().positive().nullable(),
  maxOutput: z.number().int().positive().nullable().optional(),
  inputPrice: z.number().nonnegative().nullable(),
  outputPrice: z.number().nonnegative().nullable(),
  capabilities: z.object({
    tools: z.boolean().nullable(),
    vision: z.boolean().nullable(),
    reasoning: z.boolean().nullable(),
    fim: z.boolean().nullable(),
  }),
  source: z.enum(['live', 'catalog', 'user']),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

// ---------- Chat ----------

export type ContentPart =
  { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string /* base64 */ };

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments. */
  arguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCall[];
      /**
       * Provider-native content of this turn (e.g. Anthropic thinking blocks with signatures,
       * Gemini parts with thought signatures). Replayed verbatim by the adapter that produced
       * it so multi-step tool use keeps its reasoning; ignored by every other adapter.
       */
      raw?: { adapter: string; content: unknown };
    }
  | { role: 'tool'; toolCallId: string; name?: string; content: string; isError?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the model to reason more (maps to effort / reasoning params where supported). */
  reasoning?: 'low' | 'medium' | 'high';
  jsonMode?: boolean;
}

export interface FimRequest {
  model: string;
  prefix: string;
  suffix: string;
  maxTokens?: number;
}

export interface EmbedRequest {
  model: string;
  input: string[];
}

export type ChatChunk =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; id: string; name: string; argsDelta: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'raw'; adapter: string; content: unknown }
  | { type: 'done'; stopReason: string };
