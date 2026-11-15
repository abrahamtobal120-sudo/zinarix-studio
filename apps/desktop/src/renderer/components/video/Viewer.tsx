import { useEffect, useRef, useState } from 'react';
import { projectDuration, timecode } from '../../../shared/video';
import { toast } from '../../store';
import { Icon } from '../Icon';
import { Player } from './player';
import { tv } from './strings';
import { getV, seek, setV, useV } from './videoStore';

export const player = new Player();

export function togglePlay(): void {
  const s = getV();
  const end = projectDuration(s.project);
  if (!end) return;
  if (s.playing && s.rate === 1) return setV({ playing: false });
  // At the end: start over.
  if (!s.playing && s.playhead >= end - 1 / s.project.fps) setV({ playhead: 0 });
  setV({ playing: true, rate: 1 });
  player.resync();
}

/** J / K / L: each J or L press doubles the speed in that direction; K stops. */
export function shuttle(dir: -1 | 0 | 1): void {
  const s = getV();
  if (dir === 0) return setV({ playing: false, rate: 1 });
  const same = s.playing && Math.sign(s.rate) === dir;
  const rate = same ? Math.max(-8, Math.min(8, s.rate * 2)) : dir;
  setV({ playing: true, rate });
  player.resync();
}

export function stepFrame(n: number): void {
  const s = getV();
  setV({ playing: false });
  seek(s.playhead + n / s.project.fps);
}

export function Viewer() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const project = useV((s) => s.project);
  const playing = useV((s) => s.playing);
  const rate = useV((s) => s.rate);
  const quality = useV((s) => s.quality);
  const hasClips = useV((s) => s.project.clips.length > 0);
  const [fit, setFit] = useState({ w: 0, h: 0 });

  useEffect(() => {
    player.attach(canvas.current);
    player.start();
    return () => player.dispose();
  }, []);

  // Largest frame of the project's aspect that fits the viewer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / project.width, r.height / project.height);
      setFit({
        w: Math.max(0, Math.floor(project.width * k)),
        h: Math.max(0, Math.floor(project.height * k)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  const snapshot = async () => {
    const cv = canvas.current;
    if (!cv) return;
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(
        tv('snapshotSaved', { name: `${project.name} ${timecode(getV().playhead, project.fps)}` }),
      );
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="vs-viewer">
      <div
        className="vs-viewer-stage"
        ref={box}
        onDoubleClick={() => void box.current?.requestFullscreen()}
      >
        <canvas
          ref={canvas}
          className="vs-canvas"
          style={{ width: fit.w, height: fit.h }}
          aria-label={tv('title')}
        />
        {!hasClips && <div className="vs-viewer-empty">{tv('emptyViewer')}</div>}
      </div>
      <div className="vs-transport">
        <div className="vs-transport-left">
          <Timecode />
        </div>
        <div className="vs-transport-mid">
          <button
            className="vs-icon-btn"
            title={tv('toStart')}
            aria-label={tv('toStart')}
            onClick={() => seek(0)}
          >
            <Icon name="back" size={16} />
          </button>
          <button
            className="vs-icon-btn"
            title={tv('prevFrame')}
            aria-label={tv('prevFrame')}
            onClick={() => stepFrame(-1)}
          >
            <Icon name="chevron" size={16} className="vs-flip" />
          </button>
          <button
            className="vs-play"
            title={playing ? tv('pause') : tv('play')}
            aria-label={playing ? tv('pause') : tv('play')}
            onClick={togglePlay}
          >
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <button
            className="vs-icon-btn"
            title={tv('nextFrame')}
            aria-label={tv('nextFrame')}
            onClick={() => stepFrame(1)}
          >
            <Icon name="chevron" size={16} />
          </button>
          <button
            className="vs-icon-btn"
            title={tv('toEnd')}
            aria-label={tv('toEnd')}
            onClick={() => seek(projectDuration(getV().project))}
          >
            <Icon name="back" size={16} className="vs-flip" />
          </button>
          {playing && rate !== 1 && (
            <span className="vs-rate">{rate > 0 ? `${rate}×` : `◀ ${-rate}×`}</span>
          )}
        </div>
        <div className="vs-transport-right">
          <span className="vs-dim">{`${project.width}×${project.height} · ${project.fps} fps`}</span>
          <select
            className="vs-select"
            title={tv('quality')}
            aria-label={tv('quality')}
            value={quality}
            onChange={(e) => setV({ quality: Number(e.target.value) as 1 | 0.5 | 0.25 })}
          >
            <option value={1}>{tv('full')}</option>
            <option value={0.5}>{tv('half')}</option>
            <option value={0.25}>{tv('quarter')}</option>
          </select>
          <button
            className="vs-icon-btn"
            title={tv('snapshot')}
            aria-label={tv('snapshot')}
            onClick={() => void snapshot()}
          >
            <Icon name="image" size={16} />
          </button>
          <button
            className="vs-icon-btn"
            title={tv('fullscreen')}
            aria-label={tv('fullscreen')}
            onClick={() => void box.current?.requestFullscreen()}
          >
            <Icon name="maximize" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Timecode() {
  const t = useV((s) => s.playhead);
  const fps = useV((s) => s.project.fps);
  const total = useV((s) => projectDuration(s.project));
  return (
    <span className="vs-timecode">
      <b>{timecode(t, fps)}</b> / {timecode(total, fps)}
    </span>
  );
}
