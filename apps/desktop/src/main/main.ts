import './system-ca.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, stat as statAsync, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron';
import type { BaseWindow, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { z } from 'zod';
import type {
  AppEvent,
  BotKind,
  Channel,
  PhoneAction,
  PhoneConfigView,
  PhoneModels,
  PhoneRepo,
  PhoneWindow,
  Prefs,
  ThemeId,
  WorkspaceInfo,
} from '../shared/api.js';
import { UI_ZOOM_STEPS } from '../shared/api.js';
import {
  DEFAULT_PREFS,
  EVENT_CHANNEL,
  GCLOUD_KINDS,
  PHONE_PREF_KEYS,
  THEME_IDS,
} from '../shared/api.js';
import { AiService, describeError } from './ai.js';
import type { Scope } from './ai.js';
import {
  Git,
  cloneRepo,
  githubRepos,
  githubStatus,
  publishRepo,
  repoName,
  run as runGit,
  runUntrustedGit,
} from './git.js';
import { BrowserController, browserData } from './browser.js';
import { clearCookies, cookieInfo, importCookieFile } from './browserCookies.js';
import { importFromBrowser, listBrowserSources } from './browserCookiesDirect.js';
import { Mail } from './mail.js';
import { Supabase, linkedSupabase } from './supabase.js';
import { CloudSync } from './cloudSync.js';
import { Vercel, linkedProject } from './vercel.js';
import { CLOUD_SCOPE, GCloud } from './gcloud.js';
import { GOOGLE_ALL_SCOPE } from './googleMail.js';
import { licenseStatus, normalizeKey, parseLicense } from './license.js';
import type { StoredLicense } from './license.js';
import { LicenseIssuer } from './licenseIssuer.js';
import { startUpdates } from './updates.js';
import { editionOf } from '../shared/edition.js';
import { fetchRemote, latestRelease, newer } from './remote.js';
import { PhoneRemote } from './phone.js';
import { githubBeacon } from './phoneBeacon.js';
import type { PairRequest, PhoneRepos, PhoneTerm, PhoneTools } from './phone.js';
import { ChatBots } from './bots.js';
import { WhatsApp } from './whatsapp.js';
import { Watcher } from './watch.js';
import { Automations } from './automations.js';
import {
  BOT_FILE_EXT,
  botAgentMarkdown,
  botFromFile,
  botSlug,
  botToFile,
  widgetApi,
  widgetFiles,
  widgetUrlIssue,
  type WidgetTarget,
} from '../shared/automations.js';
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
import { applyChrome, chromeOptions } from './windowChrome.js';
import { isInside } from '../shared/tasks.js';
import { SETUP_SCRIPT, TaskManager } from './tasks.js';
import { ReviewManager } from './review.js';
import { PlaygroundService } from './playground.js';
import { MediaService } from './media.js';
import { ImageService } from './imageTools.js';
import { rasterSvg } from './svgRaster.js';
import { NotebookKernels } from './jupyter.js';
import { DockerService } from './docker.js';
import { PlatformioService } from './platformio.js';
import { GodotService, LSP_TCP_BRIDGE } from './godot.js';
import { CadService, builtinViaProcess } from './cad.js';
import { BgRemoveService, bgViaProcess } from './bgRemove.js';
import { BG_MODELS, type BgStatusView } from '../shared/bgRemove.js';
import { BlenderModelService } from './blenderModel.js';
import { SketchupService } from './sketchup.js';
import { readSkpHead } from './sketchupTools.js';
import { SKETCHUP_PREVIEWABLE, SKETCHUP_UNITS, parseSkp, validateSketchupOps, type SketchupRunView, type SketchupStatusView, type SkpInfoView } from '../shared/sketchup.js';
import { SlicerService } from './slicer.js';
import { PrinterClient, PrinterStore, normalizePrinterUrl, printerFileName } from './printers.js';
import { TokenStore } from './token-store.js';
import { PRINTER_KINDS, SLICEABLE, validateSlice, type SliceView, type SlicerView } from '../shared/slicer.js';
import { gcodeGrams, gcodeTime } from '../shared/gcode.js';
import { CAD_FORMATS, CAD_TEMPLATES, isMeshPath, parseScadParams, type CadEnginesView, type CadRenderView, type ScadLog } from '../shared/cad.js';
import { WebGameServers } from './webGame.js';
import { setGodotLocator } from './debug/manager.js';
import { isGameTemplate } from '../shared/games.js';
import { MobileService } from './mobile.js';
import { projectCommand, type MobileInput } from '../shared/mobile.js';
import type { PioEvent, PioResult } from '../shared/platformio.js';
import { Computer } from './computer.js';
import { barLabelsFor, ComputerControlRun } from './computerMode.js';
import { BuildService } from './build.js';
import { rulesPrompt } from '../shared/rules.js';
import { redact } from '@omni/security';
import { cliRunsWithoutTools } from '@omni/providers';
import type { ChatMessage } from '@omni/shared';
import { DesignSession, EDITOR_SCRIPT_PATH } from './design/session.js';
import { EditError } from './design/htmlSource.js';
import { page as previewPage } from './design/live.js';
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_B64 } from './chatImages.js';
import { McpManager } from './mcp.js';
import { HookTrust } from './hooks.js';
import { DebugManager } from './debug/manager.js';
import {
  clearLastRun,
  discoverTests,
  loadLastRun,
  setTestResultsDir,
  TestManager,
  type TestRunRequest,
} from './testing.js';
import { ExtensionStore } from './extensions/store.js';
import { HelperService, MODEL_NAME } from './helper.js';
import { gitMention, webMention } from './mentions.js';
import { VideoService, fromStored, readLut, toStored } from './video.js';
import { CURSOR_MAX_BYTES, cursorFile } from '../shared/videoZoom.js';
import { PROXY_HEIGHTS, ProxyMaker } from './videoProxy.js';
import { Recorder, recordingName } from './recorder.js';
import { Transcriber } from './transcribe.js';
import { Scene3DService } from './scene3d.js';
import { BlenderBridge, newBridgeToken, type BridgeDeps } from './blenderBridge.js';
import { BridgeStore, MAX_ORIGINS, cleanOrigins } from './blenderBridgeStore.js';
import { BridgeJobQueue } from './bridgeJobs.js';
import { withProtocol } from './textTools.js';
import { Gen3DService } from './gen3d.js';
import { GEN3D_MODELS, isGen3dImage } from '../shared/gen3d.js';
import { isModelPath, sanitizeScene, type Scene3D } from '../shared/scene3d.js';
import type { VideoProject } from '../shared/video.js';
import type { VideoAgentResult } from '../shared/videoAgent.js';
import { communityTransitions } from './communityTransitions.js';
import { MEDIA_EXTENSIONS, PROJECT_EXT, mediaKindOf, validProject } from '../shared/video.js';

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
  // Video Studio media (only files the user picked): streamed with byte ranges.
  {
    scheme: 'zmedia',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  // Pages of the open project shown (and edited) in the Panel de Edición.
  // corsEnabled: the preview frame is sandboxed (opaque origin), so module scripts, fonts
  // and fetch() of the page are cross-origin requests; without it Chromium refuses them.
  {
    scheme: 'zxp',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
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
  /** The visual editor (Panel de Edición) of the open folder, while it is open. */
  design?: { root: string; session: DesignSession };
}

const wins = new Map<number, Win>();
let ai: AiService;
/** The always-on project reviewer (created with the AI service). */
let watcher: Watcher;
/** Which window each terminal belongs to. */
const termOwner = new Map<number, Win>();
/**
 * The last output of every terminal (the phone shows it and follows it), its name and size.
 * `start` is the offset of `text` in the whole output: the phone asks "after offset n".
 */
interface TermOut {
  name: string;
  text: string;
  start: number;
  alive: boolean;
  cols: number;
  rows: number;
  waiters: Set<() => void>;
}
const termOut = new Map<number, TermOut>();
/** Output kept per terminal for the phone. */
const TERM_KEEP = 256 * 1024;
/** Terminals the phone opened (not shown on the computer; closed when the remote stops). */
const phoneTerms = new Set<number>();
function termWake(o: TermOut): void {
  for (const w of [...o.waiters]) w();
}
function termTrack(id: number, name: string, cols: number, rows: number): void {
  termOut.set(id, { name, text: '', start: 0, alive: true, cols, rows, waiters: new Set() });
}
const terminals = new Terminals(
  (id, data) => {
    const o = termOut.get(id);
    if (o) {
      o.text += data;
      if (o.text.length > TERM_KEEP) {
        const cut = o.text.length - TERM_KEEP;
        o.text = o.text.slice(cut);
        o.start += cut;
      }
      termWake(o);
    }
    const w = termOwner.get(id);
    if (w) send(w, { type: 'term:data', id, data });
  },
  (id, code) => {
    const o = termOut.get(id);
    if (o) {
      o.alive = false;
      termWake(o);
      // The phone still reads how it ended for a while.
      setTimeout(() => termOut.delete(id), 10 * 60_000).unref();
    }
    phoneTerms.delete(id);
    const w = termOwner.get(id);
    termOwner.delete(id);
    w?.terminals.delete(id);
    if (w) send(w, { type: 'term:exit', id, code });
  },
);

// ---------------- phone remote ----------------

/** The window that started the remote (its Settings show the PIN; closing it stops it). */
let phoneOwner: Win | undefined;
/**
 * The window the phone works on now: the owner at first, another one when the phone switches
 * project (each window has its own folder, chats and browser, like on the computer).
 */
let phoneTarget: Win | undefined;
/** The last chats the target sent, re-sent with a fresh window list when windows change. */
let phoneSnap: PhoneSnapshotData | null = null;

function phoneWin(): Win | undefined {
  if (phoneTarget && wins.has(phoneTarget.id) && !phoneTarget.win.isDestroyed()) return phoneTarget;
  return phoneOwner;
}

/** The open windows for the phone's project tabs. */
function phoneWindows(): PhoneWindow[] {
  const cur = phoneWin();
  return [...wins.values()]
    .filter((o) => !o.win.isDestroyed())
    .map((o) => ({
      id: o.id,
      name: o.workspace ? basename(o.workspace.root) : '',
      ...(o.workspace ? { path: o.workspace.root } : {}),
      current: o === cur,
    }));
}

/** Sends the phone the last chats with the windows as they are now. */
function phoneRefresh(): void {
  if (!phoneOwner || !phoneSnap) return;
  phone.push({ ...phoneSnap, windows: phoneWindows(), todayUsd: ai.todayUsd() });
}

/** The phone works on `w` from now on; that window starts sending its chats. */
function setPhoneTarget(w: Win | undefined): void {
  const old = phoneWin();
  phoneTarget = w;
  if (old && old !== w) send(old, { type: 'phone:target', on: false });
  // Always (also to the same window): it answers with its chats right away.
  if (w) send(w, { type: 'phone:target', on: true });
  if (old !== w) phoneSnap = null;
  phoneRefresh();
}

/** The phone stopped: no window sends its chats any more. */
function clearPhoneTarget(): void {
  const cur = phoneWin();
  if (cur) send(cur, { type: 'phone:target', on: false });
  phoneTarget = undefined;
  phoneSnap = null;
}

const phoneRepos: PhoneRepos = {
  list: async () => {
    const open = phoneWin()?.workspace?.root;
    return mapLimit(findRepos(), 8, (p) => repoView(p, p === open));
  },
  pull: async (path) => runUntrustedGit(['pull', '--ff-only'], knownRepo(path), 300_000),
  open: async (path, newWindow) => {
    const target = phoneWin();
    if (!target) throw new Error('No hay ninguna ventana conectada al celular.');
    const abs = knownRepo(path);
    // Already open somewhere: the phone just moves to that window.
    const there = [...wins.values()].find((o) => o.workspace?.root === abs);
    if (there) return setPhoneTarget(there);
    if (newWindow) {
      if (wins.size >= MAX_PHONE_WINDOWS)
        throw new Error(`Ya hay ${wins.size} ventanas abiertas: cierra alguna en la computadora.`);
      const w = await createWindow({ folder: abs, near: target });
      if (!w.workspace) throw new Error('No se pudo abrir la carpeta.');
      return setPhoneTarget(w);
    }
    if (!(await openFolder(target, abs))) throw new Error('No se pudo abrir la carpeta.');
  },
};
/** The connected models for the phone's model picker, and the app default it can change. */
const phoneModels = {
  list: async (): Promise<PhoneModels> => {
    const [r, providers] = await Promise.all([ai.models(false), ai.providers()]);
    const local = new Set(providers.filter((p) => p.local).map((p) => p.id));
    const cfg = ai.core.config;
    return {
      models: r.models.slice(0, 1500).map((m) => ({
        ref: `${m.provider}/${m.id}`,
        provider: m.provider,
        label: m.label ?? m.id,
        local: local.has(m.provider),
        tools: m.capabilities.tools === true,
        vision: m.capabilities.vision === true,
        reasoning: m.capabilities.reasoning === true,
        context: m.context,
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
      })),
      defaultModel: cfg.defaultModel ?? null,
      roles: { chat: cfg.roles.chat, agent: cfg.roles.agent, inline: cfg.roles.inline },
      errors: r.errors,
    };
  },
  setDefault: (ref: string): void => {
    ai.setDefaultModel(ref);
    for (const w of wins.values()) send(w, { type: 'settings:changed' });
  },
};
/** The project of the window the phone controls (files and git work on it). */
function phoneWs(): Workspace {
  const w = phoneWin();
  if (!w?.workspace) throw new Error('No hay ninguna carpeta abierta en la computadora.');
  return w.workspace;
}
/** Largest file the phone downloads or previews in one go. */
const PHONE_RAW_MAX = 15 * 1024 * 1024;
function phoneTermView(id: number, phoneOwned: boolean): PhoneTerm | null {
  const o = termOut.get(id);
  if (!o) return null;
  return { id, name: o.name, phone: phoneOwned, alive: o.alive, cols: o.cols, rows: o.rows };
}
const phoneTools: PhoneTools = {
  files: {
    list: async (path) => {
      const ws = phoneWs();
      const abs = ws.resolve(path);
      const entries = await ws.readDir(path);
      const sized = await mapLimit(entries, 16, async (e) => {
        const st = await statAsync(join(abs, e.name)).catch(() => null);
        return { ...e, size: st && !e.dir ? st.size : undefined, mtime: st?.mtimeMs };
      });
      return { root: ws.root, name: basename(ws.root), entries: sized };
    },
    read: async (path) => {
      const ws = phoneWs();
      const st = await statAsync(ws.resolve(path));
      if (st.isDirectory()) throw new Error('Es una carpeta.');
      // The phone edits text up to 2 MB (bigger ones are downloaded instead).
      if (st.size > 2 * 1024 * 1024)
        return { content: '', binary: false, tooLarge: true, size: st.size };
      return { ...(await ws.readFile(path)), size: st.size };
    },
    raw: async (path) => {
      const ws = phoneWs();
      const st = await statAsync(ws.resolve(path));
      if (st.isDirectory()) throw new Error('Es una carpeta.');
      if (st.size > PHONE_RAW_MAX)
        throw new Error('El archivo es muy grande para el celular (más de 15 MB).');
      return readFile(ws.resolve(path));
    },
    write: async (path, content) => {
      const ws = phoneWs();
      await ws.writeFile(path, content);
    },
    create: async (path, dir) => {
      const ws = phoneWs();
      if (dir) await ws.createDir(path);
      else await ws.createFile(path);
    },
    rename: async (from, to) => phoneWs().rename(from, to),
    trash: async (path) => {
      const ws = phoneWs();
      const abs = ws.resolve(path);
      if (abs === resolve(ws.root)) throw new Error('No se puede borrar la carpeta del proyecto.');
      await shell.trashItem(abs);
    },
    find: async (query) => {
      const q = query.toLowerCase();
      const all = await phoneWs().listFiles();
      return all.filter((p) => p.toLowerCase().includes(q)).slice(0, 200);
    },
  },
  terminals: {
    list: () => {
      const w = phoneWin();
      const out: PhoneTerm[] = [];
      for (const id of w?.terminals ?? []) {
        const v = phoneTermView(id, false);
        if (v) out.push(v);
      }
      for (const id of phoneTerms) {
        const v = phoneTermView(id, true);
        if (v) out.push(v);
      }
      return out;
    },
    create: (cols, rows) => {
      if (phoneTerms.size >= 8) throw new Error('Ya hay 8 terminales abiertas desde el celular.');
      const cwd = phoneWin()?.workspace?.root ?? app.getPath('home');
      const t = terminals.create(cwd, cols, rows);
      if (!t) throw new Error('No se pudo abrir la terminal.');
      termTrack(t.id, t.name, cols, rows);
      phoneTerms.add(t.id);
      return phoneTermView(t.id, true)!;
    },
    read: async (id, since, abort) => {
      const o = termOut.get(id);
      if (!o) throw new Error('Esa terminal ya no existe.');
      const end = () => o.start + o.text.length;
      if (since >= end() && o.alive && !abort.aborted) {
        await new Promise<void>((ok) => {
          const done = () => {
            clearTimeout(timer);
            o.waiters.delete(done);
            abort.removeEventListener('abort', done);
            ok();
          };
          const timer = setTimeout(done, 20_000);
          o.waiters.add(done);
          abort.addEventListener('abort', done);
        });
      }
      const from = Math.max(since, o.start);
      return {
        from,
        data: from < end() ? o.text.slice(from - o.start) : '',
        next: end(),
        alive: o.alive,
        cols: o.cols,
        rows: o.rows,
      };
    },
    write: (id, data) => terminals.write(id, data),
    resize: (id, cols, rows) => {
      // Only the phone's own shells: the computer's keep the size of its panel.
      if (!phoneTerms.has(id)) return;
      terminals.resize(id, cols, rows);
      const o = termOut.get(id);
      if (o) {
        o.cols = cols;
        o.rows = rows;
      }
    },
    kill: (id) => {
      if (!phoneTerms.has(id)) throw new Error('Esa terminal es de la computadora: ciérrala allí.');
      terminals.kill(id);
      phoneTerms.delete(id);
      termOut.delete(id);
    },
  },
  git: {
    status: async () => new Git(phoneWs()).status(),
    log: async () => new Git(phoneWs()).log(40),
    diff: async (path) => {
      const ws = phoneWs();
      const rel = ws.toRel(ws.resolve(path));
      const out = await runGit(
        'git',
        ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', rel],
        ws.root,
      ).catch(() => '');
      if (out.trim()) return out.slice(0, 400_000);
      // New file (not in git yet): all of it is new.
      const f = await ws.readFile(rel).catch(() => null);
      if (!f || f.binary || f.tooLarge) return '';
      return f.content
        .slice(0, 400_000)
        .split('\n')
        .map((l) => `+${l}`)
        .join('\n');
    },
    commit: async (message, paths) => {
      const g = new Git(phoneWs());
      await g.stage(paths ?? []);
      await g.commit(message, false);
    },
    sync: async (op) => new Git(phoneWs()).sync(op),
  },
  config: {
    get: async (): Promise<PhoneConfigView> => {
      const cfg = ai.core.config;
      const u = ai.usage();
      const sum = (rows: { costUsd: number }[]) => rows.reduce((a, r) => a + r.costUsd, 0);
      const row = (r: (typeof u.today)[number]) => ({
        provider: r.provider,
        name: r.name,
        costUsd: r.costUsd,
        requests: r.requests,
      });
      const p = prefs();
      const budgets: PhoneConfigView['usage']['budgets'] = {};
      for (const [k, b] of Object.entries(u.budgets))
        budgets[k] = { daily: b.daily, monthly: b.monthly };
      return {
        version: app.getVersion(),
        defaultModel: cfg.defaultModel ?? null,
        roles: { chat: cfg.roles.chat, agent: cfg.roles.agent, inline: cfg.roles.inline },
        localOnly: cfg.privacy.localOnly,
        theme: loadState().theme ?? 'dark',
        themes: THEME_IDS,
        prefs: Object.fromEntries(
          PHONE_PREF_KEYS.map((k) => [k, p[k]]),
        ) as PhoneConfigView['prefs'],
        zoomSteps: [...UI_ZOOM_STEPS],
        usage: {
          today: u.today.map(row),
          month: u.month.map(row),
          todayUsd: sum(u.today),
          monthUsd: sum(u.month),
          budgets,
        },
        providers: (await ai.providers())
          .filter((x) => x.connected)
          .map((x) => ({ id: x.id, name: x.name, local: x.local })),
      };
    },
    set: async (patch) => {
      if (patch.defaultModel) ai.setDefaultModel(patch.defaultModel);
      if (patch.role) ai.setRole(patch.role.role, patch.role.ref);
      if (patch.localOnly !== undefined) ai.setLocalOnly(patch.localOnly);
      if (patch.theme) saveState({ theme: patch.theme });
      if (patch.prefs) setPrefs(patch.prefs);
      if (patch.budget) {
        const { provider, daily, monthly } = patch.budget;
        ai.setBudget(provider, daily || monthly ? { daily, monthly } : null);
      }
      // Every window picks the change up (models, theme, editor) like a change made on the PC.
      for (const w of wins.values()) send(w, { type: 'settings:changed' });
    },
  },
};
/** Closes the shells the phone opened (the remote stopped or the terminal was turned off). */
function closePhoneTerms(): void {
  for (const id of [...phoneTerms]) {
    terminals.kill(id);
    termOut.delete(id);
  }
  phoneTerms.clear();
}
/** Windows the phone may have open at once (each one runs its own editor, chats, browser). */
const MAX_PHONE_WINDOWS = 12;
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
    req.channel === 'phone'
      ? 'el control desde el celular'
      : `el bot de ${req.channel === 'telegram' ? 'Telegram' : 'Discord'}`;
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: 'Nuevo dispositivo',
    message: `¿Permitir que este dispositivo controle Zinarix mediante ${via}?`,
    detail: `${req.who}\n\nEscribió el PIN correcto. Si no fuiste tú, pulsa Rechazar: el PIN cambiará. Quien se conecte podrá usar la IA, tus repositorios, los archivos del proyecto y la terminal desde ahí (puedes limitarlo en Configuración → Celular).`,
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
  if (!phoneOwner) return;
  if (action.kind === 'window') {
    const w = wins.get(action.id);
    if (w && !w.win.isDestroyed()) setPhoneTarget(w);
    return;
  }
  const w = phoneWin();
  if (w) send(w, { type: 'phone', action });
};
const phone = new PhoneRemote(
  phoneAction,
  (status) => {
    if (phoneOwner) send(phoneOwner, { type: 'phone:status', status });
  },
  phoneRepos,
  approvePairing,
  () => join(app.getPath('userData'), 'pairing-guard.json'),
  phoneModels,
  {
    // Paired phones and the link survive a restart (same link, no new pairing).
    file: () => join(app.getPath('userData'), 'phone-remote.json'),
    seal: (plain) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('no safeStorage');
      return safeStorage.encryptString(plain).toString('base64');
    },
    open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
  },
  phoneTools,
  // The free tunnel's address changes; a gist keeps the link on the phone the same.
  githubBeacon,
);
phone.onTerminalOff = closePhoneTerms;
// The Android app (apps/remote-android, built by scripts/build-remote-apk.mjs) ships next to the
// app: Settings → Celular saves it, and phones download it from this computer.
const remoteAppDir = app.isPackaged
  ? join(process.resourcesPath, 'remote-app')
  : join(appRoot, 'build', 'remote-app');
