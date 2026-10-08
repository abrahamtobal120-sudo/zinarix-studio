import { askInChat } from './components/Chat';
import { t } from './i18n';
import {
  api,
  askText,
  closeTab,
  dirtyCount,
  getEditor,
  getState,
  openBrowserTab,
  openFile,
  refreshSettings,
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

export function commands(): Command[] {
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
      label: 'Apertura rápida de archivo…',
      keys: `${mod}+P`,
      run: () => setState({ modal: { kind: 'quickOpen' } }),
    },
    {
      id: 'palette',
      label: 'Paleta de comandos',
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
      label: 'Guardar',
      keys: `${mod}+S`,
      run: async () => (await save(), toast(t('saved'))),
    },
    { id: 'file.saveAll', label: 'Guardar todo', keys: `${mod}+Alt+S`, run: () => saveAll() },
    { id: 'tab.close', label: 'Cerrar pestaña', keys: `${mod}+W`, run: () => closeTab() },
    {
      id: 'view.explorer',
      label: t('explorer'),
      keys: `${mod}+Shift+E`,
      run: () => setState((s) => ({ sidebar: s.sidebar === 'explorer' ? null : 'explorer' })),
    },
    {
      id: 'view.search',
      label: t('searchFiles'),
      keys: `${mod}+Shift+F`,
      run: () => setState({ sidebar: 'search' }),
    },
    {
      id: 'view.terminal',
      label: `Alternar ${t('terminal').toLowerCase()}`,
      keys: 'Ctrl+`',
      run: () => setState((s) => ({ panelOpen: !s.panelOpen })),
    },
    {
      id: 'view.chat',
      label: `Alternar ${t('chat').toLowerCase()}`,
      keys: `${mod}+Alt+I`,
      run: () => setState((s) => ({ chatOpen: !s.chatOpen })),
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
      label: `${t('aiEdit')} (selección)`,
      keys: `${mod}+K`,
      run: () => {
        const sel = getEditor()?.getSelection();
        if (!sel || sel.isEmpty()) return toast(t('selectFirst'));
        setState({ modal: { kind: 'aiEdit' } });
      },
    },
    {
      id: 'ai.askSelection',
      label: 'Preguntar a la IA sobre la selección',
      keys: `${mod}+L`,
      run: () => {
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
      label: 'IA: explicar el archivo actual',
      run: () => askInChat('Explica qué hace este código, paso a paso.'),
    },
    {
      id: 'ai.review',
      label: 'IA: revisar el código (bugs y calidad)',
      run: () =>
        askInChat(
          'Revisa este código: encuentra bugs, problemas de rendimiento y de legibilidad. Propón parches concretos.',
        ),
    },
    {
      id: 'ai.security',
      label: 'IA: auditoría de seguridad del archivo',
      run: () =>
        askInChat(
          'Haz una revisión de seguridad defensiva de este archivo. Reporta hallazgos con severidad, CWE, línea, explicación y parche sugerido.',
        ),
    },
    {
      id: 'ai.tests',
      label: 'IA: generar pruebas unitarias',
      run: () =>
        askInChat(
          'Genera pruebas unitarias completas para este código con el framework de pruebas más adecuado.',
        ),
    },
    {
      id: 'ai.docs',
      label: 'IA: documentar el código',
      run: () =>
        askInChat('Agrega documentación (docstrings / JSDoc) a este código y devuélvelo completo.'),
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
      label: 'Alternar modo 100 % local',
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
      id: 'help.shortcuts',
      label: t('shortcuts'),
      run: () => setState({ modal: { kind: 'shortcuts' } }),
    },
    {
      id: 'app.requestClose',
      label: 'Salir',
      run: () => {
        const n = dirtyCount();
        if (n && !confirm(t('unsavedQuit', { n }))) return;
        void api().app.quit();
      },
    },
  ];
}

function askInChatWithSelection(path: string, text: string, from: number, to: number): void {
  askInChat('Explica este fragmento y sugiere mejoras.', [
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
