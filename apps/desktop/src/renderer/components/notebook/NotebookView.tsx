import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import { monaco } from '../../monaco';
import { confirmDialog } from '../../confirm';
import { openFile, openLargeInEditor, toast, useStore } from '../../store';
import { askAgent } from '../Chat';
import { Icon } from '../Icon';
import { Markdown } from '../Markdown';
import { runInTerminal } from '../Terminal';
import { JUPYTER_INSTALL } from '../../../shared/notebook';
import { OutputView } from './NotebookOutputs';
import { installCellIntellisense } from './cellIntellisense';
import {
  addCell,
  cellErrorText,
  cellModel,
  checkJupyter,
  clearOutputs,
  deleteCell,
  exportScript,
  getDoc,
  installNotebooks,
  interrupt,
  jupyterState,
  loadVariables,
  moveCell,
  openNotebook,
  restart,
  runAll,
  runCells,
  runFrom,
  saveNotebook,
  select,
  setCellType,
  setEditing,
  subscribe,
  subscribeJupyter,
  subscribeVariablesShown,
  toggleCollapsed,
  toggleVariables,
  variablesShown,
  type NbDoc,
  type UiCell,
} from './notebookModel';
import { tn, type KeyNb } from './notebookStrings';
import './notebook.css';

/**
 * Jupyter notebook view (Fase 2A del plan de funciones): code and text cells, run one or all
 * on a local kernel, outputs (text, tables, pictures, HTML, errors) under each cell.
 * Keys like Jupyter: Shift+Enter runs and moves on, Ctrl+Enter runs, Alt+Enter runs and adds
 * a cell; outside the editor A / B add above / below, D D deletes, M / Y switch text / code.
 */
