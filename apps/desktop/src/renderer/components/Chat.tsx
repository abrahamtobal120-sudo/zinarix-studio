import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  ActiveRulesView,
  AgentKitView,
  ChatContext,
  ChatEventView,
  OmniApi,
  ToolDecision,
} from '../../shared/api';
import { AgentKitMenu, type KitKind } from './AgentKitMenu';
import { NEW_TASK_EVENT, TasksPanel, taskBadge, useTasks, type NewTaskSeed } from './TasksPanel';
import { confirmDialog } from '../confirm';
import { errText } from '../errText';
import { lang, t } from '../i18n';
import { TURN_PAGE, hiddenTurns, showEarlier } from '../virtualList';
import {
  api,
  chatTab,
  focusedChat,
  getState,
  isChatVisible,
  newChat,
  newChatInFolder,
  newParallelChat,
  newQuestionChat,
  newRequestId,
  openFile,
  reloadFromDisk,
  refreshSettings,
  saveChatMode,
  selectChat,
  setState,
  toast,
  toggleChatList,
  toggleChatSplit,
  updateChat,
  useStore,
} from '../store';
import { runCommand } from '../commands';
import { Icon } from './Icon';
import { useOnline } from './OfflineGames';
import { openStudio } from './video/videoStore';
import { ProviderLogo } from './ProviderLogo';
import { ChatHistory } from './ChatHistory';
import { SendButton, useDismiss } from './ChatSendMenu';
import { DiffReview, RewindDialog, type RewindMode } from './DiffReview';
import { latestTodos, ModeMenu, modeHint, modeLabel, PlanEditor, TaskList } from './AgentPlan';
import type { ChatMode } from '../../shared/agentModes';
import { queueRetryDelay } from '../../shared/chatQueue';
import {
  modeFrom,
  nextMode,
  planApprovedPrompt,
  planStates,
  usesAgent,
} from '../../shared/agentModes';
import { listTerminals, sendTerminalToChat, type TerminalSession } from './Terminal';
import './chat-composer.css';
import { ChatList, ChatStatus, chatStatusText, folderName } from './chat/ChatList';
import { CompactCard, TurnView } from './chat/TurnView';
import { closeChatFromTab, handles, requestCloseChat, type ChatHandle } from './chat/handles';
import { EDIT_TOOLS, stepsOf, type Turn, type TurnActions } from './chat/types';

import {
  IMAGE_MIME,
  MAX_CHAT_IMAGES,
  MAX_HISTORY,
  MAX_IMAGE_BYTES,
  compactable,
  compactedHistory,
  loadReasoning,
  mentionedFiles,
  metaLine,
  newTurnId,
  pairTurns,
  readImage,
  remember,
  shortcutOf,
  type PendingImage,
  type ReasoningLevel,
  type SavedDisplay,
  type Suggest,
} from './chat/helpers';
import { phoneTurns, pushToPhone } from './chat/phone';
import {
  AddMenu,
  ChatEmpty,
  PendingAttachments,
  PendingImages,
  QueuePanel,
  ReasoningSelect,
  RulesMenu,
  SuggestList,
} from './chat/Composer';
import { currentFileContext, mentionContext, suggestFor } from './chat/context';
import { applyUpdates, batcher, chatHistory, eventUpdate } from './chat/stream';
import { runSlashCommand } from './chat/slash';

export { closeChatFromTab, focusedChatTab } from './chat/handles';
export { askAgent, askInChat, runPhoneAction, setPhoneTarget } from './chat/phone';
import { PhasesPanel, PhasesPicker, usePhases } from './PhasesPanel';
import { isAnalyzePrompt } from '../../shared/phases';

