import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getDoc, openFile, save, toast } from '../../store';
import { errText } from '../../errText';
import { askAgent } from '../Chat';
import { Icon } from '../Icon';
import {
  coerceParam,
  parseScadParams,
  scadLiteral,
  type CadFormat,
  type ScadMessage,
  type ScadParam,
  type ScadValue,
} from '../../../shared/cad';
import { analyzeMesh, parseStl, type MeshReport } from '../../../shared/mesh3d';
import { MeshViewer, type ViewName } from './meshViewer';
import { BEDS, PrintCheck } from './PrintCheck';
import { SliceBox } from './SliceBox';
import { ViewTools } from './ViewTools';
import { tc } from './cadStrings';
import './cad.css';

const WIDTH_KEY = 'zs.cad.width';
const AUTO_KEY = 'zs.cad.auto';
/** Above this the print check would take too long in the window. */
const MAX_ANALYZE = 600_000;

interface RenderState {
  busy: boolean;
  error?: string;
  messages: ScadMessage[];
  ms?: number;
  engine?: 'native' | 'builtin';
  report?: MeshReport | null;
}

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Same separators as the tab paths (OpenSCAD may mix them). */
function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/[\\/]+/g, '/').toLowerCase();
  return n(a) === n(b);
}

/**
 * Fase 7: the 3D view of the .scad open in the editor, beside the code (same text model, so
 * Ctrl+Z and Ctrl+S are the editor's). It renders on F6, on save, and while typing in Auto.
 */
