import type { DesignApplyResult, DesignOp, DesignSessionView } from './design.js';
/**
 * The only surface the sandboxed renderer can call. Implemented in preload over a
 * whitelisted set of IPC channels; every argument is re-validated with Zod in main.
 * API keys flow renderer -> main exactly once (when the user types them) and never back.
 */
import type { ChatMessage, ModelInfo } from '@omni/shared';
import type { LicenseStatus } from './plans.js';
import type { ChromeState } from './windowChrome.js';
import type { TestDiscovery, TestEvent, TestRunRequest, TestRunSummary } from './testing.js';
import type {
  Breakpoint,
  DebugConfig,
  DebugConfigList,
  DebugEvent,
  DebugVariable,
  ExtensionSearchItem,
  InstalledExtension,
} from './devtools.js';
import type { LspStatus, NextEditRequestView, NextEditResultView } from './lsp.js';
import type { SuggestionStatsRow } from './nextEdit.js';
import type { ExportOptions, MediaItem, Transcript, VideoProject } from './video.js';
import type { VideoAgentResult } from './videoAgent.js';

/** Fase 13: a speech-to-text engine as the video editor lists it. */
export type SttEngineId = 'local' | 'openai' | 'groq';
export interface SttEngineView {
  id: SttEngineId;
  label: string;
  ready: boolean;
  note: string;
  cloud: boolean;
}
export type { LicenseStatus } from './plans.js';
import type { TaskCreateView, TaskView, TasksStatusView, TasksUsageView } from './tasks.js';
export type { TaskCreateView, TaskView, TasksStatusView, TasksUsageView } from './tasks.js';
import type {
  PlaygroundEvent,
  PlaygroundParams,
  PlaygroundResult,
  PlaygroundRunRequest,
  PromptTemplate,
} from './playground.js';
import type { CodeLang } from './playgroundCode.js';
import type { GenEstimate, GenEvent, GenModelView, GenRequest, GenResult } from './mediaGen.js';
import type { Render3DFormat, Scene3D } from './scene3d.js';
import type { BlenderEngine } from './scene3dBpy.js';
import type { Gen3DEvent, Gen3DModel, Gen3DRequest } from './gen3d.js';
import type { BuildDeployView, BuildView } from './build.js';

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

/** Raw slice of a file: `bytes` starts at the requested offset; `size` is the whole file. */
export interface FileBytes {
  bytes: Uint8Array<ArrayBuffer>;
  size: number;
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

/** A file one agent exchange changed (Fase 2, diff review). */
export interface TurnDiffFileView {
  path: string;
  /** null = the exchange created it. */
  before: string | null;
  /** null = the exchange deleted it. What that exchange left, not later ones. */
  after: string | null;
  /** The file changed after it (a later message or by hand). */
  changedSince: boolean;
}

/** One file "Volver aquí" would write back (Fase 2). */
export interface RewindFileView {
  path: string;
  /** delete = the agent created it. */
  action: 'restore' | 'delete';
  /** Changed after the agent's last write: that work is lost too. */
  edited: boolean;
}

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
  /** Size of the whole interface, in percent (100 = real size). */
  uiZoom: number;
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
  /** Language servers (Python, Go, Rust…) for go-to-definition, rename and errors. */
  lsp: boolean;
  /** Monaco language id -> command line of its language server (overrides the built-in one). */
  lspCommands: Record<string, string>;
  /** Predict the next edit (Tab jumps there); works together with inlineCompletions. */
  nextEdit: boolean;
  /** Fase 8: add the missing imports when a suggestion is accepted. */
  autoImport: boolean;
  /** The round "Ayuda de Zinarix" button (help assistant) in the corner. */
  helperBubble: boolean;
  /** Local Ollama model of the help assistant ("qwen2.5:1.5b"). */
  helperModel: string;
  /** Fase 18: Mica (Windows 11) or vibrancy (macOS) behind the title bar and the side bar. */
  windowEffects: boolean;
}

/** Steps of the interface size (Ver > Acercar / Alejar and Settings). */
export const UI_ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

