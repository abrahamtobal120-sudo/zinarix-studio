import { describe, expect, it } from 'vitest';
import { symbolChain, type SymbolNode } from '../src/shared/symbolPath.js';

const sym = (name: string, a: number, b: number, children?: SymbolNode[]): SymbolNode => ({
  name,
  kind: 5,
  range: { startLineNumber: a, startColumn: 1, endLineNumber: b, endColumn: 80 },
  children,
});

const tree = [
  sym('Caja', 1, 20, [sym('abrir', 2, 8, [sym('interna', 4, 6)]), sym('cerrar', 10, 18)]),
  sym('suelta', 22, 30),
];
const names = (line: number, col = 5, depth?: number) =>
  symbolChain(tree, line, col, depth).map((s) => s.name);

describe('symbolChain', () => {
  it('gives the symbols around the cursor, outermost first', () => {
    expect(names(5)).toEqual(['Caja', 'abrir', 'interna']);
    expect(names(12)).toEqual(['Caja', 'cerrar']);
    expect(names(9)).toEqual(['Caja']);
    expect(names(25)).toEqual(['suelta']);
  });

  it('is empty outside every symbol', () => {
    expect(names(21)).toEqual([]);
    expect(symbolChain([], 1, 1)).toEqual([]);
  });

  it('respects the columns on the first and last line', () => {
    const one: SymbolNode[] = [
      {
        name: 'f',
        kind: 12,
        range: { startLineNumber: 3, startColumn: 10, endLineNumber: 3, endColumn: 20 },
      },
    ];
    expect(symbolChain(one, 3, 9)).toEqual([]);
    expect(symbolChain(one, 3, 10).length).toBe(1);
    expect(symbolChain(one, 3, 21)).toEqual([]);
  });

  it('prefers the smallest of overlapping siblings and limits the depth', () => {
    const overlap = [sym('grande', 1, 50), sym('chico', 5, 9)];
    expect(symbolChain(overlap, 6, 2).map((s) => s.name)).toEqual(['chico']);
    expect(names(5, 5, 2)).toEqual(['Caja', 'abrir']);
  });
});
