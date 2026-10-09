import { useEffect, useRef, useState } from 'react';
import type { ScanResultView } from '../../shared/api';
import { t } from '../i18n';
import { api, newRequestId, setState } from '../store';

const PRESETS: { id: string; label: string; ports?: string }[] = [
  { id: 'top', label: 'Top 100', ports: undefined },
  {
    id: 'common',
    label: 'Comunes',
    ports: '21,22,23,25,53,80,110,143,443,445,3306,3389,5432,6379,8080,8443,27017',
  },
  { id: 'web', label: 'Web', ports: '80,443,3000,5000,5173,8000,8080,8443,8888' },
  { id: 'all', label: 'Todos (1-65535)', ports: '1-65535' },
  { id: 'custom', label: 'Personalizado' },
];

/** Private LAN / localhost — a public target needs the authorization checkbox. */
function looksPrivate(target: string): boolean {
  const t = target
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]!
    .split(':')[0]!;
  return (
    t === 'localhost' ||
    t === '::1' ||
    /^127\./.test(t) ||
    /^10\./.test(t) ||
    /^192\.168\./.test(t) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(t)
  );
}

export function Scanner() {
  const [target, setTarget] = useState('localhost');
  const [preset, setPreset] = useState('top');
  const [customPorts, setCustomPorts] = useState('1-1024');
  const [service, setService] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ScanResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef<string | null>(null);
  const close = () => setState({ modal: null });
  const isPublic = target.trim() !== '' && !looksPrivate(target);

  useEffect(
    () =>
      api().on((ev) => {
        if (ev.type === 'scan:progress' && ev.requestId === reqId.current)
          setProgress({ done: ev.done, total: ev.total });
      }),
    [],
  );

  const run = async () => {
    if (busy || !target.trim()) return;
    if (isPublic && !authorized) return;
    const ports = PRESETS.find((p) => p.id === preset)?.ports;
    const id = newRequestId();
    reqId.current = id;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: 1 });
    try {
      const r = await api().security.scan(id, {
        target: target.trim(),
        ports: preset === 'custom' ? customPorts : ports,
        serviceDetection: service,
        authorized: isPublic ? authorized : undefined,
      });
      setResult(r);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(e),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const stop = () => {
    if (reqId.current) void api().security.scanAbort(reqId.current);
  };

  const totalOpen = result?.hosts.reduce((n, h) => n + h.openPorts.length, 0) ?? 0;
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="scanner" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} aria-label="Cerrar">
          ×
        </button>
        <h2>📡 {t('scannerTitle')}</h2>
        <p className="dim">{t('scannerIntro')}</p>

        <div className="scan-form">
          <label className="scan-target">
            {t('scannerTarget')}
            <input
              value={target}
              placeholder="localhost · 192.168.1.1 · 192.168.1.0/24 · midominio.com"
              spellCheck={false}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void run()}
            />
          </label>
          <div className="scan-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`scan-chip ${preset === p.id ? 'on' : ''}`}
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
            {preset === 'custom' && (
              <input
                className="scan-ports"
                value={customPorts}
                placeholder="22,80,443,8000-8100"
                spellCheck={false}
                onChange={(e) => setCustomPorts(e.target.value)}
              />
            )}
          </div>
          <label className="scan-opt">
            <input
              type="checkbox"
              checked={service}
              onChange={(e) => setService(e.target.checked)}
            />
            {t('scannerService')}
          </label>
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

        <div className="scan-actions">
          {busy ? (
            <button className="danger" onClick={stop}>
              ⏹ {t('scannerStop')}
            </button>
          ) : (
            <button
              className="primary"
              disabled={!target.trim() || (isPublic && !authorized)}
              onClick={() => void run()}
            >
              ▶ {t('scannerRun')}
            </button>
          )}
          {progress && (
            <div className="scan-progress">
              <div
                className="scan-bar"
                style={{
                  width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                }}
              />
              <span>{Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%</span>
            </div>
          )}
        </div>

        {error && <div className="scan-error">⛔ {error}</div>}

        {result && (
          <div className="scan-results">
            <div className="scan-summary">
              {t('scannerSummary', {
                open: totalOpen,
                hosts: result.hosts.length,
                ports: result.scannedPorts,
              })}
            </div>
            {result.hosts.length === 0 && <p className="dim">{t('scannerNoneOpen')}</p>}
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
                          {p.port} {p.risky && <span title={t('scannerRisky')}>⚠️</span>}
                        </td>
                        <td>{p.service}</td>
                        <td className="scan-banner">{p.banner ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {totalOpen > 0 && (
              <button
                className="scan-explain"
                onClick={() => {
                  close();
                  import('./Chat').then((m) =>
                    m.askAgent(
                      `Acabo de escanear ${target.trim()} y encontré estos puertos abiertos:\n${result.hosts
                        .map(
                          (h) =>
                            `${h.host}: ${h.openPorts.map((p) => `${p.port} ${p.service}${p.banner ? ` (${p.banner})` : ''}`).join(', ')}`,
                        )
                        .join('\n')}\nExplícame qué riesgo tiene cada uno y cómo lo aseguro.`,
                    ),
                  );
                }}
              >
                ✨ {t('scannerExplain')}
              </button>
            )}
          </div>
        )}
        <p className="sec-legal">⚖️ {t('scannerLegal')}</p>
      </div>
    </div>
  );
}
