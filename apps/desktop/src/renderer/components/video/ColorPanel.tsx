/**
 * Fase 12: the Color tab. Lift / gamma / gain (a master amount and a push per channel), white
 * balance, a .cube LUT with its strength, and quick styles. Edits every selected visual clip;
 * the values shown are the first one's. Drags fold into one undo step (commitMerged).
 */
import { useEffect, useReducer } from 'react';
import type { Clip, VideoProject } from '../../../shared/video';
import { isText, setGrade, trackOf } from '../../../shared/video';
import type { ColorGrade, Wheel, WheelKey, WheelName } from '../../../shared/videoColor';
import { GRADE_PRESETS, WHEELS, WHEEL_KEYS, cleanGrade } from '../../../shared/videoColor';
import { api, toast } from '../../store';
import { loadLut, lutState, onLutLoaded, reloadLut } from './colorGrade';
import { CurvesBlock } from './CurvesBlock';
import { type ProKey, tp } from './proStrings';
import { commit, commitMerged, getV, useV } from './videoStore';
import './color.css';

function targetsOf(p: VideoProject, sel: readonly string[]): Clip[] {
  return p.clips.filter(
    (c) => sel.includes(c.id) && !isText(c) && trackOf(p, c.trackId)?.kind === 'video',
  );
}

const WHEEL_LABEL: Record<WheelKey, ProKey> = { m: 'master', r: 'red', g: 'green', b: 'blue' };

/** Applies a change to the grade of every selected visual clip. */
function edit(patch: (g: ColorGrade) => ColorGrade, what: string, merged = true): void {
  const s = getV();
  let p = s.project;
  const targets = targetsOf(p, s.selection);
  for (const c of targets) p = setGrade(p, new Set([c.id]), patch({ ...(c.color ?? {}) }));
  (merged ? commitMerged : commit)(
    p,
    `${tp('editColor')} ${what} ${targets.map((c) => c.id).join(',')}`,
  );
}

function Row({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="vs-color-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={-1}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
      />
      <span className="vs-color-num">{Math.round(value * 100)}</span>
    </div>
  );
}

function WheelBlock({ name, wheel }: { name: WheelName; wheel: Wheel | undefined }) {
  return (
    <div className="vs-color-wheel">
      <div className="vs-color-head">
        <h4>{tp(name)}</h4>
        <button
          className="vs-color-reset"
          disabled={!wheel}
          onClick={() => edit((g) => ({ ...g, [name]: undefined }), `${name} reset`, false)}
        >
          {tp('reset')}
        </button>
      </div>
      {WHEEL_KEYS.map((k) => (
        <Row
          key={k}
          id={`vs-${name}-${k}`}
          label={tp(WHEEL_LABEL[k])}
          value={wheel?.[k] ?? 0}
          onChange={(v) => edit((g) => ({ ...g, [name]: { ...g[name], [k]: v } }), `${name}.${k}`)}
        />
      ))}
    </div>
  );
}

function LutBlock({ grade }: { grade: ColorGrade | undefined }) {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onLutLoaded(refresh), []);
  const path = grade?.lut;
  useEffect(() => {
    if (path) void loadLut(path);
  }, [path]);
  const st = path ? lutState(path) : undefined;
  const name = path ? path.split(/[\\/]/).pop() : null;
  const pick = async () => {
    const file = await api().video.pickLut();
    if (!file) return;
    reloadLut(file);
    const err = await loadLut(file);
    if (err) return toast(tp('lutError', { e: err }));
    edit((g) => ({ ...g, lut: file, lutMix: g.lutMix }), 'lut', false);
  };
  return (
    <div className="vs-color-wheel">
      <div className="vs-color-head">
        <h4>{tp('lut')}</h4>
        {path && (
          <button
            className="vs-color-reset"
            onClick={() => edit((g) => ({ ...g, lut: undefined, lutMix: undefined }), 'lut', false)}
          >
            {tp('lutRemove')}
          </button>
        )}
      </div>
      <div className="vs-color-lut">
        <span className="vs-color-file" title={path}>
          {name ?? tp('lutNone')}
          {st?.state === 'loading' && <span className="vs-dim"> · {tp('lutLoading')}</span>}
        </span>
        <button onClick={() => void pick()}>{path ? tp('lutChange') : tp('lutLoad')}</button>
      </div>
      {st?.state === 'error' && <p className="vs-color-err">{tp('lutError', { e: st.error })}</p>}
      {path && (
        <div className="vs-color-row">
          <label htmlFor="vs-lut-mix">{tp('lutMix')}</label>
          <input
            id="vs-lut-mix"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={grade?.lutMix ?? 1}
            onChange={(e) => {
              const v = Number(e.target.value);
              // 0 would drop the LUT altogether (cleanGrade): keep a sliver so it stays chosen.
              edit((g) => ({ ...g, lutMix: Math.max(0.01, v) }), 'lutMix');
            }}
            onDoubleClick={() => edit((g) => ({ ...g, lutMix: 1 }), 'lutMix')}
          />
          <span className="vs-color-num">{Math.round((grade?.lutMix ?? 1) * 100)}</span>
        </div>
      )}
    </div>
  );
}

export function ColorPanel() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const targets = targetsOf(project, selection);
  const grade = cleanGrade(targets[0]?.color);
  if (!targets.length)
    return (
      <div className="vs-fx-panel">
        <div className="vs-panel-title">{tp('colorTitle')}</div>
        <p className="vs-dim vs-note">{tp('needVisual')}</p>
      </div>
    );
  return (
    <div className="vs-fx-panel vs-color">
      <div className="vs-panel-title">{tp('colorTitle')}</div>
      <p className="vs-dim vs-note">{tp('colorHint')}</p>
      <div className="vs-color-wheel">
        <h4>{tp('presets')}</h4>
        <div className="vs-color-presets">
          {GRADE_PRESETS.map((pr) => (
            <button
              key={pr.id}
              onClick={() => {
                // A style replaces the wheels and the balance; the LUT stays.
                edit(
                  (g) => ({ ...pr.grade, lut: g.lut, lutMix: g.lutMix, curves: g.curves }),
                  pr.id,
                  false,
                );
                toast(tp('applied', { n: targets.length }));
              }}
            >
              {tp(`gp_${pr.id}` as ProKey)}
            </button>
          ))}
        </div>
      </div>
      {WHEELS.map((w) => (
        <WheelBlock key={w} name={w} wheel={grade?.[w]} />
      ))}
      <div className="vs-color-wheel">
        <div className="vs-color-head">
          <h4>{tp('balance')}</h4>
        </div>
        <Row
          id="vs-temp"
          label={tp('temperature')}
          value={grade?.temperature ?? 0}
          onChange={(v) => edit((g) => ({ ...g, temperature: v }), 'temperature')}
        />
        <Row
          id="vs-tint"
          label={tp('tint')}
          value={grade?.tint ?? 0}
          onChange={(v) => edit((g) => ({ ...g, tint: v }), 'tint')}
        />
      </div>
      <CurvesBlock
        grade={grade}
        onChange={(k, pts, merged) =>
          edit((g) => ({ ...g, curves: { ...g.curves, [k]: pts } }), `curve.${k}`, merged)
        }
      />
      <LutBlock grade={grade} />
      <div className="vs-color-foot">
        <button disabled={!grade} onClick={() => edit(() => ({}), 'reset', false)}>
          {tp('resetAll')}
        </button>
      </div>
    </div>
  );
}
