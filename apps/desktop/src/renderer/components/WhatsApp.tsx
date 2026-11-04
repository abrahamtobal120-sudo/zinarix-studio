import { useEffect, useRef, useState } from 'react';
import type { WhatsAppStatus } from '../../shared/api';
import { api, setState, toast, useStore } from '../store';
import { t } from '../i18n';
import { Icon } from './Icon';

function message(e: unknown): string {
  return e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(e);
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const COMMANDS: [string, 'waCmdRepos' | 'waCmdPull' | 'waCmdOpen' | 'waCmdStop' | 'waCmdNew' | 'waCmdChats'][] = [
  ['/repos', 'waCmdRepos'],
  ['/pull 2', 'waCmdPull'],
  ['/abrir 2', 'waCmdOpen'],
  ['/parar', 'waCmdStop'],
  ['/nuevo', 'waCmdNew'],
  ['/chats', 'waCmdChats'],
];

function Step({
  ok,
  n,
  title,
  hint,
  children,
}: {
  ok: boolean;
  n: number;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`wa-step${ok ? ' ok' : ''}`}>
      <span className="wa-step-n">{ok ? <Icon name="check" size={12} /> : n}</span>
      <div className="wa-step-body">
        <div className="wa-step-title">{title}</div>
        {hint && <div className="wa-step-hint">{hint}</div>}
        {children && <div className="wa-step-actions">{children}</div>}
      </div>
    </div>
  );
}

/**
 * The WhatsApp Web tab. The page is a native view drawn by the main process over the host
 * (like the browser); the side panel sets up and shows the control of Zinarix from one chat.
 */
