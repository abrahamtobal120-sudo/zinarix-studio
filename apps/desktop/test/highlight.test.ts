import { describe, expect, it } from 'vitest';
import { fenceLanguage, kindOf, toCodeTokens } from '../src/renderer/highlightKinds.js';

describe('code colours in the chat (estudio C6)', () => {
  it('maps Monaco token types to the kinds the chat styles', () => {
    expect(kindOf('keyword.ts')).toBe('keyword');
    expect(kindOf('comment.doc')).toBe('comment');
    expect(kindOf('string.key.json')).toBe('attr');
    expect(kindOf('string.value.json')).toBe('string');
    expect(kindOf('attribute.name.html')).toBe('attr');
    expect(kindOf('attribute.value.html')).toBe('string');
    expect(kindOf('number.float')).toBe('number');
    expect(kindOf('type.identifier.ts')).toBe('type');
    expect(kindOf('tag.html')).toBe('tag');
    expect(kindOf('regexp.js')).toBe('regexp');
    expect(kindOf('identifier.ts')).toBe('');
    expect(kindOf('delimiter.bracket.ts')).toBe('');
    expect(kindOf('')).toBe('');
  });

  it('cuts lines at token offsets and merges neighbours of the same kind', () => {
    const code = 'const a = "x"; // hi\n\n  return 1';
    const tokens = toCodeTokens(code, [
      [
        { offset: 0, type: 'keyword.ts' },
        { offset: 5, type: '' },
        { offset: 6, type: 'identifier.ts' },
        { offset: 7, type: '' },
        { offset: 8, type: 'delimiter.ts' },
        { offset: 9, type: '' },
        { offset: 10, type: 'string.ts' },
        { offset: 13, type: 'delimiter.ts' },
        { offset: 14, type: '' },
        { offset: 15, type: 'comment.ts' },
      ],
      [],
      [
        { offset: 2, type: 'keyword.ts' },
        { offset: 8, type: '' },
        { offset: 9, type: 'number.ts' },
      ],
    ]);
    expect(tokens).toEqual([
      [
        { text: 'const', kind: 'keyword' },
        { text: ' a = ', kind: '' },
        { text: '"x"', kind: 'string' },
        { text: '; ', kind: '' },
        { text: '// hi', kind: 'comment' },
      ],
      [],
      [
        { text: '  ', kind: '' },
        { text: 'return', kind: 'keyword' },
        { text: ' ', kind: '' },
        { text: '1', kind: 'number' },
      ],
    ]);
    // Nothing is lost or added: the text is the code, whatever Monaco returned.
    const text = (t: typeof tokens) => t.map((l) => l.map((x) => x.text).join('')).join('\n');
    expect(text(tokens)).toBe(code);
    expect(text(toCodeTokens(code, []))).toBe(code);
  });

  it('finds the language of a fence name', () => {
    const known = new Set(['javascript', 'typescript', 'python', 'shell', 'json', 'ini']);
    expect(fenceLanguage('ts', known)).toBe('typescript');
    expect(fenceLanguage('TSX', known)).toBe('typescript');
    expect(fenceLanguage('python', known)).toBe('python');
    expect(fenceLanguage('bash', known)).toBe('shell');
    expect(fenceLanguage('toml', known)).toBe('ini');
    expect(fenceLanguage('', known)).toBe('');
    expect(fenceLanguage('text', known)).toBe('');
    expect(fenceLanguage('klingon', known)).toBe('');
    // A language Monaco does not ship here.
    expect(fenceLanguage('rust', known)).toBe('');
  });
});
