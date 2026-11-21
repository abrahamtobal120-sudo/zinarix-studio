import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import {
  OmniCore,
  buildContextMessages,
  envVarNames,
  omniHome,
  periodStart,
  spend,
  usageByDay,
  usageByProvider,
} from '@omni/core';
import type { OmniEvent } from '@omni/core';
import { CatalogEntry, CliProfile, OmniError, t } from '@omni/shared';
import type { ChatMessage, MessageKey, ModelInfo } from '@omni/shared';
import { redact, StreamRedactor } from '@omni/security';
import { Agent, IDENTITY_PROMPT, cliIdentityBlock, type TaskScope } from './agent.js';
import { withProtocol } from './textTools.js';
import { MAX_IMAGES, addImageParts, imagesAsFiles, visionMode } from './chatImages.js';
import { RunJournal } from './runJournal.js';
import { SuggestionMetrics, predictNextEdit } from './nextEdit.js';
import type { NextEditRequestView, NextEditResultView } from '../shared/lsp.js';
import type { SuggestionKind, SuggestionOutcome, SuggestionStatsRow } from '../shared/nextEdit.js';
import {
  ROOT_FILES,
  RULE_DIRS,
  RuleTracker,
  availableRules,
  contextPaths,
  expandImports,
  hierarchyCandidates,
  nestedRuleSources,
  mentionedRules,
  parseRule,
  rulesPrompt,
  rulesUpdate,
  selectRules,
} from '../shared/rules.js';
import type { ActiveRule, Rule, RuleFeed } from '../shared/rules.js';
import { createKitFile, loadKit } from './hooks.js';
import { hooksFingerprint, type KitKind } from '../shared/agentKit.js';
import { setCredentialEnvNames } from './env.js';
import { openLocal, sealLocal } from './token-store.js';
import { setAppDataDirs } from './system.js';
import type { BrowserController } from './browser.js';
import type { Workspace } from './workspace.js';
import { COMPUTER_MODE_NOTE, type ComputerRunHooks } from './computerTools.js';
import { isAdapterImplemented } from '@omni/providers';
import type {
  ChatEventView,
  ChatRequestView,
  EditRequestView,
  ProviderView,
  ToolDecision,
  UsageReport,
  CompletionRequestView,
  ConversationView,
  CustomProviderSpec,
  SavedMessageView,
  ActiveRulesView,
  AgentKitView,
} from '../shared/api.js';

const CHAT_SYSTEM =
  'You are Zinarix AI, the assistant embedded in the Zinarix Studio code editor. Be concise and precise.\n' +
  IDENTITY_PROMPT +
  '\n' +
  'Use fenced code blocks with a language tag for code. Answer in the language the user writes in. ' +
  'In this chat mode you have no tools. Zinarix Studio also has an Agent mode (the "🤖 Agente" checkbox under the message box) ' +
  'that lets you read and edit files, run terminal commands, use a browser, the network and the security tools, with the user approving each action. ' +
  'If the user asks you to act on their computer (files, terminal, browser, network scan…), tell them to turn on Agent mode; never claim you cannot be connected to their computer.';

const COMPLETE_SYSTEM =
  'You are a code completion engine inside an editor (like GitHub Copilot). Given the code before and after the cursor, ' +
  'output ONLY the text to insert at the cursor: no explanations, no markdown fences, no repetition of the code before the cursor. ' +
  'Prefer short, high-confidence completions (finish the current line or the next few lines). Output nothing if unsure.';

const COMMIT_SYSTEM =
  'You write git commit messages. Given a diff, output only the commit message: a concise summary line ' +
  '(max 72 characters, imperative mood) and, if useful, a blank line and a short bullet list of the main changes. ' +
  'Write it in the language the project already uses in its code comments or, if unclear, in Spanish. No markdown fences.';

const IMPROVE_PROMPT_SYSTEM =
  'You improve prompts before they are sent to an AI assistant. You never answer or carry out the request.';

/** Like titlePrompt: the instructions travel in the user turn (CLI agents drop system prompts). */
function improvePromptRequest(message: string): string {
  return (
    'Rewrite the message between <message> tags so an AI assistant understands it better: fix spelling, ' +
    'state the goal clearly, keep every detail, file name, code and constraint the user gave, and add a short ' +
    'note of the expected result when it helps. Do not invent requirements, do not answer it, do not carry it out. ' +
    'Write it in the same language as the message, speaking as the user. Output ONLY the rewritten message, ' +
    'with no preface, quotes or markdown fences.\n\n<message>\n' +
    message +
    '\n</message>'
  );
}

const TITLE_SYSTEM =
  'You name chat conversations. You never answer or carry out the message: you only label its topic.';

/**
 * The naming request goes in the user turn itself: CLI agents (Claude Code, Codex…) drop
 * system prompts, so with the instructions only there they would start doing the task and
 * their first line ("Voy a revisar…") became the name.
 */
function titlePrompt(message: string): string {
  return (
    'Give a title of 3 to 5 words for the chat that starts with the message between the ' +
    '<message> tags. The title says what the chat is ABOUT (its topic, like "Error de login en React" ' +
    'or "Receta de pan casero"), not what you are going to do: never start with "Voy a", ' +
    '"I will", "Let me" or similar, and do not answer, run or carry out the message. ' +
    'Write it in the same language as the message, with no quotes and no final period. ' +
    'Reply with the title only, on one line.\n\n<message>\n' +
    message +
    '\n</message>'
  );
}

