import { OmniError, setLocale } from '@omni/shared';
import type { CatalogEntry, ChatChunk, ChatMessage, ChatRequest, ContentPart } from '@omni/shared';
import { createLogger, redactWithReport } from '@omni/security';
import type { Logger } from '@omni/security';
import { getAdapter, isAdapterImplemented } from '@omni/providers';
import type { ConnectionTest, FetchLike, ProviderConfig } from '@omni/providers';
import { isLocalProvider, loadCatalog, resolveBaseUrl, resolveParams } from './catalog.js';
import type { LoadedCatalog } from './catalog.js';
import { loadConfig, saveConfig } from './config.js';
import type { OmniConfig, Role } from './config.js';
import { openDb } from './db.js';
import type { Db } from './db.js';
import { History } from './history.js';
import { ModelService } from './models.js';
import { ensureHome, omniPaths } from './paths.js';
import type { OmniPaths } from './paths.js';
import { audit, computeCost, periodStart, recordUsage, spend } from './usage.js';
import type { Price } from './usage.js';
import { EnvStore, FileVault, KeychainStore, Vault } from './vault.js';

export interface OmniOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  askPassword?: () => Promise<string>;
  logger?: Logger;
  timeoutMs?: number;
}

export interface ModelRef {
  provider: string;
  model: string;
}

/** Events yielded by OmniCore.stream: normalized provider chunks plus core metadata. */
export type OmniEvent =
  | ChatChunk
  | { type: 'start'; provider: string; model: string }
  | { type: 'notice'; message: string; kind: 'redaction' | 'fallback' | 'budget' }
  | {
      type: 'cost';
      usd: number | null;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
    };

export interface StreamRequest extends Omit<ChatRequest, 'model'> {
  /** "provider/model"; defaults to the role assignment or the default model. */
  model?: string;
  role?: Role;
  project?: string;
  /** Disable the configured fallback chain for this call. */
  noFallback?: boolean;
}

export function parseModelRef(spec: string): ModelRef {
  const i = spec.indexOf('/');
  if (i <= 0 || i === spec.length - 1)
    throw new OmniError('config', `expected <provider>/<model>, got "${spec}"`);
  return { provider: spec.slice(0, i), model: spec.slice(i + 1) };
}

/**
 * The editor-independent AI core shared by the desktop app, the web server and the CLI.
 * It owns configuration, the catalog, the key vault, model discovery, routing with
 * fallback, budgets, secret redaction, usage accounting and history.
 */
export class OmniCore {
  readonly paths: OmniPaths;
  config: OmniConfig;
  catalog: LoadedCatalog;
  readonly db: Db;
  readonly vault: Vault;
  readonly models: ModelService;
  readonly history: History;
  readonly logger: Logger;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs?: number;

  private constructor(opts: OmniOptions) {
    const env = opts.env ?? process.env;
    this.paths = omniPaths(opts.home);
    ensureHome(this.paths);
    this.config = loadConfig(this.paths.config);
    if (this.config.locale) setLocale(this.config.locale);
    this.catalog = loadCatalog(this.paths, this.config);
    this.logger =
      opts.logger ??
      createLogger({
        file: this.paths.logFile,
        level: env.OMNI_DEBUG ? 'debug' : 'info',
        stderr: env.OMNI_DEBUG === '1',
      });
    this.db = openDb(this.paths.db);
    this.vault = new Vault(
      new EnvStore(this.catalog.providers, env),
      new KeychainStore(env.OMNI_KEYCHAIN_SERVICE ?? 'omnicode', env),
      new FileVault(this.paths.vault, opts.askPassword ?? (async () => ''), env),
    );
    this.models = new ModelService(this.db, () => this.config.modelCacheTtlHours * 3600_000);
    this.history = new History(this.db);
    this.fetchImpl = opts.fetch;
    this.timeoutMs = opts.timeoutMs;
  }

  static open(opts: OmniOptions = {}): OmniCore {
    return new OmniCore(opts);
  }

  close(): void {
    this.db.close();
  }

  saveConfig(next: OmniConfig = this.config): void {
    this.config = next;
    saveConfig(this.paths.config, next);
    this.catalog = loadCatalog(this.paths, next);
  }

  // ---------------- Providers ----------------

  providers(): CatalogEntry[] {
    return [...this.catalog.providers.values()];
  }

  provider(id: string): CatalogEntry {
    const p = this.catalog.providers.get(id);
    if (!p) throw new OmniError('config', `unknown provider "${id}"`);
    return p;
  }

  needsKey(entry: CatalogEntry): boolean {
    return entry.auth.type !== 'none' && !entry.auth.optional;
  }

  /** Providers usable right now: a key is available, or it is keyless and was added by the user. */
  async connectedProviders(): Promise<{ id: string; store: string }[]> {
    const withKeys = await this.vault.list();
    const out = new Map(
      withKeys
        .filter((k) => this.catalog.providers.has(k.id))
        .map((k) => [k.id, k.store as string]),
    );
    for (const id of Object.keys(this.config.providers)) {
      const entry = this.catalog.providers.get(id);
      if (entry && !this.needsKey(entry) && !out.has(id)) out.set(id, 'none');
    }
    return [...out].map(([id, store]) => ({ id, store }));
  }

