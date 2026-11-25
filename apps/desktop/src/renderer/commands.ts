import { askInChat, closeChatFromTab, focusedChatTab } from './components/Chat';
import { openNewTask } from './components/TasksPanel';
import { listTerminals, sendTerminalToChat, terminalFocused } from './components/Terminal';
import { confirmDialog } from './confirm';
import { goToNextProblem } from './components/Problems';
import { FOCUS_SEARCH_EVENT } from './components/Search';
import {
  getDebug,
  pause,
  restartDebug,
  startDebug,
  stepInto,
  stepOut,
  stepOver,
  stopDebug,
  toggleBreakpointAtCursor,
} from './debug';
import { td } from './i18nDebug';
import { tp } from './i18nPlayground';
import { rerunFailed, runAll as runAllTests, runAtCursor } from './testExplorer';
import { studioCommand, videoCommands } from './components/video/videoCommands';
import { lang, setLang, t } from './i18n';
import { toggle3d } from './components/three/store3d';
import { t3 } from './components/three/strings3d';
import { ta } from './components/automations/automationsStrings';
import { layoutCommands } from './layout/layoutCommands';
import { comboFromEvent } from './keys';
import {
  api,
  askText,
  closeTab,
  dirtyCount,
  newChat,
  newChatInFolder,
  newQuestionChat,
  requirePro,
  runningChats,
  forgetResume,
  toggleChatList,
  toggleChatSplit,
  closeSide,
  openToSide,
  getEditor,
  getState,
  openBrowserTab,
  openFile,
  openSecurityTab,
  openPlaygroundTab,
  refreshSettings,
  updatePrefs,
  save,
  saveAll,
  setState,
  toast,
  toggleTheme,
} from './store';

export interface Command {
  id: string;
  label: string;
  keys?: string;
  /** A second built-in shortcut (not a menu accelerator: listened for in this file). */
  altKeys?: string;
  run: () => unknown;
}

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

/** Built-in shortcuts (before the user's own ones from Settings). */
export function defaultKeys(): Record<string, string> {
  return Object.fromEntries(baseCommands().flatMap((c) => (c.keys ? [[c.id, c.keys]] : [])));
}

/** Commands with the user's custom shortcuts applied. */
export function commands(): Command[] {
  const custom = getState().prefs.keybindings;
  return baseCommands().map((c) => (custom[c.id] ? { ...c, keys: custom[c.id] } : c));
}

/** Opens (or creates from a template) the project rules file. */
async function editRules(): Promise<void> {
  if (!getState().workspace) return toast(t('noFolder'));
  const existing = await api().ai.rulesFile();
  const path = existing ?? '.zinarix/rules.md';
  if (!existing) {
    try {
      await api().workspace.createDir('.zinarix');
    } catch {
      // already there
    }
    try {
      await api().workspace.createFile(path);
      await api().workspace.writeFile(path, t('rulesTemplate'));
    } catch {
      // exists (rules disabled in settings): just open it
    }
  }
  await openFile(path);
  if (!getState().prefs.projectRules) toast(t('rulesDisabled'));
}

