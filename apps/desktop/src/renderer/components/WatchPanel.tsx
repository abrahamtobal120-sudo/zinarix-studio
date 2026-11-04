import { useEffect, useState } from 'react';
import type { WatchItem, WatchReport, WatchSettings } from '../../shared/api';
import { t } from '../i18n';
import { api, openFile, setState, toast, useStore } from '../store';
import { askAgent } from './Chat';
import { Icon } from './Icon';

const EVERY = [30, 60, 120, 240, 480, 1440];
const PER_DAY = [1, 2, 4, 8, 12];

const time = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const every = (min: number) => (min < 60 ? `${min} min` : `${min / 60} h`);

/** "src/a.ts:12" -> the file and the line, to open it in the editor. */
function place(file: string): { path: string; line?: number } {
  const m = /^(.*?):(\d+)(?:[-:]\d+)?$/.exec(file);
  return m ? { path: m[1]!, line: Number(m[2]) } : { path: file };
}

function fixPrompt(r: WatchReport, it: WatchItem): string {
  return (
    `El Vigía revisó el proyecto y sugiere esto (${it.kind === 'fix' ? 'arreglo' : 'mejora'}):\n\n` +
    `**${it.title}**${it.file ? ` (${it.file})` : ''}\n${it.detail}\n\n` +
    'Revisa si sigue aplicando y, si es así, hazlo.'
  );
}

export function WatchPanel() {
  const watch = useStore((s) => s.watch);
  const root = useStore((s) => s.workspace?.root);
  const models = useStore((s) => s.models);
  const [running, setRunning] = useState(false);

  // Opening the panel means the new reports were seen.
  const unseen = watch?.reports.some((r) => !r.seen) ?? false;
  useEffect(() => {
    if (unseen)
      void api()
        .watch.seen()
        .then((w) => setState({ watch: w }));
  }, [unseen]);

  if (!watch) return <div className="sidebar-empty dim small">…</div>;
  const s = watch.settings;
  const configure = async (patch: Partial<WatchSettings>) =>
    setState({ watch: await api().watch.configure(patch) });
  const runNow = async () => {
    setRunning(true);
    try {
      setState({ watch: await api().watch.runNow() });
    } catch (e) {
      toast(String((e as Error).message ?? e));
    } finally {
      setRunning(false);
    }
  };
  const busy = running || Boolean(watch.busy);

  return (
    <div className="run-panel">
      <div className="sidebar-title">
        <span>{t('wtTitle').toUpperCase()}</span>
        <span className="sidebar-actions">
          <button title={t('wtRunNow')} disabled={busy || !root} onClick={() => void runNow()}>
            <Icon name="refresh" size={14} />
          </button>
        </span>
      </div>
      <div className="run-body">
        <p className="dim small">{t('wtHint')}</p>
        <label className="watch-row">
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => void configure({ enabled: e.target.checked })}
          />
          {t('wtEnabled')}
        </label>
        <label className="watch-row">
          <span>{t('wtEvery')}</span>
          <select
            value={s.everyMin}
            onChange={(e) => void configure({ everyMin: Number(e.target.value) })}
          >
            {[...new Set([...EVERY, s.everyMin])].map((m) => (
              <option key={m} value={m}>
                {every(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="watch-row">
          <span>{t('wtPerDay')}</span>
          <select
            value={s.maxPerDay}
            onChange={(e) => void configure({ maxPerDay: Number(e.target.value) })}
          >
            {[...new Set([...PER_DAY, s.maxPerDay])].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="watch-row">
          <span>{t('wtModel')}</span>
          <select
            value={s.model ?? ''}
            onChange={(e) => void configure({ model: e.target.value || null })}
          >
            <option value="">{t('wtModelChat')}</option>
            {models.map((m) => {
              const ref = `${m.provider}/${m.id}`;
              return (
                <option key={ref} value={ref}>
                  {ref}
                </option>
              );
            })}
          </select>
        </label>
        <p className="dim small">
          {watch.busy
            ? t('wtBusy', { name: watch.busy.split(/[\\/]/).pop() ?? '' })
            : t('wtToday', { n: watch.reviewsToday, max: s.maxPerDay }) +
              (s.enabled && watch.nextAt && watch.nextAt > Date.now()
                ? ` · ${t('wtNext', { at: time(watch.nextAt) })}`
                : '')}
        </p>
        {watch.lastError && <p className="watch-error small">{watch.lastError}</p>}
        <button className="primary run-main" disabled={busy || !root} onClick={() => void runNow()}>
          <Icon name="eye" size={14} /> {busy ? t('wtReviewing') : t('wtRunNow')}
        </button>

        {watch.reports.length === 0 && <p className="dim small">{t('wtNone')}</p>}
        {watch.reports.map((r) => (
          <div key={r.id} className="watch-report">
            <div className="run-section watch-head">
              <span>
                {r.name} · {time(r.ts)}
              </span>
              <button
                className="link"
                title={t('wtDismiss')}
                onClick={() =>
                  void api()
                    .watch.dismiss(r.id)
                    .then((w) => setState({ watch: w }))
                }
              >
                <Icon name="x" size={12} />
              </button>
            </div>
            {r.summary && <p className="small">{r.summary}</p>}
            {r.items.length === 0 && <p className="dim small">{t('wtAllGood')}</p>}
            {r.items.map((it, i) => (
              <div key={i} className={`watch-item watch-${it.kind}`}>
                <div className="watch-item-title">
                  <span className="run-badge">
                    {it.kind === 'fix' ? t('wtFix') : t('wtImprove')}
                  </span>
                  {it.title}
                </div>
                <div className="small">{it.detail}</div>
                <div className="watch-actions">
                  {it.file && r.project === root && (
                    <button
                      className="link small"
                      onClick={() => {
                        const p = place(it.file!);
                        void openFile(p.path, p.line ? { line: p.line, column: 1 } : undefined);
                      }}
                    >
                      {it.file}
                    </button>
                  )}
                  <button
                    className="link small"
                    disabled={r.project !== root}
                    title={r.project !== root ? t('wtOtherProject') : undefined}
                    onClick={() => askAgent(fixPrompt(r, it))}
                  >
                    {t('wtAskAgent')}
                  </button>
                </div>
              </div>
            ))}
            <div className="dim small">
              {r.model}
              {r.usd != null ? ` · $${r.usd.toFixed(4)}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