phone.appApk = join(remoteAppDir, 'Zinarix-Remote.apk');
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
  clearPhoneTarget();
  bots.detach();
  phone.stop();
  closePhoneTerms();
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
  mode: z.enum(['ask', 'plan', 'agent', 'auto', 'full']).optional(),
  model: z.string().max(300).nullable().optional(),
  shownModel: z.string().max(300).nullable().optional(),
  queued: z.number().int().nonnegative().max(10_000).optional(),
  busy: z.boolean(),
  turns: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(100_000),
        error: z.string().max(5000).optional(),
        model: z.string().max(300).optional(),
        tools: z
          .array(z.object({ id: id200, title: z.string().max(500), status: toolState }))
          .max(200),
      }),
    )
    .max(100),
});
type PhoneSnapshotData = z.infer<typeof PhoneSnapshot>;

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

/** Login item reasons: a chat to resume (opens the window), the permanent bridge (hidden). */
const loginWants = { resume: false, background: false };
/** Started at login only for the bridge: no window, just the tray. */
const BACKGROUND_ARG = '--background';

function resumeOnLogin(on: boolean): void {
  loginWants.resume = on;
  applyLoginItem();
}

function applyLoginItem(): void {
  if (!app.isPackaged) return;
  const on = loginWants.resume || loginWants.background;
  // A chat to continue needs the window; the bridge alone starts out of sight.
  const args = loginWants.resume ? [] : [BACKGROUND_ARG];
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
          `Name=${APP_NAME}\nExec="${exec.replace(/"/g, '\\"')}"${args.map((a) => ` ${a}`).join('')}\n` +
          'X-GNOME-Autostart-enabled=true\nNoDisplay=true\n',
      );
    } else {
      // args: Windows only (macOS opens with its window).
      app.setLoginItemSettings({ openAtLogin: on, args });
    }
  } catch {
    // not allowed here: the task still goes on the next time the app is opened by hand
  }
}

function prefs(): Prefs {
  const p = loadState().prefs ?? {};
  return { ...DEFAULT_PREFS, ...p, keybindings: { ...p.keybindings } };
}

/** Saves a change of the preferences and applies what main owns (zoom, LSP, rules, tasks). */
function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...prefs(), ...patch };
  saveState({ prefs: next });
  if (patch.lsp !== undefined || patch.lspCommands)
    for (const h of lspHosts.values()) void h.restart();
  ai.useRules = next.projectRules;
  if (patch.taskParallel !== undefined) tasks?.setMaxParallel(patch.taskParallel);
  applyZoom();
  return next;
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
  phoneRefresh();
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

// ---------------- Video Studio ----------------

