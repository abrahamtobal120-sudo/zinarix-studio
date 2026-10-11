/**
 * The only surface the sandboxed renderer can call. Implemented in preload over a
 * whitelisted set of IPC channels; every argument is re-validated with Zod in main.
 * API keys flow renderer -> main exactly once (when the user types them) and never back.
 */
import type { ChatMessage, ModelInfo } from '@omni/shared';

export interface WorkspaceInfo {
  root: string;
  name: string;
  branch: string | null;
}

export interface DirEntry {
  name: string;
  /** Path relative to the workspace root, '/' separated. */
  path: string;
  dir: boolean;
}

export interface FileContent {
  content: string;
  binary: boolean;
  tooLarge: boolean;
}

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface ProviderView {
  id: string;
  name: string;
  category: string;
  status: string;
  adapter: string;
  connected: boolean;
  store: string | null;
  needsKey: boolean;
  keyUrl: string | null;
  docsUrl: string | null;
  notes: string | null;
  params: { name: string; label: string; value: string; placeholder?: string }[];
  implemented: boolean;
  /** Catalog models (shown even before the provider is connected). */
  models: CatalogModelView[];
  local: boolean;
}

export interface CatalogModelView {
  id: string;
  label?: string;
  context?: number | null;
  inputPrice?: number | null;
  outputPrice?: number | null;
  tools?: boolean | null;
  vision?: boolean | null;
  reasoning?: boolean | null;
}

export type AiRole = 'chat' | 'agent' | 'inline';

export interface ConversationView {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string | null;
  project: string | null;
  messageCount: number;
}

export interface SavedMessageView {
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  ts: number;
  /** Rendering data saved with the turn (tool cards, cost, errors, attached context). */
  display: unknown;
}

export interface UsageRowView {
  provider: string;
  name: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpricedRequests: number;
}

export interface UsageReport {
  today: UsageRowView[];
  month: UsageRowView[];
  /** Last 30 days, local dates. */
  days: { day: string; provider: string; costUsd: number; requests: number; tokens: number }[];
  budgets: Record<string, { daily?: number; monthly?: number; hardStop: boolean }>;
}

/** Color themes: the two base ones plus extra palettes (see renderer/themes.ts). */
export const THEME_IDS = [
  'dark',
  'light',
  'midnight',
  'dracula',
  'monokai',
  'nord',
  'solarized-light',
  'github-light',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface Settings {
  defaultModel: string | null;
  /** Per-role overrides; missing roles use defaultModel. */
  roles: Partial<Record<AiRole, string>>;
  localOnly: boolean;
  theme: ThemeId;
  todayUsd: number;
}

/** Editor and app preferences (Settings screen), kept in desktop.json. */
export interface Prefs {
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  formatOnSave: boolean;
  autoSave: boolean;
  /** Ghost-text suggestions while typing (costs tokens; off by default). */
  inlineCompletions: boolean;
  /** Send .zinarix/rules.md (or AGENTS.md) to the chat and the agent. */
  projectRules: boolean;
  /** Command id -> shortcut ("Ctrl+Shift+G"); overrides the defaults. */
  keybindings: Record<string, string>;
}

export const DEFAULT_PREFS: Prefs = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  lineNumbers: true,
  formatOnSave: false,
  autoSave: false,
  inlineCompletions: false,
  projectRules: true,
  keybindings: {},
};

export interface GitFileView {
  path: string;
  /** Original path of a rename. */
  from?: string;
  /** Porcelain status letters: index (staged) and working tree. */
  index: string;
  work: string;
  untracked: boolean;
  conflict: boolean;
}
export interface GitStatusView {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileView[];
  hasCommits: boolean;
  remotes: string[];
}
export interface GitCommitView {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  refs: string;
}
export interface GitBranchView {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
}
export interface GitHubStatus {
  installed: boolean;
  loggedIn: boolean;
  user: string | null;
}
export interface GitHubRepoView {
  name: string;
  description: string;
  private: boolean;
  updatedAt: string;
  url: string;
}

export interface CompletionRequestView {
  path: string;
  language: string;
  prefix: string;
  suffix: string;
}

export interface ChatContext {
  source: string;
  content: string;
}

export type ToolDecision = 'approve' | 'deny' | 'always';

export interface ToolPreview {
  path?: string;
  before?: string;
  after?: string;
  command?: string;
  /** Browser tools: the page address and what the AI wants to do there. */
  url?: string;
  action?: string;
  /** Actions beyond the project: how risky, and what the user should know before approving. */
  risk?: 'medium' | 'high';
  warning?: string;
  /** High-risk: approved one at a time ("always" is not offered). */
  noAlways?: boolean;
}

export interface FindingView {
  severity: 'crítico' | 'alto' | 'medio' | 'bajo';
  title: string;
  where?: string;
  detail?: string;
  fix?: string;
  category?: string;
}
export interface SecReportView {
  title: string;
  findings: FindingView[];
  notes: string[];
}
export type SecKind = 'project' | 'deps' | 'system' | 'site' | 'hash';

