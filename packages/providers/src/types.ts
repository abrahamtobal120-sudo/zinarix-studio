import type {
  CatalogEntry,
  ChatChunk,
  ChatRequest,
  EmbedRequest,
  FimRequest,
  ModelInfo,
  OmniErrorCode,
} from '@omni/shared';
import type { Logger, Secret } from '@omni/security';

export type FetchLike = typeof fetch;

/** Everything an adapter needs to talk to one provider. Built by @omni/core. */
export interface ProviderConfig {
  entry: CatalogEntry;
  /** Base URL with {placeholders} already resolved. */
  baseUrl: string;
  /**
   * Catalog `baseUrlParams` as configured by the user (catalog defaults filled in, empty
   * values dropped). Adapters that build URLs themselves (google-vertex) read these.
   */
  params?: Record<string, string>;
  apiKey?: Secret;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  /** Timeout for the gap between streamed chunks. */
  idleTimeoutMs?: number;
  maxRetries?: number;
  fetch?: FetchLike;
  logger?: Logger;
}

export interface ConnectionTest {
  ok: boolean;
  error?: string;
  /** Normalized error code when the test failed (auth, network, timeout, ...). */
  code?: OmniErrorCode;
  /** HTTP status of the failing response, when there was one. */
  status?: number;
  models?: number;
  /**
   * The key could not be checked: the provider has no models endpoint and no known model
   * to ping. `ok` is false so nobody reads it as a pass; callers may show it as a warning.
   */
  unverified?: boolean;
}

export interface ProviderAdapter {
  id: string;
  listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]>;
  chat(cfg: ProviderConfig, req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  complete?(cfg: ProviderConfig, req: FimRequest, signal: AbortSignal): Promise<string>;
  embed?(cfg: ProviderConfig, req: EmbedRequest, signal?: AbortSignal): Promise<number[][]>;
  testConnection(cfg: ProviderConfig): Promise<ConnectionTest>;
}