let video: VideoService | undefined;
/** Project files the user opened or saved through a dialog (saving there needs no new dialog). */
const videoPaths = new Set<string>();
/** Export targets the user chose in the save dialog (the only places exports may write). */
const videoOutputs = new Set<string>();
const videoJobOwner = new Map<string, Win>();
const sttRuns = new Map<string, AbortController>();
let stt: Transcriber | undefined;
function transcriber(): Transcriber {
  return (stt ??= new Transcriber(
    ai.core,
    app.getPath('userData'),
    () => videoService().tools().ffmpeg,
  ));
}
function videoService(): VideoService {
  return (video ??= new VideoService(
    appRoot,
    app.getPath('userData'),
    (job) => {
      const w = videoJobOwner.get(job.id);
      if (w) send(w, { type: 'video:job', job });
      if (job.state === 'done' && Notification.isSupported())
        new Notification({ title: 'Video exportado', body: basename(job.out) }).show();
    },
    app.isPackaged ? process.resourcesPath : undefined,
  ));
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
/** Fase 2A (plan de funciones): Jupyter kernels of each window (by webContents id). */
const notebookKernels = new Map<number, NotebookKernels>();
/** Kernels the agent started for a folder no window has open (by folder). */
const agentKernels = new Map<string, NotebookKernels>();
function notebooksOf(w: Win): NotebookKernels {
  let k = notebookKernels.get(w.id);
  if (!k) {
    k = new NotebookKernels((event) => send(w, { type: 'notebook', event }));
    notebookKernels.set(w.id, k);
  }
  return k;
}
/** Test runs of each window (by webContents id). */
const testRuns = new Map<number, TestManager>();
function testsOf(w: Win): TestManager {
  let t = testRuns.get(w.id);
  if (!t) {
    t = new TestManager((event) => send(w, { type: 'tests', event }));
    testRuns.set(w.id, t);
  }
  return t;
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
        special: godotLspServer,
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

/** Cloud sync with the user's own Supabase (set up in registerIpc). */
let cloud: CloudSync | undefined;

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
    void notebookKernels.get(w.id)?.dispose();
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
  handle(
    'workspace:readBytes',
    z.tuple([
      rel,
      z.number().int().min(0),
      z
        .number()
        .int()
        .min(0)
        .max(8 * 1024 * 1024),
    ]),
    (w, p, offset, length) => ws(w).readBytes(p, offset, length),
  );
  handle('workspace:writeFile', z.tuple([rel, big]), (w, p, c) => ws(w).writeFile(p, c));
  handle(
    'workspace:writeBytes',
    z.tuple([rel, z.instanceof(Uint8Array).refine((b) => b.byteLength <= 256 * 1024 * 1024)]),
    (w, p, b) => ws(w).writeBytes(p, b),
  );
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
  // Fase 8: acceptance metric of the editor suggestions.
  handle(
    'ai:suggestionOutcome',
    z.tuple([
      z.enum(['inline', 'nextEdit']),
      z.enum(['accepted', 'dismissed']),
      z.number().int().min(1).max(8),
    ]),
    (_w, kind, outcome, count) => ai.suggestionOutcome(kind, outcome, count),
  );
  handle('ai:suggestionStats', z.tuple([]), () => ai.suggestionStats());
  handle('ai:suggestionStatsClear', z.tuple([]), () => ai.metrics.clear());
  // Fase 8: chat mentions resolved in main (@git, @web).
  handle(
    'ai:mention',
    z.tuple([z.enum(['git', 'web']), z.string().max(2048).nullable()]),
    async (w, kind, arg) => {
      if (kind === 'git') return gitMention(git(w), arg ?? undefined);
      if (!arg) throw new Error('@web necesita una dirección: @web:https://…');
      return webMention(arg, AbortSignal.timeout(20_000));
    },
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

  // ---------------- Video Studio ----------------
  const absPath = z.string().min(1).max(4096);
  const projectArg = z.custom<VideoProject>((x) => validProject(x), 'proyecto de video no válido');
  const exportArg = z.object({
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
    fps: z.number().min(1).max(240),
    crf: z.number().int().min(0).max(51),
    preset: z.enum(['veryfast', 'fast', 'medium', 'slow']),
    audioKbps: z.number().int().min(32).max(512),
    start: z.number().min(0),
    end: z.number().min(0),
    loudness: z.number().min(-40).max(-5).nullable().optional(),
  });
  const mediaFilters = [
    {
      name: 'Medios',
      extensions: [...MEDIA_EXTENSIONS.video, ...MEDIA_EXTENSIONS.audio, ...MEDIA_EXTENSIONS.image],
    },
    { name: 'Video', extensions: [...MEDIA_EXTENSIONS.video] },
    { name: 'Audio', extensions: [...MEDIA_EXTENSIONS.audio] },
    { name: 'Imágenes', extensions: [...MEDIA_EXTENSIONS.image] },
  ];
  const projectFilters = [{ name: 'Proyecto de Zinarix Video', extensions: [PROJECT_EXT] }];
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  const videoDir = () => {
    const d = join(app.getPath('userData'), 'video');
    mkdirSync(d, { recursive: true });
    return d;
  };
  const safeName = (n: string, fallback: string) =>
    n.replace(/[\\/:*?"<>|]+/g, ' ').trim() || fallback;
  handle('video:tools', z.tuple([]), () => {
    const t = videoService().tools();
    return { ffmpeg: Boolean(t.ffmpeg && t.ffprobe), version: t.version };
  });
  handle('video:pickMedia', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Importar medios',
      properties: ['openFile', 'multiSelections'],
      filters: mediaFilters,
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle('video:probe', z.tuple([absPath]), (_w, p) => videoService().probe(resolve(p)));
  // Fase 12: 3D LUTs for the colour page (only .cube files are read).
  handle('video:pickLut', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Cargar LUT',
      properties: ['openFile'],
      filters: [{ name: 'LUT 3D (.cube)', extensions: ['cube'] }],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle('video:readLut', z.tuple([absPath]), (_w, p) => readLut(resolve(p)));
  // Fase 13: transcription, silences and scenes (media files only).
  const mediaFile = (p: string) => {
    if (!mediaKindOf(p) || !isFile(p)) throw new Error('archivo no válido');
    return resolve(p);
  };
  const seconds = z.number().min(0).max(86_400);
  handle('video:sttEngines', z.tuple([]), () => transcriber().engines());
  handle(
    'video:transcribe',
    z.tuple([
      z.string().min(1).max(80),
      absPath,
      z.enum(['local', 'openai', 'groq']),
      seconds,
      z.string().max(8).optional(),
    ]),
    async (_w, id, p, engine, duration, lang) => {
      const ac = new AbortController();
      sttRuns.set(id, ac);
      try {
        return await transcriber().transcribe(mediaFile(p), engine, duration, lang, ac.signal);
      } finally {
        sttRuns.delete(id);
      }
    },
  );
  handle('video:sttAbort', z.tuple([z.string().max(80)]), (_w, id) => sttRuns.get(id)?.abort());
  handle(
    'video:silences',
    z.tuple([absPath, seconds, z.number().min(-80).max(-10), z.number().min(0.1).max(10)]),
    (_w, p, d, db, min) => transcriber().silences(mediaFile(p), d, db, min),
  );
  handle(
    'video:scenes',
    z.tuple([absPath, seconds, z.number().min(0.05).max(0.9)]),
    (_w, p, d, t) => transcriber().scenes(mediaFile(p), d, t),
  );
  handle('video:communityTransitions', z.tuple([z.boolean()]), (_w, force) =>
    communityTransitions(force),
  );
  handle(
    'video:saveCaptions',
    z.tuple([z.string().max(512), z.string().max(20_000_000), z.enum(['srt', 'vtt'])]),
    async (w, name, text, ext) => {
      const r = await dialog.showSaveDialog(w.win, {
        title: 'Guardar subtítulos',
        defaultPath: join(app.getPath('videos'), `${safeName(name, 'subtitulos')}.${ext}`),
        filters: [{ name: ext === 'srt' ? 'SubRip (.srt)' : 'WebVTT (.vtt)', extensions: [ext] }],
      });
      if (r.canceled || !r.filePath) return null;
      const out = r.filePath.toLowerCase().endsWith(`.${ext}`)
        ? r.filePath
        : `${r.filePath}.${ext}`;
      await writeFile(out, text, 'utf8');
      return out;
    },
  );
  handle('video:workspacePath', z.tuple([rel]), (w, p) => {
    const abs = ws(w).resolve(p);
    return isFile(abs) && (mediaKindOf(abs) || abs.toLowerCase().endsWith(`.${PROJECT_EXT}`))
      ? abs
      : null;
  });
  // Only media files: the protocol never serves anything else the renderer names.
  handle('video:mediaUrl', z.tuple([absPath]), (_w, p) =>
    mediaKindOf(p) && isFile(p) ? videoService().urlFor(resolve(p)) : null,
  );
  handle(
    'video:thumbnails',
    z.tuple([absPath, z.number().min(0).max(1e6), z.number().int().min(1).max(200)]),
    (_w, p, d, n) => {
      if (!mediaKindOf(p) || !isFile(p)) throw new Error('archivo no válido');
      return videoService().thumbnails(resolve(p), d, n);
    },
  );
  handle('video:waveform', z.tuple([absPath]), (_w, p) => {
    if (!mediaKindOf(p) || !isFile(p)) throw new Error('archivo no válido');
    return videoService().waveform(resolve(p));
  });
  handle(
    'video:saveProject',
    z.tuple([projectArg, absPath.nullable(), z.boolean()]),
    async (w, project, path, saveAs) => {
      let target = path && !saveAs && videoPaths.has(resolve(path)) ? resolve(path) : null;
      if (!target) {
        const r = await dialog.showSaveDialog(w.win, {
          title: 'Guardar proyecto de video',
          defaultPath: `${safeName(project.name, 'proyecto')}.${PROJECT_EXT}`,
          filters: projectFilters,
        });
        if (r.canceled || !r.filePath) return null;
        target = resolve(r.filePath);
      }
      // The previous version goes to the history (the last 20 per project).
      if (isFile(target)) {
        const hist = join(
          videoDir(),
          'versions',
          createHash('sha256').update(target).digest('hex').slice(0, 16),
        );
        mkdirSync(hist, { recursive: true });
        writeFileSync(join(hist, `${Date.now()}.${PROJECT_EXT}`), readFileSync(target));
        for (const f of readdirSync(hist).sort().slice(0, -20))
          rmSync(join(hist, f), { force: true });
      }
      writeFileSync(target, JSON.stringify(toStored(project, dirname(target)), null, 1), 'utf8');
      videoPaths.add(target);
      return target;
    },
  );
  handle('video:openProject', z.tuple([absPath.nullable()]), async (w, path) => {
    let target = path ? resolve(path) : null;
    if (!target) {
      const r = await dialog.showOpenDialog(w.win, {
        title: 'Abrir proyecto de video',
        properties: ['openFile'],
        filters: projectFilters,
      });
      if (r.canceled || !r.filePaths[0]) return null;
      target = resolve(r.filePaths[0]);
    }
    if (!target.toLowerCase().endsWith(`.${PROJECT_EXT}`) || !isFile(target))
      throw new Error('No es un proyecto de video.');
    const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'));
    if (!validProject(parsed)) throw new Error('El archivo del proyecto está dañado.');
    const project = fromStored(parsed, dirname(target));
    for (const m of project.media) if (!m.missing) videoService().urlFor(m.path);
    videoPaths.add(target);
    return { path: target, project };
  });
  handle(
    'video:autosave',
    z.tuple([projectArg.nullable(), absPath.nullable()]),
    (_w, project, path) => {
      const file = join(videoDir(), 'autosave.json');
      if (!project) return void rmSync(file, { force: true });
      writeFileSync(file, JSON.stringify({ savedAt: Date.now(), path, project }), 'utf8');
    },
  );
  handle('video:recover', z.tuple([]), () => {
    const file = join(videoDir(), 'autosave.json');
    if (!isFile(file)) return null;
    try {
      const j = JSON.parse(readFileSync(file, 'utf8')) as {
        savedAt: number;
        path: string | null;
        project: unknown;
      };
      if (!validProject(j.project)) return null;
      // Autosaves keep absolute paths (no project folder to be relative to).
      const project = fromStored(j.project, j.path ? dirname(j.path) : videoDir());
      for (const m of project.media) if (!m.missing) videoService().urlFor(m.path);
      if (j.path) videoPaths.add(resolve(j.path));
      return { project, path: j.path, savedAt: j.savedAt };
    } catch {
      return null;
    }
  });
  handle('video:relink', z.tuple([z.string().max(512)]), async (w, name) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: `Volver a vincular: ${name}`,
      properties: ['openFile'],
      filters: mediaFilters,
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle('video:exportPath', z.tuple([z.string().max(512)]), async (w, name) => {
    const r = await dialog.showSaveDialog(w.win, {
      title: 'Exportar video',
      defaultPath: join(app.getPath('videos'), `${safeName(name, 'video')}.mp4`),
      filters: [{ name: 'MP4 (H.264)', extensions: ['mp4'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const out = resolve(
      r.filePath.toLowerCase().endsWith('.mp4') ? r.filePath : `${r.filePath}.mp4`,
    );
    videoOutputs.add(out);
    return out;
  });
  // Exports write only where the user chose in the save dialog.
  // Titles come as PNGs the renderer drew at the export size (at most 2000 — automatic
  // captions of a long interview are hundreds —, 40 MB each and 600 MB together).
  const PNG_URL = 'data:image/png;base64,';
  const textPngsArg = z
    .record(z.string().regex(/^[\w-]{1,64}$/), z.string().max(56_000_000).startsWith(PNG_URL))
    .refine((r) => Object.keys(r).length <= 2000, 'demasiados títulos')
    .refine(
      (r) => Object.values(r).reduce((n, v) => n + v.length, 0) <= 800_000_000,
      'los títulos pesan demasiado',
    )
    .optional();
  handle(
    'video:export',
    z.tuple([projectArg, exportArg, absPath, textPngsArg]),
    (w, project, options, out, texts) => {
      const target = resolve(out);
      if (!videoOutputs.has(target)) throw new Error('Elige primero dónde guardar el video.');
      if (!(options.end > options.start)) throw new Error('El rango a exportar está vacío.');
      const pngs: Record<string, Buffer> = {};
      for (const [id, url] of Object.entries(texts ?? {})) {
        const buf = Buffer.from(url.slice(PNG_URL.length), 'base64');
        // The PNG signature: anything else is dropped.
        if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          pngs[id] = buf;
      }
      const job = videoService().enqueue(project, options, target, pngs);
      videoJobOwner.set(job.id, w);
      send(w, { type: 'video:job', job });
      return job;
    },
  );
  handle('video:jobs', z.tuple([]), () => videoService().list());
  handle('video:cancel', z.tuple([z.string().max(64)]), (_w, jobId) =>
    videoService().cancel(jobId),
  );
  handle('video:reveal', z.tuple([absPath]), (_w, p) => {
    const target = resolve(p);
    if (isFile(target) && (videoOutputs.has(target) || videoPaths.has(target)))
      shell.showItemInFolder(target);
  });
  handle('video:cacheSize', z.tuple([]), () => videoService().cacheSize());
  handle('video:clearCache', z.tuple([]), () => videoService().clearCache());
  // Debugger: one session per window, rooted at its open folder.
  const bpList = z
    .array(
      z.object({
        line: z.number().int().min(1).max(10_000_000),
        condition: z.string().max(2000).optional(),
        logMessage: z.string().max(2000).optional(),
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
  // Test Explorer. The renderer only names files and tests: main builds the command.
  setTestResultsDir(join(app.getPath('userData'), 'test-results'));
  const testTarget = z.object({
    file: rel,
    fullName: z.string().max(4000),
    kind: z.enum(['suite', 'test']),
    dynamic: z.boolean().optional(),
  });
  const testReq = z.object({
    framework: z.enum(['vitest', 'jest', 'pytest']),
    cwd: z.string().max(4096),
    files: z.array(rel).max(5000).optional(),
    item: testTarget.optional(),
    items: z.array(testTarget).max(500).optional(),
    related: z.array(rel).max(200).optional(),
  });
  /** Every path of a request must stay inside the open folder. */
  const checkTestReq = (w: Win, req: TestRunRequest): TestRunRequest => {
    const wsp = ws(w);
    if (req.cwd) wsp.resolve(req.cwd);
    for (const f of req.files ?? []) wsp.resolve(f);
    for (const f of req.related ?? []) wsp.resolve(f);
    if (req.item) wsp.resolve(req.item.file);
    for (const i of req.items ?? []) wsp.resolve(i.file);
    return req;
  };
  handle('tests:discover', z.tuple([]), async (w) =>
    discoverTests(ws(w).root, await ws(w).listFiles()),
  );
  handle('tests:run', z.tuple([testReq]), (w, req) =>
    testsOf(w).run(ws(w).root, checkTestReq(w, req)),
  );
  handle('tests:cancel', z.tuple([]), (w) => testsOf(w).cancel());
  handle('tests:last', z.tuple([]), async (w) => (await loadLastRun(ws(w).root)) ?? null);
  handle('tests:clear', z.tuple([]), (w) => clearLastRun(ws(w).root));
  handle('debug:startTest', z.tuple([testReq, z.record(rel, bpList)]), (w, req, bps) =>
    debugOf(w).startTest(ws(w).root, checkTestReq(w, req), bps),
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
  handle(
    'ai:improvePrompt',
    z.tuple([z.string().min(1).max(20000), z.string().max(300).optional()]),
    (_w, prompt, model) => ai.improvePrompt(prompt, model),
  );
  handle('ai:rulesFile', z.tuple([z.string().min(1).max(4096).optional()]), (w, folder) =>
    ai.rulesFile(scope(w, folder)),
  );
  handle(
    'ai:activeRules',
    z.tuple([
      z.array(z.string().max(4200)).max(200),
      z.string().max(200_000).optional(),
      z.string().min(1).max(4096).optional(),
    ]),
    (w, sources, prompt, folder) => ai.activeRules(scope(w, folder), sources, prompt ?? ''),
  );
  handle('ai:agentKit', z.tuple([z.string().min(1).max(4096).optional()]), (w, folder) =>
    ai.agentKit(scope(w, folder)),
  );
  handle(
    'ai:createKitFile',
    z.tuple([
      z.enum(['agent', 'skill', 'command']),
      z.string().min(1).max(64),
      z.string().min(1).max(4096).optional(),
    ]),
    (w, kind, name, folder) => ai.createKitFile(scope(w, folder), kind, name),
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
  registerAutomationsIpc(vercel);
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
  ai.agent.hookTrust = new HookTrust(app.getPath('userData'));
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
  registerDesignIpc();
  registerHelperIpc();
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
    z.tuple([
      gproj,
      z
        .string()
        .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
        .max(200),
      z.boolean(),
    ]),
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
  handle('gcloud:resources', z.tuple([gproj, z.enum(GCLOUD_KINDS)]), (_w, p, k) =>
    gcloud.resources(p, k),
  );
  handle('gcloud:vmPower', z.tuple([gproj, gname, gname, z.boolean()]), (_w, p, zone, n, on) =>
    gcloud.vmPower(p, zone, n, on),
  );
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
      autoImport: z.boolean(),
      helperBubble: z.boolean(),
      helperModel: z.string().regex(MODEL_NAME),
      windowEffects: z.boolean(),
      taskParallel: z.number().int().min(1).max(8),
    })
    .partial();
  handle('app:prefs', z.tuple([]), () => prefs());
  handle('app:setPrefs', z.tuple([prefsPatch]), (w, patch) => {
    const next = setPrefs(patch);
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
        mode: z.enum(['plan', 'agent', 'auto', 'full']).optional(),
        folder: z.string().min(1).max(4096).optional(),
        noFolder: z.boolean().optional(),
        images: z
          .array(
            z.object({
              mediaType: z.enum(IMAGE_TYPES),
              data: z
                .string()
                .min(1)
                .max(MAX_IMAGE_B64)
                .regex(/^[A-Za-z0-9+/=]+$/),
            }),
          )
          .max(MAX_IMAGES)
          .optional(),
        reasoning: z.enum(['low', 'medium', 'high']).optional(),
        computer: z.boolean().optional(),
        uiLang: z.enum(['es', 'en']).optional(),
        bot: z.string().uuid().optional(),
      }),
    ]),
    (w, requestId, { folder, noFolder, ...req }) => {
      // The answer is saved when it ends: sync a while after the last chat started.
      cloud?.later(90_000);
      // Several chats of the same window (or of other windows) run at the same time: each
      // request is independent and only its own window hears its events.
      const id = rid(w, requestId);
      // A chat in no folder sees no project at all (only the window's browser).
      const where: Scope = noFolder
        ? { workspace: () => undefined, browser: w.browser }
        : scope(w, folder);
      // Fase 5: a chat on a task's worktree ("Open chat") keeps the task's limits, and does
      // not run while the task itself works there (two agents on the same files).
      const task =
        !noFolder && folder && isInside(tasksDir(), resolve(folder), process.platform === 'win32')
          ? taskManager().scopeFor(folder)
          : undefined;
      if (task?.busy) {
        send(w, {
          type: 'chat',
          requestId,
          event: {
            type: 'error',
            code: 'task_busy',
            message: `La tarea "${task.title}" está trabajando en esta carpeta. Pausa la tarea o espera a que termine para escribir aquí.`,
          },
        });
        return;
      }
      if (task) where.task = task.scope;
      // "Compu" on: the input helper starts now, while the model thinks its first step.
      if (req.computer && ai.agent.computer instanceof Computer) ai.agent.computer.warm();
      if (req.computer)
        where.computerUi = (stop) => {
          const pc = ai.agent.computer;
          return new ComputerControlRun(
            w.win,
            stop,
            // The bar speaks the language of Zinarix (the window's), else the system's.
            // "Zinarix Studio AI navegando…": the name of this edition of the app.
            barLabelsFor(req.uiLang ?? (app.getLocale().startsWith('en') ? 'en' : 'es'), APP_NAME),
            pc instanceof Computer ? { cursor: () => pc.rawCursor() } : {},
          );
        };
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
  handle(
    'ai:answerQuestion',
    z.tuple([str, str, z.array(z.string().max(2000)).max(10).nullable()]),
    (w, r, id, answer) => ai.answerQuestion(rid(w, r), id, answer),
  );
  handle('ai:revert', z.tuple([conv, z.string().min(1).max(4096).optional()]), (w, c, folder) =>
    ai.revert(c, scope(w, folder)),
  );
  // Fase 2: the UI names exchanges by its own request ids; the agent tagged them per window.
  // A conversation opened from the history already carries the tagged id ("<window>:<id>",
  // saved with the message): it is kept as it is, also after a restart.
  const turnId = (w: Win, t: string) => (t.includes(':') ? t : rid(w, t));
  const turnList = z.array(str).max(10_000);
  handle(
    'ai:rewind',
    z.tuple([conv, turnList, z.string().min(1).max(4096).optional()]),
    (w, c, turns, folder) =>
      ai.rewind(
        c,
        turns.map((t) => turnId(w, t)),
        scope(w, folder),
      ),
  );
  handle(
    'ai:rewindPreview',
    z.tuple([conv, turnList, z.string().min(1).max(4096).optional()]),
    (w, c, turns, folder) =>
      ai.rewindPreview(
        c,
        turns.map((t) => turnId(w, t)),
        scope(w, folder),
      ),
  );
  handle('ai:rewindConversation', z.tuple([conv, z.number().int().min(0).max(1e6)]), (_w, c, i) =>
    ai.rewindConversation(c, i),
  );
  handle(
    'ai:turnDiff',
    z.tuple([conv, str, z.string().min(1).max(4096).optional()]),
    (w, c, t, folder) => ai.turnDiff(c, turnId(w, t), scope(w, folder)),
  );
  handle(
    'ai:applyReview',
    z.tuple([
      conv,
      str,
      z.string().min(1).max(4096),
      z.array(z.number().int().min(0).max(1e6)).max(100_000),
      z.string().min(1).max(4096).optional(),
    ]),
    (w, c, t, path, rejected, folder) =>
      ai.applyReview(c, turnId(w, t), path, rejected, scope(w, folder)),
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
  handle('browser:stop', z.tuple([tabId]), (w, t) => w.browser.stop(t));
  // History and bookmarks are shared by every window (one file in userData).
  const withIcons = (entries: { url: string }[]) => ({
    entries,
    icons: browserData().iconsFor(entries.map((e) => e.url)),
  });
  handle(
    'browser:history',
    z.tuple([z.string().max(500), z.number().int().min(1).max(5000).optional()]),
    (_w, q, limit) => withIcons(browserData().history(q, limit ?? 300)),
  );
  handle('browser:suggest', z.tuple([z.string().max(500)]), (_w, q) =>
    withIcons(browserData().suggest(q)),
  );
  handle('browser:forget', z.tuple([z.string().max(4096).nullable()]), (_w, url) => {
    if (url === null) browserData().clearHistory();
    else browserData().forget(url);
  });
  handle('browser:bookmarks', z.tuple([]), () =>
    withIcons(
      browserData()
        .bookmarks()
        .map((b) => ({ ...b, visits: 0, bookmark: true })),
    ),
  );
  handle(
    'browser:toggleBookmark',
    z.tuple([z.string().max(4096), z.string().max(500)]),
    (_w, url, title) => {
      const on = browserData().toggleBookmark(url, title);
      for (const x of wins.values()) x.browser.refresh();
      return on;
    },
  );
  handle('browser:state', z.tuple([]), (w) => w.browser.state());
  handle('browser:home', z.tuple([tabId]), (w, t) => w.browser.home(t));
  handle('browser:tabs', z.tuple([]), (w) => w.browser.view());
  handle('browser:selectTab', z.tuple([z.string().max(64)]), (w, id) => w.browser.select(id));
  handle('browser:closeTab', z.tuple([z.string().max(64)]), (w, id) => w.browser.close(id));
  handle('browser:newTab', z.tuple([]), (w) => void w.browser.newTab());
  // Cookies exported from a regular browser (Cookie-Editor JSON or cookies.txt): the user
  // picks the file, so logins carry over to the built-in browser.
  handle('browser:cookieInfo', z.tuple([]), () => cookieInfo());
  handle('browser:importCookies', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      properties: ['openFile'],
      filters: [
        { name: 'Cookies', extensions: ['json', 'txt'] },
        { name: '*', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const res = await importCookieFile(r.filePaths[0]);
    for (const x of wins.values()) x.browser.refresh();
    return res;
  });
  handle('browser:clearCookies', z.tuple([]), () => clearCookies());
  // Cookies read straight from an installed browser (no export file needed). Firefox always
  // works; Chrome/Edge give up their newer "app-bound" cookies only to their own process.
  handle('browser:browserSources', z.tuple([]), () => listBrowserSources());
  handle('browser:importFromBrowser', z.tuple([z.string().max(32)]), async (w, id) => {
    const res = await importFromBrowser(id);
    for (const x of wins.values()) x.browser.refresh();
    return res;
  });

  handle('terminal:profiles', z.tuple([]), () => shellProfiles());
  handle(
    'terminal:create',
    z.tuple([dim, dim, z.boolean().optional(), z.string().max(64).optional()]),
    (w, cols, rows, admin, profile) => {
      const cwd = w.workspace?.root ?? app.getPath('home');
      const t = terminals.create(cwd, cols, rows, admin ?? false, profile);
      if (t === null) return null;
      termTrack(t.id, t.name, cols, rows);
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
    if (!w.terminals.has(i)) return;
    terminals.resize(i, c, r);
    const o = termOut.get(i);
    if (o) {
      o.cols = c;
      o.rows = r;
    }
  });
  handle('terminal:kill', z.tuple([id]), (w, i) => {
    if (!w.terminals.has(i)) return;
    terminals.kill(i);
    w.terminals.delete(i);
    termOwner.delete(i);
    termOut.delete(i);
  });

  handle('app:openLink', z.tuple([z.string().url().max(8192)]), (w, url) => openLink(w, url));
  handle('app:openExternal', z.tuple([z.string().url()]), (_w, url) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });
  handle('app:quit', z.tuple([]), (w) => {
    w.allowClose = true;
    w.win.close();
  });
  // Opens the app again after it exits. The window closes through the usual check (unsaved
  // files, chats still working), so nothing is lost; with more windows open it restarts when
  // the last one closes.
  handle('app:relaunch', z.tuple([]), (w) => {
    app.relaunch();
    w.win.close();
  });
  // Fase 18: the window's own title bar.
  const cssColor = z.string().trim().max(32);
  handle(
    'app:chrome',
    z.tuple([z.object({ bg: cssColor, fg: cssColor, dark: z.boolean() })]),
    (w, colors) => applyChrome(w.win, colors, prefs().windowEffects !== false, prefs().uiZoom),
  );
  handle('app:menuBar', z.tuple([]), () =>
    (Menu.getApplicationMenu()?.items ?? []).filter((i) => i.visible).map((i) => i.label),
  );
  handle(
    'app:popupMenu',
    z.tuple([z.number().int().min(0).max(30), z.number().min(0), z.number().min(0)]),
    (w, index, x, y) => {
      const item = (Menu.getApplicationMenu()?.items ?? []).filter((i) => i.visible)[index];
      const f = w.win.webContents.getZoomFactor();
      item?.submenu?.popup({ window: w.win, x: Math.round(x * f), y: Math.round(y * f) });
    },
  );
  handle('app:resumeOnLogin', z.tuple([z.boolean()]), (_w, on) => resumeOnLogin(on));
  handle('app:interruptedRuns', z.tuple([]), () => interruptedRuns.splice(0));
  handle('app:newWindow', z.tuple([]), (w) => {
    if (!license().features.windows) return false;
    void createWindow({ near: w });
    return true;
  });
  handle('app:installUpdate', z.tuple([]), () => updates?.install());

  handle('phone:status', z.tuple([]), (w) => {
    // A reloaded window learns again that the phone works on it.
    if (phoneOwner && phoneWin() === w) send(w, { type: 'phone:target', on: true });
    return phoneOwner === w ? phone.status() : { running: false, phones: 0 };
  });
  handle('phone:start', z.tuple([]), async (w) => {
    // One window at a time: starting it here takes it from the other one.
    if (phoneOwner && phoneOwner !== w) {
      send(phoneOwner, { type: 'phone:status', status: { running: false, phones: 0 } });
      stopPhone();
    }
    phoneOwner = w;
    try {
      const status = await phone.start();
      // Access from anywhere was on last time: it opens again with the same link.
      if (status.running && phone.wanted().remote && !status.remote)
        void phone.setRemote(true, false).then((st) => {
          if (phoneOwner) send(phoneOwner, { type: 'phone:status', status: st });
        });
      if (status.running) {
        bots.attach();
        setPhoneTarget(w);
      }
      for (const o of wins.values())
        send(o, { type: 'whatsapp:status', status: whatsapp.status() });
      return status;
    } catch (e) {
      phoneOwner = undefined;
      return { running: false, phones: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('phone:stop', z.tuple([]), (w) => {
    if (phoneOwner !== w) return { running: false, phones: 0 };
    clearPhoneTarget();
    phoneOwner = undefined;
    bots.detach();
    const status = phone.stop(true);
    closePhoneTerms();
    for (const o of wins.values()) send(o, { type: 'whatsapp:status', status: whatsapp.status() });
    return status;
  });
  handle('phone:remote', z.tuple([z.boolean()]), (w, on) =>
    phoneOwner === w ? phone.setRemote(on) : { running: false, phones: 0 },
  );
  // A window opened: the remote comes back on by itself if it was on when Zinarix closed.
  handle('phone:resume', z.tuple([]), async (w) => {
    if (phoneOwner) return phoneOwner === w ? phone.status() : { running: false, phones: 0 };
    if (!phone.wanted().enabled) return { running: false, phones: 0 };
    phoneOwner = w;
    try {
      const status = await phone.start();
      if (!status.running) {
        phoneOwner = undefined;
        return status;
      }
      bots.attach();
      setPhoneTarget(w);
      for (const o of wins.values())
        send(o, { type: 'whatsapp:status', status: whatsapp.status() });
      if (phone.wanted().remote)
        void phone.setRemote(true, false).then((st) => {
          if (phoneOwner) send(phoneOwner, { type: 'phone:status', status: st });
        });
      return status;
    } catch (e) {
      phoneOwner = undefined;
      return { running: false, phones: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('phone:appInfo', z.tuple([]), async () => {
    const apk = phone.appApk;
    const st = apk ? await statAsync(apk).catch(() => null) : null;
    if (!st?.isFile()) return null;
    let version = app.getVersion();
    try {
      const file = await readFile(join(remoteAppDir, 'Zinarix-Remote.json'), 'utf8');
      const v = (JSON.parse(file) as { version?: unknown }).version;
      if (typeof v === 'string' && /^[\w.+-]{1,32}$/.test(v)) version = v;
    } catch {
      /* no version file: the app's own */
    }
    return { version, bytes: st.size };
  });
  handle('phone:saveApp', z.tuple([]), async (w) => {
    const apk = phone.appApk;
    if (!apk || !(await statAsync(apk).catch(() => null)))
      throw new Error('Esta versión de Zinarix no trae la app.');
    const r = await dialog.showSaveDialog(w.win, {
      title: 'Guardar la app para Android',
      defaultPath: join(app.getPath('downloads'), 'Zinarix-Remote.apk'),
      filters: [{ name: 'Android (APK)', extensions: ['apk'] }],
    });
    if (r.canceled || !r.filePath) return false;
    const out = r.filePath.toLowerCase().endsWith('.apk') ? r.filePath : `${r.filePath}.apk`;
    await writeFile(out, await readFile(apk));
    return true;
  });
  handle('phone:forget', z.tuple([z.string().max(64).nullable()]), (w, id) => {
    const status = phone.forget(id);
    return phoneOwner === w || !phoneOwner ? status : { running: false, phones: 0 };
  });
  handle(
    'phone:fixed',
    z.tuple([z.object({ host: z.string().max(255), token: z.string().max(4000) }).nullable()]),
    async (w, tunnel) => {
      try {
        const status = await phone.setFixed(tunnel);
        return phoneOwner === w || !phoneOwner ? status : { running: false, phones: 0 };
      } catch (e) {
        return {
          ...(phoneOwner === w ? phone.status() : { running: false, phones: 0 }),
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
  handle(
    'phone:allow',
    z.tuple([
      z.object({
        files: z.boolean(),
        terminal: z.boolean(),
        git: z.boolean(),
        config: z.boolean().optional(),
      }),
    ]),
    (w, allow) => {
      const status = phone.setAllow(allow);
      return phoneOwner === w ? status : { running: false, phones: 0, allow: status.allow };
    },
  );
  handle('phone:push', z.tuple([PhoneSnapshot]), (w, snapshot) => {
    if (!phoneOwner || phoneWin() !== w) return;
    phoneSnap = snapshot;
    phone.push({ ...snapshot, windows: phoneWindows(), todayUsd: ai.todayUsd() });
    bots.push(snapshot);
  });
  const botKind = z.enum(['telegram', 'discord']) satisfies z.ZodType<BotKind>;
  handle('bots:status', z.tuple([]), () => bots.status());
  handle(
    'bots:connect',
    z.tuple([botKind, z.string().trim().min(20).max(300)]),
    (w, kind, token) => {
      if (phoneOwner !== w) throw new Error('Activa primero el control desde el celular.');
      return bots.connect(kind, token);
    },
  );
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
  handle(
    'whatsapp:who',
    z.tuple([z.string().max(200), z.enum(['me', 'them', 'all'])]),
    (_w, id, who) => whatsapp.setWho(id, who),
  );
  handle('whatsapp:remove', z.tuple([z.string().max(200)]), (_w, id) => whatsapp.remove(id));
  handle('whatsapp:test', z.tuple([z.string().max(200).optional()]), (_w, id) => whatsapp.test(id));

  const watchPatch = z
    .object({
      enabled: z.boolean(),
      everyMin: z
        .number()
        .int()
        .min(15)
        .max(7 * 24 * 60),
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
    cloud?.later();
  };

  // Cloud sync: chats, memories and usage, end-to-end encrypted in the user's own Supabase.
  cloud = new CloudSync(app.getPath('userData'), ai.core, supabase, knowledge);
  cloud.onStatus = (status, changed) => {
    for (const w of wins.values()) send(w, { type: 'cloud:status', status, conv: changed.conv });
  };
  cloud.start();
  const cloudSync = cloud;
  handle('cloud:status', z.tuple([]), () => cloudSync.status());
  handle(
    'cloud:connect',
    z.tuple([accountId.nullable(), ref, z.string().min(8).max(1000)]),
    (_w, account, r, passphrase) => cloudSync.connect(account, r, passphrase),
  );
  handle('cloud:disconnect', z.tuple([]), () => cloudSync.disconnect());
  handle('cloud:syncNow', z.tuple([]), () => cloudSync.syncNow());
  const memoryText = z.string().trim().min(1).max(2000);
  handle('knowledge:memories', z.tuple([]), () => knowledge.memories(undefined, true));
  handle(
    'knowledge:addMemory',
    z.tuple([memoryText, z.enum(['global', 'project'])]),
    (w, text, scope) => knowledge.addMemory(text, scope, w.workspace?.root),
  );
  handle(
    'knowledge:updateMemory',
    z.tuple([z.string().min(1).max(64), memoryText]),
    (_w, id, text) => knowledge.updateMemory(id, text),
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
  // The owner's key desk: only with the owner's key active AND the private key on this PC.
  const issuer = new LicenseIssuer();
  const ownerOnly = () => {
    if (license().plan !== 'owner') throw new Error('Solo el dueño de Zinarix Studio puede hacer claves.');
  };
  handle('license:issuer', z.tuple([]), () => {
    ownerOnly();
    return issuer.ensureGifts();
  });
  handle(
    'license:issue',
    z.tuple([
      z.object({
        plan: z.enum(['pro', 'ai', 'proai']),
        email: z.string().max(200).optional(),
        name: z.string().max(120).optional(),
        days: z.number().int().min(0).max(36500).optional(),
        count: z.number().int().min(1).max(100).optional(),
      }),
    ]),
    (_w, req) => {
      ownerOnly();
      return issuer.issue(req);
    },
  );
  handle(
    'license:markIssued',
    z.tuple([z.string().min(1).max(200), z.boolean(), z.string().max(200)]),
    (_w, id, given, note) => {
      ownerOnly();
      return issuer.mark(id, given, note);
    },
  );
}

// ---------------- Panel de Edición (visual editor) ----------------

/** The visual editor of the window's open folder (it must be opened again for another folder). */
function designOf(w: Win): DesignSession {
  const root = w.workspace?.root;
  if (!w.design || w.design.root !== root)
    throw new EditError('Abre el Panel de Edición de nuevo.');
  return w.design.session;
}

/** Errors in plain words reach the panel as they are; anything else gets a short prefix. */
async function designCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EditError) throw e;
    throw new Error(`No se pudo guardar el cambio: ${(e as Error).message}`);
  }
}

/** Ayuda de Zinarix (main/helper.ts): local Ollama model + the app's own docs. */
function registerHelperIpc(): void {
  const helper = new HelperService(
    join(appRoot, 'dist', 'helper', 'knowledge.json'),
    // The cloud model is only used when the user picked it in the helper (cloud: true).
    async function* (messages, signal) {
      for await (const ev of ai.core.stream({ role: 'chat', maxTokens: 800, messages }, signal))
        if (ev.type === 'text') yield ev.delta;
    },
  );
  app.on('before-quit', () => helper.close());
  const reqId = z.string().min(1).max(200);
  handle('helper:status', z.tuple([]), () => helper.status(prefs().helperModel));
  handle(
    'helper:ask',
    z.tuple([
      reqId,
      z.object({
        question: z.string().min(1).max(4000),
        history: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string().max(20_000),
            }),
          )
          .max(40),
        cloud: z.boolean().optional(),
      }),
    ]),
    (w, requestId, req) => {
      void helper.ask(rid(w, requestId), { ...req, model: prefs().helperModel }, (event) =>
        send(w, { type: 'helper', requestId, event }),
      );
    },
  );
  handle('helper:pull', z.tuple([reqId, z.string().regex(MODEL_NAME)]), (w, requestId, model) =>
    helper.pull(rid(w, requestId), model, (event) =>
      send(w, { type: 'helper:pull', event: { ...event, requestId } }),
    ),
  );
  handle('helper:abort', z.tuple([reqId]), (w, requestId) => helper.abort(rid(w, requestId)));
}

/** "Automatizar": scheduled tasks, "Mis bots" and the website widget (see automations.ts). */
function registerAutomationsIpc(vercel: Vercel): void {
  const auto = new Automations({
    dir: ai.core.paths.home,
    runner: ai,
    lang: () => (app.getLocale().startsWith('es') ? 'es' : 'en'),
    onChange: (status) => {
      for (const w of wins.values()) send(w, { type: 'automations', status });
    },
    notify: (title, body) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body });
      n.on('click', () => {
        const w = focused() ?? [...wins.values()][0];
        if (!w) return;
        if (w.win.isMinimized()) w.win.restore();
        w.win.focus();
        send(w, { type: 'command', command: 'view.automations' });
      });
      n.show();
    },
    deliver: (kind, text) =>
      bots.notify(kind, text, kind === 'whatsapp' ? whatsapp.status().chats[0]?.id : undefined),
  });
  ai.botFor = (id) => auto.bot(id);
  auto.start();
  app.on('will-quit', () => auto.stop());

  const id = z.string().uuid();
  const schedule = z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('daily'),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      days: z.array(z.number().int().min(0).max(6)).max(7),
    }),
    z.object({ kind: z.literal('every'), minutes: z.number().int().min(1).max(100_000) }),
    z.object({ kind: z.literal('once'), at: z.number().int().positive() }),
  ]);
  const taskInput = z.object({
    name: z.string().max(200),
    prompt: z.string().max(20_000),
    schedule,
    enabled: z.boolean(),
    model: z.string().max(300).optional(),
    bot: id.optional(),
    tools: z.enum(['none', 'read']),
    folder: z.string().min(1).max(4096).optional(),
    deliver: z.array(z.enum(['telegram', 'discord', 'whatsapp'])).max(3),
  });
  const botInput = z.object({
    name: z.string().max(200),
    icon: z.string().max(32),
    description: z.string().max(1000),
    instructions: z.string().max(40_000),
    knowledge: z.string().max(120_000),
    model: z.string().max(300).optional(),
    mode: z.enum(['chat', 'agent']),
    docs: z.array(z.string().max(100)).max(20),
    greeting: z.string().max(2000),
    widget: z
      .object({
        title: z.string().max(200),
        color: z.string().max(20),
        position: z.enum(['right', 'left']),
        origins: z.array(z.string().max(300)).max(50),
        perMinute: z.number().int().min(1).max(1000),
      })
      .partial()
      .optional(),
  });

  handle('automations:status', z.tuple([]), () => auto.status());
  handle('automations:createTask', z.tuple([taskInput]), (_w, t) => auto.createTask(t));
  handle('automations:updateTask', z.tuple([id, taskInput]), (_w, i, t) => auto.updateTask(i, t));
  handle('automations:setEnabled', z.tuple([id, z.boolean()]), (_w, i, on) => auto.setEnabled(i, on));
  handle('automations:deleteTask', z.tuple([id]), (_w, i) => auto.deleteTask(i));
  handle('automations:runNow', z.tuple([id]), (_w, i) => auto.runNow(i));
  handle('automations:cancel', z.tuple([id]), (_w, i) => auto.cancel(i));
  handle('automations:clearRuns', z.tuple([id.optional()]), (_w, i) => auto.clearRuns(i));
  handle('automations:createBot', z.tuple([botInput]), (_w, b) => auto.createBot(b));
  handle('automations:updateBot', z.tuple([id, botInput]), (_w, i, b) => auto.updateBot(i, b));
  handle('automations:deleteBot', z.tuple([id]), (_w, i) => auto.deleteBot(i));
  handle('automations:deliveries', z.tuple([]), () => ({
    telegram: bots.canNotify('telegram'),
    discord: bots.canNotify('discord'),
    whatsapp: bots.canNotify('whatsapp') || (bots.running && whatsapp.status().chats.length > 0),
  }));

  const mustBot = (i: string) => {
    const b = auto.bot(i);
    if (!b) throw new Error('Ese bot ya no existe.');
    return b;
  };
  handle('automations:exportBot', z.tuple([id]), async (w, i) => {
    const b = mustBot(i);
    const r = await dialog.showSaveDialog(w.win, {
      defaultPath: join(app.getPath('documents'), `${botSlug(b.name)}${BOT_FILE_EXT}`),
      filters: [{ name: 'Bot de Zinarix', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    writeFileSync(r.filePath, botToFile(b));
    return true;
  });
  handle('automations:importBot', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      properties: ['openFile'],
      filters: [{ name: 'Bot de Zinarix', extensions: ['json'] }],
    });
    const file = r.filePaths[0];
    if (r.canceled || !file) return null;
    if (statSync(file).size > 1024 * 1024) throw new Error('El archivo es demasiado grande para ser un bot.');
    return auto.createBot(botFromFile(readFileSync(file, 'utf8')));
  });
  handle('automations:saveAsAgent', z.tuple([id]), (w, i) => {
    const b = mustBot(i);
    const root = w.workspace?.root;
    if (!root) throw new Error('Abre una carpeta para guardar el bot como subagente del proyecto.');
    const dir = join(root, '.zinarix', 'agents');
    mkdirSync(dir, { recursive: true });
    const slug = botSlug(b.name);
    let rel = `${slug}.md`;
    for (let n = 2; existsSync(join(dir, rel)); n++) rel = `${slug}-${n}.md`;
    writeFileSync(join(dir, rel), botAgentMarkdown(b));
    return `.zinarix/agents/${rel}`;
  });

  /** Where the widget's server function sends the bot's messages (and the key, if any). */
  const widgetTarget = async (
    model?: string,
  ): Promise<{ target: WidgetTarget; key?: string; name: string }> => {
    const ref = ai.core.resolveModel(model, 'chat');
    const entry = ai.core.provider(ref.provider);
    const api = widgetApi(entry.adapter);
    if (!api)
      throw new Error(
        `El widget todavía no funciona con ${entry.name}. Elige para el bot un modelo de OpenAI, Anthropic, Gemini o un proveedor compatible con OpenAI.`,
      );
    const cfg = await ai.core.providerConfig(ref.provider).catch(() => undefined);
    const baseUrl = cfg?.baseUrl ?? entry.baseUrl;
    const issue = widgetUrlIssue(baseUrl);
    if (issue) throw new Error(issue);
    return {
      target: { api, baseUrl, model: ref.model, provider: entry.name },
      key: cfg?.apiKey?.reveal(),
      name: entry.name,
    };
  };
  handle('automations:exportWidget', z.tuple([id]), async (w, i) => {
    const b = mustBot(i);
    const { target } = await widgetTarget(b.model);
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Carpeta donde guardar el widget',
      properties: ['openDirectory', 'createDirectory'],
    });
    const parent = r.filePaths[0];
    if (r.canceled || !parent) return null;
    const dir = join(parent, `${botSlug(b.name)}-widget`);
    return { dir, files: auto.writeWidget(i, target, dir) };
  });
  handle('automations:publishWidget', z.tuple([id, z.boolean()]), async (w, i, sendKey) => {
    const b = mustBot(i);
    const { target, key, name } = await widgetTarget(b.model);
    // The key leaves this computer only after a native confirmation (not just the page's).
    if (sendKey) {
      if (!key) throw new Error(`No hay una clave guardada de ${name}.`);
      const ok = await dialog.showMessageBox(w.win, {
        type: 'warning',
        buttons: ['Guardar la clave en Vercel', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: 'Publicar el widget',
        message: `¿Guardar tu clave de ${name} en el proyecto de Vercel?`,
        detail:
          'Se guarda cifrada como variable BOT_API_KEY y solo la usa la función del bot en el servidor (nunca llega al navegador de los visitantes). Cada mensaje del chat se cobra en tu cuenta: pon un límite de gasto en el proveedor.',
      });
      if (ok.response !== 0) throw new Error('Publicación cancelada.');
    }
    const files = widgetFiles(b, target).map((f) => ({ file: f.file, data: Buffer.from(f.text) }));
    const project = `${botSlug(b.name)}-bot`;
    let d = await vercel.deployFiles(project, files, null, true);
    let keySet = false;
    if (sendKey && key && d.projectId) {
      await vercel.setEnv(d.projectId, null, 'BOT_API_KEY', key, ['production', 'preview']);
      keySet = true;
      // Variables reach a deployment when it is built: publish again so this one has it.
      d = await vercel.deployFiles(project, files, null, true);
    }
    const url = `https://${project}.vercel.app`;
    return { status: auto.setPublished(i, url, d.projectId ?? project), url, keySet };
  });
}

/** Fase 5: background tasks in git worktrees (outside the repository, in userData). */
let tasks: TaskManager | undefined;
const tasksDir = () => join(app.getPath('userData'), 'worktrees');

function taskManager(): TaskManager {
  if (!tasks) {
    tasks = new TaskManager({
      dir: tasksDir(),
      runner: ai,
      maxParallel: prefs().taskParallel,
      onChange: (status) => {
        for (const w of wins.values()) send(w, { type: 'tasks', status });
      },
      notify: (title, body) => {
        if (Notification.isSupported())
          new Notification({ title, body: body.slice(0, 200) }).show();
      },
    });
    void tasks.prune();
  }
  return tasks;
}

/** Fase 6: "Revisar cambios" (AI review of local changes, a branch or a PR). */
function registerReviewIpc(): void {
  const reviews = new ReviewManager(() => ai.core, {
    dir: join(app.getPath('userData'), 'reviews'),
  });
  // Project rules (AGENTS.md hierarchy, .zinarix/rules…) that apply to the changed files.
  const rulesOf = (w: Win) => (paths: string[]) =>
    rulesPrompt(
      ai.rulesFor(
        scope(w),
        paths.map((p) => `file:${p}`),
      ).active,
      [],
      redact,
    ).text;
  const model = z.string().min(1).max(300);
  const source = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('local') }),
    z.object({ kind: z.literal('branch'), base: z.string().min(1).max(255) }),
    z.object({ kind: z.literal('pr'), number: z.number().int().positive().max(1e9) }),
  ]);
  const reviewId = z.string().regex(/^r[0-9a-z]{1,20}$/);
  const ids = z.array(z.string().max(40)).max(500);
  handle(
    'review:run',
    z.tuple([
      str,
      z.object({
        source,
        models: z.array(model).max(4),
        verifier: model.optional(),
        verify: z.boolean().optional(),
        security: z.boolean().optional(),
      }),
    ]),
    (w, requestId, req) =>
      reviews.run(
        rid(w, requestId),
        ws(w).root,
        req,
        (progress) => send(w, { type: 'review:progress', requestId, progress }),
        rulesOf(w),
      ),
  );
  handle('review:abort', z.tuple([str]), (w, requestId) => reviews.abort(rid(w, requestId)));
  handle('review:prs', z.tuple([]), (w) => reviews.prs(ws(w).root));
  handle('review:preview', z.tuple([reviewId, ids]), (w, id, list) =>
    reviews.preview(ws(w).root, id, list),
  );
  handle('review:history', z.tuple([]), (w) => reviews.history(ws(w).root));
  handle('review:get', z.tuple([reviewId]), (w, id) => reviews.get(ws(w).root, id));
  handle('review:delete', z.tuple([reviewId]), (w, id) => reviews.delete(ws(w).root, id));
  // The renderer asks for the reason (and the user's go-ahead) before calling this.
  handle(
    'review:ignore',
    z.tuple([reviewId, ids.min(1), z.string().max(500).optional()]),
    (w, id, list, reason) => reviews.ignore(ws(w).root, id, list, reason),
  );
  // The renderer asks the user (with the preview) before calling this.
  handle('review:publish', z.tuple([reviewId, ids]), (w, id, list) =>
    reviews.publish(ws(w).root, id, list),
  );
}

/** Fase 2B (plan de funciones): Docker panel (containers, images, volumes, compose, logs). */
let docker: DockerService | undefined;
// ---------------- Fase 4: screen recording and proxies (Video Studio) ----------------

/** Recording ids by window (only the window that started one may write to it). */
const recOwner = new Map<string, Win>();
const REC_STOP_KEY = 'CommandOrControl+Alt+R';

function registerVideoPhase4Ipc(): void {
  const rec = new Recorder(() => videoService().tools().ffmpeg);
  rec.install(session.defaultSession);
  const px = new ProxyMaker(
    () => videoService().cacheDir,
    () => {
      const bin = videoService().tools().ffmpeg;
      if (!bin) throw new Error('FFmpeg no está disponible en este equipo.');
      return bin;
    },
  );
  const recId = z.string().min(1).max(80);
  const ownRec = (w: Win, id: string) => {
    if (recOwner.get(id) !== w) throw new Error('Esa grabación no es de esta ventana.');
  };
  handle('video:recSources', z.tuple([]), () => rec.sources());
  handle('video:recSelect', z.tuple([z.string().min(1).max(200), z.boolean()]), (_w, id, audio) =>
    rec.select(id, audio),
  );
  handle('video:recStart', z.tuple([z.enum(['screen', 'camera'])]), (w, kind) => {
    // The open folder's media/recordings (like media/generated), else Videos/Zinarix Studio.
    const dir = w.workspace?.root
      ? join(w.workspace.root, 'media', 'recordings')
      : join(app.getPath('videos'), 'Zinarix Studio');
    const started = rec.start(dir, recordingName(new Date(), kind === 'camera' ? '-camara' : ''));
    recOwner.set(started.id, w);
    if (kind === 'screen') rec.trackCursor(started.id);
    return started;
  });
  handle('video:recPause', z.tuple([recId, z.boolean()]), (w, id, paused) => {
    ownRec(w, id);
    rec.pauseCursor(id, paused);
  });
  // Only "<media>.cursor.json" next to a file, small: nothing else can be read through it.
  handle('video:cursorTrack', z.tuple([z.string().min(1).max(4096)]), async (_w, p) => {
    const file = cursorFile(resolve(p));
    try {
      const st = await statAsync(file);
      if (!st.isFile() || st.size > CURSOR_MAX_BYTES) return null;
      return await readFile(file, 'utf8');
    } catch {
      return null;
    }
  });
  handle(
    'video:recChunk',
    z.tuple([recId, z.instanceof(Uint8Array).refine((b) => b.byteLength <= 64 * 1024 * 1024)]),
    (w, id, bytes) => {
      ownRec(w, id);
      return rec.write(id, bytes);
    },
  );
  handle('video:recFinish', z.tuple([recId]), async (w, id) => {
    ownRec(w, id);
    recOwner.delete(id);
    return rec.finish(id);
  });
  handle('video:recAbort', z.tuple([recId]), async (w, id) => {
    ownRec(w, id);
    recOwner.delete(id);
    await rec.abort(id);
  });
  // While recording: a global shortcut stops it, and the window can get out of the way.
  handle('video:recMode', z.tuple([z.boolean(), z.boolean()]), (w, on, minimize) => {
    if (globalShortcut.isRegistered(REC_STOP_KEY)) globalShortcut.unregister(REC_STOP_KEY);
    if (!on) {
      if (w.win.isMinimized()) w.win.restore();
      w.win.focus();
      return { shortcut: null };
    }
    let ok = false;
    try {
      ok = globalShortcut.register(REC_STOP_KEY, () => send(w, { type: 'video:recStop' }));
    } catch {
      ok = false;
    }
    if (minimize) w.win.minimize();
    return {
      shortcut: ok
        ? REC_STOP_KEY.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl')
        : null,
    };
  });
  const height = z
    .number()
    .int()
    .refine((h) => (PROXY_HEIGHTS as readonly number[]).includes(h));
  const absFile = z.string().min(1).max(4096);
  handle('video:proxyUrl', z.tuple([absFile, height]), (_w, p, h) => {
    const f = px.existing(resolve(p), h);
    return f ? videoService().urlFor(f) : null;
  });
  handle(
    'video:proxy',
    z.tuple([
      absFile,
      z.object({
        duration: z.number().min(0).max(1e7),
        width: z.number().min(0).max(100_000),
        height: z.number().min(0).max(100_000),
        hasAudio: z.boolean(),
        target: height,
      }),
    ]),
    async (w, p, o) => {
      const path = resolve(p);
      if (mediaKindOf(path) !== 'video' || !(existsSync(path) && statSync(path).isFile()))
        throw new Error('Solo videos.');
      let last = -1;
      const file = await px.make({ path, ...o }, (progress) => {
        const pct = Math.floor(progress * 100);
        if (pct === last) return;
        last = pct;
        send(w, { type: 'video:proxy', path, progress });
      });
      return videoService().urlFor(file);
    },
  );
  handle('video:proxyCancel', z.tuple([absFile.nullable()]), (_w, p) =>
    px.cancel(p ? resolve(p) : undefined),
  );
  app.on('will-quit', () => {
    globalShortcut.unregister(REC_STOP_KEY);
    rec.dispose();
    px.cancel();
  });
}

/** Fase 6 (plan de funciones): Godot (one for the app) and the web game preview servers. */
let godotService: GodotService | undefined;
const webGames = new WebGameServers();
function godot(): GodotService {
  return (godotService ??= new GodotService(homedir(), join(app.getPath('userData'), 'godot.json')));
}

async function godotLspServer(
  command: string,
  root: string,
): Promise<{ exe: string; args: string[]; env?: Record<string, string> } | { missing: string }> {
  if (command !== '@godot') return { missing: '' };
  const g = godot();
  const st = await g.status();
  if (st.state !== 'ready') return { missing: 'Instala Godot 4 (godotengine.org) y elígelo en Más → Juegos' };
  const project = existsSync(join(root, 'project.godot')) ? '' : (await g.scan(root)).godot[0]?.dir;
  if (project === undefined) return { missing: 'No hay un project.godot en la carpeta abierta' };
  const port = await g.lspPort(project ? join(root, project) : root);
  return { exe: process.execPath, args: ['-e', LSP_TCP_BRIDGE, String(port)], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** Fase 1B (plan de funciones): background removal on this PC (resources/bgremove). */
let bgService: BgRemoveService | undefined;
function bgRemove(): BgRemoveService {
  const dir = app.isPackaged ? join(process.resourcesPath, 'bgremove') : join(appRoot, 'dist', 'bgremove');
  const worker = join(dir, 'bgWorker.mjs');
  return (bgService ??= new BgRemoveService(
    dir,
    join(app.getPath('userData'), 'models'),
    existsSync(worker) ? bgViaProcess(process.execPath, worker, { ELECTRON_RUN_AS_NODE: '1' }) : null,
  ));
}

function registerBgIpc(): void {
  const bg = bgRemove();
  const view = (): BgStatusView => ({ available: bg.available, models: bg.status() });
  const id = z.enum(['fast', 'precise']);
  handle('bg:status', z.tuple([]), () => view());
  handle('bg:download', z.tuple([id]), (w, m) => {
    // Runs on; progress and the end go to the window that asked as events.
    bg.download(m, (got, total) => send(w, { type: 'bg:progress', id: m, got, total })).then(
      () => send(w, { type: 'bg:progress', id: m, got: BG_MODELS[m].bytes, total: BG_MODELS[m].bytes, done: true }),
      (e: unknown) =>
        send(w, {
          type: 'bg:progress',
          id: m,
          got: 0,
          total: BG_MODELS[m].bytes,
          error: e instanceof Error ? e.message : String(e),
        }),
    );
  });
  handle('bg:cancelDownload', z.tuple([id]), (_w, m) => bg.cancelDownload(m));
  const tensor = z.custom<Float32Array>((v) => v instanceof Float32Array && v.length <= 3 * 1024 * 1024);
  handle('bg:infer', z.tuple([id, tensor]), (_w, m, input) => bg.infer(m, input));
}

/** Fase 7 (plan de funciones): CAD with OpenSCAD (installed, or the built-in WebAssembly one). */
let cadService: CadService | undefined;
let blenderVersion: () => Promise<string | null> = async () => null;
function cad(): CadService {
  // A separate GPL program next to the app, like FFmpeg (build.mjs, package.json extraResources).
  const worker = app.isPackaged
    ? join(process.resourcesPath, 'openscad', 'cadWorker.mjs')
    : join(appRoot, 'dist', 'openscad', 'cadWorker.mjs');
  return (cadService ??= new CadService(
    join(app.getPath('userData'), 'openscad.json'),
    existsSync(worker) ? builtinViaProcess(process.execPath, worker, { ELECTRON_RUN_AS_NODE: '1' }) : null,
  ));
}

function registerCadIpc(): void {
  const c = cad();
  ai.agent.cad = c;
  const view = async (refresh = false): Promise<CadEnginesView> => {
    const e = await c.engines(refresh);
    return { native: e.native, builtin: e.builtin, blender: await blenderVersion().catch(() => null) };
  };
  const rootOf = (w: Win) => w.workspace?.root;
  // Tabs use paths relative to the open folder.
  const absOf = (w: Win, p: string) => (w.workspace ? resolve(w.workspace.root, p) : resolve(p));
  const relMsgs = (w: Win, log: ScadLog | undefined) =>
    (log?.messages ?? []).map((m) => {
      const root = rootOf(w);
      if (!m.file || !root || !isAbsolute(m.file)) return m;
      const r = relative(root, m.file);
      return r.startsWith('..') ? m : { ...m, file: r.split(sep).join('/') };
    });
  const renders = new Map<string, AbortController>();
  const values = z.record(z.string().max(100), z.unknown());
  const path = z.string().min(1).max(4096);
  const code = z.string().max(2_000_000);
  handle('cad:engines', z.tuple([z.boolean().optional()]), (_w, refresh) => view(refresh === true));
  handle('cad:pickNative', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Elige el programa de OpenSCAD',
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'OpenSCAD', extensions: ['exe', 'com'] }] } : {}),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    let exe = r.filePaths[0];
    if (exe.endsWith('.app')) exe = join(exe, 'Contents', 'MacOS', 'OpenSCAD');
    return (await c.useNative(exe)) ? view() : null;
  });
  handle('cad:render', z.tuple([z.string().min(1).max(200), path, code, values]), async (w, key, file, src, vals): Promise<CadRenderView> => {
    const k = `${w.id}:${key}`;
    renders.get(k)?.abort();
    const ac = new AbortController();
    renders.set(k, ac);
    const params = parseScadParams(src);
    try {
      const r = await c.render({ file: absOf(w, file), code: src, values: vals, root: rootOf(w), timeoutMs: 180_000 }, ac.signal);
      return { ok: true, stl: new Uint8Array(r.data), engine: r.engine, ms: r.ms, messages: relMsgs(w, r.log), params };
    } catch (e) {
      const log = (e as { log?: ScadLog }).log;
      return { ok: false, error: (e as Error).message, messages: relMsgs(w, log), params, ...(ac.signal.aborted ? { cancelled: true } : {}) };
    } finally {
      if (renders.get(k) === ac) renders.delete(k);
    }
  });
  handle('cad:cancel', z.tuple([z.string().min(1).max(200)]), (w, key) => {
    renders.get(`${w.id}:${key}`)?.abort();
  });
  handle('cad:export', z.tuple([path, code, values, z.enum(CAD_FORMATS as unknown as [string, ...string[]])]), async (w, file, src, vals, fmt) => {
    const abs = absOf(w, file);
    const r = await dialog.showSaveDialog(w.win, {
      title: 'Exportar modelo 3D',
      defaultPath: abs.replace(/\.scad$/i, `.${fmt}`),
      filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }],
    });
    if (r.canceled || !r.filePath) return null;
    const out = await c.render({ file: abs, code: src, values: vals, root: rootOf(w), format: fmt as (typeof CAD_FORMATS)[number], timeoutMs: 10 * 60_000 });
    await writeFile(r.filePath, out.data);
    return { path: r.filePath, size: out.data.length };
  });
  handle('cad:create', z.tuple([z.string().min(1).max(40), z.string().min(1).max(400)]), async (w, template, rel) => {
    const root = rootOf(w);
    if (!root) throw new Error('Abre una carpeta primero.');
    const t = CAD_TEMPLATES.find((x) => x.id === template);
    if (!t) throw new Error('Plantilla desconocida.');
    const name = rel.trim().replace(/\.scad$/i, '') + '.scad';
    const abs = resolve(root, name);
    const r = relative(root, abs);
    if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error('El archivo tiene que quedar dentro de la carpeta abierta.');
    if (existsSync(abs)) throw new Error('Ya existe un archivo con ese nombre.');
    mkdirSync(dirname(abs), { recursive: true });
    await writeFile(abs, t.code, 'utf8');
    return relative(root, abs).split(sep).join('/');
  });
  // The window's CSP allows no fetch of zmedia: URLs, so the viewer gets the bytes here.
  handle('cad:readMesh', z.tuple([path]), async (w, p) => {
    const abs = absOf(w, p);
    const gcode = /\.(gcode|gco)$/i.test(abs);
    if ((!isMeshPath(abs) && !gcode) || !existsSync(abs) || !statSync(abs).isFile()) throw new Error('No es un modelo 3D.');
    if (statSync(abs).size > (gcode ? 400 : 300) * 1024 * 1024) throw new Error(`El archivo pesa más de ${gcode ? 400 : 300} MB.`);
    return new Uint8Array(await readFile(abs));
  });
  registerPrintIpc(c, absOf, rootOf);
}

/** SketchUp (.skp): the side panel, and the sketchup_* tools of the agent. */
function registerSketchupIpc(): void {
  const su = new SketchupService(join(app.getPath('userData'), 'sketchup.json'));
  ai.agent.sketchup = su;
  const rootOf = (w: Win) => w.workspace?.root;
  // Paths of the panel are relative to the open folder (like tabs) and must stay inside it.
  const inside = (w: Win, p: string, ext?: RegExp) => {
    const root = rootOf(w);
    if (!root) throw new Error('Abre una carpeta primero.');
    const abs = resolve(root, p);
    const r = relative(root, abs);
    if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error('El archivo tiene que estar dentro de la carpeta abierta.');
    if (ext && !ext.test(abs)) throw new Error('Ese tipo de archivo no sirve aquí.');
    return abs;
  };
  const relOf = (w: Win, p: string) => {
    const root = rootOf(w);
    if (!root || !p) return p;
    const r = relative(root, p);
    return r.startsWith('..') || isAbsolute(r) ? p : r.split(sep).join('/');
  };
  const path = z.string().min(1).max(4096);
  handle('sketchup:status', z.tuple([]), (): SketchupStatusView => su.status());
  handle('sketchup:pick', z.tuple([]), async (w): Promise<SketchupStatusView | null> => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Elige SketchUp',
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'SketchUp', extensions: ['exe'] }] } : {}),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return (await su.pick(r.filePaths[0])) ? su.status() : null;
  });
  handle('sketchup:install', z.tuple([]), async (): Promise<SketchupStatusView> => {
    await su.installExtension();
    return su.status();
  });
  handle('sketchup:inspect', z.tuple([path]), async (w, p): Promise<SkpInfoView> => {
    const abs = inside(w, p, /\.skp$/i);
    const info = parseSkp(await readSkpHead(abs));
    return {
      path: p,
      size: statSync(abs).size,
      version: info.version,
      label: info.label,
      thumbnail: info.thumbnail ? new Uint8Array(info.thumbnail.png) : null,
      width: info.thumbnail?.width ?? 0,
      height: info.thumbnail?.height ?? 0,
    };
  });
  handle('sketchup:open', z.tuple([path]), async (w, p) => {
    const abs = inside(w, p, /\.skp$/i);
    if (!existsSync(abs)) throw new Error('El archivo no existe.');
    await su.open(abs);
  });
  handle(
    'sketchup:run',
    z.tuple([
      path.nullable(),
      z.array(z.record(z.string().max(40), z.unknown())).max(100),
      z.object({ units: z.enum(SKETCHUP_UNITS).optional(), save: z.boolean().optional(), shot: z.boolean().optional() }),
    ]),
    async (w, p, raw, o): Promise<SketchupRunView> => {
      try {
        const file = p ? inside(w, p, /\.skp$/i) : undefined;
        const ops = validateSketchupOps(raw, (q) => inside(w, q));
        for (const op of ops) if (typeof op.path === 'string' && (op.op === 'export' || op.op === 'save')) mkdirSync(dirname(op.path), { recursive: true });
        const r = await su.run(
          { ...(file ? { path: file } : {}), units: o.units ?? 'mm', ops, save: o.save ?? false, ...(o.shot ? { shot: { path: '', width: 960, height: 600 } } : {}) },
          { launch: true },
        );
        const report = r.report
          ? { ...r.report, model: relOf(w, r.report.model), exported: r.report.exported.map((x) => relOf(w, x)), ...(r.report.saved ? { saved: relOf(w, r.report.saved) } : {}) }
          : undefined;
        return { ok: r.ok, ...(r.error ? { error: r.error } : {}), ...(report ? { report } : {}), ...(r.shot ? { shot: new Uint8Array(r.shot) } : {}) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );
  // Meshes exported by SketchUp (.stl/.obj/.dae) for the panel's 3D preview.
  handle('sketchup:readExport', z.tuple([path]), async (w, p) => {
    const abs = inside(w, p, SKETCHUP_PREVIEWABLE);
    if (!existsSync(abs) || statSync(abs).size > 200 * 1024 * 1024) throw new Error('El archivo no existe o pesa más de 200 MB.');
    return new Uint8Array(await readFile(abs));
  });
}

/** Fase 7 (mejora): slicing to G-code (PrusaSlicer) and the network 3D printers. */
let slicerService: SlicerService | undefined;
let printerStore: PrinterStore | undefined;
const slicerOf = () => (slicerService ??= new SlicerService(join(app.getPath('userData'), 'slicer.json')));
const printerSecret = (id: string) => new TokenStore(join(app.getPath('userData'), `printer-${id.replace(/[^\w-]/g, '')}.bin`), `printer:${id}`);
const printersOf = () => (printerStore ??= new PrinterStore(join(app.getPath('userData'), 'printers.json'), printerSecret));

function registerPrintIpc(c: CadService, absOf: (w: Win, p: string) => string, rootOf: (w: Win) => string | undefined): void {
  const sl = slicerOf();
  const ps = printersOf();
  ai.agent.slicer = sl;
  ai.agent.printers = ps;
  const view = async (refresh = false): Promise<SlicerView> => {
    const i = await sl.info(refresh);
    return { slicer: i.slicer, profile: i.profile, desktop: i.desktop.map(({ id, name }) => ({ id, name })) };
  };
  const relOf = (w: Win, abs: string) => {
    const root = rootOf(w);
    return root ? relative(root, abs).split(sep).join('/') : abs;
  };
  const inProject = (w: Win, p: string) => {
    const root = rootOf(w);
    if (!root) throw new Error('Abre una carpeta primero.');
    const abs = absOf(w, p);
    const r = relative(root, abs);
    if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error('El archivo tiene que estar dentro de la carpeta abierta.');
    return abs;
  };
  const slices = new Map<string, AbortController>();
  const key = z.string().min(1).max(200);
  const path = z.string().min(1).max(4096);
  const id = z.string().min(1).max(100);
  handle('print:slicer', z.tuple([z.boolean().optional()]), (_w, refresh) => view(refresh === true));
  handle('print:pickSlicer', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Elige PrusaSlicer (prusa-slicer-console) o SuperSlicer',
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'PrusaSlicer', extensions: ['exe'] }] } : {}),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    let exe = r.filePaths[0];
    if (exe.endsWith('.app')) exe = join(exe, 'Contents', 'MacOS', exe.includes('Super') ? 'SuperSlicer' : 'PrusaSlicer');
    // The window one opens a window: use the console one next to it.
    if (/prusa-slicer\.exe$/i.test(exe) && existsSync(exe.replace(/prusa-slicer\.exe$/i, 'prusa-slicer-console.exe')))
      exe = exe.replace(/prusa-slicer\.exe$/i, 'prusa-slicer-console.exe');
    return (await sl.use(exe)) ? view() : null;
  });
  handle('print:pickProfile', z.tuple([z.boolean()]), async (w, clear) => {
    if (clear) {
      await sl.setProfile(null);
      return view();
    }
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Perfil de PrusaSlicer (Archivo → Exportar → Exportar configuración)',
      properties: ['openFile'],
      filters: [{ name: 'PrusaSlicer config', extensions: ['ini'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    await sl.setProfile(r.filePaths[0]);
    return view();
  });
  handle(
    'print:slice',
    z.tuple([key, path, z.string().max(2_000_000).nullable(), z.record(z.string().max(100), z.unknown()), z.record(z.string().max(40), z.unknown())]),
    async (w, k, file, code, vals, settings): Promise<SliceView> => {
      const abs = inProject(w, file);
      const st = validateSlice(settings);
      const out = abs.replace(/\.[^./\\]+$/, '.gcode');
      const kk = `${w.id}:${k}`;
      slices.get(kk)?.abort();
      const ac = new AbortController();
      slices.set(kk, ac);
      let model = abs;
      let tmp: string | undefined;
      try {
        if (/\.scad$/i.test(abs)) {
          const r = await c.render({ file: abs, ...(code !== null ? { code } : {}), values: vals, root: rootOf(w), format: 'stl', timeoutMs: 10 * 60_000 }, ac.signal);
          tmp = await mkdtemp(join(tmpdir(), 'zinarix-slice-model-'));
          model = join(tmp, basename(abs).replace(/\.scad$/i, '.stl'));
          await writeFile(model, r.data);
        } else if (!SLICEABLE.test(abs)) throw new Error('Ese archivo no se puede rebanar.');
        const r = await sl.slice({ model, out, settings: st }, ac.signal);
        return { path: relOf(w, out), ms: r.ms, slicer: r.slicer, warnings: r.warnings, timeS: gcodeTime(r.stats), grams: gcodeGrams(r.stats), layers: r.stats.layers };
      } finally {
        if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
        if (slices.get(kk) === ac) slices.delete(kk);
      }
    },
  );
  handle('print:cancel', z.tuple([key]), (w, k) => {
    slices.get(`${w.id}:${k}`)?.abort();
  });
  handle('print:openIn', z.tuple([z.string().min(1).max(20), path]), (w, app, file) => {
    sl.openIn(app, inProject(w, file));
  });
  handle('printers:list', z.tuple([]), () => ps.list());
  const kind = z.enum(PRINTER_KINDS as unknown as [string, ...string[]]);
  const cfg = z.object({
    id: id.optional(),
    name: z.string().max(60),
    kind,
    url: z.string().min(1).max(500),
    key: z.string().max(400).optional(),
  });
  handle('printers:save', z.tuple([cfg]), (_w, p) => ps.save(p as Parameters<PrinterStore['save']>[0]));
  handle('printers:remove', z.tuple([id]), (_w, pid) => ps.remove(pid));
  // Tests what is typed in the form (the saved key when none is typed).
  handle('printers:test', z.tuple([cfg]), async (_w, p) => {
    const url = normalizePrinterUrl(p.url);
    const k = p.key !== undefined && p.key.trim() ? p.key.trim() : p.id ? printerSecret(p.id).get() : null;
    return new PrinterClient({ id: p.id ?? 'test', name: p.name || url, kind: p.kind as 'octoprint' | 'moonraker', url }, k).test();
  });
  handle('printers:status', z.tuple([id]), (_w, pid) => ps.client(pid).status());
  handle('printers:send', z.tuple([id, path, z.boolean()]), async (w, pid, file, start) => {
    const abs = inProject(w, file);
    if (!/\.(gcode|gco|g|bgcode)$/i.test(abs)) throw new Error('Solo se envían archivos G-code.');
    const client = ps.client(pid);
    if (start) {
      const st = await client.status();
      if (!st.online) throw new Error(st.error ?? 'La impresora no responde.');
      if (st.printing || st.paused) throw new Error(`La impresora está ocupada (${st.state}).`);
    }
    const name = printerFileName(abs);
    await client.upload(name, await readFile(abs), start);
    return name;
  });
  handle('printers:control', z.tuple([id, z.enum(['pause', 'resume', 'cancel'])]), (_w, pid, action) => ps.client(pid).control(action));
}

function registerGamesIpc(): void {
  const g = godot();
  ai.agent.games = g;
  ai.agent.webGames = webGames;
  setGodotLocator(async () => (await g.status()).exe ?? null);
  const rootOf = (w: Win) => {
    if (!w.workspace) throw new Error('No hay carpeta abierta');
    return w.workspace.root;
  };
  const key = z.string().min(1).max(200);
  const dir = z.string().max(500);
  const scene = z.string().max(400).nullable();
  handle('games:status', z.tuple([z.boolean().optional()]), (_w, force) => g.status(force === true));
  handle('games:scan', z.tuple([]), (w) => (w.workspace ? g.scan(w.workspace.root) : { godot: [], others: [], web: [] }));
  handle('games:pickExecutable', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Elige el ejecutable de Godot 4',
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'Godot', extensions: ['exe'] }] } : {}),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    let exe = r.filePaths[0];
    // macOS: the .app bundle → its binary.
    if (exe.endsWith('.app')) exe = join(exe, 'Contents', 'MacOS', 'Godot');
    const st = await g.setExecutable(exe);
    // Open .gd files get GDScript completion now (the server was "missing" before).
    for (const h of lspHosts.values()) void h.restart();
    return st;
  });
  handle('games:forgetExecutable', z.tuple([]), () => g.setExecutable(null));
  handle('games:openEditor', z.tuple([dir, z.string().max(400).optional()]), (w, d, file) => g.openEditor(rootOf(w), d, file));
  handle(
    'games:run',
    z.tuple([key, dir, z.object({ scene, debugCollisions: z.boolean().optional(), debugNavigation: z.boolean().optional() })]),
    (w, k, d, opts) =>
      g.startRun(
        `${w.id}:${k}`,
        rootOf(w),
        d,
        opts,
        (chunk) => send(w, { type: 'games', event: { kind: 'run-data', key: k, chunk } }),
        (code) => send(w, { type: 'games', event: { kind: 'run-end', key: k, code } }),
      ),
  );
  handle('games:stop', z.tuple([key]), (w, k) => g.stopRun(`${w.id}:${k}`));
  handle('games:check', z.tuple([dir]), (w, d) => g.check(rootOf(w), d));
  handle('games:frame', z.tuple([dir, scene, z.number().min(0).max(30)]), async (w, d, sc, at) => {
    const { frames, run } = await g.frames(rootOf(w), d, { scene: sc, at: [at] });
    const f = frames[0];
    return { image: f ? `data:image/png;base64,${f.png.toString('base64')}` : null, problems: run.problems, output: run.output.slice(-20_000) };
  });
  handle('games:export', z.tuple([dir, z.string().min(1).max(100), z.boolean()]), async (w, d, preset, debug) => {
    const r = await g.exportGame(rootOf(w), d, preset, debug);
    return { ok: r.ok, path: r.path, output: r.output.slice(-20_000), problems: r.problems };
  });
  handle('games:create', z.tuple([z.string().min(1).max(64), z.string().min(1).max(40), z.string().max(80)]), (w, folder, template, name) => {
    if (!isGameTemplate(template)) throw new Error('Plantilla desconocida.');
    return g.create(rootOf(w), folder, template, name);
  });
  handle('games:webUrl', z.tuple([z.string().max(500)]), (w, rel) => webGames.url(rootOf(w), rel));
  handle('games:openOther', z.tuple([z.enum(['unity', 'unreal']), dir, z.string().max(200).optional()]), async (w, kind, d, file) => {
    const root = rootOf(w);
    const p = (await g.scan(root)).others.find((o) => o.kind === kind && o.dir === d);
    if (!p) throw new Error('No encontré ese proyecto.');
    if (kind === 'unity') return g.openUnity(root, p);
    // Unreal: the .uproject opens with the engine version it is associated with.
    const err = await shell.openPath(join(root, p.dir, p.file ?? file ?? ''));
    if (err) throw new Error(err);
    return 'Unreal';
  });
  app.on('will-quit', () => {
    g.dispose();
    webGames.stop();
  });
}

