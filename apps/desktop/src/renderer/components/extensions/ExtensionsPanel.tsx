import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ExtensionSearchItem, InstalledExtension } from '../../../shared/devtools';
import { extThemeId, snippetItems } from '../../../shared/extContrib';
import { confirmDialog } from '../../confirm';
import { errText } from '../../errText';
import {
  activeExtTheme,
  clearExtTheme,
  extensionsVersion,
  installedExtensions,
  loadExtensions,
  onExtensions,
  showExtTheme,
} from '../../extensions';
import { api, toast } from '../../store';
import { Icon } from '../Icon';
import { tx } from './extStrings';
import './extensions.css';

function useExtVersion(): number {
  return useSyncExternalStore(onExtensions, extensionsVersion);
}

const icons = new Map<string, Promise<string | null>>();
function ExtIcon({ data, url }: { data?: string; url?: string }) {
  const [src, setSrc] = useState<string | null>(data ?? null);
  useEffect(() => {
    if (data || !url) return setSrc(data ?? null);
    let live = true;
    let p = icons.get(url);
    if (!p) {
      p = api()
        .extensions.icon(url)
        .catch(() => null);
      icons.set(url, p);
    }
    void p.then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [data, url]);
  return src ? (
    <img className="ext-icon" src={src} alt="" />
  ) : (
    <span className="ext-icon ext-icon-none" aria-hidden="true">
      <Icon name="package" size={18} />
    </span>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1000) return `${Math.round(n / 1000)} k`;
  return String(n);
}

function unsupportedText(list: string[]): string {
  const names = list.map((u) =>
    u === 'code' ? tx('unCode') : u === 'grammars' ? tx('unGrammars') : u,
  );
  return [...new Set(names)].join(', ');
}

function InstalledCard({
  ext,
  activeTheme,
}: {
  ext: InstalledExtension;
  activeTheme: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await loadExtensions();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const snippetCount = ext.snippets.reduce((n, s) => n + snippetItems(s.snippets).length, 0);
  const langs = ext.languages.map((l) => l.aliases?.[0] ?? l.id);
  const empty = !ext.themes.length && !snippetCount && !langs.length;
  return (
    <li className={`ext-card${ext.enabled ? '' : ' off'}`} data-ext={ext.id}>
      <div className="ext-head">
        <ExtIcon data={ext.icon} />
        <div className="ext-meta">
          <span className="ext-name">
            {ext.displayName}
            {!ext.enabled && <span className="ext-tag">{tx('disabled')}</span>}
          </span>
          <span className="ext-sub">
            {ext.publisher} · {ext.version}
          </span>
        </div>
      </div>
      {ext.description && <p className="ext-desc">{ext.description}</p>}
      {ext.enabled && ext.themes.length > 0 && (
        <ul className="ext-themes" aria-label={tx('themes')}>
          {ext.themes.map((th) => {
            const id = extThemeId(ext.id, th.label);
            const on = activeTheme === id;
            return (
              <li key={id}>
                <span className="ext-theme-name">{th.label}</span>
                <button
                  className={`btn ext-small${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => (on ? clearExtTheme() : void showExtTheme(id))}
                  title={on ? tx('leaveTheme') : undefined}
                >
                  {on ? tx('inUse') : tx('useTheme')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {snippetCount > 0 && <p className="ext-info">{tx('snippets', { n: snippetCount })}</p>}
      {langs.length > 0 && (
        <p className="ext-info">{tx('languages', { list: langs.slice(0, 8).join(', ') })}</p>
      )}
      {empty ? (
        <p className="ext-info warn">{tx('nothing')}</p>
      ) : (
        ext.unsupported.length > 0 && (
          <p className="ext-info warn">
            {tx('unsupported', { list: unsupportedText(ext.unsupported) })}
          </p>
        )
      )}
      <div className="ext-btns">
        <button
          className="btn ghost ext-small"
          disabled={busy}
          onClick={() => void run(() => api().extensions.setEnabled(ext.id, !ext.enabled))}
        >
          {ext.enabled ? tx('disable') : tx('enable')}
        </button>
        <button
          className="btn ghost ext-small"
          disabled={busy}
          onClick={() =>
            void (async () => {
              if (!(await confirmDialog(tx('uninstallAsk', { name: ext.displayName })))) return;
              await run(() => api().extensions.uninstall(ext.id));
            })()
          }
        >
          {tx('uninstall')}
        </button>
      </div>
    </li>
  );
}

function ResultCard({
  item,
  installed,
}: {
  item: ExtensionSearchItem;
  installed: InstalledExtension | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const install = async () => {
    setBusy(true);
    try {
      const ext = await api().extensions.install(item.namespace, item.name);
      await loadExtensions();
      toast(tx('installedOk', { name: ext.displayName }));
    } catch (e) {
      toast(tx('installFail', { err: errText(e) }));
    } finally {
      setBusy(false);
    }
  };
  const same = installed?.version === item.version;
  return (
    <li className="ext-card" data-ext={item.id}>
      <div className="ext-head">
        <ExtIcon url={item.iconUrl} />
        <div className="ext-meta">
          <span className="ext-name">{item.displayName}</span>
          <span className="ext-sub">
            {item.publisher} · {item.version} · {tx('downloads', { n: compact(item.downloads) })}
          </span>
        </div>
        <button
          className={`btn ext-small${installed && same ? ' ghost' : ' primary'}`}
          disabled={busy || (!!installed && same)}
          onClick={() => void install()}
        >
          {busy
            ? tx('installing')
            : installed
              ? same
                ? tx('already')
                : tx('update', { v: item.version })
              : tx('install')}
        </button>
      </div>
      {item.description && <p className="ext-desc">{item.description}</p>}
    </li>
  );
}

export function ExtensionsPanel() {
  useExtVersion();
  const installed = installedExtensions();
  const activeTheme = activeExtTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExtensionSearchItem[] | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | { error: string }>('idle');
  const seq = useRef(0);

  useEffect(() => {
    void loadExtensions();
  }, []);

  // Search a moment after the last key; an older answer never replaces a newer one.
  useEffect(() => {
    const q = query.trim();
    const id = ++seq.current;
    if (!q) {
      setResults(null);
      setState('idle');
      return;
    }
    setState('busy');
    const timer = setTimeout(() => {
      api()
        .extensions.search(q)
        .then((r) => {
          if (seq.current !== id) return;
          setResults(r);
          setState('idle');
        })
        .catch((e: unknown) => {
          if (seq.current !== id) return;
          setResults(null);
          setState({ error: errText(e) });
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const byId = new Map(installed.map((e) => [e.id.toLowerCase(), e]));
  return (
    <div className="explorer ext-panel">
      <div className="sidebar-title">
        <span className="panel-title">{tx('title')}</span>
        <span className="sidebar-actions">
          <button
            title={tx('refresh')}
            aria-label={tx('refresh')}
            onClick={() => void loadExtensions()}
          >
            <Icon name="refresh" size={14} />
          </button>
        </span>
      </div>
      <input
        className="ext-search"
        type="search"
        aria-label={tx('search')}
        placeholder={tx('search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.stopPropagation();
            setQuery('');
          }
        }}
      />
      <div className="ext-body">
        {query.trim() ? (
          <>
            <h3 className="ext-h">{tx('results')}</h3>
            {state === 'busy' && <p className="ext-info">{tx('searching')}</p>}
            {typeof state === 'object' && (
              <p className="ext-info warn" role="alert">
                {tx('searchFail', { err: state.error })}
              </p>
            )}
            {state === 'idle' && results?.length === 0 && (
              <p className="ext-info">{tx('noResults', { q: query.trim() })}</p>
            )}
            <ul className="ext-list">
              {(results ?? []).map((it) => (
                <ResultCard key={it.id} item={it} installed={byId.get(it.id.toLowerCase())} />
              ))}
            </ul>
          </>
        ) : (
          <>
            <h3 className="ext-h">{tx('installed')}</h3>
            {installed.length === 0 && <p className="ext-info">{tx('none')}</p>}
            <ul className="ext-list">
              {installed.map((ext) => (
                <InstalledCard key={ext.id} ext={ext} activeTheme={activeTheme} />
              ))}
            </ul>
            {activeTheme && (
              <button className="btn ghost ext-small ext-leave" onClick={() => clearExtTheme()}>
                {tx('leaveTheme')}
              </button>
            )}
          </>
        )}
        <p className="ext-note">{tx('note')}</p>
      </div>
    </div>
  );
}
