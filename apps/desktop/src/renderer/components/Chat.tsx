import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  ActiveRulesView,
  AgentKitView,
  ChatContext,
  ChatEventView,
  ConversationView,
  OmniApi,
  PhoneAction,
  PhoneSnapshot,
  ToolDecision,
  ToolPreview,
} from '../../shared/api';
import { expandCommand, skillPrompt } from '../../shared/agentKit';
import { AgentKitMenu, type KitKind } from './AgentKitMenu';
import {
  NEW_TASK_EVENT,
  TasksPanel,
  taskBadge,
  useTasks,
  type NewTaskSeed,
} from './TasksPanel';
import { pressable } from '../a11y';
import { confirmDialog } from '../confirm';
import { errText } from '../errText';
import { formatUsd } from '../format';
import { lang, t } from '../i18n';
import { languageFor, monaco } from '../monaco';
import { monacoTheme } from '../themes';
import {
  api,
  chatFolder,
  chatTab,
  closeChat,
  focusedChat,
  forgetProject,
  getEditor,
  getState,
  isChatVisible,
  newChat,
  newChatInFolder,
  newParallelChat,
  newQuestionChat,
  newRequestId,
  openFile,
  rememberProject,
  reloadFromDisk,
  refreshSettings,
  saveAgentMode,
  saveChatMode,
  selectChat,
  setState,
  toast,
  toggleChatList,
  toggleChatSplit,
  updateChat,
  useStore,
  type ChatTab,
} from '../store';
import { commands, runCommand } from '../commands';
import { fileIcon } from './icons';
import { Icon, TONE, type IconName } from './Icon';
import { OfflineGames, useOnline } from './OfflineGames';
import { tv } from './video/strings';
import { openStudio } from './video/videoStore';
import { ProviderLogo } from './ProviderLogo';
import { ChatHistory, when } from './ChatHistory';
import { DeleteSavedChat, LimitedList, RecentChats } from './ChatListParts';
import { SendButton, useDismiss, menuArrows } from './ChatSendMenu';
import { Markdown } from './Markdown';
import { DiffReview, RewindDialog, type RewindMode } from './DiffReview';
import {
  latestTodos,
  ModeMenu,
  modeHint,
  modeLabel,
  PlanBar,
  PlanEditor,
  QuestionCard,
  TaskList,
} from './AgentPlan';
import type { ChatMode } from '../../shared/agentModes';
import { QUEUE_RETRY_DELAYS, queueRetryDelay } from '../../shared/chatQueue';
import {
  modeFrom,
  nextMode,
  planApprovedPrompt,
  planStates,
  usesAgent,
  type PlanState,
} from '../../shared/agentModes';
import {
  activeTerminalId,
  listTerminals,
  sendTerminalToChat,
  terminalContext,
  terminalIdByNumber,
  type TerminalSession,
} from './Terminal';
import { currentProblems } from './Problems';
import {
  MENTION_KINDS,
  formatProblems,
  mentionSource,
  parseMentions,
  stripMentions,
} from '../../shared/mentions';
import type { MentionKind } from '../../shared/mentions';
import './chat-composer.css';
import { PhasesPanel, PhasesPicker, ps, usePhases } from './PhasesPanel';
import { isAnalyzePrompt } from '../../shared/phases';

const NO_KIT_COMMANDS: AgentKitView['commands'] = [];
const NO_KIT_SKILLS: AgentKitView['skills'] = [];

/** Readable label for a context source ("file:src/a.ts", "terminal:2:selection", …). */
function contextLabel(source: string): string {
  const term = /^terminal:(\d+)(:selection)?$/.exec(source);
  if (term) return t(term[2] ? 'termSelection' : 'termSession', { n: term[1]! });
  // Fase 8 mentions: "@git", "@git:HEAD~1", "@problems", "@web:https://…", "@docs:react".
  if (/^(git|problems|web|docs)(:|$)/.test(source)) return `@${source}`;
  return source.replace(/^(file|selection):/, '');
}

interface ToolStep {
  kind: 'tool';
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** A helper AI (delegate_to_ai) made this call: its model. */
  agent?: string;
  status: 'running' | 'approval' | 'ok' | 'error';
  summary?: string;
  output?: string;
  preview?: ToolPreview;
}
type Part = { kind: 'text'; text: string } | ToolStep;

interface Turn {
  /** Stable identity of the message in the list (React key): survives edit / regenerate. */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts?: Part[];
  model?: string;
  meta?: string;
  error?: string;
  notices?: string[];
  reasoning?: string;
  context?: string[];
  /** Images sent with this message (data: URLs, shown as thumbnails). */
  images?: string[];
  /** Request of the exchange (question and answer share it): several can run at once. */
  rid?: string;
  /** Fase 3: answered in plan mode (it ends with a plan to approve), and the user's verdict. */
  mode?: ChatMode;
  plan?: 'approved' | 'rejected';
}

/** An image pasted, dropped or picked for the next message. */
interface PendingImage {
  mediaType: string;
  /** base64, without the data: prefix */
  data: string;
  name: string;
}
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_CHAT_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function readImage(file: File): Promise<PendingImage> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      const i = url.indexOf(',');
      ok({ mediaType: file.type, data: url.slice(i + 1), name: file.name || t('chatImageName') });
    };
    r.onerror = () => fail(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

let turnSeq = 0;
/** A new message id (unique in this window; saved conversations get theirs when loaded). */
function newTurnId(): string {
  return `t${Date.now().toString(36)}-${(turnSeq++).toString(36)}`;
}

/** "/" commands of the message box: a ready-made prompt (or an action). */
interface Slash {
  /** Spanish name (also accepted when the interface is in English). */
  name: string;
  /** English name (also accepted when the interface is in Spanish). */
  en: string;
  hint: string;
  prompt?: string;
  agent?: boolean;
  action?: 'new' | 'agent' | 'chat' | 'plan' | 'rules' | 'commit' | 'docs' | 'phases';
}
function slashCommands(): Slash[] {
  return [
    { name: 'explicar', en: 'explain', hint: t('slashExplain'), prompt: t('slashExplainPrompt') },
    { name: 'revisar', en: 'review', hint: t('slashReview'), prompt: t('slashReviewPrompt') },
    { name: 'arreglar', en: 'fix', hint: t('slashFix'), prompt: t('slashFixPrompt'), agent: true },
    {
      name: 'pruebas',
      en: 'tests',
      hint: t('slashTests'),
      prompt: t('slashTestsPrompt'),
      agent: true,
    },
    { name: 'docs', en: 'docs', hint: t('slashDocs'), prompt: t('slashDocsPrompt') },
    {
      name: 'optimizar',
      en: 'optimize',
      hint: t('slashOptimize'),
      prompt: t('slashOptimizePrompt'),
    },
    {
      name: 'seguridad',
      en: 'security',
      hint: t('slashSecurity'),
      prompt: t('slashSecurityPrompt'),
    },
    { name: 'commit', en: 'commit', hint: t('slashCommit'), action: 'commit' },
    { name: 'reglas', en: 'rules', hint: t('rulesEdit'), action: 'rules' },
    { name: 'init', en: 'init', hint: t('slashInit'), prompt: t('slashInitPrompt'), agent: true },
    { name: 'agente', en: 'agent', hint: t('slashAgent'), action: 'agent' },
    { name: 'plan', en: 'plan', hint: t('slashPlan'), action: 'plan' },
    { name: 'fases', en: 'phases', hint: ps().menu, action: 'phases' },
    { name: 'chat', en: 'chat', hint: t('slashChat'), action: 'chat' },
    { name: 'nuevo', en: 'new', hint: t('newChat'), action: 'new' },
    { name: 'indexar', en: 'index', hint: t('slashIndexDocs'), action: 'docs' },
  ];
}

/** Why a project rule entered the prompt, for the rules menu. */
function ruleReason(reason: string): string {
  if (reason === 'always') return t('rulesWhyAlways');
  if (reason === 'folder') return t('rulesWhyFolder');
  if (reason === 'mention') return t('rulesWhyMention');
  return t('rulesWhyGlob', { glob: reason });
}

/** Name of a "/" command in the interface language (the other one also works). */
function slashName(c: Slash): string {
  return lang === 'en' ? c.en : c.name;
}

/** The "/" command typed, in either language. */
function findSlash(name: string): Slash | undefined {
  const n = name.toLowerCase();
  return slashCommands().find((c) => c.name === n || c.en === n);
}

/** Workspace files mentioned as "@path" in a prompt (only paths that exist). */
function mentionedFiles(prompt: string, files: string[]): string[] {
  const known = new Set(files);
  const out: string[] = [];
  for (const m of prompt.matchAll(/(^|\s)@([^\s@]+)/g)) {
    const p = m[2]!.replace(/[.,;:!?)]+$/, '');
    if (known.has(p) && !out.includes(p)) out.push(p);
  }
  return out.slice(0, 12);
}

/** i18n key of each special mention's hint in the "@" menu. */
const MENTION_HINT = {
  git: 'mentionGit',
  terminal: 'mentionTerminal',
  problems: 'mentionProblems',
  web: 'mentionWeb',
  docs: 'mentionDocs',
} as const satisfies Record<MentionKind, string>;

interface Suggest {
  kind: 'slash' | 'file';
  /** Text range of the input being completed. */
  from: number;
  to: number;
  /** `insert`: text put in the box instead of "@id " (e.g. "@web:" waits for the address). */
  items: { id: string; label: string; hint?: string; insert?: string; special?: boolean }[];
  index: number;
}

/** What other parts of the UI can ask of an open chat. */
interface ChatHandle {
  send: (prompt: string, context?: ChatContext[], forceAgent?: boolean) => void;
  busy: () => boolean;
  abort: () => void;
  focus: () => void;
  setAgent: (on: boolean) => void;
  load: (conversationId: string) => void;
  reset: () => void;
  /** Stops like the Stop button (queued messages wait). */
  stop: () => void;
  decide: (toolCallId: string, d: ToolDecision) => void;
  /** The last turns, for the phone remote. */
  view: () => PhoneSnapshot['turns'];
}
const handles = new Map<string, ChatHandle>();

/** Turns the phone shows (the newest ones; long texts keep their end). */
const PHONE_TURNS = 40;
const PHONE_TEXT = 8000;
function phoneTurns(turns: Turn[]): PhoneSnapshot['turns'] {
  return turns.slice(-PHONE_TURNS).map((x) => {
    const text =
      x.parts
        ?.filter((p) => p.kind === 'text')
        .map((p) => p.text)
        .join('\n') || x.content;
    return {
      role: x.role,
      text: text.length > PHONE_TEXT ? '…' + text.slice(-PHONE_TEXT) : text,
      ...(x.error ? { error: x.error.slice(0, 2000) } : {}),
      ...(x.role === 'assistant' && x.model ? { model: x.model.slice(0, 300) } : {}),
      tools: (x.parts ?? [])
        .filter((p): p is ToolStep => p.kind === 'tool')
        .slice(-60)
        .map((p) => ({
          id: p.id,
          title: `${p.name} ${toolTitle(p)}`.trim().slice(0, 300),
          status: p.status,
        })),
    };
  });
}

let phoneTimer: ReturnType<typeof setTimeout> | undefined;
/** The phone works on this window (main says so; it can switch between windows). */
let phoneLinked = false;
export function setPhoneTarget(on: boolean): void {
  phoneLinked = on;
  if (on) pushToPhone();
}
/** Sends the phone what the controlled chat looks like now (a few times a second at most). */
export function pushToPhone(): void {
  if (!phoneLinked || phoneTimer) return;
  phoneTimer = setTimeout(() => {
    phoneTimer = undefined;
    const s = getState();
    if (!phoneLinked) return;
    const id = focusedChat();
    const h = handles.get(id);
    const tab = chatTab(id);
    const mode: ChatMode = tab ? modeFrom(tab.mode, tab.agent) : 'agent';
    const own = tab?.model ?? null;
    const shown =
      own ?? (usesAgent(mode) ? s.settings.roles.agent : undefined) ?? s.settings.defaultModel;
    void api()
      .phone.push({
        chats: s.chats.map((c, i) => ({
          id: c.id,
          title: (c.title || t('chatTabN', { n: i + 1 })).slice(0, 200),
          busy: c.busy,
          waiting: c.waiting,
        })),
        chatId: id,
        agent: tab?.agent ?? true,
        mode,
        model: own,
        shownModel: shown ?? null,
        queued: tab?.queued.length ?? 0,
        busy: h?.busy() ?? false,
        turns: h?.view() ?? [],
      })
      .catch(() => undefined);
  }, 250);
}

/** Does what the paired phone asked, in the chat the user is looking at. */
export function runPhoneAction(a: PhoneAction): void {
  const id = focusedChat();
  const h = handles.get(id);
  switch (a.kind) {
    case 'send':
      setState({ chatOpen: true });
      if (!h) newChat({ initial: { prompt: a.text, send: true } }, true);
      // Busy: it goes out when the current answer ends, like messages written meanwhile.
      else if (h.busy()) updateChat(id, { queued: [...(chatTab(id)?.queued ?? []), a.text] });
      else h.send(a.text);
      break;
    case 'decide':
      h?.decide(a.toolCallId, a.decision);
      break;
    case 'stop':
      h?.stop();
      break;
    case 'select':
      selectChat(a.chatId);
      break;
    case 'newChat':
      newChat({}, true);
      break;
    case 'agent':
      if (chatTab(id)) {
        updateChat(id, { agent: a.on });
        saveAgentMode(a.on);
      }
      break;
    case 'mode':
      if (chatTab(id)) {
        updateChat(id, { mode: a.mode });
        saveChatMode(a.mode);
      }
      break;
    case 'model':
      if (chatTab(id)) updateChat(id, { model: a.ref });
      break;
    case 'closeChat':
      if (getState().chats.some((c) => c.id === a.chatId)) {
        // The phone already asked "are you sure": no dialog on the computer.
        const busy = handles.get(a.chatId);
        if (busy?.busy()) busy.abort();
        if (getState().chatHistoryFor === a.chatId) setState({ chatHistoryFor: null });
        closeChat(a.chatId);
      }
      break;
    case 'clearQueue':
      if (chatTab(id)) updateChat(id, { queued: [] });
      break;
    case 'openFile':
      // From the phone's file browser: the file shows up in the editor of the computer.
      void openFile(a.path).catch((err: unknown) => toast(errText(err)));
      break;
  }
  pushToPhone();
}

/**
 * Sends a prompt from elsewhere (Ctrl+L, palette, security center…) to the chat the user is
 * looking at; if that chat is busy, a new chat takes it so nothing is interrupted.
 */
function deliver(prompt: string, context: ChatContext[] | undefined, agent: boolean): void {
  setState({ chatOpen: true });
  const id = focusedChat();
  const h = handles.get(id);
  if (!h || h.busy()) {
    newChat(
      {
        ...(agent ? { agent: true } : {}),
        initial: { prompt, context, send: true },
      },
      true,
    );
    if (h?.busy()) toast(t('chatOpenedInNew'));
    return;
  }
  if (agent) h.setAgent(true);
  h.send(prompt, context, agent);
}

/** Sends a task to the chat in agent mode (used by the security center and similar). */
export function askAgent(prompt: string): void {
  deliver(prompt, undefined, true);
}

/** Puts a prompt in the chat (or just focuses the message box when it is empty). */
export function askInChat(prompt: string, context?: ChatContext[]): void {
  if (prompt) return deliver(prompt, context, false);
  setState({ chatOpen: true });
  setTimeout(() => handles.get(focusedChat())?.focus(), 50);
}

const LAST_KEY = 'zs.lastConversation';
/** Most recent messages sent as history (main rejects more than 500). */
const MAX_HISTORY = 400;
function remember(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    // storage unavailable: the conversation is still saved, just not reopened automatically
  }
}

interface SavedDisplay {
  parts?: Part[];
  model?: string;
  reasoning?: string;
  notices?: string[];
  meta?: { usd: number | null; inputTokens: number; outputTokens: number; latencyMs: number };
  error?: string;
  context?: string[];
  request?: string;
  /** Fase 3: the agent mode the answer ran in. */
  mode?: ChatMode;
}

/**
 * Puts every answer right after its question: answers sent alongside are saved in the order
 * they ended (q1, q2, a2, a1), and are shown as q1, a1, q2, a2.
 */
function pairTurns(turns: Turn[]): Turn[] {
  const answers = new Map<string, Turn>();
  const asked = new Set<string>();
  for (const x of turns) {
    if (!x.rid) continue;
    if (x.role === 'assistant') answers.set(x.rid, x);
    else asked.add(x.rid);
  }
  const out: Turn[] = [];
  for (const x of turns) {
    // An answer goes under its question (placed there below).
    if (x.role === 'assistant' && x.rid && asked.has(x.rid)) continue;
    out.push(x);
    const a = x.role === 'user' && x.rid ? answers.get(x.rid) : undefined;
    if (a) out.push(a);
  }
  return out;
}