/** Fase 5A (plan de funciones): PlatformIO (build, upload, serial monitor). */
function registerPioIpc(): void {
  const pio = new PlatformioService();
  ai.agent.platformio = pio;
  const results = new Map<string, PioResult>();
  // A port opens once: every window sees the same monitor.
  const all = (event: PioEvent) => {
    for (const w of wins.values()) send(w, { type: 'pio', event });
  };
  pio.onSerial = (port, chunk) => all({ kind: 'serial-data', port, chunk });
  pio.onSerialState = (port, open, error) =>
    all({ kind: 'serial-state', port, open, ...(error ? { error } : {}) });
  const rootOf = (w: Win) => {
    if (!w.workspace) throw new Error('No hay carpeta abierta');
    return w.workspace.root;
  };
  const key = z.string().min(1).max(200);
  const port = z.string().min(1).max(200);
  handle('pio:status', z.tuple([z.boolean().optional()]), (_w, force) => pio.status(force === true));
  handle('pio:projects', z.tuple([]), (w) => (w.workspace ? pio.projects(w.workspace.root) : []));
  handle('pio:devices', z.tuple([]), () => pio.devices());
  handle('pio:boards', z.tuple([z.string().max(80)]), (_w, q) => pio.boards(q));
  handle(
    'pio:startJob',
    z.tuple([
      key,
      z.object({
        dir: z.string().max(500),
        env: z.string().max(64).nullable(),
        target: z.enum(['build', 'upload', 'clean', 'compiledb']),
        port: z.string().max(200).nullable().optional(),
      }),
    ]),
    (w, k, job) => {
      const id = `${w.id}:${k}`;
      results.delete(id);
      return pio.startJob(
        id,
        rootOf(w),
        job,
        (chunk) => send(w, { type: 'pio', event: { kind: 'job-data', key: k, chunk } }),
        (r) => {
          results.set(id, r);
          send(w, { type: 'pio', event: { kind: 'job-end', key: k, ok: r.ok } });
        },
      );
    },
  );
  handle('pio:stopJob', z.tuple([key]), (w, k) => pio.stopJob(`${w.id}:${k}`));
  handle('pio:lastResult', z.tuple([key]), (w, k) => results.get(`${w.id}:${k}`) ?? null);
  handle(
    'pio:createProject',
    z.tuple([z.string().min(1).max(64), z.string().min(1).max(80), z.string().min(1).max(40)]),
    (w, name, board, framework) => pio.createProject(rootOf(w), name, board, framework),
  );
  handle('pio:serialOpen', z.tuple([port, z.number().int().min(50).max(4_000_000)]), (_w, p, baud) =>
    pio.openSerial(p, baud),
  );
  handle('pio:serialClose', z.tuple([port]), (_w, p) => pio.closeSerial(p));
  handle('pio:serialWrite', z.tuple([port, z.string().max(64 * 1024)]), (_w, p, data) =>
    pio.writeSerial(p, data),
  );
  handle('pio:serialState', z.tuple([]), () =>
    pio.openPorts().map((o) => ({ ...o, text: pio.serialText(o.port) ?? '' })),
  );
  handle('pio:serialClear', z.tuple([port]), (_w, p) => pio.clearSerial(p));
  handle('pio:searchLibraries', z.tuple([z.string().min(1).max(100), z.number().int().min(1).max(100)]), (_w, q, page) =>
    pio.searchLibraries(q, page),
  );
  handle('pio:libraries', z.tuple([z.string().max(500), z.string().max(100).nullable()]), (w, dir, env) =>
    pio.libraries(rootOf(w), dir, env),
  );
  handle(
    'pio:changeLibrary',
    z.tuple([z.string().max(500), z.string().max(100).nullable(), z.string().min(1).max(120), z.boolean()]),
    (w, dir, env, spec, remove) => pio.changeLibrary(rootOf(w), dir, env, spec, remove).then(() => undefined),
  );
  app.on('will-quit', () => pio.dispose());
}

