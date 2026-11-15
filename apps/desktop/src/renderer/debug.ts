/**
 * Debugger state of the window (renderer side of main/debug): breakpoints per file (kept as
 * model decorations so they follow edits, saved per folder), the session state, the stack of
 * the last stop and the debug console. Main does the protocol work (DAP / Chrome DevTools).
 */
import { useSyncExternalStore } from 'react';
import type {
  Breakpoint,
  DebugConfig,
  DebugFrame,
  DebugState,
  DebugVariable,
} from '../shared/devtools';
import type { TestRunRequest } from '../shared/testing';
import { td } from './i18nDebug';
import { fileUriOf, modelPath } from './lsp';
import { monaco } from './monaco';
import { api, getState, openFile, saveAll, setState, toast } from './store';

export interface ConsoleLine {
  id: number;
  category: 'stdout' | 'stderr' | 'console' | 'info' | 'input' | 'result' | 'error';
  text: string;
}

export interface DebugView {
  state: DebugState;
  name?: string;
  reason?: string;
  description?: string;
  frames: DebugFrame[];
  frameId: number | null;
  /** path → breakpoints (1-based lines). */
  breakpoints: Record<string, Breakpoint[]>;
  /** path → lines the adapter bound (shown solid; the others hollow). */
  verified: Record<string, number[]>;
  console: ConsoleLine[];
  watches: string[];
  /** Index of the chosen launch configuration (-1 = automatic for the current file). */
  configIndex: number;
}

let view: DebugView = {
  state: 'idle',
  frames: [],
  frameId: null,
  breakpoints: {},
  verified: {},
  console: [],
  watches: [],
  configIndex: -1,
};
const listeners = new Set<() => void>();
function set(patch: Partial<DebugView> | ((v: DebugView) => Partial<DebugView>)): void {
  view = { ...view, ...(typeof patch === 'function' ? patch(view) : patch) };
  for (const l of listeners) l();
}
export function getDebug(): DebugView {
  return view;
}
export function useDebug<T>(select: (v: DebugView) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(view),
  );
}

// ---------------- persistence (per folder) ----------------

function storeKey(): string | null {
  const root = getState().workspace?.root;
  return root ? `zs.debug:${root}` : null;
}
function persist(): void {
  const k = storeKey();
  if (!k) return;
  localStorage.setItem(k, JSON.stringify({ breakpoints: view.breakpoints, watches: view.watches }));
}
function restore(): void {
  const k = storeKey();
  let saved: { breakpoints?: Record<string, Breakpoint[]>; watches?: string[] } = {};
  try {
    saved = k ? JSON.parse(localStorage.getItem(k) ?? '{}') : {};
  } catch {
    saved = {};
  }
  set({ breakpoints: saved.breakpoints ?? {}, watches: saved.watches ?? [], verified: {} });
  for (const m of monaco.editor.getModels()) paintBreakpoints(m);
}

// ---------------- console ----------------

let lineId = 0;
const MAX_CONSOLE = 3000;
export function log(category: ConsoleLine['category'], text: string): void {
  set((v) => ({ console: [...v.console, { id: ++lineId, category, text }].slice(-MAX_CONSOLE) }));
}
export function clearConsole(): void {
  set({ console: [] });
}

// ---------------- breakpoints ----------------

/** Decoration ids of the breakpoints of each model (they move with the text). */
const bpDecorations = new Map<monaco.editor.ITextModel, { ids: string[]; bps: Breakpoint[] }>();

function bpOptions(path: string, bp: Breakpoint): monaco.editor.IModelDecorationOptions {
  const bound = view.state === 'idle' || (view.verified[path]?.includes(bp.line) ?? true);
  return {
    glyphMarginClassName: `dbg-bp ${bp.condition ? 'cond' : ''} ${bound ? '' : 'unbound'}`,
    glyphMarginHoverMessage: { value: bp.condition ? `${td('dbgCondition')}: \`${bp.condition}\`` : td('dbgToggleBp') },
    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
  };
}

