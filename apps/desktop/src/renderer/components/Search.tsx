import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SearchHit } from '../../shared/api';
import { globToRegExp } from '../../shared/glob';
import { t } from '../i18n';
import { api, getState, openFile, reloadFromDisk, toast, useStore } from '../store';
import { fileIcon } from './icons';
import { fuzzy } from './QuickPick';

type Mode = 'content' | 'name';

/** Builds the JS regex equivalent of the search options (used to highlight and replace). */
function buildRegex(
  query: string,
  o: { regex: boolean; matchCase: boolean; word: boolean },
): RegExp | Error {
  try {
    let src = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (o.word) src = `\\b(?:${src})\\b`;
    return new RegExp(src, o.matchCase ? 'g' : 'gi');
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** Splits a line into plain text and <mark> parts; long lines are cut around the first match. */
function highlight(text: string, re: RegExp | null, max = 160): ReactNode[] {
  let line = text.replace(/\t/g, '  ');
  const lead = line.length - line.trimStart().length;
  line = line.slice(lead);
  if (!re) return [line.slice(0, max)];
  re.lastIndex = 0;
  const first = re.exec(line);
  let offset = 0;
  if (first && first.index > 50) offset = first.index - 30;
  const view = line.slice(offset, offset + max);
  const out: ReactNode[] = offset ? ['…'] : [];
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(view); m; m = re.exec(view)) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(view.slice(last, m.index));
    out.push(<mark key={m.index}>{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  out.push(view.slice(last));
  return out;
}

/** Bold the characters of `name` that the fuzzy query matched. */
export function fuzzyMarks(query: string, name: string): ReactNode[] {
  const q = query.toLowerCase();
  const lower = name.toLowerCase();
  const direct = lower.indexOf(q);
  if (direct >= 0)
    return [
      name.slice(0, direct),
      <mark key="m">{name.slice(direct, direct + q.length)}</mark>,
      name.slice(direct + q.length),
    ];
  const out: ReactNode[] = [];
  let pos = 0;
  for (let i = 0; i < name.length; i++) {
    if (pos < q.length && lower[i] === q[pos]) {
      out.push(<mark key={i}>{name[i]}</mark>);
      pos++;
    } else out.push(name[i]);
  }
  return out;
}

function splitPath(path: string): { name: string; dir: string } {
  const i = path.lastIndexOf('/');
  return { name: path.slice(i + 1), dir: i > 0 ? path.slice(0, i) : '' };
}

function Toggle({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`sx-toggle ${on ? 'on' : ''}`}
      title={title}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SearchView() {
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const [mode, setMode] = useState<Mode>('content');
  const [query, setQuery] = useState('');
  const [replace, setReplace] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [word, setWord] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [nonce, setNonce] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), [mode]);

  const re = useMemo(
    () => (query ? buildRegex(query, { regex, matchCase, word }) : null),
    [query, regex, matchCase, word],
  );
  const reError = re instanceof Error ? re.message : null;
  const goodRe = re instanceof RegExp ? re : null;

  const pathFilter = useMemo(() => {
    const parse = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((g) => globToRegExp(g.includes('*') || g.includes('.') ? g : `**/${g}/**`));
    const inc = parse(include);
    const exc = parse(exclude);
    return (p: string) =>
      (!inc.length || inc.some((r) => r.test(p))) && !exc.some((r) => r.test(p));
  }, [include, exclude]);

  // Content search (ripgrep in the main process), debounced.
  useEffect(() => {
    if (mode !== 'content' || !workspace || !query || reError) {
      setHits([]);
      setMs(null);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      const t0 = performance.now();
      try {
        const q = word
          ? `\\b(?:${regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`
          : query;
        setHits(await api().workspace.search(q, regex || word, matchCase));
      } catch {
        setHits([]);
      } finally {
        setMs(Math.round(performance.now() - t0));
        setBusy(false);
        setCursor(0);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [mode, query, regex, matchCase, word, workspace, reError, nonce, fsVersion]);

  // File list for "by name" mode.
  useEffect(() => {
    if (mode === 'name' && workspace) void api().workspace.listFiles().then(setFiles);
  }, [mode, workspace, fsVersion]);

  const grouped = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of hits) if (pathFilter(h.path)) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m];
  }, [hits, pathFilter]);

  const nameMatches = useMemo(() => {
    if (mode !== 'name' || !query) return [];
    const q = query.toLowerCase();
    const byPath = q.includes('/');
    return files
      .filter(pathFilter)
      .map((f) => {
        // Name matches rank first; a whole-path match only counts when it is contiguous or
        // the query has a "/", so scattered letters across folders do not flood the list.
        const name = fuzzy(query, splitPath(f).name);
        const path = byPath || f.toLowerCase().includes(q) ? fuzzy(query, f) : -1;
        return { f, s: name >= 0 ? name + 2000 : path };
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.f.length - b.f.length)
      .slice(0, 300)
      .map((x) => x.f);
  }, [mode, query, files, pathFilter]);

  // Flat list of keyboard-navigable rows.
  const rows = useMemo(() => {
    if (mode === 'name') return nameMatches.map((f) => ({ path: f, hit: undefined }));
    const out: { path: string; hit?: SearchHit }[] = [];
    for (const [path, l] of grouped) {
      out.push({ path });
      if (!collapsed.has(path)) for (const h of l) out.push({ path, hit: h });
    }
    return out;
  }, [mode, nameMatches, grouped, collapsed]);

  useEffect(() => {
    list.current?.querySelector('.sx-cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const toggleFile = (path: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const activateRow = (i: number) => {
    const r = rows[i];
    if (!r) return;
    setCursor(i);
    if (r.hit) void openFile(r.path, { line: r.hit.line, column: r.hit.column });
    else if (mode === 'name') void openFile(r.path);
    else toggleFile(r.path);
  };

  const replaceIn = async (paths: string[]) => {
    if (!goodRe || !paths.length) return;
    const total = grouped.filter(([p]) => paths.includes(p)).reduce((n, [, l]) => n + l.length, 0);
    if (
      paths.length > 1 &&
      !confirm(t('replaceConfirm', { n: total, f: paths.length, s: query, r: replace }))
    )
      return;
    let changed = 0;
    for (const path of paths) {
      if (getState().tabs.find((x) => x.path === path)?.dirty) {
        toast(t('replaceSkipDirty', { name: splitPath(path).name }));
        continue;
      }
      const f = await api().workspace.readFile(path);
      if (f.binary || f.tooLarge) continue;
      const rx = new RegExp(goodRe.source, goodRe.flags);
      const next = regex ? f.content.replace(rx, replace) : f.content.replace(rx, () => replace);
      if (next !== f.content) {
        await api().workspace.writeFile(path, next);
        await reloadFromDisk(path);
        changed++;
      }
    }
    toast(t('replaceDone', { f: changed }));
    setNonce((n) => n + 1);
  };

  const nResults =
    mode === 'name' ? nameMatches.length : grouped.reduce((n, [, l]) => n + l.length, 0);
  const capped = mode === 'content' && hits.length >= 2000;

  let rowIndex = -1;
  return (
    <div className="search-view">
      <div className="sidebar-title">
        <span>{t('search').toUpperCase()}</span>
        <span className="sx-actions">
          {mode === 'content' && grouped.length > 0 && (
            <button
              title={collapsed.size ? t('expandAll') : t('collapseAll')}
              onClick={() =>
                setCollapsed(collapsed.size ? new Set() : new Set(grouped.map(([p]) => p)))
              }
            >
              {collapsed.size ? '⊞' : '⊟'}
            </button>
          )}
          <button title={t('refresh')} onClick={() => setNonce((n) => n + 1)}>
            ⟳
          </button>
          <button
            title={t('clear')}
            onClick={() => {
              setQuery('');
              setReplace('');
              input.current?.focus();
            }}
          >
            ✕
          </button>
        </span>
      </div>

      <div className="sx-tabs" role="tablist">
        {(['content', 'name'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'on' : ''}
            onClick={() => setMode(m)}
          >
            {m === 'content' ? t('searchInContent') : t('searchByName')}
          </button>
        ))}
      </div>

      <div className="sx-form">
        <div className="sx-row">
          {mode === 'content' && (
            <button
              className={`sx-chevron ${showReplace ? 'open' : ''}`}
              title={t('toggleReplace')}
              onClick={() => setShowReplace(!showReplace)}
            >
              ›
            </button>
          )}
          <div className={`sx-field ${reError ? 'error' : ''}`}>
            <span className="sx-icon">⌕</span>
            <input
              ref={input}
              value={query}
              placeholder={mode === 'content' ? t('searchFiles') : t('searchNamePlaceholder')}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, rows.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  activateRow(mode === 'content' && cursor === 0 && rows[1]?.hit ? 1 : cursor);
                } else if (e.key === 'Escape') setQuery('');
              }}
            />
            {mode === 'content' && (
              <span className="sx-toggles">
                <Toggle
                  on={matchCase}
                  title={t('optMatchCase')}
                  onClick={() => setMatchCase(!matchCase)}
                >
                  Aa
                </Toggle>
                <Toggle on={word} title={t('optWholeWord')} onClick={() => setWord(!word)}>
                  <u>ab</u>
                </Toggle>
                <Toggle on={regex} title={t('optRegex')} onClick={() => setRegex(!regex)}>
                  .*
                </Toggle>
              </span>
            )}
          </div>
        </div>
        {mode === 'content' && showReplace && (
          <div className="sx-row sx-indent">
            <div className="sx-field">
              <span className="sx-icon">⇄</span>
              <input
                value={replace}
                placeholder={t('replacePlaceholder')}
                spellCheck={false}
                onChange={(e) => setReplace(e.target.value)}
              />
              <button
                className="sx-toggle"
                title={t('replaceAll')}
                disabled={!grouped.length}
                onClick={() => void replaceIn(grouped.map(([p]) => p))}
              >
                ⇶
              </button>
            </div>
          </div>
        )}
        {reError && <div className="sx-error">{reError}</div>}
        <button className="sx-filters-btn" onClick={() => setShowFilters(!showFilters)}>
          {showFilters ? '▾' : '▸'} {t('searchFilters')}
          {(include || exclude) && <span className="sx-dot" />}
        </button>
        {showFilters && (
          <div className="sx-filters">
            <label>
              {t('filesToInclude')}
              <input
                value={include}
                placeholder="src/**/*.ts, *.md"
                spellCheck={false}
                onChange={(e) => setInclude(e.target.value)}
              />
            </label>
            <label>
              {t('filesToExclude')}
              <input
                value={exclude}
                placeholder="**/*.test.ts, docs"
                spellCheck={false}
                onChange={(e) => setExclude(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <div className="sx-summary">
        {busy ? (
          <span className="sx-spinner" />
        ) : !workspace ? (
          t('openFolder')
        ) : !query ? (
          ''
        ) : nResults ? (
          <>
            {mode === 'content'
              ? t('resultsIn', { n: nResults, f: grouped.length })
              : t('filesFound', { n: nResults })}
            {capped && <span className="sx-warn">&nbsp;· {t('resultsCapped')}</span>}
            {ms !== null && mode === 'content' && <span className="dim">&nbsp;· {ms} ms</span>}
          </>
        ) : (
          t('noResults')
        )}
      </div>

      <div className="sx-results" ref={list}>
        {!query && workspace && (
          <div className="sx-empty">
            <div className="sx-empty-icon">{mode === 'content' ? '🔎' : '📄'}</div>
            <p>{mode === 'content' ? t('searchHelpContent') : t('searchHelpName')}</p>
            <p className="dim">
              <kbd>↑</kbd> <kbd>↓</kbd> {t('navigate')} · <kbd>Enter</kbd> {t('openKey')}
            </p>
          </div>
        )}

        {mode === 'name' &&
          nameMatches.map((f) => {
            rowIndex++;
            const i = rowIndex;
            const { name, dir } = splitPath(f);
            return (
              <div
                key={f}
                className={`sx-filerow ${cursor === i ? 'sx-cursor' : ''}`}
                onClick={() => activateRow(i)}
                title={f}
              >
                <span className="sx-ficon">{fileIcon(f)}</span>
                <span className="sx-fname sx-fuzzy">{fuzzyMarks(query, name)}</span>
                <span className="sx-fdir">{dir}</span>
              </div>
            );
          })}

        {mode === 'content' &&
          grouped.map(([path, l]) => {
            rowIndex++;
            const head = rowIndex;
            const { name, dir } = splitPath(path);
            const isOpen = !collapsed.has(path);
            return (
              <div key={path} className="sx-group">
                <div
                  className={`sx-filerow sx-head ${cursor === head ? 'sx-cursor' : ''}`}
                  title={path}
                  onClick={() => activateRow(head)}
                >
                  <span className={`sx-caret ${isOpen ? 'open' : ''}`}>›</span>
                  <span className="sx-ficon">{fileIcon(path)}</span>
                  <span className="sx-fname">{name}</span>
                  <span className="sx-fdir">{dir}</span>
                  {showReplace && (
                    <button
                      className="sx-mini"
                      title={t('replaceInFile')}
                      onClick={(e) => {
                        e.stopPropagation();
                        void replaceIn([path]);
                      }}
                    >
                      ⇄
                    </button>
                  )}
                  <span className="sx-count">{l.length}</span>
                </div>
                {isOpen &&
                  l.map((h) => {
                    rowIndex++;
                    const i = rowIndex;
                    return (
                      <div
                        key={`${h.line}:${h.column}`}
                        className={`sx-hit ${cursor === i ? 'sx-cursor' : ''}`}
                        onClick={() => activateRow(i)}
                      >
                        <span className="sx-ln">{h.line}</span>
                        <span className="sx-text">
                          {showReplace && replace && goodRe ? (
                            <ReplacePreview
                              text={h.text}
                              re={goodRe}
                              replace={replace}
                              regex={regex}
                            />
                          ) : (
                            highlight(h.text, goodRe)
                          )}
                        </span>
                      </div>
                    );
                  })}
              </div>
            );
          })}
      </div>
    </div>
  );
}

/** Shows the match struck out and the replacement next to it. */
function ReplacePreview({
  text,
  re,
  replace,
  regex,
}: {
  text: string;
  re: RegExp;
  replace: string;
  regex: boolean;
}) {
  const line = text.trim();
  const rx = new RegExp(re.source, re.flags.replace('g', ''));
  const m = rx.exec(line);
  if (!m) return <>{line.slice(0, 160)}</>;
  const start = Math.max(0, m.index - 30);
  const replacement = regex ? m[0].replace(rx, replace) : replace;
  return (
    <>
      {start ? '…' : ''}
      {line.slice(start, m.index)}
      <del>{m[0]}</del>
      <ins>{replacement}</ins>
      {line.slice(m.index + m[0].length, m.index + m[0].length + 100)}
    </>
  );
}
