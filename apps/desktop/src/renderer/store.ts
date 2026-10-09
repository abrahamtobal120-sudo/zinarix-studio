import { useSyncExternalStore } from 'react';
import type { ModelInfo } from '@omni/shared';
import type { AiRole, OmniApi, Settings, WorkspaceInfo } from '../shared/api';
import { languageFor, monaco } from './monaco';
import { t } from './i18n';

declare global {
  interface Window {
    omni: OmniApi;
  }
}
export const api = (): OmniApi => window.omni;

export interface Tab {
  path: string;
  name: string;
  dirty: boolean;
  /** Non-text file: shown as a message instead of an editor. */
  notice?: string;
}

export type Modal =
  | { kind: 'palette' }
  | { kind: 'quickOpen' }
  | { kind: 'models'; role?: AiRole }
  | { kind: 'providers'; focus?: string }
  | { kind: 'aiEdit' }
  | { kind: 'shortcuts' }
  | { kind: 'usage' }
  | { kind: 'security' }
  | { kind: 'scanner' };

export interface State {
  workspace: WorkspaceInfo | null;
  tabs: Tab[];
  active: string | null;
  sidebar: 'explorer' | 'search' | null;
  panelOpen: boolean;
  chatOpen: boolean;
  modal: Modal | null;
  settings: Settings;
  models: ModelInfo[];
  modelErrors: { provider: string; error: string }[];
  cursor: { line: number; column: number };
  toast: string | null;
  fsVersion: number;
  inputBox: { label: string; value: string; resolve: (v: string | null) => void } | null;
}

let state: State = {
  workspace: null,
  tabs: [],
  active: null,
  sidebar: 'explorer',
  panelOpen: false,
  chatOpen: true,
  modal: null,
  settings: { defaultModel: null, roles: {}, localOnly: false, theme: 'dark', todayUsd: 0 },
  models: [],
  modelErrors: [],
  cursor: { line: 1, column: 1 },
  toast: null,
  fsVersion: 0,
  inputBox: null,
};

const listeners = new Set<() => void>();
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const l of listeners) l();
}
export function getState(): State {
  return state;
}
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string): void {
  setState({ toast: message });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3500);
}

/** Promise-based text input (Electron does not implement window.prompt). */
export function askText(label: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => setState({ inputBox: { label, value, resolve } }));
}

// ---------------- open documents (Monaco models) ----------------

interface Doc {
  model: monaco.editor.ITextModel;
  savedVersion: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
}
const docs = new Map<string, Doc>();
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

export function attachEditor(e: monaco.editor.IStandaloneCodeEditor | null): void {
  editor = e;
}
export function getEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return editor;
}
export function getDoc(path: string): Doc | undefined {
  return docs.get(path);
}

function updateDirty(path: string): void {
  const d = docs.get(path);
  if (!d) return;
  const dirty = d.model.getAlternativeVersionId() !== d.savedVersion;
  setState((s) => ({
    tabs: s.tabs.map((tab) => (tab.path === path && tab.dirty !== dirty ? { ...tab, dirty } : tab)),
  }));
}

export async function openFile(
  path: string,
  position?: { line: number; column: number },
): Promise<void> {
  const name = path.split('/').pop() ?? path;
  if (!docs.has(path) && !state.tabs.some((tab) => tab.path === path)) {
    const file = await api().workspace.readFile(path);
    if (file.binary || file.tooLarge) {
      setState((s) => ({
        tabs: [
          ...s.tabs,
          { path, name, dirty: false, notice: t(file.binary ? 'binary' : 'tooLarge') },
        ],
        active: path,
      }));
      return;
    }
    const uri = monaco.Uri.from({ scheme: 'file', path: `/${path}` });
    const model =
      monaco.editor.getModel(uri) ??
      monaco.editor.createModel(file.content, languageFor(path), uri);
    docs.set(path, { model, savedVersion: model.getAlternativeVersionId(), viewState: null });
    model.onDidChangeContent(() => updateDirty(path));
    setState((s) => ({ tabs: [...s.tabs, { path, name, dirty: false }] }));
  }
  activate(path);
  if (position && editor) {
    requestAnimationFrame(() => {
      editor?.setPosition({ lineNumber: position.line, column: position.column });
      editor?.revealLineInCenter(position.line);
      editor?.focus();
    });
  }
}

/** Pseudo-path of the built-in browser tab (never a real file: real paths have no "::"). */
export const BROWSER_TAB = '::browser';