function baseCommands(): Command[] {
  const en = lang === 'en';
  return [
    {
      id: 'workspace.open',
      label: `${t('openFolder')}…`,
      keys: `${mod}+O`,
      run: () => api().workspace.openDialog(),
    },
    {
      id: 'workspace.close',
      label: t('closeFolder'),
      run: async () => {
        const n = dirtyCount();
        if (n && !(await confirmDialog(t('unsavedQuit', { n }), { danger: true }))) return;
        await api().workspace.close();
      },
    },
    {
      id: 'quickOpen',
      label: t('cmdQuickOpen'),
      keys: `${mod}+P`,
      run: () => setState({ modal: { kind: 'quickOpen' } }),
    },
    {
      id: 'goToSymbol',
      label: t('cmdGoToSymbol'),
      keys: `${mod}+Shift+O`,
      run: () => setState({ modal: { kind: 'symbols' } }),
    },
    {
      id: 'showOutline',
      label: t('cmdShowOutline'),
      run: () => {
        setState({ sidebar: 'explorer' });
        window.dispatchEvent(new CustomEvent('zinarix:outline-show'));
      },
    },
    {
      id: 'tasks.run',
      label: t('cmdRunTask'),
      run: () =>
        getState().workspace ? setState({ modal: { kind: 'tasks' } }) : toast(t('noFolder')),
    },
    {
      id: 'graphics.open',
      label: en
        ? 'Graphics studio: new design, logo or drawing'
        : 'Estudio gráfico: nuevo diseño, logo o dibujo',
      run: () => setState({ sidebar: 'graphics' }),
    },
    {
      id: 'extensions.open',
      label: en
        ? 'Extensions: themes, snippets and languages'
        : 'Extensiones: temas, fragmentos y lenguajes',
      run: () => setState({ sidebar: 'extensions' }),
    },
    {
      id: 'docker.open',
      label: en ? 'Docker: open panel' : 'Docker: abrir panel',
      run: () => setState({ sidebar: 'docker' }),
    },
    {
      id: 'hardware.open',
      label: 'Hardware: Arduino / PlatformIO',
      run: () => setState({ sidebar: 'hardware' }),
    },
    {
      id: 'games.open',
      label: en ? 'Games: Godot, web, Unity, Unreal' : 'Juegos: Godot, web, Unity, Unreal',
      run: () => setState({ sidebar: 'games' }),
    },
    {
      id: 'cad.open',
      label: en ? '3D CAD: OpenSCAD, 3D printing' : 'CAD 3D: OpenSCAD, impresión 3D',
      run: () => setState({ sidebar: 'cad' }),
    },
    {
      id: 'sketchup.open',
      label: en ? 'SketchUp: .skp models' : 'SketchUp: modelos .skp',
      run: () => setState({ sidebar: 'sketchup' }),
    },
    {
      id: 'mobile.open',
      label: en ? 'Phone: Android, Flutter, Expo' : 'Celular: Android, Flutter, Expo',
      run: () => setState({ sidebar: 'mobile' }),
    },
    {
      id: 'tests.open',
      label: t('cmdTestsOpen'),
      run: () => setState({ sidebar: 'testing' }),
    },
    { id: 'tests.runAll', label: t('cmdTestsRunAll'), run: () => runAllTests() },
    { id: 'tests.rerunFailed', label: t('cmdTestsRerunFailed'), run: () => rerunFailed() },
    { id: 'tests.runAtCursor', label: t('cmdTestsRunCursor'), run: () => runAtCursor() },
    { id: 'tests.debugAtCursor', label: t('cmdTestsDebugCursor'), run: () => runAtCursor(true) },
    {
      id: 'palette',
      label: t('cmdPalette'),
      keys: `${mod}+Shift+P`,
      run: () => setState({ modal: { kind: 'palette' } }),
    },
    {
      id: 'file.new',
      label: t('newFile'),
      keys: `${mod}+N`,
      run: async () => {
        if (!getState().workspace) return toast(t('noFolder'));
        const name = (await askText(`${t('newFile')} — ${t('namePrompt')}`))?.trim();
        if (!name) return;
        await api().workspace.createFile(name);
        await openFile(name);
      },
    },
    {
      id: 'file.save',
      label: t('cmdSave'),
      keys: `${mod}+S`,
      run: async () => (await save(), toast(t('saved'))),
    },
    { id: 'file.saveAll', label: t('cmdSaveAll'), keys: `${mod}+Alt+S`, run: () => saveAll() },
    {
      id: 'tab.close',
      label: t('cmdCloseTab'),
      keys: `${mod}+W`,
      run: () => {
        // On a chat tab (keyboard focus), Ctrl+W closes that chat, not the editor tab.
        const chat = focusedChatTab();
        if (chat) return void closeChatFromTab(chat);
        void closeTab();
      },
    },
    {
      id: 'editor.splitRight',
      label: t('editorSplitRight'),
      keys: `${mod}+Alt+B`,
      run: () => void openToSide(),
    },
    {
      id: 'editor.closeSide',
      label: t('editorCloseSide'),
      run: () => closeSide(),
    },
    {
      id: 'view.explorer',
      label: t('explorer'),
      keys: `${mod}+Shift+E`,
      run: () =>
        setState((s) => ({
          sidebar: s.sidebar === 'explorer' || s.sidebar === 'search' ? null : 'explorer',
        })),
    },
    {
      id: 'view.git',
      label: t('gitTitle'),
      keys: `${mod}+Shift+G`,
      run: () => setState((s) => ({ sidebar: s.sidebar === 'git' ? null : 'git' })),
    },
    {
      id: 'git.clone',
      label: `${t('gitClone')}…`,
      run: () => setState({ modal: { kind: 'clone' } }),
    },
    {
      id: 'git.publish',
      label: `${t('ghPublish')}…`,
      run: () =>
        getState().workspace ? setState({ modal: { kind: 'publish' } }) : toast(t('noFolder')),
    },
    {
      id: 'app.exportDiagnostics',
      label: `${t('exportDiagnostics')}…`,
      run: async () => {
        const path = await api().app.exportDiagnostics();
        if (path) toast(t('diagnosticsSaved', { path }));
      },
    },
    {
      id: 'app.settings',
      label: `${t('settings')}…`,
      keys: `${mod}+,`,
      run: () => setState({ modal: { kind: 'settings' } }),
    },
    {
      id: 'app.account',
      label:
        lang === 'en'
          ? 'Zinarix account: sign in or register…'
          : 'Cuenta de Zinarix: iniciar sesión o registrarse…',
      run: () => setState({ modal: { kind: 'settings', section: 'account' } }),
    },
    {
      id: 'ai.toggleInline',
      label: t('setInline'),
      run: async () => {
        const on = !getState().prefs.inlineCompletions;
        await updatePrefs({ inlineCompletions: on });
        toast(on ? t('inlineOn') : t('inlineOff'));
      },
    },
    {
      id: 'ai.rules',
      label: t('rulesEdit'),
      run: () => editRules(),
    },
    {
      id: 'view.search',
      label: t('searchFiles'),
      keys: `${mod}+Shift+F`,
      // The Explorer with its search box open (and focused, if it already was).
      run: () => {
        setState({ sidebar: 'search' });
        requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)));
      },
    },
    {
      id: 'view.run',
      label: t('runTitle'),
      run: () => setState((s) => ({ sidebar: s.sidebar === 'run' ? null : 'run' })),
    },
    {
      id: 'view.debug',
      label: td('dbgTitle'),
      keys: `${mod}+Shift+D`,
      run: () => setState((s) => ({ sidebar: s.sidebar === 'debug' ? null : 'debug' })),
    },
    {
      id: 'debug.start',
      label: `${td('dbgStart')} / ${td('dbgContinue')}`,
      keys: 'F5',
      run: () => {
        setState({ sidebar: 'debug' });
        return startDebug();
      },
    },
    { id: 'debug.stop', label: td('dbgStop'), keys: 'Shift+F5', run: () => stopDebug() },
    {
      id: 'debug.restart',
      label: td('dbgRestart'),
      keys: 'Ctrl+Shift+F5',
      run: () => restartDebug(),
    },
    { id: 'debug.pause', label: td('dbgPause'), keys: 'F6', run: () => pause() },
    { id: 'debug.stepOver', label: td('dbgStepOver'), keys: 'F10', run: () => stepOver() },
    { id: 'debug.stepInto', label: td('dbgStepInto'), keys: 'F11', run: () => stepInto() },
    { id: 'debug.stepOut', label: td('dbgStepOut'), keys: 'Shift+F11', run: () => stepOut() },
    {
      id: 'debug.toggleBreakpoint',
      label: td('dbgToggleBp'),
      keys: 'F9',
      run: () => toggleBreakpointAtCursor(),
    },
    {
      id: 'view.problems',
      label: td('probTitle'),
      keys: `${mod}+Shift+M`,
      run: () =>
        setState((s) =>
          s.panelOpen && s.panelView === 'problems'
            ? { panelOpen: false }
            : { panelOpen: true, panelView: 'problems' },
        ),
    },
    { id: 'problems.next', label: td('problemsNext'), keys: 'F8', run: () => goToNextProblem() },
    {
      id: 'view.vercel',
      label: t('vcTitle'),
      run: () => setState((s) => ({ sidebar: s.sidebar === 'vercel' ? null : 'vercel' })),
    },
    {
      id: 'view.supabase',
      label: t('sbTitle'),
      run: () => setState((s) => ({ sidebar: s.sidebar === 'supabase' ? null : 'supabase' })),
    },
    {
      id: 'view.gcloud',
      label: t('gcTitle'),
      run: () => setState((s) => ({ sidebar: s.sidebar === 'gcloud' ? null : 'gcloud' })),
    },
    {
      id: 'view.watch',
      label: t('wtTitle'),
      run: () => setState((s) => ({ sidebar: s.sidebar === 'watch' ? null : 'watch' })),
    },
    {
      id: 'view.automations',
      label: ta('barTip'),
      run: () => setState((s) => ({ sidebar: s.sidebar === 'automations' ? null : 'automations' })),
    },
    {
      id: 'app.studio3d',
      label: t3('title'),
      run: toggle3d,
    },
    {
      id: 'view.design',
      label: t('dzOpen'),
      run: () => setState({ sidebar: 'design', maximized: null }),
    },
    {
      id: 'design.visitor',
      label: t('dzCmdVisitor'),
      run: () => {
        setState({ sidebar: 'design', maximized: null });
        window.dispatchEvent(new CustomEvent('zx-design', { detail: 'visitor' }));
      },
    },
    {
      id: 'view.mail',
      label: t('mlTitle'),
      run: () => setState((s) => ({ sidebar: s.sidebar === 'mail' ? null : 'mail' })),
    },
    {
      id: 'view.terminal',
      label: t('cmdToggle', { what: t('terminal').toLowerCase() }),
      keys: 'Ctrl+`',
      // ` is a dead key on Spanish (and other) keyboards.
      altKeys: 'Ctrl+J',
      run: () => setState((s) => ({ panelOpen: !s.panelOpen })),
    },
    {
      id: 'terminal.toChat',
      label: `${t('terminal')}: ${t('termToChat').toLowerCase()}`,
      keys: `${mod}+Shift+L`,
      run: () => sendTerminalToChat(),
    },
    {
      id: 'chat.new',
      label: t('chatNewTab'),
      keys: `${mod}+Alt+N`,
      run: () => newChat(),
    },
    {
      id: 'chat.split',
      label: `${t('chatSplit')} / ${t('chatUnsplit').toLowerCase()}`,
      keys: `${mod}+Alt+D`,
      run: () => toggleChatSplit(),
    },
    {
      id: 'chat.newQuestion',
      label: t('chatNewQuestion'),
      run: () => newQuestionChat(),
    },
    {
      id: 'chat.newInFolder',
      label: t('chatNewInFolder'),
      run: () => void newChatInFolder(),
    },
    {
      id: 'tasks.new',
      label: t('taskNewCmd'),
      run: () => openNewTask(),
    },
    {
      id: 'chat.list',
      label: t('chatListToggle'),
      run: () => toggleChatList(),
    },
    {
      id: 'app.newWindow',
      label: t('newWindow'),
      keys: `${mod}+Shift+N`,
      run: async () => {
        if (!requirePro('windows')) return;
        if (!(await api().app.newWindow()))
          setState({ modal: { kind: 'upgrade', feature: 'windows' } });
      },
    },
    {
      id: 'license.open',
      label: `${t('planTitle')}…`,
      run: () => setState({ modal: { kind: 'license' } }),
    },
    {
      id: 'app.whatsNew',
      label: t('newsMenu'),
      run: () => setState({ modal: { kind: 'whatsNew' } }),
    },
    {
      id: 'view.chat',
      label: t('cmdToggle', { what: t('chat').toLowerCase() }),
      keys: `${mod}+Alt+I`,
      run: () => setState((s) => ({ chatOpen: !s.chatOpen })),
    },
    {
      id: 'security.scanner',
      label: t('scannerTitle'),
      run: () => setState({ modal: { kind: 'scanner' } }),
    },
    {
      id: 'security.center',
      label: t('securityTitle'),
      run: () => openSecurityTab(),
    },
    {
      id: 'view.playground',
      label: tp('pgOpen'),
      run: () => openPlaygroundTab(),
    },
    {
      id: 'view.playgroundCompare',
      label: `Playground: ${tp('pgModeCompare')}`,
      run: () => openPlaygroundTab('compare'),
    },
    {
      id: 'view.build',
      label: tp('pgOpenBuild'),
      run: () => openPlaygroundTab('build'),
    },
    {
      id: 'view.browser',
      label: t('openBrowser'),
      run: () => openBrowserTab(),
    },
    {
      id: 'view.toggleTheme',
      label: `${t('lightTheme')} / ${t('darkTheme')}`,
      run: () => toggleTheme(),
    },
    ...layoutCommands(),
    {
      id: 'ai.edit',
      label: t('aiEdit'),
      keys: `${mod}+K`,
      run: () => {
        // No selection: the edit is about the line the cursor is on.
        if (!getEditor()?.getModel()) return toast(t('selectFirst'));
        setState({ modal: { kind: 'aiEdit' } });
      },
    },
    {
      id: 'ai.askSelection',
      label: t('cmdAskSelection'),
      keys: `${mod}+L`,
      run: () => {
        // In the terminal Ctrl+L is the shell's "clear screen": hand it over instead of taking
        // it (Ctrl+Shift+L still sends the terminal to the chat).
        if (terminalFocused()) return void clearFocusedTerminal();
        const ed = getEditor();
        const sel = ed?.getSelection();
        const model = ed?.getModel();
        if (ed && sel && model && !sel.isEmpty()) {
          const path = getState().active ?? '';
          return askInChatWithSelection(
            path,
            model.getValueInRange(sel),
            sel.startLineNumber,
            sel.endLineNumber,
          );
        }
        askInChat('');
      },
    },
    {
      id: 'ai.explain',
      label: t('cmdExplain'),
      run: () => askInChat(t('promptExplain')),
    },
    {
      id: 'ai.review',
      label: t('cmdReview'),
      run: () => askInChat(t('promptReview')),
    },
    {
      id: 'ai.security',
      label: t('cmdSecurity'),
      run: () => askInChat(t('promptSecurity')),
    },
    {
      id: 'ai.tests',
      label: t('cmdTests'),
      run: () => askInChat(t('promptTests')),
    },
    {
      id: 'ai.docs',
      label: t('cmdDocs'),
      run: () => askInChat(t('promptDocs')),
    },
    {
      id: 'ai.pickModel',
      label: t('pickModel'),
      keys: `${mod}+Alt+M`,
      run: () => setState({ modal: { kind: 'models' } }),
    },
    {
      id: 'ai.providers',
      label: `${t('providers')} / API keys`,
      run: () => setState({ modal: { kind: 'providers' } }),
    },
    {
      id: 'ai.toggleLocal',
      label: t('cmdToggleLocal'),
      run: async () => {
        const on = !getState().settings.localOnly;
        await api().ai.setLocalOnly(on);
        await refreshSettings();
        toast(on ? t('localOnlyOn') : t('localOnlyOff'));
      },
    },
    {
      id: 'ai.usage',
      label: t('usageTitle'),
      run: () => setState({ modal: { kind: 'usage' } }),
    },
    {
      id: 'app.language',
      label: t('language'),
      run: async () => {
        const n = dirtyCount();
        if (n && !(await confirmDialog(t('languageUnsaved', { n }), { danger: true }))) return;
        setLang(lang === 'en' ? 'es' : 'en');
        location.reload();
      },
    },
    {
      id: 'help.shortcuts',
      label: t('shortcuts'),
      run: () => setState({ modal: { kind: 'shortcuts' } }),
    },
    {
      id: 'help.licenses',
      label: t('licensesTitle'),
      run: () => setState({ modal: { kind: 'licenses' } }),
    },
    {
      id: 'app.requestClose',
      label: t('closeWindow'),
      keys: `${mod}+Shift+W`,
      run: async () => {
        const n = dirtyCount();
        if (n && !(await confirmDialog(t('unsavedQuit', { n }), { danger: true }))) return;
        // Closing the window stops its chats: say so when some are still working.
        const busy = runningChats();
        if (busy && !(await confirmDialog(t('chatsBusyQuit', { n: busy }), { danger: true })))
          return;
        forgetResume();
        void api().app.quit();
      },
    },
    ...videoCommands(mod),
  ];
}

