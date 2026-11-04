import { useEffect, useRef, useState } from 'react';
import { api, setState, toast, useStore } from '../store';
import { t } from '../i18n';
import { Icon } from './Icon';

function message(e: unknown): string {
  return e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(e);
}

/**
 * The WhatsApp Web tab. The page is a native view drawn by the main process over the host
 * below (like the browser); the bar on top turns on the control of Zinarix from one chat.
 */
export function WhatsAppPane({ visible }: { visible: boolean }) {
  const st = useStore((s) => s.whatsapp);
  const covered = useStore((s) => Boolean(s.modal || s.inputBox));
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const show = visible && !covered;

  useEffect(() => {
    const el = host.current;
    if (!el || !show) {
      void api().whatsapp.setBounds(null);
      return;
    }
    const report = () => {
      const r = el.getBoundingClientRect();
      void api().whatsapp.setBounds({
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
      void api().whatsapp.setBounds(null);
    };
  }, [show]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'unread' in r)
        setState({ whatsapp: r as NonNullable<typeof st> });
    } catch (e) {
      toast(message(e));
    } finally {
      setBusy(false);
    }
  };

  const chosenOpen = Boolean(st?.chat && st.current?.id === st.chat.id);
  let line: string;
  let tone: 'on' | 'warn' | 'off' = 'off';
  if (!st?.control || !st.chat) line = t('waControlOff');
  else if (!st.linked) {
    line = t('waNeedsRemote');
    tone = 'warn';
  } else if (!chosenOpen) {
    line = t('waOpenChat', { name: st.chat.title || t('waChosenChat') });
    tone = 'warn';
  } else {
    line = t('waListening', { name: st.chat.title || t('waChosenChat') });
    tone = 'on';
  }

  return (
    <div className="wa-pane" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="wa-bar">
        <span className="wa-logo">
          <Icon name="whatsapp" size={16} />
        </span>
        <span className={`wa-state ${tone}`}>
          <span className="dot" />
          {line}
          {st?.pending ? ` · ${t('waPending', { n: st.pending })}` : ''}
        </span>
        <div className="spacer" />
        {st?.control && st.chat ? (
          <>
            {st.current && st.current.id !== st.chat.id && (
              <button
                className="wa-btn"
                disabled={busy}
                onClick={() => void act(() => api().whatsapp.useCurrent())}
              >
                {t('waUseThis')}
              </button>
            )}
            <button
              className="wa-btn"
              disabled={busy}
              onClick={() => void act(() => api().whatsapp.control(false))}
            >
              {t('waStop')}
            </button>
          </>
        ) : (
          <button
            className="primary"
            disabled={busy}
            title={t('waControlHint')}
            onClick={() =>
              void act(() =>
                st?.chat ? api().whatsapp.control(true) : api().whatsapp.useCurrent(),
              )
            }
          >
            {st?.chat ? t('waResume', { name: st.chat.title }) : t('waUseThis')}
          </button>
        )}
        <button
          className="bicon"
          title={t('navReload')}
          onClick={() => void api().whatsapp.reload()}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
      {!st?.control && (
        <div className="wa-help">
          {t('waControlHint')} {t('waCommands')}
        </div>
      )}
      <div className="wa-frame">
        <div className="wa-host" ref={host}>
          <div className="wa-loading">{t('waLoading')}</div>
        </div>
      </div>
    </div>
  );
}
