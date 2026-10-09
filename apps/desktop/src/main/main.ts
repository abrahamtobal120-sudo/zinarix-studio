import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, dialog, ipcMain, protocol, shell } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { z } from 'zod';
import type { AppEvent, Channel, WorkspaceInfo } from '../shared/api.js';
import { EVENT_CHANNEL } from '../shared/api.js';
import { AiService } from './ai.js';
import { BrowserController } from './browser.js';
import { runScan } from './security.js';
import { Terminals } from './terminal.js';
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
// A second launch hands its folder to the running window (see 'second-instance') and exits.
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) app.exit(0);

let win: BrowserWindow | undefined;
let ai: AiService;
let workspace: Workspace | undefined;
let allowClose = false;
// The AI-controlled browser (a sandboxed WebContentsView drawn over the "Navegador" tab).
const browser = new BrowserController(
  () => win,
  (state) => send({ type: 'browser:state', state }),
  () => send({ type: 'browser:show' }),
);
const terminals = new Terminals(
  (id, data) => send({ type: 'term:data', id, data }),
  (id, code) => send({ type: 'term:exit', id, code }),
);

// ---------------- desktop state (last folder, theme) ----------------

interface DesktopState {
  lastFolder?: string;
  recentFolders?: string[];
  theme?: 'dark' | 'light';
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

function send(ev: AppEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, ev);
}

async function openFolder(path: string): Promise<WorkspaceInfo | null> {
  const abs = resolve(path);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return null;
  workspace?.dispose();
  workspace = new Workspace(abs);
  workspace.watch(() => send({ type: 'fs:changed' }));
  saveState({
    lastFolder: abs,
    recentFolders: [abs, ...(loadState().recentFolders ?? []).filter((f) => f !== abs)].slice(
      0,
      10,
    ),
  });
  app.addRecentDocument(abs);
  const info = await workspace.info();
  win?.setTitle(`${info.name} — Zinarix Studio`);
  send({ type: 'workspace', workspace: info });
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

function ws(): Workspace {
  if (!workspace) throw new Error('No hay carpeta abierta');
  return workspace;
}

// ---------------- IPC (whitelisted, validated, sender-checked) ----------------

const str = z.string().max(4096);
const rel = z.string().max(4096);
const big = z.string().max(50 * 1024 * 1024);
const id = z.number().int().positive();
const dim = z.number().int().min(1).max(1000);
const message = z.union([
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({ role: z.literal('assistant'), content: z.string() }),
]);
const ctx = z.array(z.object({ source: str, content: big })).max(20);

type Handler = (...args: unknown[]) => unknown;
function handle<A extends z.ZodTuple>(
  channel: Channel,
  schema: A,
  fn: (...args: z.infer<A>) => unknown,
): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!event.senderFrame?.url.startsWith('app://')) throw new Error('untrusted sender');
    return (fn as Handler)(...schema.parse(args));
  });
}

