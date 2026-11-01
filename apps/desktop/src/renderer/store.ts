import { useSyncExternalStore } from 'react';
import type { ModelInfo } from '@omni/shared';
import type {
  AiRole,
  ChatContext,
  OmniApi,
  Prefs,
  Settings,
  ThemeId,
  WorkspaceInfo,
} from '../shared/api';
import { DEFAULT_PREFS } from '../shared/api';
import type { LicenseStatus, ProFeature, RemoteNotice } from '../shared/plans';
import { BUY_URL, FREE_FEATURES, PRO_FEATURES } from '../shared/plans';
import { languageFor, monaco } from './monaco';
import { t } from './i18n';
import { applyThemeColors, isDark } from './themes';

declare global {
  interface Window {
    omni: OmniApi;
  }
}
export const api = (): OmniApi => window.omni;

export interface Tab {
  path: string;
  name: string;
  dirty: boolean;
  /** Non-text file: shown as a message instead of an editor. */
  notice?: string;
}

export type Modal =
  | { kind: 'palette' }
  | { kind: 'quickOpen' }
  | {
      kind: 'models';
      role?: AiRole;
      /** Picking for one chat (or a handoff) instead of changing the app-wide model. */
      pick?: { title: string; current: string | null; onPick: (ref: string | null) => void };
    }
  | { kind: 'providers'; focus?: string }
  | { kind: 'aiEdit' }
  | { kind: 'shortcuts' }
  | { kind: 'usage' }
  | { kind: 'security' }
  | { kind: 'scanner' }
  | { kind: 'settings' }
  | { kind: 'diff'; path: string; staged: boolean }
  | { kind: 'commit'; hash: string; subject: string }
  | { kind: 'clone' }
  | { kind: 'publish' }
  /** Plan and license (activate a key, see the trial). */
  | { kind: 'license' }
  /** A Pro feature was used on the free plan. */
  | { kind: 'upgrade'; feature: ProFeature }
  /** First launch: a short guided setup. */
  | { kind: 'welcome' }
  /** First launch of a new version: what changed. */
  | { kind: 'whatsNew' };

export interface State {
  workspace: WorkspaceInfo | null;
  tabs: Tab[];
  active: string | null;
  sidebar: 'explorer' | 'search' | 'git' | 'run' | 'vercel' | 'supabase' | null;
  panelOpen: boolean;
  chatOpen: boolean;
  modal: Modal | null;
  settings: Settings;
  models: ModelInfo[];
  modelErrors: { provider: string; error: string }[];
  cursor: { line: number; column: number };
  toast: string | null;
  fsVersion: number;
  inputBox: { label: string; value: string; resolve: (v: string | null) => void } | null;
  /** Context attached to the next chat message (e.g. a terminal session or selection). */
  chatAttachments: ChatContext[];
  prefs: Prefs;
  /** Number of changed files in the git repository (activity bar badge). */
  gitChanges: number;
  /** Open chats (tabs of the chat panel); each one runs on its own, in parallel. */
  chats: ChatTab[];
  /** Chat shown in the (left) pane. */
  activeChat: string;
  /** Second chat shown side by side, or null. */
  chatSplit: string | null;
  /** Pane that receives a tab picked in the strip (0 left, 1 right). */
  chatFocus: 0 | 1;
  /** Chat whose history list is open. */
  chatHistoryFor: string | null;
  /** List of the open chats beside the conversation (grouped by folder). */
  chatList: boolean;
  /** Plan of this installation (until main answers, everything is allowed). */
  license: LicenseStatus;
  /** A new version (downloaded in the background, or to download). */
  update: { state: 'available' | 'ready'; version: string; url?: string } | null;
  /** A message from the app's owner (shown once). */
  notice: RemoteNotice | null;
}

