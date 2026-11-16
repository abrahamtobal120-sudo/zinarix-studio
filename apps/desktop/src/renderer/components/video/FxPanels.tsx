/**
 * Left-panel tabs of phase 2: Text (title styles), Effects (looks), Transitions and Audio
 * (the track mixer). Every action is an undoable edit of the pure model (shared/video.ts).
 */
import type { Clip, Track, VideoProject } from '../../../shared/video';
import {
  addTextClip,
  compositeOrder,
  setAnim,
  setEffects,
  setTrackMix,
  setTransition,
  trackOf,
  trackPan,
  trackVolume,
  updateTrack,
  visualClipsAt,
} from '../../../shared/video';
import type { TransitionDef } from '../../../shared/videoTransitions';
import type { AnimKind, TransitionKind, TransitionName } from '../../../shared/videoFx';
import { isPackKind, PACK, PACK_GROUPS, type PackGroup } from '../../../shared/videoAnimPack';
import { useEffect, useState } from 'react';
import type { StickerGroup } from '../../../shared/videoFx';
import {
  animLook,
  ANIM_KINDS,
  LOOKS,
  STICKER_ANIM,
  STICKER_COLORS,
  STICKER_GROUPS,
  stickerSpec,
  TEXT_PRESETS,
  TRANSITION_DEFAULT,
  TRANSITION_KINDS,
  transitionLook,
  cssFilter,
} from '../../../shared/videoFx';
import { toast } from '../../store';
import { CustomTransitions, LookSample } from './CustomTransitions';
import { DuckControl } from './EasyPanel';
import { FONT_FAMILY } from './textDraw';
import { type VideoKey, kindLabel, tv } from './strings';
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

