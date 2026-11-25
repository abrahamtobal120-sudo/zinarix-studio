/**
 * B7: which symbols (class › method…) contain a position of the file, for the breadcrumbs of
 * the editor. Pure: it takes the shape Monaco gives for document symbols.
 */
export interface SymbolNode {
  name: string;
  kind: number;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  children?: SymbolNode[];
}

function contains(r: SymbolNode['range'], line: number, column: number): boolean {
  if (line < r.startLineNumber || line > r.endLineNumber) return false;
  if (line === r.startLineNumber && column < r.startColumn) return false;
  if (line === r.endLineNumber && column > r.endColumn) return false;
  return true;
}

const size = (r: SymbolNode['range']): number =>
  (r.endLineNumber - r.startLineNumber) * 10_000 + (r.endColumn - r.startColumn);

/** The symbols around a position, outermost first. [] when it is outside every symbol. */
export function symbolChain(
  symbols: readonly SymbolNode[],
  line: number,
  column: number,
  maxDepth = 4,
): SymbolNode[] {
  const out: SymbolNode[] = [];
  let level: readonly SymbolNode[] = symbols;
  while (out.length < maxDepth) {
    // Providers may give overlapping siblings: the smallest one around the cursor wins.
    let best: SymbolNode | null = null;
    for (const s of level)
      if (contains(s.range, line, column) && (!best || size(s.range) < size(best.range))) best = s;
    if (!best) break;
    out.push(best);
    level = best.children ?? [];
  }
  return out;
}