export function NotebookView({ path }: { path: string }) {
  useEffect(() => {
    installNotebooks();
    installCellIntellisense();
    void openNotebook(path);
  }, [path]);
  const doc = useSyncExternalStore(
    useCallback((fn) => subscribe(path, fn), [path]),
    () => getDoc(path),
  );
  const jup = useSyncExternalStore(subscribeJupyter, jupyterState);
  const showVars = useSyncExternalStore(subscribeVariablesShown, variablesShown);

  if (!doc || (!doc.nb && !doc.error)) return <div className="nb-msg">{tn('loading')}</div>;
  if (doc.error)
    return (
      <div className="nb-msg">
        <p>{tn('broken', { err: doc.error })}</p>
        <button
          className="btn"
          onClick={() => void openLargeInEditor(path).catch((e: Error) => toast(e.message))}
        >
          {tn('openAsText')}
        </button>
      </div>
    );
  return (
    <div className="notebook">
      <Toolbar doc={doc} />
      {jup && !jup.status.ok && <MissingJupyter reason={jup.status.reason} python={jup.python} />}
      <div className="nb-body">
        <Cells doc={doc} />
        {showVars && <VariablesPanel doc={doc} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ variables

function VariablesPanel({ doc }: { doc: NbDoc }) {
  const [filter, setFilter] = useState('');
  const live = doc.kernel !== 'off' && doc.kernel !== 'dead';
  // Opening the panel (or a notebook with it open) asks once.
  useEffect(() => {
    if (live && doc.variables === null && !doc.variablesLoading) void loadVariables(doc.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, live]);
  const f = filter.trim().toLowerCase();
  const list = (doc.variables ?? []).filter(
    (v) => !f || v.name.toLowerCase().includes(f) || v.type.toLowerCase().includes(f),
  );
  const notPython =
    live &&
    doc.variables === null &&
    !doc.variablesLoading &&
    doc.kernelLabel &&
    !/python/i.test(doc.kernelLabel);
  return (
    <aside className="nb-vars" aria-label={tn('variables')}>
      <div className="nb-vars-head">
        <span className="nb-vars-title">{tn('variables')}</span>
        {doc.variables && <span className="nb-vars-count">{doc.variables.length}</span>}
        <div className="nb-spacer" />
        <button
          className="nb-mini"
          title={tn('varsRefresh')}
          aria-label={tn('varsRefresh')}
          disabled={!live || doc.variablesLoading}
          onClick={() => void loadVariables(doc.path)}
        >
          <Icon name="refresh" size={12} />
        </button>
        <button
          className="nb-mini"
          title={tn('collapse')}
          aria-label={tn('collapse')}
          onClick={() => toggleVariables(doc.path)}
        >
          ✕
        </button>
      </div>
      {doc.variables && doc.variables.length > 8 && (
        <input
          className="nb-vars-filter"
          placeholder={tn('varsFilter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className="nb-vars-list">
        {!live ? (
          <div className="nb-vars-empty">{tn('varsNoKernel')}</div>
        ) : notPython ? (
          <div className="nb-vars-empty">{tn('varsNotPython')}</div>
        ) : doc.variables === null ? (
          <div className="nb-vars-empty">
            {doc.variablesLoading ? tn('loading') : tn('varsNoKernel')}
          </div>
        ) : !doc.variables.length ? (
          <div className="nb-vars-empty">{tn('varsEmpty')}</div>
        ) : (
          <table className="nb-vars-table">
            <thead>
              <tr>
                <th>{tn('varsName')}</th>
                <th>{tn('varsType')}</th>
                <th>{tn('varsSize')}</th>
                <th>{tn('varsValue')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.name}>
                  <td className="nb-var-name">
                    <button
                      title={tn('varsInsert')}
                      onClick={() =>
                        void navigator.clipboard.writeText(v.name).then(() => toast(tn('copied')))
                      }
                    >
                      {v.name}
                    </button>
                  </td>
                  <td className="nb-var-type" title={v.type}>
                    {v.type}
                  </td>
                  <td className="nb-var-size">{v.shape || (v.size >= 0 ? String(v.size) : '')}</td>
                  <td className="nb-var-value" title={v.value}>
                    {v.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ toolbar

const STATE_KEY: Record<NbDoc['kernel'], KeyNb> = {
  off: 'stOff',
  idle: 'stIdle',
  busy: 'stBusy',
  starting: 'stStarting',
  restarting: 'stRestarting',
  dead: 'stDead',
};

function Toolbar({ doc }: { doc: NbDoc }) {
  const { path } = doc;
  const live = doc.kernel !== 'off' && doc.kernel !== 'dead';
  const running = doc.cells.some((c) => c.run !== 'idle');
  const after = doc.selected;
  return (
    <div className="nb-toolbar" role="toolbar">
      <button
        className="nb-tb"
        title={tn('save')}
        disabled={doc.version === doc.saved}
        onClick={() => void saveNotebook(path)}
      >
        <Icon name="download" size={14} />
      </button>
      <span className="nb-sep" />
      <button className="nb-tb" onClick={() => addCell(path, 'code', after)}>
        {tn('addCode')}
      </button>
      <button className="nb-tb" onClick={() => addCell(path, 'markdown', after)}>
        {tn('addMarkdown')}
      </button>
      <span className="nb-sep" />
      <button className="nb-tb" title={tn('runAll')} onClick={() => void runAll(path)}>
        <Icon name="play" size={14} /> {tn('runAll')}
      </button>
      <button
        className="nb-tb"
        title={tn('interrupt')}
        disabled={!running}
        onClick={() => void interrupt(path)}
      >
        <Icon name="stop" size={14} />
      </button>
      <button
        className="nb-tb"
        title={tn('restart')}
        disabled={!live}
        onClick={async () => {
          if (await confirmDialog(tn('restartAsk'), { danger: true })) await restart(path);
        }}
      >
        <Icon name="refresh" size={14} />
      </button>
      <button
        className="nb-tb"
        title={tn('restartRun')}
        onClick={async () => {
          if (live && !(await confirmDialog(tn('restartAsk'), { danger: true }))) return;
          if (live) await restart(path);
          await runAll(path);
        }}
      >
        <Icon name="refresh" size={14} />
        <Icon name="play" size={12} />
      </button>
      <button className="nb-tb" onClick={() => clearOutputs(path)}>
        {tn('clearAll')}
      </button>
      <span className="nb-sep" />
      <VarsToggle path={path} />
      <button
        className="nb-tb"
        title={tn('exportPy')}
        onClick={async () => {
          try {
            const out = await exportScript(path, (p) =>
              confirmDialog(tn('exportAsk', { path: p })),
            );
            if (out) {
              toast(tn('exported', { path: out }));
              void openFile(out);
            }
          } catch (e) {
            toast(tn('saveFailed', { err: (e as Error).message }));
          }
        }}
      >
        <Icon name="file" size={14} /> .py
      </button>
      <div className="nb-spacer" />
      <PythonPicker />
      <span
        className={`nb-kernel nb-k-${doc.kernel}`}
        title={doc.kernelMessage ?? ''}
        role="status"
      >
        <span className="nb-dot" />
        {doc.kernelLabel ? `${doc.kernelLabel} · ` : ''}
        {tn(STATE_KEY[doc.kernel])}
      </span>
    </div>
  );
}

function VarsToggle({ path }: { path: string }) {
  const on = useSyncExternalStore(subscribeVariablesShown, variablesShown);
  return (
    <button
      className={`nb-tb ${on ? 'on' : ''}`}
      title={tn('variablesTip')}
      aria-pressed={on}
      onClick={() => toggleVariables(path)}
    >
      {'{x}'} {tn('variables')}
    </button>
  );
}

function PythonPicker() {
  const jup = useSyncExternalStore(subscribeJupyter, jupyterState);
  const [list, setList] = useState<
    { cmd: string; label: string; ok: boolean; version?: string }[] | null
  >(null);
  const load = () => {
    if (!list)
      void window.omni.notebook
        .interpreters()
        .then(setList)
        .catch(() => setList([]));
  };
  const current = jup?.python ?? '';
  const options =
    list ?? (current ? [{ cmd: current, label: current, ok: jup?.status.ok ?? false }] : []);
  return (
    <select
      className="nb-python"
      title={tn('python')}
      aria-label={tn('python')}
      value={current}
      onFocus={load}
      onMouseDown={load}
      onChange={async (e) => {
        const cmd = e.target.value || null;
        await window.omni.notebook.usePython(cmd);
        await checkJupyter(true);
        toast(tn('pythonChanged'));
      }}
    >
      <option value="">{tn('pythonAuto')}</option>
      {options.map((p) => (
        <option key={p.cmd} value={p.cmd}>
          {short(p.cmd)}
          {p.version ? ` · Jupyter ${p.version}` : p.ok ? '' : ` (${tn('pythonMissing')})`}
        </option>
      ))}
    </select>
  );
}

/** The last folders of an interpreter path (C:\…\proj\.venv\Scripts\python.exe → .venv\Scripts\python.exe). */
function short(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts.length > 3 ? `…${p.slice(p.length - parts.slice(-3).join('/').length - 1)}` : p;
}

function MissingJupyter({
  reason,
  python,
}: {
  reason: 'no-python' | 'no-jupyter';
  python: string | null;
}) {
  const cmd =
    python && reason === 'no-jupyter'
      ? `"${python}" -m pip install jupyter_server ipykernel`
      : JUPYTER_INSTALL;
  return (
    <div className="nb-missing" role="alert">
      <Icon name="warning" size={16} />
      <div>
        <div>{tn(reason === 'no-python' ? 'noPython' : 'noJupyter')}</div>
        <code className="nb-cmd">{cmd}</code>
        <div className="nb-missing-btns">
          <button className="btn" onClick={() => void runInTerminal(cmd)}>
            {tn('installTerm')}
          </button>
          <button
            className="btn ghost"
            onClick={() => void navigator.clipboard.writeText(cmd).then(() => toast(tn('copied')))}
          >
            {tn('copyCmd')}
          </button>
          <button className="btn ghost" onClick={() => void checkJupyter(true)}>
            {tn('recheck')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ cells

function Cells({ doc }: { doc: NbDoc }) {
  const { path } = doc;
  const list = useRef<HTMLDivElement>(null);
  const lastD = useRef(0);
  const prefs = useStore((s) => s.prefs);

  /** Focuses the cell box (command mode) or its editor. */
  const focusCell = (uid: string | null, edit = false) => {
    if (!uid) return;
    requestAnimationFrame(() => {
      const el = list.current?.querySelector<HTMLElement>(`[data-uid="${CSS.escape(uid)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'nearest' });
      if (edit) editors.get(`${path}\u0000${uid}`)?.focus();
      else el.focus();
    });
  };

  const run = (uid: string, then: 'stay' | 'next' | 'insert') => {
    const d = getDoc(path);
    if (!d) return;
    const c = d.cells.find((x) => x.uid === uid);
    if (c?.cell.cell_type === 'markdown') setEditing(path, uid, false);
    else void runCells(path, [uid]);
    if (then === 'stay') return;
    const i = d.cells.findIndex((x) => x.uid === uid);
    const next = d.cells[i + 1];
    if (then === 'insert' || !next) {
      const id = addCell(path, 'code', uid);
      focusCell(id, true);
    } else {
      select(path, next.uid);
      focusCell(next.uid, next.cell.cell_type === 'code');
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, c: UiCell) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && (e.shiftKey || mod || e.altKey)) {
      e.preventDefault();
      e.stopPropagation();
      run(c.uid, e.shiftKey ? 'next' : e.altKey ? 'insert' : 'stay');
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      void saveNotebook(path);
      return;
    }
    // Command mode: only when the cell box itself has the focus (not its editor).
    if (e.target !== e.currentTarget || mod || e.altKey) return;
    const d = getDoc(path);
    if (!d) return;
    const i = d.cells.findIndex((x) => x.uid === c.uid);
    const k = e.key.toLowerCase();
    const go = (j: number) => {
      const t = d.cells[j];
      if (!t) return;
      select(path, t.uid);
      focusCell(t.uid);
    };
    if (k === 'arrowup' || k === 'k') go(i - 1);
    else if (k === 'arrowdown' || k === 'j') go(i + 1);
    else if (k === 'enter') {
      if (c.cell.cell_type === 'markdown') setEditing(path, c.uid, true);
      focusCell(c.uid, true);
    } else if (k === 'a' || k === 'b') {
      const before = k === 'a' ? (d.cells[i - 1]?.uid ?? null) : c.uid;
      const id =
        k === 'a' && i === 0
          ? (() => {
              const nid = addCell(path, 'code', c.uid);
              if (nid) moveCell(path, nid, -1);
              return nid;
            })()
          : addCell(path, 'code', before);
      focusCell(id);
    } else if (k === 'd') {
      if (Date.now() - lastD.current < 600) {
        deleteCell(path, c.uid);
        lastD.current = 0;
        focusCell(getDoc(path)?.selected ?? null);
      } else lastD.current = Date.now();
    } else if (k === 'm') setCellType(path, c.uid, 'markdown');
    else if (k === 'y') setCellType(path, c.uid, 'code');
    else return;
    e.preventDefault();
  };

  return (
    <div className="nb-cells" ref={list} style={{ fontSize: prefs.fontSize }}>
      {doc.cells.map((c, i) => (
        <Cell
          key={c.uid}
          path={path}
          c={c}
          first={i === 0}
          last={i === doc.cells.length - 1}
          selected={doc.selected === c.uid}
          fontSize={prefs.fontSize}
          fontFamily={prefs.fontFamily}
          onKey={(e) => onKey(e, c)}
          onRun={() => run(c.uid, 'stay')}
          onRunKey={(then) => run(c.uid, then)}
        />
      ))}
      <div className="nb-add-end">
        <button className="nb-tb" onClick={() => focusCell(addCell(path, 'code', null), true)}>
          {tn('addCode')}
        </button>
        <button className="nb-tb" onClick={() => focusCell(addCell(path, 'markdown', null), true)}>
          {tn('addMarkdown')}
        </button>
      </div>
    </div>
  );
}

function Cell({
  path,
  c,
  first,
  last,
  selected,
  fontSize,
  fontFamily,
  onKey,
  onRun,
  onRunKey,
}: {
  path: string;
  c: UiCell;
  first: boolean;
  last: boolean;
  selected: boolean;
  fontSize: number;
  fontFamily: string;
  onKey: (e: KeyboardEvent<HTMLDivElement>) => void;
  onRun: () => void;
  onRunKey: (then: 'stay' | 'next' | 'insert') => void;
}) {
  const type = c.cell.cell_type;
  const outputs = c.run === 'idle' ? c.cell.outputs : c.out.outputs;
  const count =
    c.run !== 'idle'
      ? '*'
      : type === 'code' && c.cell.execution_count != null
        ? String(c.cell.execution_count)
        : ' ';
  const showMd = type === 'markdown' && !c.editing;
  return (
    <div
      className={`nb-cell nb-${type} ${selected ? 'selected' : ''} ${c.run !== 'idle' ? 'running' : ''}`}
      data-uid={c.uid}
      tabIndex={selected ? 0 : -1}
      onKeyDown={onKey}
      onMouseDown={() => !selected && select(path, c.uid)}
    >
      <div className="nb-gutter">
        {type === 'code' ? (
          <>
            <button className="nb-run" title={tn('run')} aria-label={tn('run')} onClick={onRun}>
              <Icon name={c.run === 'idle' ? 'play' : 'clock'} size={13} />
            </button>
            <span className="nb-count">[{count}]</span>
            <CellTime c={c} />
          </>
        ) : null}
      </div>
      <div className="nb-main">
        <div className="nb-actions">
          {!first && (
            <button
              className="nb-mini"
              title={tn('runAboveShort')}
              onClick={() => void runFrom(path, c.uid, 'above')}
            >
              <Icon name="arrowDown" size={12} className="nb-flip" />
            </button>
          )}
          <button
            className="nb-mini"
            title={tn('runBelow')}
            onClick={() => void runFrom(path, c.uid, 'below')}
          >
            <Icon name="arrowDown" size={12} />
          </button>
          <button
            className="nb-mini"
            title={tn('moveUp')}
            disabled={first}
            onClick={() => moveCell(path, c.uid, -1)}
          >
            ▲
          </button>
          <button
            className="nb-mini"
            title={tn('moveDown')}
            disabled={last}
            onClick={() => moveCell(path, c.uid, 1)}
          >
            ▼
          </button>
          <button
            className="nb-mini"
            title={type === 'code' ? tn('toMarkdown') : tn('toCode')}
            onClick={() => setCellType(path, c.uid, type === 'code' ? 'markdown' : 'code')}
          >
            {type === 'code' ? 'M↓' : '{}'}
          </button>
          <button className="nb-mini" title={tn('delete')} onClick={() => deleteCell(path, c.uid)}>
            <Icon name="trash" size={12} />
          </button>
        </div>
        {showMd ? (
          <div
            className="nb-md"
            title={tn('editMd')}
            onDoubleClick={() => setEditing(path, c.uid, true)}
          >
            {c.cell.source.trim() ? (
              <Markdown text={c.cell.source} />
            ) : (
              <span className="nb-empty">{tn('emptyMd')}</span>
            )}
          </div>
        ) : (
          <CellEditor
            path={path}
            uid={c.uid}
            source={c.cell.source}
            fontSize={fontSize}
            fontFamily={fontFamily}
            autoFocus={type === 'markdown' && c.editing}
            onEscape={() => {
              if (type === 'markdown') setEditing(path, c.uid, false);
            }}
            onKeys={(what) => {
              if (what === 'save') void saveNotebook(path);
              else onRunKey(what);
            }}
          />
        )}
        {type === 'code' &&
          outputs.length > 0 &&
          (c.collapsed ? (
            <button className="nb-collapsed" onClick={() => toggleCollapsed(path, c.uid)}>
              {tn('outputHidden')}
            </button>
          ) : (
            <div className="nb-outputs">
              <button
                className="nb-out-bar"
                title={tn('collapse')}
                aria-label={tn('collapse')}
                onClick={() => toggleCollapsed(path, c.uid)}
              />
              <div className="nb-out-list">
                {outputs.map((o, i) => (
                  <OutputView
                    key={i}
                    o={o}
                    onFix={
                      o.output_type === 'error' && c.run === 'idle'
                        ? () => fixWithAi(path, c)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

/** "1.2 s", "2 min 05 s". */
function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
}

/** How long the cell has been running (ticks) or took last time. */
function CellTime({ c }: { c: UiCell }) {
  const [, tick] = useState(0);
  const running = c.run === 'running' && !!c.startedAt;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [running]);
  const ms = running ? Date.now() - c.startedAt! : c.elapsed;
  if (ms === undefined) return null;
  return (
    <span
      className={`nb-time ${running ? 'live' : ''}`}
      title={running ? undefined : tn('took', { t: duration(ms) })}
    >
      {duration(ms)}
    </span>
  );
}

/** Hands a failing cell to the agent: it reads, fixes and re-runs it (approved by the user). */
function fixWithAi(path: string, c: UiCell): void {
  const d = getDoc(path);
  const n = (d?.cells.findIndex((x) => x.uid === c.uid) ?? -1) + 1;
  const err = cellErrorText(c);
  if (!err || n < 1) return;
  const clean = err.replace(/\u001b\[[0-9;]*m/g, '');
  const code = cellModel(path, c.uid)?.getValue() ?? c.cell.source;
  askAgent(
    tn('fixPrompt', {
      path,
      n,
      code: code.slice(0, 6000),
      error: clean.length > 4000 ? `…${clean.slice(clean.length - 4000)}` : clean,
    }),
  );
}

/** Editors of the open cells, to focus them from the keyboard. */
const editors = new Map<string, monaco.editor.IStandaloneCodeEditor>();

/**
 * A Monaco editor as tall as its text. Mounted when the cell scrolls into view (a long
 * notebook would otherwise build hundreds of editors at once); until then plain text.
 */
function CellEditor({
  path,
  uid,
  source,
  fontSize,
  fontFamily,
  autoFocus,
  onEscape,
  onKeys,
}: {
  path: string;
  uid: string;
  source: string;
  fontSize: number;
  fontFamily: string;
  autoFocus: boolean;
  onEscape: () => void;
  onKeys: (what: 'next' | 'stay' | 'insert' | 'save') => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(autoFocus);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  const keys = useRef(onKeys);
  keys.current = onKeys;

  useEffect(() => {
    if (visible || !host.current) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '400px' },
    );
    io.observe(host.current);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !host.current) return;
    const model = cellModel(path, uid);
    if (!model) return;
    const el = host.current;
    const ed = monaco.editor.create(el, {
      model,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 6,
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { vertical: 'hidden', alwaysConsumeMouseWheel: false, horizontalScrollbarSize: 8 },
      wordWrap: 'on',
      fontSize,
      fontFamily,
      padding: { top: 6, bottom: 6 },
      fixedOverflowWidgets: true,
    });
    const fit = () => {
      el.style.height = `${Math.max(28, ed.getContentHeight())}px`;
    };
    fit();
    const d1 = ed.onDidContentSizeChange(fit);
    const K = monaco.KeyCode;
    const M = monaco.KeyMod;
    const free = '!suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible';
    const action = (id: string, keys: number[], run: () => void, when?: string) =>
      ed.addAction({ id: `nb.${id}`, label: id, keybindings: keys, precondition: when, run });
    const d2 = [
      action('runNext', [M.Shift | K.Enter], () => keys.current('next')),
      action('runStay', [M.CtrlCmd | K.Enter], () => keys.current('stay')),
      action('runInsert', [M.Alt | K.Enter], () => keys.current('insert')),
      action('save', [M.CtrlCmd | K.KeyS], () => keys.current('save')),
      // Back to command mode (the suggest box and the find bar close first).
      action(
        'escape',
        [K.Escape],
        () => {
          escape.current();
          el.closest<HTMLElement>('.nb-cell')?.focus();
        },
        free,
      ),
    ];
    const key = `${path}\u0000${uid}`;
    editors.set(key, ed);
    if (autoFocus) ed.focus();
    return () => {
      d1.dispose();
      for (const d of d2) d.dispose();
      if (editors.get(key) === ed) editors.delete(key);
      ed.dispose(); // the model stays (notebookModel owns it)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, path, uid]);

  useEffect(() => {
    for (const [k, ed] of editors)
      if (k.startsWith(`${path}\u0000`)) ed.updateOptions({ fontSize, fontFamily });
  }, [fontSize, fontFamily, path]);

  return (
    <div className="nb-editor" ref={host}>
      {!visible && <pre className="nb-placeholder">{source || ' '}</pre>}
    </div>
  );
}
