import { useEffect, useMemo, useState } from 'react';
import type { FindingView, ScanResultView, SecKind, SecReportView } from '../../shared/api';
import { t } from '../i18n';
import { api, newRequestId, toast, useStore } from '../store';
import { askAgent } from './Chat';
import { Icon, type IconName } from './Icon';

type Sev = FindingView['severity'];
const SEV_ORDER: Sev[] = ['crítico', 'alto', 'medio', 'bajo'];
const SEV_COLOR: Record<Sev, string> = {
  crítico: 'var(--danger)',
  alto: '#ff8c3b',
  medio: 'var(--warn)',
  bajo: '#5aa9ff',
};
const WEIGHT: Record<Sev, number> = { crítico: 22, alto: 9, medio: 3, bajo: 1 };
const SCAN_KINDS: SecKind[] = ['project', 'deps', 'system', 'site'];

interface Saved {
  report?: SecReportView;
  at?: number;
  /** Signatures of the previous run, to mark new/resolved findings. */
  prev?: string[];
}
type Store = Partial<Record<SecKind, Saved>>;
interface HistEntry {
  kind: string;
  at: number;
  c: Record<Sev, number>;
  score: number;
}

const LS = 'zs.security.v2';
const HIST = 'zs.security.history.v2';
const sig = (f: FindingView) => `${f.severity}|${f.title}|${f.where ?? ''}`;

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
    // ignore
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
const scoreOf = (f: FindingView[]) =>
  Math.max(0, 100 - SEV_ORDER.reduce((n, s) => n + counts(f)[s] * WEIGHT[s], 0));

const CATS: {
  id: SecKind | 'dashboard' | 'network' | 'history';
  icon: string;
  svg: IconName;
  label: string;
}[] = [
  { id: 'dashboard', icon: '🛡️', svg: 'shield', label: 'Panel' },
  { id: 'project', icon: '🔑', svg: 'key', label: 'Proyecto' },
  { id: 'deps', icon: '📦', svg: 'package', label: 'Dependencias' },
  { id: 'system', icon: '💻', svg: 'monitor', label: 'Mi equipo' },
  { id: 'network', icon: '📡', svg: 'wifi', label: 'Red (nmap)' },
  { id: 'site', icon: '🌐', svg: 'globe', label: 'Sitios web' },
  { id: 'hash', icon: '🧾', svg: 'hash', label: 'Archivos' },
  { id: 'history', icon: '🕘', svg: 'history', label: 'Historial' },
];
const labelOf = (k: string) => CATS.find((c) => c.id === k)?.label ?? k;
const iconOf = (k: string) => CATS.find((c) => c.id === k)?.icon ?? '•';
const SvgOf = ({ k, size = 15 }: { k: string; size?: number }) => (
  <Icon name={CATS.find((c) => c.id === k)?.svg ?? 'shield'} size={size} />
);

function Badge({ sev, n }: { sev: Sev; n: number }) {
  if (!n) return null;
  return (
    <span className="sv-badge" style={{ background: SEV_COLOR[sev] }}>
      {n} {sev}
      {n === 1 ? '' : 's'}
    </span>
  );
}