function metaLine(m: {
  usd: number | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): string {
  return `${m.inputTokens}→${m.outputTokens} ${t('chatTokens')} · ${fmtUsd(m.usd)} · ${(m.latencyMs / 1000).toFixed(1)}s`;
}

function fmtUsd(n: number | null): string {
  return n === null ? '–' : formatUsd(n);
}

/** Shortcut of a command as shown in the menus (the user's own one if changed; ⌘ on macOS). */
function shortcutOf(id: string): string {
  return commands().find((c) => c.id === id)?.keys ?? '';
}

const SUGGEST_ICON = {
  chatSuggest1: 'books',
  chatSuggest2: 'search',
  chatSuggest3: 'check',
  chatSuggest4: 'play',
} as const satisfies Record<string, IconName>;

const TOOL_ICON: Record<string, IconName> = {
  list_dir: 'folder',
  read_file: 'file',
  search: 'search',
  edit_file: 'edit',
  write_file: 'filePlus',
  run_command: 'terminal',
  tree: 'tree',
  glob: 'filter',
  read_many_files: 'books',
  browser_open: 'globe',
  browser_read: 'eye',
  browser_click: 'pointer',
  browser_type: 'keyboard',
  browser_scroll: 'arrowsV',
  browser_back: 'back',
  network_status: 'wifi',
  http_request: 'plug',
  sql_query: 'database',
  read_system_file: 'file',
  write_system_file: 'wrench',
  set_env_var: 'settings',
  security_scan_project: 'shield',
  audit_dependencies: 'package',
  security_check_system: 'monitor',
  port_scan: 'wifi',
  check_site_security: 'lock',
  file_hash: 'hash',
  list_ai_models: 'cpu',
  delegate_to_ai: 'users',
  mail_accounts: 'users',
  mail_folders: 'folder',
  mail_list: 'mail',
  mail_read: 'mail',
  mail_mark: 'star',
  mail_move: 'archive',
  mail_save_draft: 'mail',
  mail_send: 'send',
  supabase_accounts: 'users',
  supabase_projects: 'supabase',
  supabase_project_info: 'supabase',
  supabase_tables: 'database',
  supabase_columns: 'columns',
  supabase_query: 'database',
  supabase_pause: 'pause',
  supabase_restore: 'play',
  vercel_accounts: 'users',
  vercel_projects: 'vercel',
  vercel_project: 'vercel',
  vercel_deployments: 'cloud',
  vercel_logs: 'scroll',
  vercel_redeploy: 'refresh',
  vercel_promote: 'arrowDown',
  vercel_cancel: 'stop',
  vercel_set_env: 'key',
};

const STATUS_ICON: Record<ToolStep['status'], IconName> = {
  running: 'clock',
  approval: 'pause',
  ok: 'check',
  error: 'x',
};

/** Account a mail / Supabase / Vercel tool works on, when the AI picked one ("" for the one open in the panel). */
function mailFrom(a: Record<string, unknown>): string {
  return typeof a.account === 'string' && a.account ? `${a.account} · ` : '';
}

function toolTitle(step: ToolStep): string {
  const a = step.args;
  switch (step.name) {
    case 'run_command':
      return String(a.command ?? '');
    case 'search':
      return `"${String(a.query ?? '')}"`;
    case 'glob':
      return String(a.pattern ?? '');
    case 'read_many_files':
      return Array.isArray(a.paths) ? a.paths.join(', ') : String(a.pattern ?? '');
    case 'browser_open':
      return String(a.url ?? '');
    case 'browser_click':
      return `[${String(a.ref ?? '')}]`;
    case 'browser_type':
      return `[${String(a.ref ?? '')}] "${String(a.text ?? '')}"`;
    case 'browser_scroll':
      return String(a.direction ?? '');
    case 'browser_read':
    case 'browser_back':
      return '';
    case 'network_status':
    case 'port_scan':
      return String(a.target ?? '');
    case 'check_site_security':
      return String(a.url ?? '');
    case 'http_request':
      return `${String(a.method ?? 'GET')} ${String(a.url ?? '')}`;
    case 'sql_query':
      return String(a.query ?? '');
    case 'set_env_var':
      return `${String(a.name ?? '')} (${a.scope === 'user' ? t('envPermanent') : t('envSession')})`;
    case 'list_ai_models':
      return '';
    case 'delegate_to_ai':
      return `${String(a.model ?? '')} · ${String(a.task ?? '').slice(0, 120)}`;
    case 'mail_accounts':
    case 'supabase_accounts':
    case 'vercel_accounts':
      return '';
    case 'supabase_projects':
    case 'vercel_projects':
      return [a.account, a.team].filter(Boolean).map(String).join(' · ');
    case 'supabase_project_info':
    case 'supabase_tables':
    case 'supabase_pause':
    case 'supabase_restore':
      return `${mailFrom(a)}${String(a.ref ?? '')}`;
    case 'supabase_columns':
      return `${mailFrom(a)}${String(a.ref ?? '')} · ${String(a.schema ?? 'public')}.${String(a.table ?? '')}`;
    case 'supabase_query':
      return `${mailFrom(a)}${String(a.ref ?? '')} · ${String(a.sql ?? '').slice(0, 160)}`;
    case 'vercel_project':
    case 'vercel_deployments':
      return `${mailFrom(a)}${String(a.project ?? '')}`;
    case 'vercel_logs':
    case 'vercel_cancel':
      return `${mailFrom(a)}${String(a.deployment ?? '')}`;
    case 'vercel_redeploy':
      return `${mailFrom(a)}${String(a.deployment ?? '')}${a.production === true ? ' → production' : ''}`;
    case 'vercel_promote':
      return `${mailFrom(a)}${String(a.project ?? '')} → ${String(a.deployment ?? '')}`;
    case 'vercel_set_env':
      return `${mailFrom(a)}${String(a.project ?? '')} · ${String(a.key ?? '')}`;
    case 'mail_folders':
      return mailFrom(a).replace(/ · $/, '');
    case 'mail_list':
      return `${mailFrom(a)}${String(a.folder ?? 'INBOX')}${a.query ? ` · "${String(a.query)}"` : ''}`;
    case 'mail_read':
    case 'mail_mark':
      return `${mailFrom(a)}${String(a.folder ?? 'INBOX')} #${String(a.uid ?? '')}`;
    case 'mail_move':
      return `${mailFrom(a)}${String(a.folder ?? 'INBOX')} #${String(a.uid ?? '')} → ${String(a.to ?? '')}`;
    case 'mail_save_draft':
    case 'mail_send':
      return `${mailFrom(a)}${String(a.to ?? '')} · ${String(a.subject ?? '')}`;
    default:
      return String(a.path ?? '.');
  }
}

function DiffView({ before, after, path }: { before: string; after: string; path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    if (!host.current) return;
    const lang = languageFor(path);
    const a = monaco.editor.createModel(before, lang);
    const b = monaco.editor.createModel(after, lang);
    const diff = monaco.editor.createDiffEditor(host.current, {
      readOnly: true,
      renderSideBySide: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      theme: monacoTheme(theme),
      hideUnchangedRegions: { enabled: true },
      fontSize: 12,
    });
    diff.setModel({ original: a, modified: b });
    return () => {
      diff.dispose();
      a.dispose();
      b.dispose();
    };
  }, [before, after, path, theme]);
  return <div className="tool-diff" ref={host} />;
}

const ToolCard = memo(function ToolCard({
  step,
  rid,
  onDecide: decideFor,
  onAnswer,
}: {
  step: ToolStep;
  rid?: string;
  onDecide: (toolCallId: string, d: ToolDecision, rid?: string) => void;
  onAnswer: (toolCallId: string, answer: string[] | null, rid?: string) => void;
}) {
  const onDecide = (d: ToolDecision) => decideFor(step.id, d, rid);
  const [open, setOpen] = useState(step.status === 'approval');
  useEffect(() => {
    if (step.status === 'approval') setOpen(true);
  }, [step.status]);
  const icon = TOOL_ICON[step.name] ?? 'wrench';
  const p = step.preview;
  return (
    <div className={`tool-card ${step.status} ${p?.risk ? `risk-${p.risk}` : ''}`}>
      <button
        type="button"
        className="tool-head plain-btn"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="tool-icon">
          <Icon name={icon} size={14} />
        </span>
        {step.agent && (
          <span className="tool-helper" title={t('helperTitle', { model: step.agent })}>
            <ProviderLogo id={step.agent.split('/')[0]!} size={12} />
            {step.agent.split('/').slice(1).join('/')}
          </span>
        )}
        <span className="tool-name">{step.name}</span>
        <span className="tool-arg" title={toolTitle(step)}>
          {toolTitle(step)}
        </span>
        <span className="tool-status">
          {step.summary ? `${step.summary} ` : ''}
          <Icon
            name={STATUS_ICON[step.status]}
            size={13}
            className={step.status === 'running' ? 'spin-slow' : undefined}
          />
        </span>
        <span className={`tool-chevron ${open ? 'open' : ''}`}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <div className="tool-body">
          {p?.warning && step.status === 'approval' && (
            <div className={`tool-warning ${p.risk ?? 'medium'}`}>
              <span className="tool-risk">
                {p.risk === 'high' ? t('riskHigh') : t('riskMedium')}
              </span>
              <span>{p.warning}</span>
            </div>
          )}
          {p?.delegate && (
            <div className="tool-delegate">
              <ProviderLogo id={p.delegate.model.split('/')[0]!} size={18} />
              <div>
                <b>{p.delegate.model}</b>
                <span>{p.delegate.mode === 'agent' ? t('delegateAgent') : t('delegateChat')}</span>
              </div>
            </div>
          )}
          {p?.action && p.url === undefined && !p.delegate && (
            <div className="tool-web">
              <b>{p.action}</b>
              {p.path && p.before === undefined ? (
                <>
                  {' '}
                  · <span className="tool-url">{p.path}</span>
                </>
              ) : null}
            </div>
          )}
          {p?.command !== undefined && (
            <pre className={`tool-cmd ${p.delegate ? 'tool-task' : ''}`}>
              {step.name === 'run_command' ? `$ ${p.command}` : p.command}
            </pre>
          )}
          {p?.url !== undefined && (
            <div className="tool-web">
              <Icon name="globe" size={13} /> <b>{p.action}</b> ·{' '}
              <span className="tool-url">{p.url}</span>
            </div>
          )}
          {p?.path !== undefined && p.before !== undefined && p.after !== undefined && (
            <DiffView before={p.before} after={p.after} path={p.path} />
          )}
          {step.output &&
            (step.name === 'delegate_to_ai' ? (
              <div className="tool-output tool-helper-answer">
                <Markdown text={step.output.slice(-20000)} streaming={step.status === 'running'} />
              </div>
            ) : (
              <pre className="tool-output">{step.output.slice(-20000)}</pre>
            ))}
        </div>
      )}
      {step.status === 'approval' && step.name === 'ask_user' && p?.question && (
        <QuestionCard q={p.question} onAnswer={(a) => onAnswer(step.id, a, rid)} />
      )}
      {step.status === 'approval' && step.name !== 'ask_user' && (
        <div className="tool-actions" role="alert" aria-label={t('approve')}>
          <button className="primary" onClick={() => onDecide('approve')}>
            <Icon name="check" size={14} /> {t('approve')}
          </button>
          {!p?.noAlways && (
            // "Always" for run_command only covers this exact command (approvalKey in main/agent.ts).
            <button
              title={
                step.name === 'run_command'
                  ? t('approveAlwaysCmdTitle')
                  : step.name === 'delegate_to_ai'
                    ? t('approveAlwaysDelegateTitle')
                    : t('approveAlwaysTitle')
              }
              onClick={() => onDecide('always')}
            >
              {step.name === 'run_command' ? t('approveAlwaysCmd') : t('approveAlways')}
            </button>
          )}
          <button className="danger" onClick={() => onDecide('deny')}>
            <Icon name="x" size={14} /> {t('reject')}
          </button>
        </div>
      )}
    </div>
  );
});

/** What a message of the list can do; one stable object per chat (see `turnActions`). */
interface TurnActions {
  editLast: () => void;
  regenerate: () => void;
  continueLast: () => void;
  agentOff: () => void;
  copy: (turn: Turn) => void;
  quote: (turn: Turn) => void;
  handoff: (turn: Turn) => void;
  decide: (toolCallId: string, d: ToolDecision, rid?: string) => void;
  /** The user's answer to an ask_user question (Fase 3). */
  answer: (toolCallId: string, answer: string[] | null, rid?: string) => void;
  /** Fase 3: approve (and run, in agent or auto-approve mode), edit or reject a plan. */
  approvePlan: (turn: Turn, mode?: 'agent' | 'auto') => void;
  editPlan: (turn: Turn) => void;
  rejectPlan: (turn: Turn) => void;
  /** "Volver aquí" on a user message (Fase 2). */
  rewind: (turn: Turn) => void;
  /** Diff of the files an answer changed, by blocks (Fase 2). */
  review: (turn: Turn) => void;
}

/**
 * One message of the chat. Memoized: while an answer streams only that message re-renders
 * (the others keep their props), so long conversations do not re-parse all their Markdown
 * for every token.
 */
type ReasoningLevel = 'low' | 'medium' | 'high';
const REASONING_KEY = 'zinarix.reasoning';
const loadReasoning = (): ReasoningLevel | '' => {
  const v = localStorage.getItem(REASONING_KEY);
  return v === 'low' || v === 'medium' || v === 'high' ? v : '';
};

/**
 * The model's reasoning: open (and following the end) while it thinks, collapsible after,
 * rendered as Markdown, with a button to see all of it without the height limit.
 */