function registerIpc(): void {
  handle('workspace:current', z.tuple([]), () => workspace?.info() ?? null);
  handle('workspace:openDialog', z.tuple([]), async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled || !r.filePaths[0] ? null : openFolder(r.filePaths[0]);
  });
  handle('workspace:openPath', z.tuple([z.string().min(1).max(4096)]), async (p) => {
    const abs = resolve(p);
    if (!existsSync(abs)) return null;
    const isDir = statSync(abs).isDirectory();
    const info = await openFolder(isDir ? abs : dirname(abs));
    return info ? { workspace: info, file: isDir ? null : basename(abs) } : null;
  });
  handle('workspace:close', z.tuple([]), () => {
    workspace?.dispose();
    workspace = undefined;
    win?.setTitle('Zinarix Studio');
    send({ type: 'workspace', workspace: null });
  });
  handle('workspace:recent', z.tuple([]), () =>
    (loadState().recentFolders ?? [])
      .filter((f) => existsSync(f))
      .map((f) => ({ path: f, name: basename(f) })),
  );
  handle('workspace:readDir', z.tuple([rel]), (p) => ws().readDir(p));
  handle('workspace:readFile', z.tuple([rel]), (p) => ws().readFile(p));
  handle('workspace:writeFile', z.tuple([rel, big]), (p, c) => ws().writeFile(p, c));
  handle('workspace:createFile', z.tuple([rel]), (p) => ws().createFile(p));
  handle('workspace:createDir', z.tuple([rel]), (p) => ws().createDir(p));
  handle('workspace:rename', z.tuple([rel, rel]), (a, b) => ws().rename(a, b));
  handle('workspace:trash', z.tuple([rel]), (p) => shell.trashItem(ws().resolve(p)));
  handle('workspace:listFiles', z.tuple([]), () => ws().listFiles());
  handle('workspace:search', z.tuple([str, z.boolean(), z.boolean()]), (q, r, c) =>
    ws().search(q, r, c),
  );

  handle('ai:providers', z.tuple([]), () => ai.providers());
  handle(
    'ai:saveProvider',
    z.tuple([str, z.string().max(8192).nullable(), z.record(z.string(), z.string().max(512))]),
    (p, k, params) => ai.saveProvider(p, k, params),
  );
  handle('ai:removeProvider', z.tuple([str]), (p) => ai.removeProvider(p));
  handle('ai:models', z.tuple([z.boolean()]), (r) => ai.models(r));
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
  }));
  handle('ai:setDefaultModel', z.tuple([str]), (r) => ai.setDefaultModel(r));
  handle(
    'ai:setRole',
    z.tuple([z.enum(['chat', 'agent', 'inline']), str.nullable()]),
    (role, ref) => ai.setRole(role, ref),
  );
  handle('ai:setLocalOnly', z.tuple([z.boolean()]), (on) => ai.setLocalOnly(on));
  handle('ai:setTheme', z.tuple([z.enum(['dark', 'light'])]), (theme) => saveState({ theme }));
  handle(
    'ai:chat',
    z.tuple([
      str,
      z.object({
        model: str.optional(),
        history: z.array(message).max(500),
        prompt: big,
        context: ctx,
        conversationId: str.optional(),
        agent: z.boolean().optional(),
      }),
    ]),
    (requestId, req) => {
      void ai.chat(requestId, req, (rid, event) => send({ type: 'chat', requestId: rid, event }));
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
    (requestId, req) => {
      void ai.edit(requestId, req, (rid, event) => send({ type: 'chat', requestId: rid, event }));
    },
  );
  handle('ai:abort', z.tuple([str]), (r) => ai.abort(r));
  handle('ai:usage', z.tuple([]), () => ai.usage());
  handle('ai:conversations', z.tuple([z.string().max(500), z.boolean()]), (q, p) =>
    ai.conversations(q, p),
  );
  handle('ai:conversation', z.tuple([str]), (id) => ai.conversation(id));
  handle('ai:renameConversation', z.tuple([str, z.string().max(200)]), (id, t) =>
    ai.renameConversation(id, t),
  );
  handle('ai:deleteConversation', z.tuple([str]), (id) => ai.deleteConversation(id));
  handle('ai:exportConversation', z.tuple([str]), async (id) => {
    const md = ai.exportMarkdown(id);
    if (!md) return null;
    const title =
      md
        .split('\n')[0]!
        .replace(/^#\s*/, '')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .slice(0, 60) || 'conversacion';
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: join(workspace?.root ?? app.getPath('documents'), `${title}.md`),
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
    (p, b) => ai.setBudget(p, b),
  );
  handle(
    'ai:toolDecision',
    z.tuple([str, str, z.enum(['approve', 'deny', 'always'])]),
    (r, id, d) => ai.toolDecision(r, id, d),
  );
  handle('ai:revert', z.tuple([str]), (c) => ai.revert(c));

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
    async (requestId, opts) => {
      const ac = new AbortController();
      scans.set(requestId, ac);
      try {
        return await runScan(opts, ac.signal, (done, total) =>
          send({ type: 'scan:progress', requestId, done, total }),
        );
      } finally {
        scans.delete(requestId);
      }
    },
  );
  handle('security:scanAbort', z.tuple([str]), (requestId) => {
    scans.get(requestId)?.abort();
  });

  handle('browser:setBounds', z.tuple([rect]), (r) => {
    // The renderer measures in CSS px; the view is placed in window DIPs (differ when zoomed).
    const f = win?.webContents.getZoomFactor() ?? 1;
    browser.setBounds(
      r && {
        x: Math.round(r.x * f),
        y: Math.round(r.y * f),
        width: Math.round(r.width * f),
        height: Math.round(r.height * f),
      },
    );
  });
  handle('browser:navigate', z.tuple([str]), (u) => browser.navigate(u));
  handle('browser:back', z.tuple([]), () => browser.back());
  handle('browser:forward', z.tuple([]), () => browser.forward());
  handle('browser:reload', z.tuple([]), () => browser.reload());
  handle('browser:state', z.tuple([]), () => browser.state());
  handle('browser:home', z.tuple([]), () => browser.home());

  handle('terminal:create', z.tuple([dim, dim]), (cols, rows) =>
    terminals.create(workspace?.root ?? app.getPath('home'), cols, rows),
  );
  handle('terminal:write', z.tuple([id, z.string().max(1024 * 1024)]), (i, d) =>
    terminals.write(i, d),
  );
  handle('terminal:resize', z.tuple([id, dim, dim]), (i, c, r) => terminals.resize(i, c, r));
  handle('terminal:kill', z.tuple([id]), (i) => terminals.kill(i));

  handle('app:openExternal', z.tuple([z.string().url()]), (url) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });
  handle('app:quit', z.tuple([]), () => {
    allowClose = true;
    win?.close();
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

function cmd(command: string): () => void {
  return () => send({ type: 'command', command });
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo archivo', accelerator: 'CmdOrCtrl+N', click: cmd('file.new') },
        { label: 'Abrir carpeta…', accelerator: 'CmdOrCtrl+O', click: cmd('workspace.open') },
        { label: 'Cerrar carpeta', click: cmd('workspace.close') },
        { label: 'Apertura rápida…', accelerator: 'CmdOrCtrl+P', click: cmd('quickOpen') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: cmd('file.save') },
        { label: 'Guardar todo', accelerator: 'CmdOrCtrl+Alt+S', click: cmd('file.saveAll') },
        { label: 'Cerrar pestaña', accelerator: 'CmdOrCtrl+W', click: cmd('tab.close') },
        { type: 'separator' },
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
        { label: 'Terminal', accelerator: 'Ctrl+`', click: cmd('view.terminal') },
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
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Atajos de teclado', click: cmd('help.shortcuts') },
        {
          label: 'Acerca de Zinarix Studio',
          click: () =>
            void dialog.showMessageBox(win!, {
              title: 'Zinarix Studio',
              message: `Zinarix Studio ${app.getVersion()}`,
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

async function createWindow(): Promise<void> {
  const theme = loadState().theme ?? 'dark';
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Zinarix Studio',
    icon: iconPath(),
    show: false,
    backgroundColor: theme === 'dark' ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: join(appRoot, 'dist', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      webviewTag: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    send({ type: 'command', command: 'app.requestClose' });
  });
  win.on('closed', () => {
    browser.destroy();
    win = undefined;
  });
  await win.loadURL('app://zinarix/index.html').catch((e: unknown) => {
    if (!app.isReady() || !win) return;
    console.error('failed to load UI', e);
  });
}

app.on('second-instance', (_e, argv) => {
  const folder = folderFromArgv(argv);
  if (folder) void openFolder(folder);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.whenReady().then(async () => {
  if (!isPrimary) return;
  ai = new AiService(() => workspace, undefined, browser);
  registerProtocol();
  registerIpc();
  buildMenu();
  await createWindow();
  // Start empty unless a folder is passed explicitly: the user drops or picks one.
  const initial = folderFromArgv(process.argv) ?? process.env.OMNI_OPEN_FOLDER;
  if (initial) await openFolder(initial);
});

app.on('window-all-closed', () => {
  terminals.killAll();
  workspace?.dispose();
  ai?.close();
  app.quit();
});

app.on('activate', () => {
  if (!win) void createWindow();
});