function paintBreakpoints(model: monaco.editor.ITextModel): void {
  const path = modelPath(model);
  if (!path || model.isDisposed()) return;
  const bps = (view.breakpoints[path] ?? []).filter((b) => b.line <= model.getLineCount());
  const ids = model.deltaDecorations(
    bpDecorations.get(model)?.ids ?? [],
    bps.map((b) => ({ range: new monaco.Range(b.line, 1, b.line, 1), options: bpOptions(path, b) })),
  );
  bpDecorations.set(model, { ids, bps });
}

function setFileBreakpoints(path: string, bps: Breakpoint[]): void {
  const sorted = [...new Map(bps.map((b) => [b.line, b])).values()].sort((a, b) => a.line - b.line);
  set((v) => {
    const breakpoints = { ...v.breakpoints };
    if (sorted.length) breakpoints[path] = sorted;
    else delete breakpoints[path];
    return { breakpoints };
  });
  persist();
  const model = monaco.editor.getModel(fileUriOf(path));
  if (model) paintBreakpoints(model);
  if (view.state !== 'idle') void api().debug.setBreakpoints(path, sorted).catch(showError);
}

export function toggleBreakpoint(path: string, line: number): void {
  const bps = view.breakpoints[path] ?? [];
  setFileBreakpoints(
    path,
    bps.some((b) => b.line === line) ? bps.filter((b) => b.line !== line) : [...bps, { line }],
  );
}

export function setCondition(path: string, line: number, condition: string): void {
  const bps = view.breakpoints[path] ?? [];
  setFileBreakpoints(
    path,
    bps.some((b) => b.line === line)
      ? bps.map((b) => (b.line === line ? { line, condition: condition || undefined } : b))
      : [...bps, { line, condition: condition || undefined }],
  );
}

export function removeAllBreakpoints(): void {
  for (const path of Object.keys(view.breakpoints)) setFileBreakpoints(path, []);
}

/** The lines of the decorations after an edit (a breakpoint stays on its statement). */
function syncFromDecorations(model: monaco.editor.ITextModel): void {
  const path = modelPath(model);
  const painted = bpDecorations.get(model);
  if (!path || !painted?.ids.length) return;
  const moved: Breakpoint[] = [];
  let changed = false;
  painted.ids.forEach((id, i) => {
    const r = model.getDecorationRange(id);
    const bp = painted.bps[i];
    if (!r || !bp) return;
    if (r.startLineNumber !== bp.line) changed = true;
    moved.push({ ...bp, line: r.startLineNumber });
  });
  if (!changed) return;
  setFileBreakpoints(path, moved);
}

// ---------------- current line ----------------

let currentDecos: { model: monaco.editor.ITextModel; ids: string[] } | null = null;

