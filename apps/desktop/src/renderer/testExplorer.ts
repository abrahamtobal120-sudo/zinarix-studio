/**
 * Test Explorer state of the window (renderer side of main/testing): the tests found in the
 * project, the merged results of the last runs, the runner's output, and the ✓ / ✗ marks next
 * to each test in the editor. Main finds the runner, builds the command and runs it.
 */
import { useSyncExternalStore } from 'react';
import {
  namePattern,
  statusByItem,
  type TestDiscovery,
  type TestItem,
  type TestProject,
  type TestResult,
  type TestRunRequest,
  type TestRunSummary,
  type TestStatus,
  type TestTarget,
} from '../shared/testing';
import { t } from './i18n';
import { modelPath } from './lsp';
import { monaco } from './monaco';
import { api, getState, onSaved, saveAll, toast } from './store';
import { startTestDebug } from './debug';

export interface TestsView {
  discovery: TestDiscovery | null;
  loading: boolean;
  running: boolean;
  /** What is running ("math adds", a file…). */
  label?: string;
  summary: TestRunSummary | null;
  /** item id → status of the last run that covered it. */
  status: Map<string, TestStatus>;
  output: string;
  /** Items being run right now (shown spinning). */
  pending: Set<string>;
  /** Run the tests touched by a file when it is saved. */
  onSave: boolean;
}

const ON_SAVE_KEY = 'zs.testsOnSave';

let view: TestsView = {
  discovery: null,
  loading: false,
  running: false,
  summary: null,
  status: new Map(),
  output: '',
  pending: new Set(),
  onSave: localStorage.getItem(ON_SAVE_KEY) === '1',
};
const listeners = new Set<() => void>();
function set(patch: Partial<TestsView>): void {
  view = { ...view, ...patch };
  for (const l of listeners) l();
}
export function getTests(): TestsView {
  return view;
}
export function useTests<T>(select: (v: TestsView) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(view),
  );
}

const MAX_OUTPUT = 200_000;

function recompute(): void {
  const items = view.discovery?.items ?? [];
  set({ status: statusByItem(items, view.summary?.results ?? []) });
  for (const m of monaco.editor.getModels()) paint(m);
}

export async function discover(): Promise<void> {
  if (!getState().workspace) return set({ discovery: null });
  set({ loading: true });
  try {
    const [d, last] = await Promise.all([api().tests.discover(), api().tests.last()]);
    templates.clear();
    set({ discovery: d, summary: last ?? view.summary });
    recompute();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    set({ loading: false });
  }
}

/** The project (runner + folder) a file belongs to. */
export function projectOf(file: string): TestProject | undefined {
  return view.discovery?.projects.find((p) => p.files.includes(file));
}

/** Request for a project, a file, or one item. */
export function requestFor(project: TestProject, target?: TestItem | string): TestRunRequest {
  const base = { framework: project.framework, cwd: project.cwd };
  if (!target) return base;
  if (typeof target === 'string') return { ...base, files: [target] };
  return {
    ...base,
    item: {
      file: target.file,
      fullName: target.fullName,
      kind: target.kind,
      ...(target.dynamic ? { dynamic: true } : {}),
    },
  };
}

function idsFor(req: TestRunRequest): Set<string> {
  const items = view.discovery?.items ?? [];
  const project = view.discovery?.projects.find(
    (p) => p.framework === req.framework && p.cwd === req.cwd,
  );
  const sep = req.framework === 'pytest' ? '::' : ' ';
  const base = (n: string) => (req.framework === 'pytest' ? n.replace(/\[[^\]]*\]$/, '') : n);
  const targets = [...(req.item ? [req.item] : []), ...(req.items ?? [])];
  return new Set(
    items
      .filter((i) => {
        if (targets.length)
          return targets.some(
            (x) =>
              i.file === x.file &&
              (i.fullName === base(x.fullName) || i.fullName.startsWith(x.fullName + sep)),
          );
        if (req.related?.length) return false; // which tests run is only known afterwards
        if (req.files?.length) return req.files.includes(i.file);
        return project?.files.includes(i.file) ?? false;
      })
      .map((i) => i.id),
  );
}

