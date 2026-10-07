import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import {
  OmniCore,
  buildContextMessages,
  omniHome,
  periodStart,
  spend,
  usageByDay,
  usageByProvider,
} from '@omni/core';
import type { OmniEvent } from '@omni/core';
import { OmniError, t } from '@omni/shared';
import type { ChatMessage, MessageKey, ModelInfo } from '@omni/shared';
import { redact } from '@omni/security';
import { Agent } from './agent.js';
import type { Workspace } from './workspace.js';
import { isAdapterImplemented } from '@omni/providers';
import type {
  ChatEventView,
  ChatRequestView,
  EditRequestView,
  ProviderView,
  ToolDecision,
  UsageReport,
} from '../shared/api.js';

const CHAT_SYSTEM =
  'You are Zinarix Studio, an AI assistant embedded in a code editor. Be concise and precise. ' +
  'Use fenced code blocks with a language tag for code. Answer in the language the user writes in.';

const EDIT_SYSTEM =
  'You are a code editing engine inside an editor. Rewrite ONLY the selected code so it satisfies the instruction. ' +
  'Output the replacement code and nothing else: no explanations, no markdown fences. Preserve the surrounding indentation style.';

export function describeError(e: unknown): { message: string; code: string } {
  if (e instanceof OmniError) {
    if (e.code === 'auth' && e.status === undefined && e.provider)
      return { code: e.code, message: t('err.no_key', { provider: e.provider }) };
    const base = t(`err.${e.code}` as MessageKey, {
      provider: e.provider ?? '',
      detail: e.message,
    });
    const extra = ['auth', 'rate_limit', 'server', 'timeout', 'network'].includes(e.code)
      ? ` — ${e.message}`
      : '';
    return { code: e.code, message: redact(base + extra) };
  }
  return { code: 'unknown', message: redact(e instanceof Error ? e.message : String(e)) };
}

/**
 * Keychain-less fallback for the desktop app: the encrypted vault's master password is a
 * random secret protected by Electron safeStorage (DPAPI / Keychain / libsecret / kwallet),
 * so the user is never prompted.
 */
function vaultPassword(home: string): () => Promise<string> {
  return async () => {
    if (!safeStorage.isEncryptionAvailable())
      throw new OmniError(
        'config',
        'no OS keychain or safeStorage available; set OMNI_VAULT_PASSWORD',
      );
    const file = join(home, 'desktop-vault.key');
    if (existsSync(file)) return safeStorage.decryptString(readFileSync(file));
    const pw = randomBytes(32).toString('base64');
    writeFileSync(file, safeStorage.encryptString(pw), { mode: 0o600 });
    return pw;
  };
}

type Emit = (requestId: string, ev: ChatEventView) => void;

export class AiService {
  readonly core: OmniCore;
  private readonly running = new Map<string, AbortController>();
  private readonly decisions = new Map<string, (d: ToolDecision) => void>();
  readonly agent: Agent;

  constructor(workspace: () => Workspace | undefined, home = omniHome()) {
    this.core = OmniCore.open({ home, askPassword: vaultPassword(home) });
    this.agent = new Agent(this.core, workspace);
  }