const NO_KIT_COMMANDS: AgentKitView['commands'] = [];
const NO_KIT_SKILLS: AgentKitView['skills'] = [];

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
  const chatBot = useStore((s) =>
    meta?.bot ? s.automations?.bots.find((b) => b.id === meta.bot) : undefined,
  );
  const focusedPane = useStore((s) => s.chatFocus);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsNow = useRef(turns);
  turnsNow.current = turns;
  const [input, setInput] = useState('');
  /** "Mejorar prompt": working, and the text the user had before (to go back to it). */
  const [improving, setImproving] = useState(false);
  const [beforeImprove, setBeforeImprove] = useState<string | null>(null);
  /** "Compactar chat": the summary is being written; the compacted messages are shown. */
  const [compacting, setCompacting] = useState(false);
  const [showCompacted, setShowCompacted] = useState(false);
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
    setHiddenState(Math.max(0, loaded.length - TURN_PAGE));
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
  // Long conversations (C5): only the last turns are mounted; older ones come back as the
  // reader scrolls up. `hidden` counts the turns left out at the start.
  const [hiddenState, setHiddenState] = useState(0);
  const hidden = hiddenTurns(hiddenState, turns.length, atBottom);
  if (hidden !== hiddenState) setHiddenState(hidden);
  // Distance to the end of the chat when older turns were asked for: kept after they mount, so
  // the text being read does not move.
  const growFrom = useRef<number | null>(null);
  const earlier = (): void => {
    const el = scroller.current;
    if (!el || hidden === 0 || growFrom.current !== null) return;
    growFrom.current = el.scrollHeight - el.scrollTop;
    stick.current = false;
    setAtBottom(false);
    setHiddenState(showEarlier(hidden));
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || growFrom.current === null) return;
    el.scrollTop = el.scrollHeight - growFrom.current;
    growFrom.current = null;
  }, [hidden]);
  // The input grows with its content (up to ~12 lines) instead of scrolling inside 3 rows.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const fit = (): void => {
      el.style.height = 'auto';
      // Measured while the chat is hidden (panel closed, another tab) scrollHeight is 0: keep
      // the natural 3 rows instead of collapsing the box until the next keystroke.
      const h = el.scrollHeight;
      if (h > 0) el.style.height = `${Math.min(h, 260)}px`;
    };
    fit();
    // The chat moves between the center and the side panel: fit again when its width changes.
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
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
    const mentions = await mentionContext(prompt, files);
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
    const history = chatHistory(
      turns,
      (rid) => runs.current.has(rid),
      compactedHistory,
      MAX_HISTORY,
    );
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

    // Each request writes into its own answer (others may be streaming below it); the changes
    // of one frame go in as a single render.
    const { push: update, flush } = batcher((fns) => {
      // Cancelled meanwhile (stop, another conversation): its leftovers are dropped.
      if (!runs.current.has(requestId)) return;
      setTurns((x) => applyUpdates(x, requestId, fns));
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
      const change = eventUpdate(e, metaLine);
      if (change) update(change);
      switch (e.type) {
        case 'conversation':
          setConversationId(e.id);
          break;
        case 'start':
          if (e.conversationId) setConversationId(e.conversationId);
          break;
        case 'file_changed':
          void reloadFromDisk(e.path);
          if (e.open) void openFile(e.path).catch(() => undefined);
          setChanged((c) => (c.includes(e.path) ? c : [...c, e.path]));
          break;
        case 'cost':
          finish();
          break;
        case 'error':
          failCodes.current.set(requestId, e.code);
          finish();
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
    for (let i = turns.length - 1; i >= 0; i--) {
      const x = turns[i]!;
      // Compacted messages are no longer the exchange to edit or regenerate.
      if (x.summary) return -1;
      if (x.role === 'user' && !x.compacted) return i;
    }
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
  const runSlash = (text: string): Promise<boolean> =>
    runSlashCommand(text, {
      commands: kitCommands,
      skills: kitSkills,
      files,
      busy: busy !== null,
      root,
      ownFolder,
      clearInput: () => {
        setInput('');
        setSuggest(null);
      },
      send: (prompt, agent) => void send(prompt, [], agent),
      resetChat,
      setAgentMode,
      setChatMode,
      openPhases: (path) => void phases.open(path),
      pickPhases: () => phases.setPicker(true),
      compact: () => void compactChat(),
    });

  /** Opens the "/" or "@" menu for the text left of the caret. */
  const updateSuggest = (value: string, caret: number) =>
    setSuggest(
      suggestFor(value, caret, {
        commands: kitCommands,
        skills: kitSkills,
        files,
        docNames: docNamesRef.current,
        loadDocs: () => void loadDocNames(),
      }),
    );

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

  /**
   * "Compactar chat": another request (answers in progress go on) writes one summary of the
   * conversation without repetitions; it replaces those messages as what the AI reads from
   * now on. The exchanges still running are left out and stay as they are.
   */
  const compactChat = async () => {
    if (compacting) return;
    const take = compactable(turnsNow.current, runs.current);
    if (take.filter((x) => !x.summary).length < 2) {
      toast(t('chatCompactNothing'));
      return;
    }
    setCompacting(true);
    try {
      const model = chatModel ?? (agentMode ? settings.roles.agent : undefined);
      const messages = take.flatMap((x) =>
        x.summary ? compactedHistory(x.content) : [{ role: x.role, content: x.content }],
      );
      const summary = await api().ai.compactChat(messages, model ?? undefined);
      const ids = new Set(take.map((x) => x.id));
      const count = take.reduce((n, x) => n + (x.summary ? (x.summaryOf ?? 0) : 1), 0);
      // Another conversation was opened meanwhile: nothing of it to compact.
      if (!turnsNow.current.some((x) => ids.has(x.id))) return;
      setTurns((cur) => {
        let at = -1;
        const next = cur.map((x, i) => {
          if (!ids.has(x.id)) return x;
          at = i;
          return { ...x, compacted: true };
        });
        if (at < 0) return cur;
        next.splice(at + 1, 0, {
          id: newTurnId(),
          role: 'assistant',
          content: summary,
          summary: true,
          summaryOf: count,
        });
        return next;
      });
      setShowCompacted(false);
      // Agent mode keeps its own transcript: dropped now, or when the answer in progress ends.
      const cid = conversationNow.current;
      if (cid) await api().ai.resetContext(cid, true);
      toast(t('chatCompactDone', { n: count }));
    } catch (err) {
      toast(errText(err));
    } finally {
      setCompacting(false);
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
          if (hidden > 0 && el.scrollTop < 400) earlier();
        }}
      >
        {hidden > 0 && (
          <button className="link chat-earlier" onClick={earlier}>
            {t('chatShowEarlier', { n: hidden })}
          </button>
        )}
        {turns.length === 0 && (
          <ChatEmpty
            noProviders={noProviders}
            online={online}
            bot={chatBot}
            agentMode={agentMode}
          />
        )}
        {turns.map((turn, i) =>
          turn.summary && i >= hidden ? (
            <CompactCard
              key={turn.id}
              turn={turn}
              shown={showCompacted}
              onToggle={() => setShowCompacted((v) => !v)}
            />
          ) : i < hidden || (turn.compacted && !showCompacted) ? null : (
            <TurnView
              key={turn.id}
              turn={turn}
              // This answer is still streaming.
              live={turn.role === 'assistant' && Boolean(turn.rid && running.includes(turn.rid))}
              // Last exchange with nothing running: regenerate / continue apply to it.
              last={i === turns.length - 1 && !busy && !turn.compacted}
              canEdit={!busy && i === lastUser}
              // Compacted messages are only for reading (no rewind / review on them).
              idle={!busy && !turn.compacted}
              planState={plans[i]}
              defaultModel={settings.defaultModel}
              agentMode={agentMode}
              actions={turnActions}
            />
          ),
        )}
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
        <PendingImages
          images={images}
          onRemove={(k) => setImages((cur) => cur.filter((_, j) => j !== k))}
        />
        <PendingAttachments attachments={attachments} />
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
          <RulesMenu
            view={rulesView}
            menuRef={rulesMenuEl}
            readOnly={Boolean(ownFolder)}
            onOpen={(path) => {
              setRulesMenu(false);
              void openFile(path);
            }}
            onMention={(name) => {
              setRulesMenu(false);
              setInput((v) => `${v}${v && !/\s$/.test(v) ? ' ' : ''}@${name} `);
              textarea.current?.focus();
            }}
            onEdit={() => {
              setRulesMenu(false);
              void runCommand('ai.rules');
            }}
            onInit={() => {
              setRulesMenu(false);
              void runSlash('/init');
            }}
          />
        )}
        {termMenu && (
          <AddMenu
            menuRef={termMenuEl}
            terminals={termMenu}
            reasoning={reasoning}
            agentMode={agentMode}
            computerOn={computerOn}
            includeFile={includeFile}
            tasks={tasksNow}
            showTasks={Boolean(root) || tasksNow.active > 0}
            kit={kit}
            showKit={
              !noFolder || kitCommands.length + kitSkills.length + (kit?.agents.length ?? 0) > 0
            }
            rules={rulesView}
            onClose={() => setTermMenu(null)}
            onAttachFile={attachFile}
            onPhases={() => phases.setPicker(true)}
            onAttachImage={() => imagePicker.current?.click()}
            onStudio={() => void openStudio()}
            onReasoning={setReasoning}
            onToggleComputer={() => void toggleComputer()}
            onToggleIncludeFile={() => setIncludeFile(!includeFile)}
            onTasks={() => setTasksOpen(true)}
            onKit={() => setKitMenu(true)}
            onRules={() => setRulesMenu(true)}
            onOpenTerminal={() => setState({ panelOpen: true })}
            onTerminal={(tid, what) => {
              sendTerminalToChat(tid, what);
              textarea.current?.focus();
            }}
          />
        )}
        {suggest && <SuggestList suggest={suggest} onPick={(i) => pickSuggest(suggest, i)} />}
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
        <QueuePanel
          queued={queued}
          retry={retry}
          busy={Boolean(busy)}
          onCancelRetry={cancelRetry}
          onSend={sendQueued}
          onEdit={(i) => {
            updateChat(id, { queued: queued.filter((_, j) => j !== i) });
            setInput((cur) => (cur.trim() ? `${cur}\n${queued[i]}` : queued[i]!));
            textarea.current?.focus();
          }}
          onRemove={(i) => updateChat(id, { queued: queued.filter((_, j) => j !== i) })}
        />
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
              <ReasoningSelect value={reasoning} onChange={setReasoning} />
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
          {(compacting || compactable(turns, runs.current).length >= 2) && (
            <button
              className={`rules-chip compact-btn ${compacting ? 'on' : ''}`}
              title={compacting ? t('chatCompacting') : t('chatCompact')}
              aria-label={t('chatCompact')}
              aria-busy={compacting}
              disabled={compacting}
              onClick={() => void compactChat()}
            >
              {compacting ? <span className="chat-tab-spin" /> : <Icon name="minimize" size={15} />}
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
              {improving ? <span className="chat-tab-spin" /> : <Icon name="edit" size={15} />}
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
