import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  ChatContext,
  ChatEventView,
  OmniApi,
  ToolDecision,
  ToolPreview,
} from '../../shared/api';
import { t } from '../i18n';
import { languageFor, monaco } from '../monaco';
import { monacoTheme } from '../themes';
import {
  BROWSER_TAB,
  api,
  chatFolder,
  chatTab,
  closeChat,
  focusedChat,
  getEditor,
  getState,
  isChatVisible,
  newChat,
  newChatInFolder,
  newRequestId,
  reloadFromDisk,
  refreshSettings,
  saveAgentMode,
  selectChat,
  setState,
  toast,
  toggleChatList,
  toggleChatSplit,
  updateChat,
  useStore,
  type ChatTab,
} from '../store';
import { runCommand } from '../commands';
import { fileIcon } from './icons';
import { Icon, type IconName } from './Icon';
import { ProviderLogo } from './ProviderLogo';
import { ChatHistory } from './ChatHistory';
import { Markdown } from './Markdown';
import { listTerminals, sendTerminalToChat, type TerminalSession } from './Terminal';

/** Readable label for a context source ("file:src/a.ts", "terminal:2:selection", …). */
function contextLabel(source: string): string {
  const term = /^terminal:(\d+)(:selection)?$/.exec(source);
  if (term) return t(term[2] ? 'termSelection' : 'termSession', { n: term[1]! });
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
  role: 'user' | 'assistant';
  content: string;
  parts?: Part[];
  model?: string;
  meta?: string;
  error?: string;
  notices?: string[];
  reasoning?: string;
  context?: string[];
}

/** "/" commands of the message box: a ready-made prompt (or an action). */
interface Slash {
  name: string;
  hint: string;
  prompt?: string;
  agent?: boolean;
  action?: 'new' | 'agent' | 'chat' | 'rules' | 'commit';
}
function slashCommands(): Slash[] {
  return [
    { name: 'explicar', hint: t('slashExplain'), prompt: t('slashExplainPrompt') },
    { name: 'revisar', hint: t('slashReview'), prompt: t('slashReviewPrompt') },
    { name: 'arreglar', hint: t('slashFix'), prompt: t('slashFixPrompt'), agent: true },
    { name: 'pruebas', hint: t('slashTests'), prompt: t('slashTestsPrompt'), agent: true },
    { name: 'docs', hint: t('slashDocs'), prompt: t('slashDocsPrompt') },
    { name: 'optimizar', hint: t('slashOptimize'), prompt: t('slashOptimizePrompt') },
    { name: 'seguridad', hint: t('slashSecurity'), prompt: t('slashSecurityPrompt') },
    { name: 'commit', hint: t('slashCommit'), action: 'commit' },
    { name: 'reglas', hint: t('rulesEdit'), action: 'rules' },
    { name: 'agente', hint: t('slashAgent'), action: 'agent' },
    { name: 'chat', hint: t('slashChat'), action: 'chat' },
    { name: 'nuevo', hint: t('newChat'), action: 'new' },
  ];
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

interface Suggest {
  kind: 'slash' | 'file';
  /** Text range of the input being completed. */
  from: number;
  to: number;
  items: { id: string; label: string; hint?: string }[];
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
}
const handles = new Map<string, ChatHandle>();

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
}