export const DEFAULT_PREFS: Prefs = {
  uiZoom: 100,
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
  lsp: true,
  lspCommands: {},
  nextEdit: true,
  autoImport: true,
  helperBubble: true,
  helperModel: 'qwen2.5:1.5b',
  windowEffects: true,
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
/** Fase 6: what "Revisar cambios" reviews. */
export type ReviewSourceView =
  | { kind: 'local' }
  | { kind: 'branch'; base: string }
  | { kind: 'pr'; number: number };
export interface ReviewRequestView {
  source: ReviewSourceView;
  /** Reviewer models ("provider/model"); empty = the default model. */
  models: string[];
  /** Verifier model (default: the first reviewer). */
  verifier?: string;
  /** false skips the verification pass. */
  verify?: boolean;
  /** false skips the security center scanners. */
  security?: boolean;
}
export type ReviewSeverityView = 'critical' | 'high' | 'medium' | 'low';
export interface ReviewFindingView {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  severity: ReviewSeverityView;
  category: 'bug' | 'security' | 'performance' | 'reliability' | 'maintainability';
  title: string;
  detail: string;
  fix?: string;
  models: string[];
  source: 'ai' | 'scanner';
  verdict: 'confirmed' | 'plausible';
  verifyNote?: string;
  /** Stable id of the finding (ignore list, already posted on the PR). */
  fingerprint?: string;
}
export interface ReviewFileView {
  path: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  added: number;
  removed: number;
}
export interface ReviewView {
  id: string;
  source: ReviewSourceView;
  title: string;
  prUrl?: string;
  findings: ReviewFindingView[];
  stats: {
    files: number;
    reviewedFiles: number;
    skippedFiles: string[];
    raw: number;
    offDiff: number;
    merged: number;
    falsePositives: number;
    /** Hidden by .zinarix/review-ignore.json. */
    ignored?: number;
  };
  errors: { model: string; error: string }[];
  models: string[];
  verifier?: string;
  usd: number;
  files: ReviewFileView[];
  /** Only reviews of a pull request can be published. */
  canPublish: boolean;
  /** URL of the GitHub review once published. */
  published?: string;
  at: number;
  /** Guidance the reviewers got: ".zinarix/review.md" and/or "rules" (AGENTS.md…). */
  guidance?: string[];
}
/** A saved review in the history list. */
export interface ReviewHistoryView {
  id: string;
  title: string;
  at: number;
  findings: number;
  published?: string;
}
/** What publishing the chosen findings would do. */
export interface ReviewPublishPreview {
  inline: number;
  body: number;
  /** Already on the PR (an earlier review): left out. */
  already: number;
  /** The PR got new commits after the review (comments may land on outdated lines). */
  stale: boolean;
  url: string;
}
export interface ReviewPrView {
  number: number;
  title: string;
  url: string;
  branch: string;
  author: string;
  draft: boolean;
}
export type ReviewProgressView =
  | { phase: 'review'; done: number; total: number }
  | { phase: 'verify'; done: number; total: number }
  | { phase: 'done' };

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

export interface GCloudStatus {
  /** An OAuth client is set up for "Sign in with Google" (shared with the Mail panel). */
  ready: boolean;
  connected: boolean;
  /** Address of the active Google account. */
  user: string | null;
  /** The login is kept but Google could not be reached (why); the panel retries. */
  offline?: string;
  accounts: { id: string; label: string }[];
  active: string | null;
}
export interface GCloudProject {
  id: string;
  name: string;
  number: string;
}
export interface GCloudService {
  /** e.g. bigquery.googleapis.com */
  name: string;
  title: string;
  enabled: boolean;
}
export interface GCloudDataset {
  id: string;
  location: string;
}
export interface GCloudTable {
  id: string;
  /** TABLE, VIEW, EXTERNAL… */
  type: string;
}
export interface GCloudQueryResult {
  columns: string[];
  rows: (string | null)[][];
  total: number;
  ms: number;
  /** Bytes BigQuery processed (what it bills). */
  bytes: number;
}
export interface GCloudBucket {
  name: string;
  location: string;
  storageClass: string;
  created: number | null;
}
export interface GCloudObject {
  /** Full object name (folders end in "/"). */
  name: string;
  folder: boolean;
  size: number;
  updated: number | null;
  type: string;
}
export interface GCloudSqlInstance {
  name: string;
  version: string;
  region: string;
  state: string;
  tier: string;
  ip: string;
}
export interface GCloudLogEntry {
  time: number | null;
  severity: string;
  text: string;
  resource: string;
}
/** Google Cloud services the panel lists in a generic way (one tab each). */
export const GCLOUD_KINDS = [
  'compute',
  'run',
  'functions',
  'gke',
  'pubsub',
  'secrets',
  'firestore',
  'iam',
] as const;
export type GCloudResourceKind = (typeof GCLOUD_KINDS)[number];
/** One thing of a Google Cloud service: a VM, a Cloud Run service, a topic, a member… */
export interface GCloudResource {
  id: string;
  name: string;
  /** Raw state from Google ("RUNNING", "READY"…), empty when the service has none. */
  status: string;
  /** true healthy, false failed, null stopped or unknown. */
  ok: boolean | null;
  detail: string;
  /** Public address (Cloud Run, Functions, a VM's external IP). */
  url?: string;
  /** Page of the resource in the Google Cloud console. */
  console: string;
  /** Compute Engine zone (to start or stop the VM). */
  zone?: string;
}

export interface VercelStatus {
  connected: boolean;
  /** Where the token came from: pasted in the app, or the Vercel CLI login on this machine. */
  source: 'app' | 'cli' | null;
  user: string | null;
  teams: { id: string; name: string; slug: string }[];
  /** Vercel CLI on PATH (deploys run in the terminal). */
  cli: boolean;
  /** The token is kept but the service could not be reached (why); the panel retries. */
  offline?: string;
  /** Accounts connected in the app (several at once); the panel and the AI use the active one. */
  accounts: { id: string; label: string }[];
  active: string | null;
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
  id: string;
  key: string;
  /** Git branch the variable is limited to (preview only). */
  branch: string | null;
  targets: string[];
  type: string;
}
export interface VercelProjectInfo {
  domains: { name: string; verified: boolean; redirect: string | null; branch: string | null }[];
  envs: VercelEnvView[];
}

export interface VercelSettings {
  framework: string | null;
  buildCommand: string | null;
  installCommand: string | null;
  devCommand: string | null;
  outputDirectory: string | null;
  rootDirectory: string | null;
  nodeVersion: string | null;
}

export interface MailAccount {
  email: string;
  /** Sender name shown to recipients (optional). */
  name?: string;
  /** Login user (usually the email itself). */
  user: string;
  /** 'google': signed in with Google (OAuth, no app password). Absent: password login. */
  auth?: 'google';
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}
export interface MailStatus {
  /** The active mailbox has its password. */
  connected: boolean;
  /** The active mailbox (the one the panel shows). */
  account: MailAccount | null;
  /** Every mailbox connected in the app; the AI can use any of them. */
  accounts: MailAccount[];
}
export interface MailFolderView {
  path: string;
  name: string;
  /** \Inbox, \Sent, \Trash, \Junk, \Drafts, \Archive… (null for ordinary folders). */
  specialUse: string | null;
  unseen: number;
  messages: number;
}
export interface MailSummaryView {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: number;
  seen: boolean;
  flagged: boolean;
  attachments: boolean;
}
export interface MailListView {
  total: number;
  messages: MailSummaryView[];
}
export interface MailMessageView {
  uid: number;
  messageId: string | null;
  references: string[];
  from: string;
  replyTo: string;
  to: string;
  cc: string;
  subject: string;
  date: number;
  /** HTML body (inline images embedded); null for plain-text mail. */
  html: string | null;
  text: string;
  attachments: { index: number; filename: string; size: number; contentType: string }[];
}
export interface MailDraft {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
  /** UID in the Drafts folder this draft was opened from (replaced on save, removed on send). */
  draftUid?: number | null;
}
/** Where `mail.move` puts a message: special folders, found by their IMAP role. */
export type MailTarget = 'inbox' | 'junk' | 'trash' | 'archive';

export interface SupabaseStatus {
  connected: boolean;
  /** Where the token came from: pasted in the app, or the Supabase CLI login on this machine. */
  source: 'app' | 'cli' | null;
  orgs: { id: string; name: string }[];
  /** Supabase CLI on PATH (migrations and functions run in the terminal). */
  cli: boolean;
  /** The token is kept but the service could not be reached (why); the panel retries. */
  offline?: string;
  /** Accounts connected in the app (several at once); the panel and the AI use the active one. */
  accounts: { id: string; label: string }[];
  active: string | null;
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
export interface SupabaseColumnView {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  pk: boolean;
}
export interface SupabaseUserView {
  id: string;
  /** Email, or phone for phone sign-ups. */
  email: string | null;
  provider: string;
  confirmed: boolean;
  created: number;
  lastSignIn: number | null;
}
export interface SupabaseMigrationView {
  version: string;
  name: string | null;
}
export interface SupabaseAuthConfig {
  siteUrl: string;
  /** Extra URLs auth may redirect to after login. */
  redirectUrls: string[];
  disableSignup: boolean;
  /** Users can sign in without confirming their email. */
  autoconfirm: boolean;
}
/** Auth emails Supabase sends; each has a subject and an HTML template. */
export type SupabaseEmailKind =
  'confirmation' | 'invite' | 'magic_link' | 'recovery' | 'email_change' | 'reauthentication';
export interface SupabaseSmtpConfig {
  host: string;
  port: string;
  user: string;
  /** Empty keeps the saved password (it is never read back). */
  pass: string;
  senderEmail: string;
  senderName: string;
}
export interface SupabaseEmailConfig {
  /** null: Supabase's built-in mailer (only for team members, a few emails per hour). */
  smtp: Omit<SupabaseSmtpConfig, 'pass'> | null;
  hasPass: boolean;
  /** Emails per hour the project may send. */
  rateLimit: number | null;
  templates: Record<SupabaseEmailKind, { subject: string; content: string }>;
}
export interface SupabaseBackupsView {
  /** Point in time recovery is on. */
  pitr: boolean;
  list: { at: number; status: string }[];
}
export interface SupabaseApiInfo {
  url: string;
  /** Public keys only (anon / publishable). */
  keys: { name: string; key: string }[];
}

export interface CompletionRequestView {
  path: string;
  language: string;
  prefix: string;
  suffix: string;
}

/** A memory kept between conversations (global, or for one project folder). */
/** Cloud sync with the user's own Supabase project (end-to-end encrypted). */
export interface CloudSyncStatus {
  connected: boolean;
  ref: string | null;
  projectName: string | null;
  /** Supabase account id (null: the active one). */
  account: string | null;
  deviceName: string | null;
  lastSync: number | null;
  lastError: string | null;
  /** Items brought in / sent in the last sync. */
  lastIn: number;
  lastOut: number;
  syncing: boolean;
}

export interface MemoryView {
  id: string;
  text: string;
  scope: 'global' | 'project';
  /** Absolute project folder (scope "project"). */
  project?: string;
  created: number;
}

/** An external documentation site indexed for the AI (@Docs). */
export interface DocSourceView {
  id: string;
  name: string;
  url: string;
  pages: number;
  chunks: number;
  indexedAt: number | null;
  status: 'indexing' | 'ready' | 'error';
  error?: string;
  /** Indexed with embeddings (search by meaning) rather than words only. */
  embedded?: boolean;
}

/** A search result of the knowledge indexes (project code or docs). */
export interface KnowledgeHit {
  /** Project-relative path, or the page URL for docs. */
  source: string;
  start: number;
  end: number;
  title?: string;
  /** Docs source name. */
  label?: string;
  text: string;
  score: number;
}

export interface ChatContext {
  source: string;
  content: string;
}

export type ToolDecision = 'approve' | 'deny' | 'always';

/** One project rule as the "active rules" panel shows it. */
export interface RuleView {
  path: string;
  name: string;
  kind: 'instructions' | 'zinarix' | 'cursor' | 'copilot' | 'legacy';
  applies: 'always' | 'glob' | 'manual';
  globs: string[];
  description: string;
}

export interface ActiveRulesView {
  /** Settings › AI › Project rules is on. */
  enabled: boolean;
  /** Rules that enter the prompt: why ("always", "folder", "mention" or the glob) and size. */
  active: (RuleView & { reason: string; tokens: number })[];
  /** Rules the agent is told about and may read when the task needs them. */
  available: RuleView[];
  /** Rules cut because the total went over the limit. */
  truncated: string[];
  /** Estimated tokens of all active rules. */
  tokens: number;
}

/** Fase 4: what the project (and ~/.zinarix) adds to the agent, as the chat shows it. */
export interface AgentKitView {
  /** "/" commands of .zinarix/commands (and .claude/commands). */
  commands: {
    name: string;
    description: string;
    argumentHint?: string;
    agent?: boolean;
    body: string;
    path: string;
  }[];
  agents: { name: string; description: string; model?: string; tools?: string[]; path: string }[];
  skills: { name: string; description: string; dir: string }[];
  hooks: { event: string; matcher: string; command: string; source: string }[];
  /** The user approved this exact set of hooks "always" for the folder. */
  hooksTrusted: boolean;
}

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
  /** ask_user (Fase 3): a question with options instead of approve / deny. */
  question?: { question: string; options: string[]; multiple: boolean };
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
  /** The page is in the bookmarks. */
  bookmarked?: boolean;
  /** Favicon of the site (data: URL), when known. */
  icon?: string;
}

/** A page of the browser history (its latest visit) or a bookmark. */
export interface BrowserHistoryEntryView {
  url: string;
  title: string;
  at: number;
  visits: number;
  bookmark?: boolean;
}

export interface BrowserHistoryView {
  entries: BrowserHistoryEntryView[];
  /** Favicons by host (data: URLs). */
  icons: Record<string, string>;
}

/** One tab of the built-in browser: the user's own, or the one of an AI conversation. */
export interface BrowserTabView {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  icon?: string;
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
  /** Fase 3, with agent: plan = read-only until the plan is approved, auto = edits need no
   * approval, full = edits and commands need no approval (Fase 5B). */
  mode?: 'plan' | 'agent' | 'auto' | 'full';
  model?: string;
  history: ChatMessage[];
  prompt: string;
  context: ChatContext[];
  conversationId?: string;
  /** Folder this chat works in (absolute); omitted = the window's open folder. */
  folder?: string;
  /** Works in no folder at all (not even the window's open folder). */
  noFolder?: boolean;
  /** Images pasted or dropped into the message (base64 without the data: prefix). */
  images?: { mediaType: string; data: string }[];
  /** How hard the model should think (and show its reasoning); omitted = provider default. */
  reasoning?: 'low' | 'medium' | 'high';
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
  /** A link was opened in the built-in browser: the UI shows the browser (no AI notice). */
  | { type: 'browser:focus' }
  | { type: 'scan:progress'; requestId: string; done: number; total: number }
  /** Another window changed shared settings (models, keys, theme, preferences, license). */
  | { type: 'settings:changed' }
  /** A conversation got its short AI-written title. */
  | { type: 'chat:title'; conversationId: string; title: string }
  /**
   * A new version: downloading / ready to restart into (installers that update themselves),
   * or just available, with where to download it (other installs).
   */
  | { type: 'update'; state: 'available' | 'ready'; version: string; url?: string }
  /** A message from the app's owner (app-config.json), shown once. */
  | { type: 'notice'; id: string; text: string; url?: string }
  /** A Video Studio export changed state or progressed. */
  | { type: 'video:job'; job: VideoJobView }
  /** Fase 13B: the agent asks Video Studio to read or edit (answer with video.agentDone). */
  | {
      type: 'video:agent';
      requestId: string;
      name: string;
      args: Record<string, unknown>;
      /** Only describe the change (approval card): commit nothing. */
      dry: boolean;
    }
  /** Fase 13B: the agent stopped waiting for this request (canceled turn). */
  | { type: 'video:agentAbort'; requestId: string }
  /** The paired phone asked for something (see PhoneAction). */
  | { type: 'phone'; action: PhoneAction }
  /** The phone remote changed (started, stopped, a phone paired, new PIN). */
  | { type: 'phone:status'; status: PhoneStatus }
  /** A Telegram or Discord bot connected, failed or got a new linked chat. */
  | { type: 'bots:status'; status: BotsStatus }
  /** WhatsApp Web changed (unread count, chat open, control, answers waiting). */
  | { type: 'whatsapp:status'; status: WhatsAppStatus }
  /** The auto review (Revisión automática) reviewed a project, started or stopped, or its settings changed. */
  | { type: 'watch:status'; status: WatchStatus }
  /** The debug session of this window changed (state, stop, output). */
  | { type: 'debug'; event: DebugEvent }
  /** A test run of this window started, printed something or finished. */
  | { type: 'tests'; event: TestEvent }
  /** Extensions were installed, removed, enabled or disabled (in any window). */
  | { type: 'extensions:changed' }
  /** Errors/warnings a language server found in a file (LSP Diagnostic[], zx-ws:/ URIs). */
  | { type: 'lsp:diagnostics'; path: string; diagnostics: unknown[] }
  /** A language server started, is missing, failed… */
  | { type: 'lsp:status'; status: LspStatus }
  /** A language server asks to change files (WorkspaceEdit); answer with lsp.applyEditResult. */
  | { type: 'lsp:applyEdit'; id: number; edit: unknown }
  /** Memories or indexed docs changed (added, removed, a crawl progressed). */
  | { type: 'knowledge:changed' }
  /** A cloud sync ended (conv: conversations came in from another PC). */
  | { type: 'cloud:status'; status: CloudSyncStatus; conv: boolean }
  /** The help assistant (Ayuda de Zinarix) streamed part of an answer. */
  | { type: 'helper'; requestId: string; event: HelperEvent }
  /** Progress of a local model download for the help assistant. */
  | { type: 'helper:pull'; event: HelperPullEvent }
  /** Fase 5: the background tasks changed (state, cost, an approval waiting…). */
  | { type: 'tasks'; status: TasksStatusView }
  /** Fase 6: progress of a code review. */
  | { type: 'review:progress'; requestId: string; progress: ReviewProgressView }
  /** Fase 9: stream of a Playground run (one per model when comparing). */
  | { type: 'playground'; requestId: string; event: PlaygroundEvent }
  | { type: 'media'; requestId: string; event: GenEvent }
  /** Fase 14: progress (0–1) of a Blender render. */
  | { type: 'scene3d'; requestId: string; progress: number }
  /** Fase 14: the agent asks this window's viewer to render a scene (answer with agentDone). */
  | {
      type: 'scene3d:agent';
      requestId: string;
      scene: Scene3D;
      name: string;
      format: Render3DFormat;
    }
  /** Fase 14: a 3D render to put into Video Studio (library and timeline). */
  | { type: 'scene3d:imported'; path: string }
  /** Fase 14: the agent reads / edits / renders the scene open in the 3D editor (agentDone). */
  | { type: 'scene3d:edit'; requestId: string; name: string; args: Record<string, unknown> }
  /** Fase 14: progress of a 3D model generation (Replicate). */
  | { type: 'gen3d'; requestId: string; event: Gen3DEvent };

export interface Render3DResult {
  path: string;
  format: Render3DFormat;
  frames: number;
  ms: number;
}

/** Whether the help assistant can answer locally (Ollama running and its model downloaded). */
export interface HelperStatus {
  ollama: 'running' | 'down';
  /** Ollama found on disk (when it is down: installed but not open, or not installed). */
  installed: boolean;
  model: string;
  hasModel: boolean;
  /** Models already downloaded in Ollama. */
  models: string[];
  /** Pieces of documentation the assistant knows. */
  chunks: number;
}

export type HelperEvent =
  | { type: 'sources'; sources: string[] }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface HelperPullEvent {
  requestId: string;
  status: string;
  completed?: number;
  total?: number;
  done?: boolean;
  error?: string;
}

/** Something the Watcher thinks should be fixed (a bug, a risk) or improved. */
export interface WatchItem {
  kind: 'fix' | 'improve';
  title: string;
  detail: string;
  /** Workspace-relative file (maybe with ":line"), when the advice is about one place. */
  file?: string;
}

/** One review of a project by the Watcher. */
export interface WatchReport {
  id: string;
  ts: number;
  /** Absolute folder of the project, and its name. */
  project: string;
  name: string;
  summary: string;
  items: WatchItem[];
  model: string;
  usd: number | null;
  seen: boolean;
}

export interface WatchSettings {
  /** Keeps watching the open projects (checks are free; only reviews use tokens). */
  enabled: boolean;
  /** Least minutes between two AI reviews. */
  everyMin: number;
  /** Most AI reviews in a day. */
  maxPerDay: number;
  /** "provider/model" for the reviews; null = the chat model. */
  model: string | null;
}

export interface WatchStatus {
  settings: WatchSettings;
  /** Project being reviewed right now. */
  busy: string | null;
  lastReview: number | null;
  /** When the next review may happen (if something changes by then). */
  nextAt: number | null;
  reviewsToday: number;
  lastError: string | null;
  /** Newest first. */
  reports: WatchReport[];
}

/** Whose messages of an allowed WhatsApp chat are orders: yours, the other person's, or both. */
export type WhatsAppWho = 'me' | 'them' | 'all';

/** A WhatsApp chat allowed to control Zinarix. */
export interface WhatsAppChat {
  id: string;
  title: string;
  who: WhatsAppWho;
  /** Answers waiting for this chat to be open (in status only). */
  pending?: number;
}

/** WhatsApp Web inside Zinarix, and the chats of it that control Zinarix (optional). */
export interface WhatsAppStatus {
  /** The page is loaded (it keeps running when its tab is closed). */
  open: boolean;
  /** Logged in (the chat list shows); false while it asks for the QR; unknown before it loads. */
  logged?: boolean;
  /** Control from WhatsApp is on. */
  control: boolean;
  /** The chats Zinarix listens to ("Message yourself", or people the user trusts). */
  chats: WhatsAppChat[];
  /** The chat open in the page right now. */
  current?: { id: string; title: string };
  /** The phone remote runs (the control needs it, like the Telegram and Discord bots). */
  linked: boolean;
  /** Answers waiting for their chat to be open. */
  pending: number;
  /** Unread chats, as the page title says. */
  unread: number;
  /** Last orders received and answers written, newest last. */
  log: WhatsAppEvent[];
}

export interface WhatsAppEvent {
  at: number;
  dir: 'in' | 'out' | 'info';
  text: string;
  /** Name of the chat it came from or went to. */
  chat?: string;
}

/** Remote control from a phone on the same network (a page served by the app). */
export interface PhoneStatus {
  running: boolean;
  /** Address to open on the phone (http://<LAN IP>:<port>). */
  url?: string;
  /** Code the phone asks for once; changes after too many wrong tries. */
  pin?: string;
  /** Phones paired since it started. */
  phones: number;
  /** Access from anywhere (a Cloudflare tunnel), when it was turned on. */
  remote?: {
    /** Link to open on the phone from any network (carries the pairing key after #). */
    url?: string;
    /** What it is doing while it starts (downloading, connecting). */
    progress?: string;
    error?: string;
  };
  error?: string;
}

/** What the phone shows: the chats of the window and the one being controlled. */
export interface PhoneSnapshot {
  chats: { id: string; title: string; busy: boolean; waiting: boolean }[];
  chatId: string;
  agent: boolean;
  busy: boolean;
  turns: {
    role: 'user' | 'assistant';
    text: string;
    error?: string;
    tools: { id: string; title: string; status: 'running' | 'approval' | 'ok' | 'error' }[];
  }[];
}

/** A git repository of this computer, as the phone lists it (to pull it from anywhere). */
export interface PhoneRepo {
  path: string;
  name: string;
  branch: string;
  /** Files changed and not committed. */
  changes: number;
  /** Commits not pushed / not pulled yet (against the upstream, as of the last fetch). */
  ahead: number;
  behind: number;
  /** It is the folder open in the window the phone controls. */
  open: boolean;
  error?: string;
}

/** Chat apps that can control Zinarix through an official bot (see Settings → Phone). */
export type BotKind = 'telegram' | 'discord';

export interface BotView {
  /** A token is saved (it connects whenever the phone remote is on). */
  saved: boolean;
  connected: boolean;
  /** The bot's user name (@name on Telegram). */
  name?: string;
  /** Discord: link to add the bot to a server (DMs need a server in common). */
  invite?: string;
  /** Chats linked with the PIN. */
  paired: number;
  error?: string;
}

export type BotsStatus = Record<BotKind, BotView>;

export type PhoneAction =
  | { kind: 'send'; text: string }
  | { kind: 'decide'; toolCallId: string; decision: 'approve' | 'deny' }
  | { kind: 'stop' }
  | { kind: 'select'; chatId: string }
  | { kind: 'newChat' }
  | { kind: 'agent'; on: boolean };

/** An MCP server of the global config or of the open project (Settings → MCP). */
export interface McpServerView {
  id: string;
  name: string;
  scope: 'global' | 'project';
  kind: 'stdio' | 'http';
  target: string;
  state: 'off' | 'connecting' | 'connected' | 'error' | 'untrusted';
  error?: string;
  tools: { name: string; description?: string }[];
  disabled: boolean;
}

/** The open project's MCP file (.zinarix/mcp.json or .cursor/mcp.json). */
export interface McpProjectView {
  root: string;
  file: string | null;
  trusted: boolean;
  errors: string[];
}

export interface OmniApi {
  /** Panel de Edición: the visual editor of the open folder's pages. */
  design: {
    open(): Promise<DesignSessionView>;
    close(): Promise<void>;
    apply(op: DesignOp): Promise<DesignApplyResult>;
    undo(): Promise<DesignApplyResult | null>;
    redo(): Promise<DesignApplyResult | null>;
    /** The page changed on disk since the preview loaded it. */
    stale(file: string): Promise<boolean>;
    /**
     * How a framework project is shown: its dev server at `url` (live), its built files
     * (built) or nothing yet (none). `dir` is the app's folder ("" = the project).
     */
    show(how: { mode: 'live' | 'built' | 'none'; dir: string; url?: string }): Promise<DesignSessionView>;
    /** Address of a dev server answering on this computer, the app's usual one first. */
    detect(dir: string): Promise<string | null>;
  };
  mcp: {
    status(): Promise<{ servers: McpServerView[]; project: McpProjectView | null }>;
    /** Text of the global mcp.json. */
    config(): Promise<string>;
    /** Saves the global mcp.json; returns the problems found in it. */
    saveConfig(text: string): Promise<{ errors: string[] }>;
    restart(id: string): Promise<void>;
    setEnabled(name: string, on: boolean): Promise<void>;
    /** Trusts (runs) or stops trusting the open project's MCP file. */
    trustProject(on: boolean): Promise<void>;
  };
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
    readBytes(path: string, offset: number, length: number): Promise<FileBytes>;
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
    /** Moves a saved conversation to another folder (project). */
    moveConversation(id: string, folder: string): Promise<void>;
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
    /** Predicts the next edit near the cursor (null = no suggestion). */
    nextEdit(requestId: string, req: NextEditRequestView): Promise<NextEditResultView>;
    /** Fase 8: what the user did with a suggestion (feeds the acceptance metric). */
    suggestionOutcome(
      kind: 'inline' | 'nextEdit',
      outcome: 'accepted' | 'dismissed',
      count: number,
    ): Promise<void>;
    /** Acceptance rate and latency (p50 / p90) per suggestion kind and model. */
    suggestionStats(): Promise<SuggestionStatsRow[]>;
    suggestionStatsClear(): Promise<void>;
    /** Fase 8: content of an @git / @web mention ("@git:HEAD~1", "@web:https://…"). */
    mention(kind: 'git' | 'web', arg: string | null): Promise<string>;
    /** Commit message for the staged changes (or all changes when nothing is staged). */
    commitMessage(): Promise<string>;
    /** Project rules file in use (.zinarix/rules.md, AGENTS.md…) or null. */
    rulesFile(folder?: string): Promise<string | null>;
    /** Project rules that would enter a message with this context ("file:path" sources). */
    activeRules(sources: string[], prompt?: string, folder?: string): Promise<ActiveRulesView>;
    /** Subagents, skills, "/" commands and hooks of the project and the user. */
    agentKit(folder?: string): Promise<AgentKitView>;
    /** New subagent / skill / command file from a template; returns its project path. */
    createKitFile(
      kind: 'agent' | 'skill' | 'command',
      name: string,
      folder?: string,
    ): Promise<string>;
    /** Forget the agent's model-side transcript (regenerate / edit a message); keeps undo data. */
    resetContext(conversationId: string): Promise<void>;
    chat(requestId: string, req: ChatRequestView): Promise<void>;
    edit(requestId: string, req: EditRequestView): Promise<void>;
    abort(requestId: string): Promise<void>;
    toolDecision(requestId: string, toolCallId: string, decision: ToolDecision): Promise<void>;
    /** The user's answer to an ask_user question (Fase 3); null = skipped. */
    answerQuestion(requestId: string, toolCallId: string, answer: string[] | null): Promise<void>;
    /** Undo every file change the agent made in a conversation. Returns restored paths. */
    revert(conversationId: string, folder?: string): Promise<string[]>;
    /** "Volver aquí": undo the file changes of these exchanges (request ids) and later ones. */
    rewind(conversationId: string, turns: string[], folder?: string): Promise<string[]>;
    /** What `rewind` would write back, without doing it. */
    rewindPreview(
      conversationId: string,
      turns: string[],
      folder?: string,
    ): Promise<RewindFileView[]>;
    /** Drops the saved conversation from its n-th user message (0-based) on. */
    rewindConversation(conversationId: string, userIndex: number): Promise<number>;
    /** Files one exchange changed: content before it and now (null = missing). */
    turnDiff(conversationId: string, turn: string, folder?: string): Promise<TurnDiffFileView[]>;
    /**
     * Put back the rejected blocks (hunk numbers) of that exchange in one file, keeping later
     * changes. Returns the new content (null = it deleted a file the exchange created).
     */
    applyReview(
      conversationId: string,
      turn: string,
      path: string,
      rejected: number[],
      folder?: string,
    ): Promise<string | null>;
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
  gcloud: {
    status(): Promise<GCloudStatus>;
    /** "Sign in with Google" in the browser with access to Google Cloud. */
    login(): Promise<GCloudStatus>;
    /** Turns on the APIs Zinarix uses that the project has off; returns the ones turned on. */
    prepare(project: string): Promise<string[]>;
    useAccount(id: string): Promise<GCloudStatus>;
    logout(id?: string): Promise<GCloudStatus>;
    projects(): Promise<GCloudProject[]>;
    /** Enabled APIs of a project, or every API Google offers (all = true). */
    services(project: string, all: boolean): Promise<GCloudService[]>;
    setService(project: string, service: string, enable: boolean): Promise<void>;
    datasets(project: string): Promise<GCloudDataset[]>;
    tables(project: string, dataset: string): Promise<GCloudTable[]>;
    query(project: string, sql: string): Promise<GCloudQueryResult>;
    buckets(project: string): Promise<GCloudBucket[]>;
    objects(bucket: string, prefix: string): Promise<GCloudObject[]>;
    sqlInstances(project: string): Promise<GCloudSqlInstance[]>;
    sqlPower(project: string, instance: string, on: boolean): Promise<void>;
    logs(project: string, filter: string): Promise<GCloudLogEntry[]>;
    /** Compute Engine, Cloud Run, Functions, GKE, Pub/Sub, Secret Manager, Firestore or IAM. */
    resources(project: string, kind: GCloudResourceKind): Promise<GCloudResource[]>;
    /** Starts or stops a Compute Engine VM. */
    vmPower(project: string, zone: string, name: string, on: boolean): Promise<void>;
  };
  vercel: {
    status(): Promise<VercelStatus>;
    /** Saves an access token (encrypted with the OS keychain) and returns the new status. */
    setToken(token: string): Promise<VercelStatus>;
    /** Switches to another connected account. */
    useAccount(id: string): Promise<VercelStatus>;
    /** Forgets one account (the active one when no id is given). */
    logout(id?: string): Promise<VercelStatus>;
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
    /** Makes a deployment the production one (instant rollback). */
    promote(projectId: string, deploymentId: string, teamId: string | null): Promise<void>;
    removeDeployment(deploymentId: string, teamId: string | null): Promise<void>;
    /** Creates or replaces an environment variable for the given targets. */
    setEnv(
      projectId: string,
      teamId: string | null,
      key: string,
      value: string,
      targets: string[],
    ): Promise<void>;
    deleteEnv(projectId: string, teamId: string | null, envId: string): Promise<void>;
    addDomain(projectId: string, teamId: string | null, name: string): Promise<void>;
    removeDomain(projectId: string, teamId: string | null, name: string): Promise<void>;
    /** Checks the domain's DNS again; true when it is verified now. */
    verifyDomain(projectId: string, teamId: string | null, name: string): Promise<boolean>;
    settings(projectId: string, teamId: string | null): Promise<VercelSettings>;
    /** Changes build settings; an empty value goes back to the framework default. */
    updateSettings(
      projectId: string,
      teamId: string | null,
      patch: Partial<VercelSettings>,
    ): Promise<void>;
  };
  mail: {
    status(): Promise<MailStatus>;
    /** IMAP/SMTP servers of a known provider for this address (null when unknown). */
    preset(email: string): Promise<MailAccount | null>;
    /** Checks both servers, then saves the account (password in the OS keychain). */
    connect(account: MailAccount, password: string): Promise<MailStatus>;
    /** An OAuth client is set up for "Sign in with Google" (saved, or from the environment). */
    googleReady(): Promise<boolean>;
    /** Saves the user's Google OAuth client (Google Cloud → Credentials → Desktop app). */
    setGoogleClient(clientId: string, clientSecret: string): Promise<void>;
    /** Signs in with Google in the browser and connects that Gmail mailbox (no app password). */
    googleLogin(name?: string): Promise<MailStatus>;
    /** Switches the panel to another connected mailbox. */
    useAccount(email: string): Promise<MailStatus>;
    /** Forgets one mailbox (the active one when no address is given). */
    logout(email?: string): Promise<MailStatus>;
    folders(): Promise<MailFolderView[]>;
    /** Page 0 = newest messages; `query` searches sender, recipient and subject. */
    list(folder: string, page: number, query: string): Promise<MailListView>;
    /** Downloads the message and marks it read. */
    open(folder: string, uid: number): Promise<MailMessageView>;
    setFlag(folder: string, uid: number, flag: 'seen' | 'flagged', on: boolean): Promise<void>;
    trash(folder: string, uid: number): Promise<void>;
    /** Moves a message to the inbox, spam, trash or archive. */
    move(folder: string, uid: number, to: MailTarget): Promise<void>;
    send(draft: MailDraft): Promise<void>;
    /** Saves the draft in the Drafts folder (replacing `draftUid`); returns its new UID if known. */
    saveDraft(draft: MailDraft): Promise<number | null>;
    /** Deletes a saved draft for good. */
    deleteDraft(uid: number): Promise<void>;
    /** Asks where to save an attachment of the open message. Returns the path (null: cancelled). */
    saveAttachment(folder: string, uid: number, index: number): Promise<string | null>;
  };
  cloud: {
    status(): Promise<CloudSyncStatus>;
    /** Links a project of a connected Supabase account with the sync passphrase. */
    connect(account: string | null, ref: string, passphrase: string): Promise<CloudSyncStatus>;
    /** Unlinks this PC (nothing is deleted, here or in Supabase). */
    disconnect(): Promise<CloudSyncStatus>;
    syncNow(): Promise<CloudSyncStatus>;
  };
  supabase: {
    status(): Promise<SupabaseStatus>;
    /** Saves a personal access token (encrypted with the OS keychain). */
    setToken(token: string): Promise<SupabaseStatus>;
    /** Switches to another connected account. */
    useAccount(id: string): Promise<SupabaseStatus>;
    /** Forgets one account (the active one when no id is given). */
    logout(id?: string): Promise<SupabaseStatus>;
    /** Project ref of the open folder (supabase/.temp/project-ref, written by "supabase link"). */
    linked(): Promise<string | null>;
    projects(): Promise<SupabaseProjectView[]>;
    health(ref: string): Promise<SupabaseHealthView[]>;
    tables(ref: string): Promise<SupabaseTableView[]>;
    /** One page of 100 rows. */
    preview(ref: string, schema: string, table: string, page: number): Promise<SupabaseQueryResult>;
    /** Runs SQL on the project's database. */
    query(ref: string, sql: string): Promise<SupabaseQueryResult>;
    functions(ref: string): Promise<SupabaseFunctionView[]>;
    buckets(ref: string): Promise<SupabaseBucketView[]>;
    restore(ref: string): Promise<void>;
    pause(ref: string): Promise<void>;
    columns(ref: string, schema: string, table: string): Promise<SupabaseColumnView[]>;
    setRls(ref: string, schema: string, table: string, on: boolean): Promise<void>;
    users(ref: string): Promise<SupabaseUserView[]>;
    userCount(ref: string): Promise<number>;
    migrations(ref: string): Promise<SupabaseMigrationView[]>;
    /** Files of a storage bucket. */
    files(ref: string, bucket: string): Promise<SupabaseQueryResult>;
    apiInfo(ref: string): Promise<SupabaseApiInfo>;
    deleteFunction(ref: string, slug: string): Promise<void>;
    deleteUser(ref: string, id: string): Promise<void>;
    /** Names of the Edge Function secrets. */
    secrets(ref: string): Promise<string[]>;
    setSecret(ref: string, name: string, value: string): Promise<void>;
    deleteSecret(ref: string, name: string): Promise<void>;
    authConfig(ref: string): Promise<SupabaseAuthConfig>;
    setAuthConfig(ref: string, config: SupabaseAuthConfig): Promise<void>;
    backups(ref: string): Promise<SupabaseBackupsView>;
    emailConfig(ref: string): Promise<SupabaseEmailConfig>;
    /** null switches back to Supabase's built-in mailer. */
    setSmtp(ref: string, smtp: SupabaseSmtpConfig | null, rateLimit: number | null): Promise<void>;
    setEmailTemplate(
      ref: string,
      kind: SupabaseEmailKind,
      subject: string,
      content: string,
    ): Promise<void>;
    /** Sends an auth email (invite, magic link, password reset) to an address. */
    sendEmail(
      ref: string,
      kind: 'invite' | 'magiclink' | 'recovery',
      email: string,
      redirectTo: string,
    ): Promise<void>;
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
    stop(tabId: string | null): Promise<void>;
    /** History of the user's own tabs, newest first; query filters by title or address. */
    history(query: string, limit?: number): Promise<BrowserHistoryView>;
    /** Address bar suggestions from the bookmarks and the history. */
    suggest(query: string): Promise<BrowserHistoryView>;
    /** Removes one address from the history, or all of it (url null). */
    forget(url: string | null): Promise<void>;
    bookmarks(): Promise<BrowserHistoryView>;
    /** Adds the page to the bookmarks or removes it; returns whether it is bookmarked now. */
    toggleBookmark(url: string, title: string): Promise<boolean>;
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
  /** The Watcher: an always-on reviewer that spends tokens only now and then. */
  knowledge: {
    memories(): Promise<MemoryView[]>;
    addMemory(text: string, scope: 'global' | 'project'): Promise<MemoryView>;
    updateMemory(id: string, text: string): Promise<boolean>;
    removeMemory(id: string): Promise<boolean>;
    docs(): Promise<DocSourceView[]>;
    addDocs(name: string, url: string): Promise<DocSourceView>;
    removeDocs(id: string): Promise<void>;
    reindexDocs(id: string): Promise<void>;
    /** Searches this window's project by meaning (embeddings, or BM25 without them). */
    search(
      query: string,
      limit?: number,
    ): Promise<{
      hits: KnowledgeHit[];
      semantic: boolean;
      files: number;
      chunks?: number;
      embedded?: number;
      ignored?: number;
    }>;
    /** Best passages of the indexed docs (one source by name, or all). */
    searchDocs(query: string, source?: string): Promise<KnowledgeHit[]>;
    embedModel(): Promise<string | null>;
    setEmbedModel(ref: string | null): Promise<void>;
  };
  watch: {
    status(): Promise<WatchStatus>;
    configure(patch: Partial<WatchSettings>): Promise<WatchStatus>;
    /** Reviews this window's project now (even when nothing changed). */
    runNow(): Promise<WatchStatus>;
    /** Marks every report as seen (the badge goes away). */
    seen(): Promise<WatchStatus>;
    dismiss(id: string): Promise<WatchStatus>;
  };
  /** Debugger (DAP adapters, or Node's inspector). One session per window. */
  debug: {
    configs(file?: string): Promise<DebugConfigList>;
    /** config null = debug the given file with its default configuration. */
    start(
      config: DebugConfig | null,
      file: string | undefined,
      breakpoints: Record<string, Breakpoint[]>,
    ): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    continue(): Promise<void>;
    pause(): Promise<void>;
    step(kind: 'over' | 'into' | 'out'): Promise<void>;
    scopes(frameId: number): Promise<DebugVariable[]>;
    variables(ref: number): Promise<DebugVariable[]>;
    evaluate(expression: string, frameId?: number): Promise<DebugVariable>;
    setBreakpoints(path: string, breakpoints: Breakpoint[]): Promise<void>;
    /** Debugs a test (or a describe / file) of the Test Explorer with its runner. */
    startTest(req: TestRunRequest, breakpoints: Record<string, Breakpoint[]>): Promise<void>;
  };
  /** Test Explorer: Vitest, Jest and Pytest. One run at a time per window. */
  tests: {
    discover(): Promise<TestDiscovery>;
    run(req: TestRunRequest): Promise<TestRunSummary>;
    cancel(): Promise<void>;
    /** Merged results of the last runs in this folder (null = never run); kept between sessions. */
    last(): Promise<TestRunSummary | null>;
    /** Forgets the saved results of this folder. */
    clear(): Promise<void>;
  };
  /** Extensions from Open VSX (themes, snippets, languages). */
  extensions: {
    search(query: string): Promise<ExtensionSearchItem[]>;
    icon(url: string): Promise<string | null>;
    install(namespace: string, name: string): Promise<InstalledExtension>;
    uninstall(id: string): Promise<void>;
    list(): Promise<InstalledExtension[]>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
  };
  app: {
    prefs(): Promise<Prefs>;
    setPrefs(patch: Partial<Prefs>): Promise<Prefs>;
    openExternal(url: string): Promise<void>;
    /**
     * Opens an http(s) link in the built-in browser (a tab of the user's own). A few sites
     * that refuse embedded browsers (Google sign-in, payments) open in the system browser.
     */
    openLink(url: string): Promise<void>;
    /** Closes this window (after the unsaved-changes check); the app quits with the last one. */
    quit(): Promise<void>;
    /**
     * Opens the app when the user logs in (on) while a chat was left working, so a task cut by
     * a shutdown goes on by itself; off when nothing is pending.
     */
    resumeOnLogin(on: boolean): Promise<void>;
    /**
     * Conversations whose agent run the last shutdown cut (their progress is in the history
     * already). Told once: later calls get an empty list.
     */
    interruptedRuns(): Promise<string[]>;
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
    /**
     * Fase 18: colors of the theme's bar for the system's − □ × buttons; main also sets
     * Mica / vibrancy (or takes it off: setting, high contrast) and says what it applied.
     */
    chrome(colors: { bg: string; fg: string; dark: boolean }): Promise<ChromeState>;
    /** Labels of the app menu (Archivo, Editar…), drawn in our title bar. */
    menuBar(): Promise<string[]>;
    /** Opens one menu of the app menu below its label (x, y in CSS pixels of the page). */
    popupMenu(index: number, x: number, y: number): Promise<void>;
  };
  phone: {
    status(): Promise<PhoneStatus>;
    /** Starts the phone remote for this window (the phone controls its chats). */
    start(): Promise<PhoneStatus>;
    stop(): Promise<PhoneStatus>;
    /** Turns access from anywhere on or off (the remote must be running). */
    remote(on: boolean): Promise<PhoneStatus>;
    /** What the phone should show now (sent while the remote runs). */
    push(snapshot: PhoneSnapshot): Promise<void>;
  };
  bots: {
    status(): Promise<BotsStatus>;
    /** Saves the bot token and connects it (only while the phone remote runs). */
    connect(kind: BotKind, token: string): Promise<BotsStatus>;
    /** Disconnects the bot and forgets its token and linked chats. */
    disconnect(kind: BotKind): Promise<BotsStatus>;
  };
  whatsapp: {
    status(): Promise<WhatsAppStatus>;
    /** Where the page goes (CSS px of the window); null hides it. */
    setBounds(rect: { x: number; y: number; width: number; height: number } | null): Promise<void>;
    reload(): Promise<void>;
    control(on: boolean): Promise<WhatsAppStatus>;
    /** The chat open now is allowed to control Zinarix. */
    useCurrent(): Promise<WhatsAppStatus>;
    /** Whose messages of an allowed chat are orders. */
    who(id: string, who: WhatsAppWho): Promise<WhatsAppStatus>;
    /** The chat stops controlling Zinarix. */
    remove(id: string): Promise<WhatsAppStatus>;
    /** Writes a test message in an allowed chat (the first one when not given). */
    test(id?: string): Promise<WhatsAppStatus>;
    forget(): Promise<WhatsAppStatus>;
  };
  license: {
    status(): Promise<LicenseStatus>;
    /** A signed license key (ZX1.…). Throws with a readable reason. */
    activate(key: string): Promise<LicenseStatus>;
    remove(): Promise<LicenseStatus>;
  };
  lsp: {
    open(path: string, language: string, text: string): Promise<LspStatus | null>;
    change(path: string, text: string): Promise<void>;
    save(path: string): Promise<void>;
    close(path: string): Promise<void>;
    request(path: string, method: string, params: unknown): Promise<unknown>;
    applyEditResult(id: number, applied: boolean): Promise<void>;
    statuses(): Promise<LspStatus[]>;
    restart(): Promise<void>;
  };
  video: {
    tools(): Promise<{ ffmpeg: boolean; version: string | null }>;
    /** File dialog for media to import (absolute paths). */
    pickMedia(): Promise<string[]>;
    probe(path: string): Promise<MediaItem & { url: string }>;
    /** Fase 12: file dialog for a .cube LUT (absolute path, null when canceled). */
    pickLut(): Promise<string | null>;
    /** The text of a .cube LUT (refused when it is not a valid 3D LUT). */
    readLut(path: string): Promise<string>;
    /** Absolute path of a file of the open folder (the explorer gives relative ones). */
    workspacePath(rel: string): Promise<string | null>;
    mediaUrl(path: string): Promise<string | null>;
    thumbnails(path: string, duration: number, count: number): Promise<string>;
    waveform(path: string): Promise<{ peaksPerSecond: number; peaks: number[] }>;
    /** Saves (asking where when there is no path or saveAs); null when canceled. */
    saveProject(
      project: VideoProject,
      path: string | null,
      saveAs: boolean,
    ): Promise<string | null>;
    /** Opens a .zvproj (asking which when no path); media paths come back absolute. */
    openProject(path: string | null): Promise<{ path: string; project: VideoProject } | null>;
    /** Crash recovery copy (null clears it). */
    autosave(project: VideoProject | null, path: string | null): Promise<void>;
    recover(): Promise<{ project: VideoProject; path: string | null; savedAt: number } | null>;
    /** Picks a new file for a missing media item. */
    relink(name: string): Promise<string | null>;
    exportPath(name: string): Promise<string | null>;
    /** `texts`: clip id → PNG data URL of each title, drawn at the export size. */
    export(
      project: VideoProject,
      options: ExportOptions,
      out: string,
      texts?: Record<string, string>,
    ): Promise<VideoJobView>;
    jobs(): Promise<VideoJobView[]>;
    cancel(id: string): Promise<void>;
    reveal(path: string): Promise<void>;
    cacheSize(): Promise<number>;
    clearCache(): Promise<void>;
    /** Fase 13: speech-to-text engines (whisper.cpp here, or a connected provider). */
    sttEngines(): Promise<SttEngineView[]>;
    /** Transcribes a media file with word times; `requestId` lets sttAbort() stop it. */
    transcribe(
      requestId: string,
      path: string,
      engine: SttEngineId,
      duration: number,
      lang?: string,
    ): Promise<Transcript>;
    sttAbort(requestId: string): Promise<void>;
    /** Silent ranges of a file's audio, in seconds of the file. */
    silences(
      path: string,
      duration: number,
      noiseDb: number,
      minDur: number,
    ): Promise<[number, number][]>;
    /** Where new scenes start, in seconds of the file. */
    scenes(path: string, duration: number, threshold: number): Promise<number[]>;
    /** Save dialog for an .srt / .vtt; returns the path (null when canceled). */
    saveCaptions(name: string, text: string, ext: 'srt' | 'vtt'): Promise<string | null>;
    /** Fase 13B: answer to a 'video:agent' event. */
    agentDone(requestId: string, r: VideoAgentResult): Promise<void>;
  };
  /** Ayuda de Zinarix: the help assistant (a small local model that knows the app). */
  helper: {
    status(): Promise<HelperStatus>;
    /** Streams the answer as 'helper' events; `cloud` uses the selected cloud model instead. */
    ask(
      requestId: string,
      req: {
        question: string;
        history: { role: 'user' | 'assistant'; content: string }[];
        cloud?: boolean;
      },
    ): Promise<void>;
    /** Downloads the model in Ollama ('helper:pull' events); resolves when it ends. */
    pull(requestId: string, model: string): Promise<void>;
    abort(requestId: string): Promise<void>;
  };
  /** Fase 5: background tasks, each in a git worktree of its own. */
  /** Fase 6: AI code review of local changes, a branch or a pull request. */
  review: {
    run(requestId: string, req: ReviewRequestView): Promise<ReviewView>;
    abort(requestId: string): Promise<void>;
    /** Open pull requests of the folder's repository (through gh). */
    prs(): Promise<ReviewPrView[]>;
    /** How the chosen findings would be published (inline comments vs. the review body). */
    preview(reviewId: string, ids: string[]): Promise<ReviewPublishPreview>;
    /** Saved reviews of the folder, newest first. */
    history(): Promise<ReviewHistoryView[]>;
    get(reviewId: string): Promise<ReviewView>;
    delete(reviewId: string): Promise<void>;
    /** Marks findings "not a problem" in .zinarix/review-ignore.json; returns the updated review. */
    ignore(reviewId: string, ids: string[], reason?: string): Promise<ReviewView>;
    /** Posts the chosen findings as one review on the PR. Returns its URL. */
    publish(reviewId: string, ids: string[]): Promise<string>;
  };
  /** Fase 10: image, video and speech generation with the connected providers. */
  media: {
    models(): Promise<GenModelView[]>;
    estimate(req: GenRequest): Promise<GenEstimate>;
    /** Folder where generated files are saved (project media/generated or app data). */
    outDir(): Promise<string>;
    /** Progress arrives as 'media' events; resolves with the saved files. */
    generate(requestId: string, req: GenRequest): Promise<GenResult>;
    abort(requestId: string): Promise<void>;
  };
  /** Fase 14: 3D scenes rendered to video (viewer frames or Blender). */
  scene3d: {
    /** Blender found on this machine (null: not installed or older than 3.6) and the output folder. */
    info(
      refresh?: boolean,
    ): Promise<{ blender: { path: string; version: string } | null; outDir: string }>;
    /** Starts encoding viewer frames; then frame() each RGBA frame and end(). */
    begin(o: {
      width: number;
      height: number;
      fps: number;
      format: Render3DFormat;
      name: string;
    }): Promise<{ id: string; path: string }>;
    frame(id: string, rgba: Uint8Array): Promise<void>;
    end(id: string): Promise<Render3DResult>;
    /** Stops a viewer encode or a Blender render (and deletes the half-written file). */
    cancel(id: string): Promise<void>;
    /** Renders with Blender; progress arrives as 'scene3d' events with the same id. */
    blender(
      id: string,
      scene: Scene3D,
      o: { engine: BlenderEngine; format: Render3DFormat; name: string; samples?: number },
    ): Promise<Render3DResult>;
    /** File dialog for a .glb/.gltf/.obj/.fbx; returns its path and a URL the viewer can load. */
    pickModel(): Promise<{ path: string; url: string } | null>;
    /** URL for a model a scene names (null when the file is gone or not a model). */
    modelUrl(path: string): Promise<string | null>;
    save(scene: Scene3D, path: string | null, saveAs: boolean): Promise<string | null>;
    open(): Promise<{ scene: Scene3D; path: string } | null>;
    /** Answer to a 'scene3d:agent' event. */
    /** Also answers a 'scene3d:edit' event (ok, content, summary). */
    agentDone(
      requestId: string,
      r: { path: string } | { error: string } | { ok: boolean; content: string; summary: string },
    ): Promise<void>;
  };
  /** Fase 14: 3D models generated from text or a picture (Replicate). */
  gen3d: {
    info(): Promise<{ connected: boolean; models: Gen3DModel[]; outDir: string }>;
    /** File dialog for the reference picture (PNG, JPEG, WebP). */
    pickImage(): Promise<string | null>;
    /** Progress arrives as 'gen3d' events; resolves with the saved model and its viewer URL. */
    generate(
      requestId: string,
      req: Gen3DRequest,
    ): Promise<{ path: string; url: string; warnings: string[]; ms: number }>;
    abort(requestId: string): Promise<void>;
  };
  /** Fase 9: model playground (one model or 2–4 side by side). */
  playground: {
    run(requestId: string, req: PlaygroundRunRequest): Promise<PlaygroundResult>;
    abort(requestId: string): Promise<void>;
    /** The same request as code for the model's provider (key read from its env var). */
    code(lang: CodeLang, req: PlaygroundRunRequest): Promise<string>;
    /** Catalog adapter of the model's provider (which attachments it takes). */
    adapter(model: string): Promise<string | null>;
    templates(): Promise<PromptTemplate[]>;
    /** New version of template `id`, or a new template named `name`. */
    saveTemplate(
      params: PlaygroundParams,
      opts: { id?: string; name?: string; model?: string; note?: string },
    ): Promise<PromptTemplate>;
    deleteTemplate(id: string): Promise<void>;
  };
  /** Fase 9: "describe your app" → a folder the agent fills, previewed and deployed. */
  build: {
    defaultParent(): Promise<string>;
    pickParent(): Promise<string | null>;
    create(parent: string, description: string): Promise<BuildView>;
    /** Build data of the window's open folder (null when it was not made with Build). */
    info(): Promise<BuildView | null>;
    recent(): Promise<BuildView[]>;
    /** Publishes the open folder to Vercel. */
    deploy(teamId: string | null, production: boolean): Promise<BuildDeployView>;
    deployState(id: string, teamId: string | null): Promise<string>;
  };
  tasks: {
    status(): Promise<TasksStatusView>;
    /** Queues a task on the window's folder (or `folder`). */
    create(req: TaskCreateView): Promise<TaskView>;
    /** The repository's .zinarix/worktree-setup script, to show it before running it. */
    setupScript(folder?: string): Promise<string | null>;
    decide(id: string, toolCallId: string, decision: ToolDecision): Promise<void>;
    /** Answers a task's ask_user question (null = let the agent decide). */
    answer(id: string, toolCallId: string, answer: string[] | null): Promise<void>;
    pause(id: string): Promise<void>;
    cancel(id: string): Promise<void>;
    /** Interrupted / paused / failed: go on; done: a follow-up (`prompt`). */
    resume(id: string, prompt?: string): Promise<void>;
    merge(id: string): Promise<{ ok: true } | { ok: false; reason: string; files?: string[] }>;
    resolveWithAgent(id: string): Promise<void>;
    /** git push + gh pr create; returns the PR URL. */
    openPr(id: string): Promise<string>;
    keep(id: string): Promise<void>;
    discard(id: string): Promise<void>;
    clearClosed(): Promise<void>;
    openFolder(id: string): Promise<void>;
    /** A kept task gets its worktree back. */
    reopen(id: string): Promise<void>;
    /** Frees the worktrees of every idle task (work committed, branches kept); how many. */
    archiveIdle(): Promise<number>;
    /** Disk taken by the worktrees (cached a minute unless `fresh`). */
    usage(fresh?: boolean): Promise<TasksUsageView>;
  };
  on(listener: (ev: AppEvent) => void): () => void;
}

export interface VideoJobView {
  id: string;
  name: string;
  out: string;
  state: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  progress: number;
  eta: number | null;
  error?: string;
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
  'workspace:readBytes',
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
  'ai:moveConversation',
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
  'ai:answerQuestion',
  'ai:revert',
  'ai:rewind',
  'ai:rewindPreview',
  'ai:rewindConversation',
  'ai:turnDiff',
  'ai:applyReview',
  'ai:complete',
  'ai:commitMessage',
  'ai:rulesFile',
  'ai:activeRules',
  'ai:agentKit',
  'ai:createKitFile',
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
  'gcloud:status',
  'gcloud:login',
  'gcloud:prepare',
  'gcloud:useAccount',
  'gcloud:logout',
  'gcloud:projects',
  'gcloud:services',
  'gcloud:setService',
  'gcloud:datasets',
  'gcloud:tables',
  'gcloud:query',
  'gcloud:buckets',
  'gcloud:objects',
  'gcloud:sqlInstances',
  'gcloud:sqlPower',
  'gcloud:logs',
  'gcloud:resources',
  'gcloud:vmPower',
  'vercel:status',
  'vercel:setToken',
  'vercel:logout',
  'vercel:useAccount',
  'vercel:linked',
  'vercel:projects',
  'vercel:project',
  'vercel:deployments',
  'vercel:logs',
  'vercel:cancel',
  'vercel:redeploy',
  'vercel:promote',
  'vercel:removeDeployment',
  'vercel:setEnv',
  'vercel:deleteEnv',
  'vercel:addDomain',
  'vercel:removeDomain',
  'vercel:verifyDomain',
  'vercel:settings',
  'vercel:updateSettings',
  'mail:status',
  'mail:preset',
  'mail:connect',
  'mail:googleReady',
  'mail:setGoogleClient',
  'mail:googleLogin',
  'mail:logout',
  'mail:useAccount',
  'mail:folders',
  'mail:list',
  'mail:open',
  'mail:setFlag',
  'mail:trash',
  'mail:move',
  'mail:saveDraft',
  'mail:deleteDraft',
  'mail:send',
  'mail:saveAttachment',
  'cloud:status',
  'cloud:connect',
  'cloud:disconnect',
  'cloud:syncNow',
  'supabase:status',
  'supabase:setToken',
  'supabase:logout',
  'supabase:useAccount',
  'supabase:linked',
  'supabase:projects',
  'supabase:health',
  'supabase:tables',
  'supabase:preview',
  'supabase:query',
  'supabase:functions',
  'supabase:buckets',
  'supabase:restore',
  'supabase:pause',
  'supabase:columns',
  'supabase:setRls',
  'supabase:users',
  'supabase:userCount',
  'supabase:migrations',
  'supabase:files',
  'supabase:apiInfo',
  'supabase:deleteFunction',
  'supabase:deleteUser',
  'supabase:secrets',
  'supabase:setSecret',
  'supabase:deleteSecret',
  'supabase:authConfig',
  'supabase:setAuthConfig',
  'supabase:backups',
  'supabase:emailConfig',
  'supabase:setSmtp',
  'supabase:setEmailTemplate',
  'supabase:sendEmail',
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
  'browser:stop',
  'browser:history',
  'browser:suggest',
  'browser:forget',
  'browser:bookmarks',
  'browser:toggleBookmark',
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
  'app:openLink',
  'app:quit',
  'app:chrome',
  'app:menuBar',
  'app:popupMenu',
  'app:resumeOnLogin',
  'app:interruptedRuns',
  'app:newWindow',
  'app:installUpdate',
  'license:status',
  'license:activate',
  'license:remove',
  'phone:status',
  'phone:start',
  'phone:stop',
  'phone:remote',
  'phone:push',
  'bots:status',
  'bots:connect',
  'bots:disconnect',
  'whatsapp:status',
  'whatsapp:setBounds',
  'whatsapp:reload',
  'whatsapp:control',
  'whatsapp:useCurrent',
  'whatsapp:forget',
  'whatsapp:who',
  'whatsapp:remove',
  'whatsapp:test',
  'watch:status',
  'watch:configure',
  'watch:runNow',
  'watch:seen',
  'watch:dismiss',
  'debug:configs',
  'debug:start',
  'debug:stop',
  'debug:restart',
  'debug:continue',
  'debug:pause',
  'debug:step',
  'debug:scopes',
  'debug:variables',
  'debug:evaluate',
  'debug:setBreakpoints',
  'debug:startTest',
  'tests:discover',
  'tests:run',
  'tests:cancel',
  'tests:last',
  'tests:clear',
  'ext:search',
  'ext:icon',
  'ext:install',
  'ext:uninstall',
  'ext:list',
  'ext:setEnabled',
  'ai:nextEdit',
  'ai:suggestionOutcome',
  'ai:suggestionStats',
  'ai:suggestionStatsClear',
  'ai:mention',
  'lsp:open',
  'lsp:change',
  'lsp:save',
  'lsp:close',
  'lsp:request',
  'lsp:applyEditResult',
  'lsp:statuses',
  'lsp:restart',
  'knowledge:memories',
  'knowledge:addMemory',
  'knowledge:updateMemory',
  'knowledge:removeMemory',
  'knowledge:docs',
  'knowledge:addDocs',
  'knowledge:removeDocs',
  'knowledge:reindexDocs',
  'knowledge:search',
  'knowledge:searchDocs',
  'knowledge:embedModel',
  'knowledge:setEmbedModel',
  'mcp:status',
  'mcp:config',
  'mcp:saveConfig',
  'mcp:restart',
  'mcp:setEnabled',
  'mcp:trustProject',
  'design:open',
  'design:close',
  'design:apply',
  'design:undo',
  'design:redo',
  'design:stale',
  'design:show',
  'design:detect',
  'video:tools',
  'video:pickMedia',
  'video:probe',
  'video:pickLut',
  'video:readLut',
  'video:workspacePath',
  'video:mediaUrl',
  'video:thumbnails',
  'video:waveform',
  'video:saveProject',
  'video:openProject',
  'video:autosave',
  'video:recover',
  'video:relink',
  'video:exportPath',
  'video:export',
  'video:jobs',
  'video:cancel',
  'video:reveal',
  'video:cacheSize',
  'video:clearCache',
  'video:sttEngines',
  'video:transcribe',
  'video:sttAbort',
  'video:silences',
  'video:scenes',
  'video:saveCaptions',
  'video:agentDone',
  'helper:status',
  'helper:ask',
  'helper:pull',
  'helper:abort',
  'tasks:status',
  'tasks:create',
  'tasks:setupScript',
  'tasks:decide',
  'tasks:pause',
  'tasks:cancel',
  'tasks:resume',
  'tasks:merge',
  'tasks:resolveWithAgent',
  'tasks:openPr',
  'tasks:keep',
  'tasks:discard',
  'tasks:clearClosed',
  'tasks:openFolder',
  'tasks:answer',
  'tasks:reopen',
  'tasks:archiveIdle',
  'tasks:usage',
  'review:run',
  'review:abort',
  'review:prs',
  'review:preview',
  'review:publish',
  'review:history',
  'review:get',
  'review:delete',
  'review:ignore',
  'media:models',
  'media:estimate',
  'media:outDir',
  'media:generate',
  'media:abort',
  'scene3d:info',
  'scene3d:begin',
  'scene3d:frame',
  'scene3d:end',
  'scene3d:cancel',
  'scene3d:blender',
  'scene3d:pickModel',
  'scene3d:modelUrl',
  'scene3d:save',
  'scene3d:open',
  'scene3d:agentDone',
  'gen3d:info',
  'gen3d:pickImage',
  'gen3d:generate',
  'gen3d:abort',
  'playground:run',
  'playground:abort',
  'playground:code',
  'playground:adapter',
  'playground:templates',
  'playground:saveTemplate',
  'playground:deleteTemplate',
  'build:defaultParent',
  'build:pickParent',
  'build:create',
  'build:info',
  'build:recent',
  'build:deploy',
  'build:deployState',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const EVENT_CHANNEL = 'omni:event';
