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
  ConversationView,
  SavedMessageView,
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

  constructor(
    private readonly workspace: () => Workspace | undefined,
    home = omniHome(),
  ) {
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

  private newConversation(req: ChatRequestView, requestId: string, emit: Emit): string {
    let id = req.conversationId;
    if (!id || !this.core.history.get(id)) {
      id = this.core.history.create(
        req.prompt.split('\n')[0]!.slice(0, 80) || 'chat',
        req.model,
        this.workspace()?.root,
      ).id;
    }
    // Tell the UI right away, so the conversation is known even if the request fails.
    emit(requestId, { type: 'conversation', id });
    this.core.history.append(id, { role: 'user', content: req.prompt }, undefined, {
      context: req.context.map((c) => c.source),
      agent: Boolean(req.agent),
    });
    return id;
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
    const conversationId = this.newConversation(req, requestId, emit);
    const rec = new TurnRecorder();
    const send: Emit = (rid, ev) => {
      rec.add(ev);
      emit(rid, ev);
    };
    await this.run(requestId, { model: req.model, messages, role: 'chat' }, (ev) => {
      if (ev.type === 'start') {
        send(requestId, { ...ev, conversationId });
        return;
      }
      forward(requestId, ev, send);
    });
    rec.save(this.core, conversationId);
  }

  /** Agent mode: multi-step tool use over the open workspace, with approvals. */
  private async agentChat(requestId: string, req: ChatRequestView, emit: Emit): Promise<void> {
    const convId = this.newConversation(req, requestId, emit);
    const userMessage = buildContextMessages(req.prompt, req.context).at(-1)!;
    const ctrl = new AbortController();
    this.running.set(requestId, ctrl);
    const rec = new TurnRecorder();
    const send = (ev: ChatEventView) => {
      rec.add(ev);
      emit(requestId, ev);
    };
    try {
      await this.agent.run({
        conversationId: convId,
        model: req.model,
        userMessage,
        fallbackHistory: req.history.filter((m) => m.role !== 'system'),
        signal: ctrl.signal,
        emit: (ev) => send(ev.type === 'start' ? { ...ev, conversationId: convId } : ev),
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
    } catch (e) {
      const d = describeError(e);
      send({ type: 'error', code: d.code, message: d.message });
    } finally {
      this.running.delete(requestId);
      rec.save(this.core, convId);
    }
  }

  conversations(query: string, onlyProject: boolean): ConversationView[] {
    const project = onlyProject ? this.workspace()?.root : undefined;
    const list = query.trim()
      ? this.core.history.search(query.trim(), 200, project)
      : this.core.history.list(200, project);
    return list
      .filter((c) => (c.messageCount ?? 0) > 0)
      .map((c) => ({ ...c, messageCount: c.messageCount ?? 0 }));
  }

  conversation(
    id: string,
  ): { conversation: ConversationView; messages: SavedMessageView[] } | null {
    const data = this.core.history.get(id);
    if (!data) return null;
    return {
      conversation: { ...data.conversation, messageCount: data.conversation.messageCount ?? 0 },
      messages: data.messages
        .filter((m) => m.message.role === 'user' || m.message.role === 'assistant')
        .map((m) => ({
          role: m.message.role as 'user' | 'assistant',
          content:
            typeof m.message.content === 'string'
              ? m.message.content
              : m.message.content.map((p) => (p.type === 'text' ? p.text : '[imagen]')).join('\n'),
          model: m.model,
          ts: m.ts,
          display: m.display,
        })),
    };
  }

  renameConversation(id: string, title: string): void {
    this.core.history.rename(id, title.trim().slice(0, 120) || 'Sin título');
  }

  deleteConversation(id: string): void {
    this.core.history.delete(id);
    this.agent.forget(id);
  }

  exportMarkdown(id: string): string | undefined {
    return this.core.history.exportMarkdown(id);
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

/** Display data of an assistant turn, as the chat panel renders it. Saved with the message. */
export interface TurnDisplay {
  parts: (
    | { kind: 'text'; text: string }
    | {
        kind: 'tool';
        id: string;
        name: string;
        args: Record<string, unknown>;
        status: 'ok' | 'error';
        summary?: string;
        output?: string;
        preview?: { path?: string; command?: string };
      }
  )[];
  model?: string;
  reasoning?: string;
  notices?: string[];
  meta?: { usd: number | null; inputTokens: number; outputTokens: number; latencyMs: number };
  error?: string;
}

const MAX_SAVED_OUTPUT = 8000;

/** Mirrors the chat events of one turn so the whole turn can be restored later. */
export class TurnRecorder {
  private readonly d: TurnDisplay = { parts: [] };
  private text = '';

  add(ev: ChatEventView): void {
    const d = this.d;
    switch (ev.type) {
      case 'start':
        d.model = `${ev.provider}/${ev.model}`;
        break;
      case 'text': {
        this.text += ev.delta;
        const last = d.parts[d.parts.length - 1];
        if (last?.kind === 'text') last.text += ev.delta;
        else d.parts.push({ kind: 'text', text: ev.delta });
        break;
      }
      case 'reasoning':
        d.reasoning = ((d.reasoning ?? '') + ev.delta).slice(-20000);
        break;
      case 'notice':
        (d.notices ??= []).push(ev.message);
        break;
      case 'tool_call':
        d.parts.push({ kind: 'tool', id: ev.id, name: ev.name, args: ev.args, status: 'error' });
        break;
      case 'tool_approval': {
        const step = this.step(ev.id);
        if (step) step.preview = { path: ev.preview.path, command: ev.preview.command };
        break;
      }
      case 'tool_output': {
        const step = this.step(ev.id);
        if (step) step.output = ((step.output ?? '') + ev.chunk).slice(-MAX_SAVED_OUTPUT);
        break;
      }
      case 'tool_result': {
        const step = this.step(ev.id);
        if (step) {
          step.status = ev.ok ? 'ok' : 'error';
          step.summary = ev.summary;
        }
        break;
      }
      case 'cost':
        d.meta = {
          usd: ev.usd,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          latencyMs: ev.latencyMs,
        };
        break;
      case 'error':
        d.error = ev.message;
        break;
    }
  }

  private step(id: string) {
    return this.d.parts.find(
      (p): p is Extract<TurnDisplay['parts'][number], { kind: 'tool' }> =>
        p.kind === 'tool' && p.id === id,
    );
  }

  save(core: OmniCore, conversationId: string): void {
    if (!this.text && !this.d.parts.length && !this.d.error) return;
    core.history.append(
      conversationId,
      { role: 'assistant', content: this.text.trim() },
      this.d.model,
      this.d,
    );
  }
}
