import { useEffect, useRef, useState } from 'react';
import type { BrowserStateView } from '../../shared/api';
import { api, toast, useStore } from '../store';
import { t } from '../i18n';

const EMPTY: BrowserStateView = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
};

/**
 * The built-in browser tab. The page itself is a native view drawn by the main process over
 * the placeholder below; this component only reports where it goes (and hides it whenever
 * something must be drawn on top, like a dialog).
 */
export function BrowserPane({ visible }: { visible: boolean }) {
  const [st, setSt] = useState<BrowserStateView>(EMPTY);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const covered = useStore((s) => Boolean(s.modal || s.inputBox));
  const show = visible && !covered && Boolean(st.url);

  useEffect(() => {
    void api().browser.state().then(setSt);
    return api().on((ev) => {
      if (ev.type === 'browser:state') setSt(ev.state);
    });
  }, []);

  useEffect(() => {
    if (!editing) setUrl(st.url);
  }, [st.url, editing]);

  useEffect(() => {
    const el = host.current;
    if (!el || !show) {
      void api().browser.setBounds(null);
      return;
    }
    const report = () => {
      const r = el.getBoundingClientRect();
      void api().browser.setBounds({
        x: Math.max(0, r.left),
        y: Math.max(0, r.top),
        width: Math.max(0, r.width),
        height: Math.max(0, r.height),
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      void api().browser.setBounds(null);
    };
  }, [show]);

  const go = async () => {
    if (!url.trim()) return;
    setEditing(false);
    try {
      setSt(await api().browser.navigate(url));
    } catch (e) {
      setSt((s) => ({ ...s, loading: false }));
      toast(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(e),
      );
    }
  };

  return (
    <div className="browser-pane" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="browser-bar">
        <button disabled={!st.canGoBack} onClick={() => void api().browser.back()} title="←">
          ←
        </button>
        <button disabled={!st.canGoForward} onClick={() => void api().browser.forward()} title="→">
          →
        </button>
        <button onClick={() => void api().browser.reload()} disabled={!st.url} title="⟳">
          {st.loading ? '✕' : '⟳'}
        </button>
        <input
          value={url}
          placeholder={t('browserUrl')}
          spellCheck={false}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go();
            if (e.key === 'Escape') {
              setUrl(st.url);
              e.currentTarget.blur();
            }
          }}
        />
        {st.loading && <span className="browser-spinner" />}
      </div>
      <div className="browser-host" ref={host}>
        {!st.url && (
          <div className="browser-empty">
            <div className="browser-empty-icon">🌐</div>
            <h3>{t('browserEmpty')}</h3>
            <p>{t('browserEmptyHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
