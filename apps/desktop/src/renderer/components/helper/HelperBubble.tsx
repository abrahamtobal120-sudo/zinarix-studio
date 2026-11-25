import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HelperStatus } from '../../../shared/api';
import { errText } from '../../errText';
import { t } from '../../i18n';
import { api, newRequestId, updatePrefs, useStore } from '../../store';
import { Icon } from '../Icon';
import { Markdown } from '../Markdown';
import './helper.css';

/**
 * "Ayuda de Zinarix": the round button in the lower-right corner and its small chat. Answers
 * come from a small local model (Ollama) grounded on the app docs (main/helper.ts); the cloud
 * model is only used after the user presses the button that says so.
 */

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  error?: string;
}

interface Pull {
  id: string;
  status: string;
  completed?: number;
  total?: number;
  error?: string;
  done?: boolean;
}

const POS_KEY = 'zs.helperPos';
const SIZE = 38;
const GAP = 14;
const OLLAMA_DOWNLOAD = 'https://ollama.com/download';

type Pos = { right: number; bottom: number };

function savedPos(): Pos | null {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as Pos | null;
    return p && typeof p.right === 'number' && typeof p.bottom === 'number' ? p : null;
  } catch {
    return null;
  }
}

/** Default spot: above the status bar, left of the chat panel (so it never covers Send). */
function autoPos(): Pos {
  const status = document.querySelector('.status-bar')?.getBoundingClientRect();
  const bottom = (status ? window.innerHeight - status.top : 24) + GAP;
  const chat = document.querySelector('.chat-wrap')?.getBoundingClientRect();
  if (!chat || chat.width === 0) return { right: GAP + 4, bottom };
  // A wide chat fills the middle: stay in the corner, above its message box.
  if (chat.width > window.innerWidth * 0.5) return { right: GAP + 4, bottom: bottom + 120 };
  return { right: window.innerWidth - chat.left + GAP, bottom };
}

const clampPos = (p: Pos): Pos => ({
  right: Math.min(Math.max(p.right, 4), window.innerWidth - SIZE - 4),
  bottom: Math.min(Math.max(p.bottom, 4), window.innerHeight - SIZE - 4),
});

