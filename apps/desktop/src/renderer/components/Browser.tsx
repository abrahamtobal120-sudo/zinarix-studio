import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BrowserHistoryEntryView,
  BrowserHistoryView,
  BrowserStateView,
  BrowserTabsView,
} from '../../shared/api';
import { BROWSER_TAB, api, setState, toast, useStore } from '../store';
import { tabKeyDown } from '../a11y';
import { confirmDialog } from '../confirm';
import { lang, t } from '../i18n';
import { askInChat } from './Chat';
import { Icon as UiIcon } from './Icon';
import { ProviderLogo } from './ProviderLogo';
import { importCookies, useCookieInfo } from './BrowserSettings';
import './browser.css';

const EMPTY: BrowserStateView = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
};

const NO_LIST: BrowserHistoryView = { entries: [], icons: {} };

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

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/** The site's favicon, or a globe when it is not known. */
function Favicon({ src, size = 14 }: { src?: string; size?: number }) {
  return src ? (
    <img className="browser-favicon" src={src} width={size} height={size} alt="" />
  ) : (
    <Icon d={ICON.globe} size={size} />
  );
}

const DAY = 24 * 60 * 60 * 1000;

function dayLabel(at: number): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (at >= start.getTime()) return t('browserToday');
  if (at >= start.getTime() - DAY) return t('browserYesterday');
  return new Date(at).toLocaleDateString(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: new Date(at).getFullYear() === start.getFullYear() ? undefined : 'numeric',
  });
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

type Panel = 'history' | 'bookmarks' | null;

/**
 * History or bookmarks, drawn where the page goes (the page is hidden meanwhile: a native
 * view would cover anything drawn over it).
 */
