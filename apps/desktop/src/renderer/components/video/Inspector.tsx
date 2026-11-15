import { useEffect, useState } from 'react';
import { clipDur, mediaOf, projectDuration, timecode, updateClip } from '../../../shared/video';
import { api, toast } from '../../store';
import { fmtBytes, fmtDuration, tv } from './strings';
import { commitMerged, getV, useV } from './videoStore';

export function Inspector() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const clip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
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
                  commitMerged(updateClip(getV().project, clip.id, { volume: Number(e.target.value) }), `${tv('volume')} ${clip.id}`)
                }
              />
            </div>
          )}
          <p className="vs-dim vs-note">{tv('comingPhase', { n: 2 })}</p>
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
        <span className={tools?.ffmpeg ? 'vs-ok' : 'vs-warn'}>{tools ? (tools.ffmpeg ? (tools.version ?? '✓') : '—') : '…'}</span>
      </Row>
      <Row label={tv('cache')}>
        <span>
          {cache == null ? '…' : fmtBytes(cache)}{' '}
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
