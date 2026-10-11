import { OmniError } from '@omni/shared';
import type { AdapterId } from '@omni/shared';
import { anthropic } from './adapters/anthropic.js';
import { cliAgent } from './adapters/cli-agent.js';
import { googleGemini } from './adapters/google-gemini.js';
import { googleVertex } from './adapters/google-vertex.js';
import { openAiCompatible } from './adapters/openai-compatible.js';
import { openAiResponses } from './adapters/openai-responses.js';
import type { ProviderAdapter } from './types.js';

export * from './types.js';
export * from './http.js';
export * from './sse.js';
export * from './models.js';
export { openAiCompatible, toOpenAiMessages, normalizeStop } from './adapters/openai-compatible.js';
export { openAiResponses, toResponsesInput } from './adapters/openai-responses.js';
export { anthropic, toAnthropic } from './adapters/anthropic.js';
export {
  cliAgent,
  cliPrompt,
  cliMode,
  findExecutable,
  CliStreamParser,
} from './adapters/cli-agent.js';
export type { CliMode } from './adapters/cli-agent.js';
export {
  googleGemini,
  toGemini,
  toGeminiSchema,
  geminiBody,
  readGeminiStream,
} from './adapters/google-gemini.js';
export {
  googleVertex,
  parseVertexCredential,
  vertexUrl,
  vertexHost,
  vertexModelId,
  vertexAccessToken,
  resolveVertexAuth,
  serviceAccountAssertion,
  clearVertexTokenCache,
} from './adapters/google-vertex.js';
export type { VertexCredential, VertexUrlOptions } from './adapters/google-vertex.js';

/**
 * Adapter registry. Azure OpenAI (v1 API), Cohere (compatibility API) and Hugging Face
 * (router) all speak the OpenAI wire format, so they reuse that adapter and differ only
 * in their catalog entry (base URL, auth header). cli-agent runs coding-agent CLIs (Claude
 * Code, Codex, Gemini CLI…) installed on the machine instead of calling an API. aws-bedrock needs SigV4 / Converse and
 * lands in Phase 3.
 */
const ADAPTERS: Partial<Record<AdapterId, ProviderAdapter>> = {
  'openai-compatible': openAiCompatible,
  'openai-responses': openAiResponses,
  anthropic,
  'google-gemini': googleGemini,
  'google-vertex': googleVertex,
  'azure-openai': openAiCompatible,
  cohere: openAiCompatible,
  huggingface: openAiCompatible,
  'cli-agent': cliAgent,
};

export function getAdapter(id: AdapterId): ProviderAdapter {
  const a = ADAPTERS[id];
  if (!a)
    throw new OmniError(
      'unsupported',
      `adapter "${id}" is not implemented yet (planned for Phase 3)`,
    );
  return a;
}

export function isAdapterImplemented(id: AdapterId): boolean {
  return id in ADAPTERS;
}