/**
 * Gives Ctrl+L back to the focused terminal: the app menu may have taken the key before xterm
 * saw it, so the form feed the shell expects is written to that session (clearing twice is
 * harmless when xterm got it too).
 */
function clearFocusedTerminal(): void {
  const host = document.activeElement?.closest('.xterm-host');
  if (!host) return;
  const hosts = [...document.querySelectorAll('.terminal-host .xterm-host')];
  const id = listTerminals()[hosts.indexOf(host)]?.id;
  if (id !== undefined) void api().terminal.write(id, '\x0c');
}

/**
 * Second shortcuts (`altKeys`, e.g. Ctrl+J for the terminal). The menu only has one accelerator
 * per item, so these are listened for here. A shortcut the user gave to another command wins.
 */
function onAltKey(e: KeyboardEvent): void {
  const combo = comboFromEvent(e);
  if (!combo) return;
  // The Settings recorder is capturing a new shortcut.
  if ((e.target as Element | null)?.closest?.('.key-recorder')) return;
  const custom = getState().prefs.keybindings;
  if (Object.values(custom).includes(combo)) return;
  const c = baseCommands().find((x) => x.altKeys === combo);
  if (!c) return;
  e.preventDefault();
  e.stopPropagation();
  void runCommand(c.id);
}
/**
 * Debugger keys (F5, F9, F10, F11…), handled here instead of the app menu: F11 steps into
 * only while the program is paused (otherwise it stays full screen, as in VS Code), and the
 * step keys do nothing outside a session. A shortcut the user gave to another command wins.
 */