export function openBrowserTab(): void {
  if (!state.tabs.some((x) => x.path === BROWSER_TAB))
    setState((s) => ({
      tabs: [...s.tabs, { path: BROWSER_TAB, name: t('browser'), dirty: false }],
    }));
  activate(BROWSER_TAB);
}

export function activate(path: string | null): void {
  const prev = state.active && docs.get(state.active);
  if (prev && editor) prev.viewState = editor.saveViewState();
  setState({ active: path });
}

export async function save(path = state.active): Promise<void> {
  if (!path) return;
  const d = docs.get(path);
  if (!d) return;
  await api().workspace.writeFile(path, d.model.getValue());
  d.savedVersion = d.model.getAlternativeVersionId();
  updateDirty(path);
}

export async function saveAll(): Promise<void> {
  for (const tab of state.tabs) if (tab.dirty) await save(tab.path);
}

export function closeTab(path = state.active): void {
  if (!path) return;
  const tab = state.tabs.find((x) => x.path === path);
  if (tab?.dirty && !confirm(t('unsavedClose', { name: tab.name }))) return;
  const d = docs.get(path);
  d?.model.dispose();
  docs.delete(path);
  const idx = state.tabs.findIndex((x) => x.path === path);
  const tabs = state.tabs.filter((x) => x.path !== path);
  const next =
    state.active === path ? (tabs[Math.min(idx, tabs.length - 1)]?.path ?? null) : state.active;
  setState({ tabs });
  activate(next);
}

/** Keeps open tabs pointing at the right files after a rename in the explorer. */
export function renamePath(from: string, to: string): void {
  const moved = state.tabs.filter((x) => x.path === from || x.path.startsWith(`${from}/`));
  for (const tab of moved) {
    const d = docs.get(tab.path);
    if (d) {
      d.model.dispose();
      docs.delete(tab.path);
    }
  }
  setState((s) => ({ tabs: s.tabs.filter((x) => !moved.includes(x)) }));
  if (moved.length) void openFile(moved[0]!.path.replace(from, to));
}

/** Re-reads a file changed outside the editor (e.g. by the agent) into its open tab. */
export async function reloadFromDisk(path: string): Promise<void> {
  const d = docs.get(path);
  if (!d) return;
  const tab = state.tabs.find((x) => x.path === path);
  if (tab?.dirty) {
    toast(`"${tab.name}" cambió en disco pero tiene cambios sin guardar; no se recargó.`);
    return;
  }
  try {
    const file = await api().workspace.readFile(path);
    if (file.binary || file.tooLarge || file.content === d.model.getValue()) return;
    d.model.pushEditOperations(
      [],
      [{ range: d.model.getFullModelRange(), text: file.content }],
      () => null,
    );
    d.savedVersion = d.model.getAlternativeVersionId();
    updateDirty(path);
  } catch {
    // file deleted: leave the tab as is
  }
}

/** Closes every tab without prompting (used when the workspace changes). */
export function resetDocs(): void {
  for (const d of docs.values()) d.model.dispose();
  docs.clear();
  setState((s) => {
    const tabs = s.tabs.filter((x) => x.path === BROWSER_TAB);
    return { tabs, active: tabs[0]?.path ?? null };
  });
}

/** Opens a folder or file dropped onto the window. */
export async function openDropped(path: string): Promise<void> {
  const r = await api().workspace.openPath(path);
  if (!r) return toast(t('dropInvalid'));
  // Switch workspace state here so the 'workspace' event cannot close the file we open next.
  if (state.workspace?.root !== r.workspace.root) resetDocs();
  setState({ workspace: r.workspace });
  if (r.file) await openFile(r.file);
}

export function dirtyCount(): number {
  return state.tabs.filter((x) => x.dirty).length;
}

// ---------------- AI settings / models ----------------

export async function refreshSettings(): Promise<void> {
  setState({ settings: await api().ai.settings() });
}

export async function refreshModels(refresh = false): Promise<void> {
  const r = await api().ai.models(refresh);
  setState({ models: r.models, modelErrors: r.errors });
  if (r.detected.length) toast(`🏠 Detectado y conectado: ${r.detected.join(', ')}`);
}

export async function chooseModel(ref: string): Promise<void> {
  await api().ai.setDefaultModel(ref);
  await refreshSettings();
}

export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
}

export async function toggleTheme(): Promise<void> {
  const theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  await api().ai.setTheme(theme);
  applyTheme(theme);
  setState((s) => ({ settings: { ...s.settings, theme } }));
}

let seq = 0;
export const newRequestId = (): string => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
