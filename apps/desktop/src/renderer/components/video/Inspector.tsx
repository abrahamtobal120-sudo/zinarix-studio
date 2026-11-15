import { useEffect, useState } from 'react';
import type { Clip, Ease, KeyProp, Transform } from '../../../shared/video';
import type {
  AnimKind,
  ClipAnim,
  EffectKey,
  TextFont,
  TextSpec,
  Transition,
  TransitionKind,
} from '../../../shared/videoFx';
import {
  ANIM_KINDS,
  ANIM_MAX,
  EFFECT_KEYS,
  EFFECT_RANGE,
  TEXT_FONTS,
  TEXT_MAX,
  TRANSITION_DEFAULT,
  TRANSITION_KINDS,
  TRANSITION_MAX,
  TRANSITION_MIN,
  animLengths,
  isHex,
} from '../../../shared/videoFx';
import { FONT_FAMILY } from './textDraw';
import {
  EASES,
  SPEED_MAX,
  SPEED_MIN,
  clearKeys,
  clipDur,
  clipEnd,
  editTransformAt,
  hasKeyframes,
  isAnimated,
  keyAt,
  keyTimes,
  mediaOf,
  projectDuration,
  removeKey,
  resetTransform,
  setClipSpeed,
  setAnim,
  setEffect,
  setEffects,
  setFades,
  setKey,
  setTransition,
  trackOf,
  transitionWindow,
  updateText,
  setTransform,
  speedOf,
  timecode,
  transformAt,
  updateClip,
} from '../../../shared/video';
import { api, toast } from '../../store';
import { type VideoKey, fmtBytes, fmtDuration, tv } from './strings';
import { commit, commitMerged, getV, seek, useV } from './videoStore';

export function Inspector() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const clip =
    selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
  const media = clip ? mediaOf(project, clip.mediaId) : undefined;
  const visual = !!clip && trackOf(project, clip.trackId)?.kind === 'video';

  return (
    <div className="vs-inspector">
      <div className="vs-panel-title">{tv('inspector')}</div>
      {clip && clip.text ? (
        <div className="vs-props">
          <Row label={tv('clipSource')}>
            <span>{tv('textClip')}</span>
          </Row>
          <Row label={tv('clipStart')}>
            <code>{timecode(clip.start, project.fps)}</code>
          </Row>
          <Row label={tv('clipDuration')}>
            <code>{timecode(clipDur(clip), project.fps)}</code>
          </Row>
          <TextSection clip={clip} />
          <TransformSection clip={clip} />
          <AnimSection clip={clip} />
          <TransitionSection clip={clip} />
          <EffectsSection clip={clip} />
          <FadeSection clip={clip} />
        </div>
      ) : clip && media ? (
        <div className="vs-props">
          <Row label={tv('clipSource')}>
            <span className="vs-ellipsis" title={media.path}>
              {media.name}
            </span>
          </Row>
          <Row label={tv('clipStart')}>
            <code>{timecode(clip.start, project.fps)}</code>
          </Row>
          <Row label={tv('clipDuration')}>
            <code>{timecode(clipDur(clip), project.fps)}</code>
          </Row>
          {media.kind !== 'image' && (
            <Row label={tv('clipIn')}>
              <code>{timecode(clip.in, project.fps)}</code>
            </Row>
          )}
          {media.hasAudio && (
            <div className="vs-prop-block">
              <label className="vs-prop-label" htmlFor="vs-vol">
                {tv('volume')} · {Math.round(clip.volume * 100)} %
              </label>
              <input
                id="vs-vol"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clip.volume}
                onChange={(e) =>
                  commitMerged(
                    updateClip(getV().project, clip.id, { volume: Number(e.target.value) }),
                    `${tv('volume')} ${clip.id}`,
                  )
                }
              />
            </div>
          )}
          {(media.hasVideo || media.kind === 'image') && <TransformSection clip={clip} />}
          {media.kind !== 'image' && <SpeedSection clip={clip} />}
          {visual && (media.hasVideo || media.kind === 'image') && (
            <>
              <AnimSection clip={clip} />
              <TransitionSection clip={clip} />
              <EffectsSection clip={clip} />
            </>
          )}
          {(media.hasVideo || media.hasAudio || media.kind === 'image') && (
            <FadeSection clip={clip} />
          )}
          <p className="vs-dim vs-note">{tv('comingNext')}</p>
        </div>
      ) : selection.length > 1 ? (
        <p className="vs-dim vs-pad">{tv('inspectorMulti', { n: selection.length })}</p>
      ) : (
        <ProjectInfo />
      )}
    </div>
  );
}

