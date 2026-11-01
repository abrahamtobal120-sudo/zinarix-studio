import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, dialog, ipcMain, protocol, shell } from 'electron';
import type { BaseWindow, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { z } from 'zod';
import type { AppEvent, Channel, Prefs, ThemeId, WorkspaceInfo } from '../shared/api.js';
import { DEFAULT_PREFS, EVENT_CHANNEL, THEME_IDS } from '../shared/api.js';
import { AiService } from './ai.js';
import type { Scope } from './ai.js';
import { Git, cloneRepo, githubRepos, githubStatus, publishRepo, repoName } from './git.js';
import { BrowserController } from './browser.js';
import { Supabase, linkedSupabase } from './supabase.js';
import { Vercel, linkedProject } from './vercel.js';
import { isOwnerCode, licenseStatus, normalizeKey, parseLicense } from './license.js';
import type { StoredLicense } from './license.js';
import { startUpdates } from './updates.js';
import { fetchRemote, latestRelease, newer } from './remote.js';
import type { RemoteNotice } from '../shared/plans.js';
import { DOWNLOAD_URL } from '../shared/plans.js';
import {
  auditDependencies,
  checkSite,
  checkSystem,
  fileHash,
  resolveAnyPath,
  runScan,
  scanProject,
} from './security.js';
import { shellProfiles, Terminals } from './terminal.js';
import { Workspace } from './workspace.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..', '..');
const rendererDir = join(appRoot, 'dist', 'renderer');
process.env.OMNI_CATALOG_DIR ??= join(appRoot, 'dist', 'catalog');

app.setName('Zinarix Studio');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
]);

// A separate data folder (OMNI_HOME: portable installs, tests) is a separate app instance.
if (process.env.OMNI_HOME) app.setPath('userData', join(process.env.OMNI_HOME, 'electron'));
// A second launch hands its folder to the running app (see 'second-instance') and exits.
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) app.exit(0);

/**
 * One Zinarix Studio window. Each window has its own open folder, its own browser (with a
 * tab per AI conversation), its own terminals and its own chats; the AI service (models,
 * keys, history, usage) is shared by all of them.
 */
interface Win {
  /** webContents id of the window (how IPC calls find their window). */
  id: number;
  win: BrowserWindow;
  workspace?: Workspace;
  /** Folders of chats that work somewhere else than the open folder (one per path). */
  chatFolders: Map<string, Workspace>;
  browser: BrowserController;
  /** Terminals created by this window (only it may write to them). */
  terminals: Set<number>;
  /** AI requests running for this window (aborted when it closes). */
  requests: Set<string>;
  /** Close confirmed by the renderer (unsaved files / running chats checked). */
  allowClose: boolean;
}

const wins = new Map<number, Win>();
let ai: AiService;
/** Which window each terminal belongs to. */
const termOwner = new Map<number, Win>();
const terminals = new Terminals(
  (id, data) => {
    const w = termOwner.get(id);
    if (w) send(w, { type: 'term:data', id, data });
  },
  (id, code) => {
    const w = termOwner.get(id);
    termOwner.delete(id);
    w?.terminals.delete(id);
    if (w) send(w, { type: 'term:exit', id, code });
  },
);

// ---------------- desktop state (last folder, theme) ----------------

interface DesktopState extends StoredLicense {
  lastFolder?: string;
  recentFolders?: string[];
  theme?: ThemeId;
  prefs?: Partial<Prefs>;
}
const stateFile = () => join(ai.core.paths.home, 'desktop.json');
function loadState(): DesktopState {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8')) as DesktopState;
  } catch {
    return {};
  }
}
function saveState(patch: Partial<DesktopState>): void {
  writeFileSync(stateFile(), JSON.stringify({ ...loadState(), ...patch }, null, 2), {
    mode: 0o600,
  });
}

/** The plan of this installation (trial, Pro, owner or free). */
function license() {
  return licenseStatus(loadState());
}

function planName(): string {
  const l = license();
  return l.plan === 'owner'
    ? 'Pro (dueño)'
    : l.plan === 'pro'
      ? `Pro · ${l.email ?? ''}`
      : l.plan === 'trial'
        ? `Prueba Pro: ${l.trialDaysLeft} días`
        : 'Gratis';
}

/** A Pro feature was asked for on a plan without it: the window explains and offers Pro. */
function upgrade(w: Win | undefined, feature: string): void {
  if (w) send(w, { type: 'command', command: `license.upgrade:${feature}` });
}

function prefs(): Prefs {
  const p = loadState().prefs ?? {};
  return { ...DEFAULT_PREFS, ...p, keybindings: { ...p.keybindings } };
}

function send(w: Win, ev: AppEvent): void {
  if (!w.win.isDestroyed()) w.win.webContents.send(EVENT_CHANNEL, ev);
}

/** Tells the other windows that shared settings (models, keys, theme) changed. */
function broadcastSettings(from: Win): void {
  for (const w of wins.values()) if (w !== from) send(w, { type: 'settings:changed' });
}

/**
 * What the AI sees of a window: its folder and its browser. A chat may work in a folder of
 * its own (`folder`, absolute): the agent then reads, edits and runs commands there.
 */
