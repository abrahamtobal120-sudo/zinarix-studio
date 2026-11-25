import { describe, expect, it } from 'vitest';
import { lineHunks, revertEdit, type LineEdit } from '../src/shared/lineHunks.js';

const L = (s: string) => s.split('\n');

/** Apply an editor-style edit to a text (what Monaco does with it). */
function applyEdit(text: string, e: LineEdit): string {
  const lines = text.split('\n');
  const offset = (line: number, col: number) =>
    lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  return (
    text.slice(0, offset(e.startLineNumber, e.startColumn)) +
    e.text +
    text.slice(offset(e.endLineNumber, e.endColumn))
  );
}

/** Reject every hunk, bottom to top, and return the text that results. */
function rejectAll(a: string, b: string, only?: number): string {
  const hunks = lineHunks(L(a), L(b));
  let text = b;
  const order = hunks.map((h, i) => ({ h, i })).reverse();
  for (const { h, i } of order) {
    if (only !== undefined && i !== only) continue;
    const lines = text.split('\n');
    text = applyEdit(
      text,
      revertEdit(
        h.bStart + 1,
        h.bCount,
        L(a).slice(h.aStart, h.aStart + h.aCount),
        lines.length,
        (n) => lines[n - 1]!.length,
        '\n',
      ),
    );
  }
  return text;
}

describe('C4: lineHunks', () => {
  it('gives nothing for equal texts', () => {
    expect(lineHunks(L('a\nb'), L('a\nb'))).toEqual([]);
  });

  it('finds a changed line, an added line and a removed line as separate blocks', () => {
    const a = 'one\ntwo\nthree\nfour\nfive\nsix';
    const b = 'one\nTWO\nthree\nfour\nnew\nfive';
    expect(lineHunks(L(a), L(b))).toEqual([
      { aStart: 1, aCount: 1, bStart: 1, bCount: 1 },
      { aStart: 4, aCount: 0, bStart: 4, bCount: 1 },
      { aStart: 5, aCount: 1, bStart: 6, bCount: 0 },
    ]);
  });

  it('keeps a pure insertion and a pure deletion as one-sided blocks', () => {
    expect(lineHunks(L('a\nc'), L('a\nb\nc'))).toEqual([
      { aStart: 1, aCount: 0, bStart: 1, bCount: 1 },
    ]);
    expect(lineHunks(L('a\nb\nc'), L('a\nc'))).toEqual([
      { aStart: 1, aCount: 1, bStart: 1, bCount: 0 },
    ]);
  });

  it('falls back to one block when the texts are too big to compare line by line', () => {
    const a = Array.from({ length: 2100 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 2100 }, (_, i) => `b${i}`);
    expect(lineHunks(['x', ...a, 'y'], ['x', ...b, 'y'])).toEqual([
      { aStart: 1, aCount: 2100, bStart: 1, bCount: 2100 },
    ]);
  });
});

describe('C4: revertEdit', () => {
  const cases: Array<[string, string, string]> = [
    ['a changed line', 'a\nb\nc', 'a\nB\nc'],
    ['more lines than before', 'a\nb\nc', 'a\nx\ny\nz\nc'],
    ['an added line in the middle', 'a\nc', 'a\nb\nc'],
    ['an added line at the end', 'a\nb', 'a\nb\nc'],
    ['an added line at the start', 'b\nc', 'a\nb\nc'],
    ['a removed line in the middle', 'a\nb\nc', 'a\nc'],
    ['a removed line at the end', 'a\nb\nc', 'a\nb'],
    ['a removed line at the start', 'a\nb\nc', 'b\nc'],
    ['several blocks', 'one\ntwo\nthree\nfour\nfive\nsix', 'one\nTWO\nthree\nfour\nnew\nfive'],
    ['everything changed', 'a\nb', 'x\ny\nz'],
  ];
  for (const [name, a, b] of cases) {
    it(`rejecting every block gives the old text back: ${name}`, () => {
      expect(rejectAll(a, b)).toBe(a);
    });
  }

  it('rejecting one block leaves the others applied', () => {
    const a = 'one\ntwo\nthree\nfour\nfive\nsix';
    const b = 'one\nTWO\nthree\nfour\nnew\nfive';
    expect(rejectAll(a, b, 0)).toBe('one\ntwo\nthree\nfour\nnew\nfive');
    expect(rejectAll(a, b, 1)).toBe('one\nTWO\nthree\nfour\nfive');
    expect(rejectAll(a, b, 2)).toBe('one\nTWO\nthree\nfour\nnew\nfive\nsix');
  });

  it('writes the old lines with the line ending of the file', () => {
    const e = revertEdit(2, 1, ['x', 'y'], 3, () => 1, '\r\n');
    expect(e.text).toBe('x\r\ny');
  });
});