function ProjectInfo() {
  const p = useV((s) => s.project);
  const tools = useV((s) => s.tools);
  const [cache, setCache] = useState<number | null>(null);
  useEffect(() => {
    void api()
      .video.cacheSize()
      .then(setCache)
      .catch(() => undefined);
  }, []);
  return (
    <div className="vs-props">
      <p className="vs-dim vs-pad">{tv('inspectorEmpty')}</p>
      <div className="vs-panel-sub">{tv('projectSettings')}</div>
      <Row label={tv('resolution')}>
        <code>
          {p.width}×{p.height}
        </code>
      </Row>
      <Row label={tv('fps')}>
        <code>{p.fps}</code>
      </Row>
      <Row label={tv('duration')}>
        <code>{fmtDuration(projectDuration(p))}</code>
      </Row>
      <Row label="FFmpeg">
        <span
          className={`vs-ellipsis ${tools?.ffmpeg ? 'vs-ok' : 'vs-warn'}`}
          title={tools?.version ?? undefined}
        >
          {tools
            ? tools.ffmpeg
              ? // "6.1.1-essentials_build-www.gyan.dev" → "6.1.1"
                (tools.version?.split(/[-_]/)[0] ?? '✓')
              : '—'
            : '…'}
        </span>
      </Row>
      <Row label={tv('cache')}>
        <span className="vs-cache">
          <code>{cache == null ? '…' : fmtBytes(cache)}</code>
          <button
            className="vs-mini"
            onClick={async () => {
              await api().video.clearCache();
              setCache(0);
              toast(tv('cacheCleared'));
            }}
          >
            {tv('clearCache')}
          </button>
        </span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="vs-prop">
      <span className="vs-prop-label">{label}</span>
      <span className="vs-prop-value">{children}</span>
    </div>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** A labelled slider with a number box; drags fold into one undo step. */
function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  factor = 1,
  extra,
  onChange,
}: {
  /** Shown next to the label (keyframe controls). */
  extra?: React.ReactNode;
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Shown value = stored × factor (e.g. 0.5 shown as 50 %). */
  factor?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="vs-prop-block">
      <div className="vs-slider-head">
        <span className="vs-label-keys">
          <label className="vs-prop-label" htmlFor={id}>
            {label}
          </label>
          {extra}
        </span>
        <span className="vs-num">
          <input
            type="number"
            className="vs-num-input"
            aria-label={label}
            value={Math.round(value * factor * 100) / 100}
            step={step * factor}
            onChange={(e) => {
              const v = Number(e.target.value) / factor;
              if (e.target.value !== '' && Number.isFinite(v))
                onChange(Math.min(max, Math.max(min, v)));
            }}
          />
          <span className="vs-dim">{unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Where keys go: the playhead, kept inside the clip. */
function keyTimeFor(clip: Clip, playhead: number): number {
  return Math.min(Math.max(playhead, clip.start), clipEnd(clip));
}

/** The diamond (add / remove a key here), the ease of that key, and stop animating. */
function KeyControls({ clip, prop, t }: { clip: Clip; prop: KeyProp; t: number }) {
  const fps = useV((s) => s.project.fps);
  const animated = isAnimated(clip, prop);
  const key = animated ? keyAt(clip, prop, t, fps) : undefined;
  const label = key ? tv('keyRemove') : animated ? tv('keyAdd') : tv('keyStart');
  return (
    <span className="vs-keys">
      <button
        className={`vs-key ${key ? 'on' : animated ? 'animated' : ''}`}
        title={label}
        aria-label={`${label} · ${tv(PROP_LABEL[prop])}`}
        aria-pressed={!!key}
        onClick={() =>
          commit(
            key
              ? removeKey(getV().project, clip.id, prop, t)
              : setKey(getV().project, clip.id, prop, t),
            tv('editKey'),
          )
        }
      >
        ◆
      </button>
      {key && (
        <select
          className="vs-ease"
          title={tv('keyEase')}
          aria-label={tv('keyEase')}
          value={key.ease ?? 'linear'}
          onChange={(e) =>
            commit(
              setKey(getV().project, clip.id, prop, t, key.v, e.target.value as Ease),
              tv('editKey'),
            )
          }
        >
          {EASES.map((e) => (
            <option key={e} value={e}>
              {tv(EASE_LABEL[e])}
            </option>
          ))}
        </select>
      )}
      {animated && (
        <button
          className="vs-key-clear"
          title={tv('keyClear')}
          aria-label={`${tv('keyClear')} · ${tv(PROP_LABEL[prop])}`}
          onClick={() => commit(clearKeys(getV().project, clip.id, prop, t), tv('editKey'))}
        >
          ×
        </button>
      )}
    </span>
  );
}

const PROP_LABEL: Record<KeyProp, VideoKey> = {
  x: 'posX',
  y: 'posY',
  scale: 'scale',
  rotation: 'rotation',
  opacity: 'opacity',
};
const EASE_LABEL: Record<Ease, VideoKey> = {
  linear: 'easeLinear',
  ease: 'easeEase',
  hold: 'easeHold',
};

const SLIDERS: {
  prop: KeyProp;
  id: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  factor?: number;
}[] = [
  { prop: 'x', id: 'vs-tx', min: -1, max: 1, step: 0.005, unit: '%', factor: 100 },
  { prop: 'y', id: 'vs-ty', min: -1, max: 1, step: 0.005, unit: '%', factor: 100 },
  { prop: 'scale', id: 'vs-ts', min: 0.05, max: 4, step: 0.01, unit: '%', factor: 100 },
  { prop: 'rotation', id: 'vs-tr', min: -360, max: 360, step: 1, unit: '°' },
  { prop: 'opacity', id: 'vs-to', min: 0, max: 1, step: 0.01, unit: '%', factor: 100 },
];

function TransformSection({ clip }: { clip: Clip }) {
  const playhead = useV((s) => s.playhead);
  const t = keyTimeFor(clip, playhead);
  const inside = playhead >= clip.start && playhead <= clipEnd(clip);
  const tr = transformAt(clip, t);
  const times = keyTimes(clip);
  const prev = [...times].reverse().find((k) => k < playhead - 1e-4);
  const next = times.find((k) => k > playhead + 1e-4);
  // Slider drags fold into one undo step per property and key time.
  const set = (patch: Partial<Transform>, what: string) =>
    commitMerged(
      editTransformAt(getV().project, clip.id, patch, t),
      `${tv('editTransform')} ${what} ${clip.id} ${t.toFixed(3)}`,
    );
  const flip = (patch: Partial<Transform>, label: string) =>
    commit(setTransform(getV().project, clip.id, patch), label);
  return (
    <>
      <div className="vs-panel-sub vs-sub-row">
        <span>{tv('secTransform')}</span>
        <span className="vs-keynav">
          {times.length > 0 && (
            <>
              <button
                className="vs-mini"
                disabled={prev === undefined}
                title={tv('keyPrev')}
                aria-label={tv('keyPrev')}
                onClick={() => prev !== undefined && seek(prev)}
              >
                ◀◆
              </button>
              <button
                className="vs-mini"
                disabled={next === undefined}
                title={tv('keyNext')}
                aria-label={tv('keyNext')}
                onClick={() => next !== undefined && seek(next)}
              >
                ◆▶
              </button>
            </>
          )}
          <button
            className="vs-mini"
            disabled={!clip.transform && !clip.keyframes}
            onClick={() => commit(resetTransform(getV().project, clip.id), tv('editTransform'))}
          >
            {tv('resetTransform')}
          </button>
        </span>
      </div>
      {!inside && hasKeyframes(clip) && <p className="vs-dim vs-note">{tv('keyOutside')}</p>}
      {SLIDERS.map((s) => (
        <Slider
          key={s.prop}
          id={s.id}
          label={tv(PROP_LABEL[s.prop])}
          value={tr[s.prop]}
          min={s.min}
          max={s.max}
          step={s.step}
          unit={s.unit}
          factor={s.factor}
          extra={<KeyControls clip={clip} prop={s.prop} t={t} />}
          onChange={(v) => set({ [s.prop]: v }, s.prop)}
        />
      ))}
      <div className="vs-prop-block vs-toggles">
        <label>
          <input
            type="checkbox"
            checked={tr.flipH}
            onChange={(e) => flip({ flipH: e.target.checked }, tv('flipH'))}
          />
          {tv('flipH')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={tr.flipV}
            onChange={(e) => flip({ flipV: e.target.checked }, tv('flipV'))}
          />
          {tv('flipV')}
        </label>
      </div>
    </>
  );
}

function SpeedSection({ clip }: { clip: Clip }) {
  const sp = speedOf(clip);
  return (
    <>
      <div className="vs-panel-sub">{tv('secSpeed')}</div>
      <Slider
        id="vs-sp"
        label={tv('secSpeed')}
        value={sp}
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={0.05}
        unit="×"
        onChange={(v) =>
          commitMerged(setClipSpeed(getV().project, clip.id, v), `${tv('editSpeed')} ${clip.id}`)
        }
      />
      <div className="vs-prop-block vs-chips" role="group" aria-label={tv('secSpeed')}>
        {SPEEDS.map((v) => (
          <button
            key={v}
            className={`vs-chip ${Math.abs(v - sp) < 1e-6 ? 'active' : ''}`}
            aria-pressed={Math.abs(v - sp) < 1e-6}
            onClick={() => commit(setClipSpeed(getV().project, clip.id, v), tv('editSpeed'))}
          >
            {v}×
          </button>
        ))}
      </div>
      <p className="vs-dim vs-note">{tv('speedNote')}</p>
    </>
  );
}

function FadeSection({ clip }: { clip: Clip }) {
  const max = Math.max(0.1, Math.min(10, clipDur(clip)));
  const set = (patch: { fadeIn?: number; fadeOut?: number }, what: string) =>
    commitMerged(setFades(getV().project, clip.id, patch), `${tv('editFade')} ${what} ${clip.id}`);
  return (
    <>
      <div className="vs-panel-sub">{tv('secFades')}</div>
      <Slider
        id="vs-fi"
        label={tv('fadeIn')}
        value={clip.fadeIn ?? 0}
        min={0}
        max={max}
        step={0.05}
        unit="s"
        onChange={(fadeIn) => set({ fadeIn }, 'in')}
      />
      <Slider
        id="vs-fo"
        label={tv('fadeOut')}
        value={clip.fadeOut ?? 0}
        min={0}
        max={max}
        step={0.05}
        unit="s"
        onChange={(fadeOut) => set({ fadeOut }, 'out')}
      />
    </>
  );
}

// ---------------- phase 2: text, animation, transition, effects ----------------

function TextSection({ clip }: { clip: Clip }) {
  const spec = clip.text!;
  const edit = (patch: Partial<TextSpec>, what: string, merge = true) =>
    (merge ? commitMerged : commit)(
      updateText(getV().project, clip.id, patch),
      `${tv('editText')} ${what} ${clip.id}`,
    );
  return (
    <>
      <div className="vs-panel-sub">{tv('secText')}</div>
      <div className="vs-prop-block">
        <label className="vs-prop-label" htmlFor="vs-txt">
          {tv('textContent')}
        </label>
        <textarea
          id="vs-txt"
          className="vs-textarea"
          rows={3}
          maxLength={TEXT_MAX}
          value={spec.content}
          onChange={(e) => edit({ content: e.target.value }, 'content')}
        />
      </div>
      <div className="vs-prop">
        <label className="vs-prop-label" htmlFor="vs-font">
          {tv('textFont')}
        </label>
        <select
          id="vs-font"
          className="vs-select"
          value={spec.font}
          onChange={(e) => edit({ font: e.target.value as TextFont }, 'font', false)}
        >
          {TEXT_FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: FONT_FAMILY[f] }}>
              {tv(`font_${f}` as VideoKey)}
            </option>
          ))}
        </select>
      </div>
      <Slider
        id="vs-tsz"
        label={tv('textSize')}
        value={spec.size}
        min={0.02}
        max={0.3}
        step={0.005}
        unit="%"
        factor={100}
        onChange={(size) => edit({ size }, 'size')}
      />
      <div className="vs-prop">
        <label className="vs-prop-label" htmlFor="vs-tcol">
          {tv('textColor')}
        </label>
        <input
          id="vs-tcol"
          type="color"
          className="vs-color"
          value={spec.color}
          onChange={(e) => isHex(e.target.value) && edit({ color: e.target.value }, 'color')}
        />
      </div>
      <div className="vs-prop-block vs-toggles">
        <label>
          <input
            type="checkbox"
            checked={spec.bold}
            onChange={(e) => edit({ bold: e.target.checked }, 'bold', false)}
          />
          {tv('textBold')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={spec.italic}
            onChange={(e) => edit({ italic: e.target.checked }, 'italic', false)}
          />
          {tv('textItalic')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!spec.shadow}
            onChange={(e) => edit({ shadow: e.target.checked || undefined }, 'shadow', false)}
          />
          {tv('textShadow')}
        </label>
      </div>
      <div className="vs-prop-block vs-chips" role="group" aria-label={tv('textAlign')}>
        {(['left', 'center', 'right'] as const).map((a) => (
          <button
            key={a}
            className={`vs-chip ${spec.align === a ? 'active' : ''}`}
            aria-pressed={spec.align === a}
            onClick={() => edit({ align: a }, 'align', false)}
          >
            {tv(`align_${a}` as VideoKey)}
          </button>
        ))}
      </div>
      <div className="vs-prop">
        <label className="vs-prop-label vs-check">
          <input
            type="checkbox"
            checked={!!spec.stroke}
            onChange={(e) =>
              edit(
                { stroke: e.target.checked ? { color: '#000000', width: 0.1 } : undefined },
                'stroke',
                false,
              )
            }
          />
          {tv('textStroke')}
        </label>
        {spec.stroke && (
          <input
            type="color"
            className="vs-color"
            aria-label={tv('textStroke')}
            value={spec.stroke.color}
            onChange={(e) =>
              isHex(e.target.value) &&
              edit({ stroke: { ...spec.stroke!, color: e.target.value } }, 'strokeColor')
            }
          />
        )}
      </div>
      {spec.stroke && (
        <Slider
          id="vs-tsw"
          label={tv('textStroke')}
          value={spec.stroke.width}
          min={0.01}
          max={0.4}
          step={0.01}
          unit="%"
          factor={100}
          onChange={(width) => edit({ stroke: { ...spec.stroke!, width } }, 'strokeWidth')}
        />
      )}
      <div className="vs-prop">
        <label className="vs-prop-label vs-check">
          <input
            type="checkbox"
            checked={!!spec.bg}
            onChange={(e) => edit({ bg: e.target.checked ? '#1f6feb' : undefined }, 'bg', false)}
          />
          {tv('textBg')}
        </label>
        {spec.bg && (
          <input
            type="color"
            className="vs-color"
            aria-label={tv('textBg')}
            value={spec.bg}
            onChange={(e) => isHex(e.target.value) && edit({ bg: e.target.value }, 'bgColor')}
          />
        )}
      </div>
    </>
  );
}

function AnimSection({ clip }: { clip: Clip }) {
  const a = clip.anim ?? {};
  const { inD, outD } = animLengths(clip.anim, clipDur(clip));
  const set = (patch: Partial<ClipAnim>, what: string, merge = false) =>
    (merge ? commitMerged : commit)(
      setAnim(getV().project, clip.id, patch),
      `${tv('editAnim')} ${what} ${clip.id}`,
    );
  const max = Math.max(0.1, Math.min(ANIM_MAX, clipDur(clip)));
  const side = (which: 'in' | 'out') => {
    const kind = (which === 'in' ? a.in : a.out) ?? 'none';
    const d = which === 'in' ? inD : outD;
    return (
      <>
        <div className="vs-prop">
          <label className="vs-prop-label" htmlFor={`vs-anim-${which}`}>
            {tv(which === 'in' ? 'animIn' : 'animOut')}
          </label>
          <select
            id={`vs-anim-${which}`}
            className="vs-select"
            value={kind}
            onChange={(e) => set({ [which]: e.target.value as AnimKind }, which)}
          >
            {ANIM_KINDS.map((k) => (
              <option key={k} value={k}>
                {tv(`anim_${k}` as VideoKey)}
              </option>
            ))}
          </select>
        </div>
        {kind !== 'none' && (
          <Slider
            id={`vs-anim-${which}-d`}
            label={tv('animDur')}
            value={d}
            min={0.1}
            max={max}
            step={0.05}
            unit="s"
            onChange={(v) => set({ [which === 'in' ? 'inD' : 'outD']: v }, `${which}D`, true)}
          />
        )}
      </>
    );
  };
  return (
    <>
      <div className="vs-panel-sub">{tv('secAnim')}</div>
      {side('in')}
      {side('out')}
    </>
  );
}

function TransitionSection({ clip }: { clip: Clip }) {
  const project = useV((s) => s.project);
  const tr = clip.transition;
  const w = transitionWindow(project, clip);
  const set = (next: Transition | undefined, merge = false) =>
    (merge ? commitMerged : commit)(
      setTransition(getV().project, clip.id, next),
      `${tv('editTransition')} ${clip.id}`,
    );
  return (
    <>
      <div className="vs-panel-sub">{tv('secTransition')}</div>
      <div className="vs-prop">
        <label className="vs-prop-label" htmlFor="vs-tr">
          {tv('editTransition')}
        </label>
        <select
          id="vs-tr"
          className="vs-select"
          value={tr?.kind ?? ''}
          onChange={(e) =>
            set(
              e.target.value
                ? { kind: e.target.value as TransitionKind, d: tr?.d ?? TRANSITION_DEFAULT }
                : undefined,
            )
          }
        >
          <option value="">{tv('trNone')}</option>
          {TRANSITION_KINDS.map((k) => (
            <option key={k} value={k}>
              {tv(`tr_${k}` as VideoKey)}
            </option>
          ))}
        </select>
      </div>
      {tr && (
        <>
          <Slider
            id="vs-tr-d"
            label={tv('trDur')}
            value={w?.d ?? tr.d}
            min={TRANSITION_MIN}
            max={TRANSITION_MAX}
            step={0.05}
            unit="s"
            onChange={(d) => set({ kind: tr.kind, d }, true)}
          />
          <p className="vs-dim vs-note">{w?.prev ? tv('trJoin') : tv('trReveal')}</p>
        </>
      )}
    </>
  );
}

const FX_UI: Record<EffectKey, { step: number; unit: string; factor?: number }> = {
  brightness: { step: 0.01, unit: '%', factor: 100 },
  contrast: { step: 0.01, unit: '%', factor: 100 },
  saturation: { step: 0.01, unit: '%', factor: 100 },
  hue: { step: 1, unit: '°' },
  sepia: { step: 0.01, unit: '%', factor: 100 },
  grayscale: { step: 0.01, unit: '%', factor: 100 },
  blur: { step: 0.5, unit: 'px' },
};

function EffectsSection({ clip }: { clip: Clip }) {
  const fx = clip.effects ?? {};
  return (
    <>
      <div className="vs-panel-sub vs-sub-row">
        <span>{tv('secEffects')}</span>
        <button
          className="vs-mini"
          disabled={!clip.effects}
          onClick={() =>
            commit(setEffects(getV().project, new Set([clip.id]), undefined), tv('editEffects'))
          }
        >
          {tv('fxReset')}
        </button>
      </div>
      {EFFECT_KEYS.map((k) => (
        <Slider
          key={k}
          id={`vs-fx-${k}`}
          label={tv(`fx_${k}` as VideoKey)}
          value={fx[k] ?? 0}
          min={EFFECT_RANGE[k][0]}
          max={EFFECT_RANGE[k][1]}
          step={FX_UI[k].step}
          unit={FX_UI[k].unit}
          factor={FX_UI[k].factor}
          onChange={(v) =>
            commitMerged(
              setEffect(getV().project, clip.id, k, v),
              `${tv('editEffects')} ${k} ${clip.id}`,
            )
          }
        />
      ))}
    </>
  );
}
