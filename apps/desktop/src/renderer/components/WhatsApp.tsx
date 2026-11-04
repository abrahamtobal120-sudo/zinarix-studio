import { useEffect, useRef, useState } from 'react';
import type { WhatsAppStatus, WhatsAppWho } from '../../shared/api';
import { api, getState, setState, toast, useStore } from '../store';
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

/**
 * The WhatsApp Web tab. The page is a native view drawn by the main process over the host
 * (like the browser); the side panel sets up and shows the control of Zinarix from the
 * allowed chats.
 */
export function WhatsAppPane({ visible }: { visible: boolean }) {
  const st = useStore((s) => s.whatsapp);
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
  const ensureRemote = async () => {
    if (getState().phone.running) return;
    const p = await api().phone.start();
    setState({ phone: p });
    if (p.error) throw new Error(p.error);
  };

  const connect = () =>
    act(async () => {
      await ensureRemote();
      return api().whatsapp.status();
    });

  /** The main switch: allows the open chat when none is allowed yet, and connects Zinarix. */
  const toggle = (on: boolean) =>
    act(async () => {
      if (!on) return api().whatsapp.control(false);
      if (!st?.chats.length) await api().whatsapp.useCurrent();
      else await api().whatsapp.control(true);
      await ensureRemote();
      return api().whatsapp.status();
    });

  const allow = () =>
    act(async () => {
      await api().whatsapp.useCurrent();
      await ensureRemote();
      return api().whatsapp.status();
    });

  const chats = st?.chats ?? [];
  const logged = st?.logged === true;
  const listening = Boolean(st?.control && chats.length);
  const linked = Boolean(st?.linked);
  const ready = logged && listening && linked;
  const cur = st?.current;
  const curAllowed = Boolean(cur && chats.some((c) => c.id === cur.id));

  let line: string;
  let tone: 'on' | 'warn' | 'off' = 'off';
  if (st?.logged === false) {
    line = t('waScan');
    tone = 'warn';
  } else if (!listening) line = t('waControlOff');
  else if (!linked) {
    line = t('waNeedsRemote');
    tone = 'warn';
  } else {
    line = t(chats.length === 1 ? 'waListening' : 'waListeningMany', {
      name: chats[0]?.title ?? '',
      n: chats.length,
    });
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
        <button className="bicon" title={t('navReload')} onClick={() => void api().whatsapp.reload()}>
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
            <div className={`wa-card wa-main${ready ? ' on' : ''}`}>
              <div className="wa-main-head">
                <div>
                  <div className="wa-main-title">{t('waTitle')}</div>
                  <div className="wa-main-sub">{ready ? t('waReadyHint') : t('waIntro')}</div>
                </div>
                <label className="wa-switch" title={listening ? t('waStop') : t('waTitle')}>
                  <input
                    type="checkbox"
                    checked={listening}
                    disabled={busy || !logged || (!chats.length && !cur)}
                    onChange={(e) => void toggle(e.target.checked)}
                  />
                  <span />
                </label>
              </div>
              <div className="wa-checks">
                <div className={`wa-chk${logged ? ' ok' : ''}`}>
                  <Icon name={logged ? 'check' : 'x'} size={12} />
                  {logged ? t('waStep1') : t('waStep1Hint')}
                </div>
                <div className={`wa-chk${chats.length ? ' ok' : ''}`}>
                  <Icon name={chats.length ? 'check' : 'x'} size={12} />
                  {chats.length ? t('waChatsCount', { n: chats.length }) : t('waStep2Hint')}
                </div>
                <div className={`wa-chk${linked ? ' ok' : ''}`}>
                  <Icon name={linked ? 'check' : 'x'} size={12} />
                  {linked ? t('waStep3') : t('waStep3Hint')}
                  {!linked && (
                    <button className="wa-btn" disabled={busy} onClick={() => void connect()}>
                      {t('waConnect')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="wa-card">
              <div className="wa-card-head">
                <span>{t('waChatsTitle')}</span>
              </div>
              {!chats.length && <div className="wa-note">{t('waNoChats')}</div>}
              {chats.map((c) => {
                const self = /\((t[uú]|you)\)\s*$/i.test(c.title);
                const open = cur?.id === c.id;
                return (
                  <div key={c.id} className={`wa-chat${open ? ' open' : ''}`}>
                    <div className="wa-chat-row">
                      <span className="wa-chat-name" title={c.id}>
                        {c.title || c.id}
                      </span>
                      {open && <span className="wa-pill">{t('waOpenNow')}</span>}
                      {c.pending ? <span className="wa-pill warn">{c.pending}</span> : null}
                    </div>
                    {!self && (
                      <select
                        className="wa-who"
                        value={c.who}
                        disabled={busy}
                        onChange={(e) => {
                          const who = e.target.value as WhatsAppWho;
                          void act(() => api().whatsapp.who(c.id, who));
                        }}
                      >
                        <option value="them">{t('waWhoThem')}</option>
                        <option value="me">{t('waWhoMe')}</option>
                        <option value="all">{t('waWhoAll')}</option>
                      </select>
                    )}
                    <div className="wa-row">
                      <button
                        className="wa-btn"
                        disabled={busy || !listening || !linked}
                        onClick={() => void act(() => api().whatsapp.test(c.id))}
                      >
                        {t('waTest')}
                      </button>
                      <button
                        className="wa-btn"
                        disabled={busy}
                        onClick={() => void act(() => api().whatsapp.remove(c.id))}
                      >
                        {t('waRemove')}
                      </button>
                    </div>
                  </div>
                );
              })}
              {logged && (
                <button
                  className={chats.length ? 'wa-btn wa-add' : 'primary wa-add'}
                  disabled={busy || !cur || curAllowed}
                  onClick={() => void allow()}
                >
                  {!cur
                    ? t('waOpenFirst')
                    : curAllowed
                      ? t('waAlready', { name: cur.title || t('waThisChat') })
                      : t('waUseNamed', { name: cur.title || t('waThisChat') })}
                </button>
              )}
              <div className="wa-note">{t('waOthersHint')}</div>
            </div>

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
                      {e.chat && e.dir !== 'info' && <b>{e.chat}: </b>}
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
