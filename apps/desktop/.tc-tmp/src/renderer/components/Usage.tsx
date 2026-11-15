import { useEffect, useMemo, useState } from 'react';
import type { UsageReport, UsageRowView } from '../../shared/api';
import { pressable } from '../a11y';
import { t } from '../i18n';
import { formatMonth, formatUsd as usd } from '../format';
import { ProviderLogo, providerColor as color } from './ProviderLogo';
import { api, refreshSettings, setState } from '../store';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';
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
  const [budgetError, setBudgetError] = useState<string | null>(null);
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
      <ModalShell onClose={close} className="usage" label={t('usageTitle')}>
        <span aria-busy="true">…</span>
      </ModalShell>
    );
  }

  const rows: UsageRowView[] = period === 'today' ? report.today : report.month;
  const total = (r: UsageRowView[]) => r.reduce((s, x) => s + x.costUsd, 0);
  const totalReq = report.month.reduce((s, x) => s + x.requests, 0);
  const monthName = formatMonth(new Date());

  const startEdit = (provider: string, value: string) => {
    setEditing(provider);
    setBudgetInput(value);
    setBudgetError(null);
  };
  /** Saves the typed budget; an invalid one shows why and keeps the current budget. */
  const saveBudget = async (provider: string) => {
    const n = Number(budgetInput.trim().replace(',', '.'));
    if (!budgetInput.trim() || !Number.isFinite(n) || n <= 0) {
      setBudgetError(t('budgetInvalid'));
      return;
    }
    await writeBudget(provider, n);
  };
  const writeBudget = async (provider: string, monthly: number | null) => {
    try {
      await api().ai.setBudget(provider, monthly === null ? null : { monthly });
    } catch (e) {
      setBudgetError(e instanceof Error ? e.message : String(e));
      return;
    }
    setEditing(null);
    setBudgetError(null);
    await load();
    await refreshSettings();
  };

  return (
    <ModalShell onClose={close} className="usage" labelledBy="usage-title">
      <button className="modal-x" onClick={close} aria-label={t('close')} title={t('close')}>
        <Icon name="x" size={15} />
      </button>
      <h2 id="usage-title">
        <Icon name="chart" size={20} /> {t('usageTitle')}
      </h2>
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
        <button
          className={period === 'today' ? 'on' : ''}
          aria-pressed={period === 'today'}
          onClick={() => setPeriod('today')}
        >
          {t('usageToday')}
        </button>
        <button
          className={period === 'month' ? 'on' : ''}
          aria-pressed={period === 'month'}
          onClick={() => setPeriod('month')}
        >
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
              <th className="num">{t('usageTokIn')}</th>
              <th className="num">{t('usageTokOut')}</th>
              <th className="num">{t('cost')}</th>
              <th>{t('monthlyBudget')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const budget = report.budgets[r.provider]?.monthly;
              const monthSpend = report.month.find((m) => m.provider === r.provider)?.costUsd ?? 0;
              const pct = budget ? Math.min(100, (monthSpend / budget) * 100) : 0;
              return (
                <tr key={r.provider}>
                  <td>
                    <span className="usage-prov">
                      <i className="usage-dot" style={{ background: color(r.provider) }} />
                      <ProviderLogo id={r.provider} name={r.name} size={22} /> {r.name}
                    </span>
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
                      <>
                        <span className="row">
                          $
                          <input
                            autoFocus
                            value={budgetInput}
                            placeholder="10"
                            inputMode="decimal"
                            aria-label={`${t('monthlyBudget')} · ${r.name} (USD)`}
                            aria-invalid={!!budgetError}
                            aria-describedby={budgetError ? `budget-err-${r.provider}` : undefined}
                            onChange={(e) => {
                              setBudgetInput(e.target.value);
                              setBudgetError(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveBudget(r.provider);
                              if (e.key === 'Escape') {
                                // Cancels the edit only (the shell would close the modal).
                                e.preventDefault();
                                setEditing(null);
                              }
                            }}
                          />
                          <button
                            onClick={() => void saveBudget(r.provider)}
                            aria-label={t('budgetSave')}
                            title={t('budgetSave')}
                          >
                            <Icon name="check" size={13} />
                          </button>
                          {budget && (
                            <button
                              onClick={() => void writeBudget(r.provider, null)}
                              title={t('budgetRemove')}
                            >
                              {t('budgetRemove')}
                            </button>
                          )}
                        </span>
                        {budgetError && (
                          <span id={`budget-err-${r.provider}`} className="err small" role="alert">
                            {budgetError}
                          </span>
                        )}
                      </>
                    ) : budget ? (
                      <span
                        className="budget-bar"
                        title={`${usd(monthSpend)} / ${usd(budget)}`}
                        {...pressable(() => startEdit(r.provider, String(budget)))}
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
                      <button className="link" onClick={() => startEdit(r.provider, '')}>
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
    </ModalShell>
  );
}
