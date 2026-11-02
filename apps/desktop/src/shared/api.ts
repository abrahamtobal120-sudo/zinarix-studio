/**
 * The only surface the sandboxed renderer can call. Implemented in preload over a
 * whitelisted set of IPC channels; every argument is re-validated with Zod in main.
 * API keys flow renderer -> main exactly once (when the user types them) and never back.
 */
import type { ChatMessage, ModelInfo } from '@omni/shared';
import type { LicenseStatus } from './plans.js';
export type { LicenseStatus } from './plans.js';

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
  /** Added by the user (API endpoint or CLI not in the catalog); can be deleted. */
  custom: boolean;
}

/** A provider the user adds by hand: an API endpoint or a terminal agent (CLI). */
export type CustomProviderSpec =
  | {
      kind: 'api';
      name: string;
      adapter: 'openai-compatible' | 'openai-responses' | 'anthropic' | 'google-gemini';
      baseUrl: string;
      /** Header that carries the key (e.g. x-api-key); empty = Authorization: Bearer. */
      authHeader?: string;
      noAuth?: boolean;
      local?: boolean;
      /** Model ids to offer when the endpoint cannot list them. */
      models?: string[];
    }
  | {
      kind: 'cli';
      name: string;
      /** Program name in the PATH (or file name; the full path goes in the "command" param). */
      command: string;
      /** Output format of a known CLI, or "generic" (prompt on stdin, plain-text answer). */
      profile: string;
      args?: string[];
      models?: string[];
    };

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
  /** App version (package.json). */
  version: string;
  /** Show the guided setup / what's new on start (off for automated tests). */
  intro: boolean;
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
  /** https page of the "origin" remote (GitHub, GitLab…), when it can be derived. */
  webUrl: string | null;
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
export interface GitStashView {
  /** "stash@{0}" */
  ref: string;
  message: string;
  date: string;
}
export interface GitHubPrView {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  /** "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "" */
  review: string;
  /** Combined CI checks of the PR head. */
  checks: 'pass' | 'fail' | 'pending' | 'none';
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

export interface VercelStatus {
  connected: boolean;
  /** Where the token came from: pasted in the app, or the Vercel CLI login on this machine. */
  source: 'app' | 'cli' | null;
  user: string | null;
  teams: { id: string; name: string; slug: string }[];
  /** Vercel CLI on PATH (deploys run in the terminal). */
  cli: boolean;
}
export interface VercelProjectView {
  id: string;
  name: string;
  framework: string | null;
  /** Team id, or null for the personal account. */
  teamId: string | null;
  repo: string | null;
  updatedAt: number;
}
export interface VercelDeploymentView {
  id: string;
  url: string;
  state: 'QUEUED' | 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | string;
  target: 'production' | 'preview' | string;
  created: number;
  branch: string | null;
  commit: string | null;
  sha: string | null;
  creator: string | null;
  inspectorUrl: string | null;
}
export interface VercelEnvView {
  key: string;
  targets: string[];
  type: string;
}
export interface VercelProjectInfo {
  domains: { name: string; verified: boolean }[];
  envs: VercelEnvView[];
}

export interface SupabaseStatus {
  connected: boolean;
  /** Where the token came from: pasted in the app, or the Supabase CLI login on this machine. */
  source: 'app' | 'cli' | null;
  orgs: { id: string; name: string }[];
  /** Supabase CLI on PATH (migrations and functions run in the terminal). */
  cli: boolean;
}
export interface SupabaseProjectView {
  ref: string;
  name: string;
  orgId: string;
  region: string;
  /** ACTIVE_HEALTHY, INACTIVE (paused), COMING_UP, RESTORING… */
  status: string;
  created: number;
  dbVersion: string | null;
}
export interface SupabaseHealthView {
  name: string;
  healthy: boolean;
  status: string;
}
export interface SupabaseTableView {
  schema: string;
  name: string;
  /** Estimated row count. */
  rows: number;
  /** Row level security enabled. */
  rls: boolean;
}
export interface SupabaseQueryResult {
  columns: string[];
  /** Cells as text (null = SQL NULL); at most a few hundred rows. */
  rows: (string | null)[][];
  /** Rows the query returned (may be more than the rows sent). */
  total: number;
  ms: number;
}
export interface SupabaseFunctionView {
  slug: string;
  name: string;
  status: string;
  version: number;
  updated: number;
}
export interface SupabaseBucketView {
  id: string;
  name: string;
  public: boolean;
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
  /** delegate_to_ai: the AI that would receive the task, and whether it may act. */
  delegate?: { model: string; mode: 'agent' | 'chat' };
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

/** One tab of the built-in browser: the user's own, or the one of an AI conversation. */
export interface BrowserTabView {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  /** Conversation that owns the tab (null: the user's own tab). */
  owner: string | null;
  /** "Tú" or the model of the conversation that uses it. */
  label: string;
  ai: boolean;
}

export interface BrowserTabsView {
  tabs: BrowserTabView[];
  active: string | null;
}

export interface ChatRequestView {
  /** Agent mode: the model may read files, search, edit (with approval) and run commands (with approval). */
  agent?: boolean;
  model?: string;
  history: ChatMessage[];
  prompt: string;
  context: ChatContext[];
  conversationId?: string;
  /** Folder this chat works in (absolute); omitted = the window's open folder. */
  folder?: string;
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
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: Record<string, unknown>;
      /** Set when a helper AI (delegate_to_ai) makes the call: its model. */
      agent?: string;
    }
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
  | { type: 'browser:tabs'; view: BrowserTabsView }
  /** An agent started using the browser: the UI should show the browser (that tab). */
  | { type: 'browser:show'; tab?: string }
  | { type: 'scan:progress'; requestId: string; done: number; total: number }
  /** Another window changed shared settings (models, keys, theme, preferences, license). */
  | { type: 'settings:changed' }
  /**
   * A new version: downloading / ready to restart into (installers that update themselves),
   * or just available, with where to download it (other installs).
   */
  | { type: 'update'; state: 'available' | 'ready'; version: string; url?: string }
  /** A message from the app's owner (app-config.json), shown once. */
  | { type: 'notice'; id: string; text: string; url?: string };

export interface OmniApi {
  workspace: {
    current(): Promise<WorkspaceInfo | null>;
    openDialog(): Promise<WorkspaceInfo | null>;
    /** Opens a folder dropped onto the window (a dropped file opens its parent folder). */
    openPath(path: string): Promise<{ workspace: WorkspaceInfo; file: string | null } | null>;
    close(): Promise<void>;
    recent(): Promise<{ path: string; name: string }[]>;
    /** Asks for a folder for one chat (the window's open folder does not change). */
    pickChatFolder(): Promise<{ path: string; name: string } | null>;
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
    /** Adds (or replaces, same id) a user-defined provider; returns its id. */
    addCustomProvider(spec: CustomProviderSpec, id?: string): Promise<string>;
    /** Deletes a user-defined provider, its key and its settings. */
    deleteCustomProvider(id: string): Promise<void>;
    models(refresh: boolean): Promise<{
      models: ModelInfo[];
      errors: { provider: string; error: string }[];
      /** Local runtimes found running (auto-connected). */
      detected: string[];
    }>;
    setRole(role: AiRole, ref: string | null): Promise<void>;
    conversations(query: string, onlyProject: boolean): Promise<ConversationView[]>;
    /** Saved conversations of one folder, newest first. */
    projectConversations(folder: string): Promise<ConversationView[]>;
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
    rulesFile(folder?: string): Promise<string | null>;
    /** Forget the agent's model-side transcript (regenerate / edit a message); keeps undo data. */
    resetContext(conversationId: string): Promise<void>;
    chat(requestId: string, req: ChatRequestView): Promise<void>;
    edit(requestId: string, req: EditRequestView): Promise<void>;
    abort(requestId: string): Promise<void>;
    toolDecision(requestId: string, toolCallId: string, decision: ToolDecision): Promise<void>;
    /** Undo every file change the agent made in a conversation. Returns restored paths. */
    revert(conversationId: string, folder?: string): Promise<string[]>;
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
    /** push (optional message) / pop · apply · drop (optional ref, default the latest). */
    stash(op: 'push' | 'pop' | 'apply' | 'drop', arg?: string): Promise<void>;
    stashList(): Promise<GitStashView[]>;
    addRemote(url: string): Promise<void>;
    /** Undoes the last commit and keeps its changes staged (reset --soft). */
    undoCommit(): Promise<void>;
    /** New commit that reverts the given one. */
    revert(hash: string): Promise<void>;
    /** Merges a branch into the current one. */
    merge(name: string): Promise<void>;
  };
  github: {
    status(): Promise<GitHubStatus>;
    repos(): Promise<GitHubRepoView[]>;
    /** Asks for a parent folder, clones there and opens the clone. */
    clone(spec: string): Promise<WorkspaceInfo | null>;
    /** Creates the repository on GitHub from the open folder and pushes it. Returns its URL. */
    publish(name: string, visibility: 'private' | 'public', description: string): Promise<string>;
    /** Pull request of the current branch (null when there is none or gh is not signed in). */
    pr(): Promise<GitHubPrView | null>;
  };
  vercel: {
    status(): Promise<VercelStatus>;
    /** Saves an access token (encrypted with the OS keychain) and returns the new status. */
    setToken(token: string): Promise<VercelStatus>;
    logout(): Promise<VercelStatus>;
    /** .vercel/project.json of the open folder (written by "vercel link"). */
    linked(): Promise<{ projectId: string; teamId: string | null } | null>;
    projects(teamId: string | null): Promise<VercelProjectView[]>;
    project(projectId: string, teamId: string | null): Promise<VercelProjectInfo>;
    deployments(projectId: string, teamId: string | null): Promise<VercelDeploymentView[]>;
    /** Build log text of a deployment. */
    logs(deploymentId: string, teamId: string | null): Promise<string>;
    cancel(deploymentId: string, teamId: string | null): Promise<void>;
    /** Redeploys a deployment (same source); returns the new deployment's URL. */
    redeploy(deploymentId: string, teamId: string | null, production: boolean): Promise<string>;
  };
  supabase: {
    status(): Promise<SupabaseStatus>;
    /** Saves a personal access token (encrypted with the OS keychain). */
    setToken(token: string): Promise<SupabaseStatus>;
    logout(): Promise<SupabaseStatus>;
    /** Project ref of the open folder (supabase/.temp/project-ref, written by "supabase link"). */
    linked(): Promise<string | null>;
    projects(): Promise<SupabaseProjectView[]>;
    health(ref: string): Promise<SupabaseHealthView[]>;
    tables(ref: string): Promise<SupabaseTableView[]>;
    preview(ref: string, schema: string, table: string): Promise<SupabaseQueryResult>;
    /** Runs SQL on the project's database. */
    query(ref: string, sql: string): Promise<SupabaseQueryResult>;
    functions(ref: string): Promise<SupabaseFunctionView[]>;
    buckets(ref: string): Promise<SupabaseBucketView[]>;
    restore(ref: string): Promise<void>;
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
    /**
     * The user's own navigation, on the tab they were looking at (null: the visible one).
     * An address typed while an AI's tab is shown opens in a tab of the user's own.
     */
    navigate(url: string, tabId: string | null): Promise<BrowserStateView>;
    back(tabId: string | null): Promise<void>;
    forward(tabId: string | null): Promise<void>;
    reload(tabId: string | null): Promise<void>;
    /** Leaves the current page and shows the start page. */
    home(tabId: string | null): Promise<void>;
    state(): Promise<BrowserStateView>;
    /** Open tabs (one per AI conversation that used the browser, plus the user's). */
    tabs(): Promise<BrowserTabsView>;
    selectTab(id: string): Promise<void>;
    closeTab(id: string): Promise<void>;
    newTab(): Promise<void>;
  };
  terminal: {
    /**
     * Starts a shell. admin: an administrator shell (sudo; gsudo on Windows). profile: a
     * shell from profiles() (default: the first that starts). null: Windows without gsudo,
     * an elevated PowerShell window was opened instead.
     */
    create(
      cols: number,
      rows: number,
      admin?: boolean,
      profile?: string,
    ): Promise<{ id: number; name: string } | null>;
    /** Shells installed on this machine (PowerShell, cmd, Git Bash, WSL…), default first. */
    profiles(): Promise<{ id: string; name: string }[]>;
    write(id: number, data: string): Promise<void>;
    resize(id: number, cols: number, rows: number): Promise<void>;
    kill(id: number): Promise<void>;
  };
  app: {
    prefs(): Promise<Prefs>;
    setPrefs(patch: Partial<Prefs>): Promise<Prefs>;
    openExternal(url: string): Promise<void>;
    /** Closes this window (after the unsaved-changes check); the app quits with the last one. */
    quit(): Promise<void>;
    /**
     * Opens another Zinarix Studio window (its own folder, chats, browser and terminals).
     * false: the plan does not include more windows (Pro).
     */
    newWindow(): Promise<boolean>;
    /** Restarts into the update already downloaded (see the 'update' event). */
    installUpdate(): Promise<void>;
    /** Absolute path of a File from a drag-and-drop event (Electron webUtils). */
    pathForFile(file: File): string;
    platform: string;
  };
  license: {
    status(): Promise<LicenseStatus>;
    /** A license key (ZX1.…) or the owner's word. Throws with a readable reason. */
    activate(key: string): Promise<LicenseStatus>;
    remove(): Promise<LicenseStatus>;
  };
  on(listener: (ev: AppEvent) => void): () => void;
}

export const CHANNELS = [
  'workspace:current',
  'workspace:openDialog',
  'workspace:pickChatFolder',
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
  'ai:addCustomProvider',
  'ai:deleteCustomProvider',
  'ai:models',
  'ai:settings',
  'ai:setDefaultModel',
  'ai:setRole',
  'ai:conversations',
  'ai:projectConversations',
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
  'git:stashList',
  'git:undoCommit',
  'git:revert',
  'git:merge',
  'github:status',
  'github:repos',
  'github:clone',
  'github:publish',
  'github:pr',
  'vercel:status',
  'vercel:setToken',
  'vercel:logout',
  'vercel:linked',
  'vercel:projects',
  'vercel:project',
  'vercel:deployments',
  'vercel:logs',
  'vercel:cancel',
  'vercel:redeploy',
  'supabase:status',
  'supabase:setToken',
  'supabase:logout',
  'supabase:linked',
  'supabase:projects',
  'supabase:health',
  'supabase:tables',
  'supabase:preview',
  'supabase:query',
  'supabase:functions',
  'supabase:buckets',
  'supabase:restore',
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
  'browser:tabs',
  'browser:selectTab',
  'browser:closeTab',
  'browser:newTab',
  'terminal:create',
  'terminal:profiles',
  'terminal:write',
  'terminal:resize',
  'terminal:kill',
  'app:openExternal',
  'app:quit',
  'app:newWindow',
  'app:installUpdate',
  'license:status',
  'license:activate',
  'license:remove',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const EVENT_CHANNEL = 'omni:event';
