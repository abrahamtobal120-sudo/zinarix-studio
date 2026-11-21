import { monaco } from '../../monaco';
import {
  api,
  getState,
  onDiskChange,
  registerViewerSaver,
  setTabDirty,
  subscribeStore,
  toast,
} from '../../store';
import {
  applyIopub,
  kernelName,
  notebookToScript,
  scriptExtension,
  newCell,
  newCellId,
  notebookLanguage,
  parseNotebook,
  serializeNotebook,
  type CellType,
  type JupyterStatus,
  type KernelState,
  type NbCell,
  type NbVariable,
  type Notebook,
  type NotebookEvent,
  type OutputState,
} from '../../../shared/notebook';
import { tn } from './notebookStrings';

/**
 * State of the open notebooks (Fase 2A del plan de funciones), outside React so switching tabs
 * keeps everything: cells, their Monaco models, outputs, the kernel and what is running.
 * The kernel runs in main (jupyter.ts); its events come back as `notebook` app events.
 */

export type CellRun = 'idle' | 'queued' | 'running';

export interface UiCell {
  /** Stable key: the nbformat cell id when there is one (the agent's runs use it too). */
  uid: string;
  cell: NbCell;
  run: CellRun;
  /** Live outputs while it runs (written to cell.outputs at the end). */
  out: OutputState;
  collapsed: boolean;
  /** Markdown cells: editing the source instead of showing it rendered. */
  editing: boolean;
  /** When the kernel started on it (ms), while it runs. */
  startedAt?: number;
  /** How long its last run took (ms), in this session. */
  elapsed?: number;
}

export interface NbDoc {
  path: string;
  nb: Notebook | null;
  error: string | null;
  cells: UiCell[];
  /** Bumped on every change; equal to `saved` = nothing to save. */
  version: number;
  saved: number;
  kernel: KernelState | 'off';
  kernelMessage?: string;
  kernelLabel: string | null;
  selected: string | null;
  /** Cells queued on the kernel, in order (for the "busy" cell). */
  queue: string[];
  /** Variables of the kernel (null = not asked yet / no kernel). */
  variables: NbVariable[] | null;
  variablesLoading: boolean;
}

const docs = new Map<string, NbDoc>();
const models = new Map<string, monaco.editor.ITextModel>();
const subs = new Map<string, Set<() => void>>();
const modelKey = (path: string, uid: string) => `${path}\u0000${uid}`;

let jupyter: { status: JupyterStatus; python: string | null } | null = null;
const jupyterSubs = new Set<() => void>();

export function getDoc(path: string): NbDoc | undefined {
  return docs.get(path);
}

export function subscribe(path: string, fn: () => void): () => void {
  let s = subs.get(path);
  if (!s) subs.set(path, (s = new Set()));
  s.add(fn);
  return () => s.delete(fn);
}

function changed(d: NbDoc, dirty = true): void {
  if (dirty) d.version++;
  // New object so React (useSyncExternalStore) sees the change.
  const next = { ...d };
  docs.set(d.path, next);
  setTabDirty(d.path, next.version !== next.saved);
  for (const fn of subs.get(d.path) ?? []) fn();
}

function patch(path: string, fn: (d: NbDoc) => void, dirty = true): void {
  const d = docs.get(path);
  if (!d) return;
  fn(d);
  changed(d, dirty);
}

// ------------------------------------------------------------------ Jupyter status

export function jupyterState(): typeof jupyter {
  return jupyter;
}
export function subscribeJupyter(fn: () => void): () => void {
  jupyterSubs.add(fn);
  return () => jupyterSubs.delete(fn);
}
export async function checkJupyter(force = false): Promise<void> {
  try {
    jupyter = await api().notebook.status(force);
  } catch {
    jupyter = { status: { ok: false, reason: 'no-python', tried: [] }, python: null };
  }
  for (const fn of jupyterSubs) fn();
}

// ------------------------------------------------------------------ cells and models

function uiCell(cell: NbCell): UiCell {
  return {
    uid: cell.id ?? `c${newCellId()}`,
    cell,
    run: 'idle',
    out: { outputs: cell.outputs, clearPending: false },
    collapsed: cell.metadata.collapsed === true || (cell.metadata.jupyter as { outputs_hidden?: boolean } | undefined)?.outputs_hidden === true,
    editing: false,
  };
}

function languageOf(d: NbDoc, c: UiCell): string {
  if (c.cell.cell_type === 'markdown') return 'markdown';
  if (c.cell.cell_type === 'raw') return 'plaintext';
  const l = d.nb ? notebookLanguage(d.nb) : 'python';
  return l === 'python3' ? 'python' : l;
}

