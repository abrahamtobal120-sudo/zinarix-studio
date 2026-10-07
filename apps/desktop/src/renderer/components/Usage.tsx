import { useEffect, useMemo, useState } from 'react';
import type { UsageReport, UsageRowView } from '../../shared/api';
import { t } from '../i18n';
import { api, refreshSettings, setState } from '../store';

const COLORS = [
  '#3b82f6',
  '#a855f7',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#6366f1',
  '#14b8a6',
];

function usd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Credits consumed per provider: today, this month, 30-day chart and monthly budgets. */
export function UsagePanel() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [period, setPeriod] = useState<'today' | 'month'>('month');
  const [editing, setEditing] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const close = () => setState({ modal: null });

  const load = async () => setReport(await api().ai.usage());
  useEffect(() => {
    void load();
  }, []);

  const providers = useMemo(() => {
    if (!report) return [] as string[];
    const all = new Set([
      ...report.month.map((r) => r.provider),
      ...report.days.map((d) => d.provider),
    ]);
    return [...all];
  }, [report]);
  const color = (p: string) => COLORS[providers.indexOf(p) % COLORS.length]!;

  const chart = useMemo(() => {
    if (!report)
      return {
        days: [] as { day: string; parts: { provider: string; cost: number }[]; total: number }[],
        max: 0,
      };
    const days: { day: string; parts: { provider: string; cost: number }[]; total: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = localDay(new Date(Date.now() - i * 86_400_000));
      const parts = report.days
        .filter((d) => d.day === day)
        .map((d) => ({ provider: d.provider, cost: d.costUsd }));
      days.push({ day, parts, total: parts.reduce((s, p) => s + p.cost, 0) });
    }
    return { days, max: Math.max(0, ...days.map((d) => d.total)) };
  }, [report]);

  if (!report) {
    return (
      <div className="modal-backdrop" onMouseDown={close}>
        <div className="usage" onMouseDown={(e) => e.stopPropagation()}>
          …
        </div>
      </div>
    );
  }

  const rows: UsageRowView[] = period === 'today' ? report.today : report.month;
  const total = (r: UsageRowView[]) => r.reduce((s, x) => s + x.costUsd, 0);
  const totalReq = report.month.reduce((s, x) => s + x.requests, 0);
  const monthName = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const saveBudget = async (provider: string) => {
    const n = Number(budgetInput.replace(',', '.'));
    await api().ai.setBudget(provider, Number.isFinite(n) && n > 0 ? { monthly: n } : null);
    setEditing(null);
    await load();
    await refreshSettings();
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="usage" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} aria-label="Cerrar">
          ×
        </button>
        <h2>📊 {t('usageTitle')}</h2>
        <div className="usage-cards">
          <div className="usage-card">
            <span className="dim">{t('usageToday')}</span>
            <strong>{usd(total(report.today))}</strong>
            <span className="dim small">
              {t('nRequests', { n: report.today.reduce((s, x) => s + x.requests, 0) })}
            </span>
          </div>
          <div className="usage-card">
            <span className="dim">{t('usageMonth')}</span>
            <strong>{usd(total(report.month))}</strong>
            <span className="dim small">{monthName}</span>
          </div>
          <div className="usage-card">
            <span className="dim">{t('usageRequests')}</span>
            <strong>{totalReq}</strong>
            <span className="dim small">{t('nProviders', { n: report.month.length })}</span>
          </div>
        </div>

        <div className="usage-chart-head">
          <span>{t('last30')}</span>
          <span className="usage-legend">
            {providers.map((p) => (
              <span key={p}>
                <i style={{ background: color(p) }} />{' '}
                {report.month.find((r) => r.provider === p)?.name ?? p}
              </span>
            ))}
          </span>
        </div>
        <div className="usage-chart">
          {chart.days.map((d) => (
            <div key={d.day} className="usage-bar" title={`${d.day} · ${usd(d.total)}`}>
              <div
                className="usage-stack"
                style={{ height: chart.max ? `${(d.total / chart.max) * 100}%` : '0%' }}
              >
                {d.parts.map((p) => (
                  <div
                    key={p.provider}
                    style={{ flex: d.total ? p.cost / d.total : 1, background: color(p.provider) }}
                  />
                ))}
              </div>
              <span className="usage-day">{Number(d.day.slice(-2))}</span>
            </div>
          ))}
        </div>

        <div className="usage-tabs">
          <button className={period === 'today' ? 'on' : ''} onClick={() => setPeriod('today')}>
            {t('usageToday')}
          </button>
          <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>
            {t('usageMonth')}
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="dim usage-empty">{t('usageNone')}</p>
        ) : (
          <table className="usage-table">
            <thead>
              <tr>
                <th>{t('provider')}</th>
                <th className="num">{t('usageRequests')}</th>
                <th className="num">{t('priceIn').split(' ')[0]}</th>
                <th className="num">{t('priceOut').split(' ')[0]}</th>
                <th className="num">{t('cost')}</th>
                <th>{t('monthlyBudget')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const budget = report.budgets[r.provider]?.monthly;
                const monthSpend =
                  report.month.find((m) => m.provider === r.provider)?.costUsd ?? 0;
                const pct = budget ? Math.min(100, (monthSpend / budget) * 100) : 0;
                return (
                  <tr key={r.provider}>
                    <td>
                      <i className="usage-dot" style={{ background: color(r.provider) }} /> {r.name}
                    </td>
                    <td className="num">{r.requests}</td>
                    <td className="num">{tokens(r.inputTokens)}</td>
                    <td className="num">{tokens(r.outputTokens)}</td>
                    <td className="num">
                      <strong>{usd(r.costUsd)}</strong>
                      {r.unpricedRequests > 0 && (
                        <span className="dim small" title={t('unpricedHint')}>
                          {' '}
                          +{r.unpricedRequests}?
                        </span>
                      )}
                    </td>
                    <td className="usage-budget">
                      {editing === r.provider ? (
                        <span className="row">
                          $
                          <input
                            autoFocus
                            value={budgetInput}
                            placeholder="10"
                            onChange={(e) => setBudgetInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveBudget(r.provider);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                          />
                          <button onClick={() => void saveBudget(r.provider)}>✓</button>
                        </span>
                      ) : budget ? (
                        <span
                          className="budget-bar"
                          title={`${usd(monthSpend)} / ${usd(budget)}`}
                          onClick={() => {
                            setEditing(r.provider);
                            setBudgetInput(String(budget));
                          }}
                        >
                          <span
                            className={`budget-fill ${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                          <span className="budget-text">
                            {Math.round(pct)}% · {usd(budget)}
                          </span>
                        </span>
                      ) : (
                        <button
                          className="link"
                          onClick={() => {
                            setEditing(r.provider);
                            setBudgetInput('');
                          }}
                        >
                          + {t('setBudget')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="dim small">{t('usageNote')}</p>
      </div>
    </div>
  );
}