/** Fase 5B (plan de funciones): phones and emulators (adb, emulator, scrcpy, logcat). */
function registerMobileIpc(): void {
  const m = new MobileService();
  ai.agent.mobile = m;
  const serial = z.string().min(1).max(64);
  const key = z.string().min(1).max(200);
  handle('mobile:tools', z.tuple([z.boolean().optional()]), (_w, force) => m.tools(force === true));
  handle('mobile:devices', z.tuple([]), () => m.devices());
  handle('mobile:avds', z.tuple([]), () => m.avds());
  handle('mobile:projects', z.tuple([]), (w) => (w.workspace ? m.projects(w.workspace.root) : []));
  handle('mobile:startEmulator', z.tuple([z.string().min(1).max(100)]), (_w, avd) => m.startEmulator(avd));
  handle('mobile:mirror', z.tuple([serial]), (_w, s) => m.mirror(s));
  handle('mobile:screenshot', z.tuple([serial]), async (_w, s) =>
    `data:image/png;base64,${(await m.screenshot(s)).toString('base64')}`,
  );
  handle('mobile:followLogcat', z.tuple([key, serial]), (w, k, s) =>
    m.followLogcat(
      `${w.id}:${k}`,
      s,
      (chunk) => send(w, { type: 'mobile', event: { kind: 'logcat', key: k, chunk } }),
      () => send(w, { type: 'mobile', event: { kind: 'logcat-end', key: k } }),
    ),
  );
  handle('mobile:stopLogcat', z.tuple([key]), (w, k) => m.stopLogcat(`${w.id}:${k}`));
  handle(
    'mobile:input',
    z.tuple([
      serial,
      z.object({
        kind: z.enum(['tap', 'long_press', 'swipe', 'text', 'key']),
        x: z.number().optional(),
        y: z.number().optional(),
        x2: z.number().optional(),
        y2: z.number().optional(),
        ms: z.number().optional(),
        text: z.string().max(1000).optional(),
        key: z.string().max(40).optional(),
      }),
    ]),
    (_w, s, i) => m.input(s, i as MobileInput),
  );
  handle('mobile:packages', z.tuple([serial, z.boolean()]), (_w, s, third) => m.packages(s, third));
  handle(
    'mobile:app',
    z.tuple([serial, z.string().min(1).max(200), z.enum(['launch', 'stop', 'clear', 'uninstall'])]),
    (_w, s, pkg, action) => m.app(s, pkg, action).then(() => undefined),
  );
  handle('mobile:apks', z.tuple([]), (w) => (w.workspace ? m.apks(w.workspace.root) : []));
  handle('mobile:install', z.tuple([serial, z.string().min(1).max(1000)]), async (w, s, rel) => {
    if (!w.workspace) throw new Error('No hay carpeta abierta');
    if (!(await m.apks(w.workspace.root)).includes(rel)) throw new Error('Ese .apk no está en la carpeta.');
    await m.install(s, join(w.workspace.root, rel));
  });
  handle('mobile:connect', z.tuple([z.string().min(3).max(300), z.string().max(6).nullable()]), (_w, addr, code) =>
    m.connect(addr, code ?? undefined).then((out) => out.trim()),
  );
  handle('mobile:disconnect', z.tuple([z.string().min(3).max(300)]), (_w, addr) => m.disconnect(addr));
  handle(
    'mobile:command',
    z.tuple([z.string().max(500), z.enum(['run', 'build', 'ios']), serial.nullable()]),
    async (w, dir, action, s) => {
      if (!w.workspace) throw new Error('No hay carpeta abierta');
      const p = (await m.projects(w.workspace.root)).find((x) => x.dir === dir);
      if (!p) throw new Error('Ese proyecto no está en la carpeta.');
      return projectCommand(p, action, { platform: process.platform, serial: s });
    },
  );
  app.on('will-quit', () => m.dispose());
}