/** The Monaco model of a cell (created on first use, kept while the notebook is open). */
export function cellModel(path: string, uid: string): monaco.editor.ITextModel | null {
  const d = docs.get(path);
  const c = d?.cells.find((x) => x.uid === uid);
  if (!d || !c) return null;
  const key = modelKey(path, uid);
  let m = models.get(key);
  if (m && !m.isDisposed()) return m;
  // Own scheme: language servers and the file tree never see these as project files.
  const uri = monaco.Uri.from({ scheme: 'nbcell', path: `/${path}`, fragment: uid });
  m = monaco.editor.getModel(uri) ?? monaco.editor.createModel(c.cell.source, languageOf(d, c), uri);
  m.onDidChangeContent(() => {
    const doc = docs.get(path);
    const cell = doc?.cells.find((x) => x.uid === uid);
    if (!doc || !cell || cell.cell.source === m!.getValue()) return;
    cell.cell = { ...cell.cell, source: m!.getValue() };
    changed(doc);
  });
  models.set(key, m);
  return m;
}

function disposeModel(path: string, uid: string): void {
  const key = modelKey(path, uid);
  models.get(key)?.dispose();
  models.delete(key);
}

function disposeModels(path: string): void {
  for (const [k, m] of models)
    if (k.startsWith(`${path}\u0000`)) {
      m.dispose();
      models.delete(k);
    }
}

// ------------------------------------------------------------------ loading and saving

/** Reads the whole file in slices (big notebooks with plots pass the 10 MB text limit). */
async function readText(path: string): Promise<string> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (;;) {
    const { bytes, size } = await api().workspace.readBytes(path, offset, 8 * 1024 * 1024);
    if (size > 50 * 1024 * 1024) throw new Error('> 50 MB');
    parts.push(bytes);
    offset += bytes.length;
    if (bytes.length === 0 || offset >= size) break;
  }
  return new Blob(parts).text();
}

export async function openNotebook(path: string): Promise<void> {
  if (docs.has(path)) return;
  const d: NbDoc = {
    path,
    nb: null,
    error: null,
    cells: [],
    version: 0,
    saved: 0,
    kernel: 'off',
    kernelLabel: null,
    selected: null,
    queue: [],
    variables: null,
    variablesLoading: false,
  };
  docs.set(path, d);
  watchTabs();
  try {
    const nb = parseNotebook(await readText(path));
    d.nb = nb;
    d.cells = nb.cells.map(uiCell);
    d.selected = d.cells[0]?.uid ?? null;
  } catch (e) {
    d.error = (e as Error).message;
  }
  changed(d, false);
  if (!jupyter) void checkJupyter();
}

function snapshot(d: NbDoc): Notebook {
  const nb = d.nb!;
  return {
    ...nb,
    cells: d.cells.map((c) => {
      const m = models.get(modelKey(d.path, c.uid));
      const source = m && !m.isDisposed() ? m.getValue() : c.cell.source;
      const metadata = { ...c.cell.metadata };
      if (c.collapsed) metadata.collapsed = true;
      else delete metadata.collapsed;
      if (c.cell.cell_type !== 'code') return { ...c.cell, source };
      return {
        ...c.cell,
        source,
        metadata,
        outputs: c.run === 'idle' ? c.cell.outputs : c.out.outputs,
      };
    }),
  };
}

export async function saveNotebook(path: string): Promise<void> {
  const d = docs.get(path);
  if (!d?.nb) return;
  const version = d.version;
  try {
    await api().workspace.writeFile(path, serializeNotebook(snapshot(d)));
    patch(path, (x) => (x.saved = version), false);
  } catch (e) {
    toast(tn('saveFailed', { err: (e as Error).message }));
  }
}

