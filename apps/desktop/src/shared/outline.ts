/**
 * B7: the outline of a file (its classes, functions, fields…) as the flat list of rows a tree
 * panel draws. Pure: it takes the symbol tree Monaco gives and knows nothing about the DOM.
 */
import type { SymbolNode } from './symbolPath';

export interface OutlineRow {
  /** Stable between reloads of the symbols while the names do not change: "Caja/abrir". */
  id: string;
  name: string;
  kind: number;
  depth: number;
  /** Where a click goes: the name of the symbol when the provider says where it is. */
  line: number;
  column: number;
  range: SymbolNode['range'];
  hasChildren: boolean;
  open: boolean;
}

type Positioned = SymbolNode & { selectionRange?: SymbolNode['range'] };

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const byPosition = (a: SymbolNode, b: SymbolNode): number =>
  a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn;

function matches(s: SymbolNode, needle: string): boolean {
  if (fold(s.name).includes(needle)) return true;
  return (s.children ?? []).some((c) => matches(c, needle));
}

/**
 * Rows to draw, in file order. `collapsed` holds the ids of the closed symbols. With a filter
 * the tree shows only the symbols whose name contains it (accents and case do not matter) plus
 * their parents, all open, so a match is never hidden inside a closed branch.
 */
export function outlineRows(
  symbols: readonly SymbolNode[],
  collapsed: ReadonlySet<string> = new Set(),
  filter = '',
): OutlineRow[] {
  const needle = fold(filter.trim());
  const out: OutlineRow[] = [];
  const walk = (level: readonly SymbolNode[], depth: number, prefix: string): void => {
    // Two symbols of one level may share a name (overloads): the second is "name~1".
    const seen = new Map<string, number>();
    for (const s of [...level].sort(byPosition) as Positioned[]) {
      const n = seen.get(s.name) ?? 0;
      seen.set(s.name, n + 1);
      if (needle && !matches(s, needle)) continue;
      const id = `${prefix}${s.name}${n ? `~${n}` : ''}`;
      const kids = s.children ?? [];
      const open = needle ? true : !collapsed.has(id);
      const at = s.selectionRange ?? s.range;
      out.push({
        id,
        name: s.name,
        kind: s.kind,
        depth,
        line: at.startLineNumber,
        column: at.startColumn,
        range: s.range,
        hasChildren: kids.length > 0,
        open,
      });
      if (kids.length && open) walk(kids, depth + 1, `${id}/`);
    }
  };
  walk(symbols, 0, '');
  return out;
}

/** Ids of every symbol that has children (what "collapse all" closes). */
export function outlineParents(symbols: readonly SymbolNode[]): string[] {
  return outlineRows(symbols)
    .filter((r) => r.hasChildren)
    .map((r) => r.id);
}

function contains(r: SymbolNode['range'], line: number, column: number): boolean {
  if (line < r.startLineNumber || line > r.endLineNumber) return false;
  if (line === r.startLineNumber && column < r.startColumn) return false;
  if (line === r.endLineNumber && column > r.endColumn) return false;
  return true;
}

/**
 * Index of the row the cursor is in: the deepest visible symbol around it (a closed parent
 * stands for its hidden children). -1 outside every symbol.
 */
export function activeOutlineRow(
  rows: readonly OutlineRow[],
  line: number,
  column: number,
): number {
  let best = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!contains(r.range, line, column)) continue;
    if (best < 0 || r.depth >= rows[best]!.depth) best = i;
  }
  return best;
}

export type OutlineTone = 'type' | 'func' | 'value' | 'other';

/**
 * A letter and a colour family for a symbol kind (Monaco's SymbolKind numbers), so a row can be
 * told apart at a glance without an icon set.
 */
export function outlineKind(kind: number): { letter: string; tone: OutlineTone } {
  switch (kind) {
    case 4:
      return { letter: 'C', tone: 'type' };
    case 10:
      return { letter: 'I', tone: 'type' };
    case 9:
      return { letter: 'E', tone: 'type' };
    case 22:
      return { letter: 'S', tone: 'type' };
    case 25:
      return { letter: 'T', tone: 'type' };
    case 1:
    case 2:
    case 3:
      return { letter: 'N', tone: 'type' };
    case 5:
    case 8:
      return { letter: 'M', tone: 'func' };
    case 11:
      return { letter: 'F', tone: 'func' };
    case 6:
    case 7:
      return { letter: 'P', tone: 'value' };
    case 12:
      return { letter: 'V', tone: 'value' };
    case 13:
    case 21:
      return { letter: 'K', tone: 'value' };
    default:
      return { letter: '·', tone: 'other' };
  }
}