function metaLine(m: {
  usd: number | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): string {
  return `${m.inputTokens}→${m.outputTokens} tok · ${fmtUsd(m.usd)} · ${(m.latencyMs / 1000).toFixed(1)}s`;
}

function fmtUsd(n: number | null): string {
  if (n === null) return '–';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

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
};

const STATUS_ICON: Record<ToolStep['status'], IconName> = {
  running: 'clock',
  approval: 'pause',
  ok: 'check',
  error: 'x',
};

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

function ToolCard({ step, onDecide }: { step: ToolStep; onDecide: (d: ToolDecision) => void }) {
  const [open, setOpen] = useState(step.status === 'approval');
  useEffect(() => {
    if (step.status === 'approval') setOpen(true);
  }, [step.status]);
  const icon = TOOL_ICON[step.name] ?? 'wrench';
  const p = step.preview;
  return (
    <div className={`tool-card ${step.status} ${p?.risk ? `risk-${p.risk}` : ''}`}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
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
      </div>
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
      {step.status === 'approval' && (
        <div className="tool-actions">
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
}

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
  const focusedPane = useStore((s) => s.chatFocus);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsNow = useRef(turns);
  turnsNow.current = turns;
  const [input, setInput] = useState('');
  const [includeFile, setIncludeFile] = useState(true);
  const agentMode = meta?.agent ?? true;
  const setAgentMode = (on: boolean) => {
    updateChat(id, { agent: on });
    saveAgentMode(on);
  };
  /** Model of this chat; undefined = the app default for the mode. */
  const chatModel = meta?.model ?? undefined;
  const [busy, setBusy] = useState<string | null>(null);
  const [conversationId, setConversationIdState] = useState<string | undefined>();
  const setConversationId = (c: string | undefined) => {
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
  /** The request currently streaming into the last turn, and its event unsubscribe. */
  const current = useRef<{ id: string; off: () => void } | null>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [rulesFile, setRulesFile] = useState<string | null>(null);
  const projectRules = useStore((s) => s.prefs.projectRules);
  const fsVersion = useStore((s) => s.fsVersion);
  /** Prompts sent in this session, for ↑ / ↓ in an empty box. */
  const sent = useRef<string[]>([]);
  const sentIdx = useRef(-1);
  /** Messages written while the chat works; sent one by one when each answer ends. */
  const queued = meta?.queued ?? [];
  /** The user pressed Stop: the queue does not go out by itself. */
  const stopped = useRef(false);

  /** This chat works in a folder of its own (not the window's open folder). */
  const ownFolder = meta?.folder && meta.folder !== workspace?.root ? meta.folder : undefined;
  const root = ownFolder ?? workspace?.root;
  useEffect(() => {
    // "@file" suggestions list the window's folder: not offered for a chat working elsewhere.
    if (!root || ownFolder) {
      setFiles([]);
      setRulesFile(null);
      return;
    }
    void api()
      .workspace.listFiles()
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [root, ownFolder]);
  useEffect(() => {
    if (!root) return;
    void api()
      .ai.rulesFile(ownFolder)
      .then(setRulesFile)
      .catch(() => setRulesFile(null));
  }, [root, ownFolder, fsVersion, projectRules]);

  /** Aborts the in-flight request (if any) and stops listening to its events. */
  const cancelCurrent = () => {
    const req = current.current;
    if (!req) return;
    current.current = null;
    req.off();
    void api().ai.abort(req.id);
    setBusy(null);
  };

  const loadConversation = async (cid: string) => {
    let data: Awaited<ReturnType<OmniApi['ai']['conversation']>>;
    try {
      data = await api().ai.conversation(cid);
    } catch (err) {
      toast(String(err instanceof Error ? err.message : err));
      return;
    }
    if (!data) {
      remember(undefined);
      return;
    }
    cancelCurrent();
    setTurns(
      data.messages.map((m): Turn => {
        const d = (m.display ?? {}) as SavedDisplay;
        if (m.role === 'user') return { role: 'user', content: m.content, context: d.context };
        return {
          role: 'assistant',
          content: m.content,
          parts: d.parts?.length ? d.parts : m.content ? [{ kind: 'text', text: m.content }] : [],
          model: d.model ?? m.model ?? undefined,
          meta: d.meta ? metaLine(d.meta) : undefined,
          error: d.error,
          notices: d.notices,
          reasoning: d.reasoning,
        };
      }),
    );
    setConversationId(data.conversation.id);
    updateChat(id, { title: data.conversation.title.slice(0, 60) });
    setChanged([]);
    setShowHistory(false);
    stick.current = true;
  };

  /** Opens a saved conversation without interrupting anything that is running. */
  const openConversation = (cid: string) => {
    const there = getState().chats.find((c) => c.conversationId === cid);
    if (there) {
      selectChat(there.id);
      setShowHistory(false);
      return;
    }
    if (busy) {
      setShowHistory(false);
      newChat({ conversationId: cid });
      return;
    }
    void loadConversation(cid);
  };

  // When the chat opens: its saved conversation (reopened after a restart), or the task it
  // was opened for (a handoff, a prompt from the palette). Once, also under StrictMode.
  const opened = useRef(false);
  const onOpen = useEffectEvent(() => {
    if (opened.current) return;
    opened.current = true;
    const m = chatTab(id);
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
  ) => {
    if (!prompt.trim() || busy) return;
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
    if (!chatTab(id)?.title) updateChat(id, { title: prompt.trim().split('\n')[0]!.slice(0, 60) });
    const turns = base ?? turnsNow.current;
    if (base) setTurns(base);
    const history = turns
      .filter((x) => !x.error)
      .map((x) => ({ role: x.role, content: x.content }))
      .slice(-MAX_HISTORY);
    if (history[0]?.role === 'assistant') history.shift();
    const requestId = newRequestId();
    // Agent mode also works without a folder (system, network, browser and security tools).
    const useAgent = forceAgent || agentMode;
    stick.current = true;
    setTurns((x) => [
      ...x,
      { role: 'user', content: prompt, context: context.map((c) => c.source) },
      { role: 'assistant', content: '', parts: [] },
    ]);
    if (!fromQueue) setInput('');
    setBusy(requestId);

    const update = (fn: (turn: Turn) => Turn) =>
      setTurns((x) => [...x.slice(0, -1), fn(x[x.length - 1]!)]);
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
      off();
      // A newer request (new chat, another conversation) already took over: leave it alone.
      if (current.current?.id !== requestId) return;
      current.current = null;
      setBusy(null);
      void refreshSettings();
      // Only the chat the user is in takes the cursor back (not one finishing in the background).
      const el = document.activeElement;
      if (focusedChat() === id && (!el || el === document.body)) textarea.current?.focus();
    };
    const off = api().on((ev) => {
      if (ev.type !== 'chat' || ev.requestId !== requestId) return;
      // Events of a request that was cancelled or replaced must not touch the current turns.
      if (current.current?.id !== requestId) return;
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
          update((turn) => ({ ...turn, error: e.message }));
          finish();
          break;
        case 'done':
          break;
      }
    });
    current.current = { id: requestId, off };
    try {
      await api().ai.chat(requestId, {
        agent: useAgent,
        // This chat's own model, or (undefined) the one main resolves for the role.
        model: chatModel,
        history,
        prompt,
        context,
        conversationId,
        folder: ownFolder,
      });
    } catch (err) {
      // The request never reached the model (validation, IPC failure): show it and unlock the input.
      if (current.current?.id !== requestId) return;
      update((turn) => ({
        ...turn,
        error: err instanceof Error ? err.message : String(err),
      }));
      finish();
    }
  };

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
    updateChat(id, { queued: rest });
    void send(next, [], false, undefined, true);
  };
  const onFinished = useEffectEvent(() => {
    const byUser = stopped.current;
    stopped.current = false;
    // Stopped by hand or ended in error: the queue waits for the user instead of piling up.
    if (byUser || turnsNow.current.at(-1)?.error) return;
    sendQueued();
  });

  // The tab strip shows what each chat is doing.
  const waiting = Boolean(
    busy && turns.at(-1)?.parts?.some((p) => p.kind === 'tool' && p.status === 'approval'),
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
    const cmd = slashCommands().find((c) => c.name === m[1]!.toLowerCase());
    if (!cmd) return false;
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
      case 'rules':
        void runCommand('ai.rules');
        return true;
      case 'commit':
        if (!root) {
          toast(t('noFolder'));
          return true;
        }
        if (!ownFolder) setState({ sidebar: 'git' });
        void send(t('slashCommitPrompt'), [], true);
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
        .filter((c) => c.name.startsWith(q))
        .map((c) => ({ id: c.name, label: `/${c.name}`, hint: c.hint }));
      return setSuggest(
        items.length ? { kind: 'slash', from: 0, to: caret, items, index: 0 } : null,
      );
    }
    const at = /(^|\s)@([^\s@]*)$/.exec(left);
    if (at && files.length) {
      const q = at[2]!.toLowerCase();
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
      const items = scored.map(({ f }) => ({
        id: f,
        label: f.slice(f.lastIndexOf('/') + 1),
        hint: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '',
      }));
      return setSuggest(
        items.length
          ? { kind: 'file', from: caret - at[2]!.length - 1, to: caret, items, index: 0 }
          : null,
      );
    }
    setSuggest(null);
  };

  const pickSuggest = (s: Suggest, i = s.index) => {
    const item = s.items[i];
    if (!item) return;
    const insert = s.kind === 'slash' ? `/${item.id} ` : `@${item.id} `;
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
    // Still working: the message waits its turn and goes out by itself when this one ends.
    if (busy) {
      if (!input.trim()) return;
      updateChat(id, { queued: [...queued, input] });
      setInput('');
      return;
    }
    void send(input);
  };

  /** Stops the running answer; queued messages wait until the user sends them. */
  const stop = () => {
    if (!busy) return;
    stopped.current = true;
    void api().ai.abort(busy);
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const decide = (toolCallId: string, d: ToolDecision) => {
    if (!busy) return;
    void api().ai.toolDecision(busy, toolCallId, d);
    // The card leaves the approval state right away (a long command or a helper AI may
    // run for minutes); its result updates it again when it arrives.
    setTurns((x) =>
      x.map((turn, i) =>
        i === x.length - 1
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

  const revert = async () => {
    if (!conversationId) return;
    if (!confirm(t('revertConfirm', { n: changed.length }))) return;
    let restored: string[];
    try {
      restored = await api().ai.revert(conversationId, ownFolder);
    } catch (err) {
      toast(String(err instanceof Error ? err.message : err));
      return;
    }
    for (const p of restored) await reloadFromDisk(p);
    setChanged([]);
    toast(t('reverted', { n: restored.length }));
  };

  const noProviders = models.length === 0 && !settings.defaultModel;

  const shownModel =
    chatModel ?? (agentMode ? settings.roles.agent : undefined) ?? settings.defaultModel;

  return (
    <div
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
            <span className="chat-pane-folder" title={ownFolder}>
              <Icon name="folder" size={11} /> {folderName(ownFolder)}
            </span>
          )}
        </div>
      )}
      {showHistory && (
        <ChatHistory
          current={conversationId}
          onOpen={(cid) => openConversation(cid)}
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
              </>
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
                        <Icon name="sparkles" size={13} />
                        {t(k)}
                      </button>
                    ))}
                </div>
                <p>{t('chatTips')}</p>
                <p>
                  Ctrl+L · {t('includeFile')}
                  <br />
                  Ctrl+K · {t('aiEdit')}
                </p>
              </div>
            )}
          </div>
        )}
        {turns.map((turn, i) => {
          const last = i === turns.length - 1;
          return (
            <div key={i} className={`turn ${turn.role}`}>
              {turn.role === 'user' ? (
                <>
                  <div className="turn-user">{turn.content}</div>
                  {!busy && i === lastUserIndex() && (
                    <div className="turn-actions user">
                      <button title={t('chatEdit')} onClick={() => void editLast()}>
                        <Icon name="edit" size={13} /> {t('chatEdit')}
                      </button>
                    </div>
                  )}
                  {turn.context && turn.context.length > 0 && (
                    <div className="turn-context">
                      {turn.context.map((c) => (
                        <span key={c} className="turn-context-item">
                          <Icon
                            name={c.startsWith('terminal:') ? 'terminal' : 'paperclip'}
                            size={11}
                          />
                          {contextLabel(c)}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="turn-model">
                    {(turn.model ?? settings.defaultModel) && (
                      <ProviderLogo
                        id={(turn.model ?? settings.defaultModel ?? '').split('/')[0]!}
                        size={16}
                      />
                    )}
                    {turn.model ?? settings.defaultModel ?? ''}
                  </div>
                  {turn.notices?.map((n, j) => (
                    <div key={j} className="turn-notice">
                      <Icon name="warning" size={13} /> {n}
                    </div>
                  ))}
                  {turn.reasoning && (
                    <details className="turn-reasoning">
                      <summary>
                        <Icon name="brain" size={13} /> {t('thinking')}
                      </summary>
                      {turn.reasoning}
                    </details>
                  )}
                  {(turn.parts ?? []).map((p, j) =>
                    p.kind === 'text' ? (
                      <Markdown
                        key={j}
                        text={p.text}
                        streaming={busy !== null && last && j === (turn.parts?.length ?? 0) - 1}
                      />
                    ) : (
                      <ToolCard key={p.id} step={p} onDecide={(d) => decide(p.id, d)} />
                    ),
                  )}
                  {busy !== null && last && !turn.content && !turn.parts?.length && !turn.error && (
                    <div className="typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                  {turn.error && (
                    <div className="turn-error">
                      <Icon name="warning" size={14} /> {turn.error}
                      {/key|llave|401/i.test(turn.error) && (
                        <button onClick={() => setState({ modal: { kind: 'providers' } })}>
                          {t('providers')}
                        </button>
                      )}
                      {/tool|function/i.test(turn.error) && agentMode && (
                        <button onClick={() => setAgentMode(false)}>{t('agentOff')}</button>
                      )}
                    </div>
                  )}
                  {turn.meta && <div className="turn-meta">{turn.meta}</div>}
                  {!(busy !== null && last) && (turn.content || turn.error) && (
                    <div className="turn-actions">
                      {turn.content && (
                        <button title={t('copy')} onClick={() => copyTurn(turn)}>
                          <Icon name="copy" size={13} /> {t('copy')}
                        </button>
                      )}
                      {turn.content && (
                        <button title={t('chatQuote')} onClick={() => quoteTurn(turn)}>
                          <Icon name="quote" size={13} /> {t('chatQuote')}
                        </button>
                      )}
                      {turn.content && (
                        <button title={t('chatHandoffTitle')} onClick={() => handoff(turn)}>
                          <Icon name="handoff" size={13} /> {t('chatHandoff')}
                        </button>
                      )}
                      {last && (
                        <button title={t('chatRegenerate')} onClick={() => void regenerate()}>
                          <Icon name="refresh" size={13} /> {t('chatRegenerate')}
                        </button>
                      )}
                      {last && turn.content && !turn.error && (
                        <button title={t('chatContinue')} onClick={continueLast}>
                          <Icon name="continue" size={13} /> {t('chatContinue')}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
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
      {changed.length > 0 && !busy && (
        <div className="agent-changes">
          <Icon name="edit" size={14} /> {t('agentChanged', { n: changed.length })}
          <button onClick={() => void revert()}>
            <Icon name="undo" size={13} /> {t('revert')}
          </button>
        </div>
      )}
      <div className="chat-input">
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
        {termMenu && (
          <div className="term-menu" onMouseLeave={() => setTermMenu(null)}>
            <div className="term-menu-title">{t('termPick')}</div>
            {termMenu.length === 0 ? (
              <button
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
                  {suggest.kind === 'file' ? fileIcon(it.id) : null}
                  {it.label}
                </span>
                {it.hint && <span className="chat-suggest-hint">{it.hint}</span>}
              </div>
            ))}
          </div>
        )}
        {queued.length > 0 && (
          <div className="chat-queue" aria-label={t('chatQueued')}>
            <div className="chat-queue-title">
              <Icon name="clock" size={12} />{' '}
              {busy ? t('chatQueuedNext', { n: queued.length }) : t('chatQueuedPaused')}
            </div>
            {queued.map((q, i) => (
              <div key={i} className="chat-queue-item" title={q}>
                <span className="chat-queue-text">{q}</span>
                {!busy && i === 0 && (
                  <button title={t('send')} onClick={sendQueued}>
                    <Icon name="send" size={12} />
                  </button>
                )}
                <button
                  title={t('chatQueueEdit')}
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
                  onClick={() => updateChat(id, { queued: queued.filter((_, j) => j !== i) })}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          value={input}
          rows={3}
          placeholder={agentMode && root ? t('agentPlaceholder') : t('askPlaceholder')}
          onChange={(e) => {
            setInput(e.target.value);
            updateSuggest(e.target.value, e.target.selectionStart);
          }}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          onKeyDown={onInputKey}
        />
        <div className="chat-input-bar">
          <label
            className={`check agent-toggle pill ${agentMode ? 'on' : ''}`}
            title={t('agentTitle')}
          >
            <input
              type="checkbox"
              checked={agentMode}
              onChange={(e) => setAgentMode(e.target.checked)}
            />
            <Icon name="bot" size={14} /> {t('agent')}
          </label>
          <label className={`check pill ${includeFile ? 'on' : ''}`} title={t('includeFile')}>
            <input
              type="checkbox"
              checked={includeFile}
              onChange={(e) => setIncludeFile(e.target.checked)}
            />
            <Icon name="file" size={14} />
            <span className="pill-label">
              {active && active !== BROWSER_TAB ? active.split('/').pop() : t('includeFile')}
            </span>
          </label>
          <button
            className="term-pick"
            title={t('chatAttach')}
            aria-label={t('chatAttach')}
            onClick={attachFile}
          >
            <Icon name="paperclip" size={15} />
          </button>
          {rulesFile && (
            <button
              className="rules-chip"
              title={t('rulesActive', { file: rulesFile })}
              onClick={() => void runCommand('ai.rules')}
            >
              <Icon name="scroll" size={15} />
            </button>
          )}
          <button
            className={`term-pick ${termMenu ? 'on' : ''}`}
            title={t('termPick')}
            aria-label={t('termPick')}
            onClick={() => setTermMenu((m) => (m ? null : listTerminals()))}
          >
            <Icon name="terminal" size={15} />
          </button>
          <button
            className={`model-chip ${chatModel ? 'own' : ''}`}
            onClick={pickModel}
            title={chatModel ? t('chatModelOwn') : t('chatModelFor')}
          >
            {shownModel && <ProviderLogo id={shownModel.split('/')[0]!} size={13} />}
            <span className="model-chip-label">{shownModel ?? t('noModel')}</span>
            <Icon name="chevronDown" size={12} />
          </button>
          {busy && input.trim() && (
            <button
              className="primary send-btn"
              title={t('chatQueueHint')}
              aria-label={t('chatQueue')}
              onClick={() => void submit()}
            >
              <Icon name="clock" size={15} />
            </button>
          )}
          {busy ? (
            <button
              className="danger stop-btn"
              title={t('chatStopHint')}
              onClick={stop}
            >
              <Icon name="stop" size={13} /> {t('stop')}
            </button>
          ) : (
            <button
              className="primary send-btn"
              disabled={!input.trim()}
              title={`${t('send')} (Enter)`}
              aria-label={t('send')}
              onClick={() => void submit()}
            >
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Asks before closing a chat that is still working, then stops and closes it. */
export function requestCloseChat(id: string): void {
  const h = handles.get(id);
  if (h?.busy()) {
    if (!confirm(t('chatCloseBusy'))) return;
    h.abort();
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

/** Every open chat beside the conversation, grouped by the folder it works in. */
function ChatList({ focusedId }: { focusedId: string }) {
  const chats = useStore((s) => s.chats);
  const activeChat = useStore((s) => s.activeChat);
  const split = useStore((s) => s.chatSplit);
  const windowRoot = useStore((s) => s.workspace?.root);
  const groups: { folder: string | undefined; items: { c: ChatTab; n: number }[] }[] = [];
  chats.forEach((c, i) => {
    const folder = chatFolder(c);
    const g = groups.find((x) => x.folder === folder);
    if (g) g.items.push({ c, n: i + 1 });
    else groups.push({ folder, items: [{ c, n: i + 1 }] });
  });
  return (
    <nav className="chat-list" aria-label={t('chatListTitle')}>
      <div className="chat-list-scroll">
        {groups.map((g) => (
          <div key={g.folder ?? ''} className="chat-list-group">
            <div className="chat-list-folder" title={g.folder ?? t('chatNoFolder')}>
              <Icon name="folder" size={12} />
              <span>{g.folder ? folderName(g.folder) : t('chatNoFolder')}</span>
              <button
                title={t('chatNewHere')}
                onClick={() =>
                  newChat({ folder: g.folder && g.folder !== windowRoot ? g.folder : undefined })
                }
              >
                <Icon name="plus" size={12} />
              </button>
            </div>
            {g.items.map(({ c, n }) => {
              const label = c.title || t('chatTabN', { n });
              const status = chatStatusText(c);
              const shown = c.id === activeChat || c.id === split;
              return (
                <div
                  key={c.id}
                  className={`chat-list-item ${shown ? 'on' : ''} ${c.id === focusedId ? 'focus' : ''} ${c.waiting ? 'waiting' : ''}`}
                  title={status ? `${label} · ${status}` : label}
                  onClick={() => selectChat(c.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1) requestCloseChat(c.id);
                  }}
                >
                  <ChatStatus c={c} />
                  <span className="chat-tab-label">{label}</span>
                  {chats.length > 1 && (
                    <button
                      className="chat-tab-x"
                      aria-label={t('chatCloseTab')}
                      title={t('chatCloseTab')}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestCloseChat(c.id);
                      }}
                    >
                      <Icon name="x" size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
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

  // Keep the focused tab in view when there are many.
  useEffect(() => {
    strip.current
      ?.querySelector('.chat-tab.focus')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusedId, chats.length]);

  return (
    <div className="chat chat-multi">
      <div className="panel-header chat-tabs-bar">
        <div className="chat-tabs" role="tablist" ref={strip}>
          {chats.map((c, i) => {
            const shown = c.id === activeChat || c.id === split;
            const label = c.title || t('chatTabN', { n: i + 1 });
            const status = chatStatusText(c);
            return (
              <div
                key={c.id}
                role="tab"
                aria-selected={shown}
                className={`chat-tab ${shown ? 'on' : ''} ${c.id === focusedId ? 'focus' : ''} ${c.waiting ? 'waiting' : ''}`}
                title={[label, c.folder && folderName(c.folder), status]
                  .filter(Boolean)
                  .join(' · ')}
                onClick={() => selectChat(c.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) requestCloseChat(c.id);
                }}
              >
                <ChatStatus c={c} />
                <span className="chat-tab-label">{label}</span>
                {chats.length > 1 && (
                  <button
                    className="chat-tab-x"
                    aria-label={t('chatCloseTab')}
                    title={t('chatCloseTab')}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestCloseChat(c.id);
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
          <button title={t('chatListToggle')} className={list ? 'on' : ''} onClick={toggleChatList}>
            <Icon name="menu" size={15} />
          </button>
          <button title={`${t('chatNewTab')} (Ctrl+Alt+N)`} onClick={() => newChat()}>
            <Icon name="plus" size={15} />
          </button>
          <button title={t('chatNewInFolder')} onClick={() => void newChatInFolder()}>
            <Icon name="folderPlus" size={15} />
          </button>
          <button
            title={split ? t('chatUnsplit') : `${t('chatSplit')} (Ctrl+Alt+D)`}
            className={split ? 'on' : ''}
            onClick={toggleChatSplit}
          >
            <Icon name="columns" size={15} />
          </button>
          <button
            title={t('histTitle')}
            className={historyFor === focusedId ? 'on' : ''}
            onClick={() =>
              setState({ chatHistoryFor: historyFor === focusedId ? null : focusedId })
            }
          >
            <Icon name="history" size={15} />
          </button>
          <button title={t('close')} onClick={() => setState({ chatOpen: false })}>
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
