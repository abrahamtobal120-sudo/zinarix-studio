/**
 * Fase 4B: the speed ramp part of the inspector: preset curves, a small curve editor (drag the
 * points up for faster) and, on a ramped clip, what it has and a button to take it off.
 */
import { useRef, useState } from 'react';
import type { Clip } from '../../../shared/video';
import { SPEED_MAX, SPEED_MIN } from '../../../shared/video';
import {
  RAMP_PRESETS,
  RAMP_PRESET_IDS,
  type RampPoint,
  type RampPreset,
  applyRamp,
  rampInfo,
  rampSpeedAt,
  removeRamp,
} from '../../../shared/videoRamp';
import { toast } from '../../store';
import { type Fase4Key, t4 } from './fase4Strings';
import { fmtDuration } from './strings';
import { commit, getV, setV, useV } from './videoStore';

const LMIN = Math.log2(SPEED_MIN);
const LMAX = Math.log2(SPEED_MAX);
/** 0 (bottom, slowest) … 1 (top, fastest) on a log scale, so 1× sits in the middle. */
const toY = (s: number) => (Math.log2(s) - LMIN) / (LMAX - LMIN);
const fromY = (y: number) => 2 ** (LMIN + Math.min(1, Math.max(0, y)) * (LMAX - LMIN));
const EDIT_U = [0, 0.25, 0.5, 0.75, 1];

function curvePath(points: readonly RampPoint[], w: number, h: number, pad = 2): string {
  const n = 40;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = pad + u * (w - pad * 2);
    const y = pad + (1 - toY(rampSpeedAt(points, u))) * (h - pad * 2);
    d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

function apply(clipId: string, curve: RampPreset | RampPoint[]): void {
  try {
    const r = applyRamp(getV().project, clipId, curve);
    commit(r.project, t4('rampUndo'));
    setV({ selection: r.ids });
    toast(t4('rampApplied', { d: fmtDuration(r.duration) }));
  } catch (e) {
    toast((e as Error).message);
  }
}

export function RampSection({ clip }: { clip: Clip }) {
  // A string, so the store hook gets the same snapshot until the ramp really changes.
  const infoJson = useV((s) => (clip.ramp ? JSON.stringify(rampInfo(s.project, clip.id)) : ''));
  const info = infoJson ? (JSON.parse(infoJson) as ReturnType<typeof rampInfo>) : null;
  const [points, setPoints] = useState<RampPoint[]>(() =>
    EDIT_U.map((u) => ({
      u,
      s:
        clip.ramp && clip.ramp.preset in RAMP_PRESETS
          ? rampSpeedAt(RAMP_PRESETS[clip.ramp.preset as RampPreset], u)
          : 1,
    })),
  );
  const [drag, setDrag] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const W = 240;
  const H = 110;
  const pad = 10;
  const pointAt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return 1 - (((e.clientY - r.top) / r.height) * H - pad) / (H - pad * 2);
  };
  const name = (id: string) => t4(`rp_${id}` as Fase4Key);
  return (
    <>
      <div className="vs-panel-sub">{t4('rampTitle')}</div>
      <p className="vs-dim vs-note">{t4('rampHint')}</p>
      {info && (
        <div className="vs-prop-block vs-ramp-info">
          <span>
            {t4('rampOn', {
              name: name(info.preset),
              n: info.steps,
              min: info.min,
              max: info.max,
            })}
          </span>
          <span>
            <button onClick={() => setV({ selection: info.ids })}>{t4('rampSelectAll')}</button>{' '}
            <button
              onClick={() => {
                const r = removeRamp(getV().project, clip.id);
                commit(r.project, t4('rampRemoved'));
                setV({ selection: [r.id] });
              }}
            >
              {t4('rampRemove')}
            </button>
          </span>
        </div>
      )}
      <div className="vs-prop-block vs-ramps" role="group" aria-label={t4('rampTitle')}>
        {RAMP_PRESET_IDS.map((id) => (
          <button
            key={id}
            className={`vs-ramp ${info?.preset === id ? 'on' : ''}`}
            aria-pressed={info?.preset === id}
            title={name(id)}
            onClick={() => apply(clip.id, id)}
          >
            <svg viewBox="0 0 60 26" preserveAspectRatio="none" aria-hidden="true">
              <line
                className="vs-ramp-base"
                x1="0"
                x2="60"
                y1={2 + (1 - toY(1)) * 22}
                y2={2 + (1 - toY(1)) * 22}
              />
              <path className="vs-ramp-curve" d={curvePath(RAMP_PRESETS[id], 60, 26)} />
            </svg>
            {name(id)}
          </button>
        ))}
      </div>
      <div className="vs-prop-block">
        <span className="vs-dim vs-note">{t4('rampCustomHint')}</span>
        <svg
          ref={svg}
          className="vs-ramp-editor"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t4('rp_custom')}
          onPointerMove={(e) => {
            if (drag == null) return;
            const s = Math.round(fromY(pointAt(e)) * 100) / 100;
            setPoints((ps) => ps.map((p, i) => (i === drag ? { ...p, s } : p)));
          }}
          onPointerUp={() => setDrag(null)}
          onPointerLeave={() => setDrag(null)}
        >
          {[4, 2, 1, 0.5, 0.25].map((s) => {
            const y = pad + (1 - toY(s)) * (H - pad * 2);
            return (
              <g key={s}>
                <line className="vs-ramp-base" x1={0} x2={W} y1={y} y2={y} />
                <text className="vs-ramp-label" x={3} y={y - 2}>
                  {s}×
                </text>
              </g>
            );
          })}
          <path className="vs-ramp-curve" d={curvePath(points, W, H, pad)} />
          {points.map((p, i) => (
            <circle
              key={p.u}
              className={`vs-ramp-pt ${drag === i ? 'on' : ''}`}
              cx={pad + p.u * (W - pad * 2)}
              cy={pad + (1 - toY(p.s)) * (H - pad * 2)}
              r={6}
              onPointerDown={(e) => {
                (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(
                  e.pointerId,
                );
                setDrag(i);
              }}
            >
              <title>{`${p.s}×`}</title>
            </circle>
          ))}
        </svg>
        <button className="primary" onClick={() => apply(clip.id, points)}>
          {t4('rampApplyCustom')}
        </button>
      </div>
      <p className="vs-dim vs-note">{t4('rampNote')}</p>
    </>
  );
}
