import { useEffect, useRef, useState } from 'react';
import type { BrowserStateView, BrowserTabsView } from '../../shared/api';
import { BROWSER_TAB, api, setState, toast, useStore } from '../store';
import { t } from '../i18n';
import { askInChat } from './Chat';
import { Icon as UiIcon } from './Icon';
import { ProviderLogo } from './ProviderLogo';

const EMPTY: BrowserStateView = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
};

/** Shown for a few seconds after each agent action, so the user sees who is driving. */
const AI_ACTIVE_MS = 4000;

const QUICK = [
  { label: 'localhost:3000', url: 'http://localhost:3000', hint: 'Next · React · Express' },
  { label: 'localhost:5173', url: 'http://localhost:5173', hint: 'Vite' },
  { label: 'localhost:8080', url: 'http://localhost:8080', hint: t('hintLocalServer') },
  { label: 'GitHub', url: 'https://github.com', hint: 'github.com' },
  { label: 'MDN', url: 'https://developer.mozilla.org', hint: t('hintWebDocs') },
  { label: 'npm', url: 'https://www.npmjs.com', hint: t('hintPackages') },
];

const ICON = {
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 18l6-6-6-6',
  reload: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  stop: 'M6 6l12 12M18 6L6 18',
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  globe:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
};

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function splitUrl(url: string): { secure: boolean; host: string; rest: string } {
  try {
    const u = new URL(url);
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`;
    return { secure: u.protocol === 'https:', host: u.host, rest };
  } catch {
    return { secure: false, host: url, rest: '' };
  }
}

/**
 * The built-in browser tab. The page itself is a native view drawn by the main process over
 * the placeholder below; this component only reports where it goes (and hides it whenever
 * something must be drawn on top, like a dialog).
 */
export function BrowserPane({ visible }: { visible: boolean }) {
  const [st, setSt] = useState<BrowserStateView>(EMPTY);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const [tabs, setTabs] = useState<BrowserTabsView>({ tabs: [], active: null });
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Tab shown when the user started typing an address (an AI may switch the view meanwhile). */
  const editTab = useRef<string | null>(null);
  const covered = useStore((s) => Boolean(s.modal || s.inputBox));
  const show = visible && !covered && Boolean(st.url);

  useEffect(() => {
    void api().browser.state().then(setSt);
    void api().browser.tabs().then(setTabs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api().on((ev) => {
      if (ev.type === 'browser:state') setSt(ev.state);
      if (ev.type === 'browser:tabs') setTabs(ev.view);
      if (ev.type === 'browser:show') {
        setAiActive(true);
        clearTimeout(timer);
        timer = setTimeout(() => setAiActive(false), AI_ACTIVE_MS);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!editing) setUrl(st.url);
  }, [st.url, editing]);

  // The tab shows the page title, like a real browser.
  useEffect(() => {
    const name = st.title || (st.url ? splitUrl(st.url).host : t('browser'));
    setState((s) => ({
      tabs: s.tabs.map((x) =>
        x.path === BROWSER_TAB
          ? { ...x, name: name.length > 28 ? `${name.slice(0, 27)}…` : name }
          : x,
      ),
    }));
  }, [st.title, st.url]);

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

  const open = async (target: string, tab: string | null = tabs.active) => {
    if (!target.trim()) return;
    setEditing(false);
    input.current?.blur();
    try {
      setSt(await api().browser.navigate(target, tab));
    } catch (e) {
      setSt((s) => ({ ...s, loading: false }));
      toast(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(e),
      );
    }
  };

  const parts = splitUrl(st.url);
  // Tabs: one per AI conversation that used the browser (two agents never share a page),
  // plus the user's own. Shown once there is more than the user's single tab.
  const showTabs = tabs.tabs.length > 1 || tabs.tabs.some((x) => x.ai);
  return (
    <div className="browser-pane" style={{ display: visible ? 'flex' : 'none' }}>
      {showTabs && (
        <div className="browser-tabs" role="tablist">
          {tabs.tabs.map((x) => {
            const title = x.title || (x.url ? splitUrl(x.url).host : t('browserNewTab'));
            const who = x.ai ? x.label : t('browserYou');
            return (
              <div
                key={x.id}
                role="tab"
                aria-selected={x.id === tabs.active}
                className={`browser-tab ${x.id === tabs.active ? 'on' : ''} ${x.ai ? 'ai' : ''}`}
                title={`${title}\n${who}${x.url ? `\n${x.url}` : ''}`}
                onClick={() => void api().browser.selectTab(x.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) void api().browser.closeTab(x.id);
                }}
              >
                <span className={`browser-tab-who ${x.loading ? 'loading' : ''}`}>
                  {x.ai ? (
                    <ProviderLogo id={x.label.replace(/^🤝\s*/, '').split('/')[0]!} size={12} />
                  ) : (
                    <Icon d={ICON.globe} size={12} />
                  )}
                </span>
                <span className="browser-tab-title">{title}</span>
                {x.ai && <span className="browser-tab-owner">{who.split('/').pop()}</span>}
                <button
                  className="browser-tab-x"
                  title={t('browserCloseTab')}
                  aria-label={t('browserCloseTab')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void api().browser.closeTab(x.id);
                  }}
                >
                  <Icon d={ICON.stop} size={10} />
                </button>
              </div>
            );
          })}
          <button
            className="bicon browser-tab-new"
            title={t('browserNewTab')}
            onClick={() => void api().browser.newTab()}
          >
            <UiIcon name="plus" size={14} />
          </button>
        </div>
      )}
      <div className="browser-bar">
        <div className="browser-nav">
          <button
            className="bicon"
            disabled={!st.canGoBack}
            onClick={() => void api().browser.back(tabs.active)}
            title={t('navBack')}
          >
            <Icon d={ICON.back} />
          </button>
          <button
            className="bicon"
            disabled={!st.canGoForward}
            onClick={() => void api().browser.forward(tabs.active)}
            title={t('navForward')}
          >
            <Icon d={ICON.forward} />
          </button>
          <button
            className="bicon"
            disabled={!st.url}
            onClick={() => void api().browser.reload(tabs.active)}
            title={t('navReload')}
          >
            <Icon d={st.loading ? ICON.stop : ICON.reload} />
          </button>
          <button
            className="bicon"
            onClick={() => void api().browser.home(tabs.active)}
            title={t('navHome')}
          >
            <Icon d={ICON.home} />
          </button>
        </div>
        <div
          className={`browser-omni ${editing ? 'editing' : ''}`}
          onClick={() => input.current?.focus()}
        >
          <span className={`browser-sec ${st.url && !parts.secure ? 'insecure' : ''}`}>
            <Icon
              d={!st.url || editing ? ICON.search : parts.secure ? ICON.lock : ICON.warn}
              size={14}
            />
          </span>
          {!editing && st.url ? (
            <span className="browser-url-view" title={st.url}>
              <b>{parts.host}</b>
              <span>{parts.rest}</span>
            </span>
          ) : null}
          <input
            ref={input}
            value={url}
            placeholder={t('browserUrl')}
            spellCheck={false}
            style={!editing && st.url ? { position: 'absolute', opacity: 0, width: 1 } : undefined}
            onFocus={(e) => {
              editTab.current = tabs.active;
              setEditing(true);
              const el = e.currentTarget;
              setTimeout(() => el.select(), 0);
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void open(url, editTab.current ?? tabs.active);
              if (e.key === 'Escape') {
                setUrl(st.url);
                e.currentTarget.blur();
              }
            }}
          />
          {aiActive && (
            <span className="browser-ai-pill">
              <span className="dot" /> {t('browserAiDriving')}
            </span>
          )}
        </div>
        <button
          className="bicon"
          disabled={!/^https:/.test(st.url)}
          onClick={() => void api().app.openExternal(st.url)}
          title={t('browserExternal')}
        >
          <Icon d={ICON.external} />
        </button>
      </div>
      <div className={`browser-progress ${st.loading ? 'on' : ''}`} />
      <div className={`browser-frame ${aiActive ? 'ai' : ''}`}>
        <div className="browser-host" ref={host}>
          {!st.url && (
            <div className="browser-start">
              <img className="browser-start-logo" src="./logo.svg" alt="" />
              <h2>{t('browserEmpty')}</h2>
              <form
                className="browser-start-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = new FormData(e.currentTarget).get('q');
                  if (typeof q === 'string') void open(q);
                }}
              >
                <Icon d={ICON.search} size={18} />
                <input name="q" placeholder={t('browserUrl')} spellCheck={false} />
              </form>
              <div className="browser-quick">
                {QUICK.map((q) => (
                  <button key={q.url} className="browser-tile" onClick={() => void open(q.url)}>
                    <span className="browser-tile-icon">
                      <Icon d={q.url.includes('localhost') ? ICON.home : ICON.globe} size={18} />
                    </span>
                    <span className="browser-tile-label">{q.label}</span>
                    <span className="browser-tile-hint">{q.hint}</span>
                  </button>
                ))}
              </div>
              <div className="browser-ask">
                <span className="browser-ask-title">
                  <UiIcon name="sparkles" size={14} /> {t('browserAskAgent')}
                </span>
                {[t('browserIdea1'), t('browserIdea2'), t('browserIdea3')].map((idea) => (
                  <button key={idea} className="browser-chip" onClick={() => askInChat(idea)}>
                    {idea}
                  </button>
                ))}
              </div>
              <p className="browser-safety">
                <UiIcon name="lock" size={13} /> {t('browserEmptyHint')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