/** One chat of the panel. Its turns live in its own component; this is what the tabs show. */
export interface ChatTab {
  id: string;
  title: string;
  /** Saved conversation it continues (reopened on the next start). */
  conversationId?: string;
  /** Model of this chat ("provider/model"); null = the app default for the mode. */
  model: string | null;
  agent: boolean;
  /** Folder this chat works in (absolute); undefined = the window's open folder. */
  folder?: string;
  busy: boolean;
  /** An action of the AI waits for the user's approval. */
  waiting: boolean;
  /** Finished while the user was looking at another chat. */
  unread: boolean;
  /** Messages waiting for the current answer to end; each one is sent by itself in turn. */
  queued: string[];
  /** Sent (or put in the box) once the chat opens: a handoff or a task from elsewhere. */
  initial?: { prompt: string; context?: ChatContext[]; send: boolean };
}

let state: State = {
  workspace: null,
  tabs: [],
  active: null,
  sidebar: 'explorer',
  panelOpen: false,
  chatOpen: true,
  modal: null,
  settings: {
    defaultModel: null,
    roles: {},
    localOnly: false,
    theme: 'dark',
    todayUsd: 0,
    version: '',
    intro: false,
  },
  models: [],
  modelErrors: [],
  cursor: { line: 1, column: 1 },
  toast: null,
  fsVersion: 0,
  inputBox: null,
  chatAttachments: [],
  prefs: DEFAULT_PREFS,
  gitChanges: 0,
  // Filled from the last session at the end of this module (see restoreChats).
  chats: [],
  activeChat: '',
  chatSplit: null,
  chatFocus: 0,
  chatHistoryFor: null,
  chatList: false,
  license: {
    plan: 'open',
    features: PRO_FEATURES,
    billing: false,
    buyUrl: BUY_URL,
    free: FREE_FEATURES,
  },
  update: null,
  notice: null,
};

const listeners = new Set<() => void>();
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const l of listeners) l();
}
export function getState(): State {
  return state;
}
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string): void {
  setState({ toast: message });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3500);
}

/** Promise-based text input (Electron does not implement window.prompt). */
export function askText(label: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => setState({ inputBox: { label, value, resolve } }));
}

// ---------------- open documents (Monaco models) ----------------

interface Doc {
  model: monaco.editor.ITextModel;
  savedVersion: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
}
const docs = new Map<string, Doc>();
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

export function attachEditor(e: monaco.editor.IStandaloneCodeEditor | null): void {
  editor = e;
}
export function getEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return editor;
}
export function getDoc(path: string): Doc | undefined {
  return docs.get(path);
}

function updateDirty(path: string): void {
  const d = docs.get(path);
  if (!d) return;
  const dirty = d.model.getAlternativeVersionId() !== d.savedVersion;
  setState((s) => ({
    tabs: s.tabs.map((tab) => (tab.path === path && tab.dirty !== dirty ? { ...tab, dirty } : tab)),
  }));
}

export async function openFile(
  path: string,
  position?: { line: number; column: number },
): Promise<void> {
  const name = path.split('/').pop() ?? path;
  if (!docs.has(path) && !state.tabs.some((tab) => tab.path === path)) {
    const file = await api().workspace.readFile(path);
    if (file.binary || file.tooLarge) {
      setState((s) => ({
        tabs: [
          ...s.tabs,
          { path, name, dirty: false, notice: t(file.binary ? 'binary' : 'tooLarge') },
        ],
        active: path,
      }));
      return;
    }
    const uri = monaco.Uri.from({ scheme: 'file', path: `/${path}` });
    const model =
      monaco.editor.getModel(uri) ??
      monaco.editor.createModel(file.content, languageFor(path), uri);
    docs.set(path, { model, savedVersion: model.getAlternativeVersionId(), viewState: null });
    let autoSave: ReturnType<typeof setTimeout> | undefined;
    model.onDidChangeContent(() => {
      updateDirty(path);
      if (!state.prefs.autoSave) return;
      clearTimeout(autoSave);
      autoSave = setTimeout(() => {
        if (docs.get(path)?.model === model && state.tabs.some((x) => x.path === path && x.dirty))
          void save(path, false);
      }, 1000);
    });
    setState((s) => ({ tabs: [...s.tabs, { path, name, dirty: false }] }));
  }
  activate(path);
  if (position && editor) {
    requestAnimationFrame(() => {
      editor?.setPosition({ lineNumber: position.line, column: position.column });
      editor?.revealLineInCenter(position.line);
      editor?.focus();
    });
  }
}

