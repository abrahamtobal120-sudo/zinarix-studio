import { describe, expect, it } from 'vitest';
import { InlineCache, worthAsking } from '../src/shared/inlineCache.js';

describe('InlineCache', () => {
  it('returns the suggestion again at the same place', () => {
    const c = new InlineCache();
    c.put('a.ts', 'const x = ', ';\n', '42');
    expect(c.get('a.ts', 'const x = ', ';\n')).toBe('42');
    expect(c.get('b.ts', 'const x = ', ';\n')).toBeUndefined();
  });

  it('keeps the rest of a suggestion while the user types it', () => {
    const c = new InlineCache();
    c.put('a.ts', 'function sum(a, b) {\n  ', '\n}', 'return a + b;');
    expect(c.get('a.ts', 'function sum(a, b) {\n  ret', '\n}')).toBe('urn a + b;');
    expect(c.get('a.ts', 'function sum(a, b) {\n  return a + b', '\n}')).toBe(';');
  });

  it('asks again when the user types something else, finishes it, or the next code changed', () => {
    const c = new InlineCache();
    c.put('a.ts', 'let n = ', '\nrest', 'count + 1;');
    expect(c.get('a.ts', 'let n = cx', '\nrest')).toBeUndefined();
    expect(c.get('a.ts', 'let n = count + 1;', '\nrest')).toBeUndefined();
    expect(c.get('a.ts', 'let n = ', ' // nota\nrest')).toBeUndefined();
    expect(c.get('a.ts', 'let n', '\nrest')).toBeUndefined();
  });

  it('only compares the rest of the cursor line, with either line ending', () => {
    const c = new InlineCache();
    c.put('a.ts', 'a(', ')\r\nold();', 'x');
    expect(c.get('a.ts', 'a(', ')\nnew();')).toBe('x');
  });

  it('replaces the entry of a place and forgets the oldest ones', () => {
    const c = new InlineCache(2);
    c.put('a.ts', 'p1', '', 'uno');
    c.put('a.ts', 'p1', '', 'dos');
    expect(c.get('a.ts', 'p1', '')).toBe('dos');
    c.put('a.ts', 'p2', '', 'x');
    c.put('a.ts', 'p3', '', 'y');
    expect(c.get('a.ts', 'p1', '')).toBeUndefined();
    expect(c.get('a.ts', 'p3', '')).toBe('y');
    c.clear();
    expect(c.get('a.ts', 'p3', '')).toBeUndefined();
  });
});

describe('worthAsking', () => {
  it('asks at the end of a line and on an empty line', () => {
    expect(worthAsking('const a = ', '\nconst b = 2;')).toBe(true);
    expect(worthAsking('function f() {\n  ', '\n}')).toBe(true);
    expect(worthAsking('const a = 1;\n', '')).toBe(true);
  });

  it('asks when only closing brackets, quotes or punctuation follow', () => {
    expect(worthAsking('call(', ');\nnext()')).toBe(true);
    expect(worthAsking('const s = "', '";')).toBe(true);
    expect(worthAsking('items.map((x) => ', ')}\r\nrest')).toBe(true);
  });

  it('does not ask in the middle of a statement or of a word', () => {
    expect(worthAsking('const na', 'me = 1;')).toBe(false);
    expect(worthAsking('call(', 'arg, other);')).toBe(false);
    expect(worthAsking('if (', ' ready) {')).toBe(false);
  });

  it('does not ask in an empty file', () => {
    expect(worthAsking('  \n', '')).toBe(false);
  });
});
