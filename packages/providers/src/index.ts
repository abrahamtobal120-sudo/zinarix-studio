import { OmniError } from '@omni/shared';
import type { AdapterId } from '@omni/shared';
import { anthropic } from './adapters/anthropic.js';
import { awsBedrock } from './adapters/aws-bedrock.js';
import { ibmWatsonx } from './adapters/ibm-watsonx.js';
import { replicate } from './adapters/replicate.js';
import { writer } from './adapters/writer.js';
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
export { awsBedrock, parseAwsCredential, sigV4Headers } from './adapters/aws-bedrock.js';
export { ibmWatsonx, clearWatsonxTokenCache } from './adapters/ibm-watsonx.js';
export { replicate, clearReplicateSchemaCache } from './adapters/replicate.js';
export { writer } from './adapters/writer.js';
export {
  cliAgent,
  cliPrompt,
  cliMode,
  cliDeniedHint,
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
 * Code, Codex, Gemini CLI…) installed on the machine instead of calling an API. aws-bedrock speaks Converse with
 * SigV4 or a Bedrock API key; ibm-watsonx, writer and replicate have their own native APIs.
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
  'aws-bedrock': awsBedrock,
  'ibm-watsonx': ibmWatsonx,
  writer,
  replicate,
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