/** Tiny inline sparkline of the score history (oldest → newest). */
function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 120;
  const h = 32;
  const max = 100;
  const step = w / (points.length - 1);
  const d = points
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`,
    )
    .join(' ');
  const last = points[points.length - 1]!;
  const col = last >= 85 ? 'var(--ok)' : last >= 60 ? 'var(--warn)' : 'var(--danger)';
  return (
    <svg className="sv-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={d} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Findings({ report, kind }: { report: SecReportView; kind: SecKind }) {
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
                  {sev} ({c[sev]})
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
                    {f.severity.toUpperCase()}
                  </span>
                  {f.category && <span className="sv-cat">{f.category}</span>}
                  <strong>{f.title}</strong>
                  {f.where && <span className="sv-where">{f.where}</span>}
                  <span className="sv-finding-actions">
                    <button title={t('secAskAI')} onClick={() => fixOne(kind, f)}>
                      ✨
                    </button>
                    <button
                      title={t('secCopy')}
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(
                            `[${f.severity}] ${f.title}${f.where ? ` (${f.where})` : ''}${f.fix ? `\n→ ${f.fix}` : ''}`,
                          )
                          .then(() => toast(t('secCopied')));
                      }}
                    >
                      📋
                    </button>
                  </span>
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
          placeholder="localhost · 192.168.1.0/24 · midominio.com"
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
  const [history, setHistory] = useState<HistEntry[]>(() => load<HistEntry[]>(HIST, []));

  const run = async (kind: SecKind, extra: { url?: string; path?: string } = {}) => {
    setRunning(kind);
    try {
      const report = await api().security.run(newRequestId(), { kind, ...extra });
      // Functional updates: sequential "run all" must not overwrite earlier results.
      setStore((cur) => {
        const prev = cur[kind]?.report?.findings.map(sig) ?? [];
        const next = { ...cur, [kind]: { report, at: Date.now(), prev } };
        save(LS, next);
        return next;
      });
      if (kind !== 'hash') {
        const entry: HistEntry = {
          kind,
          at: Date.now(),
          c: counts(report.findings),
          score: scoreOf(report.findings),
        };
        setHistory((cur) => {
          const hist = [entry, ...cur].slice(0, 60);
          save(HIST, hist);
          return hist;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^Error[^:]*: (Error: )?/, '') : String(e);
      const next = {
        ...store,
        [kind]: { report: { title: '', findings: [], notes: ['⛔ ' + msg] }, at: Date.now() },
      };
      setStore(next);
      save(LS, next);
    } finally {
      setRunning(null);
    }
  };

  const runAllLocal = async () => {
    for (const k of ['project', 'deps', 'system'] as SecKind[]) await run(k);
  };

  const allFindings = SCAN_KINDS.flatMap((k) => store[k]?.report?.findings ?? []);
  const total = counts(allFindings);
  const anyRun = Object.values(store).some((x) => x?.at);
  const score = anyRun ? scoreOf(allFindings) : null;
  const scoreColor =
    score === null
      ? 'var(--border)'
      : score >= 85
        ? 'var(--ok)'
        : score >= 60
          ? 'var(--warn)'
          : 'var(--danger)';

  // category breakdown
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of allFindings)
      m.set(f.category ?? 'Otro', (m.get(f.category ?? 'Otro') ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [allFindings]);
  const maxCat = byCat[0]?.[1] ?? 1;

  // top risks (crit + high) across analyses
  const topRisks = useMemo(
    () =>
      SCAN_KINDS.flatMap((k) => (store[k]?.report?.findings ?? []).map((f) => ({ ...f, kind: k })))
        .filter((f) => f.severity === 'crítico' || f.severity === 'alto')
        .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
        .slice(0, 8),
    [store],
  );

  const scoreTrend = [...history]
    .filter((h) => h.kind !== 'hash')
    .slice(0, 20)
    .reverse()
    .map((h) => h.score);

  const exportReport = async () => {
    const lines: string[] = [
      `# Informe de seguridad — Zinarix Studio`,
      '',
      `Fecha: ${new Date().toLocaleString()}`,
      '',
    ];
    if (score !== null) lines.push(`**Puntaje general: ${score}/100**`, '');
    lines.push(
      `Resumen: ${total.crítico} críticos · ${total.alto} altos · ${total.medio} medios · ${total.bajo} bajos`,
      '',
    );
    for (const k of SCAN_KINDS) {
      const r = store[k]?.report;
      if (!r) continue;
      lines.push(`## ${iconOf(k)} ${labelOf(k)}`, '');
      for (const n of r.notes) lines.push(`_${n}_`);
      if (!r.findings.length) lines.push('', '✓ Sin hallazgos.', '');
      for (const f of r.findings)
        lines.push(
          '',
          `### [${f.severity.toUpperCase()}] ${f.title}`,
          f.where ? `- Ubicación: \`${f.where}\`` : '',
          f.category ? `- Categoría: ${f.category}` : '',
          f.detail ? `- Detalle: ${f.detail}` : '',
          f.fix ? `- Solución: ${f.fix}` : '',
        );
      lines.push('');
    }
    const path = await api().security.saveReport(lines.filter((l) => l !== undefined).join('\n'));
    if (path) toast(t('secExported'));
  };

  const diffOf = (kind: SecKind) => {
    const s = store[kind];
    if (!s?.report || !s.prev) return null;
    const now = new Set(s.report.findings.map(sig));
    const old = new Set(s.prev);
    const added = [...now].filter((x) => !old.has(x)).length;
    const resolved = [...old].filter((x) => !now.has(x)).length;
    return added || resolved ? { added, resolved } : null;
  };

  return (
    <div className="sec-section">
      <nav className="sv-nav">
        <div className="sv-brand">
          <Icon name="shield" size={16} /> {t('securityTitle')}
        </div>
        {CATS.map((c) => {
          const saved =
            c.id !== 'dashboard' && c.id !== 'network' && c.id !== 'history'
              ? store[c.id]
              : undefined;
          const cc = saved?.report ? counts(saved.report.findings) : null;
          return (
            <button
              key={c.id}
              className={`sv-nav-item ${cat === c.id ? 'on' : ''}`}
              onClick={() => setCat(c.id)}
            >
              <span className="sv-nav-icon">
                <SvgOf k={c.id} />
              </span>
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
                style={{ ['--c' as string]: scoreColor, ['--p' as string]: `${score ?? 0}%` }}
              >
                <div className="sv-score-inner">
                  <strong style={{ color: scoreColor }}>{score ?? '—'}</strong>
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
                  {anyRun && total.crítico + total.alto + total.medio + total.bajo === 0 && (
                    <span className="sv-clean">✓ {t('secClean')}</span>
                  )}
                  {scoreTrend.length > 1 && <Spark points={scoreTrend} />}
                </div>
                <div className="sv-dash-btns">
                  <button
                    className="primary"
                    disabled={running !== null}
                    onClick={() => void runAllLocal()}
                  >
                    {running ? `${t('secRunning')} ${labelOf(running)}…` : `▶ ${t('secRunAll')}`}
                  </button>
                  {anyRun && (
                    <button onClick={() => void exportReport()}>⬇ {t('secExport')}</button>
                  )}
                </div>
              </div>
            </div>

            {byCat.length > 0 && (
              <div className="sv-section-block">
                <h3>{t('secByCategory')}</h3>
                <div className="sv-bars">
                  {byCat.map(([name, n]) => (
                    <div key={name} className="sv-bar-row">
                      <span className="sv-bar-label">{name}</span>
                      <div className="sv-bar-track">
                        <div className="sv-bar-fill" style={{ width: `${(n / maxCat) * 100}%` }} />
                      </div>
                      <span className="sv-bar-n">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {topRisks.length > 0 && (
              <div className="sv-section-block">
                <h3>{t('secTopRisks')}</h3>
                <div className="sv-risks">
                  {topRisks.map((f, i) => (
                    <button key={i} className="sv-risk" onClick={() => setCat(f.kind)}>
                      <span className="sv-sev" style={{ color: SEV_COLOR[f.severity] }}>
                        {f.severity.toUpperCase()}
                      </span>
                      <span className="sv-risk-title">{f.title}</span>
                      <span className="sv-where">{f.where ?? labelOf(f.kind)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="sv-cards">
              {SCAN_KINDS.map((k) => {
                const saved = store[k];
                const cc = saved?.report ? counts(saved.report.findings) : null;
                const d = diffOf(k);
                return (
                  <button key={k} className="sv-card" onClick={() => setCat(k)}>
                    <div className="sv-card-top">
                      <SvgOf k={k} />
                      <strong>{labelOf(k)}</strong>
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
                    {d && (
                      <span className="sv-diff">
                        {d.added ? <span className="up">+{d.added} nuevos</span> : null}
                        {d.resolved ? <span className="down"> −{d.resolved} resueltos</span> : null}
                      </span>
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
                <SvgOf k={cat} size={18} /> {labelOf(cat)}
              </h2>
              <div className="sv-panel-actions">
                {(cat === 'project' || cat === 'deps') && !workspace && (
                  <span className="dim">{t('secOpenFolder')}</span>
                )}
                {diffOf(cat) && (
                  <span className="sv-diff">
                    {diffOf(cat)!.added ? <span className="up">+{diffOf(cat)!.added}</span> : null}
                    {diffOf(cat)!.resolved ? (
                      <span className="down"> −{diffOf(cat)!.resolved}</span>
                    ) : null}
                  </span>
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
              <Findings report={store[cat]!.report!} kind={cat} />
            ) : (
              <p className="dim">{t('secPressRun')}</p>
            )}
          </div>
        )}

        {cat === 'network' && (
          <div className="sv-panel">
            <h2>
              <SvgOf k="network" size={18} /> {t('scannerTitle')}
            </h2>
            <ScanTab />
          </div>
        )}

        {cat === 'site' && (
          <div className="sv-panel">
            <h2>
              <SvgOf k="site" size={18} /> {labelOf('site')}
            </h2>
            <div className="sv-scan-row">
              <input
                value={siteUrl}
                placeholder="https://misitio.com"
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
            {store.site?.report && <Findings report={store.site.report} kind="site" />}
          </div>
        )}

        {cat === 'hash' && (
          <div className="sv-panel">
            <h2>
              <SvgOf k="hash" size={18} /> {labelOf('hash')}
            </h2>
            <p className="dim">{t('secHashIntro')}</p>
            <div className="sv-scan-row">
              <input
                value={hashPath}
                placeholder="~/Descargas/archivo.iso"
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

        {cat === 'history' && (
          <div className="sv-panel">
            <div className="sv-panel-head">
              <h2>
              <SvgOf k="history" size={18} /> {labelOf('history')}
            </h2>
              {history.length > 0 && (
                <button
                  onClick={() => {
                    setHistory([]);
                    save(HIST, []);
                  }}
                >
                  {t('secClearHistory')}
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="dim">{t('secNoHistory')}</p>
            ) : (
              <div className="sv-history">
                {history.map((h, i) => (
                  <div key={i} className="sv-hist-row">
                    <span
                      className="sv-hist-score"
                      style={{
                        color:
                          h.score >= 85
                            ? 'var(--ok)'
                            : h.score >= 60
                              ? 'var(--warn)'
                              : 'var(--danger)',
                      }}
                    >
                      {h.score}
                    </span>
                    <span className="sv-hist-kind">
                      <SvgOf k={h.kind} size={13} /> {labelOf(h.kind)}
                    </span>
                    <span className="sv-hist-counts">
                      {SEV_ORDER.map((s) => (h.c[s] ? <Badge key={s} sev={s} n={h.c[s]} /> : null))}
                      {h.c.crítico + h.c.alto + h.c.medio + h.c.bajo === 0 && (
                        <span className="sv-clean">✓</span>
                      )}
                    </span>
                    <span className="sv-when">{new Date(h.at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
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
    .map((f) => `- [${f.severity}] ${f.title}${f.where ? ` (${f.where})` : ''}`)
    .join('\n');
  askAgent(
    `Analicé "${kind}" en el Centro de seguridad y encontré estos problemas:\n${lines}\n\nExplícame en palabras sencillas qué significan los más graves y ofréceme corregirlos uno por uno.`,
  );
}

function fixOne(kind: SecKind, f: FindingView) {
  askAgent(
    `En el análisis de seguridad "${kind}" salió este problema:\n- [${f.severity}] ${f.title}${f.where ? ` en ${f.where}` : ''}${f.detail ? `\n  ${f.detail}` : ''}${f.fix ? `\n  Sugerencia: ${f.fix}` : ''}\n\nExplícamelo en palabras sencillas y arréglalo (con mi aprobación).`,
  );
}