function paintCurrent(frame: DebugFrame | undefined, top: boolean): void {
  if (currentDecos && !currentDecos.model.isDisposed())
    currentDecos.model.deltaDecorations(currentDecos.ids, []);
  currentDecos = null;
  if (!frame?.path) return;
  const model = monaco.editor.getModel(fileUriOf(frame.path));
  if (!model) return;
  const ids = model.deltaDecorations(
    [],
    [
      {
        range: new monaco.Range(frame.line, 1, frame.line, 1),
        options: {
          isWholeLine: true,
          className: top ? 'dbg-line' : 'dbg-line-frame',
          glyphMarginClassName: top ? 'dbg-arrow' : 'dbg-arrow frame',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      },
    ],
  );
  currentDecos = { model, ids };
}

export async function selectFrame(frame: DebugFrame): Promise<void> {
  set({ frameId: frame.id });
  if (!frame.path) {
    if (frame.absPath) toast(td('dbgOutside', { path: frame.absPath }));
    paintCurrent(undefined, false);
    return;
  }
  await openFile(frame.path, { line: frame.line, column: Math.max(1, frame.column) });
  paintCurrent(frame, frame.id === view.frames[0]?.id);
  void refreshWatches();
}

// ---------------- session ----------------

function showError(e: unknown): void {
  const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
  toast(msg);
  log('error', msg);
}

function activeFile(): string | undefined {
  const a = getState().active;
  return a && !a.startsWith('::') ? a : undefined;
}

export async function loadConfigs(): Promise<{ configs: DebugConfig[]; file?: string }> {
  if (!getState().workspace) return { configs: [] };
  try {
    return await api().debug.configs(activeFile());
  } catch (e) {
    showError(e);
    return { configs: [] };
  }
}

export async function startDebug(): Promise<void> {
  if (!getState().workspace) return toast(td('dbgIdle'));
  if (view.state === 'stopped') return void cont();
  if (view.state !== 'idle') return;
  // Unsaved code would not match what runs.
  await saveAll();
  const { configs, file } = await loadConfigs();
  // launch.json configurations are used as they are; the automatic one needs the file.
  const config = file && configs.length ? (configs[view.configIndex] ?? configs[0]!) : null;
  setState({ panelOpen: true, panelView: 'debug' });
  clearConsole();
  set({ frames: [], frameId: null, verified: {} });
  try {
    await api().debug.start(config, activeFile(), view.breakpoints);
  } catch (e) {
    showError(e);
  }
}

/** Debugs a test of the Test Explorer (main builds the runner command). */
export async function startTestDebug(req: TestRunRequest): Promise<void> {
  if (!getState().workspace) return toast(td('dbgIdle'));
  if (view.state !== 'idle') await api().debug.stop().catch(() => undefined);
  await saveAll();
  setState({ panelOpen: true, panelView: 'debug' });
  clearConsole();
  set({ frames: [], frameId: null, verified: {} });
  try {
    await api().debug.startTest(req, view.breakpoints);
  } catch (e) {
    showError(e);
  }
}

export function setConfigIndex(i: number): void {
  set({ configIndex: i });
}

const guard = (f: () => Promise<void>) => () => {
  if (view.state === 'idle') return;
  void f().catch(showError);
};
export const cont = guard(() => api().debug.continue());
export const pause = guard(() => api().debug.pause());
export const stepOver = guard(() => api().debug.step('over'));
export const stepInto = guard(() => api().debug.step('into'));
export const stepOut = guard(() => api().debug.step('out'));
export const stopDebug = guard(() => api().debug.stop());
export const restartDebug = guard(async () => {
  clearConsole();
  await api().debug.restart();
});

export function scopes(frameId: number): Promise<DebugVariable[]> {
  return api().debug.scopes(frameId);
}
export function children(ref: number): Promise<DebugVariable[]> {
  return api().debug.variables(ref);
}

export async function evaluateInConsole(expression: string): Promise<void> {
  const expr = expression.trim();
  if (!expr) return;
  log('input', expr);
  if (view.state === 'idle') return log('error', td('dbgIdle'));
  try {
    const r = await api().debug.evaluate(expr, view.frameId ?? undefined);
    log('result', r.value);
  } catch (e) {
    log('error', e instanceof Error ? e.message : String(e));
  }
}

// ---------------- watches ----------------

export interface WatchValue {
  expression: string;
  value?: DebugVariable;
  error?: string;
}
let watchValues: WatchValue[] = [];
const watchListeners = new Set<() => void>();
export function useWatchValues(): WatchValue[] {
  return useSyncExternalStore(
    (l) => {
      watchListeners.add(l);
      return () => watchListeners.delete(l);
    },
    () => watchValues,
  );
}

export async function refreshWatches(): Promise<void> {
  const stopped = view.state === 'stopped';
  const out: WatchValue[] = [];
  for (const expression of view.watches) {
    if (!stopped) {
      out.push({ expression });
      continue;
    }
    try {
      out.push({ expression, value: await api().debug.evaluate(expression, view.frameId ?? undefined) });
    } catch (e) {
      out.push({ expression, error: e instanceof Error ? e.message.split('\n')[0] : String(e) });
    }
  }
  watchValues = out;
  for (const l of watchListeners) l();
}

export function addWatch(expression: string): void {
  const e = expression.trim();
  if (!e || view.watches.includes(e)) return;
  set((v) => ({ watches: [...v.watches, e] }));
  persist();
  void refreshWatches();
}
export function removeWatch(expression: string): void {
  set((v) => ({ watches: v.watches.filter((w) => w !== expression) }));
  persist();
  void refreshWatches();
}

// ---------------- editor wiring ----------------

/** Glyph margin clicks toggle breakpoints; the decorations follow the edits. */
export function attachDebugToEditor(ed: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  const subs: monaco.IDisposable[] = [];
  let hover: string[] = [];
  subs.push(
    ed.onMouseDown((e) => {
      const t = e.target.type;
      if (
        t !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        t !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
      )
        return;
      if (e.event.rightButton) return;
      // The right lane holds the Test Explorer's ▶ / ✓ / ✗: a click there runs the test.
      const model = ed.getModel();
      const path = model && modelPath(model);
      const line = e.target.position?.lineNumber;
      if (
        model &&
        line &&
        (e.target.detail as { glyphMarginLane?: monaco.editor.GlyphMarginLane } | undefined)
          ?.glyphMarginLane === monaco.editor.GlyphMarginLane.Right &&
        model
          .getLineDecorations(line)
          .some((d) => d.options.glyphMarginClassName?.includes('te-mark'))
      )
        return;
      if (path && line) toggleBreakpoint(path, line);
    }),
    // A faint dot where a click would add a breakpoint.
    ed.onMouseMove((e) => {
      const model = ed.getModel();
      const t = e.target.type;
      const line = e.target.position?.lineNumber;
      const inGutter =
        t === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        t === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;
      const path = model && modelPath(model);
      const has = path && line && view.breakpoints[path]?.some((b) => b.line === line);
      hover = ed.deltaDecorations(
        hover,
        inGutter && line && !has
          ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'dbg-bp-hint' } }]
          : [],
      );
    }),
    ed.onMouseLeave(() => {
      hover = ed.deltaDecorations(hover, []);
    }),
  );
  return { dispose: () => subs.forEach((s) => s.dispose()) };
}