export function CadPreview({ path, onHide }: { path: string; onHide: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<MeshViewer | null>(null);
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 0);
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) !== '0');
  const [st, setSt] = useState<RenderState>({ busy: false, messages: [] });
  const [params, setParams] = useState<ScadParam[]>([]);
  const [values, setValues] = useState<Record<string, ScadValue>>({});
  const [wire, setWire] = useState(false);
  const [bed, setBed] = useState(BEDS[0]!);
  const [open, setOpen] = useState({ params: true, msgs: true, print: true, slice: false });
  const [exporting, setExporting] = useState(false);
  const [shown, setShown] = useState(0);
  const first = useRef(true);
  const seq = useRef(0);
  const key = useMemo(() => `preview:${path}`, [path]);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    if (!host.current) return;
    const v = new MeshViewer(host.current);
    viewer.current = v;
    return () => {
      v.dispose();
      viewer.current = null;
    };
  }, []);

  const render = useCallback(async () => {
    const doc = getDoc(path);
    if (!doc) return;
    const code = doc.model.getValue();
    setParams(parseScadParams(code));
    const n = ++seq.current;
    setSt((s) => ({ ...s, busy: true }));
    try {
      const r = await api().cad.render(key, path, code, valuesRef.current);
      if (n !== seq.current) return;
      if (!r.ok) {
        if (r.cancelled) return;
        setSt({ busy: false, error: r.error, messages: r.messages });
        return;
      }
      const tris = parseStl(r.stl);
      viewer.current?.setTris(tris, first.current);
      first.current = false;
      setShown((n) => n + 1);
      const report = tris.length / 9 <= MAX_ANALYZE ? analyzeMesh(tris) : null;
      setSt({ busy: false, messages: r.messages, ms: r.ms, engine: r.engine, report });
    } catch (e) {
      if (n === seq.current) setSt({ busy: false, error: errText(e), messages: [] });
    }
  }, [key, path]);

  // First render, re-render on edits (Auto) and on save.
  useEffect(() => {
    first.current = true;
    setValues({});
    void render();
    const doc = getDoc(path);
    if (!doc) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const sub = doc.model.onDidChangeContent(() => {
      setParams(parseScadParams(doc.model.getValue()));
      if (!autoRef.current) return;
      clearTimeout(t);
      t = setTimeout(() => void render(), 900);
    });
    return () => {
      sub.dispose();
      clearTimeout(t);
      void api().cad.cancel(key);
    };
  }, [path, key, render]);

  const autoRef = useRef(auto);
  autoRef.current = auto;

  // F6 renders; so does saving (Ctrl+S) when Auto is off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F6') {
        e.preventDefault();
        void render();
      } else if (!autoRef.current && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')
        setTimeout(() => void render(), 50);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [render]);

  // Parameter changes re-render right away (they do not touch the file).
  const firstValues = useRef(true);
  useEffect(() => {
    if (firstValues.current) {
      firstValues.current = false;
      return;
    }
    const t = setTimeout(() => void render(), 250);
    return () => clearTimeout(t);
  }, [values, render]);

  useEffect(() => viewer.current?.setWire(wire), [wire]);
  useEffect(() => viewer.current?.setBed([bed.size[0], bed.size[1]]), [bed]);

  const setValue = (p: ScadParam, raw: unknown) => {
    const v = coerceParam(p, raw);
    if (v === null) return;
    setValues((old) => ({ ...old, [p.name]: v }));
  };

  /** Writes the changed values into the file (one undo step in the editor). */
  const saveParams = () => {
    const doc = getDoc(path);
    if (!doc) return;
    const edits = params
      .filter((p) => p.name in values)
      .map((p) => {
        const line = doc.model.getLineContent(p.line);
        const m = /^(\s*[A-Za-z_$][\w$]*\s*=\s*)(.+?)(\s*;.*)$/.exec(line);
        if (!m) return null;
        return {
          range: {
            startLineNumber: p.line,
            startColumn: m[1]!.length + 1,
            endLineNumber: p.line,
            endColumn: m[1]!.length + m[2]!.length + 1,
          },
          text: scadLiteral(values[p.name]!),
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e);
    if (!edits.length) return;
    doc.model.pushEditOperations([], edits, () => null);
    setValues({});
    // Into the file on disk too (Ctrl+Z in the editor still undoes it).
    void save(path, false).catch((e: unknown) => toast(errText(e)));
  };

  const exportAs = async (fmt: CadFormat) => {
    const doc = getDoc(path);
    if (!doc) return;
    setExporting(true);
    try {
      const r = await api().cad.export(path, doc.model.getValue(), values, fmt);
      if (r) toast(tc('exported', { file: base(r.path) }));
    } catch (e) {
      toast(`${tc('error')}: ${errText(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    const pane = (e.currentTarget as HTMLElement).parentElement!;
    const area = pane.parentElement!;
    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => {
      const w = Math.min(area.clientWidth - 200, Math.max(260, startW - (ev.clientX - startX)));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((w) => (localStorage.setItem(WIDTH_KEY, String(Math.round(w))), w));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const errors = st.messages.filter((m) => m.severity === 'error');
  const listed = st.messages.filter((m) => m.severity !== 'trace').slice(0, 60);
  const groups = useMemo(() => {
    const g = new Map<string, ScadParam[]>();
    for (const p of params) g.set(p.group ?? '', [...(g.get(p.group ?? '') ?? []), p]);
    return [...g];
  }, [params]);
  const changed = Object.keys(values).length > 0;
  const views: [ViewName, string][] = [
    ['iso', tc('viewIso')],
    ['front', tc('viewFront')],
    ['right', tc('viewRight')],
    ['top', tc('viewTop')],
  ];

  const goTo = (m: ScadMessage) => {
    if (!m.line) return;
    // Main gives project files relative to it (absolute = outside the project: stay on this one).
    const file =
      m.file && !samePath(m.file, path) && !/^([a-z]:|[\\/])/i.test(m.file) ? m.file : path;
    void openFile(file, { line: m.line, column: 1 });
  };

  return (
    <aside
      className="cad-pane"
      style={width ? ({ '--cad-w': `${width}px` } as React.CSSProperties) : undefined}
      aria-label={tc('preview')}
    >
      <div
        className="cad-split"
        onPointerDown={startDrag}
        role="separator"
        aria-orientation="vertical"
      />
      <div className="cad-toolbar">
        <strong className="cad-title">{tc('preview')}</strong>
        <span className="cad-status" aria-live="polite">
          {st.busy
            ? tc('rendering')
            : st.ms !== undefined && !st.error
              ? tc('renderedIn', {
                  s: (st.ms / 1000).toFixed(1),
                  engine: st.engine === 'native' ? tc('native') : tc('builtin'),
                })
              : ''}
        </span>
        <span className="cad-grow" />
        {st.busy ? (
          <button className="btn ghost cad-small" onClick={() => void api().cad.cancel(key)}>
            {tc('cancel')}
          </button>
        ) : (
          <button
            className="btn ghost cad-small"
            title={tc('renderHint')}
            onClick={() => void render()}
          >
            <Icon name="refresh" /> {tc('render')}
          </button>
        )}
        <label className="cad-check" title={tc('autoHint')}>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0');
            }}
          />
          {tc('auto')}
        </label>
        <button className="icon-btn" title={tc('hide')} aria-label={tc('hide')} onClick={onHide}>
          <Icon name="x" />
        </button>
      </div>
      <div className="cad-view-wrap">
        <div className="cad-view" ref={host} />
        <div className="cad-view-btns">
          {views.map(([v, label]) => (
            <button key={v} className="btn ghost cad-small" onClick={() => viewer.current?.view(v)}>
              {label}
            </button>
          ))}
          <label className="cad-check">
            <input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} />
            {tc('wire')}
          </label>
          <ViewTools viewer={viewer} version={shown} />
        </div>
        {st.error && (
          <div className="cad-error" role="alert">
            <strong>{tc('error')}</strong>
            <span>{st.error}</span>
          </div>
        )}
      </div>
      <div className="cad-side">
        <section className="cad-sec">
          <button
            className="cad-sec-head"
            aria-expanded={open.params}
            onClick={() => setOpen((o) => ({ ...o, params: !o.params }))}
          >
            <Icon name={open.params ? 'chevronDown' : 'chevron'} /> {tc('params')}{' '}
            {params.length ? `(${params.length})` : ''}
          </button>
          {open.params &&
            (params.length ? (
              <div className="cad-params">
                {groups.map(([g, ps]) => (
                  <fieldset key={g || '-'} className="cad-group">
                    {g && <legend>{g}</legend>}
                    {ps.map((p) => (
                      <ParamRow
                        key={p.name}
                        p={p}
                        value={p.name in values ? values[p.name]! : p.value}
                        changed={p.name in values}
                        onChange={(v) => setValue(p, v)}
                      />
                    ))}
                  </fieldset>
                ))}
                {changed && (
                  <div className="cad-params-actions">
                    <span className="cad-hint">{tc('paramsChanged')}</span>
                    <button className="btn cad-small" onClick={saveParams}>
                      {tc('saveParams')}
                    </button>
                    <button className="btn ghost cad-small" onClick={() => setValues({})}>
                      {tc('resetParams')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="cad-hint">{tc('noParams')}</p>
            ))}
        </section>
        {listed.length > 0 && (
          <section className="cad-sec">
            <button
              className="cad-sec-head"
              aria-expanded={open.msgs}
              onClick={() => setOpen((o) => ({ ...o, msgs: !o.msgs }))}
            >
              <Icon name={open.msgs ? 'chevronDown' : 'chevron'} /> {tc('problems')} (
              {listed.length})
            </button>
            {open.msgs && (
              <>
                <ul className="cad-msgs">
                  {listed.map((m, i) => (
                    <li key={i}>
                      <button
                        className={`cad-msg ${m.severity}`}
                        onClick={() => goTo(m)}
                        disabled={!m.line}
                      >
                        <span className="cad-msg-kind">
                          {m.severity === 'echo' ? (
                            'ECHO'
                          ) : (
                            <Icon name={m.severity === 'error' ? 'close' : 'warning'} size={14} />
                          )}
                        </span>
                        <span className="cad-msg-text">{m.message}</span>
                        {m.line ? (
                          <span className="cad-msg-line">{tc('line', { n: m.line })}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
                {errors.length > 0 && (
                  <button
                    className="btn ghost cad-small"
                    onClick={() =>
                      askAgent(
                        tc('fixAiPrompt', {
                          file: base(path),
                          errors: errors
                            .map(
                              (e) =>
                                `- ${e.line ? `${tc('line', { n: e.line })}: ` : ''}${e.message}`,
                            )
                            .join('\n'),
                        }),
                      )
                    }
                  >
                    <Icon name="sparkle" size={13} /> {tc('fixAi')}
                  </button>
                )}
              </>
            )}
          </section>
        )}
        {st.report !== undefined && !st.error && (
          <section className="cad-sec">
            <button
              className="cad-sec-head"
              aria-expanded={open.print}
              onClick={() => setOpen((o) => ({ ...o, print: !o.print }))}
            >
              <Icon name={open.print ? 'chevronDown' : 'chevron'} /> {tc('print')}
            </button>
            {open.print && (
              <>
                <PrintCheck report={st.report ?? null} units="mm" bed={bed.size} />
                <label className="cad-field">
                  <span>{tc('bed')}</span>
                  <select
                    value={bed.id}
                    onChange={(e) => setBed(BEDS.find((b) => b.id === e.target.value) ?? BEDS[0]!)}
                  >
                    {BEDS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label} mm
                      </option>
                    ))}
                  </select>
                </label>
                <div className="cad-export">
                  <span>{exporting ? tc('exporting') : tc('export')}</span>
                  {(['stl', '3mf', 'obj'] as CadFormat[]).map((f) => (
                    <button
                      key={f}
                      className="btn ghost cad-small"
                      disabled={exporting || !!st.error}
                      onClick={() => void exportAs(f)}
                    >
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {st.report !== undefined && !st.error && (
          <section className="cad-sec">
            <button
              className="cad-sec-head"
              aria-expanded={open.slice}
              onClick={() => setOpen((o) => ({ ...o, slice: !o.slice }))}
            >
              <Icon name={open.slice ? 'chevronDown' : 'chevron'} /> {tc('slice')}
            </button>
            {open.slice && (
              <SliceBox
                path={path}
                code={() => getDoc(path)?.model.getValue() ?? null}
                values={values}
              />
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function ParamRow({
  p,
  value,
  changed,
  onChange,
}: {
  p: ScadParam;
  value: ScadValue;
  changed: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `cadp-${p.name}`;
  const label = (
    <label htmlFor={id} className="cad-param-name" title={p.description ?? p.name}>
      {p.description ?? p.name}
      {changed ? ' •' : ''}
    </label>
  );
  if (p.options)
    return (
      <div className="cad-param">
        {label}
        <select
          id={id}
          value={String(value)}
          onChange={(e) => onChange(p.type === 'number' ? Number(e.target.value) : e.target.value)}
        >
          {p.options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  if (p.type === 'boolean')
    return (
      <div className="cad-param">
        {label}
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
    );
  if (p.type === 'number') {
    const ranged = p.min !== undefined && p.max !== undefined;
    return (
      <div className="cad-param">
        {label}
        <div className="cad-num">
          {ranged && (
            <input
              type="range"
              aria-label={p.name}
              min={p.min}
              max={p.max}
              step={p.step ?? ((p.max! - p.min!) / 100 || 1)}
              value={value as number}
              onChange={(e) => onChange(Number(e.target.value))}
            />
          )}
          <input
            id={id}
            type="number"
            min={p.min}
            max={p.max}
            step={p.step ?? 'any'}
            value={value as number}
            onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))}
          />
        </div>
      </div>
    );
  }
  if (p.type === 'vector')
    return (
      <div className="cad-param">
        {label}
        <input
          id={id}
          defaultValue={(value as number[]).join(', ')}
          onBlur={(e) => {
            const nums = e.target.value.split(',').map((x) => Number(x.trim()));
            if (nums.every(Number.isFinite)) onChange(nums);
          }}
        />
      </div>
    );
  return (
    <div className="cad-param">
      {label}
      <input
        id={id}
        value={value as string}
        maxLength={p.maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
