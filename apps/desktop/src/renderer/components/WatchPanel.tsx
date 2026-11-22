import { useEffect, useState } from 'react';
import type { WatchItem, WatchReport, WatchSettings } from '../../shared/api';
import { errText } from '../errText';
import { lang, t } from '../i18n';
import { api, openFile, setState, toast, useStore } from '../store';
import { askAgent } from './Chat';
import { Icon } from './Icon';

const EVERY = [30, 60, 120, 240, 480, 1440];
const PER_DAY = [1, 2, 4, 8, 12];

// Dates in the app's language (not the system's), like the rest of the UI.
const DATE_FMT = new Intl.DateTimeFormat(lang, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const time = (ts: number) => DATE_FMT.format(ts);

const every = (min: number) =>
  min < 60 ? t('wtMinutes', { n: min }) : t('wtHours', { n: min / 60 });

/** "src/a.ts:12" -> the file and the line, to open it in the editor. */
function place(file: string): { path: string; line?: number } {
  const m = /^(.*?):(\d+)(?:[-:]\d+)?$/.exec(file);
  return m ? { path: m[1]!, line: Number(m[2]) } : { path: file };
}

function fixPrompt(r: WatchReport, it: WatchItem): string {
  return t('wtFixPrompt', {
    kind: it.kind === 'fix' ? t('wtKindFix') : t('wtKindImprove'),
    body: `**${it.title}**${it.file ? ` (${it.file})` : ''}\n${it.detail}`,
  });
}

/**
 * The auto review panel: its state and the "review now" button on top, the reviews in the
 * middle (what matters), and the settings folded at the bottom.
 */
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
      toast(errText(e));
    } finally {
      setRunning(false);
    }
  };
  const busy = running || Boolean(watch.busy);
  const state = busy ? 'busy' : s.enabled ? 'on' : 'off';
  const status = watch.busy
    ? t('wtBusy', { name: watch.busy.split(/[\\/]/).pop() ?? '' })
    : t('wtToday', { n: watch.reviewsToday, max: s.maxPerDay }) +
      (s.enabled && watch.nextAt && watch.nextAt > Date.now()
        ? ` · ${t('wtNext', { at: time(watch.nextAt) })}`
        : '');

  return (
    <div className="run-panel">
      <div className="sidebar-title">
        <span>{t('wtTitle')}</span>
      </div>
      <div className="run-body">
        <div className={`watch-status watch-${state}`}>
          <div className="watch-status-line">
            <span className="watch-dot" />
            <strong>
              {state === 'busy' ? t('wtStateBusy') : state === 'on' ? t('wtStateOn') : t('wtStateOff')}
            </strong>
          </div>
          <div className="dim small">{status}</div>
          <button className="primary run-main" disabled={busy || !root} onClick={() => void runNow()}>
            <Icon name={busy ? 'refresh' : 'eye'} size={14} /> {busy ? t('wtReviewing') : t('wtRunNow')}
          </button>
          {!root && <div className="dim small">{t('wtNoProject')}</div>}
        </div>
        {watch.lastError && <p className="watch-error small">{watch.lastError}</p>}

        {watch.reports.length === 0 && <p className="watch-empty dim small">{t('wtNone')}</p>}
        {watch.reports.map((r) => {
          const fixes = r.items.filter((it) => it.kind === 'fix').length;
          const improves = r.items.length - fixes;
          return (
            <div key={r.id} className="watch-report">
              <div className="watch-head">
                <div className="watch-head-text">
                  <strong>{r.name}</strong>
                  <span className="dim small">{time(r.ts)}</span>
                </div>
                <button
                  className="link"
                  title={t('wtDismiss')}
                  aria-label={t('wtDismiss')}
                  onClick={() =>
                    void api()
                      .watch.dismiss(r.id)
                      .then((w) => setState({ watch: w }))
                  }
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
              {(fixes > 0 || improves > 0) && (
                <div className="watch-counts">
                  {fixes > 0 && (
                    <span className="watch-chip watch-chip-fix">{t('wtFixes', { n: fixes })}</span>
                  )}
                  {improves > 0 && (
                    <span className="watch-chip watch-chip-improve">
                      {t('wtImproves', { n: improves })}
                    </span>
                  )}
                </div>
              )}
              {r.summary && <p className="small watch-summary">{r.summary}</p>}
              {r.items.length === 0 && (
                <p className="dim small watch-ok">
                  <Icon name="check" size={12} /> {t('wtAllGood')}
                </p>
              )}
              {r.items.map((it, i) => (
                <div key={i} className={`watch-item watch-${it.kind}`}>
                  <div className="watch-item-title">
                    <span className="run-badge">{it.kind === 'fix' ? t('wtFix') : t('wtImprove')}</span>
                    {it.title}
                  </div>
                  <div className="small watch-detail">{it.detail}</div>
                  <div className="watch-actions">
                    {it.file && r.project === root && (
                      <button
                        className="link small"
                        title={t('wtOpenFile')}
                        onClick={() => {
                          const p = place(it.file!);
                          void openFile(p.path, p.line ? { line: p.line, column: 1 } : undefined);
                        }}
                      >
                        <Icon name="file" size={12} /> {it.file}
                      </button>
                    )}
                    <button
                      className="link small"
                      disabled={r.project !== root}
                      title={r.project !== root ? t('wtOtherProject') : undefined}
                      onClick={() => askAgent(fixPrompt(r, it))}
                    >
                      <Icon name="agent" size={12} /> {t('wtAskAgent')}
                    </button>
                  </div>
                </div>
              ))}
              <div className="dim small watch-meta">
                {r.model}
                {r.usd != null ? ` · $${r.usd.toFixed(4)}` : ''}
              </div>
            </div>
          );
        })}

        <details className="watch-settings">
          <summary>
            <Icon name="settings" size={12} /> {t('wtSettings')}
          </summary>
          <p className="dim small">{t('wtHint')}</p>
          <label className="watch-row watch-check">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => void configure({ enabled: e.target.checked })}
            />
            <span>{t('wtEnabled')}</span>
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
        </details>
      </div>
    </div>
  );
}
