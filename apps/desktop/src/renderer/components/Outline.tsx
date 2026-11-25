import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  activeOutlineRow,
  outlineKind,
  outlineParents,
  outlineRows,
  type OutlineRow,
} from '../../shared/outline';
import { t } from '../i18n';
import { getMainEditor, useStore } from '../store';
import { rowRange, scrollToRow } from '../virtualList';
import { Icon } from './Icon';
import { useDocumentSymbols } from './SymbolCrumbs';

/** Height of a .tree-row (03-layout.css). */
const ROW = 24;
const OPEN_KEY = 'zinarix.outline.open';

function savedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function goTo(row: OutlineRow): void {
  const ed = getMainEditor();
  if (!ed) return;
  const at = { lineNumber: row.line, column: row.column };
  ed.setPosition(at);
  ed.revealPositionInCenterIfOutsideViewport(at);
  ed.focus();
}

/**
 * B7: the outline of the file in the main editor, as a section at the bottom of the explorer.
 * It follows the cursor, a click goes to the symbol, and it stays closed until asked for.
 */
export function Outline() {
  const active = useStore((s) => s.active);
  // The cursor in the store follows the focused group; the outline describes the main one.
  const cursor = useStore((s) => (s.editorFocus === 1 && s.split ? null : s.cursor));
  const [open, setOpen] = useState(savedOpen);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [view, setView] = useState({ top: 0, height: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const symbols = useDocumentSymbols(active, open);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* private mode: the choice lasts for this window only */
    }
  };
  const showNow = useEffectEvent(() => toggle(true));
  useEffect(() => {
    const show = () => showNow();
    window.addEventListener('zinarix:outline-show', show);
    return () => window.removeEventListener('zinarix:outline-show', show);
  }, []);
  // Another file: its own branches, nothing filtered.
  useEffect(() => {
    setCollapsed(new Set());
    setFilter('');
  }, [active]);

  const rows = useMemo(() => outlineRows(symbols, collapsed, filter), [symbols, collapsed, filter]);
  const parents = useMemo(() => outlineParents(symbols), [symbols]);
  const current = cursor ? activeOutlineRow(rows, cursor.line, cursor.column) : -1;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () =>
      setView((v) => (v.height === el.clientHeight ? v : { ...v, height: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // Keep the symbol under the cursor in sight, unless the reader is busy inside the outline.
  useEffect(() => {
    const el = listRef.current;
    if (!el || current < 0 || el.matches(':hover') || el.contains(document.activeElement)) return;
    const top = scrollToRow(current, el.scrollTop, el.clientHeight, ROW);
    if (top !== null) el.scrollTop = top;
  }, [current]);

  const flip = (row: OutlineRow) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (row.open) next.add(row.id);
      else next.delete(row.id);
      return next;
    });

  const focusRow = (index: number) => {
    const el = listRef.current;
    if (!el || index < 0 || index >= rows.length) return;
    const top = scrollToRow(index, el.scrollTop, el.clientHeight, ROW);
    if (top !== null) el.scrollTop = top;
    // The row may not be mounted until the scroll above is drawn.
    requestAnimationFrame(() =>
      el.querySelector<HTMLElement>(`[data-row="${index}"]`)?.focus({ preventScroll: true }),
    );
  };

  const onKey = (k: React.KeyboardEvent<HTMLDivElement>, row: OutlineRow, index: number) => {
    if (k.key === 'ArrowDown') focusRow(index + 1);
    else if (k.key === 'ArrowUp') focusRow(index - 1);
    else if (k.key === 'Home') focusRow(0);
    else if (k.key === 'End') focusRow(rows.length - 1);
    else if (k.key === 'Enter' || k.key === ' ') goTo(row);
    else if (k.key === 'ArrowRight' && row.hasChildren && !row.open) flip(row);
    else if (k.key === 'ArrowLeft' && row.hasChildren && row.open && !filter) flip(row);
    else return;
    k.preventDefault();
  };

  const range = rowRange(view.top, view.height, ROW, rows.length);
  const allClosed = parents.length > 0 && parents.every((id) => collapsed.has(id));
  // Rows can take the Tab stop one at a time: the current symbol, else the first row.
  const tabStop = current >= 0 ? current : 0;

  return (
    <section className={`outline${open ? ' open' : ''}`} aria-label={t('outline')}>
      <div className="outline-head">
        <button
          className="outline-toggle"
          aria-expanded={open}
          aria-controls="outline-list"
          onClick={() => toggle(!open)}
        >
          <span className={`twisty${open ? ' open' : ''}`}>
            <Icon name="chevron" size={12} />
          </span>
          {t('outline')}
        </button>
        {open && parents.length > 0 && !filter && (
          <button
            className="outline-action"
            title={allClosed ? t('outlineExpandAll') : t('outlineCollapseAll')}
            aria-label={allClosed ? t('outlineExpandAll') : t('outlineCollapseAll')}
            onClick={() => setCollapsed(allClosed ? new Set() : new Set(parents))}
          >
            <Icon name={allClosed ? 'chevronDown' : 'chevron'} size={14} />
          </button>
        )}
      </div>
      {open && (
        <>
          {symbols.length > 0 && (
            <input
              className="outline-filter"
              type="search"
              value={filter}
              placeholder={t('outlineFilter')}
              aria-label={t('outlineFilter')}
              onChange={(ev) => setFilter(ev.target.value)}
              onKeyDown={(k) => {
                if (k.key === 'Escape' && filter) {
                  k.stopPropagation();
                  setFilter('');
                } else if (k.key === 'ArrowDown') {
                  k.preventDefault();
                  focusRow(0);
                } else if (k.key === 'Enter' && rows[0]) {
                  // The first match that is not just a parent of one.
                  const needle = filter.trim().toLowerCase();
                  goTo(rows.find((r) => r.name.toLowerCase().includes(needle)) ?? rows[0]);
                }
              }}
            />
          )}
          <div
            id="outline-list"
            className="outline-list"
            role="tree"
            aria-label={t('outline')}
            ref={listRef}
            onScroll={(ev) => {
              const top = ev.currentTarget.scrollTop;
              setView((v) => (Math.abs(v.top - top) < ROW ? v : { ...v, top }));
            }}
          >
            {rows.length === 0 ? (
              <p className="outline-empty">
                {symbols.length
                  ? t('outlineNoMatch')
                  : active
                    ? t('outlineEmpty')
                    : t('outlineNoFile')}
              </p>
            ) : (
              <div className="tree-rows" role="none" style={{ height: rows.length * ROW }}>
                {rows.slice(range.start, range.end).map((row, i) => {
                  const index = range.start + i;
                  const kind = outlineKind(row.kind);
                  return (
                    <div
                      key={row.id}
                      data-row={index}
                      className={`tree-row outline-row${index === current ? ' selected' : ''}`}
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-selected={index === current}
                      aria-expanded={row.hasChildren ? row.open : undefined}
                      tabIndex={index === tabStop ? 0 : -1}
                      style={{ top: index * ROW, paddingLeft: 6 + row.depth * 12 }}
                      title={row.name}
                      onClick={() => goTo(row)}
                      onKeyDown={(k) => onKey(k, row, index)}
                    >
                      <span
                        className={`twisty${row.open ? ' open' : ''}`}
                        onClick={(ev) => {
                          if (!row.hasChildren || filter) return;
                          ev.stopPropagation();
                          flip(row);
                        }}
                      >
                        {row.hasChildren && <Icon name="chevron" size={12} />}
                      </span>
                      <span className={`outline-kind ${kind.tone}`} aria-hidden="true">
                        {kind.letter}
                      </span>
                      <span className="tree-label">{row.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