function registerDockerIpc(): void {
  const d = (docker = new DockerService());
  ai.agent.docker = d;
  const name = z.string().min(1).max(256);
  handle('docker:status', z.tuple([]), () => d.status());
  handle('docker:startDesktop', z.tuple([]), () => d.startDesktop());
  handle('docker:containers', z.tuple([]), () => d.containers());
  handle('docker:images', z.tuple([]), () => d.images());
  handle('docker:volumes', z.tuple([]), () => d.volumes());
  handle('docker:networks', z.tuple([]), () => d.networks());
  handle(
    'docker:action',
    z.tuple([
      z.enum(['start', 'stop', 'restart', 'pause', 'unpause', 'rm', 'rmi', 'volume-rm']),
      name,
    ]),
    (_w, action, target) => d.action(action, target),
  );
  const list = z.array(z.string().max(4096)).max(100);
  handle(
    'docker:run',
    z.tuple([
      z.object({
        image: name,
        name: z.string().max(128).optional(),
        ports: list.optional(),
        env: list.optional(),
        volumes: list.optional(),
        restart: z.enum(['no', 'always', 'unless-stopped', 'on-failure']).optional(),
        rm: z.boolean().optional(),
        command: list.optional(),
      }),
    ]),
    (_w, spec) => d.runContainer(spec),
  );
  handle('docker:composeFiles', z.tuple([]), (w) =>
    w.workspace ? d.composeFiles(w.workspace.root) : [],
  );
  handle(
    'docker:compose',
    z.tuple([z.string().min(1).max(4096), z.enum(['up', 'down', 'ps', 'restart', 'pull'])]),
    (w, file, action) => {
      if (!w.workspace) throw new Error('No hay carpeta abierta');
      return d.compose(w.workspace.root, file, action);
    },
  );
  const key = z.string().min(1).max(200);
  handle('docker:followLogs', z.tuple([key, name]), (w, k, container) =>
    d.followLogs(
      `${w.id}:${k}`,
      container,
      (chunk) => send(w, { type: 'docker', event: { kind: 'logs', key: k, chunk } }),
      () => send(w, { type: 'docker', event: { kind: 'logs-end', key: k } }),
    ),
  );
  handle('docker:stopLogs', z.tuple([key]), (w, k) => d.stopLogs(`${w.id}:${k}`));
  handle('docker:stats', z.tuple([]), () => d.stats());
  handle('docker:inspect', z.tuple([name]), (_w, target) => d.inspect(target));
  handle('docker:diskUsage', z.tuple([]), () => d.diskUsage());
  handle(
    'docker:prune',
    z.tuple([z.enum(['containers', 'images', 'build', 'volumes'])]),
    (_w, kind) => d.prune(kind),
  );
  handle('docker:dockerfiles', z.tuple([]), (w) =>
    w.workspace ? d.dockerfiles(w.workspace.root) : [],
  );
  handle(
    'docker:startJob',
    z.tuple([
      key,
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('pull'), image: name }),
        z.object({ kind: z.literal('build'), dockerfile: z.string().min(1).max(4096), tag: name }),
      ]),
    ]),
    (w, k, job) =>
      d.startJob(
        `${w.id}:${k}`,
        w.workspace?.root ?? null,
        job,
        (chunk) => send(w, { type: 'docker', event: { kind: 'logs', key: k, chunk } }),
        (ok) => send(w, { type: 'docker', event: { kind: 'job-end', key: k, ok } }),
      ),
  );
  app.on('will-quit', () => d.dispose());
}

/** Fase 2A (plan de funciones): Jupyter notebooks (cells run on a local Jupyter Server). */
function registerNotebookIpc(): void {
  /** A notebook of the open folder: relative, forward slashes, never leaving it. */
  const nbPath = z
    .string()
    .min(1)
    .max(4096)
    .refine(
      (p) => /\.ipynb$/i.test(p) && !isAbsolute(p) && !p.split(/[\\/]/).includes('..'),
      'bad notebook path',
    );
  const kernelId = z.string().max(200).nullable();
  const rootOf = (w: Win) => {
    if (!w.workspace) throw new Error('No hay carpeta abierta');
    return w.workspace.root;
  };
  handle('notebook:status', z.tuple([z.boolean().optional()]), async (w, force) => ({
    status: await notebooksOf(w).status(w.workspace?.root ?? null, force === true),
    python: notebooksOf(w).python,
  }));
  handle('notebook:interpreters', z.tuple([]), (w) =>
    notebooksOf(w).interpreters(w.workspace?.root ?? null),
  );
  handle('notebook:usePython', z.tuple([z.string().min(1).max(4096).nullable()]), (w, cmd) =>
    notebooksOf(w).usePython(cmd),
  );
  handle('notebook:kernelspecs', z.tuple([]), (w) => notebooksOf(w).kernelspecs(rootOf(w)));
  handle('notebook:start', z.tuple([nbPath, kernelId]), (w, rel, kernel) =>
    notebooksOf(w).start(rootOf(w), rel, kernel),
  );
  handle(
    'notebook:execute',
    z.tuple([nbPath, z.string().min(1).max(200), z.string().max(2_000_000)]),
    (w, rel, cellId, code) => notebooksOf(w).execute(rel, cellId, code),
  );
  handle('notebook:interrupt', z.tuple([nbPath]), (w, rel) => notebooksOf(w).interrupt(rel));
  handle('notebook:restart', z.tuple([nbPath]), (w, rel) => notebooksOf(w).restart(rel));
  handle('notebook:shutdown', z.tuple([nbPath]), (w, rel) => notebooksOf(w).shutdown(rel));
  const cellCode = z.string().max(200_000);
  const cursor = z.number().int().min(0).max(200_000);
  handle('notebook:complete', z.tuple([nbPath, cellCode, cursor]), (w, rel, code, at) =>
    notebooksOf(w).complete(rel, code, at),
  );
  handle('notebook:inspect', z.tuple([nbPath, cellCode, cursor]), (w, rel, code, at) =>
    notebooksOf(w).inspect(rel, code, at),
  );
  handle('notebook:variables', z.tuple([nbPath]), (w, rel) => notebooksOf(w).variables(rel));
  // The agent's notebook_run uses the kernel of the window that has the folder open.
  ai.agent.notebooks = (root) => {
    const w = [...wins.values()].find((x) => x.workspace?.root === root);
    if (w) return notebooksOf(w);
    let k = agentKernels.get(root);
    if (!k) {
      k = new NotebookKernels(() => undefined);
      agentKernels.set(root, k);
    }
    return k;
  };
  app.on('will-quit', () => {
    for (const k of [...notebookKernels.values(), ...agentKernels.values()]) k.killNow();
  });
}

