import { describe, expect, it } from 'vitest';
import {
  activeOutlineRow,
  outlineKind,
  outlineParents,
  outlineRows,
} from '../src/shared/outline.js';
import type { SymbolNode } from '../src/shared/symbolPath.js';

const sym = (
  name: string,
  a: number,
  b: number,
  children?: SymbolNode[],
  kind = 5,
): SymbolNode => ({
  name,
  kind,
  range: { startLineNumber: a, startColumn: 1, endLineNumber: b, endColumn: 80 },
  children,
});

const tree = [
  sym('suelta', 22, 30, undefined, 11),
  sym('Caja', 1, 20, [sym('cerrar', 10, 18), sym('abrir', 2, 8, [sym('interna', 4, 6)])], 4),
];
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe('outlineRows', () => {
  it('lists every symbol in file order with its depth', () => {
    const rows = outlineRows(tree);
    expect(names(rows)).toEqual(['Caja', 'abrir', 'interna', 'cerrar', 'suelta']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(rows.map((r) => r.id)).toEqual([
      'Caja',
      'Caja/abrir',
      'Caja/abrir/interna',
      'Caja/cerrar',
      'suelta',
    ]);
    expect(rows[0]).toMatchObject({ hasChildren: true, open: true, line: 1 });
    expect(rows[4]).toMatchObject({ hasChildren: false });
  });

  it('hides the children of a closed symbol', () => {
    const rows = outlineRows(tree, new Set(['Caja/abrir']));
    expect(names(rows)).toEqual(['Caja', 'abrir', 'cerrar', 'suelta']);
    expect(rows[1]!.open).toBe(false);
    expect(names(outlineRows(tree, new Set(['Caja'])))).toEqual(['Caja', 'suelta']);
  });

  it('filters by name, keeps the parents and opens closed branches', () => {
    const rows = outlineRows(tree, new Set(['Caja']), 'INTÉR');
    expect(names(rows)).toEqual(['Caja', 'abrir', 'interna']);
    expect(outlineRows(tree, new Set(), 'nada')).toEqual([]);
    expect(names(outlineRows(tree, new Set(), '  '))).toHaveLength(5);
  });

  it('gives different ids to symbols that share a name', () => {
    const rows = outlineRows([sym('f', 1, 2), sym('f', 4, 5), sym('f', 7, 8)]);
    expect(rows.map((r) => r.id)).toEqual(['f', 'f~1', 'f~2']);
  });

  it('goes to the name of the symbol when the provider says where it is', () => {
    const s = {
      ...sym('f', 3, 9),
      selectionRange: { startLineNumber: 4, startColumn: 10, endLineNumber: 4, endColumn: 11 },
    };
    expect(outlineRows([s])[0]).toMatchObject({ line: 4, column: 10 });
  });
});

describe('outlineParents', () => {
  it('lists the symbols with children', () => {
    expect(outlineParents(tree)).toEqual(['Caja', 'Caja/abrir']);
  });
});

describe('activeOutlineRow', () => {
  it('is the deepest visible symbol around the cursor', () => {
    const rows = outlineRows(tree);
    expect(rows[activeOutlineRow(rows, 5, 3)]!.name).toBe('interna');
    expect(rows[activeOutlineRow(rows, 12, 3)]!.name).toBe('cerrar');
    expect(rows[activeOutlineRow(rows, 9, 3)]!.name).toBe('Caja');
    expect(activeOutlineRow(rows, 21, 1)).toBe(-1);
  });

  it('falls back to the closed parent', () => {
    const rows = outlineRows(tree, new Set(['Caja/abrir']));
    expect(rows[activeOutlineRow(rows, 5, 3)]!.name).toBe('abrir');
  });
});

describe('outlineKind', () => {
  it('tells types, functions and values apart', () => {
    expect(outlineKind(4)).toEqual({ letter: 'C', tone: 'type' });
    expect(outlineKind(11).tone).toBe('func');
    expect(outlineKind(12).tone).toBe('value');
    expect(outlineKind(99).tone).toBe('other');
  });
});
