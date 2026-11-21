/**
 * Fase 4C: proxy settings in the project panel: use them in the preview, make them on import,
 * and a button that makes them for every video of the project.
 */
import { t4 } from './fase4Strings';
import { makeProxies, needsProxy } from './proxies';
import { saveProxyPrefs, useV } from './videoStore';

export function ProxySettings() {
  const useProxy = useV((s) => s.useProxy);
  const autoProxy = useV((s) => s.autoProxy);
  const counts = useV((s) => {
    const c = s.project.media.filter(needsProxy);
    return `${c.filter((m) => s.proxies[m.id]).length}/${c.length}/${c.filter((m) => s.proxyProg[m.id] !== undefined).length}`;
  });
  const [ready, total, making] = counts.split('/').map(Number) as [number, number, number];
  return (
    <div className="vs-proxy-box">
      <div className="vs-panel-sub">{t4('proxyTitle')}</div>
      <p className="vs-dim vs-note">{t4('proxyHint')}</p>
      <label className="vs-check">
        <input
          type="checkbox"
          checked={useProxy}
          onChange={(e) => saveProxyPrefs({ useProxy: e.target.checked })}
        />
        {t4('proxyUse')}
      </label>
      <label className="vs-check">
        <input
          type="checkbox"
          checked={autoProxy}
          onChange={(e) => saveProxyPrefs({ autoProxy: e.target.checked })}
        />
        {t4('proxyAuto')}
      </label>
      <span className="vs-dim vs-note">
        {total ? t4('proxyCount', { n: ready, total }) : t4('proxyNone')}
      </span>
      {total > ready && (
        <button disabled={making > 0} onClick={() => void makeProxies()}>
          {making > 0 ? <span className="vs-spinner" /> : null} {t4('proxyMakeAll')}
        </button>
      )}
    </div>
  );
}