function scope(w: Win, folder?: string): Scope {
  if (!folder) return { workspace: () => w.workspace, browser: w.browser };
  const abs = resolve(folder);
  if (w.workspace?.root === abs) return { workspace: () => w.workspace, browser: w.browser };
  if (!existsSync(abs) || !statSync(abs).isDirectory())
    throw new Error(`La carpeta del chat ya no existe: ${abs}`);
  let ws = w.chatFolders.get(abs);
  if (!ws) {
    ws = new Workspace(abs);
    w.chatFolders.set(abs, ws);
  }
  const fixed = ws;
  return { workspace: () => fixed, browser: w.browser };
}

/** Request ids come from each renderer: namespaced so two windows never collide. */
const rid = (w: Win, requestId: string) => `${w.id}:${requestId}`;

function winOf(bw: BaseWindow | null | undefined): Win | undefined {
  for (const w of wins.values()) if (w.win === bw) return w;
  return undefined;
}

/** The window the user is working in (for the menu and a second launch). */
function focused(): Win | undefined {
  return winOf(BrowserWindow.getFocusedWindow()) ?? [...wins.values()].at(-1);
}

async function openFolder(w: Win, path: string): Promise<WorkspaceInfo | null> {
  const abs = resolve(path);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return null;
  w.workspace?.dispose();
  const workspace = new Workspace(abs);
  w.workspace = workspace;
  workspace.watch(() => send(w, { type: 'fs:changed' }));
  saveState({
    lastFolder: abs,
    recentFolders: [abs, ...(loadState().recentFolders ?? []).filter((f) => f !== abs)].slice(
      0,
      10,
    ),
  });
  app.addRecentDocument(abs);
  const info = await workspace.info();
  if (!w.win.isDestroyed()) w.win.setTitle(`${info.name} — Zinarix Studio`);
  send(w, { type: 'workspace', workspace: info });
  return info;
}

function folderFromArgv(argv: string[]): string | undefined {
  // Skip electron binary / app path; the first existing directory argument wins.
  const appPath = resolve(app.getAppPath());
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    const p = resolve(a);
    if (p === appPath) continue;
    if (existsSync(p) && statSync(p).isDirectory()) return p;
  }
  return undefined;
}

function ws(w: Win): Workspace {
  if (!w.workspace) throw new Error('No hay carpeta abierta');
  return w.workspace;
}

function git(w: Win): Git {
  return new Git(ws(w));
}

// ---------------- IPC (whitelisted, validated, sender-checked) ----------------

const str = z.string().max(4096);
const rel = z.string().max(4096);
const big = z.string().max(50 * 1024 * 1024);
const id = z.number().int().positive();
/** Conversation ids are full UUIDs (history lookups also match prefixes for the CLI). */
const conv = z.string().uuid();
const dim = z.number().int().min(1).max(1000);
const message = z.union([
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({ role: z.literal('assistant'), content: z.string() }),
]);
const ctx = z.array(z.object({ source: str, content: big })).max(20);

type Handler = (w: Win, ...args: unknown[]) => unknown;
/** Every handler gets the window that called it first, then its validated arguments. */
function handle<A extends z.ZodTuple>(
  channel: Channel,
  schema: A,
  fn: (w: Win, ...args: z.infer<A>) => unknown,
): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!event.senderFrame?.url.startsWith('app://')) throw new Error('untrusted sender');
    const parsed = schema.parse(args);
    const w = wins.get(event.sender.id);
    if (!w) throw new Error('unknown window');
    return (fn as Handler)(w, ...parsed);
  });
}