const ReasoningBlock = memo(function ReasoningBlock({
  text,
  live,
}: {
  text: string;
  live: boolean;
}) {
  const [open, setOpen] = useState(live);
  const [full, setFull] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);
  useEffect(() => {
    const el = body.current;
    if (el && live && stick.current) el.scrollTop = el.scrollHeight;
  }, [text, live, open]);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <details
      className={`turn-reasoning ${live ? 'live' : ''}`}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <Icon name="thinking" size={13} /> {live ? t('thinkingLive') : t('thinking')}
        <span className="turn-reasoning-count">
          · {words} {t('reasoningWords')}
        </span>
      </summary>
      <div
        ref={body}
        className={`turn-reasoning-body ${full ? 'full' : ''}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        <Markdown text={text} streaming={live} />
      </div>
      <button type="button" className="turn-reasoning-more" onClick={() => setFull((f) => !f)}>
        {full ? t('reasoningLess') : t('reasoningMore')}
      </button>
    </details>
  );
});

/** Errors that a missing, wrong or expired API key causes (provider texts vary a lot). */
const AUTH_ERROR =
  /\b40[13]\b|api[\s_-]?key|\bkeys?\b|clave|llave|unauthori[sz]ed|authenticat|autentica|credential|credencial|forbidden|permission denied/i;
/** Errors of a model that cannot call tools (agent mode then needs another model). */
const TOOLS_ERROR = /tool|function|herramienta/i;
/** No model chosen yet (err.no_model): offer the picker and the providers. */
const NO_MODEL_ERROR = /no hay un modelo elegido|no model selected/i;

/** Tools whose file changes are checkpointed (rewind / review, Fase 2). */
const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'write_system_file', 'set_env_var']);
const stepsOf = (turn: Turn, names: ReadonlySet<string>) =>
  (turn.parts ?? []).filter(
    (p): p is ToolStep => p.kind === 'tool' && names.has(p.name) && p.status === 'ok',
  ).length;

const TurnView = memo(function TurnView({
  turn,
  live,
  last,
  canEdit,
  idle,
  planState,
  defaultModel,
  agentMode,
  actions,
}: {
  turn: Turn;
  /** Fase 3: the state of the plan this answer proposed (null = none to show). */
  planState?: PlanState;
  live: boolean;
  last: boolean;
  canEdit: boolean;
  /** Nothing runs in this chat: rewind and review are possible. */
  idle: boolean;
  defaultModel: string | null;
  agentMode: boolean;
  actions: TurnActions;
}) {
  return (
    <div className={`turn ${turn.role}`}>
      {turn.role === 'user' ? (
        <>
          <div className="turn-user">{turn.content}</div>
          {turn.images && turn.images.length > 0 && (
            <div className="turn-images">
              {turn.images.map((src, k) => (
                <img key={k} src={src} alt="" />
              ))}
            </div>
          )}
          {(canEdit || (idle && turn.rid)) && (
            <div className="turn-actions user">
              {canEdit && (
                <button title={t('chatEdit')} onClick={actions.editLast}>
                  <Icon name="edit" size={13} /> {t('chatEdit')}
                </button>
              )}
              {idle && turn.rid && (
                <button title={t('rewindHereTitle')} onClick={() => actions.rewind(turn)}>
                  <Icon name="undo" size={13} /> {t('rewindHere')}
                </button>
              )}
            </div>
          )}
          {turn.context && turn.context.length > 0 && (
            <div className="turn-context">
              {turn.context.map((c) => (
                <span key={c} className="turn-context-item">
                  <Icon name={c.startsWith('terminal:') ? 'terminal' : 'paperclip'} size={11} />
                  {contextLabel(c)}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="turn-model">
            {(turn.model ?? defaultModel) && (
              <ProviderLogo id={(turn.model ?? defaultModel ?? '').split('/')[0]!} size={16} />
            )}
            {turn.model ?? defaultModel ?? ''}
          </div>
          {turn.notices?.map((n, j) => (
            <div key={j} className="turn-notice">
              <Icon name="warning" size={13} /> {n}
            </div>
          ))}
          {turn.reasoning && (
            <ReasoningBlock
              text={turn.reasoning}
              live={live && !turn.parts?.some((p) => p.kind === 'text' && p.text)}
            />
          )}
          {(turn.parts ?? []).map((p, j) =>
            p.kind === 'text' ? (
              <Markdown
                key={j}
                text={p.text}
                streaming={live && j === (turn.parts?.length ?? 0) - 1}
              />
            ) : (
              <ToolCard
                key={p.id}
                step={p}
                rid={turn.rid}
                onDecide={actions.decide}
                onAnswer={actions.answer}
              />
            ),
          )}
          {live && !turn.content && !turn.parts?.length && !turn.error && (
            <div className="typing">
              <span />
              <span />
              <span />
            </div>
          )}
          {turn.error && (
            <div className="turn-error" role="alert">
              <Icon name="warning" size={14} /> {turn.error}
              {NO_MODEL_ERROR.test(turn.error) && (
                <button onClick={() => setState({ modal: { kind: 'models' } })}>
                  {t('pickModel')}
                </button>
              )}
              {(AUTH_ERROR.test(turn.error) || NO_MODEL_ERROR.test(turn.error)) && (
                <button onClick={() => setState({ modal: { kind: 'providers' } })}>
                  {t('providers')}
                </button>
              )}
              {TOOLS_ERROR.test(turn.error) && agentMode && (
                <button onClick={actions.agentOff}>{t('agentOff')}</button>
              )}
            </div>
          )}
          {!live && planState && (planState !== 'open' || idle) && (
            <PlanBar
              state={planState === 'open' ? undefined : planState}
              onApprove={() => actions.approvePlan(turn)}
              onApproveAuto={() => actions.approvePlan(turn, 'auto')}
              onEdit={() => actions.editPlan(turn)}
              onReject={() => actions.rejectPlan(turn)}
            />
          )}
          {turn.meta && <div className="turn-meta">{turn.meta}</div>}
          {!live && (turn.content || turn.error) && (
            <div className="turn-actions">
              {turn.content && (
                <button title={t('copy')} onClick={() => actions.copy(turn)}>
                  <Icon name="copy" size={13} />
                  <span className="turn-action-label">{t('copy')}</span>
                </button>
              )}
              {turn.content && (
                <button title={t('chatQuote')} onClick={() => actions.quote(turn)}>
                  <Icon name="quote" size={13} />
                  <span className="turn-action-label">{t('chatQuote')}</span>
                </button>
              )}
              {turn.content && (
                <button title={t('chatHandoffTitle')} onClick={() => actions.handoff(turn)}>
                  <Icon name="handoff" size={13} />
                  <span className="turn-action-label">{t('chatHandoff')}</span>
                </button>
              )}
              {idle && turn.rid && stepsOf(turn, EDIT_TOOLS) > 0 && (
                <button title={t('reviewChangesTitle')} onClick={() => actions.review(turn)}>
                  <Icon name="edit" size={13} />
                  <span className="turn-action-label">{t('reviewChanges')}</span>
                </button>
              )}
              {last && (
                <button title={t('chatRegenerate')} onClick={actions.regenerate}>
                  <Icon name="refresh" size={13} />
                  <span className="turn-action-label">{t('chatRegenerate')}</span>
                </button>
              )}
              {last && turn.content && !turn.error && (
                <button title={t('chatContinue')} onClick={actions.continueLast}>
                  <Icon name="continue" size={13} />
                  <span className="turn-action-label">{t('chatContinue')}</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});

/**
 * One chat. Every open chat stays mounted (hidden when not shown), so a chat keeps
 * streaming, running tools and waiting for approvals while the user works in another one.
 */
function ChatSession({ id, pane, split }: { id: string; pane: 0 | 1 | null; split: boolean }) {
  const visible = pane !== null;
  const settings = useStore((s) => s.settings);
  const active = useStore((s) => s.active);
  const models = useStore((s) => s.models);
  const workspace = useStore((s) => s.workspace);
  const meta = useStore((s) => s.chats.find((c) => c.id === id));
  // "Mis bots": the bot this chat talks as (its greeting shows while the chat is empty).
  const chatBot = useStore((s) => (meta?.bot ? s.automations?.bots.find((b) => b.id === meta.bot) : undefined));
  const focusedPane = useStore((s) => s.chatFocus);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsNow = useRef(turns);
  turnsNow.current = turns;
  const [input, setInput] = useState('');
  /** "Mejorar prompt": working, and the text the user had before (to go back to it). */
  const [improving, setImproving] = useState(false);
  const [beforeImprove, setBeforeImprove] = useState<string | null>(null);
  const [images, setImages] = useState<PendingImage[]>([]);
  const imagesNow = useRef<PendingImage[]>([]);
  imagesNow.current = images;
  const imagePicker = useRef<HTMLInputElement>(null);
  /** Adds pasted / dropped / picked images (only png, jpeg, gif, webp up to 5 MB, max 6). */
  const addImages = async (files: File[]) => {
    const ok = files.filter((f) => IMAGE_MIME.includes(f.type));
    if (!ok.length) return false;
    const room = MAX_CHAT_IMAGES - imagesNow.current.length;
    if (room <= 0) {
      toast(t('chatImagesMax', { n: MAX_CHAT_IMAGES }));
      return true;
    }
    const big = ok.filter((f) => f.size > MAX_IMAGE_BYTES);
    if (big.length) toast(t('chatImageTooBig'));
    const read = await Promise.all(
      ok
        .filter((f) => f.size <= MAX_IMAGE_BYTES)
        .slice(0, room)
        .map((f) => readImage(f).catch(() => null)),
    );
    const add = read.filter((x): x is PendingImage => x !== null);
    if (add.length) setImages((cur) => [...cur, ...add].slice(0, MAX_CHAT_IMAGES));
    return true;
  };
  const [includeFile, setIncludeFile] = useState(true);
  const [reasoning, setReasoning] = useState<ReasoningLevel | ''>(loadReasoning);
  const chatMode: ChatMode = meta ? modeFrom(meta.mode, meta.agent) : 'agent';
  const agentMode = usesAgent(chatMode);
  const setChatMode = (m: ChatMode, announce = false) => {
    updateChat(id, { mode: m });
    saveChatMode(m);
    if (announce) toast(t('modeToast', { mode: modeLabel(m), hint: modeHint(m) }));
  };
  const setAgentMode = (on: boolean) => setChatMode(on ? (agentMode ? chatMode : 'agent') : 'ask');
  /** "Controlar la compu" (only with the agent; asks once per chat before turning on). */
  const computerOn = Boolean(meta?.computer) && agentMode;
  const toggleComputer = async () => {
    if (computerOn) {
      updateChat(id, { computer: false });
      toast(t('computerOffToast'));
      return;
    }
    const ok = await confirmDialog(t('computerConfirm'), {
      danger: true,
      okLabel: t('computerConfirmOk'),
    });
    if (!ok) return;
    updateChat(id, { computer: true, ...(chatMode === 'plan' ? { mode: 'agent' as const } : {}) });
    toast(t('computerOnToast'));
  };
  /** The plan being edited before it runs (Fase 3). */
  const [planEdit, setPlanEdit] = useState<Turn | null>(null);
  /** Model of this chat; undefined = the app default for the mode. */
  const chatModel = meta?.model ?? undefined;
  /** Requests answering right now (a message sent while others work runs alongside them). */
  const [running, setRunning] = useState<string[]>([]);
  /** The most recent of them (null = idle). */
  const busy = running.at(-1) ?? null;
  const [conversationId, setConversationIdState] = useState<string | undefined>();
  /** Latest conversation id (a message sent alongside must not wait for a render to see it). */
  const conversationNow = useRef<string | undefined>(undefined);
  const setConversationId = (c: string | undefined) => {
    conversationNow.current = c;
    setConversationIdState(c);
    updateChat(id, { conversationId: c });
    remember(c);
  };
  const [changed, setChanged] = useState<string[]>([]);
  const showHistory = useStore((s) => s.chatHistoryFor === id);
  const setShowHistory = (v: boolean | ((cur: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(getState().chatHistoryFor === id) : v;
    setState({ chatHistoryFor: next ? id : null });
  };
  const attachments = useStore((s) => s.chatAttachments);
  const [termMenu, setTermMenu] = useState<TerminalSession[] | null>(null);
  const termMenuEl = useRef<HTMLDivElement>(null);
  const termMenuBtn = useRef<HTMLButtonElement>(null);
  const closeTermMenu = useCallback(() => setTermMenu(null), []);
  useDismiss(termMenu !== null, closeTermMenu, [termMenuEl, termMenuBtn], termMenuBtn);
  useEffect(() => {
    if (termMenu) termMenuEl.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [termMenu]);
  /** The requests streaming into their turns, with their event unsubscribe. */
  const runs = useRef(new Map<string, () => void>());
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  /** Fase 8: names of the indexed docs, for the "@docs:" menu (loaded on first use). */
  const docNamesRef = useRef<string[]>([]);
  const loadDocNames = async () => {
    try {
      docNamesRef.current = (await api().knowledge.docs()).map((d) => d.name);
    } catch {
      // no docs: the menu just shows nothing
    }
  };
  const [files, setFiles] = useState<string[]>([]);
  const [rulesView, setRulesView] = useState<ActiveRulesView | null>(null);
  const [rulesMenu, setRulesMenu] = useState(false);
  const rulesMenuEl = useRef<HTMLDivElement>(null);
  const closeRulesMenu = useCallback(() => setRulesMenu(false), []);
  useDismiss(rulesMenu, closeRulesMenu, [rulesMenuEl, termMenuBtn], termMenuBtn);
  const projectRules = useStore((s) => s.prefs.projectRules);
  const fsVersion = useStore((s) => s.fsVersion);
  /** Prompts sent in this session, for ↑ / ↓ in an empty box. */
  const sent = useRef<string[]>([]);
  const sentIdx = useRef(-1);
  /** Messages written while the chat works; sent one by one when each answer ends. */
  const queued = meta?.queued ?? [];
  /** The user pressed Stop: the queue does not go out by itself. */
  const stopped = useRef(false);
  /** Error code of each failed request (a passing one makes the queue retry). */
  const failCodes = useRef(new Map<string, string>());
  /** Requests that came out of the queue (only those are retried by themselves). */
  const queuedRuns = useRef(new Set<string>());
  /** Retries made of the queued message that keeps failing. */
  const retryTries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A retry waiting: when it goes and which one it is (shown above the queue). */
  const [retry, setRetry] = useState<{ at: number; n: number } | null>(null);
  const cancelRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    retryTries.current = 0;
    setRetry(null);
  };
  useEffect(() => () => void (retryTimer.current && clearTimeout(retryTimer.current)), []);
  // The countdown of a waiting retry moves.
  const [, retryTick] = useState(0);
  useEffect(() => {
    if (!retry) return;
    const h = setInterval(() => retryTick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [retry]);

  /** This chat works in a folder of its own (not the window's open folder). */
  const ownFolder = meta?.folder && meta.folder !== workspace?.root ? meta.folder : undefined;
  /** A chat in no folder (questions only) does not see the window's open folder either. */
  const noFolder = Boolean(meta?.noFolder);
  const root = noFolder ? undefined : (ownFolder ?? workspace?.root);
  useEffect(() => {
    // "@file" suggestions list the window's folder: not offered for a chat working elsewhere.
    if (!root || ownFolder) {
      setFiles([]);
      return;
    }
    void api()
      .workspace.listFiles()
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [root, ownFolder]);
  /** Files the next message would carry: the rules that apply depend on them (globs, folders). */
  const ruleSources = useMemo(() => {
    const out = new Set<string>();
    if (includeFile && active && !ownFolder) out.add(`file:${active}`);
    for (const a of attachments) if (a.source.startsWith('file:')) out.add(a.source);
    for (const p of mentionedFiles(input, files)) out.add(`file:${p}`);
    return [...out].slice(0, 200);
  }, [includeFile, active, ownFolder, attachments, input, files]);
  /** "@name" mentions only matter for rules: keep the request key small. */
  const ruleMentions = useMemo(
    () => [...input.matchAll(/(?:^|\s)(@[\w./-]+)/g)].map((m) => m[1]).join(' '),
    [input],
  );
  useEffect(() => {
    if (!root) {
      setRulesView(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void api()
        .ai.activeRules(ruleSources, ruleMentions, ownFolder)
        .then((v) => live && setRulesView(v))
        .catch(() => live && setRulesView(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [root, ownFolder, fsVersion, projectRules, ruleSources, ruleMentions]);
  /** The project's own "/" commands (.zinarix/commands/*.md) and the user's (~/.zinarix). */
  const [kit, setKit] = useState<AgentKitView | null>(null);
  const [kitTick, setKitTick] = useState(0);
  useEffect(() => {
    let live = true;
    void api()
      .ai.agentKit(noFolder ? undefined : ownFolder)
      .then((v) => live && setKit(v))
      .catch(() => live && setKit(null));
    return () => {
      live = false;
    };
  }, [root, ownFolder, noFolder, fsVersion, kitTick]);
  const kitCommands = kit?.commands ?? NO_KIT_COMMANDS;
  const kitSkills = kit?.skills ?? NO_KIT_SKILLS;
  const [kitMenu, setKitMenu] = useState(false);
  // Fase 5: background tasks (worktrees).
  const [tasksOpen, setTasksOpen] = useState(false);
  // "Nueva tarea en segundo plano" (palette, approved plan): this chat opens the form.
  const [taskSeed, setTaskSeed] = useState<NewTaskSeed | null>(null);
  useEffect(() => {
    const onNew = (e: Event) => {
      const d = (e as CustomEvent<NewTaskSeed & { chat?: string }>).detail;
      if (d?.chat && d.chat !== id) return;
      setTaskSeed({ prompt: d?.prompt, model: d?.model });
      setTasksOpen(true);
    };
    window.addEventListener(NEW_TASK_EVENT, onNew);
    return () => window.removeEventListener(NEW_TASK_EVENT, onNew);
  }, [id]);
  const tasksStatus = useTasks();
  const tasksNow = taskBadge(tasksStatus);
  const kitMenuEl = useRef<HTMLDivElement>(null);
  const closeKitMenu = useCallback(() => setKitMenu(false), []);
  useDismiss(kitMenu, closeKitMenu, [kitMenuEl, termMenuBtn], termMenuBtn);
  /** "Nuevo subagente / skill / comando": the file from a template, open in the editor. */
  const createKit = async (kind: KitKind) => {
    setKitMenu(false);
    const name = { agent: 'nuevo-subagente', skill: 'nueva-skill', command: 'nuevo-comando' }[kind];
    try {
      const path = await api().ai.createKitFile(kind, name, ownFolder);
      setKitTick((n) => n + 1);
      await openFile(path);
      toast(t('kitCreated', { path }));
    } catch (err) {
      toast(errText(err));
    }
  };

  /** Aborts the in-flight requests (if any) and stops listening to their events. */
  const cancelCurrent = () => {
    cancelRetry();
    if (!runs.current.size) return;
    for (const [rid, off] of runs.current) {
      off();
      void api().ai.abort(rid);
    }
    runs.current.clear();
    setRunning([]);
    updateChat(id, { resume: undefined });
  };

  /** Shows a saved conversation; resolves with its turns (null when it could not be read). */
  const loadConversation = async (cid: string): Promise<Turn[] | null> => {
    let data: Awaited<ReturnType<OmniApi['ai']['conversation']>>;
    try {
      data = await api().ai.conversation(cid);
    } catch (err) {
      toast(errText(err));
      return null;
    }
    if (!data) {
      remember(undefined);
      return null;
    }
    cancelCurrent();
    const loaded = pairTurns(
      data.messages.map((m, n): Turn => {
        const d = (m.display ?? {}) as SavedDisplay;
        const rid = d.request ? { rid: d.request } : {};
        // Saved messages carry no id of their own: conversation + position + time is stable
        // for as long as the conversation is shown.
        const tid = `${data.conversation.id}:${n}:${m.ts}`;
        if (m.role === 'user')
          return { id: tid, role: 'user', content: m.content, context: d.context, ...rid };
        return {
          ...rid,
          id: tid,
          role: 'assistant',
          content: m.content,
          parts: d.parts?.length ? d.parts : m.content ? [{ kind: 'text', text: m.content }] : [],
          model: d.model ?? m.model ?? undefined,
          meta: d.meta ? metaLine(d.meta) : undefined,
          error: d.error,
          notices: d.notices,
          reasoning: d.reasoning,
          ...(d.mode ? { mode: d.mode } : {}),
        };
      }),
    );
    setTurns(loaded);
    setConversationId(data.conversation.id);
    updateChat(id, { title: data.conversation.title.slice(0, 60) });
    setChanged([]);
    setShowHistory(false);
    stick.current = true;
    return loaded;
  };

  /**
   * The app (or the computer) went off while this chat was working on `task`: reopens its
   * conversation and asks the model to go on from where the work stopped.
   */
  const resumeTask = async (task: string, cid: string | undefined, agent: boolean) => {
    let base: Turn[] = [];
    if (cid) {
      const loaded = await loadConversation(cid);
      if (loaded) base = loaded;
    }
    // The cut message was saved without its answer: it travels inside the new prompt instead.
    while (base.at(-1)?.role === 'user') base = base.slice(0, -1);
    updateChat(id, { resume: task });
    toast(t('chatResumed'));
    void send(t('chatResumePrompt', { task }), [], agent, base);
  };

  /**
   * Opens a saved conversation without interrupting anything that is running, in the folder it
   * was saved in (the window opens that folder too).
   */
  const openConversation = (cid: string, project: string | null = null) => {
    const there = getState().chats.find((c) => c.conversationId === cid);
    if (there) {
      selectChat(there.id);
      setShowHistory(false);
      return;
    }
    const folder = project && project !== getState().workspace?.root ? project : undefined;
    if (busy) {
      setShowHistory(false);
      newChat({ conversationId: cid, ...(project ? { folder } : {}) });
      return;
    }
    if (project) updateChat(id, { folder });
    void loadConversation(cid);
    selectChat(id);
  };

  // When the chat opens: its saved conversation (reopened after a restart), or the task it
  // was opened for (a handoff, a prompt from the palette). Once, also under StrictMode.
  const opened = useRef(false);
  const onOpen = useEffectEvent(() => {
    if (opened.current) return;
    opened.current = true;
    const m = chatTab(id);
    if (m?.resume) {
      void resumeTask(m.resume, m.conversationId, m.agent);
      return;
    }
    if (m?.conversationId) void loadConversation(m.conversationId);
    const init = m?.initial;
    if (init) {
      updateChat(id, { initial: undefined });
      if (init.send) void send(init.prompt, init.context ?? [], m.agent);
      else {
        setInput(init.prompt);
        setTimeout(() => textarea.current?.focus(), 60);
      }
    }
  });
  useEffect(() => {
    onOpen();
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // The input grows with its content (up to ~12 lines) instead of scrolling inside 3 rows.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [input]);

  useEffect(() => {
    if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);

  // A hidden chat cannot scroll: once shown (e.g. opened in the split pane) it catches up.
  useEffect(() => {
    if (!visible) return;
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTo({ top: el.scrollHeight });
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, [visible]);

  const currentFileContext = (): ChatContext[] => {
    const ed = getEditor();
    const model = ed?.getModel();
    const path = getState().active;
    if (!ed || !model || !path) return [];
    const sel = ed.getSelection();
    const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : '';
    const out: ChatContext[] = [];
    if (selected)
      out.push({
        source: `selection:${path}:${sel!.startLineNumber}-${sel!.endLineNumber}`,
        content: selected,
      });
    const value = model.getValue();
    if (value.length < 200_000) out.push({ source: `file:${path}`, content: value });
    return out;
  };

  /** Reads the files mentioned with "@" so they travel as context. */
  const mentionContext = async (prompt: string): Promise<ChatContext[]> => {
    const out: ChatContext[] = [];
    // Fase 8: @git, @terminal, @problems, @web and @docs. A mention that cannot be filled
    // (no terminal, page down, unknown docs) stays as plain text and a toast says why.
    const question = stripMentions(prompt) || prompt;
    let docsUsed = 0;
    for (const m of parseMentions(prompt)) {
      const source = mentionSource(m);
      try {
        if (m.kind === 'git' || m.kind === 'web') {
          const content = await api().ai.mention(m.kind, m.arg ?? null);
          if (content.trim()) out.push({ source, content });
        } else if (m.kind === 'terminal') {
          const tid = m.arg ? terminalIdByNumber(Number(m.arg)) : activeTerminalId();
          const ctx = tid === null ? null : terminalContext(tid, 'session');
          if (ctx) out.push(ctx);
          else toast(t('termNone'));
        } else if (m.kind === 'problems') {
          const sev = (v: monaco.MarkerSeverity) =>
            v >= monaco.MarkerSeverity.Error
              ? 'error'
              : v >= monaco.MarkerSeverity.Warning
                ? 'warning'
                : 'info';
          const text = formatProblems(
            currentProblems().map((p) => ({ ...p, severity: sev(p.severity) })),
            m.arg?.toLowerCase() === 'errors' ? 'errors' : 'all',
          );
          out.push({ source, content: text || '(no problems)' });
        } else if (m.kind === 'docs' && docsUsed < 4) {
          // "@docs:name" searches that documentation; bare "@docs" searches all of it.
          docsUsed++;
          const hits = await api().knowledge.searchDocs(question, m.arg);
          if (hits.length)
            out.push({
              source,
              content: hits
                .map((h) => `## ${h.title ?? ''}\n${h.source}\n\n${h.text}`)
                .join('\n\n---\n\n'),
            });
        }
      } catch (e) {
        // unknown name / unreachable: the mention stays as plain text (the agent can still look)
        if (m.kind !== 'docs') toast(`@${source}: ${errText(e)}`);
      }
    }
    for (const path of mentionedFiles(prompt, files)) {
      try {
        const f = await api().workspace.readFile(path);
        if (!f.binary && !f.tooLarge && f.content.length < 400_000)
          out.push({ source: `file:${path}`, content: f.content });
      } catch {
        // unreadable: the mention stays as plain text
      }
    }
    return out;
  };

  const send = async (
    prompt: string,
    extra: ChatContext[] = [],
    forceAgent = false,
    /** Turns to continue from (regenerate / edit drop the last exchange). */
    base?: Turn[],
    /** A queued message: what the user is typing meanwhile stays in the box. */
    fromQueue = false,
    /** Fase 3: this request's mode instead of the chat's (an approved plan runs as agent). */
    modeOverride?: ChatMode,
  ) => {
    if (!prompt.trim()) return;
    setShowHistory(false);
    setSuggest(null);
    if (sent.current[sent.current.length - 1] !== prompt) sent.current.push(prompt);
    sentIdx.current = -1;
    const pending = getState().chatAttachments;
    const mentions = await mentionContext(prompt);
    const fileCtx = includeFile ? currentFileContext() : [];
    const context = [
      ...extra,
      ...pending,
      ...mentions,
      ...fileCtx.filter((c) => !mentions.some((m) => m.source === c.source)),
    ];
    if (pending.length) setState({ chatAttachments: [] });
    // Queued messages keep the images for the message being typed.
    const sentImages = fromQueue ? [] : imagesNow.current;
    if (sentImages.length) setImages([]);
    if (!chatTab(id)?.title) updateChat(id, { title: prompt.trim().split('\n')[0]!.slice(0, 60) });
    const turns = base ?? turnsNow.current;
    if (base) setTurns(base);
    // Exchanges still running are left out: their question has no answer yet.
    const history = turns
      .filter((x) => !x.error && !(x.rid && runs.current.has(x.rid)))
      .map((x) => ({ role: x.role, content: x.content }))
      .slice(-MAX_HISTORY);
    if (history[0]?.role === 'assistant') history.shift();
    // Sent alongside a first message whose conversation is not known yet: wait for it, so both
    // land in the same conversation.
    for (let i = 0; i < 60 && runs.current.size && !conversationNow.current; i++)
      await new Promise((ok) => setTimeout(ok, 50));
    const requestId = newRequestId();
    // A queued message, or one sent while others wait in the queue: retried on passing errors.
    if (fromQueue || (chatTab(id)?.queued.length ?? 0) > 0) queuedRuns.current.add(requestId);
    // Agent mode also works without a folder (system, network, browser and security tools).
    const runMode: ChatMode = modeOverride ?? (forceAgent && !agentMode ? 'agent' : chatMode);
    const useAgent = forceAgent || usesAgent(runMode);
    const agentRun = runMode === 'ask' ? 'agent' : runMode;
    stick.current = true;
    setTurns((x) => [
      ...x,
      {
        id: newTurnId(),
        role: 'user',
        content: prompt,
        context: context.map((c) => c.source),
        ...(sentImages.length
          ? { images: sentImages.map((im) => `data:${im.mediaType};base64,${im.data}`) }
          : {}),
        rid: requestId,
      },
      {
        id: newTurnId(),
        role: 'assistant',
        content: '',
        parts: [],
        rid: requestId,
        ...(useAgent && agentRun === 'plan' ? { mode: 'plan' as const } : {}),
      },
    ]);
    if (!fromQueue) {
      setInput('');
      setBeforeImprove(null);
    }
    setRunning((r) => [...r, requestId]);
    // Kept until the answer ends, so a shutdown in between is continued on the next start (a
    // resumed task keeps its original message, not the "go on" prompt).
    updateChat(id, { resume: chatTab(id)?.resume ?? prompt });

    // Each request writes into its own answer (others may be streaming below it). The changes
    // that arrive within one frame (a burst of tokens, tool output) go in as a single render:
    // one setState per token re-rendered the whole chat for every token.
    let pendingUpdates: ((turn: Turn) => Turn)[] = [];
    let frame: number | null = null;
    let frameTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (frameTimer !== null) clearTimeout(frameTimer);
      frame = frameTimer = null;
      const fns = pendingUpdates;
      if (!fns.length) return;
      pendingUpdates = [];
      // Cancelled meanwhile (stop, another conversation): its leftovers are dropped.
      if (!runs.current.has(requestId)) return;
      setTurns((x) =>
        x.map((turn) =>
          turn.role === 'assistant' && turn.rid === requestId
            ? fns.reduce((acc, fn) => fn(acc), turn)
            : turn,
        ),
      );
    };
    const update = (fn: (turn: Turn) => Turn) => {
      pendingUpdates.push(fn);
      if (frame !== null) return;
      frame = requestAnimationFrame(flush);
      // A minimised window gets no animation frames: the text still lands.
      frameTimer = setTimeout(flush, 120);
    };
    const updateStep = (id: string, fn: (s: ToolStep) => ToolStep) =>
      update((turn) => ({
        ...turn,
        parts: (turn.parts ?? []).map((p) => (p.kind === 'tool' && p.id === id ? fn(p) : p)),
      }));
    const appendText = (delta: string) =>
      update((turn) => {
        const parts = [...(turn.parts ?? [])];
        const last = parts[parts.length - 1];
        if (last?.kind === 'text')
          parts[parts.length - 1] = { kind: 'text', text: last.text + delta };
        else parts.push({ kind: 'text', text: delta });
        return { ...turn, content: turn.content + delta, parts };
      });

    const finish = () => {
      flush();
      off();
      // Cancelled (new chat, another conversation): leave the chat alone.
      if (!runs.current.delete(requestId)) return;
      setRunning((r) => r.filter((x) => x !== requestId));
      if (!runs.current.size) updateChat(id, { resume: undefined });
      void refreshSettings();
      // Only the chat the user is in takes the cursor back (not one finishing in the background).
      const el = document.activeElement;
      if (focusedChat() === id && (!el || el === document.body)) textarea.current?.focus();
    };
    const off = api().on((ev) => {
      if (ev.type !== 'chat' || ev.requestId !== requestId) return;
      // Events of a request that was cancelled or replaced must not touch the current turns.
      if (!runs.current.has(requestId)) return;
      const e: ChatEventView = ev.event;
      switch (e.type) {
        case 'conversation':
          setConversationId(e.id);
          break;
        case 'start':
          if (e.conversationId) setConversationId(e.conversationId);
          update((turn) => ({ ...turn, model: `${e.provider}/${e.model}` }));
          break;
        case 'text':
          appendText(e.delta);
          break;
        case 'reasoning':
          update((turn) => ({ ...turn, reasoning: (turn.reasoning ?? '') + e.delta }));
          break;
        case 'notice':
          update((turn) => ({ ...turn, notices: [...(turn.notices ?? []), e.message] }));
          break;
        case 'tool_call':
          update((turn) => ({
            ...turn,
            parts: [
              ...(turn.parts ?? []),
              {
                kind: 'tool',
                id: e.id,
                name: e.name,
                args: e.args,
                ...(e.agent ? { agent: e.agent } : {}),
                status: 'running',
              },
            ],
          }));
          break;
        case 'tool_approval':
          updateStep(e.id, (s) => ({ ...s, status: 'approval', preview: e.preview }));
          break;
        case 'tool_output':
          updateStep(e.id, (s) => ({ ...s, output: (s.output ?? '') + e.chunk }));
          break;
        case 'tool_result':
          updateStep(e.id, (s) => ({ ...s, status: e.ok ? 'ok' : 'error', summary: e.summary }));
          break;
        case 'file_changed':
          void reloadFromDisk(e.path);
          if (e.open) void openFile(e.path).catch(() => undefined);
          setChanged((c) => (c.includes(e.path) ? c : [...c, e.path]));
          break;
        case 'cost':
          update((turn) => ({
            ...turn,
            meta: metaLine(e),
          }));
          finish();
          break;
        case 'error':
          failCodes.current.set(requestId, e.code);
          update((turn) => ({ ...turn, error: e.message }));
          finish();
          break;
        case 'done':
          break;
      }
    });
    runs.current.set(requestId, off);
    try {
      await api().ai.chat(requestId, {
        agent: useAgent,
        ...(useAgent ? { mode: agentRun } : {}),
        ...(useAgent && meta?.computer ? { computer: true, uiLang: lang } : {}),
        // This chat's own model, or (undefined) the one main resolves for the role.
        model: chatModel,
        history,
        prompt,
        context,
        conversationId: conversationNow.current,
        folder: ownFolder,
        noFolder: noFolder || undefined,
        ...(meta?.bot ? { bot: meta.bot } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(sentImages.length
          ? { images: sentImages.map(({ mediaType, data }) => ({ mediaType, data })) }
          : {}),
      });
    } catch (err) {
      // The request never reached the model (validation, IPC failure): show it and unlock the input.
      if (!runs.current.has(requestId)) return;
      update((turn) => ({
        ...turn,
        error: errText(err),
      }));
      finish();
    }
  };

  /** Modo Fases: a .md of changes split into phases and subphases, run one per message. */
  const phases = usePhases({
    // Its files are read and saved through the window's folder.
    root: ownFolder ? undefined : root,
    chatMode,
    send: (prompt, context, mode) => void send(prompt, context, false, undefined, true, mode),
  });

  /** Empties this chat (a new conversation in the same tab). */
  const resetChat = () => {
    cancelCurrent();
    setTurns([]);
    setConversationId(undefined);
    updateChat(id, { title: '' });
    setChanged([]);
    setShowHistory(false);
  };

  // What the rest of the UI can do with this chat (the latest closures, every render).
  const handle = useRef<ChatHandle | null>(null);
  handle.current = {
    send: (prompt, context, forceAgent) => void send(prompt, context ?? [], Boolean(forceAgent)),
    busy: () => busy !== null,
    abort: () => cancelCurrent(),
    focus: () => textarea.current?.focus(),
    setAgent: setAgentMode,
    load: (cid) => void loadConversation(cid),
    reset: resetChat,
    stop: () => stop(),
    decide: (toolCallId, d) => decide(toolCallId, d),
    view: () => phoneTurns(turnsNow.current),
  };
  useEffect(() => {
    const proxy: ChatHandle = {
      send: (...a) => handle.current!.send(...a),
      busy: () => handle.current!.busy(),
      abort: () => handle.current!.abort(),
      focus: () => handle.current!.focus(),
      setAgent: (on) => handle.current!.setAgent(on),
      load: (cid) => handle.current!.load(cid),
      reset: () => handle.current!.reset(),
      stop: () => handle.current!.stop(),
      decide: (...a) => handle.current!.decide(...a),
      view: () => handle.current!.view(),
    };
    handles.set(id, proxy);
    return () => {
      if (handles.get(id) === proxy) handles.delete(id);
    };
  }, [id]);

  /** Sends the first queued message (by itself when an answer ends, or by hand). */
  const sendQueued = () => {
    const [next, ...rest] = chatTab(id)?.queued ?? [];
    if (next === undefined || busy) return;
    // Sent by hand: a retry that was waiting is dropped.
    if (retryTimer.current) cancelRetry();
    updateChat(id, { queued: rest });
    void send(next, [], false, undefined, true);
  };
  const onFinished = useEffectEvent(() => {
    const byUser = stopped.current;
    stopped.current = false;
    {
      const all = turnsNow.current;
      const last = all.at(-1);
      const user = last?.rid ? all.find((x) => x.role === 'user' && x.rid === last.rid) : undefined;
      // A message of Modo Fases: its panel decides what goes next (no queue retries).
      if (
        last?.role === 'assistant' &&
        phases.onFinished(user?.content, last.content, Boolean(last.error), byUser)
      ) {
        cancelRetry();
        return;
      }
    }
    if (byUser) {
      cancelRetry();
      return;
    }
    const last = turnsNow.current.at(-1);
    if (!last?.error) {
      retryTries.current = 0;
      sendQueued();
      return;
    }
    // A queued message failed for a passing reason (network, overloaded provider): it is
    // retried by itself after a while. Other errors, or too many tries: the queue waits.
    const rid = last.rid;
    const code = rid ? failCodes.current.get(rid) : undefined;
    const fromQueue = Boolean(rid && queuedRuns.current.has(rid));
    const prompt = turnsNow.current.find((x) => x.role === 'user' && x.rid === rid)?.content;
    const wait = fromQueue && prompt ? queueRetryDelay(code, retryTries.current) : null;
    if (wait === null) {
      cancelRetry();
      return;
    }
    retryTries.current++;
    setRetry({ at: Date.now() + wait, n: retryTries.current });
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setRetry(null);
      if (handles.get(id)?.busy()) return;
      // Nothing was done in the failed run: it is replaced. Steps were taken: it stays in
      // view (with its error) and the message goes again below it.
      const didWork = last.parts?.some((p) => p.kind === 'tool' && p.status === 'ok');
      const base = didWork ? undefined : turnsNow.current.filter((x) => x.rid !== rid);
      void send(prompt!, [], false, base, true);
    }, wait);
  });

  // The tab strip shows what each chat is doing.
  const waiting = turns.some(
    (x) =>
      x.rid &&
      running.includes(x.rid) &&
      x.parts?.some((p) => p.kind === 'tool' && p.status === 'approval'),
  );
  const wasBusy = useRef(false);
  useEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = Boolean(busy);
    updateChat(id, {
      busy: Boolean(busy),
      waiting,
      ...(finished && !isChatVisible(id) ? { unread: true } : {}),
    });
    if (finished) onFinished();
  }, [id, busy, waiting]);
  // The phone remote follows the chat being looked at.
  useEffect(() => {
    if (id === focusedChat()) pushToPhone();
  }, [id, turns, busy]);

  /** Sends one answer of this chat to another AI, in a new chat (the user reviews and sends). */
  const handoff = (turn: Turn) => {
    const quoted = turn.content
      .trim()
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    setState({
      modal: {
        kind: 'models',
        pick: {
          title: t('chatHandoff'),
          current: null,
          onPick: (ref) => {
            if (!ref) return;
            // Handing a conversation to another AI is part of the agents: every plan.
            newChat(
              {
                model: ref,
                agent: agentMode,
                initial: { prompt: `${t('chatHandoffPrompt')}\n\n${quoted}`, send: false },
              },
              true,
            );
          },
        },
      },
    });
  };

  const pickModel = () =>
    setState({
      modal: {
        kind: 'models',
        pick: {
          title: t('chatModelFor'),
          current: meta?.model ?? null,
          onPick: (ref) => updateChat(id, { model: ref }),
        },
      },
    });

  /** Index of the last user turn (the exchange regenerate / edit replace). */
  const lastUserIndex = () => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i]!.role === 'user') return i;
    return -1;
  };

  const regenerate = async () => {
    const i = lastUserIndex();
    if (i < 0 || busy) return;
    if (conversationId) await api().ai.resetContext(conversationId);
    void send(turns[i]!.content, [], false, turns.slice(0, i));
  };

  const editLast = async () => {
    const i = lastUserIndex();
    if (i < 0 || busy) return;
    if (conversationId) await api().ai.resetContext(conversationId);
    setInput(turns[i]!.content);
    setTurns(turns.slice(0, i));
    setTimeout(() => textarea.current?.focus(), 30);
  };

  const continueLast = () => {
    if (busy) return;
    void send(t('chatContinuePrompt'));
  };

  const quoteTurn = (turn: Turn) => {
    const text = turn.content.trim().split('\n').slice(0, 12).join('\n');
    const quoted = text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    setInput((cur) => `${quoted}\n\n${cur}`);
    setTimeout(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 20);
  };

  const attachFile = () => {
    const el = textarea.current;
    const caret = el?.selectionStart ?? input.length;
    const before = input.slice(0, caret);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${pad}@${input.slice(caret)}`;
    setInput(next);
    const at = before.length + pad.length + 1;
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(at, at);
      updateSuggest(next, at);
    }, 10);
  };

  const copyTurn = (turn: Turn) => {
    void navigator.clipboard.writeText(turn.content);
    toast(t('copied'));
  };

  /** Runs a "/" command; returns true when it was handled without sending text. */
  const runSlash = async (text: string): Promise<boolean> => {
    const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
    if (!m) return false;
    const cmd = findSlash(m[1]!);
    if (!cmd) {
      // A "/" command of the project (or the user): its file is the prompt.
      const name = m[1]!.toLowerCase();
      const own = kitCommands.find((c) => c.name === name);
      if (own) {
        setInput('');
        setSuggest(null);
        void send(expandCommand(own.body, m[2]!), [], own.agent === true);
        return true;
      }
      // /<skill>: the agent loads that skill and applies it (skills need agent mode).
      const skill = kitSkills.find((k) => k.name === name);
      if (!skill) return false;
      setInput('');
      setSuggest(null);
      void send(skillPrompt(skill.name, m[2]!), [], true);
      return true;
    }
    const rest = m[2]!.trim();
    setInput('');
    setSuggest(null);
    switch (cmd.action) {
      case 'new':
        if (busy) newChat();
        else resetChat();
        return true;
      case 'agent':
        setAgentMode(true);
        toast(t('agentOnToast'));
        return true;
      case 'chat':
        setAgentMode(false);
        toast(t('agentOffToast'));
        return true;
      case 'plan':
        setChatMode('plan', true);
        return true;
      case 'phases': {
        // /fases <file.md> analyses that file; /fases alone opens the picker.
        const path = rest.replace(/^@/, '');
        if (path && files.includes(path)) void phases.open(path);
        else phases.setPicker(true);
        return true;
      }
      case 'rules':
        void runCommand('ai.rules');
        return true;
      case 'docs': {
        // /indexar <name> <url> · /indexar <url> · /indexar (list what is indexed)
        const parts = rest.split(/\s+/).filter(Boolean);
        const url = parts.find((p) => /^https?:\/\//i.test(p));
        if (!url) {
          const docs = await api()
            .knowledge.docs()
            .catch(() => []);
          toast(
            docs.length
              ? `${docs.map((d) => `@docs:${d.name} · ${d.status}`).join(' · ')} — ${t('docsUsage')}`
              : t('docsListEmpty'),
          );
          return true;
        }
        const name = parts.filter((p) => p !== url).join('-');
        try {
          const d = await api().knowledge.addDocs(name, url);
          toast(t('docsAdded', { name: d.name }));
        } catch (e) {
          toast(errText(e));
        }
        return true;
      }
      case 'commit':
        if (!root) {
          toast(t('noFolder'));
          return true;
        }
        if (!ownFolder) setState({ sidebar: 'git' });
        void send(t('slashCommitPrompt'), [], true);
        return true;
    }
    if (cmd.name === 'init' && !root) {
      toast(t('noFolder'));
      return true;
    }
    void send(rest ? `${cmd.prompt}\n\n${rest}` : cmd.prompt!, [], Boolean(cmd.agent));
    return true;
  };

  /** Opens the "/" or "@" menu for the text left of the caret. */
  const updateSuggest = (value: string, caret: number) => {
    const left = value.slice(0, caret);
    const slash = /^\/(\S*)$/.exec(left);
    if (slash) {
      const q = slash[1]!.toLowerCase();
      const items = slashCommands()
        .filter((c) => c.name.startsWith(q) || c.en.startsWith(q))
        .map((c) => {
          // Typed in the other language: keep suggesting the name being typed.
          const name = slashName(c).startsWith(q)
            ? slashName(c)
            : c.name.startsWith(q)
              ? c.name
              : c.en;
          return { id: name, label: `/${name}`, hint: c.hint };
        });
      for (const c of kitCommands)
        if (c.name.startsWith(q) && !findSlash(c.name))
          items.push({
            id: c.name,
            label: `/${c.name}`,
            hint: `${c.argumentHint ? `${c.argumentHint} · ` : ''}${c.description || t('slashCustom')}`,
          });
      for (const k of kitSkills)
        if (
          k.name.startsWith(q) &&
          !findSlash(k.name) &&
          !kitCommands.some((c) => c.name === k.name)
        )
          items.push({
            id: k.name,
            label: `/${k.name}`,
            hint: `${t('slashSkill')} · ${k.description}`,
          });
      return setSuggest(
        items.length ? { kind: 'slash', from: 0, to: caret, items, index: 0 } : null,
      );
    }
    const at = /(^|\s)@([^\s@]*)$/.exec(left);
    if (at) {
      const q = at[2]!.toLowerCase();
      const from = caret - at[2]!.length - 1;
      // "@docs:" — the names of the indexed documentation.
      if (q.startsWith('docs:')) {
        const dq = q.slice(5);
        const items = docNamesRef.current
          .filter((n) => n.toLowerCase().startsWith(dq))
          .slice(0, 12)
          .map((n) => ({ id: `docs:${n}`, label: `@docs:${n}`, special: true }));
        if (!docNamesRef.current.length) void loadDocNames();
        return setSuggest(items.length ? { kind: 'file', from, to: caret, items, index: 0 } : null);
      }
      // Fase 8: the special mentions first, then the files.
      const specials = MENTION_KINDS.filter((k) => k.startsWith(q)).map((k: MentionKind) => ({
        id: k,
        label: `@${k}`,
        hint: t(MENTION_HINT[k]),
        insert: k === 'web' || k === 'docs' ? `@${k}:` : undefined,
        special: true,
      }));
      if (q === '' || 'docs'.startsWith(q)) void loadDocNames();
      const scored = files
        .map((f) => {
          const lower = f.toLowerCase();
          const name = lower.slice(lower.lastIndexOf('/') + 1);
          const score = !q
            ? 1
            : name.startsWith(q)
              ? 3
              : name.includes(q)
                ? 2
                : lower.includes(q)
                  ? 1
                  : 0;
          return { f, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.f.length - b.f.length)
        .slice(0, 12);
      const items = [
        ...specials,
        ...scored.slice(0, 12 - Math.min(specials.length, 5)).map(({ f }) => ({
          id: f,
          label: f.slice(f.lastIndexOf('/') + 1),
          hint: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '',
        })),
      ];
      return setSuggest(items.length ? { kind: 'file', from, to: caret, items, index: 0 } : null);
    }
    setSuggest(null);
  };

  const pickSuggest = (s: Suggest, i = s.index) => {
    const item = s.items[i];
    if (!item) return;
    const insert = s.kind === 'slash' ? `/${item.id} ` : (item.insert ?? `@${item.id} `);
    const next = input.slice(0, s.from) + insert + input.slice(s.to);
    setInput(next);
    setSuggest(null);
    const caret = s.from + insert.length;
    setTimeout(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(caret, caret);
    }, 0);
  };

  const submit = async () => {
    if (await runSlash(input)) return;
    // Still working: the message runs alongside (the answers stream at the same time).
    void send(input);
  };

  /** Rewrites what is in the box with the chat's model; the user reviews it before sending. */
  const improvePrompt = async () => {
    const original = input;
    if (!original.trim() || improving) return;
    setImproving(true);
    try {
      const model = chatModel ?? (agentMode ? settings.roles.agent : undefined);
      const better = await api().ai.improvePrompt(original, model ?? undefined);
      // The user kept typing meanwhile: their text wins.
      if (textarea.current && textarea.current.value !== original) return;
      setBeforeImprove(original);
      setInput(better);
      toast(t('chatImproveDone'));
      setTimeout(() => textarea.current?.focus(), 30);
    } catch (err) {
      toast(errText(err));
    } finally {
      setImproving(false);
    }
  };

  /** Puts what is in the box in the queue: it goes out by itself when the answers end. */
  const enqueue = () => {
    if (!input.trim()) return;
    updateChat(id, { queued: [...queued, input] });
    setInput('');
  };

  /** Runs what is in the box in a new chat (same model, mode and folder) alongside this one. */
  const sendParallel = () => {
    if (!input.trim()) return;
    const opened = newParallelChat(id, {
      model: meta?.model ?? null,
      agent: agentMode,
      folder: meta?.folder,
      noFolder: meta?.noFolder,
      initial: { prompt: input, send: true },
    });
    if (opened) setInput('');
  };

  /** Stops the running answers; queued messages wait until the user sends them. */
  const stop = () => {
    // A retry waiting to go is called off too.
    if (retryTimer.current) cancelRetry();
    if (!busy) return;
    stopped.current = true;
    for (const rid of running) void api().ai.abort(rid);
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && e.shiftKey && !suggest && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      setChatMode(nextMode(chatMode), true);
      return;
    }
    if (e.key === 'Escape' && busy && !suggest) {
      e.preventDefault();
      stop();
      return;
    }
    if (suggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = suggest.items.length;
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setSuggest({ ...suggest, index: (suggest.index + d + n) % n });
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        // A complete "/command" + Enter runs it right away.
        const item = suggest.items[suggest.index];
        if (e.key === 'Enter' && suggest.kind === 'slash' && item && input.trim() === `/${item.id}`)
          return void submit();
        pickSuggest(suggest);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }
    // ↑ / ↓ in an empty (or recalled) box walk through the prompts sent before.
    const recalled = sentIdx.current >= 0 && input === sent.current[sentIdx.current];
    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      (!input || recalled) &&
      sent.current.length
    ) {
      e.preventDefault();
      const n = sent.current.length;
      let i = sentIdx.current < 0 ? n : sentIdx.current;
      i = e.key === 'ArrowUp' ? Math.max(0, i - 1) : i + 1;
      if (i >= n) {
        sentIdx.current = -1;
        setInput('');
      } else {
        sentIdx.current = i;
        setInput(sent.current[i]!);
      }
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      sendParallel();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  /** Answers an approval; `rid` is the answer it belongs to (several may be running). */
  const decide = (toolCallId: string, d: ToolDecision, rid?: string) => {
    // ask_user waits for an answer (QuestionCard), never for approve / deny (e.g. a shortcut).
    if (
      turnsNow.current.some((x) =>
        x.parts?.some((p) => p.kind === 'tool' && p.id === toolCallId && p.name === 'ask_user'),
      )
    )
      return;
    const asks = (turn: Turn) =>
      turn.role === 'assistant' &&
      turn.parts?.some((p) => p.kind === 'tool' && p.id === toolCallId && p.status === 'approval');
    const owner =
      rid ?? turnsNow.current.find((x) => x.rid && running.includes(x.rid) && asks(x))?.rid;
    if (!owner || !running.includes(owner)) return;
    void api().ai.toolDecision(owner, toolCallId, d);
    // The card leaves the approval state right away (a long command or a helper AI may
    // run for minutes); its result updates it again when it arrives.
    setTurns((x) =>
      x.map((turn) =>
        turn.role === 'assistant' && turn.rid === owner
          ? {
              ...turn,
              parts: (turn.parts ?? []).map((p) =>
                p.kind === 'tool' && p.id === toolCallId && p.status === 'approval'
                  ? { ...p, status: d === 'deny' ? 'error' : 'running' }
                  : p,
              ),
            }
          : turn,
      ),
    );
  };

  /** Answers an ask_user question (Fase 3); null = let the agent decide. */
  const answer = (toolCallId: string, a: string[] | null, rid?: string) => {
    const owner =
      rid ??
      turnsNow.current.find(
        (x) =>
          x.rid &&
          running.includes(x.rid) &&
          x.parts?.some((p) => p.kind === 'tool' && p.id === toolCallId),
      )?.rid;
    if (!owner || !running.includes(owner)) return;
    void api().ai.answerQuestion(owner, toolCallId, a);
    setTurns((x) =>
      x.map((turn) =>
        turn.role === 'assistant' && turn.rid === owner
          ? {
              ...turn,
              parts: (turn.parts ?? []).map((p) =>
                p.kind === 'tool' && p.id === toolCallId && p.status === 'approval'
                  ? { ...p, status: 'running' }
                  : p,
              ),
            }
          : turn,
      ),
    );
  };

  /** The plan of an answer: its last block of text (what came before is the investigation). */
  const planOf = (turn: Turn) =>
    [...(turn.parts ?? [])]
      .reverse()
      .find((p): p is { kind: 'text'; text: string } => p.kind === 'text' && Boolean(p.text.trim()))
      ?.text.trim() ?? turn.content.trim();
  const markPlan = (turn: Turn, plan: 'approved' | 'rejected') =>
    setTurns((x) => x.map((y) => (y.id === turn.id ? { ...y, plan } : y)));
  /** Approved: the chat goes to agent mode and the plan (maybe edited) starts the work. */
  const approvePlan = (turn: Turn, edited?: string, run: 'agent' | 'auto' = 'agent') => {
    if (busy) return;
    const plan = (edited ?? planOf(turn)).trim();
    if (!plan) return;
    markPlan(turn, 'approved');
    setPlanEdit(null);
    setChatMode(run, run === 'auto');
    // As a queued message: what the user is typing stays in the box.
    void send(
      planApprovedPrompt(plan, lang === 'en' ? 'en' : 'es'),
      [],
      true,
      undefined,
      true,
      run,
    );
  };
  const rejectPlan = (turn: Turn) => {
    markPlan(turn, 'rejected');
    textarea.current?.focus();
  };

  const revert = async () => {
    if (!conversationId) return;
    if (!(await confirmDialog(t('revertConfirm', { n: changed.length }), { danger: true }))) return;
    let restored: string[];
    try {
      restored = await api().ai.revert(conversationId, ownFolder);
    } catch (err) {
      toast(errText(err));
      return;
    }
    for (const p of restored) await reloadFromDisk(p);
    setChanged([]);
    toast(t('reverted', { n: restored.length }));
  };

  // Fase 2 — "volver aquí" (index of the user message) and the review of one answer's diff.
  const [rewindAt, setRewindAt] = useState<number | null>(null);
  const [reviewTurn, setReviewTurn] = useState<string | null>(null);
  const RUN_TOOLS = useMemo(() => new Set(['run_command']), []);

  // What "volver aquí" would write back: loaded once per opened dialog.
  const rewindPreview = useMemo(() => {
    if (rewindAt === null || !conversationId) return undefined;
    const rids = [...new Set(turns.slice(rewindAt).flatMap((x) => (x.rid ? [x.rid] : [])))];
    return () => api().ai.rewindPreview(conversationId, rids, ownFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the dialog opens
  }, [rewindAt, conversationId]);

  const openRewind = (turn: Turn) => {
    if (busy || !conversationId) return;
    const i = turns.indexOf(turn);
    if (i >= 0) setRewindAt(i);
  };

  const rewindTo = async (i: number, mode: RewindMode) => {
    const turn = turns[i];
    if (busy || !conversationId || !turn || turn.role !== 'user') return;
    if (mode !== 'chat') {
      // That exchange and every later one (the agent cuts by order, helpers included).
      const rids = [...new Set(turns.slice(i).flatMap((x) => (x.rid ? [x.rid] : [])))];
      let restored: string[];
      try {
        restored = await api().ai.rewind(conversationId, rids, ownFolder);
      } catch (err) {
        toast(errText(err));
        return;
      }
      for (const p of restored) await reloadFromDisk(p);
      setChanged((c) => c.filter((p) => !restored.includes(p)));
      toast(restored.length ? t('rewoundFiles', { n: restored.length }) : t('rewoundNoFiles'));
    }
    if (mode !== 'code') {
      const userIndex = turns.slice(0, i).filter((x) => x.role === 'user').length;
      try {
        await api().ai.rewindConversation(conversationId, userIndex);
      } catch (err) {
        toast(errText(err));
        return;
      }
      setTurns(turns.slice(0, i));
      setInput(turn.content);
      setTimeout(() => textarea.current?.focus(), 30);
    }
  };

  const noProviders = models.length === 0 && !settings.defaultModel;
  const online = useOnline();
  /** Providers that run on this machine (they keep working offline); read when offline. */
  const [localProviders, setLocalProviders] = useState<string[] | null>(null);
  useEffect(() => {
    if (online || localProviders) return;
    void api()
      .ai.providers()
      .then((list) => setLocalProviders(list.filter((p) => p.local).map((p) => p.id)))
      .catch(() => setLocalProviders([]));
  }, [online, localProviders]);
  const lastUser = lastUserIndex();

  // The messages get one stable object whose functions call the latest closures: a new
  // function per render would defeat TurnView's memo and re-render every message per token.
  const latest = useRef<TurnActions | null>(null);
  latest.current = {
    editLast: () => void editLast(),
    regenerate: () => void regenerate(),
    continueLast,
    agentOff: () => setAgentMode(false),
    copy: copyTurn,
    quote: quoteTurn,
    handoff,
    decide,
    answer,
    approvePlan: (turn, mode) => approvePlan(turn, undefined, mode),
    editPlan: (turn) => setPlanEdit(turn),
    rejectPlan,
    rewind: openRewind,
    review: (turn) => turn.rid && setReviewTurn(turn.rid),
  };
  const turnActions = useMemo<TurnActions>(
    () => ({
      editLast: () => latest.current!.editLast(),
      regenerate: () => latest.current!.regenerate(),
      continueLast: () => latest.current!.continueLast(),
      agentOff: () => latest.current!.agentOff(),
      copy: (turn) => latest.current!.copy(turn),
      quote: (turn) => latest.current!.quote(turn),
      handoff: (turn) => latest.current!.handoff(turn),
      decide: (toolCallId, d, rid) => latest.current!.decide(toolCallId, d, rid),
      answer: (toolCallId, a, rid) => latest.current!.answer(toolCallId, a, rid),
      approvePlan: (turn, mode) => latest.current!.approvePlan(turn, mode),
      editPlan: (turn) => latest.current!.editPlan(turn),
      rejectPlan: (turn) => latest.current!.rejectPlan(turn),
      rewind: (turn) => latest.current!.rewind(turn),
      review: (turn) => latest.current!.review(turn),
    }),
    [],
  );

  /** The agent's live task list (its last todo_write in this chat), Fase 3. */
  const todos = useMemo(() => latestTodos(turns), [turns]);
  /** Which answers are plans, and the user's verdict on each (also after reopening). */
  const plans = useMemo(
    () =>
      // The analysis of Modo Fases is run from its own panel, not approved as a plan.
      planStates(turns).map((st, i) =>
        st && turns[i - 1]?.role === 'user' && isAnalyzePrompt(turns[i - 1]!.content) ? null : st,
      ),
    [turns],
  );

  const shownModel =
    chatModel ?? (agentMode ? settings.roles.agent : undefined) ?? settings.defaultModel;
  // Offline with a cloud model: say so above the box (not only in the empty chat).
  const offlineBanner =
    !online &&
    !settings.localOnly &&
    !(shownModel && localProviders?.includes(shownModel.split('/')[0]!));

  return (
    <div
      id={`chat-pane-${id}`}
      role="tabpanel"
      aria-labelledby={`chat-tab-${id}`}
      className={`chat chat-session ${split && visible && focusedPane === pane ? 'focused' : ''}`}
      style={{ display: visible ? 'flex' : 'none', order: pane ?? 0 }}
      onMouseDown={() => {
        if (pane !== null && getState().chatFocus !== pane) setState({ chatFocus: pane });
      }}
    >
      {(split || ownFolder) && (
        <div className="chat-pane-head" title={meta?.title}>
          {shownModel && <ProviderLogo id={shownModel.split('/')[0]!} size={13} />}
          <span className="chat-pane-model">{shownModel ?? t('noModel')}</span>
          <span className="chat-pane-title">{meta?.title}</span>
          {ownFolder && (
            <button
              className="chat-pane-folder"
              title={t('chatFolderRelease', { path: ownFolder })}
              onClick={() => updateChat(id, { folder: undefined })}
            >
              <Icon name="folder" size={11} /> {folderName(ownFolder)}
            </button>
          )}
        </div>
      )}
      {showHistory && (
        <ChatHistory
          current={conversationId}
          onOpen={(cid, project) => openConversation(cid, project)}
          onClose={() => setShowHistory(false)}
          onDeleted={(cid) => {
            // The deleted conversation may be open in any chat: empty those.
            for (const c of getState().chats)
              if (c.conversationId === cid) handles.get(c.id)?.reset();
          }}
        />
      )}
      <div
        style={{ display: showHistory ? 'none' : undefined }}
        className="chat-scroll"
        role="log"
        aria-live="polite"
        aria-busy={Boolean(busy)}
        aria-label={t('chatMessages')}
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (stick.current !== atBottom) setAtBottom(stick.current);
        }}
      >
        {turns.length === 0 && (
          <div className="chat-empty">
            <img className="chat-logo" src="./logo.svg" alt="" />
            {noProviders ? (
              <>
                <p>{t('noProviders')}</p>
                <button
                  className="primary"
                  onClick={() => setState({ modal: { kind: 'providers' } })}
                >
                  {t('connectProvider')}
                </button>
                <OfflineGames offline={!online} />
              </>
            ) : !online ? (
              <OfflineGames offline />
            ) : chatBot ? (
              <div className="chat-hints chat-bot-intro">
                <p className="chat-bot-name">
                  <span aria-hidden="true">{chatBot.icon}</span> <strong>{chatBot.name}</strong>
                </p>
                {chatBot.description && <p className="dim">{chatBot.description}</p>}
                {chatBot.greeting && <p className="chat-bot-greeting">{chatBot.greeting}</p>}
              </div>
            ) : (
              <div className="dim chat-hints">
                <p>{agentMode ? t('agentHint') : t('chatHint')}</p>
                <div className="chat-suggestions">
                  <div className="chat-suggestions-title">{t('chatTry')}</div>
                  {(['chatSuggest1', 'chatSuggest2', 'chatSuggest3', 'chatSuggest4'] as const)
                    .filter((k) => agentMode || k !== 'chatSuggest4')
                    .map((k) => (
                      <button
                        key={k}
                        className="chat-suggestion"
                        onClick={() => {
                          setInput(t(k));
                          textarea.current?.focus();
                        }}
                      >
                        <span
                          className="tone-badge"
                          style={{ '--tone': TONE[SUGGEST_ICON[k]] } as CSSProperties}
                        >
                          <Icon name={SUGGEST_ICON[k]} size={14} />
                        </span>
                        {t(k)}
                      </button>
                    ))}
                </div>
                <p>{t('chatTips')}</p>
                <p>
                  {shortcutOf('ai.askSelection')} · {t('includeFile')}
                  <br />
                  {shortcutOf('ai.edit')} · {t('aiEdit')}
                </p>
              </div>
            )}
          </div>
        )}
        {turns.map((turn, i) => (
          <TurnView
            key={turn.id}
            turn={turn}
            // This answer is still streaming.
            live={turn.role === 'assistant' && Boolean(turn.rid && running.includes(turn.rid))}
            // Last exchange with nothing running: regenerate / continue apply to it.
            last={i === turns.length - 1 && !busy}
            canEdit={!busy && i === lastUser}
            idle={!busy}
            planState={plans[i]}
            defaultModel={settings.defaultModel}
            agentMode={agentMode}
            actions={turnActions}
          />
        ))}
      </div>
      {!atBottom && turns.length > 0 && !showHistory && (
        <button
          className="chat-to-bottom"
          title={t('chatScrollBottom')}
          aria-label={t('chatScrollBottom')}
          onClick={() => {
            stick.current = true;
            setAtBottom(true);
            scroller.current?.scrollTo({
              top: scroller.current.scrollHeight,
              behavior: 'smooth',
            });
          }}
        >
          <Icon name="arrowDown" size={15} />
        </button>
      )}
      {rewindAt !== null && turns[rewindAt] && (
        <RewindDialog
          edits={turns.slice(rewindAt).reduce((n, x) => n + stepsOf(x, EDIT_TOOLS), 0)}
          commands={turns.slice(rewindAt).reduce((n, x) => n + stepsOf(x, RUN_TOOLS), 0)}
          preview={rewindPreview}
          onPick={(mode) => void rewindTo(rewindAt, mode)}
          onClose={() => setRewindAt(null)}
        />
      )}
      {planEdit && (
        <PlanEditor
          plan={planOf(planEdit)}
          onClose={() => setPlanEdit(null)}
          onRun={(p, run) => approvePlan(planEdit, p, run)}
        />
      )}
      {reviewTurn && conversationId && (
        <DiffReview
          conversationId={conversationId}
          turn={reviewTurn}
          folder={ownFolder}
          commands={turns.reduce(
            (n, x) => n + (x.rid === reviewTurn ? stepsOf(x, RUN_TOOLS) : 0),
            0,
          )}
          onClose={() => setReviewTurn(null)}
        />
      )}
      {changed.length > 0 && !busy && (
        <div className="agent-changes">
          <Icon name="edit" size={14} /> {t('agentChanged', { n: changed.length })}
          <button onClick={() => void revert()}>
            <Icon name="undo" size={13} /> {t('revert')}
          </button>
        </div>
      )}
      {offlineBanner && (
        <div className="chat-offline-banner" role="status">
          <Icon name="warning" size={13} /> {t('chatOfflineBanner')}
        </div>
      )}
      <div
        className="chat-input"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files];
          if (!files.some((f) => IMAGE_MIME.includes(f.type))) return;
          e.preventDefault();
          void addImages(files);
        }}
      >
        {images.length > 0 && (
          <div className="chat-images">
            {images.map((im, k) => (
              <span key={k} className="chat-image" title={im.name}>
                <img src={`data:${im.mediaType};base64,${im.data}`} alt={im.name} />
                <button
                  aria-label={t('removeAttachment')}
                  title={t('removeAttachment')}
                  onClick={() => setImages((cur) => cur.filter((_, j) => j !== k))}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="chat-attachments">
            {attachments.map((c) => (
              <span key={c.source} className="chat-attachment" title={c.content.slice(-600)}>
                <Icon
                  name={c.source.startsWith('terminal:') ? 'terminal' : 'paperclip'}
                  size={12}
                />{' '}
                {contextLabel(c.source)}
                <button
                  aria-label={t('removeAttachment')}
                  title={t('removeAttachment')}
                  onClick={() =>
                    setState((st) => ({
                      chatAttachments: st.chatAttachments.filter((x) => x.source !== c.source),
                    }))
                  }
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {tasksOpen && (
          <TasksPanel
            status={tasksStatus}
            model={chatModel}
            seed={taskSeed}
            onClose={() => {
              setTasksOpen(false);
              setTaskSeed(null);
            }}
            onOpenChat={(cid, folder) => {
              setTasksOpen(false);
              openConversation(cid, folder);
            }}
          />
        )}
        {kitMenu && kit && (
          <AgentKitMenu
            kit={kit}
            menuRef={kitMenuEl}
            canEdit={!noFolder && !ownFolder && Boolean(root)}
            onOpen={(path) => {
              setKitMenu(false);
              void openFile(path).catch((err: unknown) => toast(errText(err)));
            }}
            onInsert={(name) => {
              setKitMenu(false);
              setInput(`/${name} `);
              textarea.current?.focus();
            }}
            onCreate={(kind) => void createKit(kind)}
          />
        )}
        {rulesMenu && rulesView && (
          <div
            ref={rulesMenuEl}
            className="term-menu rules-menu"
            role="menu"
            aria-label={t('rulesPanel')}
            onKeyDown={menuArrows}
          >
            <div className="term-menu-title">
              {t('rulesPanel')} · {t('rulesTokens', { tokens: rulesView.tokens.toLocaleString() })}
            </div>
            {rulesView.active.length === 0 && <div className="rules-empty">{t('rulesNone')}</div>}
            {rulesView.active.map((r) => (
              <button
                key={r.path}
                role="menuitem"
                title={r.description || r.path}
                disabled={Boolean(ownFolder)}
                onClick={() => {
                  setRulesMenu(false);
                  void openFile(r.path);
                }}
              >
                <Icon name="scroll" size={13} />
                <span className="rules-path">{r.path}</span>
                <span className="rules-why">
                  {ruleReason(r.reason)}
                  {rulesView.truncated.includes(r.path) ? ` · ${t('rulesCut')}` : ''} ·{' '}
                  {t('rulesTokens', { tokens: r.tokens.toLocaleString() })}
                </span>
              </button>
            ))}
            {rulesView.available.length > 0 && (
              <>
                <div className="term-menu-head">{t('rulesAvailable')}</div>
                {rulesView.available.map((r) => (
                  <button
                    key={r.path}
                    role="menuitem"
                    title={r.description || r.path}
                    onClick={() => {
                      setRulesMenu(false);
                      setInput((v) => `${v}${v && !/\s$/.test(v) ? ' ' : ''}@${r.name} `);
                      textarea.current?.focus();
                    }}
                  >
                    <Icon name="plus" size={13} />
                    <span className="rules-path">@{r.name}</span>
                    <span className="rules-why">
                      {r.applies === 'glob' ? r.globs.join(', ') : r.description || r.path}
                    </span>
                  </button>
                ))}
              </>
            )}
            <div className="rules-actions">
              <button
                role="menuitem"
                onClick={() => {
                  setRulesMenu(false);
                  void runCommand('ai.rules');
                }}
              >
                <Icon name="edit" size={13} /> {t('rulesEdit')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setRulesMenu(false);
                  void runSlash('/init');
                }}
              >
                <Icon name="sparkle" size={13} /> /init
              </button>
            </div>
          </div>
        )}
        {termMenu && (
          <div
            ref={termMenuEl}
            className="term-menu add-menu"
            role="menu"
            aria-label={t('chatAddMenu')}
            onKeyDown={menuArrows}
          >
            {(
              [
                ['paperclip', t('chatAttach'), attachFile],
                ['layers', ps().menu, () => phases.setPicker(true)],
                ['image', t('chatAttachImage'), () => imagePicker.current?.click()],
                ['film', tv('openStudioHint'), () => void openStudio()],
              ] as const
            ).map(([icon, text, run]) => {
              // "Label (hint)" / "Label · hint": the hint goes right, dimmed.
              const [label, hint] = text.split(/ \(| · /);
              return (
                <button
                  key={icon}
                  role="menuitem"
                  className="add-menu-item"
                  onClick={() => {
                    setTermMenu(null);
                    run();
                  }}
                >
                  <Icon name={icon} size={14} />
                  <span className="add-menu-label">{label}</span>
                  {hint && <span className="add-menu-hint">{hint.replace(/\)$/, '')}</span>}
                </button>
              );
            })}
            <div className="term-menu-head">{t('chatOptions')}</div>
            <label className="add-menu-item add-menu-row" title={t('reasoningTitle')}>
              <Icon name="thinking" size={14} />
              <select
                value={reasoning}
                onChange={(e) => {
                  const v = e.target.value as ReasoningLevel | '';
                  setReasoning(v);
                  if (v) localStorage.setItem(REASONING_KEY, v);
                  else localStorage.removeItem(REASONING_KEY);
                }}
              >
                <option value="">{t('reasoningAuto')}</option>
                <option value="low">{t('reasoningLow')}</option>
                <option value="medium">{t('reasoningMedium')}</option>
                <option value="high">{t('reasoningHigh')}</option>
              </select>
            </label>
            {agentMode && (
              <button
                role="menuitemcheckbox"
                aria-checked={computerOn}
                className="add-menu-item"
                title={t('computerPillTitle')}
                onClick={() => {
                  setTermMenu(null);
                  void toggleComputer();
                }}
              >
                <Icon name="monitor" size={14} />
                <span className="add-menu-label">{t('computerMenu')}</span>
                {computerOn && <Icon name="check" size={13} className="add-menu-check" />}
              </button>
            )}
            <button
              role="menuitemcheckbox"
              aria-checked={includeFile}
              className="add-menu-item"
              onClick={() => setIncludeFile(!includeFile)}
            >
              <Icon name="file" size={14} />
              <span className="add-menu-label">{t('includeFile')}</span>
              {includeFile && <Icon name="check" size={13} className="add-menu-check" />}
            </button>
            {(Boolean(root) || tasksNow.active > 0) && (
              <button
                role="menuitem"
                className="add-menu-item"
                title={t('tasksChip', tasksNow)}
                onClick={() => {
                  setTermMenu(null);
                  setTasksOpen(true);
                }}
              >
                <Icon name="layers" size={14} />
                <span className="add-menu-label">{t('tasksPanel')}</span>
                {tasksNow.active > 0 && <span className="add-menu-hint">{tasksNow.active}</span>}
              </button>
            )}
            {kit && (!noFolder || kitCommands.length + kitSkills.length + kit.agents.length > 0) && (
              <button
                role="menuitem"
                className="add-menu-item"
                title={t('kitChip', {
                  agents: kit.agents.length,
                  skills: kit.skills.length,
                  commands: kit.commands.length,
                  hooks: kit.hooks.length,
                })}
                onClick={() => {
                  setTermMenu(null);
                  setKitMenu(true);
                }}
              >
                <Icon name="package" size={14} />
                <span className="add-menu-label">{t('kitPanel')}</span>
                {kit.agents.length + kit.skills.length > 0 && (
                  <span className="add-menu-hint">{kit.agents.length + kit.skills.length}</span>
                )}
              </button>
            )}
            {rulesView?.enabled && rulesView.active.length + rulesView.available.length > 0 && (
              <button
                role="menuitem"
                className="add-menu-item"
                title={t('rulesActive', {
                  n: rulesView.active.length,
                  tokens: rulesView.tokens.toLocaleString(),
                })}
                onClick={() => {
                  setTermMenu(null);
                  setRulesMenu(true);
                }}
              >
                <Icon name="scroll" size={14} />
                <span className="add-menu-label">{t('rulesPanel')}</span>
                {rulesView.active.length > 0 && (
                  <span className="add-menu-hint">{rulesView.active.length}</span>
                )}
              </button>
            )}
            <div className="term-menu-head">{t('terminal')}</div>
            {termMenu.length === 0 ? (
              <button
                role="menuitem"
                onClick={() => {
                  setState({ panelOpen: true });
                  setTermMenu(null);
                }}
              >
                <Icon name="plus" size={13} /> {t('termOpenNew')}
              </button>
            ) : (
              termMenu.flatMap((term) => [
                <button
                  key={`${term.id}:s`}
                  role="menuitem"
                  onClick={() => {
                    sendTerminalToChat(term.id, 'session');
                    setTermMenu(null);
                    textarea.current?.focus();
                  }}
                >
                  <Icon name="terminal" size={13} /> {t('termSession', { n: term.n })}
                </button>,
                term.hasSelection && (
                  <button
                    key={`${term.id}:sel`}
                    role="menuitem"
                    onClick={() => {
                      sendTerminalToChat(term.id, 'selection');
                      setTermMenu(null);
                      textarea.current?.focus();
                    }}
                  >
                    <Icon name="scissors" size={13} /> {t('termSelection', { n: term.n })}
                  </button>
                ),
              ])
            )}
          </div>
        )}
        {suggest && (
          <div className="chat-suggest" role="listbox">
            <div className="term-menu-title">
              {suggest.kind === 'slash' ? t('slashTitle') : t('mentionTitle')}
            </div>
            {suggest.items.map((it, i) => (
              <div
                key={it.id}
                role="option"
                aria-selected={i === suggest.index}
                className={`chat-suggest-item ${i === suggest.index ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSuggest(suggest, i);
                }}
              >
                <span className="chat-suggest-label">
                  {suggest.kind === 'file' && !it.special ? fileIcon(it.id) : null}
                  {it.label}
                </span>
                {it.hint && <span className="chat-suggest-hint">{it.hint}</span>}
              </div>
            ))}
          </div>
        )}
        {(phases.plan || phases.analyzing) && <PhasesPanel s={phases} busy={Boolean(busy)} />}
        {phases.picker && (
          <PhasesPicker
            files={files}
            active={ownFolder ? null : active}
            onPick={(f) => void phases.open(f)}
            onClose={() => phases.setPicker(false)}
          />
        )}
        {todos && (busy || todos.some((x) => x.status !== 'completed')) && (
          <TaskList todos={todos} live={Boolean(busy)} />
        )}
        {(queued.length > 0 || retry) && (
          <div className="chat-queue" aria-label={t('chatQueued')}>
            <div className="chat-queue-title">
              <Icon name="clock" size={12} />{' '}
              <span className="chat-queue-status">
                {retry
                  ? t('chatQueueRetry', {
                      s: Math.max(1, Math.round((retry.at - Date.now()) / 1000)),
                      n: retry.n,
                      max: QUEUE_RETRY_DELAYS.length,
                    })
                  : busy
                    ? t('chatQueuedNext', { n: queued.length })
                    : t('chatQueuedPaused')}
              </span>
              {retry && (
                <button
                  title={t('chatQueueRetryCancel')}
                  aria-label={t('chatQueueRetryCancel')}
                  onClick={cancelRetry}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
            <div className="chat-queue-list">
              {queued.map((q, i) => (
                <div key={i} className="chat-queue-item" title={q}>
                  <span className="chat-queue-text">{q}</span>
                  {!busy && i === 0 && (
                    <button title={t('send')} aria-label={t('send')} onClick={sendQueued}>
                      <Icon name="send" size={12} />
                    </button>
                  )}
                  <button
                    title={t('chatQueueEdit')}
                    aria-label={t('chatQueueEdit')}
                    onClick={() => {
                      updateChat(id, { queued: queued.filter((_, j) => j !== i) });
                      setInput((cur) => (cur.trim() ? `${cur}\n${q}` : q));
                      textarea.current?.focus();
                    }}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    title={t('chatQueueRemove')}
                    aria-label={t('chatQueueRemove')}
                    onClick={() => updateChat(id, { queued: queued.filter((_, j) => j !== i) })}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <textarea
          ref={textarea}
          value={input}
          rows={3}
          placeholder={
            chatMode === 'plan'
              ? t('planPlaceholder')
              : agentMode && root
                ? t('agentPlaceholder')
                : t('askPlaceholder')
          }
          aria-label={t('chatInputLabel')}
          onChange={(e) => {
            setInput(e.target.value);
            updateSuggest(e.target.value, e.target.selectionStart);
          }}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          onKeyDown={onInputKey}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (!files.some((f) => IMAGE_MIME.includes(f.type))) return;
            e.preventDefault();
            void addImages(files);
          }}
        />
        <div className="chat-input-bar">
          <button
            ref={termMenuBtn}
            className={`term-pick add-menu-btn ${termMenu ? 'on' : ''}`}
            title={t('chatAddMenu')}
            aria-label={t('chatAddMenu')}
            aria-haspopup="menu"
            aria-expanded={termMenu !== null}
            onClick={() => {
              setKitMenu(false);
              setRulesMenu(false);
              setTermMenu((m) => (m ? null : listTerminals()));
            }}
          >
            <Icon name="plus" size={15} />
          </button>
          <ModeMenu mode={chatMode} onChange={(m) => setChatMode(m)} />
          {reasoning && (
            <label className="pill reasoning-pick on" title={t('reasoningTitle')}>
              <Icon name="thinking" size={14} />
              <select
                value={reasoning}
                onChange={(e) => {
                  const v = e.target.value as ReasoningLevel | '';
                  setReasoning(v);
                  if (v) localStorage.setItem(REASONING_KEY, v);
                  else localStorage.removeItem(REASONING_KEY);
                }}
              >
                <option value="">{t('reasoningAuto')}</option>
                <option value="low">{t('reasoningLow')}</option>
                <option value="medium">{t('reasoningMedium')}</option>
                <option value="high">{t('reasoningHigh')}</option>
              </select>
              <Icon name="chevronDown" size={12} className="reasoning-caret" />
            </label>
          )}
          {agentMode && computerOn && (
            <button
              type="button"
              className={`pill computer-pill ${computerOn ? 'on' : ''}`}
              title={t('computerPillTitle')}
              aria-pressed={computerOn}
              onClick={() => void toggleComputer()}
            >
              <Icon name="monitor" size={14} />
              <span className="pill-label">
                {computerOn ? t('computerPillOn') : t('computerPill')}
              </span>
            </button>
          )}
          {includeFile && active && !active.startsWith('::') && (
            <label className="check pill on" title={t('includeFile')}>
              <input
                type="checkbox"
                checked={includeFile}
                onChange={(e) => setIncludeFile(e.target.checked)}
              />
              <Icon name="file" size={14} />
              <span className="pill-label">{active.split('/').pop()}</span>
            </label>
          )}
          <input
            ref={imagePicker}
            type="file"
            accept={IMAGE_MIME.join(',')}
            multiple
            hidden
            onChange={(e) => {
              void addImages([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          {tasksNow.active > 0 && (
            <button
              className={`rules-chip ${tasksOpen ? 'on' : ''} ${tasksNow.waiting ? 'warn' : ''}`}
              title={t('tasksChip', tasksNow)}
              aria-label={t('tasksPanel')}
              aria-haspopup="dialog"
              onClick={() => setTasksOpen(true)}
            >
              <Icon name="layers" size={15} />
              {tasksNow.active > 0 && <span className="rules-count">{tasksNow.active}</span>}
            </button>
          )}
          <span className="chat-input-spacer" aria-hidden="true" />
          <button
            className={`model-chip ${chatModel ? 'own' : ''}`}
            onClick={pickModel}
            title={chatModel ? t('chatModelOwn') : t('chatModelFor')}
          >
            {shownModel && <ProviderLogo id={shownModel.split('/')[0]!} size={13} />}
            <span className="model-chip-label">{shownModel ?? t('noModel')}</span>
            <Icon name="chevronDown" size={12} />
          </button>
          {beforeImprove !== null && (
            <button
              className="rules-chip"
              title={t('chatImproveUndo')}
              aria-label={t('chatImproveUndo')}
              onClick={() => {
                setInput(beforeImprove);
                setBeforeImprove(null);
                textarea.current?.focus();
              }}
            >
              <Icon name="undo" size={15} />
            </button>
          )}
          {input.trim() && (
            <button
              className={`rules-chip improve-btn ${improving ? 'on' : ''}`}
              title={improving ? t('chatImproving') : t('chatImprove')}
              aria-label={t('chatImprove')}
              aria-busy={improving}
              disabled={improving}
              onClick={() => void improvePrompt()}
            >
              {improving ? <span className="chat-tab-spin" /> : <Icon name="sparkle" size={15} />}
            </button>
          )}
          {(!busy || input.trim()) && (
            // One send button; "send now", "queue" and "in parallel" are in its menu.
            <SendButton
              busy={Boolean(busy)}
              hasInput={Boolean(input.trim())}
              onSend={() => void submit()}
              onQueue={enqueue}
              onParallel={sendParallel}
            />
          )}
          {busy && (
            <button className="danger stop-btn" title={t('chatStopHint')} onClick={stop}>
              <Icon name="stop" size={13} /> {t('stop')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Closes the chat of a focused tab (Delete or Ctrl+W on it) and moves the keyboard focus to
 * the tab that is shown next, so the user does not lose their place.
 */
export async function closeChatFromTab(id: string): Promise<void> {
  await requestCloseChat(id);
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('.chat-tabs [role="tab"][tabindex="0"]')?.focus(),
  );
}

/** Chat of the tab with the keyboard focus (null when the focus is elsewhere). */
export function focusedChatTab(): string | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches('.chat-tabs [role="tab"]')
    ? (el.dataset.chat ?? null)
    : null;
}

/** Asks before closing a chat that is still working, then stops and closes it. */
export async function requestCloseChat(id: string): Promise<void> {
  const h = handles.get(id);
  if (h?.busy()) {
    if (!(await confirmDialog(t('chatCloseBusy'), { danger: true }))) return;
    // Closed meanwhile (another way, while the question was open).
    if (!getState().chats.some((c) => c.id === id)) return;
    // It may have finished meanwhile: nothing left to stop then.
    if (h.busy()) h.abort();
  }
  if (getState().chatHistoryFor === id) setState({ chatHistoryFor: null });
  closeChat(id);
}

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** What a chat is doing, as a small icon (tabs and the side list). */
function ChatStatus({ c }: { c: ChatTab }) {
  return (
    <span className="chat-tab-status">
      {c.waiting ? (
        <Icon name="pause" size={11} />
      ) : c.busy ? (
        <span className="chat-tab-spin" />
      ) : c.unread ? (
        <span className="chat-tab-dot" />
      ) : c.model ? (
        <ProviderLogo id={c.model.split('/')[0]!} size={12} />
      ) : (
        <Icon name="message" size={12} />
      )}
    </span>
  );
}

function chatStatusText(c: ChatTab): string {
  return c.waiting ? t('chatWaiting') : c.busy ? t('chatRunning') : c.unread ? t('chatDoneBg') : '';
}

const OPEN_KEY = 'zs.chatProjectsOpen';

function savedOpen(): Record<string, boolean> {
  try {
    return (JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>) ?? {};
  } catch {
    return {};
  }
}

/** A chat being dragged between projects of the side list: an open one or a saved one. */
interface ChatDrag {
  chat?: string;
  conv?: string;
  from: string | undefined;
}

const CHAT_DRAG = 'application/x-zinarix-chat';

function startChatDrag(e: DragEvent, drag: ChatDrag): void {
  e.dataTransfer.setData(CHAT_DRAG, JSON.stringify(drag));
  e.dataTransfer.effectAllowed = 'move';
}

function readChatDrag(e: DragEvent): ChatDrag | null {
  try {
    return JSON.parse(e.dataTransfer.getData(CHAT_DRAG)) as ChatDrag;
  } catch {
    return null;
  }
}

/** One project of the side list: its open chats and, when unfolded, its saved ones. */
function ChatProject({
  folder,
  items,
  focusedId,
  open,
  onToggle,
  moved,
  onMove,
}: {
  folder: string | undefined;
  items: { c: ChatTab; n: number }[];
  focusedId: string;
  open: boolean;
  onToggle: () => void;
  /** Bumped when a chat moves between projects, so the saved list reloads. */
  moved: number;
  onMove: (drag: ChatDrag, to: string) => void;
}) {
  const chats = useStore((s) => s.chats);
  const activeChat = useStore((s) => s.activeChat);
  const split = useStore((s) => s.chatSplit);
  const windowRoot = useStore((s) => s.workspace?.root);
  const [saved, setSaved] = useState<ConversationView[] | null>(null);
  const [dropHere, setDropHere] = useState(false);
  const own = folder && folder !== windowRoot ? folder : undefined;
  // Reloaded when a chat of the project ends (its conversation was just saved).
  const running = items.filter((x) => x.c.busy).length;
  useEffect(() => {
    if (!open || !folder) return;
    void api()
      .ai.projectConversations(folder)
      .then(setSaved)
      .catch(() => setSaved([]));
  }, [open, folder, running, items.length, moved]);

  const busy = items.some((x) => x.c.busy);
  const waiting = items.some((x) => x.c.waiting);
  const unread = items.some((x) => x.c.unread);
  const past = (saved ?? []).filter((v) => !chats.some((c) => c.conversationId === v.id));

  // A chat of another project dropped here moves to this folder.
  const dropProps = folder
    ? {
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes(CHAT_DRAG)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropHere(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHere(false);
        },
        onDrop: (e: DragEvent) => {
          setDropHere(false);
          const drag = readChatDrag(e);
          if (!drag) return;
          e.preventDefault();
          if (drag.from !== folder) onMove(drag, folder);
        },
      }
    : {};

  return (
    <div
      className={`chat-list-group ${open ? 'open' : ''} ${dropHere ? 'drop' : ''}`}
      {...dropProps}
    >
      <div
        className={`chat-list-folder ${items.some((x) => x.c.id === focusedId) ? 'has-focus' : ''}`}
        title={folder ?? t('chatNoFolder')}
      >
        {/* The row's own button (fold / unfold); its actions are siblings, not nested in it. */}
        <button className="chat-list-folder-main" aria-expanded={open} onClick={onToggle}>
          <Icon name={open ? 'chevronDown' : 'chevron'} size={11} />
          <Icon name="folder" size={13} />
          <span>{folder ? folderName(folder) : t('chatNoFolder')}</span>
          {!open && (waiting || busy || unread) && (
            <span className="chat-tab-status">
              {waiting ? (
                <Icon name="pause" size={11} />
              ) : busy ? (
                <span className="chat-tab-spin" />
              ) : (
                <span className="chat-tab-dot" />
              )}
            </span>
          )}
          {items.length > 0 && <em className="chat-list-count">{items.length}</em>}
        </button>
        <button
          aria-label={t('chatNewHere')}
          title={t('chatNewHere')}
          onClick={(e) => {
            e.stopPropagation();
            // "No folder" with a folder open in the window: a chat that stays without one.
            newChat(folder ? { folder: own } : windowRoot ? { noFolder: true } : {});
          }}
        >
          <Icon name="plus" size={12} />
        </button>
        {!items.length && folder && folder !== windowRoot && (
          <button
            title={t('chatProjectHide')}
            aria-label={t('chatProjectHide')}
            onClick={(e) => {
              e.stopPropagation();
              forgetProject(folder);
            }}
          >
            <Icon name="x" size={11} />
          </button>
        )}
      </div>
      {open && (
        <>
          {items.length > 0 && past.length > 0 && (
            <div className="chat-list-sub">{t('chatOpenNow')}</div>
          )}
          <LimitedList
            items={items}
            keep={({ c }) => c.id === focusedId || c.id === activeChat || c.id === split}
          >
          {({ c, n }) => {
            const label = c.title || t('chatTabN', { n });
            const status = chatStatusText(c);
            const shown = c.id === activeChat || c.id === split;
            const modelName = c.model ? c.model.split('/').pop() : t('chatNoModel');
            return (
              <div
                key={c.id}
                className={`chat-list-item ${shown ? 'on' : ''} ${c.id === focusedId ? 'focus' : ''} ${c.waiting ? 'waiting' : ''}`}
                title={`${label}\n${status ? `${status} · ` : ''}${modelName}`}
                draggable={Boolean(folder)}
                onDragStart={(e) => startChatDrag(e, { chat: c.id, from: folder })}
                // Mouse: the whole row. Keyboard: the name is the button (the row holds the
                // close button, and a button cannot hold another).
                onClick={() => selectChat(c.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) void requestCloseChat(c.id);
                }}
              >
                {(c.busy || c.waiting || c.unread) && (
                  <span className="chat-list-state">
                    <ChatStatus c={c} />
                  </span>
                )}
                <span
                  className="chat-list-main"
                  role="button"
                  tabIndex={0}
                  aria-current={shown ? 'true' : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectChat(c.id);
                    } else if (e.key === 'Delete' && chats.length > 1) {
                      e.preventDefault();
                      void requestCloseChat(c.id);
                    }
                  }}
                >
                  <span className="chat-tab-label">{label}</span>
                </span>
                {c.queued.length > 0 && (
                  <em className="chat-list-count" title={t('chatQueued')}>
                    +{c.queued.length}
                  </em>
                )}
                {chats.length > 1 && (
                  <button
                    className="chat-tab-x"
                    aria-label={t('chatCloseTab')}
                    title={t('chatCloseTab')}
                    onClick={(e) => {
                      e.stopPropagation();
                      void requestCloseChat(c.id);
                    }}
                  >
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            );
          }}
          </LimitedList>
          {/* Saved chats under date headers (Hoy, Ayer, Últimos 7 días...). */}
          <RecentChats items={past}>
            {(v) => (
              <div
                key={v.id}
                className="chat-list-item past"
                title={`${v.title}\n${new Date(v.updatedAt).toLocaleString()} · ${t('histMessages', { n: v.messageCount })}${v.model ? ` · ${v.model.split('/').pop()}` : ''}\n${t('chatDragHint')}`}
                draggable
                onDragStart={(e) => startChatDrag(e, { conv: v.id, from: folder })}
                {...pressable(() =>
                  newChat({ conversationId: v.id, title: v.title.slice(0, 60), folder: own }),
                )}
              >
                <span className="chat-list-main">
                  <span className="chat-tab-label">{v.title}</span>
                </span>
                <span className="chat-list-when">{when(v.updatedAt)}</span>
                <DeleteSavedChat
                  conv={v}
                  onDeleted={(id) => setSaved((s) => (s ? s.filter((x) => x.id !== id) : s))}
                />
              </div>
            )}
          </RecentChats>
          {!items.length && saved !== null && !past.length && (
            <div className="chat-list-empty">{t('chatProjectEmpty')}</div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The open chats beside the conversation, as projects: one per folder. A click on a project
 * shows its chats (the open ones and the saved ones) and a click on a chat opens it.
 */
function ChatList({ focusedId }: { focusedId: string }) {
  const chats = useStore((s) => s.chats);
  const windowRoot = useStore((s) => s.workspace?.root);
  const known = useStore((s) => s.chatProjects);
  const [openMap, setOpenMap] = useState(savedOpen);
  const [moved, setMoved] = useState(0);
  const groups: { folder: string | undefined; items: { c: ChatTab; n: number }[] }[] = [];
  const group = (folder: string | undefined) => {
    let g = groups.find((x) => x.folder === folder);
    if (!g) groups.push((g = { folder, items: [] }));
    return g;
  };
  chats.forEach((c, i) => group(chatFolder(c)).items.push({ c, n: i + 1 }));
  if (windowRoot) group(windowRoot);
  for (const f of known) group(f);
  const focusedFolder = chatFolder(chats.find((c) => c.id === focusedId));
  // Unfolded by the user, or (until they choose) the project of the chat they are in.
  const isOpen = (f: string | undefined) => openMap[f ?? ''] ?? f === focusedFolder;
  const toggle = (f: string | undefined) => {
    const next = { ...openMap, [f ?? '']: !isOpen(f) };
    setOpenMap(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: projects just unfold as before next time
    }
  };
  const move = async (drag: ChatDrag, to: string) => {
    const tab = drag.chat ? chats.find((c) => c.id === drag.chat) : undefined;
    if (tab?.busy || tab?.waiting) {
      toast(t('chatMoveBusy'));
      return;
    }
    // The project it leaves stays in the list, even with no chat open there.
    if (drag.from !== windowRoot) rememberProject(drag.from);
    try {
      const conv = tab ? tab.conversationId : drag.conv;
      if (conv) await api().ai.moveConversation(conv, to);
    } catch (err) {
      toast(errText(err));
      return;
    }
    if (tab)
      updateChat(tab.id, { folder: to === windowRoot ? undefined : to, noFolder: undefined });
    if (!isOpen(to)) toggle(to);
    setMoved((n) => n + 1);
    toast(t('chatMoved', { folder: folderName(to) }));
  };
  return (
    <nav className="chat-list" aria-label={t('chatListTitle')}>
      <button className="chat-list-top-new" onClick={() => newChat()}>
        <Icon name="edit" size={14} /> {t('chatNewShort')}
      </button>
      <div className="chat-list-head">{t('chatProjects')}</div>
      <div className="chat-list-scroll">
        {groups.map((g) => (
          <ChatProject
            key={g.folder ?? ''}
            folder={g.folder}
            items={g.items}
            focusedId={focusedId}
            open={isOpen(g.folder)}
            onToggle={() => toggle(g.folder)}
            moved={moved}
            onMove={(drag, to) => void move(drag, to)}
          />
        ))}
      </div>
      <button className="chat-list-new" onClick={() => void newChatInFolder()}>
        <Icon name="folderPlus" size={13} /> {t('chatNewInFolder')}
      </button>
    </nav>
  );
}

/**
 * The chat panel: a tab per chat (they all run at the same time), optionally two of them
 * side by side, each with its own model, mode and conversation.
 */
export function ChatPanel() {
  const chats = useStore((s) => s.chats);
  const activeChat = useStore((s) => s.activeChat);
  const split = useStore((s) => s.chatSplit);
  const focus = useStore((s) => s.chatFocus);
  const historyFor = useStore((s) => s.chatHistoryFor);
  const list = useStore((s) => s.chatList);
  const focusedId = focus === 1 && split ? split : activeChat;
  const strip = useRef<HTMLDivElement>(null);
  const phoneOn = useStore((s) => s.phone.running);
  const appSettings = useStore((s) => s.settings);
  useEffect(() => {
    if (phoneOn) pushToPhone();
  }, [phoneOn, chats, focusedId, appSettings]);

  /** Tab that holds the keyboard focus stop (← / → move it; Enter shows that chat). */
  const [rove, setRove] = useState<string | null>(null);
  const roveId = rove && chats.some((c) => c.id === rove) ? rove : focusedId;
  useEffect(() => setRove(null), [focusedId]);
  const onTabsKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    const cid = tab?.dataset.chat;
    if (!tab || !cid || e.target !== tab) return;
    const i = chats.findIndex((c) => c.id === cid);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % chats.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + chats.length) % chats.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = chats.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectChat(cid);
      return;
    } else if (e.key === 'Delete' && chats.length > 1) {
      e.preventDefault();
      void closeChatFromTab(cid);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    const to = chats[next]!.id;
    setRove(to);
    strip.current?.querySelector<HTMLElement>(`[data-chat="${CSS.escape(to)}"]`)?.focus();
  };

  // Keep the focused tab in view when there are many. Only the tab strip scrolls (not
  // scrollIntoView, which also scrolled the panels around it and moved the whole chat).
  useEffect(() => {
    const el = strip.current;
    const tab = el?.querySelector<HTMLElement>('.chat-tab.focus');
    if (!el || !tab) return;
    const box = el.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    if (r.left < box.left) el.scrollLeft -= box.left - r.left + 8;
    else if (r.right > box.right) el.scrollLeft += r.right - box.right + 8;
  }, [focusedId, chats.length]);

  // Tabs that do not fit: the mouse wheel scrolls the strip sideways, and a "+N" button
  // opens the chat list so no chat is out of reach.
  const [hiddenTabs, setHiddenTabs] = useState(0);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const count = () => {
      const box = el.getBoundingClientRect();
      let n = 0;
      for (const tab of el.querySelectorAll<HTMLElement>('.chat-tab')) {
        const r = tab.getBoundingClientRect();
        if (r.right > box.right + 1 || r.left < box.left - 1) n++;
      }
      setHiddenTabs(n);
    };
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    count();
    const ro = new ResizeObserver(count);
    ro.observe(el);
    el.addEventListener('scroll', count, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', count);
      el.removeEventListener('wheel', onWheel);
    };
  }, [chats]);

  return (
    <div className="chat chat-multi">
      <div className="panel-header chat-tabs-bar">
        <div
          className="chat-tabs"
          role="tablist"
          aria-label={t('chatListTitle')}
          ref={strip}
          onKeyDown={onTabsKey}
        >
          {chats.map((c, i) => {
            const shown = c.id === activeChat || c.id === split;
            const label = c.title || t('chatTabN', { n: i + 1 });
            const status = chatStatusText(c);
            return (
              <div
                key={c.id}
                id={`chat-tab-${c.id}`}
                data-chat={c.id}
                role="tab"
                tabIndex={c.id === roveId ? 0 : -1}
                aria-selected={shown}
                aria-controls={`chat-pane-${c.id}`}
                className={`chat-tab ${shown ? 'on' : ''} ${c.id === focusedId ? 'focus' : ''} ${c.waiting ? 'waiting' : ''}`}
                title={[label, c.folder && folderName(c.folder), status]
                  .filter(Boolean)
                  .join(' · ')}
                onClick={() => selectChat(c.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) void requestCloseChat(c.id);
                }}
              >
                <ChatStatus c={c} />
                <span className="chat-tab-label">{label}</span>
                {chats.length > 1 && (
                  <button
                    className="chat-tab-x"
                    // Closed from the keyboard with Delete / Ctrl+W on the tab: one stop per tab.
                    tabIndex={-1}
                    aria-label={t('chatCloseTab')}
                    title={t('chatCloseTab')}
                    onClick={(e) => {
                      e.stopPropagation();
                      void requestCloseChat(c.id);
                    }}
                  >
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <span className="sidebar-actions">
          {hiddenTabs > 0 && !list && (
            <button
              className="chat-tabs-more"
              title={t('chatListToggle')}
              aria-label={t('chatListToggle')}
              onClick={toggleChatList}
            >
              +{hiddenTabs}
            </button>
          )}
          <button
            title={t('chatListToggle')}
            aria-label={t('chatListToggle')}
            aria-pressed={list}
            className={list ? 'on' : ''}
            onClick={toggleChatList}
          >
            <Icon name="menu" size={15} />
          </button>
          <button
            title={`${t('chatNewTab')} (${shortcutOf('chat.new')})`}
            aria-label={`${t('chatNewTab')} (${shortcutOf('chat.new')})`}
            onClick={() => newChat()}
          >
            <Icon name="plus" size={15} />
          </button>
          <button
            title={t('chatNewQuestion')}
            aria-label={t('chatNewQuestion')}
            onClick={() => newQuestionChat()}
          >
            <Icon name="message" size={15} />
          </button>
          <button
            title={t('chatNewInFolder')}
            aria-label={t('chatNewInFolder')}
            onClick={() => void newChatInFolder()}
          >
            <Icon name="folderPlus" size={15} />
          </button>
          <button
            title={split ? t('chatUnsplit') : `${t('chatSplit')} (${shortcutOf('chat.split')})`}
            aria-label={t('chatSplit')}
            aria-pressed={Boolean(split)}
            className={split ? 'on' : ''}
            onClick={toggleChatSplit}
          >
            <Icon name="columns" size={15} />
          </button>
          <button
            title={t('histTitle')}
            aria-label={t('histTitle')}
            aria-pressed={historyFor === focusedId}
            className={historyFor === focusedId ? 'on' : ''}
            onClick={() =>
              setState({ chatHistoryFor: historyFor === focusedId ? null : focusedId })
            }
          >
            <Icon name="history" size={15} />
          </button>
          <button
            title={t('close')}
            aria-label={t('close')}
            onClick={() => setState({ chatOpen: false })}
          >
            <Icon name="close" size={15} />
          </button>
        </span>
      </div>
      <div className="chat-body">
        {list && <ChatList focusedId={focusedId} />}
        <div className={`chat-panes ${split ? 'split' : ''}`}>
          {chats.map((c) => (
            <ChatSession
              key={c.id}
              id={c.id}
              pane={c.id === activeChat ? 0 : c.id === split ? 1 : null}
              split={Boolean(split)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