  async providers(): Promise<ProviderView[]> {
    const connected = new Map((await this.core.connectedProviders()).map((p) => [p.id, p.store]));
    return this.core.providers().map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      status: p.status,
      adapter: p.adapter,
      connected: connected.has(p.id),
      store: connected.get(p.id) ?? null,
      needsKey: this.core.needsKey(p),
      keyUrl: p.keyUrl ?? null,
      docsUrl: p.docsUrl ?? null,
      notes: p.notes ?? null,
      params: p.baseUrlParams.map((bp) => ({
        name: bp.name,
        label: bp.label,
        value: this.core.config.providers[p.id]?.params[bp.name] ?? '',
      })),
      implemented: isAdapterImplemented(p.adapter),
      models: p.fallbackModels,
      local: p.category === 'local' || p.region === 'local',
    }));
  }

  async saveProvider(
    id: string,
    key: string | null,
    params: Record<string, string>,
  ): Promise<{ ok: boolean; error?: string; store?: string; models?: number }> {
    const entry = this.core.provider(id);
    const prev = this.core.config.providers[id];
    this.core.saveConfig({
      ...this.core.config,
      providers: {
        ...this.core.config.providers,
        [id]: {
          params: { ...prev?.params, ...params },
          headers: prev?.headers ?? {},
          ...(prev?.baseUrl ? { baseUrl: prev.baseUrl } : {}),
        },
      },
    });
    let store: string | undefined;
    if (key && key.trim()) store = await this.core.vault.set(id, key.trim());
    else if (this.core.needsKey(entry) && !(await this.core.vault.get(id)))
      return { ok: false, error: t('auth.empty') };
    this.core.models.invalidate(id);
    try {
      const cfg = await this.core.providerConfig(id);
      const res = await this.core.models.list(cfg, { refresh: true });
      if (res.error) return { ok: false, error: redact(res.error), store };
      return { ok: true, store, models: res.models.length };
    } catch (e) {
      return { ok: false, error: describeError(e).message, store };
    }
  }

  async removeProvider(id: string): Promise<void> {
    await this.core.vault.delete(id);
    const { [id]: _gone, ...rest } = this.core.config.providers;
    this.core.saveConfig({ ...this.core.config, providers: rest });
    this.core.models.invalidate(id);
  }

  /**
   * Live models of every connected provider. Local runtimes (Ollama, LM Studio, vLLM…)
   * that are running on this machine are detected and connected automatically.
   */
  async models(refresh: boolean): Promise<{
    models: ModelInfo[];
    errors: { provider: string; error: string }[];
    detected: string[];
  }> {
    const detected = await this.detectLocal();
    const ids = (await this.core.connectedProviders()).map((p) => p.id);
    const errors: { provider: string; error: string }[] = [];
    const lists = await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await this.core.models.list(await this.core.providerConfig(id), { refresh });
          if (r.error) errors.push({ provider: id, error: redact(r.error) });
          return r.models;
        } catch (e) {
          errors.push({ provider: id, error: describeError(e).message });
          return [];
        }
      }),
    );
    return { models: lists.flat().filter((m) => m.kind === 'chat'), errors, detected };
  }

  private async detectLocal(): Promise<string[]> {
    const found: string[] = [];
    const candidates = this.core
      .providers()
      .filter(
        (p) =>
          p.category === 'local' && !this.core.config.providers[p.id] && !p.baseUrl.includes('{'),
      );
    // Several runtimes share a default port (llama.cpp / LocalAI on 8080): first match wins.
    const seen = new Set<string>();
    await Promise.all(
      candidates.map(async (p) => {
        const url = `${p.baseUrl.replace(/\/+$/, '')}${p.modelsEndpoint ?? '/models'}`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(700) });
          if (!res.ok) return;
          const host = new URL(p.baseUrl).host;
          if (seen.has(host)) return;
          seen.add(host);
          found.push(p.id);
        } catch {
          // not running
        }
      }),
    );
    if (found.length) {
      const providers = { ...this.core.config.providers };
      for (const id of found) providers[id] = { params: {}, headers: {} };
      this.core.saveConfig({ ...this.core.config, providers });
    }
    return found;
  }

  setRole(role: 'chat' | 'agent' | 'inline', ref: string | null): void {
    const roles = { ...this.core.config.roles };
    if (ref) {
      this.core.resolveModel(ref);
      this.core.provider(ref.split('/')[0]!);
      roles[role] = ref;
    } else delete roles[role];
    this.core.saveConfig({ ...this.core.config, roles });
  }

  usage(): UsageReport {
    const names = new Map(this.core.providers().map((p) => [p.id, p.name]));
    const named = (rows: ReturnType<typeof usageByProvider>) =>
      rows.map((r) => ({ ...r, name: names.get(r.provider) ?? r.provider }));
    return {
      today: named(usageByProvider(this.core.db, periodStart('day'))),
      month: named(usageByProvider(this.core.db, periodStart('month'))),
      days: usageByDay(this.core.db, Date.now() - 30 * 86_400_000),
      budgets: this.core.config.budgets,
    };
  }

  setBudget(provider: string, budget: { daily?: number; monthly?: number } | null): void {
    const budgets = { ...this.core.config.budgets };
    if (!budget || (!budget.daily && !budget.monthly)) delete budgets[provider];
    else budgets[provider] = { ...budget, hardStop: budgets[provider]?.hardStop ?? false };
    this.core.saveConfig({ ...this.core.config, budgets });
  }

  todayUsd(): number {
    return spend(this.core.db, periodStart('day'));
  }

  setDefaultModel(ref: string): void {
    this.core.resolveModel(ref);
    this.core.provider(ref.split('/')[0]!);
    this.core.saveConfig({ ...this.core.config, defaultModel: ref });
  }

  setLocalOnly(on: boolean): void {
    this.core.saveConfig({
      ...this.core.config,
      privacy: { ...this.core.config.privacy, localOnly: on },
    });
  }

  async chat(requestId: string, req: ChatRequestView, emit: Emit): Promise<void> {
    if (req.agent) return this.agentChat(requestId, req, emit);
    const [system, user] = buildContextMessages(req.prompt, req.context, CHAT_SYSTEM) as [
      ChatMessage,
      ChatMessage,
    ];
    const messages: ChatMessage[] = [
      system,
      ...req.history.filter((m) => m.role !== 'system'),
      user,
    ];
    let conversationId = req.conversationId;
    if (!conversationId || !this.core.history.get(conversationId)) {
      conversationId = this.core.history.create(req.prompt.split('\n')[0] ?? 'chat', req.model).id;
    }
    this.core.history.append(conversationId, { role: 'user', content: req.prompt });
    let answer = '';
    let ref = req.model;
    await this.run(requestId, { model: req.model, messages, role: 'chat' }, (ev) => {
      if (ev.type === 'start') {
        ref = `${ev.provider}/${ev.model}`;
        emit(requestId, { ...ev, conversationId });
        return;
      }
      if (ev.type === 'text') answer += ev.delta;
      forward(requestId, ev, emit);
    });
    if (answer)
      this.core.history.append(conversationId, { role: 'assistant', content: answer }, ref);
  }

  /** Agent mode: multi-step tool use over the open workspace, with approvals. */
  private async agentChat(requestId: string, req: ChatRequestView, emit: Emit): Promise<void> {
    let conversationId = req.conversationId;
    if (!conversationId || !this.core.history.get(conversationId)) {
      conversationId = this.core.history.create(
        req.prompt.split('\n')[0] ?? 'agente',
        req.model,
      ).id;
    }
    this.core.history.append(conversationId, { role: 'user', content: req.prompt });
    const userMessage = buildContextMessages(req.prompt, req.context).at(-1)!;
    const ctrl = new AbortController();
    this.running.set(requestId, ctrl);
    let ref = req.model;
    const convId = conversationId;
    try {
      const answer = await this.agent.run({
        conversationId: convId,
        model: req.model,
        userMessage,
        fallbackHistory: req.history.filter((m) => m.role !== 'system'),
        signal: ctrl.signal,
        emit: (ev) => {
          if (ev.type === 'start') {
            ref = `${ev.provider}/${ev.model}`;
            emit(requestId, { ...ev, conversationId: convId });
          } else emit(requestId, ev);
        },
        ask: (toolCallId) =>
          new Promise<ToolDecision>((resolve) => {
            const key = `${requestId}:${toolCallId}`;
            this.decisions.set(key, resolve);
            ctrl.signal.addEventListener('abort', () => {
              this.decisions.delete(key);
              resolve('deny');
            });
          }),
      });
      if (answer) this.core.history.append(convId, { role: 'assistant', content: answer }, ref);
    } catch (e) {
      const d = describeError(e);
      emit(requestId, { type: 'error', code: d.code, message: d.message });
    } finally {
      this.running.delete(requestId);
    }
  }

  toolDecision(requestId: string, toolCallId: string, decision: ToolDecision): void {
    const key = `${requestId}:${toolCallId}`;
    this.decisions.get(key)?.(decision);
    this.decisions.delete(key);
  }

  revert(conversationId: string): Promise<string[]> {
    return this.agent.revert(conversationId);
  }

  async edit(requestId: string, req: EditRequestView, emit: Emit): Promise<void> {
    const messages = buildContextMessages(
      `Instruction: ${req.instruction}\n\nReturn only the new code that replaces the <untrusted source="selection"> block.`,
      [
        { source: `before-selection:${req.path}`, content: req.before.slice(-4000) },
        { source: 'selection', content: req.selection },
        { source: `after-selection:${req.path}`, content: req.after.slice(0, 4000) },
      ],
      `${EDIT_SYSTEM}\nFile: ${req.path} (language: ${req.language}).`,
    );
    await this.run(requestId, { model: req.model, messages, role: 'inline' }, (ev) =>
      forward(requestId, ev, emit),
    );
  }

  private async run(
    requestId: string,
    req: Parameters<OmniCore['stream']>[0],
    on: (ev: OmniEvent) => void,
  ): Promise<void> {
    const ctrl = new AbortController();
    this.running.set(requestId, ctrl);
    try {
      for await (const ev of this.core.stream(req, ctrl.signal)) on(ev);
    } catch (e) {
      const d = describeError(e);
      on({ type: 'error', code: d.code, message: d.message, retryable: false });
    } finally {
      this.running.delete(requestId);
    }
  }

  abort(requestId: string): void {
    this.running.get(requestId)?.abort();
  }

  close(): void {
    for (const c of this.running.values()) c.abort();
    this.core.close();
  }
}

function forward(requestId: string, ev: OmniEvent, emit: Emit): void {
  switch (ev.type) {
    case 'text':
    case 'reasoning':
      emit(requestId, { type: ev.type, delta: ev.delta });
      break;
    case 'notice':
      emit(requestId, {
        type: 'notice',
        kind: ev.kind,
        message:
          ev.kind === 'redaction' ? t('redaction.notice', { count: ev.message }) : ev.message,
      });
      break;
    case 'cost':
      emit(requestId, ev);
      break;
    case 'done':
      emit(requestId, { type: 'done', stopReason: ev.stopReason });
      break;
    case 'error':
      emit(requestId, { type: 'error', code: ev.code, message: ev.message });
      break;
    case 'start':
      emit(requestId, ev);
      break;
  }
}
