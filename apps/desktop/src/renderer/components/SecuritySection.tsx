import { useEffect, useMemo, useState } from 'react';
import type { FindingView, ScanResultView, SecKind, SecReportView } from '../../shared/api';
import { t } from '../i18n';
import { api, newRequestId, useStore } from '../store';
import { askAgent } from './Chat';

type Sev = FindingView['severity'];
const SEV_ORDER: Sev[] = ['crítico', 'alto', 'medio', 'bajo'];
const SEV_COLOR: Record<Sev, string> = {
  crítico: 'var(--danger)',
  alto: '#ff8c3b',
  medio: 'var(--warn)',
  bajo: '#5aa9ff',
};
const WEIGHT: Record<Sev, number> = { crítico: 22, alto: 9, medio: 3, bajo: 1 };

interface Saved {
  report?: SecReportView;
  at?: number;
}
type Store = Partial<Record<SecKind, Saved>>;

const LS = 'zs.security.v1';
const HIST = 'zs.security.history.v1';

function load<T>(key: string, fb: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // ignore quota/private mode
  }
}

function counts(f: FindingView[]): Record<Sev, number> {
  return {
    crítico: f.filter((x) => x.severity === 'crítico').length,
    alto: f.filter((x) => x.severity === 'alto').length,
    medio: f.filter((x) => x.severity === 'medio').length,
    bajo: f.filter((x) => x.severity === 'bajo').length,
  };
}

const CATS: { id: SecKind | 'dashboard' | 'network'; icon: string; label: string }[] = [
  { id: 'dashboard', icon: '🛡️', label: t('secCatDashboard') },
  { id: 'project', icon: '🔑', label: t('secCatProject') },
  { id: 'deps', icon: '📦', label: t('secCatDeps') },
  { id: 'system', icon: '💻', label: t('secCatSystem') },
  { id: 'network', icon: '📡', label: t('secCatNetwork') },
  { id: 'site', icon: '🌐', label: t('secCatSite') },
  { id: 'hash', icon: '🧾', label: t('secCatHash') },
];

/** Severity as shown to the user (the values themselves come from main in Spanish). */
const SEV_LABEL: Record<Sev, string> = {
  crítico: t('sevCritical'),
  alto: t('sevHigh'),
  medio: t('sevMedium'),
  bajo: t('sevLow'),
};

function Badge({ sev, n }: { sev: Sev; n: number }) {
  if (!n) return null;
  return (
    <span className="sv-badge" style={{ background: SEV_COLOR[sev] }}>
      {n} {SEV_LABEL[sev]}
      {n === 1 ? '' : t('sevPlural')}
    </span>
  );
}