function ListPanel({
  kind,
  onOpen,
  onClose,
  onChanged,
}: {
  kind: 'history' | 'bookmarks';
  onOpen: (url: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<BrowserHistoryView>(NO_LIST);
  const [loaded, setLoaded] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const v =
      kind === 'history'
        ? await api().browser.history(query, 1000)
        : await api().browser.bookmarks();
    if (kind === 'bookmarks' && query.trim()) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      v.entries = v.entries.filter((e) =>
        words.every((w) => `${e.title} ${e.url}`.toLowerCase().includes(w)),
      );
    }
    setList(v);
    setLoaded(true);
  }, [kind, query]);

  useEffect(() => {
    const id = setTimeout(() => void load(), query ? 120 : 0);
    return () => clearTimeout(id);
  }, [load, query]);

  useEffect(() => {
    search.current?.focus();
  }, [kind]);

  const remove = async (e: BrowserHistoryEntryView) => {
    if (kind === 'history') await api().browser.forget(e.url);
    else await api().browser.toggleBookmark(e.url, e.title);
    onChanged();
    void load();
  };

  const clearAll = async () => {
    const ok = await confirmDialog(t('browserHistoryClearConfirm'), {
      danger: true,
      okLabel: t('browserHistoryClear'),
    });
    if (!ok) return;
    await api().browser.forget(null);
    onChanged();
    void load();
  };

  // Rows grouped by day (history) or a single list (bookmarks).
  const groups: { label: string; rows: BrowserHistoryEntryView[] }[] = [];
  for (const e of list.entries) {
    const label = kind === 'history' ? dayLabel(e.at) : '';
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.rows.push(e);
    else groups.push({ label, rows: [e] });
  }

  return (
    <div
      className="browser-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="browser-panel-head">
        <h3>
          <UiIcon name={kind === 'history' ? 'history' : 'starFilled'} size={16} />
          {kind === 'history' ? t('browserHistory') : t('browserBookmarks')}
        </h3>
        <label className="browser-panel-search">
          <Icon d={ICON.search} size={14} />
          <input
            ref={search}
            value={query}
            placeholder={t('browserHistorySearch')}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {kind === 'history' && list.entries.length > 0 && !query && (
          <button className="browser-panel-clear" onClick={() => void clearAll()}>
            <UiIcon name="trash" size={13} /> {t('browserHistoryClear')}
          </button>
        )}
        <button
          className="bicon"
          title={t('browserClosePanel')}
          aria-label={t('browserClosePanel')}
          onClick={onClose}
        >
          <Icon d={ICON.stop} size={14} />
        </button>
      </div>
      <div className="browser-panel-body">
        {loaded && !list.entries.length && (
          <p className="browser-panel-empty">
            {query
              ? t('browserHistoryNoMatch')
              : kind === 'history'
                ? t('browserHistoryEmpty')
                : t('browserBookmarksEmpty')}
          </p>
        )}
        {groups.map((g, gi) => (
          <section key={`${g.label}-${gi}`}>
            {g.label && <h4>{g.label}</h4>}
            {g.rows.map((e) => (
              <div key={e.url} className="browser-row">
                <button className="browser-row-main" title={e.url} onClick={() => onOpen(e.url)}>
                  <span className="browser-row-icon">
                    <Favicon src={list.icons[hostOf(e.url)]} />
                  </span>
                  <span className="browser-row-title">{e.title || hostOf(e.url) || e.url}</span>
                  <span className="browser-row-url">
                    {e.url.replace(/^https?:\/\/(www\.)?/, '')}
                  </span>
                  {kind === 'history' && (
                    <span className="browser-row-time">{timeLabel(e.at)}</span>
                  )}
                </button>
                <button
                  className="bicon browser-row-x"
                  title={kind === 'history' ? t('browserForget') : t('browserBookmarkRemove')}
                  aria-label={kind === 'history' ? t('browserForget') : t('browserBookmarkRemove')}
                  onClick={() => void remove(e)}
                >
                  {kind === 'history' ? (
                    <Icon d={ICON.stop} size={12} />
                  ) : (
                    <UiIcon name="trash" size={13} />
                  )}
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The built-in browser tab. The page itself is a native view drawn by the main process over
 * the placeholder below; this component only reports where it goes (and hides it whenever
 * something must be drawn on top, like a dialog, the suggestions or the history).
 */
export function BrowserPane({ visible }: { visible: boolean }) {
  const [st, setSt] = useState<BrowserStateView>(EMPTY);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const [tabs, setTabs] = useState<BrowserTabsView>({ tabs: [], active: null });
  const [panel, setPanel] = useState<Panel>(null);
  const [suggest, setSuggest] = useState<BrowserHistoryView>(NO_LIST);
  const [pick, setPick] = useState(-1);
  const [marks, setMarks] = useState<BrowserHistoryView>(NO_LIST);
  /** The start page offers the cookie import only until the user has imported some. */
  const [cookies] = useCookieInfo();
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Tab shown when the user started typing an address (an AI may switch the view meanwhile). */
  const editTab = useRef<string | null>(null);
  /** What the user typed (the suggestions answer only the latest text). */
  const typed = useRef('');
  const covered = useStore((s) => Boolean(s.modal || s.inputBox));
  const suggesting = editing && suggest.entries.length > 0;
  const show = visible && !covered && Boolean(st.url) && !panel && !suggesting;

  const loadMarks = useCallback(() => {
    void api().browser.bookmarks().then(setMarks);
  }, []);

  useEffect(() => {
    void api().browser.state().then(setSt);
    void api().browser.tabs().then(setTabs);
    loadMarks();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api().on((ev) => {
      if (ev.type === 'browser:state') setSt(ev.state);
      if (ev.type === 'browser:tabs') setTabs(ev.view);
      if (ev.type === 'browser:focus') setPanel(null);
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
  }, [loadMarks]);

  useEffect(() => {
    if (!editing) setUrl(st.url);
  }, [st.url, editing]);

  // The star in another window (or the bookmarks list) changed: the start page follows.
  useEffect(() => {
    loadMarks();
  }, [st.bookmarked, loadMarks]);

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
    setPanel(null);
    setSuggest(NO_LIST);
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

  const onType = (value: string) => {
    setUrl(value);
    setPick(-1);
    typed.current = value;
    if (!value.trim()) {
      setSuggest(NO_LIST);
      return;
    }
    void api()
      .browser.suggest(value)
      .then((v) => {
        if (typed.current === value) setSuggest(v);
      });
  };

  const toggleMark = async () => {
    if (!st.url) return;
    await api().browser.toggleBookmark(st.url, st.title);
    loadMarks();
  };

  const parts = splitUrl(st.url);
  const site = st.url ? parts.host : '';
  // Tabs: one per AI conversation that used the browser (two agents never share a page),
  // plus the user's own. Always shown, so the user can open more tabs with "+".
  return (
    <div className="browser-pane" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="browser-tabs" role="tablist">
        {tabs.tabs.map((x) => {
          const title = x.title || (x.url ? splitUrl(x.url).host : t('browserNewTab'));
          const who = x.ai ? x.label : t('browserYou');
          return (
            <div
              key={x.id}
              role="tab"
              aria-selected={x.id === tabs.active}
              tabIndex={x.id === tabs.active || (!tabs.active && x === tabs.tabs[0]) ? 0 : -1}
              className={`browser-tab ${x.id === tabs.active ? 'on' : ''} ${x.ai ? 'ai' : ''}`}
              title={`${title}\n${who}${x.url ? `\n${x.url}` : ''}`}
              onClick={() => {
                setPanel(null);
                void api().browser.selectTab(x.id);
              }}
              onKeyDown={(e) =>
                tabKeyDown(
                  e,
                  () => void api().browser.selectTab(x.id),
                  () => void api().browser.closeTab(x.id),
                )
              }
              onAuxClick={(e) => {
                if (e.button === 1) void api().browser.closeTab(x.id);
              }}
            >
              <span className={`browser-tab-who ${x.loading ? 'loading' : ''}`}>
                {x.ai ? (
                  <ProviderLogo id={x.label.replace(/^🤝\s*/, '').split('/')[0]!} size={12} />
                ) : (
                  <Favicon src={x.icon} size={12} />
                )}
              </span>
              <span className="browser-tab-title">{title}</span>
              {x.ai && <span className="browser-tab-owner">{who.split('/').pop()}</span>}
              <button
                className="browser-tab-x"
                title={t('browserCloseTab')}
                aria-label={t('browserCloseTab')}
                tabIndex={-1}
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
          aria-label={t('browserNewTab')}
          onClick={() => {
            setPanel(null);
            void api().browser.newTab();
          }}
        >
          <UiIcon name="plus" size={14} />
        </button>
      </div>
      <div className="browser-bar">
        <div className="browser-nav">
          <button
            className="bicon"
            disabled={!st.canGoBack}
            onClick={() => void api().browser.back(tabs.active)}
            title={t('navBack')}
            aria-label={t('navBack')}
          >
            <Icon d={ICON.back} />
          </button>
          <button
            className="bicon"
            disabled={!st.canGoForward}
            onClick={() => void api().browser.forward(tabs.active)}
            title={t('navForward')}
            aria-label={t('navForward')}
          >
            <Icon d={ICON.forward} />
          </button>
          {st.loading ? (
            <button
              className="bicon"
              onClick={() => void api().browser.stop(tabs.active)}
              title={t('navStop')}
              aria-label={t('navStop')}
            >
              <Icon d={ICON.stop} />
            </button>
          ) : (
            <button
              className="bicon"
              disabled={!st.url}
              onClick={() => void api().browser.reload(tabs.active)}
              title={t('navReload')}
              aria-label={t('navReload')}
            >
              <Icon d={ICON.reload} />
            </button>
          )}
          <button
            className="bicon"
            onClick={() => {
              setPanel(null);
              void api().browser.home(tabs.active);
            }}
            title={t('navHome')}
            aria-label={t('navHome')}
          >
            <Icon d={ICON.home} />
          </button>
        </div>
        <div className="browser-omni-wrap">
          <div
            className={`browser-omni ${editing ? 'editing' : ''} ${suggesting ? 'open' : ''}`}
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
              aria-autocomplete="list"
              aria-expanded={suggesting}
              style={
                !editing && st.url ? { position: 'absolute', opacity: 0, width: 1 } : undefined
              }
              onFocus={(e) => {
                editTab.current = tabs.active;
                setEditing(true);
                const el = e.currentTarget;
                setTimeout(() => el.select(), 0);
              }}
              onBlur={() => {
                setEditing(false);
                setSuggest(NO_LIST);
                setPick(-1);
              }}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                const n = suggest.entries.length;
                if (e.key === 'ArrowDown' && n) {
                  e.preventDefault();
                  setPick((p) => (p + 1) % n);
                } else if (e.key === 'ArrowUp' && n) {
                  e.preventDefault();
                  setPick((p) => (p <= 0 ? n - 1 : p - 1));
                } else if (e.key === 'Enter') {
                  const chosen = pick >= 0 ? suggest.entries[pick]?.url : undefined;
                  void open(chosen ?? url, editTab.current ?? tabs.active);
                } else if (e.key === 'Escape') {
                  if (suggesting) setSuggest(NO_LIST);
                  else {
                    setUrl(st.url);
                    e.currentTarget.blur();
                  }
                }
              }}
            />
            {aiActive && (
              <span className="browser-ai-pill">
                <span className="dot" /> {t('browserAiDriving')}
              </span>
            )}
            {st.url && !editing && (
              <button
                className={`browser-star ${st.bookmarked ? 'on' : ''}`}
                title={st.bookmarked ? t('browserBookmarkRemove') : t('browserBookmarkAdd')}
                aria-label={st.bookmarked ? t('browserBookmarkRemove') : t('browserBookmarkAdd')}
                aria-pressed={Boolean(st.bookmarked)}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleMark();
                }}
              >
                <UiIcon name={st.bookmarked ? 'starFilled' : 'star'} size={15} />
              </button>
            )}
          </div>
          {suggesting && (
            <ul className="browser-suggest" role="listbox">
              {suggest.entries.map((e, i) => (
                <li
                  key={e.url}
                  role="option"
                  aria-selected={i === pick}
                  className={i === pick ? 'on' : ''}
                  // Before the input loses focus (a blur would close the list first).
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    void open(e.url, editTab.current ?? tabs.active);
                  }}
                  onMouseEnter={() => setPick(i)}
                >
                  <span className="browser-row-icon">
                    <Favicon src={suggest.icons[hostOf(e.url)]} />
                  </span>
                  <span className="browser-row-title">{e.title || hostOf(e.url)}</span>
                  <span className="browser-row-url">
                    {e.url.replace(/^https?:\/\/(www\.)?/, '')}
                  </span>
                  {e.bookmark && (
                    <span className="browser-suggest-star">
                      <UiIcon name="starFilled" size={12} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="browser-actions">
          <button
            className={`bicon ${panel === 'bookmarks' ? 'on' : ''}`}
            onClick={() => setPanel((p) => (p === 'bookmarks' ? null : 'bookmarks'))}
            title={t('browserBookmarks')}
            aria-label={t('browserBookmarks')}
            aria-pressed={panel === 'bookmarks'}
          >
            <UiIcon name="star" size={16} />
          </button>
          <button
            className={`bicon ${panel === 'history' ? 'on' : ''}`}
            onClick={() => setPanel((p) => (p === 'history' ? null : 'history'))}
            title={t('browserHistory')}
            aria-label={t('browserHistory')}
            aria-pressed={panel === 'history'}
          >
            <UiIcon name="history" size={16} />
          </button>
          <button
            className="bicon"
            disabled={!/^https:/.test(st.url)}
            onClick={() => void api().app.openExternal(st.url)}
            title={t('browserExternal')}
            aria-label={t('browserExternal')}
          >
            <Icon d={ICON.external} />
          </button>
        </div>
      </div>
      <div className={`browser-progress ${st.loading ? 'on' : ''}`} />
      <div className={`browser-frame ${aiActive ? 'ai' : ''}`}>
        <div className="browser-host" ref={host}>
          {panel && (
            <ListPanel
              kind={panel}
              onOpen={(u) => void open(u)}
              onClose={() => setPanel(null)}
              onChanged={() => {
                loadMarks();
                void api().browser.state().then(setSt);
              }}
            />
          )}
          {!panel && st.url && suggesting && (
            <div className="browser-paused" aria-hidden="true">
              <Favicon src={st.icon} size={28} />
              <span>{site}</span>
            </div>
          )}
          {!panel && !st.url && (
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
              {marks.entries.length > 0 && (
                <div className="browser-quick browser-marks">
                  {marks.entries.slice(0, 8).map((m) => (
                    <button
                      key={m.url}
                      className="browser-tile"
                      title={m.url}
                      onClick={() => void open(m.url)}
                    >
                      <span className="browser-tile-icon">
                        <Favicon src={marks.icons[hostOf(m.url)]} size={18} />
                      </span>
                      <span className="browser-tile-label">{m.title || hostOf(m.url)}</span>
                      <span className="browser-tile-hint">{hostOf(m.url)}</span>
                    </button>
                  ))}
                </div>
              )}
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
                  <UiIcon name="agent" size={14} /> {t('browserAskAgent')}
                </span>
                {[t('browserIdea1'), t('browserIdea2'), t('browserIdea3')].map((idea) => (
                  <button key={idea} className="browser-chip" onClick={() => askInChat(idea)}>
                    {idea}
                  </button>
                ))}
              </div>
              {cookies && cookies.importedAt === null && (
                <div className="browser-cookies-card">
                  <span>
                    <UiIcon name="key" size={14} /> {t('browserCookiesCard')}
                  </span>
                  <button className="browser-chip" onClick={() => void importCookies()}>
                    {t('browserCookiesImport')}
                  </button>
                  <button
                    className="browser-chip"
                    onClick={() => setState({ modal: { kind: 'settings', section: 'browser' } })}
                  >
                    {t('browserCookiesMore')}
                  </button>
                </div>
              )}
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