export function WhatsAppPane({ visible }: { visible: boolean }) {
  const st = useStore((s) => s.whatsapp);
  const phone = useStore((s) => s.phone);
  const covered = useStore((s) => Boolean(s.modal || s.inputBox));
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const logBox = useRef<HTMLDivElement>(null);
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
  }, [show, side]);

  useEffect(() => {
    const el = logBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st?.log.length, side]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'unread' in r) setState({ whatsapp: r as WhatsAppStatus });
    } catch (e) {
      toast(message(e));
    } finally {
      setBusy(false);
    }
  };

  /** Zinarix answers only while the phone remote runs: started from here too. */
  const connect = () =>
    act(async () => {
      const p = await api().phone.start();
      setState({ phone: p });
      if (p.error) throw new Error(p.error);
      return api().whatsapp.status();
    });

  const listen = () =>
    act(async () => {
      const r = st?.chat ? await api().whatsapp.control(true) : await api().whatsapp.useCurrent();
      if (!phone.running) {
        const p = await api().phone.start();
        setState({ phone: p });
        if (p.error) toast(p.error);
        return api().whatsapp.status();
      }
      return r;
    });

  const logged = st?.logged === true;
  const hasChat = Boolean(st?.chat);
  const listening = Boolean(st?.control && st.chat);
  const linked = Boolean(st?.linked);
  const ready = logged && listening && linked;
  const name = st?.chat?.title || t('waChosenChat');
  const onOther = Boolean(st?.chat && st.current && st.current.id !== st.chat.id);

  let line: string;
  let tone: 'on' | 'warn' | 'off' = 'off';
  if (st?.logged === false) {
    line = t('waScan');
    tone = 'warn';
  } else if (!listening) line = t('waControlOff');
  else if (!linked) {
    line = t('waNeedsRemote');
    tone = 'warn';
  } else if (onOther) {
    line = t('waAway', { name });
    tone = 'warn';
  } else {
    line = t('waListening', { name });
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
        {listening && linked && (
          <button className="wa-btn" disabled={busy} onClick={() => void act(() => api().whatsapp.test())}>
            {t('waTest')}
          </button>
        )}
        <button
          className="bicon"
          title={t('navReload')}
          onClick={() => void api().whatsapp.reload()}
        >
          <Icon name="refresh" size={15} />
        </button>
        <button
          className={`wa-btn wa-toggle${side ? ' active' : ''}`}
          onClick={() => setSide((v) => !v)}
          title={t('waPanel')}
        >
          {t('waPanel')}
        </button>
      </div>
      <div className="wa-body">
        <div className="wa-frame">
          <div className="wa-host" ref={host}>
            <div className="wa-loading">{t('waLoading')}</div>
          </div>
        </div>
        {side && (
          <aside className="wa-side">
            <div className="wa-card">
              <div className="wa-card-head">
                <span>{t('waTitle')}</span>
                {ready && <span className="wa-pill on">{t('waOn')}</span>}
              </div>
              <Step ok={logged} n={1} title={t('waStep1')} hint={logged ? undefined : t('waStep1Hint')} />
              <Step
                ok={hasChat}
                n={2}
                title={hasChat ? t('waStep2Done', { name }) : t('waStep2')}
                hint={hasChat ? undefined : t('waStep2Hint')}
              >
                {logged && (!hasChat || onOther) && (
                  <button
                    className={hasChat ? 'wa-btn' : 'primary'}
                    disabled={busy || !st?.current}
                    title={st?.current ? st.current.title : t('waOpenFirst')}
                    onClick={() => void act(() => api().whatsapp.useCurrent())}
                  >
                    {st?.current
                      ? t('waUseNamed', { name: st.current.title || t('waThisChat') })
                      : t('waOpenFirst')}
                  </button>
                )}
              </Step>
              <Step
                ok={linked}
                n={3}
                title={t('waStep3')}
                hint={linked ? undefined : t('waStep3Hint')}
              >
                {!linked && (
                  <button className="primary" disabled={busy} onClick={() => void connect()}>
                    {t('waConnect')}
                  </button>
                )}
              </Step>
              <Step ok={listening} n={4} title={listening ? t('waStep4Done') : t('waStep4')}>
                {hasChat &&
                  (listening ? (
                    <button
                      className="wa-btn"
                      disabled={busy}
                      onClick={() => void act(() => api().whatsapp.control(false))}
                    >
                      {t('waStop')}
                    </button>
                  ) : (
                    <button className="primary" disabled={busy} onClick={() => void listen()}>
                      {t('waStart')}
                    </button>
                  ))}
              </Step>
            </div>

            {hasChat && (
              <div className="wa-card">
                <label className="wa-check">
                  <input
                    type="checkbox"
                    checked={Boolean(st?.others)}
                    disabled={busy}
                    onChange={(e) => {
                      const on = e.target.checked;
                      void act(() => api().whatsapp.others(on));
                    }}
                  />
                  <span>
                    <span className="wa-check-title">{t('waOthers')}</span>
                    <span className="wa-check-hint">{t('waOthersHint')}</span>
                  </span>
                </label>
                <div className="wa-row">
                  <button
                    className="wa-btn"
                    disabled={busy}
                    onClick={() => void act(() => api().whatsapp.forget())}
                  >
                    {t('waForget')}
                  </button>
                </div>
              </div>
            )}

            <div className="wa-card">
              <div className="wa-card-head">
                <span>{t('waCommandsTitle')}</span>
              </div>
              <div className="wa-cmds">
                {COMMANDS.map(([c, k]) => (
                  <div key={c} className="wa-cmd">
                    <code>{c}</code>
                    <span>{t(k)}</span>
                  </div>
                ))}
              </div>
              <div className="wa-note">{t('waFreeText')}</div>
            </div>

            <div className="wa-card wa-log-card">
              <div className="wa-card-head">
                <span>{t('waActivity')}</span>
              </div>
              <div className="wa-log" ref={logBox}>
                {!st?.log.length && <div className="wa-note">{t('waNoActivity')}</div>}
                {st?.log.map((e, i) => (
                  <div key={i} className={`wa-ev ${e.dir}`}>
                    <span className="wa-ev-time">{clock(e.at)}</span>
                    <span className="wa-ev-text">
                      {e.dir === 'in' ? '← ' : e.dir === 'out' ? '→ ' : ''}
                      {e.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
