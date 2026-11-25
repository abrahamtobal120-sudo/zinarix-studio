import { describe, expect, it } from 'vitest';
import { gutterMarks, gutterSummary, nextMark } from '../src/shared/gitGutter.js';

const T = (...l: string[]) => l.join('\n');

describe('gutterMarks', () => {
  it('equal texts give no marks', () => {
    expect(gutterMarks(T('a', 'b'), T('a', 'b'))).toEqual([]);
  });

  it('ignores line endings', () => {
    expect(gutterMarks('a\r\nb\r\n', 'a\nb\n')).toEqual([]);
  });

  it('marks added lines', () => {
    expect(gutterMarks(T('a', 'c'), T('a', 'b1', 'b2', 'c'))).toEqual([
      { kind: 'added', start: 2, end: 3, old: [] },
    ]);
  });

  it('marks modified lines with the old text', () => {
    expect(gutterMarks(T('a', 'b', 'c'), T('a', 'B', 'c'))).toEqual([
      { kind: 'modified', start: 2, end: 2, old: ['b'] },
    ]);
  });

  it('marks a deletion above the line that follows it', () => {
    expect(gutterMarks(T('a', 'b', 'c'), T('a', 'c'))).toEqual([
      { kind: 'deleted', start: 2, end: 2, above: true, old: ['b'] },
    ]);
  });

  it('marks a deletion at the end below the last line', () => {
    expect(gutterMarks(T('a', 'b', 'c'), T('a'))).toEqual([
      { kind: 'deleted', start: 1, end: 1, above: false, old: ['b', 'c'] },
    ]);
  });

  it('gives several marks top to bottom', () => {
    const marks = gutterMarks(T('1', '2', '3', '4', '5'), T('0', '1', '2', 'x', '4'));
    expect(marks.map((m) => [m.kind, m.start, m.end])).toEqual([
      ['added', 1, 1],
      ['modified', 4, 4],
      ['deleted', 5, 5],
    ]);
    expect(gutterSummary(marks)).toEqual({ added: 1, modified: 1, deleted: 1 });
  });

  it('gives nothing for a huge file', () => {
    expect(gutterMarks('a', 'b'.repeat(1_500_001))).toEqual([]);
  });
});

describe('nextMark', () => {
  const marks = gutterMarks(T('1', '2', '3', '4', '5', '6'), T('1', 'x', '3', '4', 'y', '6'));

  it('goes forward and wraps', () => {
    expect(nextMark(marks, 1, 1)?.start).toBe(2);
    expect(nextMark(marks, 2, 1)?.start).toBe(5);
    expect(nextMark(marks, 5, 1)?.start).toBe(2);
  });

  it('goes back and wraps', () => {
    expect(nextMark(marks, 6, -1)?.start).toBe(5);
    expect(nextMark(marks, 5, -1)?.start).toBe(2);
    expect(nextMark(marks, 2, -1)?.start).toBe(5);
  });

  it('is null without marks', () => {
    expect(nextMark([], 1, 1)).toBeNull();
  });
});
