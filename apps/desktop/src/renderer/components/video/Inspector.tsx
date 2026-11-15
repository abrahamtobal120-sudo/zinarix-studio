import { useEffect, useState } from 'react';
import type { Clip, MediaItem, Transform } from '../../../shared/video';
import {
  IDENTITY,
  SPEED_MAX,
  SPEED_MIN,
  clipDur,
  mediaOf,
  projectDuration,
  setClipSpeed,
  setFades,
  setTransform,
  speedOf,
  timecode,
  transformOf,
  updateClip,
} from '../../../shared/video';
import { api, toast } from '../../store';
import { fmtBytes, fmtDuration, tv } from './strings';
import { commit, commitMerged, getV, useV } from './videoStore';

export function Inspector() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const clip =
    selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
  const media = clip ? mediaOf(project, clip.mediaId) : undefined;

  return (
    <div className="vs-inspector">
      <div className="vs-panel-title">{tv('inspector')}</div>
      {clip && media ? (
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
          <FadeSection clip={clip} media={media} />
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
  onChange,
}: {
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
        <label className="vs-prop-label" htmlFor={id}>
          {label}
        </label>
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

function TransformSection({ clip }: { clip: Clip }) {
  const tr = transformOf(clip);
  const set = (patch: Partial<Transform>, what: string) =>
    commitMerged(
      setTransform(getV().project, clip.id, patch),
      `${tv('editTransform')} ${what} ${clip.id}`,
    );
  const flip = (patch: Partial<Transform>, label: string) =>
    commit(setTransform(getV().project, clip.id, patch), label);
  return (
    <>
      <div className="vs-panel-sub vs-sub-row">
        <span>{tv('secTransform')}</span>
        <button
          className="vs-mini"
          disabled={!clip.transform}
          onClick={() => flip({ ...IDENTITY }, tv('editTransform'))}
        >
          {tv('resetTransform')}
        </button>
      </div>
      <Slider
        id="vs-tx"
        label={tv('posX')}
        value={tr.x}
        min={-1}
        max={1}
        step={0.005}
        unit="%"
        factor={100}
        onChange={(x) => set({ x }, 'x')}
      />
      <Slider
        id="vs-ty"
        label={tv('posY')}
        value={tr.y}
        min={-1}
        max={1}
        step={0.005}
        unit="%"
        factor={100}
        onChange={(y) => set({ y }, 'y')}
      />
      <Slider
        id="vs-ts"
        label={tv('scale')}
        value={tr.scale}
        min={0.05}
        max={4}
        step={0.01}
        unit="%"
        factor={100}
        onChange={(scale) => set({ scale }, 'scale')}
      />
      <Slider
        id="vs-tr"
        label={tv('rotation')}
        value={tr.rotation}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(rotation) => set({ rotation }, 'rot')}
      />
      <Slider
        id="vs-to"
        label={tv('opacity')}
        value={tr.opacity}
        min={0}
        max={1}
        step={0.01}
        unit="%"
        factor={100}
        onChange={(opacity) => set({ opacity }, 'op')}
      />
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

function FadeSection({ clip, media }: { clip: Clip; media: MediaItem }) {
  if (!media.hasVideo && !media.hasAudio && media.kind !== 'image') return null;
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