const DEBUG_KEYS: Record<string, string> = {
  F5: 'debug.start',
  'Shift+F5': 'debug.stop',
  'Ctrl+Shift+F5': 'debug.restart',
  F6: 'debug.pause',
  F9: 'debug.toggleBreakpoint',
  F10: 'debug.stepOver',
  F11: 'debug.stepInto',
  'Shift+F11': 'debug.stepOut',
  F8: 'problems.next',
  [`${mod}+Shift+D`]: 'view.debug',
  [`${mod}+Shift+M`]: 'view.problems',
};
function onDebugKey(e: KeyboardEvent): void {
  const combo = comboFromEvent(e);
  if (!combo) return;
  if ((e.target as Element | null)?.closest?.('.key-recorder')) return;
  const custom = getState().prefs.keybindings;
  const own = Object.keys(custom).find((k) => custom[k] === combo);
  const id = own ?? (Object.values(custom).includes(combo) ? undefined : DEBUG_KEYS[combo]);
  if (!id || own) return; // custom shortcuts are run by App.tsx
  const state = getDebug().state;
  if (id.startsWith('debug.step') && state !== 'stopped') return;
  if ((id === 'debug.stop' || id === 'debug.restart' || id === 'debug.pause') && state === 'idle')
    return;
  e.preventDefault();
  e.stopPropagation();
  void runCommand(id);
}
const DEBUG_KEYS_FLAG = '__zxDebugKeys';
if (!w0()[DEBUG_KEYS_FLAG]) {
  w0()[DEBUG_KEYS_FLAG] = true;
  window.addEventListener('keydown', onDebugKey, true);
}
function w0(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

const ALT_KEYS_FLAG = '__zxAltKeys';
const w = window as unknown as Record<string, unknown>;
if (!w[ALT_KEYS_FLAG]) {
  w[ALT_KEYS_FLAG] = true;
  window.addEventListener('keydown', onAltKey, true);
}

function askInChatWithSelection(path: string, text: string, from: number, to: number): void {
  askInChat(t('promptExplainSelection'), [
    { source: `selection:${path}:${from}-${to}`, content: text },
  ]);
}

export async function runCommand(id: string): Promise<void> {
  // From main: a Pro feature was asked for (menu, second launch) on a plan without it.
  const up = /^license\.upgrade:(chats|split|windows)$/.exec(id);
  if (up) return setState({ modal: { kind: 'upgrade', feature: up[1] as 'chats' } });
  // While Video Studio is on screen it answers some app shortcuts itself (Ctrl+S…).
  if (studioCommand(id)) return;
  const c = commands().find((x) => x.id === id);
  try {
    await c?.run();
  } catch (e) {
    toast(String((e as Error).message ?? e));
  }
}