/** Fase 9: Playground (one model or several side by side) and Build. */
/** Fase 10: image / video / speech generation (Generate panel and generate_* agent tools). */
function registerMediaIpc(): void {
  const media = new MediaService(ai.core, app.getPath('userData'));
  ai.agent.media = media;
  // Fase 1A (plan de funciones): image_info / image_edit decode and encode with FFmpeg.
  ai.agent.images = new ImageService(() => videoService().tools().ffmpeg);
  // Fase 1B: image_remove_bg runs the background model on this PC.
  ai.agent.images.bg = bgRemove();
  // Fase 3 (plan de funciones): svg_render / svg_export draw SVG files in a hidden window.
  ai.agent.raster = rasterSvg;
  // Computer use (computer_* tools): the screen, mouse and keyboard of the whole computer.
  const computer = new Computer();
  ai.agent.computer = computer;
  app.on('will-quit', () => computer.dispose());
  const genReq = z.object({
    kind: z.enum(['image', 'video', 'speech', 'music']),
    provider: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .max(64),
    model: z.string().min(1).max(200),
    prompt: z.string().max(20_000),
    style: z.string().max(500).optional(),
    aspect: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional(),
    durationSec: z.number().int().min(1).max(120).optional(),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 31)
      .optional(),
    count: z.number().int().min(1).max(4).optional(),
    quality: z.enum(['low', 'medium', 'high']).optional(),
    voice: z.string().max(64).optional(),
    transparent: z.boolean().optional(),
  });
  handle('media:models', z.tuple([]), () => media.models());
  handle('media:estimate', z.tuple([genReq]), (_w, req) => media.estimate(req));
  handle('media:outDir', z.tuple([]), (w) => media.outDir(w.workspace?.root));
  handle('media:generate', z.tuple([str, genReq]), (w, requestId, req) => {
    const id = rid(w, requestId);
    w.requests.add(id);
    return media
      .generate(id, req, w.workspace?.root, (event) => send(w, { type: 'media', requestId, event }))
      .finally(() => w.requests.delete(id));
  });
  handle('media:abort', z.tuple([str]), (w, requestId) => media.abort(rid(w, requestId)));
}

/** Fase 14: 3D models generated on Replicate (editor dialog and generate_3d_model tool). */
function registerGen3dIpc(): void {
  const gen = new Gen3DService(ai.core, app.getPath('userData'));
  ai.agent.gen3d = gen;
  const req = z.object({
    model: z.enum(GEN3D_MODELS.map((m) => m.id) as [string, ...string[]]),
    prompt: z.string().max(1000).optional(),
    image: z.string().max(4096).refine(isGen3dImage).optional(),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 31)
      .optional(),
  });
  handle('gen3d:info', z.tuple([]), async (w) => ({
    connected: await gen.connected(),
    models: [...GEN3D_MODELS],
    outDir: gen.outDir(w.workspace?.root),
  }));
  handle('gen3d:pickImage', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Imagen del objeto',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    const p = r.canceled ? undefined : r.filePaths[0];
    return p && isGen3dImage(resolve(p)) ? resolve(p) : null;
  });
  handle('gen3d:generate', z.tuple([str, req]), async (w, requestId, r) => {
    const id = rid(w, requestId);
    w.requests.add(id);
    try {
      const out = await gen.generate(id, r, w.workspace?.root, (event) =>
        send(w, { type: 'gen3d', requestId, event }),
      );
      return { ...out, url: videoService().urlFor(out.path) };
    } finally {
      w.requests.delete(id);
    }
  });
  handle('gen3d:abort', z.tuple([str]), (w, requestId) => gen.abort(rid(w, requestId)));
}

/**
 * Fase 13B: the agent's video_* tools run in the window that holds Video Studio (the focused
 * one, else the first). Main only relays, and picks the export file: an agent export may write
 * only the .mp4 shown on the approval card.
 */
function registerVideoAgentIpc(): void {
  const pending = new Map<
    string,
    { resolve: (r: VideoAgentResult) => void; reject: (e: Error) => void }
  >();
  const target = (): Win | undefined => {
    const f = BrowserWindow.getFocusedWindow();
    return [...wins.values()].find((w) => w.win === f) ?? wins.values().next().value;
  };
  /** The export file for a call: its "path" (an absolute .mp4) or a new one in Videos. */
  const outFor = (a: Record<string, unknown>): string => {
    const asked = typeof a.path === 'string' ? a.path.trim() : '';
    if (asked) {
      if (!isAbsolute(asked)) throw new Error('"path" must be an absolute path.');
      return resolve(asked.toLowerCase().endsWith('.mp4') ? asked : `${asked}.mp4`);
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    let out = join(app.getPath('videos'), `zinarix-${stamp}.mp4`);
    for (let i = 2; existsSync(out); i++)
      out = join(app.getPath('videos'), `zinarix-${stamp}-${i}.mp4`);
    return out;
  };
  const outs = new Map<string, string>();
  ai.agent.videoUi = {
    call: (name, args, dry, signal) =>
      new Promise((res, rej) => {
        const w = target();
        if (!w) return rej(new Error('No window is open.'));
        let a = args;
        if (name === 'video_export') {
          // The dry run picks the file; the run after approval writes that same one.
          const key = JSON.stringify(args);
          const out = dry ? outFor(args) : (outs.get(key) ?? outFor(args));
          if (dry) {
            outs.set(key, out);
            if (outs.size > 20) outs.delete(outs.keys().next().value!);
          } else videoOutputs.add(out);
          a = { ...args, __out: out };
        }
        const requestId = randomUUID();
        const timer = setTimeout(
          () => {
            if (pending.delete(requestId)) rej(new Error('Video Studio did not answer in time.'));
          },
          dry ? 120_000 : 3 * 60 * 60_000,
        );
        pending.set(requestId, {
          resolve: (r) => {
            clearTimeout(timer);
            res(r);
          },
          reject: (e) => {
            clearTimeout(timer);
            rej(e);
          },
        });
        signal?.addEventListener(
          'abort',
          () => {
            send(w, { type: 'video:agentAbort', requestId });
            const p = pending.get(requestId);
            pending.delete(requestId);
            p?.reject(new Error('Canceled.'));
          },
          { once: true },
        );
        send(w, { type: 'video:agent', requestId, name, args: a, dry });
      }),
  };
  handle(
    'video:agentDone',
    z.tuple([
      z.string().uuid(),
      z.object({
        ok: z.boolean(),
        content: z.string().max(400_000),
        summary: z.string().max(4000),
      }),
    ]),
    (_w, id, r) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      p.resolve(r);
    },
  );
}

/** Fase 14: 3D scenes to video (viewer frames, Blender), and .z3d scene files. */
function registerScene3dIpc(): void {
  // 3D Pro: Blender's AI add-on uses the models connected here through a local bridge.
  const bridgeDeps: BridgeDeps = {
    models: async () =>
      (await ai.models(false)).models.map((m) => ({
        id: `${m.provider}/${m.id}`,
        ownedBy: m.provider,
      })),
    complete: async (req, signal) => {
      let messages: ChatMessage[] = req.messages;
      // CLI agents (Claude Code, Codex…) drop system prompts: fold them into the user turn.
      const ref = ai.core.resolveModel(req.model, 'chat');
      const entry = ai.core.provider(ref.provider);
      if (entry.adapter === 'cli-agent') {
        // Whoever holds the token is not the user at the keyboard: the CLI runs with no
        // tools in an empty folder (noTools). A web page only gets CLIs that then truly
        // cannot read files (Codex's read-only sandbox, for one, still reads the whole disk).
        if (req.fromWeb && !cliRunsWithoutTools(entry.cli?.profile))
          throw new Error(
            `${entry.name} can read files on this computer, so it cannot answer web pages through the bridge. Pick another model (an API one, Ollama, Claude Code or Gemini CLI).`,
          );
        const sys = messages.filter((m) => m.role === 'system').map((m) => m.content);
        messages = messages.filter((m) => m.role !== 'system');
        if (sys.length) messages = withProtocol(messages, sys.join('\n\n'), 'user');
      }
      try {
        const r = await ai.core.complete(
          {
            model: req.model,
            role: 'chat',
            maxTokens: req.maxTokens ?? 4096,
            messages,
            noTools: true,
            // A fallback could land on a CLI the check above did not see.
            ...(req.fromWeb ? { noFallback: true } : {}),
          },
          signal,
        );
        return { text: r.text, model: r.provider ? `${r.provider}/${r.model}` : r.model };
      } catch (e) {
        throw new Error(describeError(e).message);
      }
    },
  };
  // Permanent bridge: fixed port and token, opened with the app and announced in
  // ~/.zinarix/blender-bridge.json so any Blender with the add-on finds it. Off: it opens
  // only for "Modo Pro", on a random port, and Blender gets it in its environment.
  const bridgeStore = new BridgeStore(app.getPath('userData'));
  let bridgeCfg = bridgeStore.load();
  // Tasks left on the bridge (POST /v1/jobs): saved to disk, they go on with the window
  // closed and continue after a shutdown, the next time Zinarix opens.
  const bridgeJobs = new BridgeJobQueue(app.getPath('userData'), bridgeDeps);
  bridgeJobs.onChange = () => updateTray();
  bridgeJobs.start();
  const makeBridge = () =>
    new BlenderBridge(
      bridgeDeps,
      // Web origins are read live, so editing the list needs no restart.
      bridgeCfg.permanent
        ? {
            port: bridgeCfg.port,
            token: bridgeCfg.token,
            origins: () => bridgeCfg.origins,
            jobs: bridgeJobs,
          }
        : {},
    );
  let bridge = makeBridge();
  const openPermanent = async () => {
    const info = await bridge.start();
    bridgeStore.publish(info);
    return info;
  };
  // The token goes to the app's own UI only, so the user can paste it into a web app.
  const bridgeState = () => ({
    permanent: bridgeCfg.permanent,
    url: bridge.info?.url ?? null,
    token: bridgeCfg.permanent && bridge.info ? bridgeCfg.token : null,
    origins: bridgeCfg.origins,
  });
  // On: Zinarix stays in the tray when its windows close and opens (hidden) at login, so
  // Blender and web apps keep the bridge and the tasks left on it keep running.
  background = {
    on: () => bridgeCfg.permanent || bridgeJobs.pending > 0,
    url: () => bridge.info?.url ?? null,
    pending: () => bridgeJobs.pending,
    stop: () => bridgeJobs.stop(),
  };
  const syncBackground = () => {
    loginWants.background = bridgeCfg.permanent;
    applyLoginItem();
    updateTray();
  };
  syncBackground();
  if (bridgeCfg.permanent)
    void openPermanent()
      .then(() => updateTray())
      .catch((e) => console.error('[3d-pro] permanent bridge:', e));
  app.on('will-quit', () => {
    bridgeJobs.stop();
    bridgeStore.unpublish();
    void bridge.close();
  });
  handle('scene3d:bridge', z.tuple([]), async () => bridgeState());
  handle('scene3d:setBridge', z.tuple([z.boolean()]), async (_w, on) => {
    if (on !== bridgeCfg.permanent) {
      bridgeStore.unpublish();
      await bridge.close();
      // Turning it off retires the token: Blenders that read the old file can no longer use it.
      bridgeCfg = { ...bridgeCfg, permanent: on, ...(on ? {} : { token: newBridgeToken() }) };
      bridgeStore.save(bridgeCfg);
      bridge = makeBridge();
    }
    if (on) await openPermanent();
    syncBackground();
    return bridgeState();
  });
  handle(
    'scene3d:setBridgeOrigins',
    z.tuple([z.array(z.string().max(500)).max(MAX_ORIGINS * 2)]),
    async (_w, list) => {
      bridgeCfg = { ...bridgeCfg, origins: cleanOrigins(list) };
      bridgeStore.save(bridgeCfg);
      return bridgeState();
    },
  );
  // A token pasted into a web app (or read from the file) stops working: reopen with a new one.
  handle('scene3d:rotateBridgeToken', z.tuple([]), async () => {
    const was = bridgeCfg.permanent && !!bridge.info;
    bridgeStore.unpublish();
    await bridge.close();
    bridgeCfg = { ...bridgeCfg, token: newBridgeToken() };
    bridgeStore.save(bridgeCfg);
    bridge = makeBridge();
    if (was) await openPermanent();
    return bridgeState();
  });
  const svc = new Scene3DService(
    app.getPath('userData'),
    () => videoService().tools().ffmpeg,
    () => (bridgeCfg.permanent ? openPermanent() : bridge.start()),
  );
  ai.agent.scene3d = svc;
  // Fase 7: structured Blender edits (blender_model / blender_inspect) use the same Blender.
  ai.agent.blenderModel = new BlenderModelService(() => svc.findBlender());
  blenderVersion = async () => (await svc.findBlender())?.version ?? null;
  const id = z.string().uuid();
  // The agent's viewer renders run in a window: the focused one, else the first.
  type EditorAnswer = { ok: boolean; content: string; summary: string };
  const pending = new Map<
    string,
    { resolve: (r: { path: string }) => void; reject: (e: Error) => void }
  >();
  // scene3d_state / scene3d_edit / scene3d_render: answered by the window's 3D editor.
  const editing = new Map<string, (r: EditorAnswer) => void>();
  const target = (): Win | undefined => {
    const f = BrowserWindow.getFocusedWindow();
    return [...wins.values()].find((w) => w.win === f) ?? wins.values().next().value;
  };
  ai.agent.scene3dUi = {
    render: (scene, name, format) =>
      new Promise((resolve, reject) => {
        const w = target();
        if (!w) return reject(new Error('No hay ninguna ventana abierta.'));
        const requestId = randomUUID();
        pending.set(requestId, { resolve, reject });
        send(w, { type: 'scene3d:agent', requestId, scene, name, format });
        setTimeout(() => {
          if (pending.delete(requestId)) reject(new Error('El visor 3D no respondió a tiempo.'));
        }, 30 * 60_000);
      }),
    imported: (path) => {
      const w = target();
      if (w) send(w, { type: 'scene3d:imported', path });
    },
    editor: (name, args) =>
      new Promise((resolve) => {
        const w = target();
        if (!w)
          return resolve({ ok: false, content: 'No window is open.', summary: 'sin ventana' });
        const requestId = randomUUID();
        editing.set(requestId, resolve);
        send(w, { type: 'scene3d:edit', requestId, name, args });
        setTimeout(
          () => {
            if (editing.delete(requestId))
              resolve({
                ok: false,
                content: 'The 3D editor did not answer.',
                summary: 'sin respuesta',
              });
          },
          name === 'scene3d_render' ? 30 * 60_000 : 30_000,
        );
      }),
  };
  handle(
    'scene3d:agentDone',
    z.tuple([
      id,
      z.union([
        z.object({ path: z.string().min(1).max(4096) }),
        z.object({ error: z.string().max(2000) }),
        z.object({
          ok: z.boolean(),
          content: z.string().max(200_000),
          summary: z.string().max(200),
        }),
      ]),
    ]),
    (_w, i, r) => {
      if ('ok' in r) {
        editing.get(i)?.(r);
        editing.delete(i);
        return;
      }
      const p = pending.get(i);
      if (!p) return;
      pending.delete(i);
      if ('path' in r) p.resolve({ path: r.path });
      else p.reject(new Error(r.error));
    },
  );
  const fmt = z.enum(['webm', 'mp4', 'png']);
  const name = z.string().max(80);
  const sceneArg = z.custom<Scene3D>((x) => {
    try {
      sanitizeScene(x);
      return true;
    } catch {
      return false;
    }
  }, 'escena 3D no válida');
  const scenePaths = new Set<string>();
  const Z3D = [{ name: 'Escena 3D de Zinarix', extensions: ['z3d'] }];
  handle('scene3d:info', z.tuple([z.boolean().optional()]), async (w, refresh) => ({
    blender: await svc.findBlender(refresh === true),
    outDir: svc.outDir(w.workspace?.root),
  }));
  handle('scene3d:pickBlender', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Elegir el motor Pro (Blender)',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Blender', extensions: ['exe'] }] : [],
    });
    const p = r.canceled ? undefined : r.filePaths[0];
    if (!p) return null;
    return (await svc.useBlender(resolve(p))) ?? false;
  });
  const cssColor = z.string().max(64);
  handle(
    'scene3d:openPro',
    z.tuple([
      z.enum(['es', 'en']),
      z
        .object({ dark: z.boolean(), bg: cssColor, fg: cssColor, accent: cssColor })
        .strict()
        .optional(),
    ]),
    async (_w, lang, look) =>
      svc.openPro(
        app.isPackaged
          ? join(process.resourcesPath, 'blender-scripts')
          : join(appRoot, 'blender', 'scripts'),
        lang,
        undefined,
        look,
      ),
  );
  handle(
    'scene3d:begin',
    z.tuple([
      z.object({
        width: z.number().int().min(16).max(3840),
        height: z.number().int().min(16).max(2160),
        fps: z.number().int().min(1).max(60),
        format: fmt,
        name,
      }),
    ]),
    (w, o) => {
      if (o.width % 2 || o.height % 2) throw new Error('El tamaño debe ser par.');
      return svc.begin(o, w.workspace?.root);
    },
  );
  handle('scene3d:frame', z.tuple([id, z.instanceof(Uint8Array)]), (_w, i, rgba) =>
    svc.frame(i, rgba),
  );
  handle('scene3d:end', z.tuple([id]), (_w, i) => svc.end(i));
  handle('scene3d:cancel', z.tuple([id]), (_w, i) => svc.cancel(i));
  handle(
    'scene3d:blender',
    z.tuple([
      id,
      sceneArg,
      z.object({
        engine: z.enum(['eevee', 'cycles']),
        format: fmt,
        name,
        samples: z.number().int().min(1).max(4096).optional(),
      }),
    ]),
    (w, i, scene, o) =>
      svc.renderWithBlender(
        sanitizeScene(scene),
        o,
        w.workspace?.root,
        (progress) => send(w, { type: 'scene3d', requestId: i, progress }),
        undefined,
        i,
      ),
  );
  handle('scene3d:pickModel', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Importar modelo 3D',
      properties: ['openFile'],
      filters: [{ name: 'Modelos 3D', extensions: ['glb', 'gltf', 'obj', 'fbx'] }],
    });
    const p = r.canceled ? undefined : r.filePaths[0];
    if (!p || !isModelPath(resolve(p))) return null;
    return { path: resolve(p), url: videoService().urlFor(resolve(p)) };
  });
  handle('scene3d:modelUrl', z.tuple([z.string().min(1).max(4096)]), (_w, p) => {
    const abs = resolve(p);
    return isModelPath(abs) && existsSync(abs) && statSync(abs).isFile()
      ? videoService().urlFor(abs)
      : null;
  });
  handle(
    'scene3d:save',
    z.tuple([sceneArg, z.string().max(4096).nullable(), z.boolean()]),
    async (w, scene, path, saveAs) => {
      let target = path && !saveAs && scenePaths.has(resolve(path)) ? resolve(path) : null;
      if (!target) {
        const r = await dialog.showSaveDialog(w.win, {
          title: 'Guardar escena 3D',
          defaultPath: 'escena.z3d',
          filters: Z3D,
        });
        if (r.canceled || !r.filePath) return null;
        target = resolve(
          r.filePath.toLowerCase().endsWith('.z3d') ? r.filePath : `${r.filePath}.z3d`,
        );
      }
      await writeFile(target, JSON.stringify(sanitizeScene(scene), null, 2), 'utf8');
      scenePaths.add(target);
      return target;
    },
  );
  handle('scene3d:open', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Abrir escena 3D',
      properties: ['openFile'],
      filters: Z3D,
    });
    const p = r.canceled ? undefined : r.filePaths[0];
    if (!p) return null;
    const abs = resolve(p);
    if (statSync(abs).size > 5_000_000) throw new Error('El archivo es demasiado grande.');
    const scene = sanitizeScene(JSON.parse(await readFile(abs, 'utf8')));
    scenePaths.add(abs);
    return { scene, path: abs };
  });
}