function fmtBytes(n?: number): string {
  if (!n) return '';
  return n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`;
}

export function HelperBubble() {
  const show = useStore((s) => s.prefs.helperBubble !== false);
  const model = useStore((s) => s.prefs.helperModel || 'qwen2.5:1.5b');
  const cloudModel = useStore((s) => s.settings.defaultModel);
  const chatOpen = useStore((s) => s.chatOpen);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<HelperStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [cloud, setCloud] = useState(false);
  const [pull, setPull] = useState<Pull | null>(null);
  const [custom, setCustom] = useState<Pos | null>(savedPos);
  const [auto, setAuto] = useState<Pos>({ right: GAP, bottom: 24 + GAP });
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ x: number; y: number; start: Pos; moved: boolean } | null>(null);

  // Follow the chat panel and the window size (the default spot depends on both).
  useLayoutEffect(() => {
    if (!show) return;
    const update = () => setAuto(autoPos());
    update();
    const ro = new ResizeObserver(update);
    const chat = document.querySelector('.chat-wrap');
    if (chat) ro.observe(chat);
    ro.observe(document.body);
    window.addEventListener('resize', update);
    // The chat panel is shown/hidden with display: none (no resize of its own).
    const t1 = setTimeout(update, 50);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      clearTimeout(t1);
    };
  }, [show, chatOpen]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api().helper.status());
    } catch (e) {
      setStatus(null);
      setMsgs((m) => [...m, { role: 'assistant', content: '', error: errText(e) }]);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (open) void check();
  }, [open, model, check]);

  // Streamed answers and download progress.
  useEffect(
    () =>
      api().on((ev) => {
        if (ev.type === 'helper' && ev.requestId === busy) {
          const e = ev.event;
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== 'assistant') return m;
            const next = { ...last };
            if (e.type === 'sources') next.sources = e.sources;
            if (e.type === 'delta') next.content += e.text;
            if (e.type === 'error') next.error = e.message;
            return [...m.slice(0, -1), next];
          });
          if (e.type === 'done' || e.type === 'error') setBusy(null);
        }
        if (ev.type === 'helper:pull') {
          setPull((p) => (p && p.id === ev.event.requestId ? { ...p, ...ev.event, id: p.id } : p));
          if (ev.event.done && !ev.event.error) void check();
        }
      }),
    [busy, check],
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!show) return null;

  const ready = cloud || (status?.ollama === 'running' && status.hasModel);
  const pos = clampPos(custom ?? auto);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy || !ready) return;
    const id = newRequestId();
    const history = msgs
      .filter((m) => !m.error && m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(id);
    try {
      await api().helper.ask(id, { question, history, cloud });
    } catch (e) {
      setBusy(null);
      setMsgs((m) => [...m.slice(0, -1), { role: 'assistant', content: '', error: errText(e) }]);
    }
  };

  const startPull = async (name: string) => {
    const id = newRequestId();
    setPull({ id, status: '' });
    try {
      await api().helper.pull(id, name);
    } catch (e) {
      setPull({ id, status: 'error', done: true, error: errText(e) });
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, start: pos, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setCustom(clampPos({ right: d.start.right - dx, bottom: d.start.bottom - dy }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      setCustom((c) => {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(c));
        } catch {
          // storage unavailable: the spot lasts until the reload
        }
        return c;
      });
    } else setOpen((o) => !o);
  };
  const resetPos = () => {
    setCustom(null);
    try {
      localStorage.removeItem(POS_KEY);
    } catch {
      // nothing saved
    }
  };

  // The popover opens above the button, kept inside the window.
  const popW = Math.min(360, window.innerWidth - 16);
  const popRight = Math.min(Math.max(pos.right, 8), window.innerWidth - popW - 8);
  const popBottom = pos.bottom + SIZE + 10;
  const flipDown = popBottom > window.innerHeight - 220;

  const pct = pull?.total ? Math.round(((pull.completed ?? 0) / pull.total) * 100) : null;
  const pulling = !!pull && !pull.done;
  const others = (status?.models ?? []).filter((m) => m !== model).slice(0, 4);

  const setup = () => {
    if (cloud) return null;
    if (checking && !status) return <p className="hlp-note">{t('hlpChecking')}</p>;
    if (!status) return null;
    if (status.ollama === 'down') {
      return (
        <div className="hlp-setup">
          <h4>{status.installed ? t('hlpOllamaClosedTitle') : t('hlpNoOllamaTitle')}</h4>
          {status.installed ? (
            <p>{t('hlpOllamaClosed')}</p>
          ) : (
            <>
              <p>{t('hlpNoOllama')}</p>
              <ol>
                <li>{t('hlpStep1')}</li>
                <li>{t('hlpStep2')}</li>
                <li>{t('hlpStep3')}</li>
              </ol>
            </>
          )}
          <div className="hlp-actions">
            {!status.installed && (
              <button
                className="primary"
                onClick={() => void api().app.openExternal(OLLAMA_DOWNLOAD)}
              >
                <Icon name="download" size={14} /> {t('hlpDownloadOllama')}
              </button>
            )}
            <button onClick={() => void check()} disabled={checking}>
              <Icon name="refresh" size={14} /> {t('hlpRecheck')}
            </button>
          </div>
          {cloudOffer()}
        </div>
      );
    }
    if (!status.hasModel) {
      return (
        <div className="hlp-setup">
          <h4>{t('hlpNoModelTitle')}</h4>
          <p>{t('hlpNoModel', { model })}</p>
          {pulling ? (
            <div className="hlp-pull">
              <div className="hlp-pull-label">
                {t('hlpPulling', { model })} {pct !== null ? `${pct}%` : pull?.status}
                {pull?.total ? ` · ${fmtBytes(pull.completed)} / ${fmtBytes(pull.total)}` : ''}
              </div>
              <div
                className="hlp-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
              >
                <span style={{ width: `${pct ?? 3}%` }} />
              </div>
              <button onClick={() => void api().helper.abort(pull!.id)}>
                {t('hlpPullCancel')}
              </button>
            </div>
          ) : (
            <div className="hlp-actions">
              <button className="primary" onClick={() => void startPull(model)}>
                <Icon name="download" size={14} /> {t('hlpPull')}
              </button>
            </div>
          )}
          {pull?.error && <p className="hlp-err">{t('hlpPullFailed', { err: pull.error })}</p>}
          {others.length > 0 && !pulling && (
            <div className="hlp-installed">
              <span>{t('hlpUseInstalled')}</span>
              {others.map((m) => (
                <button
                  key={m}
                  className="hlp-chip"
                  onClick={() => void updatePrefs({ helperModel: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {cloudOffer()}
        </div>
      );
    }
    return null;
  };

  function cloudOffer() {
    if (!cloudModel) return null;
    return (
      <div className="hlp-cloud">
        <button onClick={() => setCloud(true)}>
          <Icon name="cloud" size={14} /> {t('hlpCloudOffer', { model: cloudModel })}
        </button>
        <span className="hlp-hint">{t('hlpCloudHint')}</span>
      </div>
    );
  }

  const suggestions = [t('hlpQ1'), t('hlpQ2'), t('hlpQ3'), t('hlpQ4')];

  return (
    <>
      <button
        className={`hlp-bubble${open ? ' on' : ''}`}
        style={{ right: pos.right, bottom: pos.bottom }}
        aria-label={`${t('hlpBubbleTip')} · ${t('hlpOpen')}`}
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={resetPos}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <Icon name={open ? 'close' : 'aiChat'} size={18} />
        {!open && (
          <span className="hlp-tip" aria-hidden="true">
            {t('hlpBubbleTip')}
            <small>{t('hlpDrag')}</small>
          </span>
        )}
      </button>
      {open && (
        <section
          className="hlp-pop"
          role="dialog"
          aria-label={t('hlpTitle')}
          style={{
            right: popRight,
            width: popW,
            ...(flipDown
              ? { top: Math.max(8, window.innerHeight - pos.bottom + 10) }
              : { bottom: popBottom }),
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <header className="hlp-head">
            <Icon name="message" size={15} />
            <span className="hlp-title">{t('hlpTitle')}</span>
            <span className="hlp-badge" title={cloud ? (cloudModel ?? '') : model}>
              {cloud ? t('hlpCloudBadge', { model: cloudModel ?? '' }) : t('hlpLocal', { model })}
            </span>
            {msgs.length > 0 && (
              <button
                className="hlp-icon"
                aria-label={t('hlpClear')}
                title={t('hlpClear')}
                disabled={!!busy}
                onClick={() => setMsgs([])}
              >
                <Icon name="trash" size={14} />
              </button>
            )}
            <button
              className="hlp-icon"
              aria-label={t('hlpClose')}
              title={t('hlpClose')}
              onClick={() => setOpen(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </header>

          <div className="hlp-list" ref={listRef} aria-live="polite">
            {cloud && (
              <div className="hlp-cloud-on">
                <span>{t('hlpCloudOn')}</span>
                <button onClick={() => setCloud(false)}>{t('hlpBackLocal')}</button>
              </div>
            )}
            {setup()}
            {ready && status && status.chunks === 0 && !cloud && (
              <p className="hlp-note">{t('hlpNoKnowledge')}</p>
            )}
            {ready && msgs.length === 0 && (
              <div className="hlp-empty">
                <p>{t('hlpIntro')}</p>
                <span className="hlp-hint">{t('hlpTry')}</span>
                <div className="hlp-suggest">
                  {suggestions.map((q) => (
                    <button key={q} className="hlp-chip" onClick={() => void ask(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`hlp-msg ${m.role}`}>
                {m.role === 'user' ? (
                  m.content
                ) : m.error ? (
                  <span className="hlp-err">{t('hlpError', { err: m.error })}</span>
                ) : m.content ? (
                  <Markdown text={m.content} streaming={busy !== null && i === msgs.length - 1} />
                ) : (
                  <span className="hlp-hint">{t('hlpThinking')}</span>
                )}
                {m.role === 'assistant' && m.sources && m.sources.length > 0 && m.content && (
                  <div className="hlp-sources">
                    {t('hlpSources', { list: m.sources.slice(0, 3).join(' · ') })}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form
            className="hlp-input"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              disabled={!ready}
              placeholder={t('hlpPlaceholder')}
              aria-label={t('hlpPlaceholder')}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
            />
            {busy ? (
              <button
                type="button"
                className="hlp-send"
                aria-label={t('hlpStop')}
                title={t('hlpStop')}
                onClick={() => void api().helper.abort(busy)}
              >
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button
                type="submit"
                className="hlp-send"
                aria-label={t('hlpSend')}
                title={t('hlpSend')}
                disabled={!ready || !input.trim()}
              >
                <Icon name="send" size={14} />
              </button>
            )}
          </form>
        </section>
      )}
    </>
  );
}