/** Drops answers that describe an action instead of a topic ("Voy a…", "Let me…"). */
const ACTION_TITLE =
  /^(voy a|vamos a|déjame|dejame|claro[,!]|perfecto[,!]|entendido|i'?ll|i will|let me|sure[,!]|okay[,!])/i;

/** Project rules files, first match wins (paths relative to the workspace root). */
export const RULES_FILES = ['.zinarix/rules.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules'];
/** A single rule file bigger than this is skipped (it is not instructions). */
const MAX_RULE_FILE = 256_000;

const EDIT_SYSTEM =
  'You are a code editing engine inside an editor. Rewrite ONLY the selected code so it satisfies the instruction. ' +
  'Output the replacement code and nothing else: no explanations, no markdown fences. Preserve the surrounding indentation style.';

export function describeError(e: unknown): { message: string; code: string } {
  if (e instanceof OmniError) {
    if (e.code === 'auth' && e.status === undefined && e.provider)
      return { code: e.code, message: t('err.no_key', { provider: e.provider }) };
    // The core's hint is for the CLI (`omni use …`): in the app, point to the model picker.
    if (e.code === 'config' && e.message.startsWith('no model selected'))
      return { code: e.code, message: t('err.no_model') };
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
 * or, on systems with none of those, by a locally encrypted file; the user is never prompted.
 */
function vaultPassword(home: string): () => Promise<string> {
  return async () => {
    const file = join(home, 'desktop-vault.key');
    if (safeStorage.isEncryptionAvailable()) {
      if (existsSync(file)) return safeStorage.decryptString(readFileSync(file));
      const pw = randomBytes(32).toString('base64');
      writeFileSync(file, safeStorage.encryptString(pw), { mode: 0o600 });
      return pw;
    }
    const local = `${file}.local`;
    if (existsSync(local)) return openLocal(home, readFileSync(local));
    if (existsSync(file))
      throw new OmniError(
        'config',
        'the OS keychain that protected the vault is unavailable; open it or set OMNI_VAULT_PASSWORD',
      );
    const pw = randomBytes(32).toString('base64');
    writeFileSync(local, sealLocal(home, pw), { mode: 0o600 });
    return pw;
  };
}

type Emit = (requestId: string, ev: ChatEventView) => void;

/** The window a request comes from: its open folder and its browser. */
export interface Scope {
  workspace: () => Workspace | undefined;
  browser?: BrowserController;
  /** Fase 5: a background task (run_command stays in its worktree, limits apply). */
  task?: TaskScope;
  /** "Controlar la compu": the window's bar and minimize while the AI acts (stop = abort). */
  computerUi?: (stop: () => void) => ComputerRunHooks;
}

/**
 * Model text as the UI receives it: streamed through StreamRedactor, so a credential the
 * model repeats (a loaded key, a token pattern) never reaches the DOM, even when it arrives
 * split across chunks. Buffered text is released before any other event, keeping order.
 */
export function safeStream(emit: Emit): { emit: Emit; flush: (requestId: string) => void } {
  const text = new StreamRedactor();
  const reasoning = new StreamRedactor();
  const release = (rid: string) => {
    const t = text.flush();
    if (t) emit(rid, { type: 'text', delta: t });
    const r = reasoning.flush();
    if (r) emit(rid, { type: 'reasoning', delta: r });
  };
  return {
    emit: (rid, ev) => {
      if (ev.type === 'text' || ev.type === 'reasoning') {
        const safe = (ev.type === 'text' ? text : reasoning).push(ev.delta);
        if (safe) emit(rid, { type: ev.type, delta: safe });
        return;
      }
      release(rid);
      emit(rid, ev);
    },
    flush: release,
  };
}

export class AiService {
  readonly core: OmniCore;
  private readonly running = new Map<string, AbortController>();
  private readonly decisions = new Map<string, (d: ToolDecision) => void>();
  /** ask_user questions waiting for the user (Fase 3). */
  private readonly answers = new Map<string, (a: string[] | null) => void>();
  readonly agent: Agent;
  /** Agent runs in progress, on disk (continued after a shutdown). */
  private readonly journal: RunJournal;
  /** Settings toggle: include the project rules file in prompts. */
  useRules = true;
  /** Told when a new conversation gets its AI-written title (main sends it to the windows). */
  onTitle?: (conversationId: string, title: string) => void;
  /** What the plan includes (delegation between AIs is Pro). */
  features: () => { delegation: boolean } = () => ({ delegation: true });

  /** Used when a call does not say which window it comes from (CLI tests, one window). */
  private readonly scope: Scope;

  /** Fase 8: acceptance and latency of the editor suggestions, per model. */
  readonly metrics: SuggestionMetrics;
  /** Model that answered the last suggestion of each kind (accept/dismiss events use it). */
  private lastSuggestModel: Record<SuggestionKind, string> = { inline: '', nextEdit: '' };

  constructor(
    workspace: () => Workspace | undefined = () => undefined,
    home = omniHome(),
    browser?: BrowserController,
  ) {
    this.scope = { workspace, browser };
    this.core = OmniCore.open({ home, askPassword: vaultPassword(home) });
    this.agent = new Agent(this.core, workspace, browser);
    this.journal = new RunJournal(join(this.core.paths.home, 'runs-in-progress.json'));
    this.metrics = new SuggestionMetrics(join(this.core.paths.home, 'suggestion-metrics.json'));
    // Child shells never get the provider keys the app can read from the environment.
    setAppDataDirs([this.core.paths.home, dirname(this.core.paths.config)]);
    setCredentialEnvNames(this.core.providers().flatMap((p) => envVarNames(p)));
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
        placeholder: bp.default ?? (bp.optional ? '' : undefined),
      })),
      implemented: isAdapterImplemented(p.adapter),
      models: p.fallbackModels,
      local: p.category === 'local' || p.region === 'local',
      custom: this.core.config.customProviders.some((c) => c.id === p.id),
    }));
  }

  /** Free kebab-case id for a new custom provider ("Mi servidor" -> "mi-servidor-2"). */
  private customId(name: string): string {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'custom';
    const taken = new Set(this.core.providers().map((p) => p.id));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  addCustomProvider(spec: CustomProviderSpec, id?: string): string {
    const existing = id ? this.core.config.customProviders.find((c) => c.id === id) : undefined;
    if (id && !existing)
      throw new OmniError('config', `"${id}" no es un proveedor personalizado`, {
        retryable: false,
      });
    const pid = existing?.id ?? this.customId(spec.name);
    const models = [...new Set((spec.models ?? []).map((m) => m.trim()).filter(Boolean))];
    const supports = {
      listModels: true,
      streaming: true,
      tools: spec.kind === 'api',
      vision: false,
      jsonMode: spec.kind === 'api',
      embeddings: false,
      fim: false,
    };
    let entry: CatalogEntry;
    let providers = this.core.config.providers;
    if (spec.kind === 'api') {
      const header = spec.authHeader?.trim();
      entry = CatalogEntry.parse({
        id: pid,
        name: spec.name.trim(),
        adapter: spec.adapter,
        baseUrl: spec.baseUrl.trim().replace(/\/+$/, ''),
        auth: spec.noAuth
          ? { type: 'none', optional: true }
          : header && header.toLowerCase() !== 'authorization'
            ? { type: 'header', header }
            : { type: 'bearer', header: 'Authorization' },
        region: spec.local ? 'local' : 'global',
        category: spec.local ? 'local' : 'custom',
        modelsEndpoint: '/models',
        supports,
        fallbackModels: models.map((m) => ({ id: m })),
        status: 'active',
        verifiedAt: null,
        notes: 'user-defined endpoint',
      });
    } else {
      const profile = CliProfile.parse(spec.profile);
      const raw = spec.command.trim();
      // A full path goes in the "command" param; the entry keeps only the program name.
      const name = raw
        .split(/[\\/]/)
        .pop()!
        .replace(/\.(exe|cmd|bat)$/i, '');
      const program = name
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')
        .replace(/^[^a-z0-9]+/, '');
      if (!program)
        throw new OmniError('config', `nombre de programa no válido: "${raw}"`, {
          retryable: false,
        });
      entry = CatalogEntry.parse({
        id: pid,
        name: spec.name.trim(),
        adapter: 'cli-agent',
        baseUrl: 'http://localhost',
        baseUrlParams: [
          ...(profile === 'generic'
            ? []
            : [
                {
                  name: 'mode',
                  label:
                    'Permisos en modo agente: read (solo responde), edit (edita archivos del proyecto), full (todo, sin preguntar)',
                  default: 'edit',
                  optional: true,
                },
              ]),
          {
            name: 'command',
            label: 'Ruta del programa (si no está en el PATH)',
            default: program,
            optional: true,
          },
        ],
        auth: { type: 'none' },
        region: 'local',
        category: 'cli',
        modelsEndpoint: null,
        supports,
        fallbackModels: [
          { id: 'default', label: 'Modelo por defecto del CLI' },
          ...models.filter((m) => m !== 'default').map((m) => ({ id: m })),
        ],
        cli: {
          profile,
          command: program,
          ...(profile === 'generic' && spec.args?.length ? { args: spec.args } : {}),
        },
        status: 'active',
        verifiedAt: null,
        notes: 'user-defined CLI',
      });
      if (raw !== program) {
        const prev = providers[pid];
        providers = {
          ...providers,
          [pid]: {
            ...prev,
            params: { ...prev?.params, command: raw },
            headers: prev?.headers ?? {},
          },
        };
      }
    }
    const others = this.core.config.customProviders.filter((c) => c.id !== pid);
    this.core.saveConfig({ ...this.core.config, providers, customProviders: [...others, entry] });
    this.core.models.invalidate(pid);
    return pid;
  }

  async deleteCustomProvider(id: string): Promise<void> {
    if (!this.core.config.customProviders.some((c) => c.id === id)) return;
    await this.core.vault.delete(id);
    const { [id]: _gone, ...providers } = this.core.config.providers;
    const roles = Object.fromEntries(
      Object.entries(this.core.config.roles).filter(([, ref]) => !ref?.startsWith(`${id}/`)),
    );
    const defaultModel = this.core.config.defaultModel?.startsWith(`${id}/`)
      ? undefined
      : this.core.config.defaultModel;
    this.core.saveConfig({
      ...this.core.config,
      providers,
      roles,
      defaultModel,
      fallbacks: this.core.config.fallbacks.filter((r) => !r.startsWith(`${id}/`)),
      customProviders: this.core.config.customProviders.filter((c) => c.id !== id),
    });
    this.core.models.invalidate(id);
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

  private isCliModel(model: string | undefined, role: 'chat' | 'agent'): boolean {
    try {
      const ref = this.core.resolveModel(model, role);
      return this.core.provider(ref.provider).adapter === 'cli-agent';
    } catch {
      return false;
    }
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

  private newConversation(
    req: ChatRequestView,
    requestId: string,
    emit: Emit,
    scope: Scope,
  ): string {
    let id = req.conversationId;
    if (!id || !this.core.history.get(id)) {
      id = this.core.history.create(
        req.prompt.split('\n')[0]!.slice(0, 80) || 'chat',
        req.model,
        scope.workspace()?.root,
      ).id;
      void this.autoTitle(id, req.prompt, req.model);
    }
    // Tell the UI right away, so the conversation is known even if the request fails.
    emit(requestId, { type: 'conversation', id });
    this.core.history.append(id, { role: 'user', content: req.prompt }, undefined, {
      context: req.context.map((c) => c.source),
      agent: Boolean(req.agent),
      request: requestId,
    });
    return id;
  }

  async chat(
    requestId: string,
    req: ChatRequestView,
    emit: Emit,
    scope: Scope = this.scope,
  ): Promise<void> {
    const out = safeStream(emit);
    try {
      await this.chatTurn(requestId, req, out.emit, scope);
    } finally {
      out.flush(requestId);
    }
  }

  private async chatTurn(
    requestId: string,
    req: ChatRequestView,
    emit: Emit,
    scope: Scope,
  ): Promise<void> {
    if (req.agent) return this.agentChat(requestId, req, emit, scope);
    const [system, user] = buildContextMessages(
      req.prompt,
      req.context,
      CHAT_SYSTEM +
        this.rulesBlock(
          scope,
          req.context.map((c) => c.source),
          req.prompt,
        ),
    ) as [ChatMessage, ChatMessage];
    const img = this.withImages(user, req, 'chat', requestId, emit);
    let messages: ChatMessage[] = [system, ...recentHistory(req.history), img];
    // CLI agents (Claude Code, Codex…) drop the system prompt: the identity rides on the user message.
    if (this.isCliModel(req.model, 'chat'))
      messages = withProtocol(messages, cliIdentityBlock(), 'user');
    let conversationId: string;
    try {
      conversationId = this.newConversation(req, requestId, emit, scope);
    } catch (e) {
      // History not writable (database locked, disk full): the UI must still hear about it.
      const d = describeError(e);
      emit(requestId, { type: 'error', code: d.code, message: d.message });
      return;
    }
    const rec = new TurnRecorder(requestId);
    const send: Emit = (rid, ev) => {
      rec.add(ev);
      emit(rid, ev);
    };
    const cwd = scope.workspace()?.root;
    await this.run(
      requestId,
      { model: req.model, messages, role: 'chat', cwd, reasoning: req.reasoning },
      (ev) => {
        if (ev.type === 'start') {
          send(requestId, { ...ev, conversationId });
          return;
        }
        forward(requestId, ev, send);
      },
    );
    saveTurn(rec, this.core, conversationId);
  }

  /** Adds the pasted images to the user's message the way the model can take them. */
  private withImages(
    message: ChatMessage,
    req: ChatRequestView,
    role: 'chat' | 'agent',
    requestId: string,
    emit: Emit,
  ): ChatMessage {
    const images = (req.images ?? []).slice(0, MAX_IMAGES);
    if (!images.length) return message;
    const mode = visionMode(this.core, req.model, role);
    if (mode === 'none') {
      emit(requestId, {
        type: 'notice',
        kind: 'vision',
        message:
          'Este modelo no acepta imágenes: se envió solo el texto. Elige un modelo con visión (filtro 👁 en el selector).',
      });
      return message;
    }
    return mode === 'files' ? imagesAsFiles(message, images) : addImageParts(message, images);
  }

  /** Agent mode: multi-step tool use over the open workspace, with approvals. */
  private async agentChat(
    requestId: string,
    req: ChatRequestView,
    emit: Emit,
    scope: Scope,
  ): Promise<void> {
    const ctrl = new AbortController();
    this.running.set(requestId, ctrl);
    const rec = new TurnRecorder(requestId, req.mode);
    // "Controlar la compu" (not in plan mode: it changes nothing until the plan is approved).
    const pc =
      req.computer && req.mode !== 'plan' && !scope.task
        ? scope.computerUi?.(() => ctrl.abort())
        : undefined;
    const at = Date.now();
    let convId: string | undefined;
    const send = (ev: ChatEventView) => {
      rec.add(ev);
      // On disk at every step: a power cut leaves what was done for the next start.
      if (convId)
        this.journal.put(
          requestId,
          { conversationId: convId, prompt: req.prompt, ...rec.progress(), at },
          ev.type === 'text' || ev.type === 'reasoning' || ev.type === 'tool_output',
        );
      if (pc && ev.type === 'tool_approval') pc.needUser();
      emit(requestId, ev);
    };
    try {
      // Inside the try: a history failure (database locked, disk full) reaches the UI as an
      // error event instead of leaving the chat busy forever.
      convId = this.newConversation(req, requestId, emit, scope);
      const id = convId;
      this.journal.put(requestId, {
        conversationId: id,
        prompt: req.prompt,
        ...rec.progress(),
        at,
      });
      const userMessage = this.withImages(
        buildContextMessages(req.prompt, req.context).at(-1)!,
        req,
        'agent',
        requestId,
        emit,
      );
      await this.agent.run({
        conversationId: convId,
        turn: requestId,
        model: req.model,
        reasoning: req.reasoning,
        mode: req.mode,
        scope,
        delegation: this.features().delegation,
        ...(pc ? { computer: pc } : {}),
        rules:
          this.rulesBlock(
            scope,
            req.context.map((c) => c.source),
            req.prompt,
          ) + (pc ? COMPUTER_MODE_NOTE : ''),
        ruleFeed: this.ruleFeed(
          scope,
          new RuleTracker(
            this.rulesFor(
              scope,
              req.context.map((c) => c.source),
              req.prompt,
            ).active,
          ),
        ),
        userMessage,
        fallbackHistory: recentHistory(req.history),
        signal: ctrl.signal,
        emit: (ev) => send(ev.type === 'start' ? { ...ev, conversationId: id } : ev),
        ask: (toolCallId) =>
          new Promise<ToolDecision>((resolve) => {
            // Stopped while the tool was being prepared: nobody will answer, so it is a no.
            if (ctrl.signal.aborted) return resolve('deny');
            const key = `${requestId}:${toolCallId}`;
            const onAbort = () => {
              this.decisions.delete(key);
              resolve('deny');
            };
            this.decisions.set(key, (d) => {
              ctrl.signal.removeEventListener('abort', onAbort);
              resolve(d);
            });
            ctrl.signal.addEventListener('abort', onAbort, { once: true });
          }),
        answer: (toolCallId) =>
          new Promise<string[] | null>((resolve) => {
            if (ctrl.signal.aborted) return resolve(null);
            pc?.needUser();
            const key = `${requestId}:${toolCallId}`;
            const onAbort = () => {
              this.answers.delete(key);
              resolve(null);
            };
            this.answers.set(key, (a) => {
              ctrl.signal.removeEventListener('abort', onAbort);
              resolve(a);
            });
            ctrl.signal.addEventListener('abort', onAbort, { once: true });
          }),
      });
    } catch (e) {
      const d = describeError(e);
      send({ type: 'error', code: d.code, message: d.message });
    } finally {
      pc?.end();
      this.running.delete(requestId);
      if (convId) saveTurn(rec, this.core, convId);
      this.journal.drop(requestId);
    }
  }

  /**
   * Agent runs the last session left halfway (the app or the computer went off): what each
   * one did is saved as its answer, so the chat that continues it knows which steps are done.
   * Returns their conversations.
   */
  recoverInterrupted(): string[] {
    const out: string[] = [];
    for (const e of this.journal.takeLeftovers()) {
      try {
        if (!this.core.history.get(e.conversationId)) continue;
        const display: TurnDisplay = {
          ...e.display,
          notices: [...(e.display.notices ?? []), t('run.interrupted')],
        };
        this.core.history.append(
          e.conversationId,
          { role: 'assistant', content: interruptedContent(e.text, display) },
          display.model,
          display,
        );
        out.push(e.conversationId);
      } catch (err) {
        console.error('could not recover a run', redact(String(err)));
      }
    }
    return out;
  }

  /** The main project rules file (to open from "Edit rules"), if any. */
  rulesFile(scope: Scope = this.scope): string | null {
    const ws = scope.workspace();
    if (!ws || !this.useRules) return null;
    for (const f of RULES_FILES) {
      try {
        if (existsSync(ws.resolve(f))) return f;
      } catch {
        // a symlink leaving the workspace is ignored
      }
    }
    return null;
  }

  /**
   * Every rule file of the project that could apply to these context paths: AGENTS.md /
   * CLAUDE.md from the root down to each path's folder, the root-only files and the single
   * rules of .zinarix/rules and .cursor/rules.
   */
  loadRules(scope: Scope, paths: string[]): Rule[] {
    const ws = scope.workspace();
    if (!ws || !this.useRules) return [];
    const read = (rel: string): string | null => {
      try {
        const abs = ws.resolve(rel);
        if (!existsSync(abs) || !statSync(abs).isFile() || statSync(abs).size > MAX_RULE_FILE)
          return null;
        return readFileSync(abs, 'utf8');
      } catch {
        return null; // outside the workspace (symlink) or unreadable
      }
    };
    const out: Rule[] = [];
    // "@docs/style.md" lines pull that file in (a CLAUDE.md that only says "@AGENTS.md").
    const rule = (rel: string, text: string, kind: Rule['kind']): Rule => {
      const r = parseRule(rel, text, kind);
      return { ...r, body: expandImports(r.body, rel, read).trim() };
    };
    for (const f of ROOT_FILES) {
      const text = read(f.path);
      if (text !== null) out.push(rule(f.path, text, f.kind));
    }
    for (const rel of hierarchyCandidates(paths)) {
      const text = read(rel);
      if (text !== null) out.push(rule(rel, text, 'instructions'));
    }
    // Fase 1: .cursor/rules and copilot-instructions.md also count inside sub-folders.
    const nested = nestedRuleSources(paths);
    for (const rel of nested.files) {
      const text = read(rel.path);
      if (text !== null) out.push(rule(rel.path, text, rel.kind));
    }
    for (const d of [...RULE_DIRS, ...nested.dirs]) {
      let names: string[] = [];
      try {
        const abs = ws.resolve(d.dir);
        if (existsSync(abs))
          names = readdirSync(abs).filter((n) => n.toLowerCase().endsWith(d.ext));
      } catch {
        continue;
      }
      for (const n of names.sort().slice(0, 200)) {
        const rel = `${d.dir}/${n}`;
        const text = read(rel);
        if (text !== null) out.push(rule(rel, text, d.kind));
      }
    }
    return out;
  }

  /** The rules that enter a prompt with this context, and the ones left for later. */
  rulesFor(
    scope: Scope,
    sources: string[] = [],
    prompt = '',
  ): { active: ActiveRule[]; available: Rule[] } {
    const paths = contextPaths(sources, scope.workspace()?.root);
    const rules = this.loadRules(scope, paths);
    const active = selectRules(rules, paths, mentionedRules(prompt));
    return { active, available: availableRules(rules, active) };
  }

  /** Rules for the files an agent run opens or edits after its first prompt (see RuleTracker). */
  private ruleFeed(scope: Scope, tracker: RuleTracker): RuleFeed {
    return {
      forFile: (path) => {
        if (!this.useRules) return '';
        const [rel] = contextPaths([`file:${path}`], scope.workspace()?.root);
        if (!rel) return '';
        return rulesUpdate(rel, tracker.next(this.loadRules(scope, [rel]), [rel]), redact);
      },
      fork: () => this.ruleFeed(scope, tracker.fork()),
    };
  }

  /** What the "active rules" panel shows for a chat about to send this context. */
  activeRules(scope: Scope, sources: string[] = [], prompt = ''): ActiveRulesView {
    const { active, available } = this.rulesFor(scope, sources, prompt);
    const { truncated } = rulesPrompt(active, available);
    const view = (r: Rule) => ({
      path: r.path,
      name: r.name,
      kind: r.kind,
      applies: r.applies,
      globs: r.globs,
      description: r.description,
    });
    return {
      enabled: this.useRules,
      active: active.map((r) => ({ ...view(r), reason: r.reason, tokens: r.tokens })),
      available: available.map(view),
      truncated,
      tokens: active.reduce((n, r) => n + r.tokens, 0),
    };
  }

  /** Subagents, skills, "/" commands and hooks for the chat (Fase 4). */
  agentKit(scope: Scope): AgentKitView {
    const kit = loadKit(scope.workspace(), this.agent.userKitRoot);
    return {
      commands: kit.commands.map((c) => ({
        name: c.name,
        description: c.description,
        ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}),
        ...(c.agent !== undefined ? { agent: c.agent } : {}),
        body: c.body,
        path: c.path,
      })),
      agents: kit.agents.map((a) => ({
        name: a.name,
        description: a.description,
        ...(a.model ? { model: a.model } : {}),
        ...(a.tools ? { tools: a.tools } : {}),
        path: a.path,
      })),
      skills: kit.skills.map((k) => ({ name: k.name, description: k.description, dir: k.dir })),
      hooks: kit.hooks.map((h) => ({
        event: h.event,
        matcher: h.matcher,
        command: h.command,
        source: h.source,
      })),
      hooksTrusted:
        kit.hooks.length > 0 &&
        Boolean(
          this.agent.hookTrust?.has(scope.workspace()?.root ?? '', hooksFingerprint(kit.hooks)),
        ),
    };
  }

  /** "Nuevo subagente / skill / comando" of the kit panel: the file, ready to edit. */
  createKitFile(scope: Scope, kind: KitKind, name: string): string {
    const ws = scope.workspace();
    if (!ws) throw new OmniError('config', 'Abre una carpeta para crear archivos del agente.');
    return createKitFile(ws, kind, name);
  }

  /** System-prompt block with the project rules (style and conventions, never safety overrides). */
  rulesBlock(scope: Scope = this.scope, sources: string[] = [], prompt = ''): string {
    // Memories (Settings › Memories, the remember tool) apply to plain chat and the agent.
    const memories = this.agent.knowledge?.promptBlock(scope.workspace()?.root) ?? '';
    return this.projectRules(scope, sources, prompt) + memories;
  }

  private projectRules(scope: Scope, sources: string[], prompt: string): string {
    const { active, available } = this.rulesFor(scope, sources, prompt);
    return rulesPrompt(active, available, redact).text;
  }

  /** Inline (ghost-text) completion. Errors and aborts just mean "no suggestion". */
  async complete(requestId: string, req: CompletionRequestView): Promise<string> {
    const ctrl = new AbortController();
    this.running.set(requestId, ctrl);
    const t0 = Date.now();
    try {
      const prefix = req.prefix.slice(-4000);
      const suffix = req.suffix.slice(0, 1500);
      const r = await this.core.complete(
        {
          role: 'inline',
          noFallback: true,
          maxTokens: 256,
          temperature: 0.2,
          messages: [
            { role: 'system', content: COMPLETE_SYSTEM },
            {
              role: 'user',
              content:
                `File: ${req.path} (language: ${req.language})\n` +
                `<before-cursor>\n${prefix}</before-cursor>\n<after-cursor>\n${suffix}\n</after-cursor>\n` +
                'Text to insert at the cursor:',
            },
          ],
        },
        ctrl.signal,
      );
      const text = cleanCompletion(r.text, prefix, suffix);
      const model = r.provider && r.model ? `${r.provider}/${r.model}` : r.model;
      if (model) {
        this.lastSuggestModel.inline = model;
        void this.metrics.record([
          { kind: 'inline', model, outcome: text ? 'shown' : 'empty', latencyMs: Date.now() - t0 },
        ]);
      }
      return text;
    } catch {
      if (!ctrl.signal.aborted && this.lastSuggestModel.inline)
        void this.metrics.record([
          { kind: 'inline', model: this.lastSuggestModel.inline, outcome: 'error' },
        ]);
      return '';
    } finally {
      this.running.delete(requestId);
    }
  }

  /** Next-edit prediction ("Tab" jumps to it); null = no suggestion. Abortable like complete. */
  async nextEdit(requestId: string, req: NextEditRequestView): Promise<NextEditResultView> {
    const ctrl = new AbortController();
    this.running.set(requestId, ctrl);
    try {
      const r = await predictNextEdit(this.core, req, ctrl.signal);
      // Cancelled requests (the user kept typing) say nothing about the model.
      if (!ctrl.signal.aborted && r.model) {
        this.lastSuggestModel.nextEdit = r.model;
        void this.metrics.record([
          {
            kind: 'nextEdit',
            model: r.model,
            outcome: r.error ? 'error' : r.hunks.length ? 'shown' : 'empty',
            latencyMs: r.latencyMs,
          },
        ]);
      }
      return r;
    } finally {
      this.running.delete(requestId);
    }
  }

  /** The editor reports what the user did with a suggestion (accepted / dismissed). */
  suggestionOutcome(
    kind: SuggestionKind,
    outcome: Extract<SuggestionOutcome, 'accepted' | 'dismissed'>,
    count = 1,
  ): void {
    const model = this.lastSuggestModel[kind];
    if (!model) return;
    const n = Math.max(1, Math.min(8, Math.trunc(count)));
    void this.metrics.record(Array.from({ length: n }, () => ({ kind, model, outcome })));
  }

  suggestionStats(): Promise<SuggestionStatsRow[]> {
    return this.metrics.stats();
  }

  async commitMessage(patch: string): Promise<string> {
    if (!patch.trim()) throw new Error('No hay cambios para describir.');
    const ctrl = new AbortController();
    const r = await this.core.complete(
      {
        role: 'chat',
        maxTokens: 400,
        messages: buildContextMessages(
          'Write the commit message for this diff.',
          [{ source: 'git-diff', content: patch }],
          COMMIT_SYSTEM,
        ),
      },
      ctrl.signal,
    );
    return r.text.replace(/^```[\w-]*\n?|```\s*$/g, '').trim();
  }

  /**
   * Rewrites what the user is about to send so the AI understands it better (clearer goal,
   * context and expected result), in the user's language. Nothing is sent to the chat: the
   * user reviews the new text first.
   */
  async improvePrompt(prompt: string, model?: string): Promise<string> {
    if (!prompt.trim()) throw new Error('No hay nada que mejorar.');
    const r = await this.core.complete(
      {
        model,
        role: 'chat',
        maxTokens: 1200,
        messages: [
          { role: 'system', content: IMPROVE_PROMPT_SYSTEM },
          { role: 'user', content: improvePromptRequest(prompt.slice(0, 20000)) },
        ],
      },
      new AbortController().signal,
    );
    const text = r.text.replace(/^```[\w-]*\n?|```\s*$/g, '').trim();
    if (!text) throw new Error('La IA no devolvió texto.');
    return text;
  }

  /** Names a new conversation after what it is about, in a few words; quiet on failure. */
  private async autoTitle(id: string, prompt: string, model?: string): Promise<void> {
    if (!prompt.trim()) return;
    try {
      const r = await this.core.complete(
        {
          model,
          role: 'chat',
          maxTokens: 30,
          messages: [
            { role: 'system', content: TITLE_SYSTEM },
            { role: 'user', content: titlePrompt(prompt.slice(0, 2000)) },
          ],
        },
        new AbortController().signal,
      );
      const title = r.text
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean)
        ?.replace(/^(title|título|titulo)\s*:\s*/i, '')
        .replace(/^["'`*#\s]+|["'`*.\s]+$/g, '')
        .split(/\s+/)
        .slice(0, 6)
        .join(' ')
        .slice(0, 60);
      if (!title || ACTION_TITLE.test(title) || !this.core.history.get(id)) return;
      this.core.history.rename(id, title);
      this.onTitle?.(id, title);
    } catch {
      // No title from the AI: the first line of the message stays as the name.
    }
  }

  conversations(
    query: string,
    onlyProject: boolean,
    scope: Scope = this.scope,
  ): ConversationView[] {
    const project = onlyProject ? scope.workspace()?.root : undefined;
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

  moveConversation(id: string, folder: string): void {
    this.core.history.move(id, folder);
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

  answerQuestion(requestId: string, toolCallId: string, answer: string[] | null): void {
    const key = `${requestId}:${toolCallId}`;
    this.answers.get(key)?.(answer);
    this.answers.delete(key);
  }

  resetContext(conversationId: string): void {
    this.agent.resetMessages(conversationId);
  }

  revert(conversationId: string, scope: Scope = this.scope): Promise<string[]> {
    return this.agent.revert(conversationId, scope.workspace);
  }

  /**
   * "Volver aquí" on the conversation (Fase 2): the saved history loses that question and
   * everything after it, and the agent rebuilds its context from what is left.
   */
  rewindConversation(conversationId: string, userIndex: number): number {
    const n = this.core.history.truncateAtUser(conversationId, userIndex);
    this.agent.resetMessages(conversationId);
    return n;
  }

  /** "Volver aquí": files back to before the first of these exchanges (Fase 2). */
  rewind(conversationId: string, turns: string[], scope: Scope = this.scope): Promise<string[]> {
    return this.agent.rewind(conversationId, turns, scope.workspace);
  }

  rewindPreview(conversationId: string, turns: string[], scope: Scope = this.scope) {
    return this.agent.rewindPreview(conversationId, turns, scope.workspace);
  }

  turnDiff(conversationId: string, turn: string, scope: Scope = this.scope) {
    return this.agent.turnDiff(conversationId, turn, scope.workspace);
  }

  applyReview(
    conversationId: string,
    turn: string,
    path: string,
    rejected: number[],
    scope: Scope = this.scope,
  ): Promise<string | null> {
    return this.agent.applyReview(conversationId, turn, path, rejected, scope.workspace);
  }

  async edit(requestId: string, req: EditRequestView, emitRaw: Emit): Promise<void> {
    const out = safeStream(emitRaw);
    const emit = out.emit;
    const messages = buildContextMessages(
      `Instruction: ${req.instruction}\n\nReturn only the new code that replaces the <untrusted source="selection"> block.`,
      [
        { source: `before-selection:${req.path}`, content: req.before.slice(-4000) },
        { source: 'selection', content: req.selection },
        { source: `after-selection:${req.path}`, content: req.after.slice(0, 4000) },
      ],
      `${EDIT_SYSTEM}\nFile: ${req.path} (language: ${req.language}).`,
    );
    try {
      await this.run(requestId, { model: req.model, messages, role: 'inline' }, (ev) =>
        forward(requestId, ev, emit),
      );
    } finally {
      out.flush(requestId);
    }
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

/** Strips fences and any echo of the code around the cursor from a model completion. */
export function cleanCompletion(text: string, prefix: string, suffix: string): string {
  let out = text.replace(/\r/g, '');
  const fence = /^\s*```[\w+#.-]*\n([\s\S]*?)(\n```\s*)?$/.exec(out);
  if (fence) out = fence[1]!;
  // The model sometimes repeats the current line before continuing it.
  const lastLine = prefix.slice(prefix.lastIndexOf('\n') + 1);
  if (lastLine.trim() && out.startsWith(lastLine)) out = out.slice(lastLine.length);
  // …or repeats the code that already follows the cursor.
  const next = suffix.trimStart().slice(0, 40);
  if (next.length > 8) {
    const at = out.indexOf(next);
    if (at >= 0) out = out.slice(0, at);
  }
  const lines = out.split('\n');
  if (lines.length > 16) out = lines.slice(0, 16).join('\n');
  return out.trim() ? out.replace(/\s+$/, '') : '';
}

/**
 * Earlier turns sent with a request: only the most recent ones (the renderer sends the whole
 * conversation; very long ones would be rejected or overflow the model's context). Starts
 * on a user message so the model never sees an orphan answer first.
 */
export const HISTORY_KEEP = 200;
export function recentHistory(history: ChatMessage[]): ChatMessage[] {
  const h = history.filter((m) => m.role !== 'system').slice(-HISTORY_KEEP);
  const first = h.findIndex((m) => m.role === 'user');
  return first < 0 ? [] : h.slice(first);
}

/**
 * The answer of a run a shutdown cut: its text plus the steps it took, written out because the
 * model only gets the text of past turns (the tool cards are display only).
 */
function interruptedContent(text: string, d: TurnDisplay): string {
  const steps = d.parts.flatMap((p) => {
    if (p.kind !== 'tool') return [];
    const a = p.args as { path?: unknown; command?: unknown };
    const target = p.preview?.path ?? p.preview?.command ?? a.path ?? a.command;
    const what = typeof target === 'string' && target ? ` ${target.slice(0, 200)}` : '';
    const how = p.summary
      ? `: ${p.summary.slice(0, 300)}`
      : p.status === 'ok'
        ? ''
        : ' (no result)';
    return [`- ${p.name}${what}${how}`];
  });
  return [
    text.trim(),
    steps.length ? `[Steps already taken before the cut]\n${steps.join('\n')}` : '',
    '[The app or the computer went off here; the last step may be unfinished.]',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Saving the turn must not throw past the request (the UI already got its events). */
function saveTurn(rec: TurnRecorder, core: OmniCore, conversationId: string): void {
  try {
    rec.save(core, conversationId);
  } catch (e) {
    console.error('could not save the turn', redact(e instanceof Error ? e.message : String(e)));
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
        /** Helper AI that made the call (delegate_to_ai). */
        agent?: string;
        status: 'ok' | 'error';
        summary?: string;
        output?: string;
        preview?: {
          path?: string;
          command?: string;
          delegate?: { model: string; mode: 'agent' | 'chat' };
        };
      }
  )[];
  model?: string;
  reasoning?: string;
  notices?: string[];
  meta?: { usd: number | null; inputTokens: number; outputTokens: number; latencyMs: number };
  error?: string;
  /** Request that produced it (the same one is on its question): pairs answers sent alongside. */
  request?: string;
  /** Fase 3: the agent mode it ran in (a plan-mode answer is a plan to approve). */
  mode?: 'plan' | 'agent' | 'auto' | 'full';
}

const MAX_SAVED_OUTPUT = 8000;

/** Mirrors the chat events of one turn so the whole turn can be restored later. */
export class TurnRecorder {
  private readonly d: TurnDisplay;
  private text = '';

  constructor(request?: string, mode?: TurnDisplay['mode']) {
    this.d = { parts: [], ...(request ? { request } : {}), ...(mode ? { mode } : {}) };
  }

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
        d.reasoning = ((d.reasoning ?? '') + ev.delta).slice(-200000);
        break;
      case 'notice':
        (d.notices ??= []).push(ev.message);
        break;
      case 'tool_call':
        d.parts.push({
          kind: 'tool',
          id: ev.id,
          name: ev.name,
          args: ev.args,
          ...(ev.agent ? { agent: ev.agent } : {}),
          status: 'error',
        });
        break;
      case 'tool_approval': {
        const step = this.step(ev.id);
        if (step)
          step.preview = {
            path: ev.preview.path,
            command: ev.preview.command,
            ...(ev.preview.delegate ? { delegate: ev.preview.delegate } : {}),
          };
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

  /** The turn so far (for the run journal). */
  progress(): { text: string; display: TurnDisplay } {
    return { text: this.text, display: this.d };
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