/** Pseudo-path of the built-in browser tab (never a real file: real paths have no "::"). */
export const BROWSER_TAB = '::browser';

/** Pseudo-path of the full-page security section. */
export const SECURITY_TAB = '::security';

export function openSecurityTab(): void {
  if (!state.tabs.some((x) => x.path === SECURITY_TAB))
    setState((s) => ({
      tabs: [...s.tabs, { path: SECURITY_TAB, name: t('secTab'), dirty: false }],
    }));
  activate(SECURITY_TAB);
}

export function openBrowserTab(): void {
  if (!state.tabs.some((x) => x.path === BROWSER_TAB))
    setState((s) => ({
      tabs: [...s.tabs, { path: BROWSER_TAB, name: t('browser'), dirty: false }],
    }));
  activate(BROWSER_TAB);
}

export function activate(path: string | null): void {
  const prev = state.active && docs.get(state.active);
  if (prev && editor) prev.viewState = editor.saveViewState();
  setState({ active: path });
}

export async function save(path = state.active, format = true): Promise<void> {
  if (!path) return;
  const d = docs.get(path);
  if (!d) return;
  // Format on save works on the visible editor (Monaco formatters need a view).
  if (format && state.prefs.formatOnSave && editor?.getModel() === d.model) {
    await editor
      .getAction('editor.action.formatDocument')
      ?.run()
      .catch(() => undefined);
  }
  await api().workspace.writeFile(path, d.model.getValue());
  d.savedVersion = d.model.getAlternativeVersionId();
  updateDirty(path);
}

export async function saveAll(): Promise<void> {
  for (const tab of state.tabs) if (tab.dirty) await save(tab.path);
}

export function closeTab(path = state.active): void {
  if (!path) return;
  const tab = state.tabs.find((x) => x.path === path);
  if (tab?.dirty && !confirm(t('unsavedClose', { name: tab.name }))) return;
  const d = docs.get(path);
  d?.model.dispose();
  docs.delete(path);
  const idx = state.tabs.findIndex((x) => x.path === path);
  const tabs = state.tabs.filter((x) => x.path !== path);
  const next =
    state.active === path ? (tabs[Math.min(idx, tabs.length - 1)]?.path ?? null) : state.active;
  setState({ tabs });
  activate(next);
}

/** Keeps open tabs pointing at the right files after a rename in the explorer. */
export function renamePath(from: string, to: string): void {
  const moved = state.tabs.filter((x) => x.path === from || x.path.startsWith(`${from}/`));
  for (const tab of moved) {
    const d = docs.get(tab.path);
    if (d) {
      d.model.dispose();
      docs.delete(tab.path);
    }
  }
  setState((s) => ({ tabs: s.tabs.filter((x) => !moved.includes(x)) }));
  if (moved.length) void openFile(moved[0]!.path.replace(from, to));
}

/** Re-reads a file changed outside the editor (e.g. by the agent) into its open tab. */
export async function reloadFromDisk(path: string): Promise<void> {
  const d = docs.get(path);
  if (!d) return;
  const tab = state.tabs.find((x) => x.path === path);
  if (tab?.dirty) {
    toast(t('diskChangedDirty', { name: tab.name }));
    return;
  }
  try {
    const file = await api().workspace.readFile(path);
    if (file.binary || file.tooLarge || file.content === d.model.getValue()) return;
    d.model.pushEditOperations(
      [],
      [{ range: d.model.getFullModelRange(), text: file.content }],
      () => null,
    );
    d.savedVersion = d.model.getAlternativeVersionId();
    updateDirty(path);
  } catch {
    // file deleted: leave the tab as is
  }
}