function Findings({ report }: { report: SecReportView }) {
  const [filter, setFilter] = useState<Sev | 'all'>('all');
  const c = counts(report.findings);
  const shown = report.findings
    .filter((f) => filter === 'all' || f.severity === filter)
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  return (
    <>
      {report.notes.length > 0 && (
        <div className="sv-notes">
          {report.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
      {report.findings.length === 0 ? (
        <div className="sv-clean">✓ {t('secNoFindings')}</div>
      ) : (
        <>
          <div className="sv-filters">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              {t('secAll')} ({report.findings.length})
            </button>
            {SEV_ORDER.map((sev) =>
              c[sev] ? (
                <button
                  key={sev}
                  className={filter === sev ? 'on' : ''}
                  style={{ borderColor: SEV_COLOR[sev] }}
                  onClick={() => setFilter(sev)}
                >
                  {SEV_LABEL[sev]} ({c[sev]})
                </button>
              ) : null,
            )}
          </div>
          <div className="sv-findings">
            {shown.map((f, i) => (
              <div
                key={i}
                className="sv-finding"
                style={{ borderLeftColor: SEV_COLOR[f.severity] }}
              >
                <div className="sv-finding-head">
                  <span className="sv-sev" style={{ color: SEV_COLOR[f.severity] }}>
                    {SEV_LABEL[f.severity].toUpperCase()}
                  </span>
                  <strong>{f.title}</strong>
                  {f.where && <span className="sv-where">{f.where}</span>}
                </div>
                {f.detail && <pre className="sv-detail">{f.detail}</pre>}
                {f.fix && (
                  <div className="sv-fix">
                    <b>{t('secFix')}:</b> {f.fix}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ScanTab() {
  const [target, setTarget] = useState('localhost');
  const [ports, setPorts] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ScanResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rid = useMemo(() => newRequestId(), []);
  const isPublic =
    target.trim() !== '' &&
    !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1)/.test(
      target.trim().replace(/^https?:\/\//, ''),
    );
  useEffect(
    () =>
      api().on((ev) => {
        if (ev.type === 'scan:progress' && ev.requestId === rid)
          setProgress(Math.round((ev.done / Math.max(ev.total, 1)) * 100));
      }),
    [rid],
  );
  const run = async () => {
    if (busy || (isPublic && !authorized)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      setResult(
        await api().security.scan(rid, {
          target: target.trim(),
          ports: ports.trim() || undefined,
          serviceDetection: true,
          authorized: isPublic ? authorized : undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error[^:]*: (Error: )?/, '') : String(e));
    } finally {
      setBusy(false);
    }
  };
  const open = result?.hosts.reduce((n, h) => n + h.openPorts.length, 0) ?? 0;
  return (
    <div>
      <p className="dim">{t('scannerIntro')}</p>
      <div className="sv-scan-row">
        <input
          value={target}
          placeholder={t('phNetTarget')}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
        />
        <input
          className="sv-scan-ports"
          value={ports}
          placeholder={t('secPortsDefault')}
          onChange={(e) => setPorts(e.target.value)}
        />
        {busy ? (
          <button className="danger" onClick={() => void api().security.scanAbort(rid)}>
            {t('scannerStop')} {progress}%
          </button>
        ) : (
          <button className="primary" disabled={isPublic && !authorized} onClick={() => void run()}>
            ▶ {t('scannerRun')}
          </button>
        )}
      </div>
      {isPublic && (
        <label className={`scan-authorize ${authorized ? 'ok' : ''}`}>
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          <span>⚠️ {t('scannerAuthorize')}</span>
        </label>
      )}
      {error && <div className="scan-error">⛔ {error}</div>}
      {result && (
        <div className="scan-results">
          <div className="scan-summary">
            {t('scannerSummary', { open, hosts: result.hosts.length, ports: result.scannedPorts })}
          </div>
          {result.hosts.map((h) => (
            <div key={h.host} className="scan-host">
              <div className="scan-host-name">
                🖥️ {h.host}
                {h.reverse && <span className="dim"> · {h.reverse}</span>}
              </div>
              <table className="scan-table">
                <thead>
                  <tr>
                    <th>{t('scannerPort')}</th>
                    <th>{t('scannerServiceCol')}</th>
                    <th>{t('scannerVersion')}</th>
                  </tr>
                </thead>
                <tbody>
                  {h.openPorts.map((p) => (
                    <tr key={p.port} className={p.risky ? 'risky' : ''}>
                      <td>
                        {p.port} {p.risky && '⚠️'}
                      </td>
                      <td>{p.service}</td>
                      <td className="scan-banner">{p.banner ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SecuritySection() {
  const workspace = useStore((s) => s.workspace);
  const [cat, setCat] = useState<(typeof CATS)[number]['id']>('dashboard');
  const [store, setStore] = useState<Store>(() => load<Store>(LS, {}));
  const [running, setRunning] = useState<SecKind | null>(null);
  const [siteUrl, setSiteUrl] = useState('');
  const [hashPath, setHashPath] = useState('');

  const update = (next: Store) => {
    setStore(next);
    save(LS, next);
  };

  const run = async (kind: SecKind, extra: { url?: string; path?: string } = {}) => {
    setRunning(kind);
    try {
      const report = await api().security.run(newRequestId(), { kind, ...extra });
      const next = { ...store, [kind]: { report, at: Date.now() } };
      update(next);
      const hist = load<{ kind: string; at: number; c: Record<Sev, number> }[]>(HIST, []);
      hist.unshift({ kind, at: Date.now(), c: counts(report.findings) });
      save(HIST, hist.slice(0, 40));
    } catch (e) {
      update({
        ...store,
        [kind]: {
          report: {
            title: '',
            findings: [],
            notes: [
              '⛔ ' +
                (e instanceof Error ? e.message.replace(/^Error[^:]*: (Error: )?/, '') : String(e)),
            ],
          },
          at: Date.now(),
        },
      });
    } finally {
      setRunning(null);
    }
  };

  const allFindings = SEV_ORDER.length
    ? (['project', 'deps', 'system', 'site'] as SecKind[]).flatMap(
        (k) => store[k]?.report?.findings ?? [],
      )
    : [];
  const total = counts(allFindings);
  const penalty = SEV_ORDER.reduce((n, s) => n + total[s] * WEIGHT[s], 0);
  const anyRun = Object.values(store).some((x) => x?.at);
  const score = Math.max(0, 100 - penalty);
  const scoreColor = score >= 85 ? 'var(--ok)' : score >= 60 ? 'var(--warn)' : 'var(--danger)';

  const runAllLocal = async () => {
    for (const k of ['project', 'deps', 'system'] as SecKind[]) await run(k);
  };

  const label = (k: SecKind) => CATS.find((c) => c.id === k)?.label ?? k;

  return (
    <div className="sec-section">
      <nav className="sv-nav">
        <div className="sv-brand">🛡️ {t('securityTitle')}</div>
        {CATS.map((c) => {
          const saved = c.id !== 'dashboard' && c.id !== 'network' ? store[c.id] : undefined;
          const cc = saved?.report ? counts(saved.report.findings) : null;
          return (
            <button
              key={c.id}
              className={`sv-nav-item ${cat === c.id ? 'on' : ''}`}
              onClick={() => setCat(c.id)}
            >
              <span className="sv-nav-icon">{c.icon}</span>
              <span className="sv-nav-label">{c.label}</span>
              {cc && cc.crítico + cc.alto > 0 && (
                <span
                  className="sv-nav-count"
                  style={{ background: SEV_COLOR[cc.crítico ? 'crítico' : 'alto'] }}
                >
                  {cc.crítico + cc.alto}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sv-content">
        {cat === 'dashboard' && (
          <div className="sv-dash">
            <div className="sv-dash-head">
              <div
                className="sv-score"
                style={{ ['--c' as string]: scoreColor, ['--p' as string]: `${score}%` }}
              >
                <div className="sv-score-inner">
                  <strong style={{ color: scoreColor }}>{anyRun ? score : '—'}</strong>
                  <span>{t('secScore')}</span>
                </div>
              </div>
              <div className="sv-dash-sum">
                <h2>{t('secDashTitle')}</h2>
                <p className="dim">{t('secDashIntro')}</p>
                <div className="sv-badges">
                  {SEV_ORDER.map((s) => (
                    <Badge key={s} sev={s} n={total[s]} />
                  ))}
                  {anyRun && penalty === 0 && <span className="sv-clean">✓ {t('secClean')}</span>}
                </div>
                <button
                  className="primary"
                  disabled={running !== null}
                  onClick={() => void runAllLocal()}
                >
                  {running ? `${t('secRunning')} ${label(running)}…` : `▶ ${t('secRunAll')}`}
                </button>
              </div>
            </div>
            <div className="sv-cards">
              {(['project', 'deps', 'system', 'site'] as SecKind[]).map((k) => {
                const saved = store[k];
                const cc = saved?.report ? counts(saved.report.findings) : null;
                return (
                  <button key={k} className="sv-card" onClick={() => setCat(k)}>
                    <div className="sv-card-top">
                      <span>{CATS.find((c) => c.id === k)?.icon}</span>
                      <strong>{label(k)}</strong>
                    </div>
                    {cc ? (
                      <div className="sv-card-counts">
                        {SEV_ORDER.map((s) => (
                          <Badge key={s} sev={s} n={cc[s]} />
                        ))}
                        {cc.crítico + cc.alto + cc.medio + cc.bajo === 0 && (
                          <span className="sv-clean">✓</span>
                        )}
                      </div>
                    ) : (
                      <span className="dim">{t('secNotRun')}</span>
                    )}
                    {saved?.at && (
                      <span className="sv-when">{new Date(saved.at).toLocaleString()}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(cat === 'project' || cat === 'deps' || cat === 'system') && (
          <div className="sv-panel">
            <div className="sv-panel-head">
              <h2>
                {CATS.find((c) => c.id === cat)?.icon} {label(cat)}
              </h2>
              <div className="sv-panel-actions">
                {(cat === 'project' || cat === 'deps') && !workspace && (
                  <span className="dim">{t('secOpenFolder')}</span>
                )}
                <button
                  className="primary"
                  disabled={
                    running === cat || ((cat === 'project' || cat === 'deps') && !workspace)
                  }
                  onClick={() => void run(cat)}
                >
                  {running === cat
                    ? `${t('secRunning')}…`
                    : store[cat]
                      ? `↻ ${t('secRerun')}`
                      : `▶ ${t('securityRun')}`}
                </button>
                {store[cat]?.report?.findings.length ? (
                  <button onClick={() => explain(cat, store[cat]!.report!)}>
                    ✨ {t('secAskAI')}
                  </button>
                ) : null}
              </div>
            </div>
            {store[cat]?.report ? (
              <Findings report={store[cat]!.report!} />
            ) : (
              <p className="dim">{t('secPressRun')}</p>
            )}
          </div>
        )}

        {cat === 'network' && (
          <div className="sv-panel">
            <h2>📡 {t('scannerTitle')}</h2>
            <ScanTab />
          </div>
        )}

        {cat === 'site' && (
          <div className="sv-panel">
            <h2>🌐 {label('site')}</h2>
            <div className="sv-scan-row">
              <input
                value={siteUrl}
                placeholder={t('phSite')}
                onChange={(e) => setSiteUrl(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && siteUrl.trim() && void run('site', { url: siteUrl.trim() })
                }
              />
              <button
                className="primary"
                disabled={running === 'site' || !siteUrl.trim()}
                onClick={() => void run('site', { url: siteUrl.trim() })}
              >
                {running === 'site' ? `${t('secRunning')}…` : `▶ ${t('securityRun')}`}
              </button>
              {store.site?.report?.findings.length ? (
                <button onClick={() => explain('site', store.site!.report!)}>
                  ✨ {t('secAskAI')}
                </button>
              ) : null}
            </div>
            {store.site?.report && <Findings report={store.site.report} />}
          </div>
        )}

        {cat === 'hash' && (
          <div className="sv-panel">
            <h2>🧾 {label('hash')}</h2>
            <p className="dim">{t('secHashIntro')}</p>
            <div className="sv-scan-row">
              <input
                value={hashPath}
                placeholder={t('phHashFile')}
                onChange={(e) => setHashPath(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  hashPath.trim() &&
                  void run('hash', { path: hashPath.trim() })
                }
              />
              <button
                className="primary"
                disabled={running === 'hash' || !hashPath.trim()}
                onClick={() => void run('hash', { path: hashPath.trim() })}
              >
                {running === 'hash' ? `${t('secRunning')}…` : `▶ ${t('secHashBtn')}`}
              </button>
            </div>
            {store.hash?.report && (
              <pre className="sv-hash">{store.hash.report.notes.join('\n')}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function explain(kind: SecKind, report: SecReportView) {
  const lines = report.findings
    .slice(0, 40)
    .map((f) => `- [${SEV_LABEL[f.severity]}] ${f.title}${f.where ? ` (${f.where})` : ''}`)
    .join('\n');
  const label = CATS.find((c) => c.id === kind)?.label ?? kind;
  askAgent(t('secExplainPrompt', { kind: label, lines }));
}