function registerPlaygroundIpc(): void {
  const playground = new PlaygroundService(ai.core, app.getPath('userData'));
  const build = new BuildService(
    app.getPath('userData'),
    () => new Vercel(app.getPath('userData')),
  );
  const model = z.string().min(1).max(300);
  const jsonObject = z.record(z.string(), z.unknown());
  const params = z.object({
    system: z.string().max(200_000),
    prompt: z.string().max(2_000_000),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(1).max(1_000_000).optional(),
    reasoning: z.enum(['low', 'medium', 'high']).optional(),
    tools: z
      .array(
        z.object({
          name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
          description: z.string().max(4000),
          parameters: jsonObject,
        }),
      )
      .max(32),
    schema: z.string().max(200_000),
    strict: z.boolean().optional(),
  });
  const runReq = params.extend({
    model,
    attachments: z
      .array(
        z.object({
          name: z.string().min(1).max(255),
          mediaType: z
            .string()
            .regex(/^[a-z]+\/[a-z0-9.+-]+$/i)
            .max(100),
          // 20 MB of file is ~27 MB of base64.
          data: z.string().max(28 * 1024 * 1024),
        }),
      )
      .max(10),
  });
  const templateId = z.string().regex(/^t[0-9a-f]{12}$/);
  handle('playground:run', z.tuple([str, runReq]), (w, requestId, req) => {
    const id = rid(w, requestId);
    w.requests.add(id);
    return playground
      .run(id, req, (event) => send(w, { type: 'playground', requestId, event }))
      .finally(() => w.requests.delete(id));
  });
  handle('playground:abort', z.tuple([str]), (w, requestId) => playground.abort(rid(w, requestId)));
  handle('playground:code', z.tuple([z.enum(['ts', 'python', 'curl']), runReq]), (_w, lang, req) =>
    playground.code(lang, req),
  );
  handle('playground:adapter', z.tuple([model]), (_w, m) => playground.adapterOf(m));
  handle('playground:templates', z.tuple([]), () => playground.templates());
  handle(
    'playground:saveTemplate',
    z.tuple([
      params,
      z.object({
        id: templateId.optional(),
        name: z.string().max(80).optional(),
        model: model.optional(),
        note: z.string().max(200).optional(),
      }),
    ]),
    (_w, p, opts) => playground.saveTemplate(p, opts),
  );
  handle('playground:deleteTemplate', z.tuple([templateId]), (_w, id) =>
    playground.deleteTemplate(id),
  );

  const buildsDir = () => join(app.getPath('documents'), 'Zinarix Apps');
  handle('build:defaultParent', z.tuple([]), () => buildsDir());
  handle('build:pickParent', z.tuple([]), async (w) => {
    const r = await dialog.showOpenDialog(w.win, {
      defaultPath: buildsDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle(
    'build:create',
    z.tuple([z.string().min(1).max(4096), z.string().min(1).max(20_000)]),
    (_w, parent, description) => build.create(parent, description),
  );
  handle('build:info', z.tuple([]), (w) => (w.workspace ? build.info(w.workspace.root) : null));
  handle('build:recent', z.tuple([]), () => build.recent());
  const team = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .nullable();
  // The renderer confirms (production or preview) before calling this.
  handle('build:deploy', z.tuple([team, z.boolean()]), (w, teamId, production) =>
    build.deploy(ws(w).root, teamId, production),
  );
  handle(
    'build:deployState',
    z.tuple([z.string().regex(/^dpl_[A-Za-z0-9]{1,64}$/), team]),
    (_w, id, teamId) => build.deployState(id, teamId),
  );
}

function registerTasksIpc(): void {
  const taskId = z.string().uuid();
  const folderOf = (w: Win, folder?: string) => {
    const root = folder ? resolve(folder) : w.workspace?.root;
    if (!root) throw new Error('Abre una carpeta (un repositorio git) para crear tareas.');
    return root;
  };
  handle('tasks:status', z.tuple([]), () => taskManager().status());
  handle(
    'tasks:create',
    z.tuple([
      z.object({
        folder: z.string().min(1).max(4096).optional(),
        prompt: big,
        model: str.optional(),
        mode: z.enum(['agent', 'auto']).optional(),
        base: z.string().max(200).optional(),
        copyChanges: z.boolean().optional(),
        setup: z.boolean().optional(),
        maxUsd: z.number().positive().max(10_000).optional(),
        maxMinutes: z.number().int().positive().max(1440).optional(),
      }),
    ]),
    (w, req) => taskManager().create({ ...req, folder: folderOf(w, req.folder) }),
  );
  handle('tasks:setupScript', z.tuple([z.string().min(1).max(4096).optional()]), (w, folder) => {
    const file = join(folderOf(w, folder), SETUP_SCRIPT);
    return existsSync(file) ? readFileSync(file, 'utf8').slice(0, 4000) : null;
  });
  handle(
    'tasks:decide',
    z.tuple([taskId, str, z.enum(['approve', 'deny', 'always'])]),
    (_w, id, call, d) => taskManager().decide(id, call, d),
  );
  handle(
    'tasks:answer',
    z.tuple([taskId, str, z.array(z.string().max(2000)).max(10).nullable()]),
    (_w, id, call, answer) => taskManager().answer(id, call, answer),
  );
  handle('tasks:reopen', z.tuple([taskId]), (_w, id) => taskManager().reopen(id));
  handle('tasks:archiveIdle', z.tuple([]), () => taskManager().archiveIdle());
  handle('tasks:usage', z.tuple([z.boolean().optional()]), (_w, fresh) =>
    taskManager().usage(fresh),
  );
  handle('tasks:output', z.tuple([taskId]), (_w, id) => taskManager().output(id));
  handle('tasks:diff', z.tuple([taskId]), (_w, id) => taskManager().diff(id));
  handle('tasks:pause', z.tuple([taskId]), (_w, id) => taskManager().pause(id));
  handle('tasks:cancel', z.tuple([taskId]), (_w, id) => taskManager().cancel(id));
  handle('tasks:resume', z.tuple([taskId, big.optional()]), (_w, id, p) =>
    taskManager().resume(id, p),
  );
  handle('tasks:merge', z.tuple([taskId]), (_w, id) => taskManager().merge(id));
  handle('tasks:resolveWithAgent', z.tuple([taskId]), (_w, id) =>
    taskManager().resolveWithAgent(id),
  );
  handle('tasks:openPr', z.tuple([taskId]), (_w, id) => taskManager().openPr(id));
  handle('tasks:keep', z.tuple([taskId]), (_w, id) => taskManager().keep(id));
  handle('tasks:discard', z.tuple([taskId]), (_w, id) => taskManager().discard(id));
  handle('tasks:clearClosed', z.tuple([]), () => taskManager().clearClosed());
  handle('tasks:openFolder', z.tuple([taskId]), async (_w, id) => {
    const t = taskManager()
      .status()
      .tasks.find((x) => x.id === id);
    if (t && !t.closed && existsSync(t.path)) await shell.openPath(t.path);
  });
}

function registerDesignIpc(): void {
  const src = z.string().min(1).max(4096);
  const css = z.record(z.string().max(60), z.string().max(200).nullable());
  const op = z.union([
    z.object({ kind: z.literal('setText'), src, html: z.string().max(200_000) }),
    z.object({ kind: z.literal('setStyle'), src, styles: css }),
  ]);
  handle('design:open', z.tuple([]), async (w) => {
    const session = new DesignSession(ws(w), `zxp://w${w.id}`);
    w.design = { root: ws(w).root, session };
    return session.open();
  });
  handle('design:close', z.tuple([]), (w) => {
    w.design = undefined;
  });
  handle('design:apply', z.tuple([op]), (w, o) => designCall(() => designOf(w).apply(o)));
  handle('design:undo', z.tuple([]), (w) => designCall(() => designOf(w).undo()));
  handle('design:redo', z.tuple([]), (w) => designCall(() => designOf(w).redo()));
  handle('design:stale', z.tuple([rel]), (w, file) => designOf(w).stale(file));
  const how = z.object({
    mode: z.enum(['live', 'built', 'none']),
    dir: z.string().max(1024),
    url: z.string().max(2048).optional(),
  });
  handle('design:show', z.tuple([how]), (w, h) => {
    const s = designOf(w);
    if (h.mode === 'live') return s.showLive(h.dir, h.url ?? '');
    if (h.mode === 'built') return s.showBuilt(h.dir);
    return s.hide();
  });
  handle('design:detect', z.tuple([z.string().max(1024)]), (w, dir) => designOf(w).detect(dir));
}

const PREVIEW_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.otf': 'font/otf',
};

/**
 * zxp://w<window>/<file>: the open project's files for the preview frame of the Panel de
 * Edición. Only while that window has the panel open, only inside its folder (the same
 * checks as every other file access); HTML pages come numbered for editing.
 */
function registerDesignProtocol(): void {
  const editorScript = join(appRoot, 'dist', 'preload', 'designPreview.js');
  const headers = (type: string) => ({
    'content-type': type,
    'cache-control': 'no-store',
    // The frame has an opaque origin (sandboxed): module scripts and fonts need this.
    'access-control-allow-origin': '*',
  });
  protocol.handle('zxp', async (req) => {
    const url = new URL(req.url);
    const w = wins.get(Number(/^w(\d+)$/.exec(url.hostname)?.[1]));
    const design = w?.design;
    const folder = w?.workspace;
    if (!w || !design || !folder || design.root !== folder.root)
      return new Response('not available', { status: 404 });
    if (url.pathname === EDITOR_SCRIPT_PATH)
      return readFile(editorScript)
        .then((b) => new Response(b, { headers: headers('text/javascript; charset=utf-8') }))
        .catch(() => new Response('not built', { status: 404 }));
    // A framework project shown by its dev server or its built files (see design/live.ts).
    const other = await design.session.respond(req);
    if (other) return other;
    let file = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (file === '' || file.endsWith('/')) file += 'index.html';
    try {
      let abs = folder.resolve(file);
      if (!existsSync(abs) && !extname(file)) {
        // Pretty addresses: /precios → precios.html, /blog → blog/index.html.
        const alt = [`${file}.html`, `${file}/index.html`].find((f) =>
          existsSync(folder.resolve(f)),
        );
        if (alt) file = alt;
      } else if (existsSync(abs) && statSync(abs).isDirectory()) file = `${file}/index.html`;
      abs = folder.resolve(file);
      const ext = extname(file).toLowerCase();
      if (ext === '.html' || ext === '.htm')
        return new Response(await design.session.serve(file), {
          headers: headers('text/html; charset=utf-8'),
        });
      return new Response(await readFile(abs), {
        headers: headers(MIME[ext] ?? PREVIEW_MIME[ext] ?? 'application/octet-stream'),
      });
    } catch (e) {
      if (!/\.html?$/i.test(file)) return new Response('not found', { status: 404 });
      // A page that can't be shown: a clear message in the canvas, not a blank frame (the
      // editor script still answers, so the panel knows the frame loaded).
      const msg = previewPage(
        404,
        e instanceof EditError ? 'Esta página no se puede mostrar' : 'Esta página no existe',
        e instanceof EditError
          ? e.message
          : 'Puede que se haya movido o borrado. Elige otra página en la columna de la izquierda.',
      );
      return new Response(`${await msg.text()}<script src="${EDITOR_SCRIPT_PATH}"></script>`, {
        status: 404,
        headers: headers('text/html; charset=utf-8'),
      });
    }
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
  protocol.handle('zmedia', (req) => videoService().serve(req));
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
        {
          label: 'Zinarix Video Studio',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: cmd('video.toggle'),
        },
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
          click: async (_item, bw) => {
            const w = (winOf(bw) ?? focused())!;
            const { response } = await dialog.showMessageBox(w.win, {
              title: APP_NAME,
              message: `${APP_NAME} ${app.getVersion()} · ${planName()}`,
              detail: `Electron ${process.versions.electron} · Node ${process.versions.node}\nEditor multi-IA · GPL-3.0-or-later`,
              buttons: ['Aceptar', 'Licencias'],
              defaultId: 0,
              cancelId: 0,
            });
            if (response === 1) send(w, { type: 'command', command: 'help.licenses' });
          },
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

/**
 * Sites that refuse embedded browsers (Google sign-in: "disallowed_useragent") or where the
 * user expects their usual browser (payments): they open outside.
 */
const EXTERNAL_ONLY =
  /^(accounts\.google\.com|mail\.google\.com|console\.cloud\.google\.com|(www\.)?paypal\.com|checkout\.stripe\.com|buy\.stripe\.com|[\w-]+\.lemonsqueezy\.com)$/i;

/**
 * A link clicked in the app (chat, panels, window.open): an http(s) page opens in a tab of
 * the built-in browser of that window, which comes to the front.
 */
function openLink(w: Win, url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
  if (EXTERNAL_ONLY.test(u.hostname)) {
    if (u.protocol === 'https:') void shell.openExternal(u.toString());
    return;
  }
  w.browser.openTab(u.toString());
  send(w, { type: 'browser:focus' });
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
    // Fase 18: our own title bar (menu + folder); Mica / vibrancy when the setting allows it.
    ...chromeOptions(light, prefs().windowEffects !== false, prefs().uiZoom),
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
    openLink(w, url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  // Frames inside the window (the Panel de Edición preview) stay on the project's pages.
  win.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && !/^(zxp:|about:|data:)/.test(e.url)) e.preventDefault();
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
    testRuns.get(w.id)?.cancel();
    testRuns.delete(w.id);
    void notebookKernels.get(w.id)?.dispose();
    notebookKernels.delete(w.id);
    docker?.stopAllLogs(`${w.id}:`);
    godotService?.stopRunsOf(`${w.id}:`);
    w.browser.destroy();
    whatsapp.release(win);
    for (const r of w.requests) ai?.abort(r);
    for (const t of w.terminals) {
      terminals.kill(t);
      termOwner.delete(t);
    }
    w.workspace?.dispose();
    for (const f of w.chatFolders.values()) f.dispose();
    wins.delete(w.id);
    if (phoneOwner === w) {
      // Another window stays open: the phone keeps working, now through that one.
      const next = [...wins.values()].find((o) => !o.win.isDestroyed());
      if (next) {
        phoneOwner = next;
        send(next, { type: 'phone:status', status: phone.status() });
        // It was working on the closed window: now on this one (another target stays).
        if (!phoneTarget || phoneTarget === w) {
          phoneTarget = undefined;
          phoneSnap = null;
          setPhoneTarget(next);
        }
      } else {
        stopPhone();
        phoneOwner = undefined;
      }
    }
    // The phone was working on this window: it goes back to the one that started it.
    if (phoneOwner && phoneTarget === w) {
      phoneTarget = undefined;
      phoneSnap = null;
      setPhoneTarget(phoneOwner);
    } else phoneRefresh();
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
        title: `Revisión automática · ${report.name}`,
        body: `${report.items.length} sugerencia(s): ${report.items[0]!.title}`,
      });
      n.on('click', () => {
        const w = [...wins.values()].find((x) => x.workspace?.root === report.project) ?? focused();
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
  registerDesignProtocol();
  registerIpc();
  registerTasksIpc();
  registerPlaygroundIpc();
  registerMediaIpc();
  registerNotebookIpc();
  registerDockerIpc();
  registerPioIpc();
  registerGamesIpc();
  registerCadIpc();
  registerSketchupIpc();
  registerBgIpc();
  registerMobileIpc();
  registerVideoPhase4Ipc();
  registerScene3dIpc();
  registerVideoAgentIpc();
  registerGen3dIpc();
  registerReviewIpc();
  buildMenu();
  // Start empty unless a folder is passed explicitly: the user drops or picks one.
  const initial = folderFromArgv(process.argv) ?? process.env.OMNI_OPEN_FOLDER;
  // Opened at login for the bridge only: stay in the tray (a chat to resume needs a window).
  const hidden =
    process.argv.includes(BACKGROUND_ARG) && background.on() && !interruptedRuns.length && !initial;
  if (hidden) updateTray();
  else await createWindow({ folder: initial, restore: true });
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
  terminals.killAll();
  video?.dispose();
  // Permanent bridge (or tasks left on it): keep serving from the tray, the models stay up.
  if (background.on()) {
    updateTray();
    return;
  }
  quitFully();
});

/** Stops every service and quits (last window closed, or "Salir" in the tray). */
function quitFully(): void {
  background.stop();
  watcher?.stop();
  mcp?.shutdown();
  stopPhone();
  whatsapp.destroy();
  terminals.killAll();
  video?.dispose();
  ai?.close();
  tray?.destroy();
  tray = null;
  app.quit();
}

/** What the tray needs from the bridge (set in registerScene3dIpc). */
let background: {
  on(): boolean;
  url(): string | null;
  pending(): number;
  /** Puts the running task back in the queue (before the models close). */
  stop(): void;
} = {
  stop: () => undefined,
  on: () => false,
  url: () => null,
  pending: () => 0,
};
let tray: Tray | null = null;

/** Opens a window again from the tray (or shows the one that is open). */
function showFromTray(): void {
  const w = focused() ?? [...wins.values()][0];
  if (!w) return void createWindow({ restore: true });
  if (w.win.isMinimized()) w.win.restore();
  w.win.show();
  w.win.focus();
}

/** The tray icon, while Zinarix works in the background for the bridge. */
function updateTray(): void {
  if (!app.isReady()) return;
  if (!background.on()) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    const ico = join(appRoot, 'build', 'icon.ico');
    const file = process.platform === 'win32' && existsSync(ico) ? ico : iconPath();
    let img = file ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
    if (!img.isEmpty() && process.platform !== 'win32') img = img.resize({ width: 18, height: 18 });
    tray = new Tray(img);
    tray.on('click', showFromTray);
    // Installed copies have no build/ folder: the executable's own icon then.
    if (img.isEmpty())
      void app
        .getFileIcon(process.execPath, { size: 'small' })
        .then((i) => tray?.setImage(i))
        .catch(() => undefined);
  }
  const url = background.url();
  const pending = background.pending();
  const status = url ? `Puente activo · ${url}` : 'Puente cerrado';
  const tasks = pending ? `${pending} tarea(s) en cola` : 'Sin tareas en cola';
  tray.setToolTip(`${APP_NAME} — ${status} — ${tasks}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { label: tasks, enabled: false },
      { type: 'separator' },
      { label: `Abrir ${APP_NAME}`, click: showFromTray },
      {
        label: 'Salir del todo (cierra el puente)',
        click: () => {
          // Tasks still waiting stay saved: they continue the next time Zinarix opens.
          if (!wins.size) quitFully();
          else app.quit();
        },
      },
    ]),
  );
}

app.on('activate', () => {
  if (!wins.size) void createWindow({ restore: true });
});