/** Closes every tab without prompting (used when the workspace changes). */
export function resetDocs(): void {
  for (const d of docs.values()) d.model.dispose();
  docs.clear();
  setState((s) => {
    const tabs = s.tabs.filter((x) => x.path === BROWSER_TAB || x.path === SECURITY_TAB);
    return { tabs, active: tabs[0]?.path ?? null };
  });
}

/** Opens a folder or file dropped onto the window. */
export async function openDropped(path: string): Promise<void> {
  const r = await api().workspace.openPath(path);
  if (!r) return toast(t('dropInvalid'));
  // Switch workspace state here so the 'workspace' event cannot close the file we open next.
  if (state.workspace?.root !== r.workspace.root) resetDocs();
  setState({ workspace: r.workspace });
  if (r.file) await openFile(r.file);
}

export function dirtyCount(): number {
  return state.tabs.filter((x) => x.dirty).length;
}

// ---------------- AI settings / models ----------------

export async function refreshSettings(): Promise<void> {
  setState({ settings: await api().ai.settings() });
}

export async function refreshModels(refresh = false): Promise<void> {
  const r = await api().ai.models(refresh);
  setState({ models: r.models, modelErrors: r.errors });
  if (r.detected.length) toast(`🏠 Detectado y conectado: ${r.detected.join(', ')}`);
}

export async function chooseModel(ref: string): Promise<void> {
  await api().ai.setDefaultModel(ref);
  await refreshSettings();
}

export function applyTheme(theme: ThemeId): void {
  applyThemeColors(theme);
}

export async function setTheme(theme: ThemeId): Promise<void> {
  await api().ai.setTheme(theme);
  applyTheme(theme);
  setState((s) => ({ settings: { ...s.settings, theme } }));
}

export async function toggleTheme(): Promise<void> {
  await setTheme(isDark(state.settings.theme) ? 'light' : 'dark');
}

// ---------------- preferences ----------------

export async function loadPrefs(): Promise<void> {
  setState({ prefs: await api().app.prefs() });
}

export async function updatePrefs(patch: Partial<Prefs>): Promise<void> {
  setState((s) => ({ prefs: { ...s.prefs, ...patch } }));
  setState({ prefs: await api().app.setPrefs(patch) });
}

/** Refreshes the git badge (changed files) of the activity bar. */
export async function refreshGitBadge(): Promise<void> {
  if (!state.workspace) return setState({ gitChanges: 0 });
  try {
    const st = await api().git.status();
    setState({ gitChanges: st.files.length });
  } catch {
    setState({ gitChanges: 0 });
  }
}

/** Attaches context to the next chat message (replaces an attachment with the same source). */
export function attachToChat(ctx: ChatContext): void {
  setState((s) => ({
    chatOpen: true,
    chatAttachments: [...s.chatAttachments.filter((c) => c.source !== ctx.source), ctx],
  }));
}