/** Set by "cancel" so a "run all" / "rerun failed" over several projects stops too. */
let stopBatch = false;

export async function runTests(
  req: TestRunRequest,
  opts: { keepOutput?: boolean; quiet?: boolean } = {},
): Promise<boolean> {
  if (view.running) {
    if (!opts.quiet) toast(t('teBusy'));
    return false;
  }
  await saveAll(); // unsaved code would not match what runs
  set({ pending: idsFor(req), ...(opts.keepOutput ? {} : { output: '' }) });
  try {
    const s = await api().tests.run(req);
    if (s.error) toast(s.error.split('\n')[0]!);
    else if (!opts.quiet || s.failed) toast(t('teDone', { passed: s.passed, failed: s.failed }));
    return !s.error;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    set({ pending: new Set() });
  }
}

/** Runs several requests one after another (one output); stops when cancelled. */
async function runBatch(reqs: TestRunRequest[]): Promise<void> {
  if (view.running) return toast(t('teBusy'));
  stopBatch = false;
  for (const [i, req] of reqs.entries()) {
    if (stopBatch) break;
    await runTests(req, { keepOutput: i > 0 });
  }
}

export async function runAll(): Promise<void> {
  const projects = (view.discovery?.projects ?? []).filter((p) => !p.problem);
  if (!projects.length) return toast(t('teNone'));
  await runBatch(projects.map((p) => requestFor(p)));
}

/** The failed results of the last runs, as requests per project (exact names, or whole files). */
export function failedRequests(): TestRunRequest[] {
  const failed = (view.summary?.results ?? []).filter((r) => r.status === 'failed');
  const byProject = new Map<
    string,
    { project: TestProject; items: TestTarget[]; files: Set<string> }
  >();
  for (const r of failed) {
    const project = projectOf(r.file);
    if (!project || project.problem) continue;
    const key = `${project.framework}:${project.cwd}`;
    const g = byProject.get(key) ?? { project, items: [], files: new Set<string>() };
    if (r.fullName) g.items.push({ file: r.file, fullName: r.fullName, kind: 'test' });
    else g.files.add(r.file); // the file failed to load: run it whole
    byProject.set(key, g);
  }
  const out: TestRunRequest[] = [];
  for (const { project, items, files } of byProject.values()) {
    const base = { framework: project.framework, cwd: project.cwd };
    const loose = items.filter((i) => !files.has(i.file));
    if (loose.length) out.push({ ...base, items: loose.slice(0, 500) });
    if (files.size) out.push({ ...base, files: [...files] });
  }
  return out;
}

export async function rerunFailed(): Promise<void> {
  const reqs = failedRequests();
  if (!reqs.length) return toast(t('teNoFailed'));
  await runBatch(reqs);
}

export function cancelTests(): void {
  stopBatch = true;
  void api().tests.cancel();
}

export function setRunOnSave(on: boolean): void {
  localStorage.setItem(ON_SAVE_KEY, on ? '1' : '0');
  set({ onSave: on });
}

export async function clearResults(): Promise<void> {
  await api().tests.clear();
  set({ summary: null });
  recompute();
}

/**
 * What to run when `path` is saved: the file itself if it is a test file, else (Vitest / Jest)
 * the tests that import it. Null when nothing applies.
 */
export function saveRequest(path: string): TestRunRequest | null {
  const projects = (view.discovery?.projects ?? []).filter((p) => !p.problem);
  const own = projects.find((p) => p.files.includes(path));
  if (own) return requestFor(own, path);
  if (!/\.[cm]?[jt]sx?$/.test(path)) return null;
  const inside = (p: TestProject) => !p.cwd || path.startsWith(`${p.cwd}/`);
  const js = projects
    .filter((p) => p.framework !== 'pytest' && inside(p))
    .sort((a, b) => b.cwd.length - a.cwd.length)[0];
  return js ? { framework: js.framework, cwd: js.cwd, related: [path] } : null;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const savedPaths = new Set<string>();

function onFileSaved(path: string): void {
  if (!view.onSave || !view.discovery) return;
  savedPaths.add(path);
  // "Save all" writes several files: one run for all of them.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const paths = [...savedPaths];
    savedPaths.clear();
    if (view.running) return; // a run is going on: do not queue another one
    const reqs: TestRunRequest[] = [];
    for (const p of paths) {
      const r = saveRequest(p);
      if (!r) continue;
      const same = reqs.find(
        (x) =>
          x.framework === r.framework &&
          x.cwd === r.cwd &&
          Boolean(x.related) === Boolean(r.related),
      );
      if (same && r.related) same.related = [...new Set([...(same.related ?? []), ...r.related])];
      else if (same && r.files) same.files = [...new Set([...(same.files ?? []), ...r.files])];
      else reqs.push(r);
    }
    void (async () => {
      for (const [i, r] of reqs.entries()) await runTests(r, { keepOutput: i > 0, quiet: true });
    })();
  }, 400);
}

