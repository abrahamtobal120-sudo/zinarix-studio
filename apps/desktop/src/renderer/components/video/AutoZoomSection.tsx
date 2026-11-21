/**
 * Fase 4 (mejora): the auto zoom part of the inspector. Shown on clips of screen recordings
 * that have a cursor path: how much to zoom, apply (replaces the clip's scale / x / y keys,
 * one undo step) and remove.
 */
import { useEffect, useState } from 'react';
import type { Clip, MediaItem } from '../../../shared/video';
import { ZOOM_DEFAULTS, ZOOM_MAX, ZOOM_MIN, hasZoom } from '../../../shared/videoZoom';
import { toast } from '../../store';
import { cursorTrackOf, unzoomClip, zoomClip } from './autoZoom';
import { t4 } from './fase4Strings';
import { commit, getV } from './videoStore';

export function AutoZoomSection({ clip, media }: { clip: Clip; media: MediaItem }) {
  const [has, setHas] = useState(false);
  const [scale, setScale] = useState(ZOOM_DEFAULTS.scale);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setHas(false);
    if (media.kind === 'video') void cursorTrackOf(media.path).then((t) => live && setHas(!!t));
    return () => {
      live = false;
    };
  }, [media.path, media.kind]);
  if (!has) return null;
  const apply = async () => {
    setBusy(true);
    try {
      const z = await zoomClip(getV().project, clip.id, { scale });
      if ('project' in z) {
        commit(z.project, t4('zoomTitle'));
        toast(t4('zoomDone', { n: z.rests }));
      } else toast(t4(z.error === 'none' ? 'zoomNone' : 'zoomNoTrack'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="vs-panel-sub">{t4('zoomTitle')}</div>
      <p className="vs-dim vs-note">{t4('zoomHint')}</p>
      <div className="vs-prop-block">
        <div className="vs-slider-head">
          <label className="vs-prop-label" htmlFor="vs-zoom-amount">
            {t4('zoomAmount')}
          </label>
          <code>{scale.toFixed(1)}×</code>
        </div>
        <input
          id="vs-zoom-amount"
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.1}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          onDoubleClick={() => setScale(ZOOM_DEFAULTS.scale)}
        />
      </div>
      <div className="vs-prop-block vs-chips">
        <button className="vs-chip" disabled={busy} onClick={() => void apply()}>
          {t4('zoomApply')}
        </button>
        {hasZoom(clip) && (
          <button
            className="vs-chip"
            onClick={() => commit(unzoomClip(getV().project, clip.id), t4('zoomRemove'))}
          >
            {t4('zoomRemove')}
          </button>
        )}
      </div>
      {hasZoom(clip) && <p className="vs-dim vs-note">{t4('zoomOn')}</p>}
    </>
  );
}