/** The file changed on disk (the agent wrote it): reload unless the user has changes. */
async function reload(path: string): Promise<void> {
  const d = docs.get(path);
  if (!d) return;
  if (d.version !== d.saved) {
    toast(tn('diskChanged'));
    return;
  }
  let nb: Notebook;
  try {
    nb = parseNotebook(await readText(path));
  } catch {
    return; // half-written or deleted: keep what is shown
  }
  const cur = docs.get(path);
  if (!cur || cur.version !== cur.saved) return;
  const same = serializeNotebook(nb) === serializeNotebook(snapshot(cur));
  if (same) return;
  const old = new Map(cur.cells.map((c) => [c.uid, c]));
  const cells = nb.cells.map((cell) => {
    const prev = cell.id ? old.get(cell.id) : undefined;
    const next = uiCell(cell);
    if (prev) {
      next.collapsed = prev.collapsed;
      // A cell the user is running keeps its live state.
      if (prev.run !== 'idle') {
        next.run = prev.run;
        next.out = prev.out;
      }
      const m = models.get(modelKey(path, prev.uid));
      if (m && !m.isDisposed() && m.getValue() !== cell.source) m.setValue(cell.source);
    }
    return next;
  });
  const keep = new Set(cells.map((c) => c.uid));
  for (const c of cur.cells) if (!keep.has(c.uid)) disposeModel(path, c.uid);
  // Cells without ids got new uids: their models are rebuilt.
  if (!nb.cells.every((c) => c.id)) disposeModels(path);
  cur.nb = nb;
  cur.cells = cells;
  if (!cells.some((c) => c.uid === cur.selected)) cur.selected = cells[0]?.uid ?? null;
  cur.version++;
  cur.saved = cur.version;
  changed(cur, false);
  toast(tn('reloaded'));
}

// ------------------------------------------------------------------ editing

export function select(path: string, uid: string | null): void {
  patch(path, (d) => (d.selected = uid), false);
}

export function addCell(path: string, type: CellType, after: string | null): string | null {
  const d = docs.get(path);
  if (!d?.nb) return null;
  const c = uiCell(newCell(type, '', d.nb.nbformat_minor));
  if (type === 'markdown') c.editing = true;
  const i = after ? d.cells.findIndex((x) => x.uid === after) : d.cells.length - 1;
  d.cells = [...d.cells.slice(0, i + 1), c, ...d.cells.slice(i + 1)];
  d.selected = c.uid;
  changed(d);
  return c.uid;
}

export function deleteCell(path: string, uid: string): void {
  const d = docs.get(path);
  if (!d) return;
  const i = d.cells.findIndex((x) => x.uid === uid);
  if (i < 0) return;
  d.cells = d.cells.filter((x) => x.uid !== uid);
  disposeModel(path, uid);
  d.selected = d.cells[Math.min(i, d.cells.length - 1)]?.uid ?? null;
  changed(d);
}

