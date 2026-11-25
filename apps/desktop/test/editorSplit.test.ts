import { describe, expect, it } from 'vitest';
import {
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  clampRatio,
  ratioAt,
  splitActivate,
  splitClose,
  splitOpen,
  splitPrune,
} from '../src/renderer/editorSplit.js';

describe('side editor group (estudio B1)', () => {
  it('opens the first file and creates the group', () => {
    expect(splitOpen(null, 'a.ts')).toEqual({ paths: ['a.ts'], active: 'a.ts' });
  });

  it('adds a file at the end and puts it in front', () => {
    const s = splitOpen(splitOpen(null, 'a.ts'), 'b.ts');
    expect(s).toEqual({ paths: ['a.ts', 'b.ts'], active: 'b.ts' });
  });

  it('does not duplicate a file that is already there: it only comes to the front', () => {
    const s = splitOpen(splitOpen(splitOpen(null, 'a.ts'), 'b.ts'), 'a.ts');
    expect(s).toEqual({ paths: ['a.ts', 'b.ts'], active: 'a.ts' });
  });

  it('closing the file in front shows its neighbour', () => {
    const s = { paths: ['a', 'b', 'c'], active: 'b' };
    expect(splitClose(s, 'b')).toEqual({ paths: ['a', 'c'], active: 'c' });
    expect(splitClose({ ...s, active: 'c' }, 'c')).toEqual({ paths: ['a', 'b'], active: 'b' });
  });

  it('closing another file keeps the one in front', () => {
    expect(splitClose({ paths: ['a', 'b'], active: 'b' }, 'a')).toEqual({
      paths: ['b'],
      active: 'b',
    });
  });

  it('closing the last file removes the group', () => {
    expect(splitClose({ paths: ['a'], active: 'a' }, 'a')).toBeNull();
    expect(splitClose(null, 'a')).toBeNull();
  });

  it('closing a file that is not there changes nothing', () => {
    const s = { paths: ['a'], active: 'a' };
    expect(splitClose(s, 'zzz')).toBe(s);
  });

  it('prune drops the files that are gone and keeps a valid front', () => {
    const s = { paths: ['a', 'b', 'c'], active: 'a' };
    expect(splitPrune(s, (p) => p !== 'a')).toEqual({ paths: ['b', 'c'], active: 'b' });
    expect(splitPrune(s, () => false)).toBeNull();
    expect(splitPrune(s, () => true)).toBe(s);
    expect(splitPrune(null, () => true)).toBeNull();
  });

  it('activate ignores unknown paths', () => {
    const s = { paths: ['a', 'b'], active: 'a' };
    expect(splitActivate(s, 'b')).toEqual({ paths: ['a', 'b'], active: 'b' });
    expect(splitActivate(s, 'x')).toBe(s);
    expect(splitActivate(s, 'a')).toBe(s);
  });
});

describe('the divider between the two editor groups', () => {
  it('bounds the share and falls back to half for anything that is not a number', () => {
    expect(clampRatio(0.3)).toBe(0.3);
    expect(clampRatio(0.01)).toBe(SPLIT_MIN);
    expect(clampRatio(5)).toBe(SPLIT_MAX);
    expect(clampRatio(NaN)).toBe(SPLIT_DEFAULT);
    expect(clampRatio(undefined)).toBe(SPLIT_DEFAULT);
    expect(clampRatio('0.3')).toBe(SPLIT_DEFAULT);
  });

  it('turns the pointer position into a share of the row', () => {
    expect(ratioAt(600, 100, 1000)).toBe(0.5);
    expect(ratioAt(400, 100, 1000)).toBeCloseTo(0.3);
    // Dragged past the edges: the bounds hold.
    expect(ratioAt(0, 100, 1000)).toBe(SPLIT_MIN);
    expect(ratioAt(5000, 100, 1000)).toBe(SPLIT_MAX);
  });

  it('keeps a minimum width for each group in a narrow row', () => {
    // 500 px wide: 20 % would be 100 px, less than the 160 px each group keeps.
    expect(ratioAt(0, 0, 500)).toBeCloseTo(0.32);
    expect(ratioAt(500, 0, 500)).toBeCloseTo(0.68);
    // No room for both minimums: half and half.
    expect(ratioAt(10, 0, 200)).toBe(0.5);
    expect(ratioAt(10, 0, 0)).toBe(SPLIT_DEFAULT);
  });
});