let seq = 0;
export const newRequestId = (): string =>
  `r${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------- chats (tabs of the chat panel) ----------------

const CHATS_KEY = 'zs.chats';
const LIST_KEY = 'zs.chatList';
const LAST_KEY = 'zs.lastConversation';
const AGENT_KEY = 'zs.agentMode';

function savedAgentMode(): boolean {
  try {
    return localStorage.getItem(AGENT_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAgentMode(on: boolean): void {
  try {
    localStorage.setItem(AGENT_KEY, on ? 'on' : 'off');
  } catch {
    // storage unavailable: the mode just resets to agent on the next start
  }
}

function savedChatList(): boolean {
  try {
    return localStorage.getItem(LIST_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Shows or hides the list of open chats beside the conversation. */
export function toggleChatList(): void {
  const on = !state.chatList;
  setState({ chatList: on, chatOpen: true });
  try {
    localStorage.setItem(LIST_KEY, on ? 'on' : 'off');
  } catch {
    // storage unavailable: the list just starts hidden next time
  }
}

/** Folder a chat works in: its own, or the window's open folder. */
export function chatFolder(c: Pick<ChatTab, 'folder'> | undefined): string | undefined {
  return c?.folder ?? state.workspace?.root;
}

const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function blankChat(patch: Partial<ChatTab> = {}): ChatTab {
  return {
    id: newChatId(),
    title: '',
    model: null,
    agent: savedAgentMode(),
    busy: false,
    waiting: false,
    unread: false,
    queued: [],
    ...patch,
  };
}

/**
 * The first window of a session keeps its open chats across restarts; windows opened later
 * start with one empty chat (otherwise they would show the same conversations twice).
 */
const primaryWindow = new URLSearchParams(location.search).has('restore');

/** Open chats from the last session (or the last conversation of older versions). */
function restoreChats(): Pick<State, 'chats' | 'activeChat' | 'chatSplit' | 'chatFocus'> {
  if (!primaryWindow) {
    const first = blankChat();
    return { chats: [first], activeChat: first.id, chatSplit: null, chatFocus: 0 };
  }
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) {
      const v = JSON.parse(raw) as {
        tabs?: Partial<ChatTab>[];
        active?: string;
        split?: string | null;
      };
      const chats = (v.tabs ?? [])
        .filter((x) => typeof x.id === 'string')
        .slice(0, 12)
        .map((x) =>
          blankChat({
            id: x.id,
            title: String(x.title ?? ''),
            conversationId: typeof x.conversationId === 'string' ? x.conversationId : undefined,
            model: typeof x.model === 'string' ? x.model : null,
            agent: typeof x.agent === 'boolean' ? x.agent : savedAgentMode(),
            folder: typeof x.folder === 'string' && x.folder ? x.folder : undefined,
          }),
        );
      if (chats.length) {
        const has = (id?: string | null) => Boolean(id && chats.some((c) => c.id === id));
        const active = has(v.active) ? v.active! : chats[0]!.id;
        const split = has(v.split) && v.split !== active ? v.split! : null;
        return { chats, activeChat: active, chatSplit: split, chatFocus: 0 };
      }
    }
  } catch {
    // unreadable: start with one empty chat
  }
  let last: string | undefined;
  try {
    last = localStorage.getItem(LAST_KEY) ?? undefined;
  } catch {
    last = undefined;
  }
  const first = blankChat({ conversationId: last });
  return { chats: [first], activeChat: first.id, chatSplit: null, chatFocus: 0 };
}

function persistChats(): void {
  if (!primaryWindow) return;
  try {
    localStorage.setItem(
      CHATS_KEY,
      JSON.stringify({
        tabs: state.chats.map((c) => ({
          id: c.id,
          title: c.title,
          conversationId: c.conversationId,
          model: c.model,
          agent: c.agent,
          folder: c.folder,
        })),
        active: state.activeChat,
        split: state.chatSplit,
      }),
    );
  } catch {
    // storage unavailable: chats are still saved in the history
  }
}

export function chatTab(id: string): ChatTab | undefined {
  return state.chats.find((c) => c.id === id);
}

export function updateChat(id: string, patch: Partial<ChatTab>): void {
  const cur = chatTab(id);
  if (!cur) return;
  const changed = (Object.keys(patch) as (keyof ChatTab)[]).some((k) => cur[k] !== patch[k]);
  if (!changed) return;
  setState((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  if (
    'title' in patch ||
    'conversationId' in patch ||
    'model' in patch ||
    'agent' in patch ||
    'folder' in patch
  )
    persistChats();
}

/** The chat that receives prompts sent from elsewhere (menus, security center…). */
export function focusedChat(): string {
  return state.chatFocus === 1 && state.chatSplit ? state.chatSplit : state.activeChat;
}

export function isChatVisible(id: string): boolean {
  return id === state.activeChat || id === state.chatSplit;
}

/** Shows a chat: in the pane that has the focus, or where it already is. */
export function selectChat(id: string): void {
  if (!chatTab(id)) return;
  if (id === state.activeChat) setState({ chatFocus: 0 });
  else if (id === state.chatSplit) setState({ chatFocus: 1 });
  else if (state.chatFocus === 1 && state.chatSplit) setState({ chatSplit: id });
  else setState({ activeChat: id, chatFocus: 0 });
  updateChat(id, { unread: false });
  setState({ chatOpen: true });
  persistChats();
}

// ---------------- plan (Pro features) ----------------

export async function refreshLicense(): Promise<void> {
  try {
    setState({ license: await api().license.status() });
  } catch {
    // main not ready: keep the last known plan
  }
}

/** True when the plan includes the feature; otherwise explains it and offers Pro. */
export function requirePro(feature: ProFeature): boolean {
  const f = state.license.features;
  const ok =
    feature === 'chats'
      ? state.chats.length < f.maxChats
      : feature === 'split'
        ? f.split
        : f.windows;
  if (!ok) setState({ modal: { kind: 'upgrade', feature } });
  return ok;
}

/**
 * Opens a new chat next to the others; the running ones keep working. `always`: work handed
 * from one AI to another, or a prompt that must not be lost, never waits for a plan.
 */
export function newChat(patch: Partial<ChatTab> = {}, always = false): string {
  if (!always && !requirePro('chats')) return state.activeChat;
  const tab = blankChat(patch);
  setState((s) => ({ chats: [...s.chats, tab], chatHistoryFor: null }));
  selectChat(tab.id);
  return tab.id;
}

/** Asks for a folder and opens a new chat that works there (the window's folder stays). */
export async function newChatInFolder(): Promise<string | null> {
  if (!requirePro('chats')) return null;
  const picked = await api().workspace.pickChatFolder();
  if (!picked) return null;
  return newChat({ folder: picked.path === state.workspace?.root ? undefined : picked.path });
}

/** Closes a chat (the caller has already stopped it if it was working). */
export function closeChat(id: string): void {
  const idx = state.chats.findIndex((c) => c.id === id);
  if (idx < 0) return;
  let chats = state.chats.filter((c) => c.id !== id);
  if (!chats.length) chats = [blankChat()];
  const others = chats.filter((c) => c.id !== state.chatSplit || id === state.chatSplit);
  const pick = () => (others[Math.min(idx, others.length - 1)] ?? chats[0]!).id;
  let { activeChat, chatSplit, chatFocus } = state;
  if (id === chatSplit) {
    chatSplit = null;
    chatFocus = 0;
  } else if (id === activeChat) {
    activeChat = pick();
    if (activeChat === chatSplit) {
      chatSplit = null;
      chatFocus = 0;
    }
  }
  setState({ chats, activeChat, chatSplit, chatFocus });
  persistChats();
}

/** Two chats side by side (or back to one). */
export function toggleChatSplit(): void {
  if (!state.chatSplit && !requirePro('split')) return;
  if (state.chatSplit) {
    setState({ chatSplit: null, chatFocus: 0 });
  } else {
    const other = [...state.chats].reverse().find((c) => c.id !== state.activeChat);
    const id = other?.id ?? blankChat().id;
    if (!other) setState((s) => ({ chats: [...s.chats, blankChat({ id })] }));
    setState({ chatSplit: id, chatFocus: 1, chatOpen: true });
    updateChat(id, { unread: false });
  }
  persistChats();
}

export function runningChats(): number {
  return state.chats.filter((c) => c.busy).length;
}

state = { ...state, ...restoreChats(), chatList: savedChatList() };