function registerIpc(): void {
  handle('workspace:current', z.tuple([]), (w) => w.workspace?.info() ?? null);
  handle('workspace:openDialog', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled || !r.filePaths[0] ? null : openFolder(w, r.filePaths[0]);
  });
  handle('workspace:openPath', z.tuple([z.string().min(1).max(4096)]), async (w, p) => {
    const abs = resolve(p);
    if (!existsSync(abs)) return null;
    const isDir = statSync(abs).isDirectory();
    const info = await openFolder(w, isDir ? abs : dirname(abs));
    return info ? { workspace: info, file: isDir ? null : basename(abs) } : null;
  });
  handle('workspace:close', z.tuple([]), (w) => {
    w.workspace?.dispose();
    w.workspace = undefined;
    w.win.setTitle('Zinarix Studio');
    send(w, { type: 'workspace', workspace: null });
  });
  // A folder for one chat only: the window keeps its open folder.
  handle('workspace:pickChatFolder', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Carpeta para este chat',
      properties: ['openDirectory', 'createDirectory'],
    });
    const abs = r.canceled || !r.filePaths[0] ? null : resolve(r.filePaths[0]);
    return abs ? { path: abs, name: basename(abs) } : null;
  });
  handle('workspace:recent', z.tuple([]), () =>
    (loadState().recentFolders ?? [])
      .filter((f) => existsSync(f))
      .map((f) => ({ path: f, name: basename(f) })),
  );
  handle('workspace:readDir', z.tuple([rel]), (w, p) => ws(w).readDir(p));
  handle('workspace:readFile', z.tuple([rel]), (w, p) => ws(w).readFile(p));
  handle('workspace:writeFile', z.tuple([rel, big]), (w, p, c) => ws(w).writeFile(p, c));
  handle('workspace:createFile', z.tuple([rel]), (w, p) => ws(w).createFile(p));
  handle('workspace:createDir', z.tuple([rel]), (w, p) => ws(w).createDir(p));
  handle('workspace:rename', z.tuple([rel, rel]), (w, a, b) => ws(w).rename(a, b));
  handle('workspace:trash', z.tuple([rel]), (w, p) => shell.trashItem(ws(w).resolve(p)));
  handle('workspace:listFiles', z.tuple([]), (w) => ws(w).listFiles());
  handle('workspace:search', z.tuple([str, z.boolean(), z.boolean()]), (w, q, r, c) =>
    ws(w).search(q, r, c),
  );

  handle('ai:providers', z.tuple([]), () => ai.providers());
  handle(
    'ai:saveProvider',
    z.tuple([str, z.string().max(8192).nullable(), z.record(z.string(), z.string().max(512))]),
    async (w, p, k, params) => {
      const r = await ai.saveProvider(p, k, params);
      broadcastSettings(w);
      return r;
    },
  );
  handle('ai:removeProvider', z.tuple([str]), async (w, p) => {
    await ai.removeProvider(p);
    broadcastSettings(w);
  });
  const models = z.array(z.string().min(1).max(200)).max(100).optional();
  handle(
    'ai:addCustomProvider',
    z.tuple([
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('api'),
          name: z.string().min(1).max(80),
          adapter: z.enum(['openai-compatible', 'openai-responses', 'anthropic', 'google-gemini']),
          baseUrl: z.string().url().max(2048),
          authHeader: z.string().max(100).optional(),
          noAuth: z.boolean().optional(),
          local: z.boolean().optional(),
          models,
        }),
        z.object({
          kind: z.literal('cli'),
          name: z.string().min(1).max(80),
          command: z.string().min(1).max(200),
          profile: z.string().min(1).max(40),
          args: z.array(z.string().min(1).max(200)).max(20).optional(),
          models,
        }),
      ]),
      str.optional(),
    ]),
    (w, spec, id) => {
      const out = ai.addCustomProvider(spec, id);
      broadcastSettings(w);
      return out;
    },
  );
  handle('ai:deleteCustomProvider', z.tuple([str]), async (w, p) => {
    await ai.deleteCustomProvider(p);
    broadcastSettings(w);
  });
  handle('ai:models', z.tuple([z.boolean()]), (_w, r) => ai.models(r));
  handle('ai:settings', z.tuple([]), () => ({
    defaultModel: ai.core.config.defaultModel ?? null,
    roles: {
      chat: ai.core.config.roles.chat,
      agent: ai.core.config.roles.agent,
      inline: ai.core.config.roles.inline,
    },
    localOnly: ai.core.config.privacy.localOnly,
    theme: loadState().theme ?? 'dark',
    todayUsd: ai.todayUsd(),
    version: app.getVersion(),
    intro: !process.env.ZINARIX_NO_INTRO,
  }));
  handle('ai:setDefaultModel', z.tuple([str]), (w, r) => {
    ai.setDefaultModel(r);
    broadcastSettings(w);
  });
  handle(
    'ai:setRole',
    z.tuple([z.enum(['chat', 'agent', 'inline']), str.nullable()]),
    (w, role, ref) => {
      ai.setRole(role, ref);
      broadcastSettings(w);
    },
  );
  handle('ai:setLocalOnly', z.tuple([z.boolean()]), (w, on) => {
    ai.setLocalOnly(on);
    broadcastSettings(w);
  });
  handle('ai:setTheme', z.tuple([z.enum(THEME_IDS)]), (w, theme) => {
    saveState({ theme });
    broadcastSettings(w);
  });
  handle(
    'ai:complete',
    z.tuple([
      str,
      z.object({
        path: rel,
        language: z.string().max(64),
        prefix: z.string().max(200_000),
        suffix: z.string().max(200_000),
      }),
    ]),
    (w, requestId, req) => ai.complete(rid(w, requestId), req),
  );
  handle('ai:commitMessage', z.tuple([]), async (w) => {
    const g = git(w);
    const st = await g.status();
    const staged = st.files.some((f) => !f.untracked && f.index !== ' ');
    return ai.commitMessage(await g.patch(staged));
  });
  handle('ai:rulesFile', z.tuple([z.string().min(1).max(4096).optional()]), (w, folder) =>
    ai.rulesFile(scope(w, folder)),
  );
  handle('ai:resetContext', z.tuple([conv]), (_w, c) => ai.resetContext(c));

  const paths = z.array(rel).max(5000);
  handle('git:status', z.tuple([]), (w) => git(w).status());
  handle('git:init', z.tuple([]), async (w) => {
    await git(w).init();
    send(w, { type: 'workspace', workspace: await ws(w).info() });
  });
  handle('git:stage', z.tuple([paths]), (w, p) => git(w).stage(p));
  handle('git:unstage', z.tuple([paths]), (w, p) => git(w).unstage(p));
  handle('git:discard', z.tuple([paths]), async (w, p) => {
    const st = await git(w).status();
    const untracked = new Set(st.files.filter((f) => f.untracked).map((f) => f.path));
    for (const f of p.filter((x) => untracked.has(x))) await shell.trashItem(ws(w).resolve(f));
    await git(w).discard(p.filter((x) => !untracked.has(x)));
  });
  handle('git:diff', z.tuple([rel, z.boolean()]), (w, p, staged) => git(w).diff(p, staged));
  handle('git:commit', z.tuple([z.string().max(20_000), z.boolean()]), (w, m, amend) =>
    git(w).commit(m, amend),
  );
  handle('git:log', z.tuple([]), (w) => git(w).log());
  handle('git:show', z.tuple([z.string().max(64)]), (w, h) => git(w).show(h));
  handle('git:branches', z.tuple([]), (w) => git(w).branches());
  handle('git:checkout', z.tuple([z.string().min(1).max(255), z.boolean()]), async (w, n, c) => {
    await git(w).checkout(n, c);
    send(w, { type: 'workspace', workspace: await ws(w).info() });
  });
  handle('git:deleteBranch', z.tuple([z.string().min(1).max(255), z.boolean()]), (w, n, f) =>
    git(w).deleteBranch(n, f),
  );
  handle('git:sync', z.tuple([z.enum(['pull', 'push', 'fetch'])]), (w, op) => git(w).sync(op));
  handle(
    'git:stash',
    z.tuple([z.enum(['push', 'pop', 'apply', 'drop']), z.string().max(500).optional()]),
    (w, op, arg) => git(w).stash(op, arg),
  );
  handle('git:stashList', z.tuple([]), (w) => git(w).stashList());
  handle('git:undoCommit', z.tuple([]), (w) => git(w).undoCommit());
  handle('git:revert', z.tuple([z.string().max(64)]), (w, h) => git(w).revert(h));
  handle('git:merge', z.tuple([z.string().min(1).max(255)]), (w, n) => git(w).merge(n));
  handle('git:addRemote', z.tuple([z.string().min(1).max(2048)]), (w, u) => git(w).addRemote(u));

  handle('github:status', z.tuple([]), () => githubStatus());
  handle('github:repos', z.tuple([]), () => githubRepos());
  handle('github:pr', z.tuple([]), (w) => git(w).pr());

  const vercel = new Vercel(app.getPath('userData'));
  const vid = z.string().min(1).max(128);
  const team = z.string().max(128).nullable();
  handle('vercel:status', z.tuple([]), () => vercel.status());
  handle('vercel:setToken', z.tuple([z.string().min(1).max(500)]), (_w, t) => vercel.setToken(t));
  handle('vercel:logout', z.tuple([]), () => vercel.logout());
  handle('vercel:linked', z.tuple([]), (w) =>
    w.workspace ? linkedProject(w.workspace.root) : null,
  );
  handle('vercel:projects', z.tuple([team]), (_w, t) => vercel.projects(t));
  handle('vercel:project', z.tuple([vid, team]), (_w, p, t) => vercel.project(p, t));
  handle('vercel:deployments', z.tuple([vid, team]), (_w, p, t) => vercel.deployments(p, t));
  handle('vercel:logs', z.tuple([vid, team]), (_w, d, t) => vercel.logs(d, t));
  handle('vercel:cancel', z.tuple([vid, team]), (_w, d, t) => vercel.cancel(d, t));
  handle('vercel:redeploy', z.tuple([vid, team, z.boolean()]), (_w, d, t, prod) =>
    vercel.redeploy(d, t, prod),
  );
  const supabase = new Supabase(app.getPath('userData'));
  const ref = z.string().min(1).max(40);
  const pgName = z.string().min(1).max(128);
  handle('supabase:status', z.tuple([]), () => supabase.status());
  handle('supabase:setToken', z.tuple([z.string().min(1).max(500)]), (_w, t) =>
    supabase.setToken(t),
  );
  handle('supabase:logout', z.tuple([]), () => supabase.logout());
  handle('supabase:linked', z.tuple([]), (w) =>
    w.workspace ? linkedSupabase(w.workspace.root) : null,
  );
  handle('supabase:projects', z.tuple([]), () => supabase.projects());
  handle('supabase:health', z.tuple([ref]), (_w, r) => supabase.health(r));
  handle('supabase:tables', z.tuple([ref]), (_w, r) => supabase.tables(r));
  handle('supabase:preview', z.tuple([ref, pgName, pgName]), (_w, r, sc, tb) =>
    supabase.preview(r, sc, tb),
  );
  handle('supabase:query', z.tuple([ref, z.string().min(1).max(200_000)]), (_w, r, q) =>
    supabase.query(r, q),
  );
  handle('supabase:functions', z.tuple([ref]), (_w, r) => supabase.functions(r));
  handle('supabase:buckets', z.tuple([ref]), (_w, r) => supabase.buckets(r));
  handle('supabase:restore', z.tuple([ref]), (_w, r) => supabase.restore(r));
  handle('github:clone', z.tuple([z.string().min(1).max(2048)]), async (w, spec) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Carpeta donde clonar el repositorio',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const dest = join(r.filePaths[0], repoName(spec));
    await cloneRepo(spec, dest, (await githubStatus()).loggedIn);
    return openFolder(w, dest);
  });
  handle(
    'github:publish',
    z.tuple([z.string().min(1).max(200), z.enum(['private', 'public']), z.string().max(300)]),
    async (w, name, vis, desc) => {
      const url = await publishRepo(ws(w), name, vis, desc);
      send(w, { type: 'workspace', workspace: await ws(w).info() });
      return url;
    },
  );

  const prefsPatch = z
    .object({
      fontSize: z.number().int().min(8).max(40),
      fontFamily: z.string().max(300),
      tabSize: z.number().int().min(1).max(16),
      wordWrap: z.boolean(),
      minimap: z.boolean(),
      lineNumbers: z.boolean(),
      formatOnSave: z.boolean(),
      autoSave: z.boolean(),
      inlineCompletions: z.boolean(),
      projectRules: z.boolean(),
      keybindings: z.record(z.string().max(100), z.string().max(60)),
    })
    .partial();
  handle('app:prefs', z.tuple([]), () => prefs());
  handle('app:setPrefs', z.tuple([prefsPatch]), (w, patch) => {
    const next = { ...prefs(), ...patch };
    saveState({ prefs: next });
    ai.useRules = next.projectRules;
    broadcastSettings(w);
    return next;
  });
  handle(
    'ai:chat',
    z.tuple([
      str,
      z.object({
        model: str.optional(),
        // Long conversations are accepted and trimmed to the recent turns by AiService
        // (recentHistory); rejecting them here left the chat busy with no error.
        history: z.array(message).max(20_000),
        prompt: big,
        context: ctx,
        conversationId: conv.optional(),
        agent: z.boolean().optional(),
        folder: z.string().min(1).max(4096).optional(),
      }),
    ]),
    (w, requestId, { folder, ...req }) => {
      // Several chats of the same window (or of other windows) run at the same time: each
      // request is independent and only its own window hears its events.
      const id = rid(w, requestId);
      const where = scope(w, folder);
      w.requests.add(id);
      void ai
        .chat(id, req, (_r, event) => send(w, { type: 'chat', requestId, event }), where)
        .finally(() => w.requests.delete(id));
    },
  );
  handle(
    'ai:edit',
    z.tuple([
      str,
      z.object({
        model: str.optional(),
        instruction: big,
        path: rel,
        language: str,
        selection: big,
        before: big,
        after: big,
      }),
    ]),
    (w, requestId, req) => {
      const id = rid(w, requestId);
      w.requests.add(id);
      void ai
        .edit(id, req, (_r, event) => send(w, { type: 'chat', requestId, event }))
        .finally(() => w.requests.delete(id));
    },
  );
  handle('ai:abort', z.tuple([str]), (w, r) => ai.abort(rid(w, r)));
  handle('ai:usage', z.tuple([]), () => ai.usage());
  handle('ai:conversations', z.tuple([z.string().max(500), z.boolean()]), (w, q, p) =>
    ai.conversations(q, p, scope(w)),
  );
  handle('ai:conversation', z.tuple([conv]), (_w, id) => ai.conversation(id));
  handle('ai:renameConversation', z.tuple([conv, z.string().max(200)]), (_w, id, t) =>
    ai.renameConversation(id, t),
  );
  handle('ai:deleteConversation', z.tuple([conv]), (_w, id) => ai.deleteConversation(id));
  handle('ai:exportConversation', z.tuple([conv]), async (w, id) => {
    const md = ai.exportMarkdown(id);
    if (!md) return null;
    const title =
      md
        .split('\n')[0]!
        .replace(/^#\s*/, '')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .slice(0, 60) || 'conversacion';
    const r = await dialog.showSaveDialog(w.win, {
      defaultPath: join(w.workspace?.root ?? app.getPath('documents'), `${title}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, md, 'utf8');
    return r.filePath;
  });
  handle(
    'ai:setBudget',
    z.tuple([
      str,
      z
        .object({
          daily: z.number().positive().max(1e6).optional(),
          monthly: z.number().positive().max(1e6).optional(),
        })
        .nullable(),
    ]),
    (_w, p, b) => ai.setBudget(p, b),
  );
  handle(
    'ai:toolDecision',
    z.tuple([str, str, z.enum(['approve', 'deny', 'always'])]),
    (w, r, id, d) => ai.toolDecision(rid(w, r), id, d),
  );
  handle('ai:revert', z.tuple([conv, z.string().min(1).max(4096).optional()]), (w, c, folder) =>
    ai.revert(c, scope(w, folder)),
  );

  const rect = z
    .object({
      x: z.number().min(0).max(1e5),
      y: z.number().min(0).max(1e5),
      width: z.number().min(0).max(1e5),
      height: z.number().min(0).max(1e5),
    })
    .nullable();
  const scans = new Map<string, AbortController>();
  handle(
    'security:scan',
    z.tuple([
      str,
      z.object({
        target: z.string().min(1).max(200),
        ports: z.string().max(200).optional(),
        serviceDetection: z.boolean().optional(),
        authorized: z.boolean().optional(),
      }),
    ]),
    async (w, requestId, opts) => {
      const key = rid(w, requestId);
      const ac = new AbortController();
      scans.set(key, ac);
      try {
        return await runScan(opts, ac.signal, (done, total) =>
          send(w, { type: 'scan:progress', requestId, done, total }),
        );
      } finally {
        // Two requests with the same id: only remove our own controller.
        if (scans.get(key) === ac) scans.delete(key);
      }
    },
  );
  handle('security:scanAbort', z.tuple([str]), (w, requestId) => {
    scans.get(rid(w, requestId))?.abort();
  });
  handle('security:saveReport', z.tuple([z.string().max(5_000_000)]), async (w, markdown) => {
    const name = `informe-seguridad-${new Date().toISOString().slice(0, 10)}.md`;
    const r = await dialog.showSaveDialog(w.win, {
      defaultPath: join(w.workspace?.root ?? app.getPath('documents'), name),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, markdown, 'utf8');
    return r.filePath;
  });
  handle(
    'security:run',
    z.tuple([
      str,
      z.object({
        kind: z.enum(['project', 'deps', 'system', 'site', 'hash']),
        checks: z.array(z.string()).optional(),
        url: z.string().max(2048).optional(),
        path: z.string().max(4096).optional(),
        expected: z.string().max(256).optional(),
      }),
    ]),
    async (w, requestId, o) => {
      const key = rid(w, requestId);
      const ac = new AbortController();
      scans.set(key, ac);
      const workspace = w.workspace;
      try {
        switch (o.kind) {
          case 'project':
            if (!workspace)
              return {
                title: '',
                findings: [],
                notes: ['Abre una carpeta para auditar el proyecto.'],
              };
            return await scanProject(workspace, o.checks ?? []);
          case 'deps':
            if (!workspace)
              return {
                title: '',
                findings: [],
                notes: ['Abre una carpeta para revisar dependencias.'],
              };
            return await auditDependencies(workspace, ac.signal);
          case 'system':
            return await checkSystem();
          case 'site':
            return await checkSite(o.url ?? '', ac.signal);
          case 'hash': {
            const text = await fileHash(resolveAnyPath(o.path ?? '', workspace), o.expected);
            return { title: 'Hash', findings: [], notes: text.split('\n') };
          }
        }
      } finally {
        // Two requests with the same id: only remove our own controller.
        if (scans.get(key) === ac) scans.delete(key);
      }
    },
  );

  handle('browser:setBounds', z.tuple([rect]), (w, r) => {
    // The renderer measures in CSS px; the view is placed in window DIPs (differ when zoomed).
    const f = w.win.webContents.getZoomFactor();
    w.browser.setBounds(
      r && {
        x: Math.round(r.x * f),
        y: Math.round(r.y * f),
        width: Math.round(r.width * f),
        height: Math.round(r.height * f),
      },
    );
  });
  // The user's own navigation acts on the tab the user was looking at (null: the visible
  // one); an address typed while an AI tab is shown opens in a tab of the user's own.
  const tabId = z.string().max(64).nullable();
  handle('browser:navigate', z.tuple([str, tabId]), (w, u, t) => w.browser.navigate(u, t));
  handle('browser:back', z.tuple([tabId]), (w, t) => w.browser.back(t));
  handle('browser:forward', z.tuple([tabId]), (w, t) => w.browser.forward(t));
  handle('browser:reload', z.tuple([tabId]), (w, t) => w.browser.reload(t));
  handle('browser:state', z.tuple([]), (w) => w.browser.state());
  handle('browser:home', z.tuple([tabId]), (w, t) => w.browser.home(t));
  handle('browser:tabs', z.tuple([]), (w) => w.browser.view());
  handle('browser:selectTab', z.tuple([z.string().max(64)]), (w, id) => w.browser.select(id));
  handle('browser:closeTab', z.tuple([z.string().max(64)]), (w, id) => w.browser.close(id));
  handle('browser:newTab', z.tuple([]), (w) => void w.browser.newTab());

  handle('terminal:profiles', z.tuple([]), () => shellProfiles());
  handle(
    'terminal:create',
    z.tuple([dim, dim, z.boolean().optional(), z.string().max(64).optional()]),
    (w, cols, rows, admin, profile) => {
      const cwd = w.workspace?.root ?? app.getPath('home');
      const t = terminals.create(cwd, cols, rows, admin ?? false, profile);
      if (t === null) return null;
      termOwner.set(t.id, w);
      w.terminals.add(t.id);
      return t;
    },
  );
  // A window only reaches its own terminals.
  handle('terminal:write', z.tuple([id, z.string().max(1024 * 1024)]), (w, i, d) => {
    if (w.terminals.has(i)) terminals.write(i, d);
  });
  handle('terminal:resize', z.tuple([id, dim, dim]), (w, i, c, r) => {
    if (w.terminals.has(i)) terminals.resize(i, c, r);
  });
  handle('terminal:kill', z.tuple([id]), (w, i) => {
    if (!w.terminals.has(i)) return;
    terminals.kill(i);
    w.terminals.delete(i);
    termOwner.delete(i);
  });

  handle('app:openExternal', z.tuple([z.string().url()]), (_w, url) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });
  handle('app:quit', z.tuple([]), (w) => {
    w.allowClose = true;
    w.win.close();
  });
  handle('app:newWindow', z.tuple([]), (w) => {
    if (!license().features.windows) return false;
    void createWindow({ near: w });
    return true;
  });
  handle('app:installUpdate', z.tuple([]), () => updates?.install());

  handle('license:status', z.tuple([]), () => license());
  handle('license:activate', z.tuple([z.string().min(1).max(8192)]), (w, input) => {
    if (isOwnerCode(input)) saveState({ owner: true, license: undefined });
    else {
      const key = normalizeKey(input);
      const p = parseLicense(key);
      if (p.exp && p.exp < Date.now()) throw new Error('Esta licencia ya venció.');
      saveState({ license: key, owner: undefined });
    }
    broadcastSettings(w);
    return license();
  });
  handle('license:remove', z.tuple([]), (w) => {
    saveState({ license: undefined, owner: undefined });
    broadcastSettings(w);
    return license();
  });
}

// ---------------- app:// protocol (serves the built renderer) ----------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function registerProtocol(): void {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    const path = normalize(
      join(rendererDir, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)),
    );
    if (!path.startsWith(rendererDir + sep)) return new Response('forbidden', { status: 403 });
    try {
      const body = await readFile(path);
      return new Response(body, {
        headers: { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// ---------------- window + menu ----------------

/** A menu item runs a renderer command in the window it was used from. */
function cmd(command: string): MenuItemConstructorOptions['click'] {
  return (_item, bw) => {
    const w = winOf(bw) ?? focused();
    if (w) send(w, { type: 'command', command });
  };
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo archivo', accelerator: 'CmdOrCtrl+N', click: cmd('file.new') },
        {
          label: 'Nueva ventana',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            if (!license().features.windows) return upgrade(focused(), 'windows');
            void createWindow({ near: focused() });
          },
        },
        { label: 'Abrir carpeta…', accelerator: 'CmdOrCtrl+O', click: cmd('workspace.open') },
        { label: 'Clonar repositorio…', click: cmd('git.clone') },
        { label: 'Cerrar carpeta', click: cmd('workspace.close') },
        { label: 'Apertura rápida…', accelerator: 'CmdOrCtrl+P', click: cmd('quickOpen') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: cmd('file.save') },
        { label: 'Guardar todo', accelerator: 'CmdOrCtrl+Alt+S', click: cmd('file.saveAll') },
        { label: 'Cerrar pestaña', accelerator: 'CmdOrCtrl+W', click: cmd('tab.close') },
        { type: 'separator' },
        { label: 'Ajustes…', accelerator: 'CmdOrCtrl+,', click: cmd('app.settings') },
        { type: 'separator' },
        {
          label: 'Cerrar ventana',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: cmd('app.requestClose'),
        },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
        { type: 'separator' },
        {
          label: 'Buscar en archivos',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: cmd('view.search'),
        },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Paleta de comandos…', accelerator: 'CmdOrCtrl+Shift+P', click: cmd('palette') },
        { label: 'Explorador', accelerator: 'CmdOrCtrl+Shift+E', click: cmd('view.explorer') },
        {
          label: 'Control de código (Git)',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: cmd('view.git'),
        },
        { label: 'Terminal', accelerator: 'Ctrl+`', click: cmd('view.terminal') },
        {
          label: 'Enviar terminal al chat',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: cmd('terminal.toChat'),
        },
        { label: 'Chat de IA', accelerator: 'CmdOrCtrl+Alt+I', click: cmd('view.chat') },
        { label: 'Alternar tema claro/oscuro', click: cmd('view.toggleTheme') },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(app.isPackaged
          ? []
          : [{ role: 'toggleDevTools' as const, label: 'Herramientas de desarrollo' }]),
      ],
    },
    {
      label: 'IA',
      submenu: [
        {
          label: 'Nuevo chat (en paralelo)',
          accelerator: 'CmdOrCtrl+Alt+N',
          click: cmd('chat.new'),
        },
        {
          label: 'Ver dos chats a la par',
          accelerator: 'CmdOrCtrl+Alt+D',
          click: cmd('chat.split'),
        },
        { type: 'separator' },
        { label: 'Editar selección con IA…', accelerator: 'CmdOrCtrl+K', click: cmd('ai.edit') },
        {
          label: 'Preguntar sobre la selección',
          accelerator: 'CmdOrCtrl+L',
          click: cmd('ai.askSelection'),
        },
        {
          label: 'Seleccionar modelo…',
          accelerator: 'CmdOrCtrl+Alt+M',
          click: cmd('ai.pickModel'),
        },
        { label: 'Proveedores y llaves…', click: cmd('ai.providers') },
        { label: 'Alternar modo 100 % local', click: cmd('ai.toggleLocal') },
        { label: 'Alternar autocompletado con IA', click: cmd('ai.toggleInline') },
        { label: 'Editar reglas del proyecto', click: cmd('ai.rules') },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Atajos de teclado', click: cmd('help.shortcuts') },
        { label: 'Novedades de esta versión', click: cmd('app.whatsNew') },
        { label: 'Plan y licencia…', click: cmd('license.open') },
        {
          label: 'Buscar actualizaciones',
          click: (_item, bw) => void checkForUpdatesNow(winOf(bw) ?? focused()),
        },
        {
          label: 'Acerca de Zinarix Studio',
          click: (_item, bw) =>
            void dialog.showMessageBox((winOf(bw) ?? focused())!.win, {
              title: 'Zinarix Studio',
              message: `Zinarix Studio ${app.getVersion()} · ${planName()}`,
              detail: `Electron ${process.versions.electron} · Node ${process.versions.node}\nEditor multi-IA · MIT`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function iconPath(): string | undefined {
  const p = join(appRoot, 'build', 'icon.png');
  return existsSync(p) ? p : undefined;
}

async function createWindow(
  opts: {
    folder?: string;
    near?: Win;
    /** The first window of a session reopens the chats of the last one; others start empty. */
    restore?: boolean;
  } = {},
): Promise<Win> {
  const theme = loadState().theme ?? 'dark';
  const light = theme === 'light' || theme.endsWith('-light');
  // A new window opens a little below and to the right of the one it came from.
  const pos = opts.near && !opts.near.win.isDestroyed() ? opts.near.win.getPosition() : null;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...(pos ? { x: pos[0]! + 32, y: pos[1]! + 32 } : {}),
    minWidth: 800,
    minHeight: 500,
    title: 'Zinarix Studio',
    icon: iconPath(),
    show: false,
    backgroundColor: light ? '#ffffff' : '#1e1e1e',
    webPreferences: {
      preload: join(appRoot, 'dist', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      webviewTag: false,
    },
  });
  const w: Win = {
    id: win.webContents.id,
    win,
    browser: undefined as unknown as BrowserController,
    chatFolders: new Map(),
    terminals: new Set(),
    requests: new Set(),
    allowClose: false,
  };
  // The AI-controlled browser of this window (sandboxed views drawn over the "Navegador" tab).
  w.browser = new BrowserController(
    () => (win.isDestroyed() ? undefined : win),
    (state) => send(w, { type: 'browser:state', state }),
    (tab) => send(w, { type: 'browser:show', tab }),
    (view) => send(w, { type: 'browser:tabs', view }),
  );
  wins.set(w.id, w);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.on('close', (e) => {
    if (w.allowClose) return;
    e.preventDefault();
    // The renderer checks unsaved files and running chats, then calls app:quit.
    send(w, { type: 'command', command: 'app.requestClose' });
  });
  win.on('closed', () => {
    w.browser.destroy();
    for (const r of w.requests) ai?.abort(r);
    for (const t of w.terminals) {
      terminals.kill(t);
      termOwner.delete(t);
    }
    w.workspace?.dispose();
    for (const f of w.chatFolders.values()) f.dispose();
    wins.delete(w.id);
  });
  await win
    .loadURL(`app://zinarix/index.html${opts.restore ? '?restore=1' : ''}`)
    .catch((e: unknown) => {
      if (!app.isReady() || win.isDestroyed()) return;
      console.error('failed to load UI', e);
    });
  if (opts.folder) await openFolder(w, opts.folder);
  if (lastNotice) send(w, { type: 'notice', ...lastNotice });
  if (available) send(w, { type: 'update', state: 'available', ...available });
  return w;
}

app.on('second-instance', (_e, argv) => {
  const folder = folderFromArgv(argv);
  if (folder) {
    // Already open somewhere: show that window. Otherwise use an empty window, or a new one.
    const open = [...wins.values()].find((w) => w.workspace?.root === folder);
    const empty = [...wins.values()].find((w) => !w.workspace);
    const target = open ?? empty;
    // Without the multi-window feature, the folder opens in the current window.
    const fallback = license().features.windows ? undefined : focused();
    const dest = target ?? fallback;
    if (dest) {
      if (!open) void openFolder(dest, folder);
      if (dest.win.isMinimized()) dest.win.restore();
      dest.win.focus();
    } else void createWindow({ folder, near: focused() });
    return;
  }
  // Launching the app again (dock, menu, terminal) opens another window, like other
  // editors; focusing the old one does nothing visible on Wayland. Without the multi-window
  // feature, the current window is shown instead.
  const w = focused();
  if (w && !license().features.windows) {
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
    return;
  }
  void createWindow({ near: w });
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

let updates: ReturnType<typeof startUpdates> | undefined;

/** The latest notice from the owner and a newer version, for windows opened later. */
let lastNotice: RemoteNotice | undefined;
let available: { version: string; url: string } | undefined;

/**
 * Reads the owner's control file (app-config.json on the website): the billing switch and
 * plans, a notice for every installed app, and the newest version. Offline: nothing
 * changes (the last plans read stay in use).
 */
async function refreshRemote(): Promise<boolean> {
  const r = await fetchRemote();
  if (r) {
    const st = loadState();
    const changed = JSON.stringify(st.plans ?? null) !== JSON.stringify(r.plans);
    saveState({
      plans: r.plans,
      ...(r.plans.billing && !st.billingSince ? { billingSince: Date.now() } : {}),
    });
    if (changed) for (const w of wins.values()) send(w, { type: 'settings:changed' });
    lastNotice = r.notice;
    if (r.notice) for (const w of wins.values()) send(w, { type: 'notice', ...r.notice });
  }
  // Installers that update themselves announce it on their own (updates.ts), except on
  // macOS, where an unsigned app cannot: there and in every other install, say it here.
  if (updates && process.platform !== 'darwin') return false;
  const latest = r?.latestVersion ?? (await latestRelease());
  if (!latest || !newer(latest, app.getVersion())) return false;
  available = { version: latest, url: r?.downloadUrl ?? DOWNLOAD_URL };
  for (const w of wins.values()) send(w, { type: 'update', state: 'available', ...available });
  return true;
}

/** Ayuda → Buscar actualizaciones. */
async function checkForUpdatesNow(w: Win | undefined): Promise<void> {
  const found = (await refreshRemote()) || Boolean(await updates?.check());
  if (!found && w)
    void dialog.showMessageBox(w.win, {
      title: 'Zinarix Studio',
      message: `Tienes la versión más reciente (${app.getVersion()}).`,
    });
}

app.whenReady().then(async () => {
  if (!isPrimary) return;
  ai = new AiService();
  ai.useRules = prefs().projectRules;
  // The trial counts from the first launch.
  if (!loadState().firstRun) saveState({ firstRun: Date.now() });
  ai.features = () => license().features;
  registerProtocol();
  registerIpc();
  buildMenu();
  // Start empty unless a folder is passed explicitly: the user drops or picks one.
  const initial = folderFromArgv(process.argv) ?? process.env.OMNI_OPEN_FOLDER;
  await createWindow({ folder: initial, restore: true });
  // Installed copies update themselves from the GitHub releases (silently when offline).
  updates = startUpdates((ev) => {
    for (const w of wins.values()) send(w, ev);
  });
  // The owner's switches and announcements, now and every few hours.
  void refreshRemote();
  setInterval(() => void refreshRemote(), 6 * 60 * 60 * 1000).unref();
});

app.on('window-all-closed', () => {
  terminals.killAll();
  ai?.close();
  app.quit();
});

app.on('activate', () => {
  if (!wins.size) void createWindow({ restore: true });
});
