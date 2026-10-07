import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchHit } from '../../shared/api';
import { t } from '../i18n';
import { api, openFile, useStore } from '../store';
import { fileIcon } from './icons';

export function SearchView() {
  const workspace = useStore((s) => s.workspace);
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    if (!workspace || !query) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        setHits(await api().workspace.search(query, regex, matchCase));
      } catch {
        setHits([]);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, regex, matchCase, workspace]);

  const grouped = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of hits) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m];
  }, [hits]);

  return (
    <div className="search-view">
      <div className="sidebar-title">
        <span>{t('search').toUpperCase()}</span>
      </div>
      <div className="search-box">
        <input
          ref={input}
          value={query}
          placeholder={t('searchFiles')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className={`toggle ${matchCase ? 'on' : ''}`}
          title="Match case"
          onClick={() => setMatchCase(!matchCase)}
        >
          {t('matchCase')}
        </button>
        <button
          className={`toggle ${regex ? 'on' : ''}`}
          title="Regex"
          onClick={() => setRegex(!regex)}
        >
          .*
        </button>
      </div>
      <div className="search-summary">
        {query ? (busy ? '…' : t('results', { n: hits.length })) : t('typeToSearch')}
      </div>
      <div className="search-results">
        {grouped.map(([path, list]) => (
          <div key={path} className="search-file">
            <div className="search-file-name" title={path}>
              {fileIcon(path)} {path.split('/').pop()} <span className="dim">{path}</span>{' '}
              <span className="badge">{list.length}</span>
            </div>
            {list.map((h) => (
              <div
                key={`${h.line}:${h.column}`}
                className="search-hit"
                onClick={() => void openFile(h.path, { line: h.line, column: h.column })}
              >
                <span className="dim">{h.line}</span> {h.text.trim()}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