  async providerConfig(id: string): Promise<ProviderConfig> {
    const entry = this.provider(id);
    const userCfg = this.config.providers[id];
    const baseUrl = resolveBaseUrl(entry, userCfg?.params ?? {}, userCfg?.baseUrl);
    if (this.config.privacy.localOnly && !isLocalProvider(entry, baseUrl)) {
      throw new OmniError('privacy', `${entry.name} is a cloud provider`);
    }
    if (!isAdapterImplemented(entry.adapter)) {
      throw new OmniError(
        'unsupported',
        `${entry.name} uses the "${entry.adapter}" adapter, planned for Phase 3`,
      );
    }
    const key = await this.vault.get(id);
    if (!key && this.needsKey(entry)) {
      throw new OmniError('auth', `no API key for ${id}: run \`omni auth add ${id}\``, {
        provider: id,
        retryable: false,
      });
    }
    return {
      entry,
      baseUrl,
      params: resolveParams(entry, userCfg?.params ?? {}),
      apiKey: key?.secret,
      extraHeaders: userCfg?.headers,
      fetch: this.fetchImpl,
      logger: this.logger,
      timeoutMs: this.timeoutMs,
    };
  }

  async testConnection(id: string): Promise<ConnectionTest> {
    const cfg = await this.providerConfig(id);
    const result = await getAdapter(cfg.entry.adapter).testConnection(cfg);
    audit(this.db, 'test_connection', { provider: id, detail: { ok: result.ok } });
    return result;
  }

  // ---------------- Routing ----------------

  resolveModel(spec?: string, role: Role = 'chat'): ModelRef {
    const chosen = spec ?? this.config.roles[role] ?? this.config.defaultModel;
    if (!chosen)
      throw new OmniError('config', 'no model selected: use `omni use <provider>/<model>` or -m');
    return parseModelRef(chosen);
  }

  price(ref: ModelRef): Price | undefined {
    const override = this.config.prices[`${ref.provider}/${ref.model}`];
    if (override) return override;
    const info = this.models.find(ref.provider, ref.model);
    const cat = this.catalog.providers
      .get(ref.provider)
      ?.fallbackModels.find((m) => m.id === ref.model);
    const input = info?.inputPrice ?? cat?.inputPrice;
    const output = info?.outputPrice ?? cat?.outputPrice;
    return input != null && output != null ? { input, output } : undefined;
  }

  /** Throws when a hard budget is exhausted; returns warnings at >= 80 %. */
  checkBudget(provider: string): string[] {
    const notices: string[] = [];
    for (const key of [provider, '*']) {
      const b = this.config.budgets[key];
      if (!b) continue;
      for (const period of ['daily', 'monthly'] as const) {
        const limit = b[period];
        if (!limit) continue;
        const used = spend(
          this.db,
          periodStart(period === 'daily' ? 'day' : 'month'),
          key === '*' ? undefined : provider,
        );
        const pct = Math.round((used / limit) * 100);
        if (used >= limit && b.hardStop) {
          throw new OmniError('budget', `${key} ${period}: $${used.toFixed(4)} / $${limit}`, {
            retryable: false,
          });
        }
        if (pct >= 80) notices.push(`${key} ${period}: ${pct}% ($${used.toFixed(4)} / $${limit})`);
      }
    }
    return notices;
  }

  // ---------------- Chat ----------------

  private redactMessages(messages: ChatMessage[]): { messages: ChatMessage[]; count: number } {
    if (!this.config.privacy.redactSecrets) return { messages, count: 0 };
    let count = 0;
    const scrub = (s: string) => {
      const r = redactWithReport(s);
      count += r.count;
      return r.text;
    };
    const out = messages.map((m): ChatMessage => {
      switch (m.role) {
        case 'system':
          return { ...m, content: scrub(m.content) };
        case 'user':
          return {
            ...m,
            content:
              typeof m.content === 'string'
                ? scrub(m.content)
                : m.content.map((p): ContentPart =>
                    p.type === 'text' ? { ...p, text: scrub(p.text) } : p,
                  ),
          };
        case 'tool':
          return { ...m, content: scrub(m.content) };
        case 'assistant':
          return m;
      }
    });
    return { messages: out, count };
  }

