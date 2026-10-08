import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface PickItem {
  id: string;
  label: string;
  detail?: string;
  hint?: string;
  group?: string;
  render?: ReactNode;
}

/** Fuzzy subsequence score; higher is better, -1 = no match. */
export function fuzzy(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  const direct = s.indexOf(q);
  if (direct >= 0) return 1000 - direct - s.length * 0.01;
  let score = 0;
  let pos = -1;
  for (const ch of q) {
    const next = s.indexOf(ch, pos + 1);
    if (next < 0) return -1;
    score += next === pos + 1 ? 5 : 1;
    pos = next;
  }
  return score - s.length * 0.01;
}

export function QuickPick({
  placeholder,
  items,
  onPick,
  onClose,
  footer,
  initial = '',
  limit = 200,
  renderItem,
}: {
  placeholder: string;
  items: PickItem[];
  onPick: (item: PickItem) => void;
  onClose: () => void;
  footer?: ReactNode;
  initial?: string;
  limit?: number;
  /** Custom row renderer that can use the current query (e.g. to highlight matches). */
  renderItem?: (item: PickItem, query: string) => ReactNode;
}) {
  const [query, setQuery] = useState(initial);
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, limit);
    return items
      .map((it) => ({
        it,
        s: Math.max(
          fuzzy(query, it.label),
          fuzzy(query, `${it.group ?? ''} ${it.detail ?? ''}`) - 50,
        ),
      }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.it);
  }, [items, query, limit]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('.pick-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="quick-pick" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && filtered[index]) onPick(filtered[index]!);
          }}
        />
        <div className="pick-list" ref={list}>
          {filtered.map((it, i) => (
            <div key={it.id}>
              {it.group && (i === 0 || filtered[i - 1]!.group !== it.group) && !query && (
                <div className="pick-group">{it.group}</div>
              )}
              <div
                className={`pick-item ${i === index ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onPick(it)}
              >
                {renderItem?.(it, query) ?? it.render ?? (
                  <>
                    <span className="pick-label">{it.label}</span>
                    {it.detail && <span className="pick-detail">{it.detail}</span>}
                    {it.hint && <span className="pick-hint">{it.hint}</span>}
                  </>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="pick-empty">—</div>}
        </div>
        {footer && <div className="pick-footer">{footer}</div>}
      </div>
    </div>
  );
}
