/**
 * Fase 4A: the "Record screen" dialog (pick a screen or window, sound, microphone, camera) and
 * the floating bar shown while recording (time, mic level, pause, stop, discard).
 */
import { useEffect, useState } from 'react';
import type { CaptureSourceView } from '../../../shared/api';
import { confirmDialog } from '../../confirm';
import { api } from '../../store';
import { Icon } from '../Icon';
import { t4 } from './fase4Strings';
import {
  type RecOptions,
  type RecQuality,
  discardRecording,
  elapsed,
  pauseRecording,
  resumeRecording,
  startRecording,
  stopRecording,
  useRec,
} from './screenRecord';
import { setV } from './videoStore';

const OPTS_KEY = 'zvs.rec';
type Saved = Omit<RecOptions, 'sourceId'> & { sourceId?: string };
const DEFAULTS: Saved = {
  system: true,
  mic: '',
  cam: null,
  countdown: true,
  minimize: false,
  addToTimeline: true,
  quality: 'high',
};
function loadOpts(): Saved {
  try {
    return {
      ...DEFAULTS,
      ...(JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') as Partial<Saved>),
    };
  } catch {
    return DEFAULTS;
  }
}

/** "1:05" / "1:02:03". */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function RecordDialog({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<CaptureSourceView[] | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [opts, setOpts] = useState<Saved>(loadOpts);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [err, setErr] = useState('');
  const load = () => {
    setSources(null);
    setErr('');
    void api()
      .video.recSources()
      .then((list) => {
        setSources(list);
        setOpts((o) =>
          list.some((s) => s.id === o.sourceId) ? o : { ...o, sourceId: list[0]?.id },
        );
      })
      .catch((e: Error) => {
        setSources([]);
        setErr(e.message);
      });
  };
  useEffect(() => {
    load();
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => {
        setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default'));
        setCams(d.filter((x) => x.kind === 'videoinput'));
      })
      .catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const patch = (p: Partial<Saved>) => setOpts((o) => ({ ...o, ...p }));
  const shown = (sources ?? []).filter((s) => s.kind === tab);
  const start = () => {
    if (!opts.sourceId) return;
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify(opts));
    } catch {
      // private mode
    }
    onClose();
    void startRecording({ ...opts, sourceId: opts.sourceId });
  };
  const devLabel = (d: MediaDeviceInfo, i: number, base: string) => d.label || `${base} ${i + 1}`;
  return (
    <div className="vs-dialog-bg" onMouseDown={onClose}>
      <div
        className="vs-dialog vs-rec-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t4('recTitle')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="vs-dialog-head">
          <h2>{t4('recTitle')}</h2>
          <button className="vs-icon-btn" aria-label="✕" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="vs-rec-tabs" role="tablist">
          {(['screen', 'window'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? 'on' : ''}
              onClick={() => setTab(k)}
            >
              {t4(k === 'screen' ? 'recScreens' : 'recWindows')}
            </button>
          ))}
          <button className="vs-rec-refresh" onClick={load} title={t4('recRefresh')}>
            <Icon name="refresh" size={13} /> {t4('recRefresh')}
          </button>
        </div>
        {sources === null ? (
          <p className="vs-dim vs-pad">
            <span className="vs-spinner" /> {t4('recLoading')}
          </p>
        ) : !shown.length ? (
          <p className="vs-dim vs-pad">{err || t4('recNoSources')}</p>
        ) : (
          <div className="vs-rec-sources" role="radiogroup" aria-label={t4('recTitle')}>
            {shown.map((s) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={opts.sourceId === s.id}
                className={`vs-rec-source ${opts.sourceId === s.id ? 'on' : ''}`}
                onClick={() => patch({ sourceId: s.id })}
                onDoubleClick={() => {
                  patch({ sourceId: s.id });
                  setTimeout(start, 0);
                }}
                title={s.name}
              >
                {s.thumb ? <img src={s.thumb} alt="" /> : <span className="vs-rec-nothumb" />}
                <span className="vs-rec-name">
                  {s.icon && <img src={s.icon} alt="" className="vs-rec-icon" />}
                  {s.name}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="vs-rec-grid">
          <fieldset>
            <legend>{t4('recAudio')}</legend>
            <label className="vs-check" title={t4('recSystemNote')}>
              <input
                type="checkbox"
                checked={opts.system}
                onChange={(e) => patch({ system: e.target.checked })}
              />
              {t4('recSystem')}
            </label>
            <label className="vs-rec-field">
              {t4('recMic')}
              <select
                value={opts.mic ?? 'none'}
                onChange={(e) => patch({ mic: e.target.value === 'none' ? null : e.target.value })}
              >
                <option value="none">{t4('recNone')}</option>
                <option value="">{t4('recDefault')}</option>
                {mics.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {devLabel(d, i, t4('recMic'))}
                  </option>
                ))}
              </select>
            </label>
            <label className="vs-rec-field">
              {t4('recCam')}
              <select
                value={opts.cam ?? 'none'}
                onChange={(e) => patch({ cam: e.target.value === 'none' ? null : e.target.value })}
              >
                <option value="none">{t4('recNone')}</option>
                <option value="">{t4('recDefault')}</option>
                {cams.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {devLabel(d, i, t4('recCam'))}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>{t4('recOptions')}</legend>
            <label className="vs-rec-field">
              {t4('recQuality')}
              <select
                value={opts.quality}
                onChange={(e) => patch({ quality: e.target.value as RecQuality })}
              >
                {(['high', 'smooth', 'light'] as const).map((q) => (
                  <option key={q} value={q}>
                    {t4(`recQ_${q}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="vs-check">
              <input
                type="checkbox"
                checked={opts.countdown}
                onChange={(e) => patch({ countdown: e.target.checked })}
              />
              {t4('recCountdown')}
            </label>
            <label className="vs-check">
              <input
                type="checkbox"
                checked={opts.minimize}
                onChange={(e) => patch({ minimize: e.target.checked })}
              />
              {t4('recMinimize')}
            </label>
            <label className="vs-check">
              <input
                type="checkbox"
                checked={opts.addToTimeline}
                onChange={(e) => patch({ addToTimeline: e.target.checked })}
              />
              {t4('recAddTimeline')}
            </label>
            <label className="vs-check" title={t4('zoomHint')}>
              <input
                type="checkbox"
                checked={!!opts.autoZoom && opts.addToTimeline}
                disabled={!opts.addToTimeline || !opts.sourceId?.startsWith('screen:')}
                onChange={(e) => patch({ autoZoom: e.target.checked })}
              />
              {t4('recAutoZoom')}
            </label>
          </fieldset>
        </div>
        <div className="vs-dialog-foot">
          <button onClick={onClose}>{t4('recCancel')}</button>
          <button className="primary vs-rec-go" disabled={!opts.sourceId} onClick={start}>
            <span className="vs-rec-dot" /> {t4('recStart')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The bar while recording (also when the studio is minimized). */
export function RecordBar() {
  const phase = useRec((s) => s.phase);
  const count = useRec((s) => s.count);
  const shortcut = useRec((s) => s.shortcut);
  const level = useRec((s) => s.level);
  const [, tick] = useState(0);
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [phase]);
  if (phase === 'idle') return null;
  if (phase === 'countdown')
    return (
      <div className="vs-rec-countdown" aria-live="assertive">
        <span>{count}</span>
        <button onClick={() => void discardRecording()}>{t4('recDiscard')}</button>
      </div>
    );
  const live = phase === 'recording' || phase === 'paused';
  return (
    <div className={`vs-rec-bar ${phase}`} role="status">
      <span className="vs-rec-dot" />
      {phase === 'saving' || phase === 'starting' ? (
        <span>
          <span className="vs-spinner" /> {phase === 'saving' ? t4('recSaving') : t4('recLoading')}
        </span>
      ) : (
        <>
          <code className="vs-rec-time">{clock(elapsed())}</code>
          {phase === 'paused' && <span className="vs-rec-paused">{t4('recPausedTag')}</span>}
          <span className="vs-rec-level" aria-hidden="true">
            <span style={{ width: `${Math.round(Math.min(1, level * 1.6) * 100)}%` }} />
          </span>
        </>
      )}
      {live && (
        <>
          <button
            onClick={() => (phase === 'paused' ? resumeRecording() : pauseRecording())}
            title={phase === 'paused' ? t4('recResume') : t4('recPause')}
          >
            {phase === 'paused' ? t4('recResume') : t4('recPause')}
          </button>
          <button
            className="primary"
            onClick={() => {
              setV({ open: true, minimized: false });
              void stopRecording();
            }}
            title={shortcut ? t4('recShortcut', { key: shortcut }) : t4('recStop')}
          >
            ■ {t4('recStop')}
          </button>
          <button
            className="vs-icon-btn"
            title={t4('recDiscard')}
            aria-label={t4('recDiscard')}
            onClick={() =>
              void confirmDialog(t4('recDiscardAsk'), { danger: true }).then(
                (ok) => ok && void discardRecording(),
              )
            }
          >
            <Icon name="trash" size={14} />
          </button>
        </>
      )}
      {live && shortcut && <span className="vs-dim vs-rec-key">{shortcut}</span>}
    </div>
  );
}