  /**
   * Streams a chat completion with redaction, budgets, fallback chain and usage accounting.
   * Fallback only happens before the first token, so output is never duplicated.
   */
  async *stream(req: StreamRequest, signal: AbortSignal): AsyncGenerator<OmniEvent> {
    const role = req.role ?? 'chat';
    const primary = this.resolveModel(req.model, role);
    const chain = [primary];
    if (!req.noFallback) {
      for (const f of this.config.fallbacks) {
        const ref = parseModelRef(f);
        if (!chain.some((c) => c.provider === ref.provider && c.model === ref.model))
          chain.push(ref);
      }
    }

    const { messages, count } = this.redactMessages(req.messages);
    if (count > 0) yield { type: 'notice', kind: 'redaction', message: String(count) };

    let lastError: unknown;
    for (let i = 0; i < chain.length; i++) {
      const ref = chain[i]!;
      let emitted = false;
      const started = Date.now();
      let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
      try {
        for (const n of this.checkBudget(ref.provider))
          yield { type: 'notice', kind: 'budget', message: n };
        const cfg = await this.providerConfig(ref.provider);
        const adapter = getAdapter(cfg.entry.adapter);
        yield { type: 'start', provider: ref.provider, model: ref.model };
        const chatReq: ChatRequest = {
          model: ref.model,
          messages,
          tools: req.tools,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          reasoning: req.reasoning,
          jsonMode: req.jsonMode,
        };
        for await (const chunk of adapter.chat(cfg, chatReq, signal)) {
          if (chunk.type === 'usage') {
            usage = {
              inputTokens: chunk.inputTokens,
              outputTokens: chunk.outputTokens,
              cachedTokens: chunk.cachedTokens ?? 0,
            };
          }
          if (chunk.type === 'text' || chunk.type === 'tool_call' || chunk.type === 'reasoning')
            emitted = true;
          yield chunk;
        }
        const latencyMs = Date.now() - started;
        // Prices come from the model cache; warm it once (after the answer, so no added latency).
        if (
          !this.price(ref) &&
          cfg.entry.supports.listModels &&
          !this.models.cached(ref.provider)
        ) {
          await this.models.list({ ...cfg, maxRetries: 0, timeoutMs: 5000 }).catch(() => undefined);
        }
        const usd = computeCost(
          this.price(ref),
          usage.inputTokens,
          usage.outputTokens,
          usage.cachedTokens,
        );
        recordUsage(this.db, {
          ...ref,
          role,
          project: req.project,
          ...usage,
          costUsd: usd,
          latencyMs,
        });
        audit(this.db, 'chat', {
          provider: ref.provider,
          model: ref.model,
          detail: {
            role,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: usd,
            redactions: count,
            tools: req.tools?.map((t) => t.name),
          },
        });
        yield {
          type: 'cost',
          usd,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs,
        };
        return;
      } catch (e) {
        lastError = e;
        const err =
          e instanceof OmniError
            ? e
            : new OmniError('unknown', e instanceof Error ? e.message : String(e));
        if (err.code !== 'aborted') {
          recordUsage(this.db, {
            ...ref,
            role,
            project: req.project,
            ...usage,
            costUsd: null,
            latencyMs: Date.now() - started,
            ok: false,
          });
          audit(this.db, 'chat_error', {
            provider: ref.provider,
            model: ref.model,
            detail: { code: err.code, status: err.status },
          });
        }
        const next = chain[i + 1];
        if (emitted || !next || !err.retryable || signal.aborted) throw err;
        yield {
          type: 'notice',
          kind: 'fallback',
          message: `${ref.provider}/${ref.model} → ${next.provider}/${next.model} (${err.code})`,
        };
      }
    }
    throw lastError;
  }

  /** Collects a full response (used by `omni ask --json`, compare, tests). */
  async complete(req: StreamRequest, signal: AbortSignal): Promise<CompletedChat> {
    const out: CompletedChat = {
      text: '',
      reasoning: '',
      toolCalls: [],
      provider: '',
      model: '',
      stopReason: '',
      usd: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      notices: [],
    };
    const calls = new Map<string, { id: string; name: string; arguments: string }>();
    for await (const ev of this.stream(req, signal)) {
      switch (ev.type) {
        case 'start':
          out.provider = ev.provider;
          out.model = ev.model;
          break;
        case 'text':
          out.text += ev.delta;
          break;
        case 'reasoning':
          out.reasoning += ev.delta;
          break;
        case 'tool_call': {
          const c = calls.get(ev.id) ?? { id: ev.id, name: ev.name, arguments: '' };
          c.arguments += ev.argsDelta;
          calls.set(ev.id, c);
          break;
        }
        case 'done':
          out.stopReason = ev.stopReason;
          break;
        case 'cost':
          out.usd = ev.usd;
          out.inputTokens = ev.inputTokens;
          out.outputTokens = ev.outputTokens;
          out.latencyMs = ev.latencyMs;
          break;
        case 'notice':
          out.notices.push(`${ev.kind}: ${ev.message}`);
          break;
      }
    }
    out.toolCalls = [...calls.values()];
    return out;
  }

  /** Deletes every key, the history, caches and usage. Config (without keys) is kept. */
  async wipe(): Promise<void> {
    await this.vault.wipe();
    this.db.exec(
      'DELETE FROM messages; DELETE FROM conversations; DELETE FROM model_cache; DELETE FROM usage; DELETE FROM audit;',
    );
  }
}

export interface CompletedChat {
  text: string;
  reasoning: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  provider: string;
  model: string;
  stopReason: string;
  usd: number | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  notices: string[];
}