export async function debugTest(project: TestProject, target?: TestItem | string): Promise<void> {
  await startTestDebug(requestFor(project, target));
}

/** Results of a file that are not tied to one test (the file failed to load). */
export function fileErrors(file: string): TestResult[] {
  return (view.summary?.results ?? []).filter((r) => r.file === file && !r.fullName);
}

const templates = new Map<string, RegExp | null>();
function templateOf(item: TestItem): RegExp | null {
  let re = templates.get(item.id);
  if (re === undefined) {
    try {
      re = new RegExp(namePattern({ ...item, kind: 'test' }));
    } catch {
      re = null;
    }
    templates.set(item.id, re);
  }
  return re;
}

/** The result rows behind an item, to show its error (several for `.each` / parameters). */
export function resultsOf(item: TestItem): TestResult[] {
  const py = item.file.endsWith('.py');
  return (view.summary?.results ?? []).filter((r) => {
    if (r.file !== item.file || !r.fullName) return false;
    const name = py ? r.fullName.replace(/\[[^\]]*\]$/, '') : r.fullName;
    return item.kind === 'test'
      ? name === item.fullName || (item.dynamic === true && Boolean(templateOf(item)?.test(name)))
      : name.startsWith(item.fullName + (py ? '::' : ' '));
  });
}

/**
 * The runs of one test that the file does not spell out: the rows of `it.each`, pytest
 * parameters. Empty for a plain test (its only run is itself).
 */
export function variantsOf(item: TestItem): TestResult[] {
  if (item.kind !== 'test') return [];
  const rows = resultsOf(item);
  return rows.length === 1 && rows[0]!.fullName === item.fullName ? [] : rows;
}

/** The innermost test or describe at a line of a file (for "run the test at the cursor"). */
export function itemAt(file: string, line: number): TestItem | undefined {
  const items = (view.discovery?.items ?? []).filter((i) => i.file === file && i.line <= line);
  return items.sort((a, b) => b.line - a.line)[0];
}

function cursor(): { path: string; line: number } | null {
  const ed =
    monaco.editor.getEditors().find((e) => e.hasTextFocus()) ?? monaco.editor.getEditors()[0];
  const model = ed?.getModel();
  const path = model && modelPath(model);
  const line = ed?.getPosition()?.lineNumber;
  return path && line ? { path, line } : null;
}

export async function runAtCursor(debug = false): Promise<void> {
  if (!view.discovery) await discover();
  const c = cursor();
  const project = c && projectOf(c.path);
  if (!c || !project) return toast(t('teNoTestHere'));
  const item = itemAt(c.path, c.line);
  if (debug) await debugTest(project, item ?? c.path);
  else await runTests(requestFor(project, item ?? c.path));
}

// ---------------- editor marks ----------------

const marks = new WeakMap<monaco.editor.ITextModel, string[]>();

/** First line of an error, short enough to sit at the end of a code line. */
function inlineError(message: string): string {
  const first =
    message
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !/^at\s|^❯|^\s*$/.test(l)) ?? message;
  return first.length > 120 ? `${first.slice(0, 120)}…` : first;
}

