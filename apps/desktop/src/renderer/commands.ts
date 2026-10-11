import { askInChat } from './components/Chat';
import { sendTerminalToChat, terminalFocused } from './components/Terminal';
import { lang, setLang, t } from './i18n';
import {
  api,
  askText,
  closeTab,
  dirtyCount,
  getEditor,
  getState,
  openBrowserTab,
  openFile,
  openSecurityTab,
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
        if (n && !confirm(t('unsavedQuit', { n }))) return;
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
    { id: 'tab.close', label: t('cmdCloseTab'), keys: `${mod}+W`, run: () => closeTab() },
    {
      id: 'view.explorer',
      label: t('explorer'),
      keys: `${mod}+Shift+E`,
      run: () => setState((s) => ({ sidebar: s.sidebar === 'explorer' ? null : 'explorer' })),
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
      id: 'app.settings',
      label: `${t('settings')}…`,
      keys: `${mod}+,`,
      run: () => setState({ modal: { kind: 'settings' } }),
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
      run: () => setState({ sidebar: 'search' }),
    },
    {
      id: 'view.run',
      label: t('runTitle'),
      run: () => setState((s) => ({ sidebar: s.sidebar === 'run' ? null : 'run' })),
    },
    {
      id: 'view.terminal',
      label: t('cmdToggle', { what: t('terminal').toLowerCase() }),
      keys: 'Ctrl+`',
      run: () => setState((s) => ({ panelOpen: !s.panelOpen })),
    },
    {
      id: 'terminal.toChat',
      label: `${t('terminal')}: ${t('termToChat').toLowerCase()}`,
      keys: `${mod}+Shift+L`,
      run: () => sendTerminalToChat(),
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
      id: 'view.browser',
      label: t('openBrowser'),
      run: () => openBrowserTab(),
    },
    {
      id: 'view.toggleTheme',
      label: `${t('lightTheme')} / ${t('darkTheme')}`,
      run: () => toggleTheme(),
    },
    {
      id: 'ai.edit',
      label: `${t('aiEdit')} (${t('cmdSelection')})`,
      keys: `${mod}+K`,
      run: () => {
        const sel = getEditor()?.getSelection();
        if (!sel || sel.isEmpty()) return toast(t('selectFirst'));
        setState({ modal: { kind: 'aiEdit' } });
      },
    },
    {
      id: 'ai.askSelection',
      label: t('cmdAskSelection'),
      keys: `${mod}+L`,
      run: () => {
        // From the terminal, Ctrl+L sends its selection (or the session) to the chat.
        if (terminalFocused()) return void sendTerminalToChat();
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
        toast(on ? t('localOnlyOn') : '☁');
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
      run: () => {
        const n = dirtyCount();
        if (n && !confirm(t('languageUnsaved', { n }))) return;
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
      id: 'app.requestClose',
      label: t('cmdQuit'),
      run: () => {
        const n = dirtyCount();
        if (n && !confirm(t('unsavedQuit', { n }))) return;
        void api().app.quit();
      },
    },
  ];
}

function askInChatWithSelection(path: string, text: string, from: number, to: number): void {
  askInChat(t('promptExplainSelection'), [
    { source: `selection:${path}:${from}-${to}`, content: text },
  ]);
}

export async function runCommand(id: string): Promise<void> {
  const c = commands().find((x) => x.id === id);
  try {
    await c?.run();
  } catch (e) {
    toast(String((e as Error).message ?? e));
  }
}
