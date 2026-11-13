import { useEffect, useState } from 'react';
import type { KnowledgeHit } from '../../shared/api';
import { t } from '../i18n';
import { api, openFile, useStore } from '../store';
import { fileIcon } from './icons';

/** Search panel, "Significado" mode: the project's knowledge index (embeddings or BM25). */
export function SemanticResults({ query, nonce }: { query: string; nonce: number }) {
  const workspace = useStore((s) => s.workspace);
  const [hits, setHits] = useState<KnowledgeHit[]>([]);
  const [info, setInfo] = useState<{ semantic: boolean; files: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!workspace || q.length < 3) {
      setHits([]);
      setInfo(null);
      return;
    }
    let live = true;
    // Longer pause than the text search: with an embedding model each query costs a call.
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const r = await api().knowledge.search(q, 25);
        if (!live) return;
        setHits(r.hits);
        setInfo({ semantic: r.semantic, files: r.files });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setBusy(false);
      }
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, workspace, nonce]);

  return (
    <>
      <div className="sx-summary">
        {busy ? (
          <>
            <span className="sx-spinner" /> <span className="dim">{t('searchIndexing')}</span>
          </>
        ) : !workspace ? (
          t('openFolder')
        ) : error ? (
          <span className="sx-warn">{error}</span>
        ) : info ? (
          <>
            {t('filesFound', { n: hits.length })}
            <span className="dim">
              &nbsp;· {info.semantic ? t('searchSemantic') : t('searchLexical')} ·{' '}
              {t('searchIndexed', { n: info.files })}
            </span>
          </>
        ) : (
          ''
        )}
      </div>
      <div className="sx-results">
        {!query.trim() && workspace && (
          <div className="sx-empty">
            <p>{t('searchMeaningHint')}</p>
          </div>
        )}
        {hits.map((h) => {
          const i = h.source.lastIndexOf('/');
          const name = h.source.slice(i + 1);
          const dir = i > 0 ? h.source.slice(0, i) : '';
          const preview = h.text
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 3)
            .join('  ⏎ ')
            .slice(0, 220);
          return (
            <div key={`${h.source}:${h.start}`} className="sx-group">
              <div
                className="sx-filerow sx-head"
                title={`${h.source}:${h.start}-${h.end}`}
                onClick={() => void openFile(h.source, { line: h.start, column: 1 })}
              >
                <span className="sx-ficon">{fileIcon(h.source)}</span>
                <span className="sx-fname">{name}</span>
                <span className="sx-fdir">{dir}</span>
                <span className="sx-count">
                  {h.start}-{h.end}
                </span>
              </div>
              <div
                className="sx-hit"
                onClick={() => void openFile(h.source, { line: h.start, column: 1 })}
              >
                <span className="sx-text dim">{preview}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
