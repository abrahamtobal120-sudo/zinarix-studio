import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bm25Scores, buildBm25, chunkCode } from '../src/main/knowledgeText';

/** A function of `n` lines in total, named `name`. */
const fn = (name: string, n: number): string =>
  [
    `export function ${name}() {`,
    ...Array.from({ length: n - 2 }, (_, i) => `  step${i}(${name}Value);`),
    '}',
  ].join('\n');

describe('chunkCode', () => {
  it('returns nothing for an empty file and one chunk for a small one', () => {
    expect(chunkCode('a.ts', '  \n\n')).toEqual([]);
    const small = `import x from 'x';\n\n${fn('uno', 5)}\n`;
    const chunks = chunkCode('a.ts', small);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ source: 'a.ts', start: 1, end: 7 });
  });

  it('cuts between functions, never inside one', () => {
    const text = [fn('alfa', 40), fn('beta', 40), fn('gamma', 40)].join('\n\n');
    const chunks = chunkCode('a.ts', text);
    expect(chunks.map((c) => [c.start, c.end])).toEqual([
      [1, 40],
      [42, 81],
      [83, 122],
    ]);
    for (const c of chunks) {
      expect(c.text.startsWith('export function')).toBe(true);
      expect(c.text.endsWith('}')).toBe(true);
    }
  });

  it('packs small neighbours into one chunk', () => {
    const text = Array.from({ length: 12 }, (_, i) => fn(`f${i}`, 9)).join('\n\n');
    const chunks = chunkCode('a.ts', text);
    // 12 blocks of 10 lines (9 + the blank): six fit in 60 lines.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.text).toContain('function f5()');
    expect(chunks[1]!.text.startsWith('export function f6()')).toBe(true);
  });

  it('keeps a comment and a decorator with the declaration under them', () => {
    const text = [
      fn('antes', 50),
      `/** Explica a despues. */\n@decorador\n${fn('despues', 50)}`,
    ].join('\n\n');
    const chunks = chunkCode('a.ts', text);
    expect(chunks).toHaveLength(2);
    expect(
      chunks[1]!.text.startsWith('/** Explica a despues. */\n@decorador\nexport function'),
    ).toBe(true);
  });

  it('cuts a long class at its methods', () => {
    const method = (name: string) =>
      [`  ${name}() {`, ...Array.from({ length: 38 }, (_, i) => `    paso${i}();`), '  }'].join(
        '\n',
      );
    const text = [
      'class Grande {',
      '  campo = 1;',
      '',
      method('uno'),
      '',
      method('dos'),
      '',
      method('tres'),
      '}',
    ].join('\n');
    const chunks = chunkCode('a.ts', text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.some((c) => c.text.startsWith('  dos() {') && c.text.includes('paso37'))).toBe(
      true,
    );
    expect(chunks.some((c) => /^ {2}tres\(\) \{/.test(c.text))).toBe(true);
  });

  it('works on Python, where blocks end with no closing line', () => {
    const def = (name: string) =>
      [
        `def ${name}(x):`,
        ...Array.from({ length: 34 }, (_, i) => `    y${i} = x + ${i}`),
        '    return x',
      ].join('\n');
    const chunks = chunkCode('a.py', [def('uno'), def('dos'), def('tres')].join('\n\n\n'));
    expect(chunks.map((c) => c.text.split('\n')[0])).toEqual([
      'def uno(x):',
      'def dos(x):',
      'def tres(x):',
    ]);
  });

  it('falls back to line windows when the text has no structure', () => {
    const text = Array.from({ length: 200 }, (_, i) => `"k${i}": ${i},`).join('\n');
    const chunks = chunkCode('a.json', text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.max(...chunks.map((c) => c.end - c.start + 1))).toBeLessThanOrEqual(60);
    expect(chunks[0]!.start).toBe(1);
    expect(chunks.at(-1)!.end).toBe(200);
  });

  it('covers every line of a real source file with chunks of a sane size', () => {
    const path = join(__dirname, '../src/main/knowledgeText.ts');
    const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const chunks = chunkCode('knowledgeText.ts', text);
    const covered = new Set<number>();
    for (const c of chunks) {
      expect(c.end - c.start + 1).toBeLessThanOrEqual(90);
      expect(c.text.split('\n')[0]).toBe(lines[c.start - 1]);
      for (let n = c.start; n <= c.end; n++) covered.add(n);
    }
    lines.forEach((line, i) => {
      if (line.trim()) expect(covered.has(i + 1), `line ${i + 1} is in no chunk`).toBe(true);
    });
    // The function is found whole: its chunk starts at its comment or declaration.
    const index = buildBm25(chunks);
    const scores = bm25Scores(index, 'light stemmer plural suffixes');
    const best = chunks[scores.indexOf(Math.max(...scores))]!;
    expect(best.text).toContain('function stem(');
    expect(best.text).toContain('return w;\n}');
  });
});
