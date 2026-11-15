import { useEffect, useRef, useState } from 'react';
import type { VideoJobView } from '../../../shared/api';
import type { ExportOptions } from '../../../shared/video';
import {
  EXPORT_PRESETS,
  RESOLUTIONS,
  FPS_CHOICES,
  defaultExport,
  estimateSize,
  projectDuration,
  sizeFor,
} from '../../../shared/video';
import { api, toast } from '../../store';
import { Icon } from '../Icon';
import { fmtBytes, fmtDuration, tv } from './strings';
import { getV, holdEscape, setV, useV } from './videoStore';

export function ExportDialog() {
  const project = useV((s) => s.project);
  const total = projectDuration(project);
  const hasRange = project.inPoint != null || project.outPoint != null;
  const [presetId, setPresetId] = useState(EXPORT_PRESETS[0]!.id);
  const [opts, setOpts] = useState<ExportOptions>(() => defaultExport(project));
  const [range, setRange] = useState<'all' | 'io'>(hasRange ? 'io' : 'all');
  const [busy, setBusy] = useState(false);

  const final: ExportOptions = {
    ...opts,
    start: range === 'io' ? (project.inPoint ?? 0) : 0,
    end: range === 'io' ? (project.outPoint ?? total) : total,
  };
  const short = Math.min(opts.width, opts.height);

  const pickPreset = (id: string) => {
    setPresetId(id);
    const pr = EXPORT_PRESETS.find((x) => x.id === id)!;
    setOpts(defaultExport(project, pr));
  };
  const setShort = (s: number) => setOpts((o) => ({ ...o, ...sizeFor(o.width, o.height, s) }));

  const start = async () => {
    if (!(final.end > final.start)) return toast(tv('exportEmpty'));
    setBusy(true);
    try {
      const out = await api().video.exportPath(project.name);
      if (!out) return;
      await api().video.export(getV().project, final, out);
      setV({ dialog: null });
    } catch (e) {
      toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vs-dialog-bg" onMouseDown={() => setV({ dialog: null })}>
      <div
        className="vs-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tv('exportTitle')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="vs-dialog-head">
          <h2>{tv('exportTitle')}</h2>
          <button
            className="vs-icon-btn"
            aria-label={tv('close')}
            onClick={() => setV({ dialog: null })}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="vs-presets" role="radiogroup" aria-label={tv('preset')}>
          {EXPORT_PRESETS.map((pr) => (
            <button
              key={pr.id}
              role="radio"
              aria-checked={presetId === pr.id}
              className={presetId === pr.id ? 'on' : ''}
              onClick={() => pickPreset(pr.id)}
            >
              {pr.label}
            </button>
          ))}
        </div>
        <div className="vs-form">
          <label>
            <span>{tv('container')}</span>
            <select className="vs-select" value="mp4" disabled>
              <option value="mp4">MP4 · H.264 + AAC</option>
            </select>
          </label>
          <label>
            <span>
              {tv('resolution')} ·{' '}
              <span className="vs-dim">
                {opts.width}×{opts.height}
              </span>
            </span>
            <select
              className="vs-select"
              value={short}
              onChange={(e) => setShort(Number(e.target.value))}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.short}>
                  {r.id}
                </option>
              ))}
              {!RESOLUTIONS.some((r) => r.short === short) && (
                <option value={short}>{short}p</option>
              )}
            </select>
          </label>
          <label>
            <span>{tv('fps')}</span>
            <select
              className="vs-select"
              value={opts.fps}
              onChange={(e) => setOpts({ ...opts, fps: Number(e.target.value) })}
            >
              {[...new Set([...FPS_CHOICES, opts.fps])]
                .sort((x, y) => x - y)
                .map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
            </select>
          </label>
          <label title={tv('qualityHint')}>
            <span>
              {tv('quality2')} · {opts.crf}
            </span>
            <input
              type="range"
              min={14}
              max={32}
              value={opts.crf}
              onChange={(e) => setOpts({ ...opts, crf: Number(e.target.value) })}
            />
          </label>
          <label>
            <span>{tv('speed')}</span>
            <select
              className="vs-select"
              value={opts.preset}
              onChange={(e) =>
                setOpts({ ...opts, preset: e.target.value as ExportOptions['preset'] })
              }
            >
              <option value="veryfast">{tv('speedVeryfast')}</option>
              <option value="fast">{tv('speedFast')}</option>
              <option value="medium">{tv('speedMedium')}</option>
              <option value="slow">{tv('speedSlow')}</option>
            </select>
          </label>
          <label>
            <span>{tv('audioBitrate')}</span>
            <select
              className="vs-select"
              value={opts.audioKbps}
              onChange={(e) => setOpts({ ...opts, audioKbps: Number(e.target.value) })}
            >
              {[96, 128, 192, 256, 320].map((k) => (
                <option key={k} value={k}>
                  AAC {k} kbps
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{tv('range')}</span>
            <select
              className="vs-select"
              value={range}
              onChange={(e) => setRange(e.target.value as 'all' | 'io')}
            >
              <option value="all">{tv('rangeAll')}</option>
              <option value="io" disabled={!hasRange}>
                {tv('rangeInOut')}
              </option>
            </select>
          </label>
        </div>
        <div className="vs-dialog-foot">
          <span className="vs-dim">
            {tv('estimate', {
              size: `~${fmtBytes(estimateSize(final))}`,
              dur: fmtDuration(final.end - final.start),
            })}
          </span>
          <div className="spacer" />
          <button onClick={() => setV({ dialog: null })}>{tv('cancel')}</button>
          <button
            className="primary"
            disabled={busy || !(final.end > final.start)}
            onClick={() => void start()}
          >
            {busy ? tv('preparing') : tv('startExport')}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATE_KEY = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  error: 'error',
  canceled: 'canceled',
} as const;

/**
 * The jobs of this session: a button in the top bar with a drop-down list. It opens by itself when
 * an export starts, and can be hidden so it never sits on top of the editor for long.
 */
export function RenderQueue() {
  const jobs = useV((s) => s.jobs);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const active = jobs.filter((j) => j.state === 'running' || j.state === 'queued');
  const running = jobs.find((j) => j.state === 'running');
  const count = jobs.length;
  // A new export shows the list.
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current) setOpen(true);
    seen.current = count;
  }, [count]);
  useEffect(() => {
    if (!open) return;
    const release = holdEscape(() => setOpen(false));
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => {
      release();
      window.removeEventListener('mousedown', away);
    };
  }, [open]);
  if (!count) return null;
  const pct = running ? Math.round(running.progress * 100) : null;
  return (
    <div className="vs-queue-wrap" ref={box}>
      <button
        className={`vs-ghost vs-queue-btn ${open ? 'on' : ''}`}
        title={tv('queue')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        {active.length ? <span className="vs-spinner" /> : <Icon name="film" size={14} />}
        <span className="vs-queue-label">{pct != null ? `${pct} %` : tv('showQueue')}</span>
        {active.length > 0 && <span className="vs-count">{active.length}</span>}
      </button>
      {open && (
        <div className="vs-queue" role="dialog" aria-label={tv('queue')} aria-live="polite">
          <div className="vs-queue-head">
            <Icon name="film" size={14} />
            <span>{tv('queue')}</span>
            <div className="spacer" />
            <button
              className="vs-icon-btn"
              title={tv('hideQueue')}
              aria-label={tv('hideQueue')}
              onClick={() => setOpen(false)}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="vs-queue-list">
            {jobs
              .slice(-6)
              .reverse()
              .map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: VideoJobView }) {
  const pct = Math.round(job.progress * 100);
  const name = job.out.split(/[\\/]/).pop();
  return (
    <div className={`vs-job vs-job-${job.state}`}>
      <div className="vs-job-top">
        <span className="vs-ellipsis" title={job.out}>
          {name}
        </span>
        <span className="vs-dim">
          {tv(STATE_KEY[job.state])}
          {job.state === 'running' &&
            ` · ${pct} %${job.eta != null ? ` · ${tv('eta', { t: fmtDuration(job.eta) })}` : ''}`}
        </span>
      </div>
      {(job.state === 'running' || job.state === 'queued') && (
        <div
          className="vs-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      {job.state === 'error' && <div className="vs-warn vs-job-err">{job.error}</div>}
      <div className="vs-job-actions">
        {(job.state === 'running' || job.state === 'queued') && (
          <button className="vs-mini" onClick={() => void api().video.cancel(job.id)}>
            {tv('cancelJob')}
          </button>
        )}
        {job.state === 'done' && (
          <button className="vs-mini" onClick={() => void api().video.reveal(job.out)}>
            {tv('openFolder')}
          </button>
        )}
        {job.state !== 'running' && job.state !== 'queued' && (
          <button
            className="vs-mini"
            onClick={() => setV((s) => ({ jobs: s.jobs.filter((x) => x.id !== job.id) }))}
            aria-label={tv('close')}
          >
            <Icon name="x" size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
