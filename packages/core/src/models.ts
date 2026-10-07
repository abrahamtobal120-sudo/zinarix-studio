import { ModelInfo } from '@omni/shared';
import { catalogModels, getAdapter } from '@omni/providers';
import type { ProviderConfig } from '@omni/providers';
import type { Db } from './db.js';

export interface ModelListOptions {
  refresh?: boolean;
  signal?: AbortSignal;
}

export interface ProviderModels {
  provider: string;
  models: ModelInfo[];
  cached: boolean;
  error?: string;
}

/**
 * Live model discovery with a SQLite cache (TTL from config, default 24 h).
 * When the provider has no listing endpoint or the call fails, the catalog's
 * fallback models are used so the selector is never empty.
 */
export class ModelService {
  constructor(
    private readonly db: Db,
    private readonly ttlMs: () => number,
  ) {}

  cached(provider: string): { models: ModelInfo[]; fetchedAt: number } | undefined {
    const row = this.db
      .prepare('SELECT fetched_at, models_json FROM model_cache WHERE provider = ?')
      .get(provider) as { fetched_at: number; models_json: string } | undefined;
    if (!row) return undefined;
    const parsed = ModelInfo.array().safeParse(JSON.parse(row.models_json));
    return parsed.success ? { models: parsed.data, fetchedAt: row.fetched_at } : undefined;
  }

  store(provider: string, models: ModelInfo[]): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO model_cache (provider, fetched_at, models_json) VALUES (?, ?, ?)',
      )
      .run(provider, Date.now(), JSON.stringify(models));
  }

  invalidate(provider?: string): void {
    if (provider) this.db.prepare('DELETE FROM model_cache WHERE provider = ?').run(provider);
    else this.db.exec('DELETE FROM model_cache');
  }

  async list(cfg: ProviderConfig, opts: ModelListOptions = {}): Promise<ProviderModels> {
    const provider = cfg.entry.id;
    const hit = this.cached(provider);
    if (hit && !opts.refresh && Date.now() - hit.fetchedAt < this.ttlMs()) {
      return { provider, models: hit.models, cached: true };
    }
    try {
      const live = await getAdapter(cfg.entry.adapter).listModels(cfg, opts.signal);
      const models = live.length
        ? mergeCatalog(live, catalogModels(cfg.entry))
        : catalogModels(cfg.entry);
      this.store(provider, models);
      return { provider, models, cached: false };
    } catch (e) {
      const fallback = hit?.models ?? catalogModels(cfg.entry);
      return {
        provider,
        models: fallback,
        cached: Boolean(hit),
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  find(provider: string, model: string): ModelInfo | undefined {
    return this.cached(provider)?.models.find((m) => m.id === model);
  }
}

/** Live data wins; catalog fills gaps (prices, context) for models the provider omits metadata for. */
function mergeCatalog(live: ModelInfo[], catalog: ModelInfo[]): ModelInfo[] {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  return live.map((m) => {
    const c = byId.get(m.id);
    if (!c) return m;
    return {
      ...m,
      label: m.label ?? c.label,
      context: m.context ?? c.context,
      inputPrice: m.inputPrice ?? c.inputPrice,
      outputPrice: m.outputPrice ?? c.outputPrice,
    };
  });
}

export interface ModelFilter {
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  minContext?: number;
  maxInputPrice?: number;
  includeNonChat?: boolean;
  search?: string;
}

export function filterModels(models: ModelInfo[], f: ModelFilter): ModelInfo[] {
  const q = f.search?.toLowerCase();
  return models.filter(
    (m) =>
      (f.includeNonChat || m.kind === 'chat') &&
      (!f.tools || m.capabilities.tools !== false) &&
      (!f.vision || m.capabilities.vision === true) &&
      (!f.reasoning || m.capabilities.reasoning === true) &&
      (!f.minContext || (m.context ?? 0) >= f.minContext) &&
      (f.maxInputPrice === undefined ||
        (m.inputPrice !== null && m.inputPrice <= f.maxInputPrice)) &&
      (!q || m.id.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q)),
  );
}
