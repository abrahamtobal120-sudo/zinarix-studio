import { useCallback, useEffect, useState } from 'react';
import type { BrowserCookieInfo, BrowserSourceView } from '../../shared/api';
import { confirmDialog } from '../confirm';
import { t } from '../i18n';
import { api, toast } from '../store';
import { Icon } from './Icon';

/** Tells every open view (the browser's start page) that the cookies changed. */
const CHANGED = 'zx-browser-cookies';
export const onCookiesChanged = (fn: () => void): (() => void) => {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
};

/** Asks for a cookie export and loads it in the built-in browser; returns whether any came in. */
export async function importCookies(): Promise<boolean> {
  try {
    const r = await api().browser.importCookies();
    if (!r) return false;
    if (r.imported === 0) {
      toast(t('browserCookiesNone'));
      return false;
    }
    const extra = r.skipped ? ' ' + t('browserCookiesSkipped', { n: r.skipped }) : '';
    toast(t('browserCookiesDone', { n: r.imported, sites: r.sites }) + extra);
    window.dispatchEvent(new Event(CHANGED));
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    toast(/not-cookies|too-big/.test(msg) ? t('browserCookiesBad') : msg);
    return false;
  }
}

/** Reads cookies straight from an installed browser; reports what came in and what didn't. */
export async function importFromBrowser(src: BrowserSourceView): Promise<boolean> {
  try {
    const r = await api().browser.importFromBrowser(src.id);
    if (r.appBoundBlocked > 0)
      toast(t('browserCookiesAppBound', { n: r.appBoundBlocked, name: src.name }));
    if (r.imported === 0) {
      if (r.locked) toast(t('browserCookiesLocked', { name: src.name }));
      else if (r.appBoundBlocked === 0) toast(t('browserCookiesDirectNone', { name: src.name }));
      return false;
    }
    const extra = r.skipped ? ' ' + t('browserCookiesSkipped', { n: r.skipped }) : '';
    toast(t('browserCookiesDone', { n: r.imported, sites: r.sites }) + extra);
    window.dispatchEvent(new Event(CHANGED));
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Installed browsers whose cookies can be read straight (empty while loading / none). */
export function useBrowserSources(): BrowserSourceView[] {
  const [sources, setSources] = useState<BrowserSourceView[]>([]);
  useEffect(() => {
    void api()
      .browser.browserSources()
      .then(setSources)
      .catch(() => {});
  }, []);
  return sources;
}

/** Cookie status of the built-in browser (null while loading). */
export function useCookieInfo(): [BrowserCookieInfo | null, () => void] {
  const [info, setInfo] = useState<BrowserCookieInfo | null>(null);
  const load = useCallback(() => {
    void api()
      .browser.cookieInfo()
      .then(setInfo)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    return onCookiesChanged(load);
  }, [load]);
  return [info, load];
}

/** Settings → Navegador: cookie import, cookie status and browsing data. */
export function BrowserSection() {
  const [info] = useCookieInfo();
  const sources = useBrowserSources();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const ok = await confirmDialog(t('browserCookiesClearConfirm'), {
      danger: true,
      okLabel: t('browserCookiesClear'),
    });
    if (!ok) return;
    await api().browser.clearCookies();
    window.dispatchEvent(new Event(CHANGED));
    toast(t('browserCookiesCleared'));
  };

  const clearHistory = async () => {
    const ok = await confirmDialog(t('browserHistoryClearConfirm'), {
      danger: true,
      okLabel: t('browserHistoryClear'),
    });
    if (ok) await api().browser.forget(null);
  };

  return (
    <>
      <h3>{t('browserCookiesTitle')}</h3>
      <p className="dim small">{t('browserCookiesHint')}</p>
      <div className="phone-card">
        <p>
          <Icon name="key" size={14} /> {info ? t('browserCookiesStatus', { n: info.count }) : '…'}
        </p>
        <p className="dim small">
          {info?.importedAt
            ? t('browserCookiesLast', {
                date: new Date(info.importedAt).toLocaleString(),
                n: info.imported,
              })
            : t('browserCookiesNever')}
        </p>
        <div className="knowledge-add">
          <button className="primary" disabled={busy} onClick={() => void run(importCookies)}>
            <Icon name="download" size={14} />{' '}
            {info?.importedAt ? t('browserCookiesImportAgain') : t('browserCookiesImport')}
          </button>
          <button disabled={busy || !info?.count} onClick={() => void run(clear)}>
            <Icon name="trash" size={14} /> {t('browserCookiesClear')}
          </button>
        </div>
      </div>

      {sources.length > 0 && (
        <>
          <h3>{t('browserCookiesDirectTitle')}</h3>
          <p className="dim small">{t('browserCookiesDirectHint')}</p>
          <div className="knowledge-add">
            {sources.map((s) => (
              <button
                key={s.id}
                disabled={busy}
                onClick={() => void run(() => importFromBrowser(s))}
              >
                <Icon name="download" size={14} /> {t('browserCookiesFrom', { name: s.name })}
              </button>
            ))}
          </div>
        </>
      )}

      <h3>{t('browserDataTitle')}</h3>
      <p className="dim small">{t('browserDataHint')}</p>
      <div className="knowledge-add">
        <button onClick={() => void clearHistory()}>
          <Icon name="trash" size={14} /> {t('browserHistoryClear')}
        </button>
      </div>
    </>
  );
}
