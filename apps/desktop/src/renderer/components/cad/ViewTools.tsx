import { useEffect, useRef, useState, type RefObject } from 'react';
import { Vector3 } from 'three';
import type { Measure, MeshViewer } from './meshViewer';
import { tc } from './cadStrings';
import { Icon } from '../Icon';

const f1 = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));

/**
 * Fase 7 (mejora): measure between two points of the model and cut it at a height to see
 * inside. `version` changes when a new model is shown (the cut range and the points reset).
 */
export function ViewTools({ viewer, version, units = 'mm' }: { viewer: RefObject<MeshViewer | null>; version: unknown; units?: 'mm' | 'm' }) {
  const [measuring, setMeasuring] = useState(false);
  const [m, setM] = useState<Measure | null>(null);
  const [cutOn, setCutOn] = useState(false);
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const [cut, setCut] = useState(1);
  const k = units === 'm' ? 1000 : 1;
  const last = useRef({ range, cut, measuring });
  last.current = { range, cut, measuring };

  // New model: new height range; the cut keeps its share of the height.
  useEffect(() => {
    const b = viewer.current?.bounds();
    if (!b || b.isEmpty()) return;
    const r: [number, number] = [b.min.z, b.max.z];
    const { range: old, cut: c, measuring: on } = last.current;
    const share = old[1] > old[0] ? (c - old[0]) / (old[1] - old[0]) : 1;
    setRange(r);
    setCut(r[0] + Math.min(1, Math.max(0, share)) * (r[1] - r[0]));
    setM(null);
    if (on) viewer.current?.setMeasure(setM);
  }, [version, viewer]);

  useEffect(() => {
    viewer.current?.setMeasure(measuring ? setM : null);
  }, [measuring, viewer]);
  useEffect(() => () => viewer.current?.setMeasure(null), [viewer]);

  useEffect(() => {
    viewer.current?.setSection(cutOn ? cut : null);
  }, [cutOn, cut, version, viewer]);

  const d = m?.b ? new Vector3(...m.b).sub(new Vector3(...m.a)) : null;
  const step = Math.max((range[1] - range[0]) / 200, 1e-4);
  return (
    <div className="cad-tools">
      <button className={`btn ghost cad-small ${measuring ? 'on' : ''}`} aria-pressed={measuring} onClick={() => setMeasuring((v) => !v)}>
        <Icon name="ruler" size={14} /> {tc('measure')}
      </button>
      {measuring && (
        <span className="cad-tools-val" aria-live="polite">
          {d && m?.distance !== undefined
            ? tc('measureVal', { d: f1(m.distance * k), x: f1(Math.abs(d.x) * k), y: f1(Math.abs(d.y) * k), z: f1(Math.abs(d.z) * k) })
            : tc('measureHint')}
        </span>
      )}
      <label className="cad-check" title={tc('sectionHint')}>
        <input type="checkbox" checked={cutOn} onChange={(e) => setCutOn(e.target.checked)} />
        {tc('section')}
      </label>
      {cutOn && (
        <>
          <input
            type="range"
            className="cad-cut"
            min={range[0]}
            max={range[1]}
            step={step}
            value={cut}
            aria-label={tc('sectionHint')}
            onChange={(e) => setCut(Number(e.target.value))}
          />
          <span className="cad-tools-val">Z {f1((cut - range[0]) * k)} mm</span>
        </>
      )}
    </div>
  );
}
