import './system-ca.js';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, Notification, app, dialog, ipcMain, protocol, shell } from 'electron';
import type { BaseWindow, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { z } from 'zod';
import type { AppEvent, BotKind, Channel, PhoneAction, PhoneRepo, Prefs, ThemeId, WorkspaceInfo } from '../shared/api.js';
import { UI_ZOOM_STEPS } from '../shared/api.js';
import { DEFAULT_PREFS, EVENT_CHANNEL, THEME_IDS } from '../shared/api.js';
import { AiService } from './ai.js';
import type { Scope } from './ai.js';
import { Git, cloneRepo, githubRepos, githubStatus, publishRepo, repoName, runUntrustedGit } from './git.js';
import { BrowserController } from './browser.js';
import { Mail } from './mail.js';
import { Supabase, linkedSupabase } from './supabase.js';
import { Vercel, linkedProject } from './vercel.js';
import { CLOUD_SCOPE, GCloud } from './gcloud.js';
import { GOOGLE_ALL_SCOPE } from './googleMail.js';
import { licenseStatus, normalizeKey, parseLicense } from './license.js';
import type { StoredLicense } from './license.js';
import { startUpdates } from './updates.js';
import { editionOf } from '../shared/edition.js';
import { fetchRemote, latestRelease, newer } from './remote.js';
import { PhoneRemote } from './phone.js';
import type { PairRequest, PhoneRepos } from './phone.js';
import { ChatBots } from './bots.js';
import { WhatsApp } from './whatsapp.js';
import { Watcher } from './watch.js';
import { LspHost } from './lsp.js';
import { Knowledge } from './knowledge.js';
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
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_B64 } from './chatImages.js';
import { McpManager } from './mcp.js';
import { DebugManager } from './debug/manager.js';
import { ExtensionStore } from './extensions/store.js';

let mcp: McpManager | undefined;

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..', '..');
const rendererDir = join(appRoot, 'dist', 'renderer');
process.env.OMNI_CATALOG_DIR ??= join(appRoot, 'dist', 'catalog');

/** Which app this is (Zinarix Studio, Zinarix Studio Pro…): set at build time. */
const edition = editionOf(process.env.ZINARIX_EDITION);
const APP_NAME = edition.productName;
app.setName(APP_NAME);
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
/** The always-on project reviewer (created with the AI service). */
let watcher: Watcher;
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

// ---------------- phone remote ----------------

/** The window the phone controls (the one that started the remote). */
let phoneOwner: Win | undefined;
const phoneRepos: PhoneRepos = {
    list: async () => {
      const open = phoneOwner?.workspace?.root;
      return mapLimit(findRepos(), 8, (p) => repoView(p, p === open));
    },
    pull: async (path) => runUntrustedGit(['pull', '--ff-only'], knownRepo(path), 300_000),
    open: async (path) => {
      if (!phoneOwner) throw new Error('No hay ninguna ventana conectada al celular.');
      if (!(await openFolder(phoneOwner, knownRepo(path))))
        throw new Error('No se pudo abrir la carpeta.');
    },
};
/** How long the approval dialog waits before it counts as "no" (Cloudflare cuts at ~100 s). */
const PAIR_APPROVAL_MS = 90_000;
/**
 * A device typed the right PIN: the user decides on the computer whether it gets in. The
 * dialog is attached to the window that controls the phone, which comes to the front.
 */
async function approvePairing(req: PairRequest): Promise<boolean> {
  const owner = phoneOwner?.win;
  const parent =
    owner && !owner.isDestroyed() ? owner : (BrowserWindow.getFocusedWindow() ?? undefined);
  if (parent) {
    if (parent.isMinimized()) parent.restore();
    parent.show();
    parent.flashFrame(true);
  }
  const via =
    req.channel === 'phone' ? 'el control desde el celular' : `el bot de ${req.channel === 'telegram' ? 'Telegram' : 'Discord'}`;
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: 'Nuevo dispositivo',
    message: `¿Permitir que este dispositivo controle Zinarix mediante ${via}?`,
    detail: `${req.who}\n\nEscribió el PIN correcto. Si no fuiste tú, pulsa Rechazar: el PIN cambiará. Quien se conecte podrá usar la IA y tus repositorios desde ahí.`,
    buttons: ['Permitir', 'Rechazar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    signal: AbortSignal.timeout(PAIR_APPROVAL_MS),
  };
  try {
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return response === 0;
  } catch {
    return false;
  } finally {
    if (parent && !parent.isDestroyed()) parent.flashFrame(false);
  }
}
const phoneAction = (action: PhoneAction) => {
  if (phoneOwner) send(phoneOwner, { type: 'phone', action });
};
const phone = new PhoneRemote(
  phoneAction,
  (status) => {
    if (phoneOwner) send(phoneOwner, { type: 'phone:status', status });
  },
  phoneRepos,
  approvePairing,
  () => join(app.getPath('userData'), 'pairing-guard.json'),
);
/** Telegram / Discord bots: the same remote control, from those apps (see bots.ts). */
const bots = new ChatBots({
  dir: () => ai.core.paths.home,
  action: phoneAction,
  repos: phoneRepos,
  pair: (kind, pin, who, onWaiting) => phone.pair(kind, pin, who, onWaiting),
  onStatus: (status) => {
    if (phoneOwner) send(phoneOwner, { type: 'bots:status', status });
  },
});
/** WhatsApp Web in a tab; its chosen chat controls Zinarix like the bots (see whatsapp.ts). */
const whatsapp = new WhatsApp({
  dir: () => ai.core.paths.home,
  incoming: (chat, text) => bots.whatsapp(chat, text),
  linked: () => bots.running,
  onStatus: (status) => {
    for (const w of wins.values()) send(w, { type: 'whatsapp:status', status });
  },
});
bots.plug({
  send: (chat, text, buttons) =>
    whatsapp.send(
      chat,
      buttons?.length ? `${text}\n\nResponde "si" para aprobar o "no" para rechazar.` : text,
    ),
  stop: () => undefined,
});
/** Stops the phone remote and the bots that ride on it. */
function stopPhone(): void {
  bots.detach();
  phone.stop();
  for (const w of wins.values()) send(w, { type: 'whatsapp:status', status: whatsapp.status() });
}

// ---------------- repositories (for the phone) ----------------

const MAX_REPOS = 150;
const isRepo = (p: string) => existsSync(join(p, '.git'));