export function StickersPanel() {
  const [color, setColor] = useState(STICKER_COLORS[0]!);
  const add = (item: string, group: StickerGroup) => {
    const s = getV();
    const { project, clip } = addTextClip(s.project, stickerSpec(item, group, color), s.playhead, {
      dur: 3,
      anim: STICKER_ANIM,
    });
    commit(project, tv('addSticker'));
    setV({ selection: [clip.id] });
  };
  return (
    <div className="vs-fx-panel">
      <div className="vs-panel-title">{tv('tabStickers')}</div>
      <p className="vs-dim vs-note">{tv('stickerHint')}</p>
      <div className="vs-sticker-colors" role="radiogroup" aria-label={tv('stickerColor')}>
        {STICKER_COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={c === color}
            aria-label={c}
            className={`vs-sticker-color${c === color ? ' on' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      {STICKER_GROUPS.map((g) => (
        <section key={g.id}>
          <div className="vs-sticker-group">{tv(`st_${g.id}` as VideoKey)}</div>
          <div className="vs-sticker-grid">
            {g.items.map((it) => (
              <button
                key={it}
                className="vs-sticker"
                title={tv('addSticker')}
                aria-label={`${tv('addSticker')} ${it}`}
                style={g.id === 'emoji' ? undefined : { color }}
                onClick={() => add(it, g.id)}
              >
                {it}
              </button>
            ))}
          </div>
        </section>
      ))}
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
            <span
              className="vs-fx-swatch vs-look-sample"
              style={{ filter: cssFilter(l.fx, 0.1) }}
            />
            <span className="vs-fx-name">{tv(`look_${l.id}` as VideoKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type FxMode = 'transition' | 'in' | 'out';
type FxGroup = 'all' | 'classic' | PackGroup;
const FX_GROUPS: readonly FxGroup[] = ['all', 'classic', ...PACK_GROUPS];

/** Who plays a hovered card in the viewer: the selection, else the top picture at the playhead. */
function previewTargets(targets: Clip[]): string[] {
  if (targets.length) return targets.map((c) => c.id);
  const s = getV();
  const p = s.project;
  for (const track of [...compositeOrder(p)].reverse()) {
    if (track.hidden || track.kind !== 'video') continue;
    const top = visualClipsAt(p, track.id, s.playhead).at(-1);
    if (top) return [top.id];
  }
  return [];
}

export function TransitionsPanel() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const targets = selectedVisual(project, selection);
  const [mode, setMode] = useState<FxMode>('transition');
  const [group, setGroup] = useState<FxGroup>('all');
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => () => setV({ fxPreview: null }), []);

  const isTr = mode === 'transition';
  const kinds: string[] = (isTr ? TRANSITION_KINDS : ANIM_KINDS).filter((k) => k !== 'none');
  const label = (k: string) => kindLabel(isTr ? 'tr' : 'anim', k);
  const groupOf = (k: string): FxGroup => (isPackKind(k) ? PACK[k].group : 'classic');
  const q = query.trim().toLowerCase();
  const shown = kinds.filter(
    (k) => (group === 'all' || groupOf(k) === group) && (!q || label(k).toLowerCase().includes(q)),
  );
  const lookOf = (k: string) =>
    isTr
      ? (x: number) => transitionLook(k as TransitionKind, x)
      : mode === 'in'
        ? (x: number) => animLook(k as AnimKind, x)
        : (x: number) => animLook(k as AnimKind, 1 - x);

  const apply = (k: string) => {
    if (!targets.length) return;
    let p = getV().project;
    for (const c of targets)
      p = isTr
        ? setTransition(p, c.id, {
            kind: k as TransitionKind,
            d: c.transition?.d ?? TRANSITION_DEFAULT,
          })
        : setAnim(p, c.id, { [mode]: k as AnimKind });
    commit(p, tv(isTr ? 'editTransition' : 'editAnim'));
    toast(tv('fxApplied', { what: label(k), n: targets.length }));
  };
  const enter = (k: string) => {
    setHover(k);
    const ids = previewTargets(targets);
    setV({ fxPreview: ids.length ? { ids, look: lookOf(k), since: performance.now() } : null });
  };
  const leave = () => {
    setHover(null);
    setV({ fxPreview: null });
  };

  return (
    <div className="vs-fx-panel">
      <div className="vs-panel-title">{tv('tabTransitions')}</div>
      <p className="vs-dim vs-note">
        {targets.length ? tv('trHint') : tv('needVisual')} {tv('trHoverHint')}
      </p>
      <div className="vs-fx-tools">
        <div className="vs-fx-modes" role="radiogroup" aria-label={tv('tabTransitions')}>
          {(['transition', 'in', 'out'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={`vs-chip ${mode === m ? 'active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'transition' ? tv('editTransition') : tv(m === 'in' ? 'animIn' : 'animOut')}
            </button>
          ))}
        </div>
        <input
          className="vs-search vs-fx-search"
          type="search"
          value={query}
          placeholder={tv('trSearch')}
          aria-label={tv('trSearch')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="vs-fx-groups">
          {FX_GROUPS.map((g) => (
            <button
              key={g}
              aria-pressed={group === g}
              className={`vs-chip ${group === g ? 'active' : ''}`}
              onClick={() => setGroup(g)}
            >
              {tv(`trGroup_${g}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="vs-fx-grid" onPointerLeave={leave}>
        {shown.map((k) => (
          <button
            key={k}
            className="vs-fx-card"
            aria-disabled={!targets.length}
            title={label(k)}
            onPointerEnter={() => enter(k)}
            onFocus={() => enter(k)}
            onBlur={leave}
            onClick={() => apply(k)}
          >
            <LookSample id={`${mode}:${k}`} look={lookOf(k)} play={hover === k} />
            <span className="vs-fx-name">{label(k)}</span>
          </button>
        ))}
        {!shown.length && <p className="vs-dim vs-note">{tv('trNoMatch')}</p>}
      </div>
      {isTr && <CustomTransitions targets={targets} />}
    </div>
  );
}

export const transitionLabel = (k: TransitionName, def?: TransitionDef): string =>
  k === 'custom' ? (def?.name ?? tv('trCustom')) : kindLabel('tr', k);

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
    commitMerged(
      setTrackMix(getV().project, track.id, patch),
      `${tv('editMix')} ${what} ${track.id}`,
    );
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
      {track.kind === 'audio' && <DuckControl track={track} />}
    </div>
  );
}
