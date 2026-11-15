import { describe, expect, it } from 'vitest';
import {
  bumpRecent,
  frecency,
  parseLine,
  parseQuery,
  prefixOf,
  rankItems,
  readRecent,
  recentKey,
} from '../src/shared/palette';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

describe('parseQuery', () => {
  it('reads the scope from the first character', () => {
    expect(parseQuery('app.tsx')).toEqual({ scope: 'files', text: 'app.tsx' });
    expect(parseQuery('>  theme')).toEqual({ scope: 'commands', text: 'theme' });
    expect(parseQuery('@render')).toEqual({ scope: 'symbols', text: 'render' });
    expect(parseQuery('#bug')).toEqual({ scope: 'chats', text: 'bug' });
    expect(parseQuery(':12')).toEqual({ scope: 'line', text: '12' });
  });
  it('a prefix later in the text is plain text', () => {
    expect(parseQuery('a>b')).toEqual({ scope: 'files', text: 'a>b' });
    expect(parseQuery('')).toEqual({ scope: 'files', text: '' });
  });
  it('prefixOf is the inverse', () => {
    for (const s of ['commands', 'symbols', 'chats', 'line'] as const)
      expect(parseQuery(prefixOf(s)).scope).toBe(s);
    expect(prefixOf('files')).toBe('');
  });
});

describe('parseLine', () => {
  it('line and optional column', () => {
    expect(parseLine('120')).toEqual({ line: 120, column: 1 });
    expect(parseLine('120:8')).toEqual({ line: 120, column: 8 });
    expect(parseLine(' 5 , 3 ')).toEqual({ line: 5, column: 3 });
  });
  it('rejects what is not a line', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('0')).toBeNull();
    expect(parseLine('abc')).toBeNull();
    expect(parseLine('12a')).toBeNull();
  });
});

describe('recent', () => {
  it('frecency halves after a week and caps the count', () => {
    expect(frecency(undefined, NOW)).toBe(0);
    expect(frecency({ n: 4, last: NOW }, NOW)).toBe(4);
    expect(frecency({ n: 4, last: NOW - 7 * DAY }, NOW)).toBeCloseTo(2);
    expect(frecency({ n: 500, last: NOW }, NOW)).toBe(20);
  });
  it('bump counts and keeps the cap, never dropping the one just picked', () => {
    let r = bumpRecent({}, 'files:a', NOW);
    r = bumpRecent(r, 'files:a', NOW + 1);
    expect(r['files:a']).toEqual({ n: 2, last: NOW + 1 });
    const many = { x: { n: 9, last: NOW }, y: { n: 1, last: NOW - 60 * DAY } };
    const capped = bumpRecent(many, 'z', NOW, 2);
    expect(Object.keys(capped).sort()).toEqual(['x', 'z']);
  });
  it('bump does not change its input', () => {
    const r = { a: { n: 1, last: 0 } };
    bumpRecent(r, 'a', NOW);
    expect(r.a.n).toBe(1);
  });
  it('readRecent drops broken entries', () => {
    expect(readRecent(null)).toEqual({});
    expect(readRecent([1, 2])).toEqual({});
    expect(
      readRecent({
        ok: { n: 2.7, last: 5 },
        bad: { n: 'x', last: 1 },
        neg: { n: -1, last: 1 },
        no: 3,
      }),
    ).toEqual({ ok: { n: 2, last: 5 } });
  });
  it('recentKey separates scopes', () => {
    expect(recentKey('files', 'a')).not.toBe(recentKey('commands', 'a'));
  });
});

describe('rankItems', () => {
  const s = (item: string, score: number) => ({ item, score, key: item });
  it('empty query: used lately first, then the original order', () => {
    const recent = { c: { n: 3, last: NOW }, b: { n: 1, last: NOW } };
    expect(rankItems([s('a', 0), s('b', 0), s('c', 0), s('d', 0)], recent, NOW, true)).toEqual([
      'c',
      'b',
      'a',
      'd',
    ]);
  });
  it('drops non-matches', () => {
    expect(rankItems([s('a', -1), s('b', 3)], {}, NOW, false)).toEqual(['b']);
  });
  it('use breaks a near tie but not a much better match', () => {
    const recent = { used: { n: 5, last: NOW } };
    expect(rankItems([s('other', 995), s('used', 990)], recent, NOW, false)).toEqual([
      'used',
      'other',
    ]);
    expect(rankItems([s('other', 995), s('used', 12)], recent, NOW, false)).toEqual([
      'other',
      'used',
    ]);
  });
});