/** Line of the cursor in the active editor, for F9. */
export function toggleBreakpointAtCursor(): void {
  const ed = monaco.editor.getEditors().find((e) => e.hasTextFocus()) ?? monaco.editor.getEditors()[0];
  const model = ed?.getModel();
  const path = model && modelPath(model);
  const line = ed?.getPosition()?.lineNumber;
  if (path && line) toggleBreakpoint(path, line);
}

let installed = false;
export function installDebug(): void {
  if (installed) return;
  installed = true;
  const watch = (model: monaco.editor.ITextModel) => {
    if (model.uri.scheme !== 'file') return;
    paintBreakpoints(model);
    const sub = model.onDidChangeContent(() => syncFromDecorations(model));
    model.onWillDispose(() => {
      sub.dispose();
      bpDecorations.delete(model);
    });
    // The stop line of a file opened after the stop.
    const top = view.frames.find((f) => f.id === view.frameId);
    if (top?.path === modelPath(model)) paintCurrent(top, top.id === view.frames[0]?.id);
  };
  for (const m of monaco.editor.getModels()) watch(m);
  monaco.editor.onDidCreateModel(watch);
  restore();

  api().on((ev) => {
    if (ev.type === 'workspace') {
      restore();
      return;
    }
    if (ev.type !== 'debug') return;
    const e = ev.event;
    if (e.kind === 'state') {
      set({ state: e.state, ...(e.name ? { name: e.name } : {}) });
      if (e.state !== 'stopped') {
        paintCurrent(undefined, false);
        set({ frames: [], frameId: null, reason: undefined, description: undefined });
      }
      if (e.state === 'idle') {
        set({ verified: {} });
        void refreshWatches();
      }
      for (const m of monaco.editor.getModels()) paintBreakpoints(m);
    } else if (e.kind === 'stopped') {
      set({ frames: e.frames, reason: e.reason, description: e.description });
      const first = e.frames.find((f) => f.path) ?? e.frames[0];
      if (first) void selectFrame(first);
      else void refreshWatches();
    } else if (e.kind === 'output') {
      log(e.category, e.text);
    } else if (e.kind === 'breakpoints') {
      set((v) => ({ verified: { ...v.verified, [e.path]: e.lines } }));
      const model = monaco.editor.getModel(fileUriOf(e.path));
      if (model) paintBreakpoints(model);
    }
  });
}
