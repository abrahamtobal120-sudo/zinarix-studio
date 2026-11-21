/**
 * Fase 4 (mejora): RGB curves of the Color tab. A master curve and one per channel, drawn on a
 * square: drag a point, click on empty space to add one, double-click (or right-click) a point
 * to remove it. The ends only move up and down. Same maths as the export (shared/videoColor.ts).
 */
import { useRef, useState } from 'react';
import type { ColorGrade, CurveKey, CurvePoint } from '../../../shared/videoColor';
import { CURVE_KEYS, CURVE_MAX_POINTS, CURVE_PRESETS, cleanCurve, curveSegments, splineAt } from '../../../shared/videoColor';
import { type ProKey, tp } from './proStrings';

const S = 256;
/** Line colours per curve (inline: the token test only checks the CSS files). */
const STROKE: Record<CurveKey, string> = {
  m: 'var(--fg)',
  r: 'rgb(235, 90, 90)',
  g: 'rgb(90, 200, 110)',
  b: 'rgb(90, 150, 245)',
};
const LABEL: Record<CurveKey, ProKey> = { m: 'master', r: 'red', g: 'green', b: 'blue' };
const IDENTITY: CurvePoint[] = [
  [0, 0],
  [1, 1],
];
const GAP = 0.02;

const pointsOf = (g: ColorGrade | undefined, k: CurveKey): CurvePoint[] =>
  g?.curves?.[k] ?? IDENTITY;

function pathOf(pts: CurvePoint[]): string {
  const segs = curveSegments(pts);
  const out: string[] = [];
  for (let i = 0; i <= 128; i++) {
    const x = i / 128;
    out.push(`${i ? 'L' : 'M'}${(x * S).toFixed(1)} ${((1 - splineAt(segs, x)) * S).toFixed(1)}`);
  }
  return out.join(' ');
}

export function CurvesBlock({
  grade,
  onChange,
}: {
  grade: ColorGrade | undefined;
  /** New points of one curve (undefined = straight); `merged` folds a drag into one undo step. */
  onChange: (k: CurveKey, pts: CurvePoint[] | undefined, merged: boolean) => void;
}) {
  const [key, setKey] = useState<CurveKey>('m');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; pts: CurvePoint[] } | null>(null);
  const pts = pointsOf(grade, key);
  const any = !!grade?.curves;

  const at = (e: { clientX: number; clientY: number }): CurvePoint => {
    const r = svg.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    return [x, y];
  };
  const set = (next: CurvePoint[], merged: boolean) => onChange(key, cleanCurve(next), merged);

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = at(e);
    const next = d.pts.map((p) => [...p] as CurvePoint);
    const last = next.length - 1;
    // The ends stay at x = 0 / 1; the others between their neighbours.
    const nx =
      d.i === 0 ? 0 : d.i === last ? 1 : Math.min(next[d.i + 1]![0] - GAP, Math.max(next[d.i - 1]![0] + GAP, x));
    next[d.i] = [nx, y];
    d.pts = next;
    set(next, true);
  };

  /** The point under the pointer (within 10 px), or −1. */
  const hit = (e: { clientX: number; clientY: number }): number => {
    const [x, y] = at(e);
    const near = 10 / svg.current!.getBoundingClientRect().width;
    return pts.findIndex((p) => Math.abs(p[0] - x) < near && Math.abs(p[1] - y) < near);
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const [x] = at(e);
    let i = hit(e);
    let next = pts;
    if (i < 0) {
      if (pts.length >= CURVE_MAX_POINTS) return;
      // A new point on the curve itself, then it follows the pointer.
      const onCurve = splineAt(curveSegments(pts), x);
      if (pts.some((p) => Math.abs(p[0] - x) < GAP)) return;
      next = [...pts, [x, onCurve] as CurvePoint].sort((a, b) => a[0] - b[0]);
      i = next.findIndex((p) => p[0] === x);
      set(next, true);
    }
    drag.current = { i, pts: next };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const remove = (i: number) => {
    if (i <= 0 || i >= pts.length - 1) return;
    set(
      pts.filter((_, j) => j !== i),
      false,
    );
  };

  return (
    <div className="vs-color-wheel">
      <div className="vs-color-head">
        <h4>{tp('curves')}</h4>
        <button
          className="vs-color-reset"
          disabled={!grade?.curves?.[key]}
          onClick={() => onChange(key, undefined, false)}
        >
          {tp('reset')}
        </button>
      </div>
      <div className="vs-curve-tabs" role="tablist" aria-label={tp('curves')}>
        {CURVE_KEYS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={k === key}
            className={`vs-chip ${k === key ? 'active' : ''}`}
            onClick={() => setKey(k)}
          >
            <span className="vs-curve-dot" style={{ background: STROKE[k] }} />
            {tp(LABEL[k])}
            {grade?.curves?.[k] ? ' •' : ''}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        className="vs-curve"
        viewBox={`0 0 ${S} ${S}`}
        role="img"
        aria-label={`${tp('curves')} · ${tp(LABEL[key])}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        // On the svg, not the circles: pointer capture sends the clicks to the svg.
        onDoubleClick={(e) => remove(hit(e))}
        onContextMenu={(e) => {
          e.preventDefault();
          remove(hit(e));
        }}
      >
        {[1, 2, 3].map((q) => (
          <g key={q} className="vs-curve-grid">
            <line x1={(q * S) / 4} y1={0} x2={(q * S) / 4} y2={S} />
            <line x1={0} y1={(q * S) / 4} x2={S} y2={(q * S) / 4} />
          </g>
        ))}
        <line className="vs-curve-diag" x1={0} y1={S} x2={S} y2={0} />
        {any &&
          CURVE_KEYS.filter((k) => k !== key && grade?.curves?.[k]).map((k) => (
            <path key={k} d={pathOf(pointsOf(grade, k))} fill="none" stroke={STROKE[k]} strokeOpacity={0.35} strokeWidth={1.5} />
          ))}
        <path d={pathOf(pts)} fill="none" stroke={STROKE[key]} strokeWidth={2.2} />
        {pts.map((p, i) => (
          <circle
            key={i}
            className="vs-curve-pt"
            cx={p[0] * S}
            cy={(1 - p[1]) * S}
            r={6}
            stroke={STROKE[key]}
          >
            <title>
              {Math.round(p[0] * 255)} → {Math.round(p[1] * 255)}
            </title>
          </circle>
        ))}
      </svg>
      <p className="vs-dim vs-note">{tp('curvesHint')}</p>
      <div className="vs-color-presets">
        {CURVE_PRESETS.map((pr) => (
          <button key={pr.id} onClick={() => onChange('m', cleanCurve(pr.pts), false)}>
            {tp(`cp_${pr.id}` as ProKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