/**
 * Repositories the user opened or cloned in Zinarix (saved in desktop.json) and the folders
 * open in its windows right now. Nothing else: running git in an arbitrary folder (an unzipped
 * download in Desktop, say) would obey that folder's .git/config.
 */
function findRepos(): string[] {
  const st = loadState();
  const open = [...wins.values()].flatMap((w) => (w.workspace ? [w.workspace.root] : []));
  const found = new Set(
    [...open, ...(st.repos ?? []), ...(st.recentFolders ?? [])].map((p) => resolve(p)),
  );
  return [...found].filter(isRepo).slice(0, MAX_REPOS);
}

/** A path the phone sent, only if it is one of the repositories it was shown. */
function knownRepo(path: string): string {
  const abs = resolve(path);
  if (!findRepos().includes(abs)) throw new Error('Ese repositorio no está en la lista.');
  return abs;
}

async function repoView(path: string, open: boolean): Promise<PhoneRepo> {
  const view: PhoneRepo = {
    path,
    name: basename(path),
    branch: '',
    changes: 0,
    ahead: 0,
    behind: 0,
    open,
  };
  try {
    const out = await runUntrustedGit(['status', '--porcelain=v2', '--branch'], path, 15_000);
    for (const line of out.split('\n')) {
      if (line.startsWith('# branch.head ')) view.branch = line.slice(14);
      else if (line.startsWith('# branch.ab ')) {
        const [, a, b] = /\+(\d+) -(\d+)/.exec(line) ?? [];
        view.ahead = Number(a ?? 0);
        view.behind = Number(b ?? 0);
      } else if (line && !line.startsWith('#')) view.changes++;
    }
  } catch (e) {
    view.error = e instanceof Error ? e.message : String(e);
  }
  return view;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
const toolState = z.enum(['running', 'approval', 'ok', 'error']);
const id200 = z.string().max(200);
const PhoneSnapshot = z.object({
  chats: z
    .array(
      z.object({
        id: id200,
        title: z.string().max(500),
        busy: z.boolean(),
        waiting: z.boolean(),
      }),
    )
    .max(200),
  chatId: id200,
  agent: z.boolean(),
  busy: z.boolean(),
  turns: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(100_000),
        error: z.string().max(5000).optional(),
        tools: z
          .array(z.object({ id: id200, title: z.string().max(500), status: toolState }))
          .max(200),
      }),
    )
    .max(100),
});

// ---------------- desktop state (last folder, theme) ----------------

interface DesktopState extends StoredLicense {
  lastFolder?: string;
  recentFolders?: string[];
  /** Git repositories opened or cloned here (the phone lists them to pull from anywhere). */
  repos?: string[];
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
  return licenseStatus(loadState(), undefined, undefined, edition, { devPlans: !app.isPackaged });
}

function planName(): string {
  const l = license();
  const who = l.email ? ` · ${l.email}` : '';
  return l.plan === 'owner'
    ? 'Pro + AI (dueño)'
    : l.plan === 'pro'
      ? `Pro${who}`
      : l.plan === 'ai'
        ? `AI${who}`
        : l.plan === 'proai'
          ? `Pro + AI${who}`
          : l.plan === 'trial'
            ? `Prueba Pro: ${l.trialDaysLeft} días`
            : 'Gratis';
}

/** A Pro feature was asked for on a plan without it: the window explains and offers Pro. */
function upgrade(w: Win | undefined, feature: string): void {
  if (w) send(w, { type: 'command', command: `license.upgrade:${feature}` });
}

/**
 * Starts the app at login only while a chat was left working (a shutdown cut it): the restored
 * window then continues that task. Linux uses an XDG autostart entry; macOS and Windows the
 * system login items. Development runs are never registered.
 */
/** Conversations whose agent run the last shutdown cut, until the first window asks. */
let interruptedRuns: string[] = [];

function resumeOnLogin(on: boolean): void {
  if (!app.isPackaged) return;
  try {
    if (process.platform === 'linux') {
      const file = join(homedir(), '.config', 'autostart', 'zinarix-studio-resume.desktop');
      if (!on) {
        if (existsSync(file)) rmSync(file);
        return;
      }
      const exec = process.env.APPIMAGE ?? process.execPath;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        '[Desktop Entry]\nType=Application\n' +
          `Name=${APP_NAME}\nExec="${exec.replace(/"/g, '\\"')}"\n` +
          'X-GNOME-Autostart-enabled=true\nNoDisplay=true\n',
      );
    } else {
      app.setLoginItemSettings({ openAtLogin: on });
    }
  } catch {
    // not allowed here: the task still goes on the next time the app is opened by hand
  }
}

function prefs(): Prefs {
  const p = loadState().prefs ?? {};
  return { ...DEFAULT_PREFS, ...p, keybindings: { ...p.keybindings } };
}

/** Sizes every window's interface to the saved zoom (a percentage). */
function applyZoom(): void {
  const f = prefs().uiZoom / 100;
  for (const w of wins.values()) if (!w.win.isDestroyed()) w.win.webContents.setZoomFactor(f);
}