function paint(model: monaco.editor.ITextModel): void {
  if (model.isDisposed()) return;
  const path = modelPath(model);
  const items = path ? (view.discovery?.items ?? []).filter((i) => i.file === path) : [];
  const decos: monaco.editor.IModelDeltaDecoration[] = [];
  const failLines = new Set<number>();
  const lines = model.getLineCount();
  for (const item of items) {
    if (item.line > lines) continue;
    const st = view.pending.has(item.id) ? 'running' : (view.status.get(item.id) ?? 'idle');
    const failures = st === 'failed' ? resultsOf(item).filter((r) => r.status === 'failed') : [];
    const fail = failures[0];
    const label =
      st === 'running'
        ? t('teRunning')
        : st === 'passed'
          ? t('tePassed')
          : st === 'failed'
            ? t('teFailed')
            : st === 'skipped'
              ? t('teSkipped')
              : t('teNotRun');
    const hint = st === 'running' ? '' : `\n\n${t('teGutterHint')}`;
    decos.push({
      range: new monaco.Range(item.line, 1, item.line, 1),
      options: {
        glyphMarginClassName: `te-mark te-${st}`,
        glyphMargin: { position: monaco.editor.GlyphMarginLane.Right },
        glyphMarginHoverMessage: {
          value: fail?.message
            ? `**${label}**\n\n\`\`\`\n${fail.message.slice(0, 1500)}\n\`\`\`${hint}`
            : `**${label}**${hint}`,
        },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    });
    // Where it broke: the assertion line, underlined, with the error at the end of the line.
    if (item.kind !== 'test') continue;
    for (const f of failures) {
      const at = f.failLine;
      if (!at || at > lines || failLines.has(at) || !f.message) continue;
      failLines.add(at);
      const end = model.getLineMaxColumn(at);
      const start = Math.max(1, model.getLineFirstNonWhitespaceColumn(at));
      decos.push({
        range: new monaco.Range(at, start, at, end),
        options: {
          className: 'te-fail-range',
          hoverMessage: {
            value: `**${t('teFailed')}**\n\n\`\`\`\n${f.message.slice(0, 1500)}\n\`\`\``,
          },
          after: { content: `   ✗ ${inlineError(f.message)}`, inlineClassName: 'te-fail-inline' },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }
  }
  marks.set(model, model.deltaDecorations(marks.get(model) ?? [], decos));
}

/** Whether a mouse event is on the test lane of the glyph margin (not the breakpoints'). */
export function onTestLane(e: monaco.editor.IEditorMouseEvent): boolean {
  if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return false;
  const lane = (e.target.detail as { glyphMarginLane?: monaco.editor.GlyphMarginLane })
    .glyphMarginLane;
  return lane === monaco.editor.GlyphMarginLane.Right;
}

/** Click on ▶ / ✓ / ✗ next to a test: run it (Alt: debug it). */
function attachGutter(ed: monaco.editor.ICodeEditor): void {
  ed.onMouseDown((e) => {
    if (!onTestLane(e) || e.event.rightButton) return;
    const model = ed.getModel();
    const path = model && modelPath(model);
    const line = e.target.position?.lineNumber;
    if (!path || !line) return;
    const item = (view.discovery?.items ?? []).find((i) => i.file === path && i.line === line);
    const project = item && projectOf(path);
    if (!item || !project) return;
    e.event.preventDefault();
    if (e.event.altKey) void debugTest(project, item);
    else void runTests(requestFor(project, item));
  });
}

let installed = false;
export function installTests(): void {
  if (installed) return;
  installed = true;
  monaco.editor.onDidCreateModel((m) => paint(m));
  monaco.editor.onDidCreateEditor((ed) => attachGutter(ed));
  for (const ed of monaco.editor.getEditors()) attachGutter(ed);
  onSaved(onFileSaved);
  api().on((ev) => {
    if (ev.type === 'workspace') {
      templates.clear();
      set({ discovery: null, summary: null, status: new Map(), output: '' });
      void discover();
      return;
    }
    if (ev.type !== 'tests') return;
    const e = ev.event;
    if (e.kind === 'state') {
      set({ running: e.running, label: e.label });
      for (const m of monaco.editor.getModels()) paint(m);
    } else if (e.kind === 'output') {
      const out = view.output + e.text;
      set({ output: out.length > MAX_OUTPUT ? out.slice(-MAX_OUTPUT) : out });
    } else if (e.kind === 'done') {
      set({ summary: e.merged, pending: new Set() });
      recompute();
    }
  });
  if (getState().workspace) void discover();
}
