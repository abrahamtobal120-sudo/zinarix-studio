/**
 * Left-panel tabs of phase 2: Text (title styles), Effects (looks), Transitions and Audio
 * (the track mixer). Every action is an undoable edit of the pure model (shared/video.ts).
 */
import type { Clip, Track, VideoProject } from '../../../shared/video';
import {
  addTextClip,
  setEffects,
  setTrackMix,
  setTransition,
  trackOf,
  trackPan,
  trackVolume,
  updateTrack,
} from '../../../shared/video';
import type { TransitionKind } from '../../../shared/videoFx';
import {
  LOOKS,
  TEXT_PRESETS,
  TRANSITION_DEFAULT,
  TRANSITION_KINDS,
  cssFilter,
} from '../../../shared/videoFx';
import { toast } from '../../store';
import { FONT_FAMILY } from './textDraw';
import { type VideoKey, tv } from './strings';
import { commit, commitMerged, getV, setV, useV } from './videoStore';
import './video-fx.css';

/** Selected clips that draw a picture (video tracks). */
function selectedVisual(p: VideoProject, sel: readonly string[]): Clip[] {
  return p.clips.filter((c) => sel.includes(c.id) && trackOf(p, c.trackId)?.kind === 'video');
}

export function TextPanel() {
  return (
    <div className="vs-fx-panel">
      <div className="vs-panel-title">{tv('tabText')}</div>
      <p className="vs-dim vs-note">{tv('textPanelHint')}</p>
      <div className="vs-fx-grid">
        {TEXT_PRESETS.map((pr) => (
          <button
            key={pr.id}
            className="vs-fx-card vs-text-card"
            title={tv('addText')}
            onClick={() => {
              const s = getV();
              const { project, clip } = addTextClip(s.project, pr.spec, s.playhead, {
                y: pr.y,
                anim: pr.anim,
              });
              commit(project, tv('addText'));
              setV({ selection: [clip.id] });
            }}
          >
            <span
              className="vs-fx-swatch vs-text-sample"
              style={{
                fontFamily: FONT_FAMILY[pr.spec.font],
                fontWeight: pr.spec.bold ? 700 : 400,
                fontStyle: pr.spec.italic ? 'italic' : 'normal',
                color: pr.spec.color,
                background: pr.spec.bg ?? undefined,
                WebkitTextStroke: pr.spec.stroke ? `1px ${pr.spec.stroke.color}` : undefined,
              }}
            >
              Aa
            </span>
            <span className="vs-fx-name">{tv(`tp_${pr.id}` as VideoKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function EffectsPanel() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const targets = selectedVisual(project, selection);
  return (
    <div className="vs-fx-panel">
      <div className="vs-panel-title">{tv('looks')}</div>
      <p className="vs-dim vs-note">{targets.length ? tv('fxHint') : tv('needVisual')}</p>
      <div className="vs-fx-grid">
        {LOOKS.map((l) => (
          <button
            key={l.id}
            className="vs-fx-card"
            disabled={!targets.length}
            onClick={() => {
              const what = tv(`look_${l.id}` as VideoKey);
              commit(
                setEffects(getV().project, new Set(targets.map((c) => c.id)), l.fx),
                tv('editEffects'),
              );
              toast(tv('fxApplied', { what, n: targets.length }));
            }}
          >
            <span className="vs-fx-swatch vs-look-sample" style={{ filter: cssFilter(l.fx, 0.1) }} />
            <span className="vs-fx-name">{tv(`look_${l.id}` as VideoKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TransitionsPanel() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const targets = selectedVisual(project, selection);
  return (
    <div className="vs-fx-panel">
      <div className="vs-panel-title">{tv('tabTransitions')}</div>
      <p className="vs-dim vs-note">{targets.length ? tv('trHint') : tv('needVisual')}</p>
      <div className="vs-fx-grid">
        {TRANSITION_KINDS.map((k) => (
          <button
            key={k}
            className="vs-fx-card"
            disabled={!targets.length}
            onClick={() => {
              let p = getV().project;
              for (const c of targets)
                p = setTransition(p, c.id, { kind: k, d: c.transition?.d ?? TRANSITION_DEFAULT });
              commit(p, tv('editTransition'));
              toast(tv('fxApplied', { what: tv(`tr_${k}` as VideoKey), n: targets.length }));
            }}
          >
            <span className={`vs-fx-swatch vs-tr-sample vs-tr-${k}`} aria-hidden="true">
              <i />
            </span>
            <span className="vs-fx-name">{tv(`tr_${k}` as VideoKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const transitionLabel = (k: TransitionKind): string => tv(`tr_${k}` as VideoKey);

export function MixerPanel() {
  const project = useV((s) => s.project);
  const anySolo = project.tracks.some((t) => t.solo);
  return (
    <div className="vs-fx-panel">
      <div className="vs-panel-title">{tv('mixer')}</div>
      <p className="vs-dim vs-note">{tv('mixHint')}</p>
      <div className="vs-mixer">
        {project.tracks.map((t) => (
          <MixerStrip key={t.id} track={t} dimmed={anySolo && !t.solo} />
        ))}
      </div>
    </div>
  );
}

function MixerStrip({ track, dimmed }: { track: Track; dimmed: boolean }) {
  const vol = trackVolume(track);
  const pan = trackPan(track);
  const mix = (patch: { volume?: number; pan?: number }, what: string) =>
    commitMerged(setTrackMix(getV().project, track.id, patch), `${tv('editMix')} ${what} ${track.id}`);
  return (
    <div className={`vs-strip ${dimmed || track.muted ? 'vs-strip-off' : ''}`}>
      <div className="vs-strip-head">
        <strong>{track.name}</strong>
        <span className="vs-strip-btns">
          <button
            className={`vs-chip ${track.muted ? 'active' : ''}`}
            aria-pressed={track.muted}
            title={tv('mute')}
            onClick={() =>
              commit(updateTrack(getV().project, track.id, { muted: !track.muted }), tv('editMix'))
            }
          >
            M
          </button>
          <button
            className={`vs-chip ${track.solo ? 'active' : ''}`}
            aria-pressed={!!track.solo}
            title={tv('solo')}
            onClick={() =>
              commit(setTrackMix(getV().project, track.id, { solo: !track.solo }), tv('editMix'))
            }
          >
            S
          </button>
        </span>
      </div>
      <label className="vs-strip-row">
        <span className="vs-prop-label">{tv('mixVolume')}</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={vol}
          aria-label={`${tv('mixVolume')} · ${track.name}`}
          onChange={(e) => mix({ volume: Number(e.target.value) }, 'vol')}
          onDoubleClick={() => mix({ volume: 1 }, 'vol')}
        />
        <code>{vol > 0 ? `${(20 * Math.log10(vol)).toFixed(1)} dB` : '−∞'}</code>
      </label>
      <label className="vs-strip-row">
        <span className="vs-prop-label">{tv('mixPan')}</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={pan}
          aria-label={`${tv('mixPan')} · ${track.name}`}
          onChange={(e) => mix({ pan: Number(e.target.value) }, 'pan')}
          onDoubleClick={() => mix({ pan: 0 }, 'pan')}
        />
        <code>
          {Math.abs(pan) < 0.005
            ? 'C'
            : `${pan < 0 ? tv('panL') : tv('panR')}${Math.round(Math.abs(pan) * 100)}`}
        </code>
      </label>
    </div>
  );
}