/** Ver > Acercar / Alejar / Tamaño real: saved, so it lasts and reaches every window. */
function stepZoom(dir: -1 | 0 | 1): void {
  const cur = prefs().uiZoom;
  const next =
    dir === 0
      ? 100
      : dir > 0
        ? (UI_ZOOM_STEPS.find((z) => z > cur) ?? UI_ZOOM_STEPS.at(-1)!)
        : (UI_ZOOM_STEPS.findLast((z) => z < cur) ?? UI_ZOOM_STEPS[0]!);
  if (next === cur) return;
  saveState({ prefs: { ...prefs(), uiZoom: next } });
  applyZoom();
  for (const w of wins.values()) send(w, { type: 'settings:changed' });
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
  // The window's folder as it is now: a turn under way stays there if the window opens another.
  const current = w.workspace;
  if (!folder) return { workspace: () => current, browser: w.browser };
  const abs = resolve(folder);
  if (current?.root === abs) return { workspace: () => current, browser: w.browser };
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
  const st = loadState();
  saveState({
    lastFolder: abs,
    recentFolders: [abs, ...(st.recentFolders ?? []).filter((f) => f !== abs)].slice(0, 10),
    ...(isRepo(abs) && {
      repos: [abs, ...(st.repos ?? []).filter((f) => f !== abs)].slice(0, MAX_REPOS),
    }),
  });
  app.addRecentDocument(abs);
  const info = await workspace.info();
  if (!w.win.isDestroyed()) w.win.setTitle(`${info.name} — ${APP_NAME}`);
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

/** Language servers of each window (by webContents id), rooted at its open folder. */
const lspHosts = new Map<number, LspHost>();
/** workspace/applyEdit requests waiting for the renderer. */
const lspEdits = new Map<number, (applied: boolean) => void>();
let lspEditId = 0;
/** Debug session of each window (by webContents id). */
const debugSessions = new Map<number, DebugManager>();
function debugOf(w: Win): DebugManager {
  let d = debugSessions.get(w.id);
  if (!d) {
    d = new DebugManager((event) => send(w, { type: 'debug', event }));
    debugSessions.set(w.id, d);
  }
  return d;
}
let extStore: ExtensionStore | undefined;
function extensions(): ExtensionStore {
  return (extStore ??= new ExtensionStore(app.getPath('userData')));
}

function lspOf(w: Win): LspHost {
  let h = lspHosts.get(w.id);
  if (!h) {
    h = new LspHost(
      {
        diagnostics: (path, diagnostics) => send(w, { type: 'lsp:diagnostics', path, diagnostics }),
        status: (status) => send(w, { type: 'lsp:status', status }),
        applyEdit: (edit) =>
          new Promise<boolean>((resolve) => {
            const id = ++lspEditId;
            const timer = setTimeout(() => {
              lspEdits.delete(id);
              resolve(false);
            }, 30_000);
            lspEdits.set(id, (ok) => {
              clearTimeout(timer);
              lspEdits.delete(id);
              resolve(ok);
            });
            send(w, { type: 'lsp:applyEdit', id, edit });
          }),
      },
      {
        enabled: () => prefs().lsp !== false,
        commands: () => prefs().lspCommands ?? {},
        dataDir: app.getPath('userData'),
      },
    );
    lspHosts.set(w.id, h);
  }
  h.setRoot(w.workspace?.root);
  return h;
}
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
    lspHosts.get(w.id)?.setRoot(undefined);
    w.win.setTitle(APP_NAME);
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
  handle(
    'ai:nextEdit',
    z.tuple([
      str,
      z.object({
        path: rel,
        language: z.string().max(64),
        edits: z.string().max(20_000),
        startLine: z.number().int().min(1),
        lines: z.array(z.string().max(10_000)).max(200),
        cursor: z.object({ line: z.number().int().min(1), column: z.number().int().min(1) }),
      }),
    ]),
    (w, requestId, req) => ai.nextEdit(rid(w, requestId), req),
  );
  // Language servers (LSP): documents in, Monaco features out (see lsp.ts).
  const lspLang = z.string().min(1).max(64);
  handle('lsp:open', z.tuple([rel, lspLang, big]), (w, path, language, text) =>
    lspOf(w).open(path, language, text),
  );
  handle('lsp:change', z.tuple([rel, big]), (w, path, text) => lspOf(w).change(path, text));
  handle('lsp:save', z.tuple([rel]), (w, path) => lspOf(w).save(path));
  handle('lsp:close', z.tuple([rel]), (w, path) => lspOf(w).close(path));
  handle('lsp:request', z.tuple([rel, z.string().min(1).max(100), z.unknown()]), (w, path, m, p) =>
    lspOf(w).request(path, m, p),
  );
  handle('lsp:applyEditResult', z.tuple([z.number().int(), z.boolean()]), (_w, id, ok) =>
    lspEdits.get(id)?.(ok),
  );
  handle('lsp:statuses', z.tuple([]), (w) => lspOf(w).statuses());
  handle('lsp:restart', z.tuple([]), (w) => lspOf(w).restart());
  // Debugger: one session per window, rooted at its open folder.
  const bpList = z
    .array(
      z.object({
        line: z.number().int().min(1).max(10_000_000),
        condition: z.string().max(2000).optional(),
      }),
    )
    .max(5000);
  const debugConfig = z.object({
    name: z.string().max(200),
    type: z.string().min(1).max(64),
    request: z.enum(['launch', 'attach']),
    program: z.string().max(4096).optional(),
    args: z.array(z.string().max(10_000)).max(500).optional(),
    cwd: z.string().max(4096).optional(),
    env: z.record(z.string().max(256), z.string().max(32_768)).optional(),
    port: z.number().int().min(1).max(65_535).optional(),
    host: z.string().max(255).optional(),
    stopOnEntry: z.boolean().optional(),
  });
  handle('debug:configs', z.tuple([rel.optional()]), (w, file) =>
    debugOf(w).configs(ws(w).root, file),
  );
  handle(
    'debug:start',
    z.tuple([debugConfig.nullable(), rel.optional(), z.record(rel, bpList)]),
    (w, config, file, bps) => debugOf(w).start(ws(w).root, config, file, bps),
  );
  handle('debug:stop', z.tuple([]), (w) => debugOf(w).stop());
  handle('debug:restart', z.tuple([]), (w) => debugOf(w).restart());
  handle('debug:continue', z.tuple([]), (w) => debugOf(w).resume());
  handle('debug:pause', z.tuple([]), (w) => debugOf(w).pause());
  handle('debug:step', z.tuple([z.enum(['over', 'into', 'out'])]), (w, k) => debugOf(w).step(k));
  handle('debug:scopes', z.tuple([z.number().int()]), (w, f) => debugOf(w).scopes(f));
  handle('debug:variables', z.tuple([z.number().int()]), (w, r) => debugOf(w).variables(r));
  handle(
    'debug:evaluate',
    z.tuple([z.string().max(100_000), z.number().int().optional()]),
    (w, e, f) => debugOf(w).evaluate(e, f),
  );
  handle('debug:setBreakpoints', z.tuple([rel, bpList]), (w, p, b) =>
    debugOf(w).setBreakpoints(p, b),
  );
  // Extensions (Open VSX): shared by every window; they all hear about changes.
  const extId = z.string().min(1).max(300);
  const extPart = z
    .string()
    .min(1)
    .max(150)
    .regex(/^[\w.-]+$/);
  const extChanged = <T>(r: T): T => {
    for (const x of wins.values()) send(x, { type: 'extensions:changed' });
    return r;
  };
  handle('ext:search', z.tuple([z.string().max(200)]), (_w, q) => extensions().search(q));
  handle('ext:icon', z.tuple([z.string().max(4096)]), (_w, url) => extensions().icon(url));
  handle('ext:install', z.tuple([extPart, extPart]), async (_w, ns, name) =>
    extChanged(await extensions().install(ns, name)),
  );
  handle('ext:uninstall', z.tuple([extId]), async (_w, id) =>
    extChanged(await extensions().uninstall(id)),
  );
  handle('ext:list', z.tuple([]), () => extensions().list());
  handle('ext:setEnabled', z.tuple([extId, z.boolean()]), async (_w, id, on) =>
    extChanged(await extensions().setEnabled(id, on)),
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
  ai.agent.vercel = vercel;
  const vid = z.string().min(1).max(128);
  const team = z.string().max(128).nullable();
  handle('vercel:status', z.tuple([]), () => vercel.status());
  handle('vercel:setToken', z.tuple([z.string().min(1).max(500)]), (_w, t) => vercel.setToken(t));
  const accountId = z.string().regex(/^[\w-]{1,40}$/);
  handle('vercel:logout', z.tuple([accountId.optional()]), (_w, id) => vercel.logout(id));
  handle('vercel:useAccount', z.tuple([accountId]), (_w, id) => vercel.useAccount(id));
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
  handle('vercel:promote', z.tuple([vid, vid, team]), (_w, p, d, t) => vercel.promote(p, d, t));
  handle('vercel:removeDeployment', z.tuple([vid, team]), (_w, d, t) =>
    vercel.removeDeployment(d, t),
  );
  handle(
    'vercel:setEnv',
    z.tuple([
      vid,
      team,
      z.string().min(1).max(256),
      z.string().max(65_536),
      z
        .array(z.enum(['production', 'preview', 'development']))
        .min(1)
        .max(3),
    ]),
    (_w, p, t, k, v, targets) => vercel.setEnv(p, t, k, v, targets),
  );
  handle('vercel:deleteEnv', z.tuple([vid, team, vid]), (_w, p, t, e) => vercel.deleteEnv(p, t, e));
  const domain = z.string().min(3).max(253);
  handle('vercel:addDomain', z.tuple([vid, team, domain]), (_w, p, t, d) =>
    vercel.addDomain(p, t, d),
  );
  handle('vercel:removeDomain', z.tuple([vid, team, domain]), (_w, p, t, d) =>
    vercel.removeDomain(p, t, d),
  );
  handle('vercel:verifyDomain', z.tuple([vid, team, domain]), (_w, p, t, d) =>
    vercel.verifyDomain(p, t, d),
  );
  handle('vercel:settings', z.tuple([vid, team]), (_w, p, t) => vercel.settings(p, t));
  const setting = z.string().max(256).nullable().optional();
  handle(
    'vercel:updateSettings',
    z.tuple([
      vid,
      team,
      z
        .object({
          framework: setting,
          buildCommand: setting,
          installCommand: setting,
          devCommand: setting,
          outputDirectory: setting,
          rootDirectory: setting,
          nodeVersion: setting,
        })
        .strict(),
    ]),
    (_w, p, t, patch) => vercel.updateSettings(p, t, patch),
  );
  const mail = new Mail(app.getPath('userData'));
  ai.agent.mail = mail;
  // MCP servers for the agent: the global ones start now, a project's once it is trusted.
  mcp = new McpManager(app.getPath('userData'));
  ai.agent.mcp = mcp;
  const mcpMgr = mcp;
  mcpMgr.sync();
  handle('mcp:status', z.tuple([]), (w) => {
    const root = w.workspace?.root;
    return { servers: mcpMgr.status(root), project: mcpMgr.project(root) };
  });
  handle('mcp:config', z.tuple([]), () => mcpMgr.readGlobal());
  handle('mcp:saveConfig', z.tuple([z.string().max(1_000_000)]), (_w, text) =>
    mcpMgr.saveGlobal(text),
  );
  handle('mcp:restart', z.tuple([z.string().min(1).max(200)]), (_w, id) => mcpMgr.restart(id));
  handle('mcp:setEnabled', z.tuple([z.string().min(1).max(100), z.boolean()]), (_w, n, on) =>
    mcpMgr.setEnabled(n, on),
  );
  handle('mcp:trustProject', z.tuple([z.boolean()]), (w, on) => {
    const root = w.workspace?.root;
    if (root) mcpMgr.trustProject(root, on);
  });
  const box = z.string().min(1).max(1000);
  const uid = z.number().int().positive();
  const host = z.string().trim().min(1).max(253);
  const port = z.number().int().min(1).max(65535);
  handle('mail:status', z.tuple([]), () => mail.status());
  handle('mail:preset', z.tuple([z.string().max(320)]), (_w, e) => mail.preset(e));
  handle(
    'mail:connect',
    z.tuple([
      z.object({
        email: z.string().trim().email().max(320),
        name: z.string().trim().max(200).optional(),
        user: z.string().trim().min(1).max(320),
        imapHost: host,
        imapPort: port,
        smtpHost: host,
        smtpPort: port,
      }),
      z.string().min(1).max(1000),
    ]),
    (_w, acc, pass) => mail.connect(acc, pass),
  );
  handle('mail:googleReady', z.tuple([]), () => !!mail.google.client());
  handle(
    'mail:setGoogleClient',
    z.tuple([z.string().trim().min(10).max(300), z.string().trim().max(300)]),
    (_w, clientId, clientSecret) => mail.google.setClient({ clientId, clientSecret }),
  );
  // Google Cloud: the same OAuth client as Gmail, asking for the cloud-platform scope.
  const gcloud = new GCloud(app.getPath('userData'), mail.google);
  ai.agent.gcloud = gcloud;

  /**
   * One "Sign in with Google" for everything: asks for Gmail and Google Cloud together and
   * connects each panel the user granted. The other one failing never undoes the first.
   */
  const googleAll = async (name?: string) => {
    const g = await mail.google.login((url) => void shell.openExternal(url), GOOGLE_ALL_SCOPE);
    const granted = g.scope.split(/\s+/);
    if (granted.includes(CLOUD_SCOPE)) gcloud.addAccount(g.refresh, g.email);
    let mailError: unknown = null;
    if (granted.includes('https://mail.google.com/'))
      await mail.addGoogle(g, name).catch((e: unknown) => (mailError = e));
    return { granted, mailError };
  };

  handle('mail:googleLogin', z.tuple([z.string().trim().max(200).optional()]), async (_w, name) => {
    const r = await googleAll(name);
    if (r.mailError) throw r.mailError;
    if (!r.granted.includes('https://mail.google.com/'))
      throw new Error('No diste permiso para el correo: vuelve a iniciar sesión y marca Gmail.');
    return mail.status();
  });
  const gproj = z.string().regex(/^[\w.:-]{1,100}$/);
  const gname = z.string().regex(/^[\w.-]{1,1024}$/);
  handle('gcloud:status', z.tuple([]), () => gcloud.status());
  handle('gcloud:login', z.tuple([]), async () => {
    const r = await googleAll();
    if (!r.granted.includes(CLOUD_SCOPE))
      throw new Error('No diste permiso para Google Cloud: vuelve a iniciar sesión y márcalo.');
    return gcloud.status();
  });
  handle('gcloud:prepare', z.tuple([gproj]), (_w, p) => gcloud.prepare(p));
  handle('gcloud:useAccount', z.tuple([accountId]), (_w, id) => gcloud.useAccount(id));
  handle('gcloud:logout', z.tuple([accountId.optional()]), (_w, id) => gcloud.logout(id));
  handle('gcloud:projects', z.tuple([]), () => gcloud.projects());
  handle('gcloud:services', z.tuple([gproj, z.boolean()]), (_w, p, all) => gcloud.services(p, all));
  handle(
    'gcloud:setService',
    z.tuple([gproj, z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/).max(200), z.boolean()]),
    (_w, p, svc, on) => gcloud.setService(p, svc, on),
  );
  handle('gcloud:datasets', z.tuple([gproj]), (_w, p) => gcloud.datasets(p));
  handle('gcloud:tables', z.tuple([gproj, gname]), (_w, p, d) => gcloud.tables(p, d));
  handle('gcloud:query', z.tuple([gproj, z.string().min(1).max(200_000)]), (_w, p, sql) =>
    gcloud.query(p, sql),
  );
  handle('gcloud:buckets', z.tuple([gproj]), (_w, p) => gcloud.buckets(p));
  handle('gcloud:objects', z.tuple([gname, z.string().max(1024)]), (_w, b, prefix) =>
    gcloud.objects(b, prefix),
  );
  handle('gcloud:sqlInstances', z.tuple([gproj]), (_w, p) => gcloud.sqlInstances(p));
  handle('gcloud:sqlPower', z.tuple([gproj, gname, z.boolean()]), (_w, p, i, on) =>
    gcloud.sqlPower(p, i, on),
  );
  handle('gcloud:logs', z.tuple([gproj, z.string().max(2000)]), (_w, p, f) => gcloud.logs(p, f));
  const email = z.string().trim().email().max(320);
  handle('mail:logout', z.tuple([email.optional()]), (_w, e) => mail.logout(e));
  handle('mail:useAccount', z.tuple([email]), (_w, e) => mail.useAccount(e));
  handle('mail:folders', z.tuple([]), () => mail.box().folders());
  handle(
    'mail:list',
    z.tuple([box, z.number().int().min(0).max(100_000), z.string().max(200)]),
    (_w, f, p, q) => mail.box().list(f, p, q),
  );
  handle('mail:open', z.tuple([box, uid]), (_w, f, u) => mail.box().open(f, u));
  handle(
    'mail:setFlag',
    z.tuple([box, uid, z.enum(['seen', 'flagged']), z.boolean()]),
    (_w, f, u, flag, on) => mail.box().setFlag(f, u, flag, on),
  );
  handle('mail:trash', z.tuple([box, uid]), (_w, f, u) => mail.box().trash(f, u));
  const draft = z.object({
    to: z.string().max(5000),
    cc: z.string().max(5000).optional(),
    subject: z.string().max(1000),
    text: z.string().max(2_000_000),
    inReplyTo: z.string().max(1000).nullable().optional(),
    references: z.array(z.string().max(1000)).max(200).optional(),
    draftUid: uid.nullable().optional(),
  });
  handle(
    'mail:move',
    z.tuple([box, uid, z.enum(['inbox', 'junk', 'trash', 'archive'])]),
    (_w, f, u, to) => mail.box().move(f, u, to),
  );
  handle(
    'mail:send',
    z.tuple([draft.extend({ to: z.string().trim().min(3).max(5000) })]),
    (_w, d) => mail.box().send(d),
  );
  handle('mail:saveDraft', z.tuple([draft]), (_w, d) => mail.box().saveDraft(d));
  handle('mail:deleteDraft', z.tuple([uid]), (_w, u) => mail.box().deleteDraft(u));
  handle(
    'mail:saveAttachment',
    z.tuple([box, uid, z.number().int().min(0)]),
    async (w, f, u, i) => {
      const a = mail.box().attachment(f, u, i);
      const r = await dialog.showSaveDialog(w.win, {
        defaultPath: join(app.getPath('downloads'), basename(a.filename)),
      });
      if (r.canceled || !r.filePath) return null;
      writeFileSync(r.filePath, a.content);
      return r.filePath;
    },
  );

  const supabase = new Supabase(app.getPath('userData'));
  ai.agent.supabase = supabase;
  const ref = z.string().min(1).max(40);
  const pgName = z.string().min(1).max(128);
  handle('supabase:status', z.tuple([]), () => supabase.status());
  handle('supabase:setToken', z.tuple([z.string().min(1).max(500)]), (_w, t) =>
    supabase.setToken(t),
  );
  handle('supabase:logout', z.tuple([accountId.optional()]), (_w, id) => supabase.logout(id));
  handle('supabase:useAccount', z.tuple([accountId]), (_w, id) => supabase.useAccount(id));
  handle('supabase:linked', z.tuple([]), (w) =>
    w.workspace ? linkedSupabase(w.workspace.root) : null,
  );
  handle('supabase:projects', z.tuple([]), () => supabase.projects());
  handle('supabase:health', z.tuple([ref]), (_w, r) => supabase.health(r));
  handle('supabase:tables', z.tuple([ref]), (_w, r) => supabase.tables(r));
  handle(
    'supabase:preview',
    z.tuple([ref, pgName, pgName, z.number().int().min(0).max(1_000_000)]),
    (_w, r, sc, tb, page) => supabase.preview(r, sc, tb, page),
  );
  handle('supabase:query', z.tuple([ref, z.string().min(1).max(200_000)]), (_w, r, q) =>
    supabase.query(r, q),
  );
  handle('supabase:functions', z.tuple([ref]), (_w, r) => supabase.functions(r));
  handle('supabase:buckets', z.tuple([ref]), (_w, r) => supabase.buckets(r));
  handle('supabase:restore', z.tuple([ref]), (_w, r) => supabase.restore(r));
  handle('supabase:pause', z.tuple([ref]), (_w, r) => supabase.pause(r));
  handle('supabase:columns', z.tuple([ref, pgName, pgName]), (_w, r, sc, tb) =>
    supabase.columns(r, sc, tb),
  );
  handle('supabase:setRls', z.tuple([ref, pgName, pgName, z.boolean()]), (_w, r, sc, tb, on) =>
    supabase.setRls(r, sc, tb, on),
  );
  handle('supabase:users', z.tuple([ref]), (_w, r) => supabase.users(r));
  handle('supabase:userCount', z.tuple([ref]), (_w, r) => supabase.userCount(r));
  handle('supabase:migrations', z.tuple([ref]), (_w, r) => supabase.migrations(r));
  handle('supabase:files', z.tuple([ref, z.string().min(1).max(100)]), (_w, r, b) =>
    supabase.files(r, b),
  );
  handle('supabase:apiInfo', z.tuple([ref]), (_w, r) => supabase.apiInfo(r));
  handle('supabase:deleteFunction', z.tuple([ref, vid]), (_w, r, s) =>
    supabase.deleteFunction(r, s),
  );
  handle('supabase:deleteUser', z.tuple([ref, z.string().length(36)]), (_w, r, id) =>
    supabase.deleteUser(r, id),
  );
  const secretName = z.string().min(1).max(256);
  handle('supabase:secrets', z.tuple([ref]), (_w, r) => supabase.secrets(r));
  handle('supabase:setSecret', z.tuple([ref, secretName, z.string().max(65_536)]), (_w, r, n, v) =>
    supabase.setSecret(r, n, v),
  );
  handle('supabase:deleteSecret', z.tuple([ref, secretName]), (_w, r, n) =>
    supabase.deleteSecret(r, n),
  );
  handle('supabase:authConfig', z.tuple([ref]), (_w, r) => supabase.authConfig(r));
  handle(
    'supabase:setAuthConfig',
    z.tuple([
      ref,
      z
        .object({
          siteUrl: z.string().max(2048),
          redirectUrls: z.array(z.string().max(2048)).max(100),
          disableSignup: z.boolean(),
          autoconfirm: z.boolean(),
        })
        .strict(),
    ]),
    (_w, r, c) => supabase.setAuthConfig(r, c),
  );
  handle('supabase:backups', z.tuple([ref]), (_w, r) => supabase.backups(r));
  handle('supabase:emailConfig', z.tuple([ref]), (_w, r) => supabase.emailConfig(r));
  handle(
    'supabase:setSmtp',
    z.tuple([
      ref,
      z
        .object({
          host: z.string().min(1).max(255),
          port: z.string().regex(/^\d{1,5}$/),
          user: z.string().max(255),
          pass: z.string().max(1024),
          senderEmail: z.email().max(320),
          senderName: z.string().max(255),
        })
        .strict()
        .nullable(),
      z.number().int().min(1).max(100_000).nullable(),
    ]),
    (_w, r, smtp, limit) => supabase.setSmtp(r, smtp, limit),
  );
  handle(
    'supabase:setEmailTemplate',
    z.tuple([
      ref,
      z.enum([
        'confirmation',
        'invite',
        'magic_link',
        'recovery',
        'email_change',
        'reauthentication',
      ]),
      z.string().max(1000),
      z.string().max(200_000),
    ]),
    (_w, r, kind, subject, content) => supabase.setEmailTemplate(r, kind, subject, content),
  );
  handle(
    'supabase:sendEmail',
    z.tuple([
      ref,
      z.enum(['invite', 'magiclink', 'recovery']),
      z.email().max(320),
      z.string().max(2048),
    ]),
    (_w, r, kind, email, redirect) => supabase.sendEmail(r, kind, email, redirect),
  );
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
      uiZoom: z.number().int().min(50).max(300),
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
      lsp: z.boolean(),
      lspCommands: z.record(z.string().max(64), z.string().max(2000)),
      nextEdit: z.boolean(),
    })
    .partial();
  handle('app:prefs', z.tuple([]), () => prefs());
  handle('app:setPrefs', z.tuple([prefsPatch]), (w, patch) => {
    const next = { ...prefs(), ...patch };
    saveState({ prefs: next });
    if (patch.lsp !== undefined || patch.lspCommands)
      for (const h of lspHosts.values()) void h.restart();
    ai.useRules = next.projectRules;
    applyZoom();
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
        noFolder: z.boolean().optional(),
        images: z
          .array(
            z.object({
              mediaType: z.enum(IMAGE_TYPES),
              data: z.string().min(1).max(MAX_IMAGE_B64).regex(/^[A-Za-z0-9+/=]+$/),
            }),
          )
          .max(MAX_IMAGES)
          .optional(),
      }),
    ]),
    (w, requestId, { folder, noFolder, ...req }) => {
      // Several chats of the same window (or of other windows) run at the same time: each
      // request is independent and only its own window hears its events.
      const id = rid(w, requestId);
      // A chat in no folder sees no project at all (only the window's browser).
      const where: Scope = noFolder
        ? { workspace: () => undefined, browser: w.browser }
        : scope(w, folder);
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
  // Saved chats of one project (the side list of the chat panel).
  handle('ai:projectConversations', z.tuple([z.string().min(1).max(4096)]), (w, folder) => {
    try {
      return ai.conversations('', true, scope(w, folder)).slice(0, 30);
    } catch {
      return []; // the folder is gone
    }
  });
  handle('ai:conversation', z.tuple([conv]), (_w, id) => ai.conversation(id));
  handle('ai:renameConversation', z.tuple([conv, z.string().max(200)]), (_w, id, t) =>
    ai.renameConversation(id, t),
  );
  // A chat dragged to another project of the side list.
  handle('ai:moveConversation', z.tuple([conv, z.string().min(1).max(4096)]), (w, id, folder) => {
    const root = scope(w, folder).workspace()?.root;
    if (root) ai.moveConversation(id, root);
  });
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
  handle('app:resumeOnLogin', z.tuple([z.boolean()]), (_w, on) => resumeOnLogin(on));
  handle('app:interruptedRuns', z.tuple([]), () => interruptedRuns.splice(0));
  handle('app:newWindow', z.tuple([]), (w) => {
    if (!license().features.windows) return false;
    void createWindow({ near: w });
    return true;
  });
  handle('app:installUpdate', z.tuple([]), () => updates?.install());

  handle('phone:status', z.tuple([]), (w) =>
    phoneOwner === w ? phone.status() : { running: false, phones: 0 },
  );
  handle('phone:start', z.tuple([]), async (w) => {
    // One window at a time: starting it here takes it from the other one.
    if (phoneOwner && phoneOwner !== w) {
      send(phoneOwner, { type: 'phone:status', status: { running: false, phones: 0 } });
      stopPhone();
    }
    phoneOwner = w;
    try {
      const status = await phone.start();
      if (status.running) bots.attach();
      for (const o of wins.values()) send(o, { type: 'whatsapp:status', status: whatsapp.status() });
      return status;
    } catch (e) {
      phoneOwner = undefined;
      return { running: false, phones: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('phone:stop', z.tuple([]), (w) => {
    if (phoneOwner !== w) return { running: false, phones: 0 };
    phoneOwner = undefined;
    bots.detach();
    const status = phone.stop();
    for (const o of wins.values()) send(o, { type: 'whatsapp:status', status: whatsapp.status() });
    return status;
  });
  handle('phone:remote', z.tuple([z.boolean()]), (w, on) =>
    phoneOwner === w ? phone.setRemote(on) : { running: false, phones: 0 },
  );
  handle('phone:push', z.tuple([PhoneSnapshot]), (w, snapshot) => {
    if (phoneOwner !== w) return;
    phone.push(snapshot);
    bots.push(snapshot);
  });
  const botKind = z.enum(['telegram', 'discord']) satisfies z.ZodType<BotKind>;
  handle('bots:status', z.tuple([]), () => bots.status());
  handle('bots:connect', z.tuple([botKind, z.string().trim().min(20).max(300)]), (w, kind, token) => {
    if (phoneOwner !== w) throw new Error('Activa primero el control desde el celular.');
    return bots.connect(kind, token);
  });
  handle('bots:disconnect', z.tuple([botKind]), (_w, kind) => bots.disconnect(kind));

  handle('whatsapp:status', z.tuple([]), () => whatsapp.status());
  handle('whatsapp:setBounds', z.tuple([rect]), (w, r) => {
    const f = w.win.webContents.getZoomFactor();
    whatsapp.setBounds(
      w.win,
      r && {
        x: Math.round(r.x * f),
        y: Math.round(r.y * f),
        width: Math.round(r.width * f),
        height: Math.round(r.height * f),
      },
    );
  });
  handle('whatsapp:reload', z.tuple([]), () => whatsapp.reload());
  handle('whatsapp:control', z.tuple([z.boolean()]), (_w, on) => whatsapp.setControl(on));
  handle('whatsapp:useCurrent', z.tuple([]), () => whatsapp.useCurrent());
  handle('whatsapp:forget', z.tuple([]), () => whatsapp.forget());
  handle('whatsapp:who', z.tuple([z.string().max(200), z.enum(['me', 'them', 'all'])]), (_w, id, who) =>
    whatsapp.setWho(id, who),
  );
  handle('whatsapp:remove', z.tuple([z.string().max(200)]), (_w, id) => whatsapp.remove(id));
  handle('whatsapp:test', z.tuple([z.string().max(200).optional()]), (_w, id) => whatsapp.test(id));

  const watchPatch = z
    .object({
      enabled: z.boolean(),
      everyMin: z.number().int().min(15).max(7 * 24 * 60),
      maxPerDay: z.number().int().min(1).max(48),
      model: z.string().min(3).max(200).nullable(),
    })
    .partial();
  handle('watch:status', z.tuple([]), () => watcher.status());
  handle('watch:configure', z.tuple([watchPatch]), (_w, patch) => watcher.configure(patch));
  handle('watch:runNow', z.tuple([]), (w) => watcher.runNow(w.workspace));
  handle('watch:seen', z.tuple([]), () => watcher.seen());
  handle('watch:dismiss', z.tuple([z.string().uuid()]), (_w, id) => watcher.dismiss(id));

  // Knowledge: memories, indexed docs (@Docs) and the project's search-by-meaning index.
  const knowledge = new Knowledge(join(app.getPath('userData'), 'knowledge'), ai.core);
  ai.agent.knowledge = knowledge;
  let knowledgeTimer: NodeJS.Timeout | undefined;
  knowledge.onChange = () => {
    clearTimeout(knowledgeTimer);
    knowledgeTimer = setTimeout(() => {
      for (const w of wins.values()) send(w, { type: 'knowledge:changed' });
    }, 200);
  };
  const memoryText = z.string().trim().min(1).max(2000);
  handle('knowledge:memories', z.tuple([]), () => knowledge.memories(undefined, true));
  handle(
    'knowledge:addMemory',
    z.tuple([memoryText, z.enum(['global', 'project'])]),
    (w, text, scope) => knowledge.addMemory(text, scope, w.workspace?.root),
  );
  handle('knowledge:updateMemory', z.tuple([z.string().min(1).max(64), memoryText]), (_w, id, text) =>
    knowledge.updateMemory(id, text),
  );
  handle('knowledge:removeMemory', z.tuple([z.string().min(1).max(64)]), (_w, id) =>
    knowledge.removeMemory(id),
  );
  handle('knowledge:docs', z.tuple([]), () => knowledge.docs());
  handle(
    'knowledge:addDocs',
    z.tuple([z.string().trim().max(80), z.string().trim().url().max(2048)]),
    (_w, name, url) => knowledge.addDocs(name, url),
  );
  handle('knowledge:removeDocs', z.tuple([z.string().min(1).max(64)]), (_w, id) =>
    knowledge.removeDocs(id),
  );
  handle('knowledge:reindexDocs', z.tuple([z.string().min(1).max(64)]), (_w, id) =>
    knowledge.reindexDocs(id),
  );
  handle(
    'knowledge:search',
    z.tuple([z.string().trim().min(1).max(2000), z.number().int().min(1).max(50).optional()]),
    async (w, query, limit) => {
      if (!w.workspace) return { hits: [], semantic: false, files: 0 };
      return knowledge.codeSearch(w.workspace, query, limit ?? 20, AbortSignal.timeout(120_000));
    },
  );
  handle(
    'knowledge:searchDocs',
    z.tuple([z.string().trim().min(1).max(4000), z.string().max(80).optional()]),
    (_w, query, source) => knowledge.docsSearch(query, source, 6),
  );
  handle('knowledge:embedModel', z.tuple([]), () => knowledge.embedModel());
  handle('knowledge:setEmbedModel', z.tuple([str.nullable()]), (w, ref) => {
    knowledge.setEmbedModel(ref);
    broadcastSettings(w);
  });

  handle('license:status', z.tuple([]), () => license());
  handle('license:activate', z.tuple([z.string().min(1).max(8192)]), (w, input) => {
    // Only signed keys (ZX1.…): plan codes and the owner's word are gone.
    const key = normalizeKey(input);
    const p = parseLicense(key);
    if (p.exp && p.exp < Date.now()) throw new Error('Esta licencia ya venció.');
    if (loadState().revoked?.includes(p.id))
      throw new Error('Esta licencia fue cancelada (reembolso o disputa del pago).');
    saveState({ license: key, owner: undefined, codePlan: undefined });
    broadcastSettings(w);
    return license();
  });
  handle('license:remove', z.tuple([]), (w) => {
    saveState({ license: undefined, owner: undefined, codePlan: undefined });
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
        { label: 'Agrandar todo', accelerator: 'CmdOrCtrl+=', click: () => stepZoom(1) },
        // Hidden twins: Ctrl + on keyboards where "+" is its own key (numpad, Spanish layout).
        {
          label: 'Agrandar todo',
          accelerator: 'CmdOrCtrl+Plus',
          visible: false,
          click: () => stepZoom(1),
        },
        {
          label: 'Agrandar todo',
          accelerator: 'CmdOrCtrl+numadd',
          visible: false,
          click: () => stepZoom(1),
        },
        { label: 'Achicar todo', accelerator: 'CmdOrCtrl+-', click: () => stepZoom(-1) },
        {
          label: 'Achicar todo',
          accelerator: 'CmdOrCtrl+numsub',
          visible: false,
          click: () => stepZoom(-1),
        },
        { label: 'Tamaño real', accelerator: 'CmdOrCtrl+0', click: () => stepZoom(0) },
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
          label: `Acerca de ${APP_NAME}`,
          click: (_item, bw) =>
            void dialog.showMessageBox((winOf(bw) ?? focused())!.win, {
              title: APP_NAME,
              message: `${APP_NAME} ${app.getVersion()} · ${planName()}`,
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
    title: APP_NAME,
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
  // Electron forgets the zoom on each load; the saved interface size is set again.
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(prefs().uiZoom / 100));
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
    void lspHosts.get(w.id)?.dispose();
    lspHosts.delete(w.id);
    void debugSessions.get(w.id)?.stop();
    debugSessions.delete(w.id);
    w.browser.destroy();
    whatsapp.release(win);
    for (const r of w.requests) ai?.abort(r);
    for (const t of w.terminals) {
      terminals.kill(t);
      termOwner.delete(t);
    }
    w.workspace?.dispose();
    for (const f of w.chatFolders.values()) f.dispose();
    if (phoneOwner === w) {
      phoneOwner = undefined;
      stopPhone();
    }
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
  const r = await fetchRemote({ packaged: app.isPackaged });
  if (r) {
    const st = loadState();
    const changed =
      JSON.stringify(st.plans ?? null) !== JSON.stringify(r.plans) ||
      JSON.stringify(st.revoked ?? []) !== JSON.stringify(r.revoked);
    saveState({
      plans: r.plans,
      revoked: r.revoked,
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
      title: APP_NAME,
      message: `Tienes la versión más reciente (${app.getVersion()}).`,
    });
}

app.whenReady().then(async () => {
  if (!isPrimary) return;
  ai = new AiService();
  // Before any window opens: their chats reload these conversations with the progress saved.
  interruptedRuns = ai.recoverInterrupted();
  // Still pending if the window is closed before continuing them: open at the next login too.
  if (interruptedRuns.length) resumeOnLogin(true);
  ai.useRules = prefs().projectRules;
  ai.onTitle = (conversationId, title) => {
    for (const w of wins.values()) send(w, { type: 'chat:title', conversationId, title });
  };
  // The trial counts from the first launch.
  if (!loadState().firstRun) saveState({ firstRun: Date.now() });
  ai.features = () => license().features;
  watcher = new Watcher({
    home: ai.core.paths.home,
    core: ai.core,
    projects: () => [...wins.values()].flatMap((w) => (w.workspace ? [w.workspace] : [])),
    changed: (status) => {
      for (const w of wins.values()) send(w, { type: 'watch:status', status });
    },
    found: (report) => {
      if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
      const n = new Notification({
        title: `Vigía · ${report.name}`,
        body: `${report.items.length} sugerencia(s): ${report.items[0]!.title}`,
      });
      n.on('click', () => {
        const w =
          [...wins.values()].find((x) => x.workspace?.root === report.project) ?? focused();
        if (!w) return;
        if (w.win.isMinimized()) w.win.restore();
        w.win.focus();
        send(w, { type: 'command', command: 'view.watch' });
      });
      n.show();
    },
  });
  watcher.start();
  registerProtocol();
  registerIpc();
  buildMenu();
  // Start empty unless a folder is passed explicitly: the user drops or picks one.
  const initial = folderFromArgv(process.argv) ?? process.env.OMNI_OPEN_FOLDER;
  await createWindow({ folder: initial, restore: true });
  // WhatsApp control left on: its page opens out of sight and keeps listening.
  whatsapp.resume();
  // Installed copies update themselves from the GitHub releases (silently when offline).
  updates = startUpdates(edition.channel, (ev) => {
    for (const w of wins.values()) send(w, ev);
  });
  // The owner's switches and announcements, now and every few hours.
  void refreshRemote();
  setInterval(() => void refreshRemote(), 6 * 60 * 60 * 1000).unref();
});

app.on('window-all-closed', () => {
  watcher?.stop();
  mcp?.shutdown();
  stopPhone();
  whatsapp.destroy();
  terminals.killAll();
  ai?.close();
  app.quit();
});

app.on('activate', () => {
  if (!wins.size) void createWindow({ restore: true });
});