export interface ScanHitView {
  port: number;
  service: string;
  banner?: string;
  risky: boolean;
}
export interface ScanHostView {
  host: string;
  reverse?: string;
  openPorts: ScanHitView[];
}
export interface ScanResultView {
  hosts: ScanHostView[];
  public: boolean;
  scannedPorts: number;
}

export interface BrowserStateView {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface ChatRequestView {
  /** Agent mode: the model may read files, search, edit (with approval) and run commands (with approval). */
  agent?: boolean;
  model?: string;
  history: ChatMessage[];
  prompt: string;
  context: ChatContext[];
  conversationId?: string;
}

export interface EditRequestView {
  model?: string;
  instruction: string;
  path: string;
  language: string;
  selection: string;
  before: string;
  after: string;
}

export type ChatEventView =
  | { type: 'start'; provider: string; model: string; conversationId?: string }
  | { type: 'conversation'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'notice'; message: string; kind: string }
  | {
      type: 'cost';
      usd: number | null;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
    }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string; code: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | {
      type: 'tool_approval';
      id: string;
      name: string;
      args: Record<string, unknown>;
      preview: ToolPreview;
    }
  | { type: 'tool_output'; id: string; chunk: string }
  | { type: 'tool_result'; id: string; ok: boolean; summary: string }
  | { type: 'file_changed'; path: string };

export type AppEvent =
  | { type: 'chat'; requestId: string; event: ChatEventView }
  | { type: 'term:data'; id: number; data: string }
  | { type: 'term:exit'; id: number; code: number }
  | { type: 'fs:changed' }
  | { type: 'workspace'; workspace: WorkspaceInfo | null }
  | { type: 'command'; command: string }
  | { type: 'browser:state'; state: BrowserStateView }
  /** The agent started using the browser: the UI should show the browser tab. */
  | { type: 'browser:show' }
  | { type: 'scan:progress'; requestId: string; done: number; total: number };

export interface OmniApi {
  workspace: {
    current(): Promise<WorkspaceInfo | null>;
    openDialog(): Promise<WorkspaceInfo | null>;
    /** Opens a folder dropped onto the window (a dropped file opens its parent folder). */
    openPath(path: string): Promise<{ workspace: WorkspaceInfo; file: string | null } | null>;
    close(): Promise<void>;
    recent(): Promise<{ path: string; name: string }[]>;
    readDir(path: string): Promise<DirEntry[]>;
    readFile(path: string): Promise<FileContent>;
    writeFile(path: string, content: string): Promise<void>;
    createFile(path: string): Promise<void>;
    createDir(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    trash(path: string): Promise<void>;
    listFiles(): Promise<string[]>;
    search(query: string, regex: boolean, caseSensitive: boolean): Promise<SearchHit[]>;
  };
  ai: {
    providers(): Promise<ProviderView[]>;
    saveProvider(
      id: string,
      key: string | null,
      params: Record<string, string>,
    ): Promise<{ ok: boolean; error?: string; store?: string; models?: number }>;
    removeProvider(id: string): Promise<void>;
    models(refresh: boolean): Promise<{
      models: ModelInfo[];
      errors: { provider: string; error: string }[];
      /** Local runtimes found running (auto-connected). */
      detected: string[];
    }>;
    setRole(role: AiRole, ref: string | null): Promise<void>;
    conversations(query: string, onlyProject: boolean): Promise<ConversationView[]>;
    conversation(
      id: string,
    ): Promise<{ conversation: ConversationView; messages: SavedMessageView[] } | null>;
    renameConversation(id: string, title: string): Promise<void>;
    deleteConversation(id: string): Promise<void>;
    /** Asks where to save and writes the conversation as Markdown. Returns the path or null. */
    exportConversation(id: string): Promise<string | null>;
    usage(): Promise<UsageReport>;
    /** Monthly/daily USD budget for a provider; null removes it. */
    setBudget(provider: string, budget: { daily?: number; monthly?: number } | null): Promise<void>;
    settings(): Promise<Settings>;
    setDefaultModel(ref: string): Promise<void>;
    setLocalOnly(on: boolean): Promise<void>;
    setTheme(theme: ThemeId): Promise<void>;
    /** Inline completion (ghost text) at the cursor; '' when there is nothing to suggest. */
    complete(requestId: string, req: CompletionRequestView): Promise<string>;
    /** Commit message for the staged changes (or all changes when nothing is staged). */
    commitMessage(): Promise<string>;
    /** Project rules file in use (.zinarix/rules.md, AGENTS.md…) or null. */
    rulesFile(): Promise<string | null>;
    /** Forget the agent's model-side transcript (regenerate / edit a message); keeps undo data. */
    resetContext(conversationId: string): Promise<void>;
    chat(requestId: string, req: ChatRequestView): Promise<void>;
    edit(requestId: string, req: EditRequestView): Promise<void>;
    abort(requestId: string): Promise<void>;
    toolDecision(requestId: string, toolCallId: string, decision: ToolDecision): Promise<void>;
    /** Undo every file change the agent made in a conversation. Returns restored paths. */
    revert(conversationId: string): Promise<string[]>;
  };
  git: {
    status(): Promise<GitStatusView>;
    init(): Promise<void>;
    stage(paths: string[]): Promise<void>;
    unstage(paths: string[]): Promise<void>;
    /** Discards changes; untracked files go to the trash. */
    discard(paths: string[]): Promise<void>;
    diff(path: string, staged: boolean): Promise<{ before: string; after: string }>;
    commit(message: string, amend: boolean): Promise<void>;
    log(): Promise<GitCommitView[]>;
    show(hash: string): Promise<string>;
    branches(): Promise<GitBranchView[]>;
    checkout(name: string, create: boolean): Promise<void>;
    deleteBranch(name: string, force: boolean): Promise<void>;
    sync(op: 'pull' | 'push' | 'fetch'): Promise<string>;
    stash(op: 'push' | 'pop'): Promise<void>;
    addRemote(url: string): Promise<void>;
  };
  github: {
    status(): Promise<GitHubStatus>;
    repos(): Promise<GitHubRepoView[]>;
    /** Asks for a parent folder, clones there and opens the clone. */
    clone(spec: string): Promise<WorkspaceInfo | null>;
    /** Creates the repository on GitHub from the open folder and pushes it. Returns its URL. */
    publish(name: string, visibility: 'private' | 'public', description: string): Promise<string>;
  };
  security: {
    /**
     * nmap-style scan. `authorized` (a public target is yours or you have written
     * permission) is set by the user in the scanner UI, never by the AI.
     */
    scan(
      requestId: string,
      opts: { target: string; ports?: string; serviceDetection?: boolean; authorized?: boolean },
    ): Promise<ScanResultView>;
    scanAbort(requestId: string): Promise<void>;
    /** Saves a Markdown report through a native dialog; returns the path or null. */
    saveReport(markdown: string): Promise<string | null>;
    /** Runs one analysis and returns structured findings for the security section. */
    run(
      requestId: string,
      opts: { kind: SecKind; checks?: string[]; url?: string; path?: string; expected?: string },
    ): Promise<SecReportView>;
  };
  browser: {
    /** Screen area (CSS px, window coordinates) where the page is drawn; null hides it. */
    setBounds(rect: { x: number; y: number; width: number; height: number } | null): Promise<void>;
    navigate(url: string): Promise<BrowserStateView>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
    /** Leaves the current page and shows the start page. */
    home(): Promise<void>;
    state(): Promise<BrowserStateView>;
  };
  terminal: {
    create(cols: number, rows: number): Promise<number>;
    write(id: number, data: string): Promise<void>;
    resize(id: number, cols: number, rows: number): Promise<void>;
    kill(id: number): Promise<void>;
  };
  app: {
    prefs(): Promise<Prefs>;
    setPrefs(patch: Partial<Prefs>): Promise<Prefs>;
    openExternal(url: string): Promise<void>;
    /** Confirms a close requested by the window manager (after unsaved-changes check). */
    quit(): Promise<void>;
    /** Absolute path of a File from a drag-and-drop event (Electron webUtils). */
    pathForFile(file: File): string;
    platform: string;
  };
  on(listener: (ev: AppEvent) => void): () => void;
}

export const CHANNELS = [
  'workspace:current',
  'workspace:openDialog',
  'workspace:openPath',
  'workspace:close',
  'workspace:recent',
  'workspace:readDir',
  'workspace:readFile',
  'workspace:writeFile',
  'workspace:createFile',
  'workspace:createDir',
  'workspace:rename',
  'workspace:trash',
  'workspace:listFiles',
  'workspace:search',
  'ai:providers',
  'ai:saveProvider',
  'ai:removeProvider',
  'ai:models',
  'ai:settings',
  'ai:setDefaultModel',
  'ai:setRole',
  'ai:conversations',
  'ai:conversation',
  'ai:renameConversation',
  'ai:deleteConversation',
  'ai:exportConversation',
  'ai:usage',
  'ai:setBudget',
  'ai:setLocalOnly',
  'ai:setTheme',
  'ai:chat',
  'ai:edit',
  'ai:abort',
  'ai:toolDecision',
  'ai:revert',
  'ai:complete',
  'ai:commitMessage',
  'ai:rulesFile',
  'ai:resetContext',
  'git:status',
  'git:init',
  'git:stage',
  'git:unstage',
  'git:discard',
  'git:diff',
  'git:commit',
  'git:log',
  'git:show',
  'git:branches',
  'git:checkout',
  'git:deleteBranch',
  'git:sync',
  'git:stash',
  'git:addRemote',
  'github:status',
  'github:repos',
  'github:clone',
  'github:publish',
  'app:prefs',
  'app:setPrefs',
  'security:run',
  'security:scan',
  'security:saveReport',
  'security:scanAbort',
  'browser:setBounds',
  'browser:navigate',
  'browser:back',
  'browser:forward',
  'browser:reload',
  'browser:state',
  'browser:home',
  'terminal:create',
  'terminal:write',
  'terminal:resize',
  'terminal:kill',
  'app:openExternal',
  'app:quit',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const EVENT_CHANNEL = 'omni:event';