export function moveCell(path: string, uid: string, by: -1 | 1): void {
  const d = docs.get(path);
  if (!d) return;
  const i = d.cells.findIndex((x) => x.uid === uid);
  const j = i + by;
  if (i < 0 || j < 0 || j >= d.cells.length) return;
  const cells = [...d.cells];
  [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  d.cells = cells;
  changed(d);
}

export function setCellType(path: string, uid: string, type: CellType): void {
  const d = docs.get(path);
  const c = d?.cells.find((x) => x.uid === uid);
  if (!d || !c || c.cell.cell_type === type) return;
  const m = models.get(modelKey(path, uid));
  const source = m && !m.isDisposed() ? m.getValue() : c.cell.source;
  const extra = { ...c.cell.extra };
  delete extra.cell_type;
  c.cell = { ...c.cell, cell_type: type, source, outputs: [], execution_count: null, extra };
  c.out = { outputs: [], clearPending: false };
  c.editing = type === 'markdown';
  disposeModel(path, uid); // new language
  changed(d);
}

export function setEditing(path: string, uid: string, editing: boolean): void {
  patch(
    path,
    (d) => {
      const c = d.cells.find((x) => x.uid === uid);
      if (c) c.editing = editing;
    },
    false,
  );
}

export function toggleCollapsed(path: string, uid: string): void {
  patch(path, (d) => {
    const c = d.cells.find((x) => x.uid === uid);
    if (c) c.collapsed = !c.collapsed;
  });
}

export function clearOutputs(path: string): void {
  patch(path, (d) => {
    for (const c of d.cells)
      if (c.cell.cell_type === 'code' && c.run === 'idle') {
        c.cell = { ...c.cell, outputs: [], execution_count: null };
        c.out = { outputs: [], clearPending: false };
      }
  });
}

// ------------------------------------------------------------------ running

async function ensureKernel(d: NbDoc): Promise<boolean> {
  if (d.kernel !== 'off' && d.kernel !== 'dead') return true;
  if (!jupyter) await checkJupyter();
  if (!jupyter?.status.ok) {
    await checkJupyter(true);
    if (!jupyter?.status.ok) return false;
  }
  patch(d.path, (x) => ((x.kernel = 'starting'), (x.kernelMessage = undefined)), false);
  try {
    const info = await api().notebook.start(d.path, d.nb ? kernelName(d.nb) : null);
    patch(
      d.path,
      (x) => {
        x.kernelLabel = info.displayName;
        if (x.kernel === 'starting') x.kernel = 'idle';
      },
      false,
    );
    return true;
  } catch (e) {
    const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    patch(d.path, (x) => ((x.kernel = 'dead'), (x.kernelMessage = msg)), false);
    toast(tn('failedStart', { err: msg }));
    return false;
  }
}

/** Queues code cells on the kernel, in order. */
export async function runCells(path: string, uids: string[]): Promise<void> {
  const d = docs.get(path);
  if (!d?.nb) return;
  const code = uids
    .map((u) => d.cells.find((c) => c.uid === u))
    .filter((c): c is UiCell => !!c && c.cell.cell_type === 'code' && c.run === 'idle');
  if (!code.length) return;
  if (!(await ensureKernel(d))) return;
  for (const c of code) {
    const m = models.get(modelKey(path, c.uid));
    const source = m && !m.isDisposed() ? m.getValue() : c.cell.source;
    patch(path, (x) => {
      const cell = x.cells.find((y) => y.uid === c.uid);
      if (!cell) return;
      cell.run = 'queued';
      cell.out = { outputs: [], clearPending: false };
      cell.cell = { ...cell.cell, source, execution_count: null };
      x.queue = [...x.queue, c.uid];
    });
    try {
      await api().notebook.execute(path, c.uid, source);
    } catch (e) {
      finishCell(path, c.uid, 'aborted', null);
      toast((e as Error).message);
      return;
    }
  }
}

export function runAll(path: string): Promise<void> {
  const d = docs.get(path);
  return runCells(path, d?.cells.map((c) => c.uid) ?? []);
}

export function runFrom(path: string, uid: string, dir: 'above' | 'below'): Promise<void> {
  const d = docs.get(path);
  if (!d) return Promise.resolve();
  const i = d.cells.findIndex((c) => c.uid === uid);
  const list = dir === 'above' ? d.cells.slice(0, i) : d.cells.slice(i);
  return runCells(path, list.map((c) => c.uid));
}

export async function interrupt(path: string): Promise<void> {
  await api().notebook.interrupt(path).catch((e: Error) => toast(e.message));
}

export async function restart(path: string): Promise<void> {
  const d = docs.get(path);
  if (!d || d.kernel === 'off' || d.kernel === 'dead') return;
  await api().notebook.restart(path).catch((e: Error) => toast(e.message));
}

function markRunning(c: UiCell): void {
  if (c.run === 'running') return;
  c.run = 'running';
  c.startedAt = Date.now();
}

function finishCell(path: string, uid: string, status: string, count: number | null): void {
  patch(path, (d) => {
    const c = d.cells.find((x) => x.uid === uid);
    d.queue = d.queue.filter((u) => u !== uid);
    if (!c) return;
    if (c.run === 'running' && c.startedAt) c.elapsed = Date.now() - c.startedAt;
    c.startedAt = undefined;
    c.run = 'idle';
    // An aborted cell (an earlier one failed) keeps no half output of its own.
    const outputs = status === 'aborted' && !c.out.outputs.length ? c.cell.outputs : c.out.outputs;
    c.cell = { ...c.cell, outputs, execution_count: count ?? c.cell.execution_count };
    c.out = { outputs, clearPending: false };
  });
}

function onEvent(e: NotebookEvent): void {
  const d = docs.get(e.path);
  if (!d) return;
  if (e.kind === 'kernel') {
    patch(
      e.path,
      (x) => {
        x.kernel = e.state;
        x.kernelMessage = e.message;
        if (e.state === 'busy') {
          const head = x.cells.find((c) => c.uid === x.queue[0]);
          if (head) markRunning(head);
        }
        if (e.state === 'dead' || e.state === 'restarting') {
          for (const c of x.cells)
            if (c.run !== 'idle') {
              c.run = 'idle';
              c.startedAt = undefined;
            }
          x.queue = [];
          x.variables = null;
        }
      },
      false,
    );
    return;
  }
  if (e.kind === 'output') {
    patch(e.path, (x) => {
      const c = x.cells.find((y) => y.uid === e.cellId);
      if (!c) return;
      if (c.run === 'queued') markRunning(c);
      c.out = applyIopub(c.out, e.msgType, e.content);
      // The agent's runs (not queued here) show up live as well.
      if (c.run === 'idle') c.cell = { ...c.cell, outputs: c.out.outputs };
    });
    return;
  }
  finishCell(e.path, e.cellId, e.status, e.executionCount);
  // Next queued cell is the running one.
  patch(
    e.path,
    (x) => {
      const head = x.cells.find((c) => c.uid === x.queue[0]);
      if (head && head.run === 'queued') markRunning(head);
    },
    false,
  );
  // The queue ran out: what the cells left in the kernel.
  if (variablesOpen && !docs.get(e.path)?.queue.length) scheduleVariables(e.path);
}

// ------------------------------------------------------------------ variables

let variablesOpen = (() => {
  try {
    return localStorage.getItem('zs.nb.variables') === '1';
  } catch {
    return false;
  }
})();
const varsSubs = new Set<() => void>();

export function variablesShown(): boolean {
  return variablesOpen;
}
export function subscribeVariablesShown(fn: () => void): () => void {
  varsSubs.add(fn);
  return () => varsSubs.delete(fn);
}

/** Shows / hides the variables panel (remembered); showing it asks the kernel. */
export function toggleVariables(path: string): void {
  variablesOpen = !variablesOpen;
  try {
    localStorage.setItem('zs.nb.variables', variablesOpen ? '1' : '0');
  } catch {
    // storage unavailable: only this session remembers
  }
  for (const fn of varsSubs) fn();
  if (variablesOpen) void loadVariables(path);
}

const varTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleVariables(path: string): void {
  clearTimeout(varTimers.get(path));
  varTimers.set(
    path,
    setTimeout(() => {
      varTimers.delete(path);
      void loadVariables(path);
    }, 250),
  );
}

export async function loadVariables(path: string): Promise<void> {
  const d = docs.get(path);
  if (!d || d.kernel === 'off' || d.kernel === 'dead' || d.kernel === 'starting') return;
  patch(path, (x) => (x.variablesLoading = true), false);
  const vars = await api()
    .notebook.variables(path)
    .catch(() => null);
  patch(
    path,
    (x) => {
      x.variablesLoading = false;
      x.variables = vars;
    },
    false,
  );
}

// ------------------------------------------------------------------ export

/** Writes the notebook as a script (`# %%` cells) next to it; returns its path. */
export async function exportScript(path: string, confirmOverwrite: (p: string) => Promise<boolean>): Promise<string | null> {
  const d = docs.get(path);
  if (!d?.nb) return null;
  const nb = snapshot(d);
  const target = path.replace(/\.ipynb$/i, '') + scriptExtension(nb);
  const exists = await api()
    .workspace.readBytes(target, 0, 1)
    .then(() => true)
    .catch(() => false);
  if (exists && !(await confirmOverwrite(target))) return null;
  await api().workspace.writeFile(target, notebookToScript(nb));
  return target;
}

/** Text of a cell's error, for "fix with AI". */
export function cellErrorText(c: UiCell): string | null {
  const outs = c.run === 'idle' ? c.cell.outputs : c.out.outputs;
  const err = outs.find((o) => o.output_type === 'error');
  if (!err || err.output_type !== 'error') return null;
  return err.traceback.length ? err.traceback.join('\n') : `${err.ename}: ${err.evalue}`;
}

// ------------------------------------------------------------------ lifecycle

let installed = false;
let tabsWatched = false;

/** Events of the kernels, saves (Ctrl+S) and disk changes; once per window. */
export function installNotebooks(): void {
  if (installed) return;
  installed = true;
  api().on((ev) => {
    if (ev.type === 'notebook') onEvent(ev.event);
    if (ev.type === 'workspace') {
      jupyter = null;
      for (const fn of jupyterSubs) fn();
    }
  });
  onDiskChange((p) => {
    const norm = p.replace(/\\/g, '/');
    const root = getState().workspace?.root.replace(/\\/g, '/');
    for (const path of docs.keys()) {
      const abs = root ? `${root}/${path}` : path;
      if (norm === path || norm.toLowerCase() === abs.toLowerCase()) void reload(path);
    }
  });
}

const unsavers = new Map<string, () => void>();

/** Closing a notebook tab frees its kernel, models and state. */
function watchTabs(): void {
  for (const path of docs.keys())
    if (!unsavers.has(path)) unsavers.set(path, registerViewerSaver(path, () => saveNotebook(path)));
  if (tabsWatched) return;
  tabsWatched = true;
  subscribeStore(() => {
    const open = new Set(getState().tabs.map((t) => t.path));
    for (const path of [...docs.keys()]) {
      if (open.has(path)) continue;
      const d = docs.get(path)!;
      docs.delete(path);
      subs.delete(path);
      disposeModels(path);
      unsavers.get(path)?.();
      unsavers.delete(path);
      if (d.kernel !== 'off') void api().notebook.shutdown(path).catch(() => undefined);
    }
  });
}
