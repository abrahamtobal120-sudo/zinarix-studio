import type { Db } from './db.js';

export interface UsageRecord {
  provider: string;
  model: string;
  role?: string;
  project?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd: number | null;
  latencyMs?: number;
  ok?: boolean;
}

export interface Price {
  /** USD per 1M tokens. */
  input: number;
  output: number;
  /** USD per 1M cache-read input tokens; defaults to a share of `input` (see cacheRates). */
  cachedInput?: number;
  /** USD per 1M cache-write input tokens (Anthropic cache_creation); same default rule. */
  cacheWrite?: number;
}

/**
 * Default cache multipliers over the input price when the catalog or config gives no
 * explicit cache prices. Anthropic bills cache reads at 10 % and 5-minute cache writes at
 * 125 %; Gemini reads at 25 %; OpenAI (and the OpenAI-compatible default) reads at 50 %.
 * Unknown APIs get the OpenAI rate: overestimating is the safe side for a budget.
 */
export function cacheRates(adapter: string): { read: number; write: number } {
  switch (adapter) {
    case 'anthropic':
      return { read: 0.1, write: 1.25 };
    case 'google-gemini':
    case 'google-vertex':
      return { read: 0.25, write: 1 };
    default:
      return { read: 0.5, write: 1 };
  }
}

/**
 * USD for one request. `input` includes cached and cache-write tokens; they are billed
 * at the explicit cache prices when known, otherwise at `rates` times the input price.
 */
export function computeCost(
  price: Price | undefined,
  input: number,
  output: number,
  cached = 0,
  opts: { cacheWrite?: number; rates?: { read: number; write: number } } = {},
): number | null {
  if (!price) return null;
  const rates = opts.rates ?? cacheRates('openai-compatible');
  const write = opts.cacheWrite ?? 0;
  const fresh = Math.max(0, input - cached - write);
  const readPrice = price.cachedInput ?? price.input * rates.read;
  const writePrice = price.cacheWrite ?? price.input * rates.write;
  return (
    (fresh * price.input + cached * readPrice + write * writePrice + output * price.output) / 1e6
  );
}

export function recordUsage(db: Db, r: UsageRecord, ts = Date.now()): void {
  db.prepare(
    `INSERT INTO usage (ts, provider, model, role, project, input_tokens, output_tokens, cached_tokens, cost_usd, latency_ms, ok)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ts,
    r.provider,
    r.model,
    r.role ?? 'chat',
    r.project ?? null,
    r.inputTokens,
    r.outputTokens,
    r.cachedTokens ?? 0,
    r.costUsd,
    r.latencyMs ?? null,
    r.ok === false ? 0 : 1,
  );
}

export type Period = 'day' | 'month' | 'all';

export function periodStart(period: Period, now = new Date()): number {
  if (period === 'all') return 0;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'month') d.setDate(1);
  return d.getTime();
}

export interface UsageRow {
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpricedRequests: number;
}

export function usageSummary(db: Db, since: number, provider?: string): UsageRow[] {
  const rows = db
    .prepare(
      `SELECT provider, model, COUNT(*) AS requests,
              SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
              COALESCE(SUM(cost_usd), 0) AS costUsd,
              SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpricedRequests
       FROM usage WHERE ts >= ? ${provider ? 'AND provider = ?' : ''}
       GROUP BY provider, model ORDER BY costUsd DESC, requests DESC`,
    )
    .all(...(provider ? [since, provider] : [since])) as unknown as UsageRow[];
  return rows;
}

export function spend(db: Db, since: number, provider?: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS c FROM usage WHERE ts >= ? ${provider ? 'AND provider = ?' : ''}`,
    )
    .get(...(provider ? [since, provider] : [since])) as { c: number };
  return row.c;
}

export function audit(
  db: Db,
  event: string,
  data: { provider?: string; model?: string; detail?: unknown } = {},
): void {
  db.prepare(
    'INSERT INTO audit (ts, event, provider, model, detail_json) VALUES (?, ?, ?, ?, ?)',
  ).run(
    Date.now(),
    event,
    data.provider ?? null,
    data.model ?? null,
    data.detail === undefined ? null : JSON.stringify(data.detail),
  );
}

export interface ProviderUsage {
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpricedRequests: number;
}

/** Spend per provider since `since` (ms epoch). */
export function usageByProvider(db: Db, since: number): ProviderUsage[] {
  return db
    .prepare(
      `SELECT provider, COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(cost_usd), 0) AS costUsd,
              SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpricedRequests
       FROM usage WHERE ts >= ? GROUP BY provider ORDER BY costUsd DESC, requests DESC`,
    )
    .all(since) as unknown as ProviderUsage[];
}

export interface DailyUsage {
  /** Local date, YYYY-MM-DD. */
  day: string;
  provider: string;
  costUsd: number;
  requests: number;
  tokens: number;
}

/** Day-by-day spend per provider (local time) for charts. */
export function usageByDay(db: Db, since: number): DailyUsage[] {
  return db
    .prepare(
      `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day, provider,
              COALESCE(SUM(cost_usd), 0) AS costUsd, COUNT(*) AS requests,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
       FROM usage WHERE ts >= ? GROUP BY day, provider ORDER BY day`,
    )
    .all(since) as unknown as DailyUsage[];
}
