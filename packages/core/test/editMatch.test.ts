import { describe, expect, it } from 'vitest';
import { applyEdit, dominantEol } from '../src/editMatch.js';

const ok = (r: ReturnType<typeof applyEdit>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('applyEdit', () => {
  it('replaces an exact, unique match', () => {
    const r = ok(applyEdit('a = 1;\nb = 2;\n', 'b = 2;', 'b = 3;'));
    expect(r.text).toBe('a = 1;\nb = 3;\n');
    expect(r.how).toBe('exact');
  });

  it('keeps $ sequences of the new text literal', () => {
    expect(ok(applyEdit('x', 'x', "$& $1 $'")).text).toBe("$& $1 $'");
  });

  it('refuses an ambiguous match unless replaceAll is set', () => {
    const r = applyEdit('x\nx\n', 'x', 'y');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/appears 2 times/);
    const all = ok(applyEdit('x\nx\n', 'x', 'y', { replaceAll: true }));
    expect(all.text).toBe('y\ny\n');
    expect(all.count).toBe(2);
  });

  it('reports text that is not in the file', () => {
    const r = applyEdit('a\n', 'zzz', 'y');
    expect(r.ok).toBe(false);
    expect(applyEdit('a\n', '', 'y').ok).toBe(false);
  });

  it('matches LF text against a CRLF file and keeps CRLF', () => {
    const file = 'function f() {\r\n  return 1;\r\n}\r\n';
    const r = ok(
      applyEdit(file, 'function f() {\n  return 1;\n}', 'function f() {\n  return 2;\n}'),
    );
    expect(r.how).toBe('line-endings');
    expect(r.text).toBe('function f() {\r\n  return 2;\r\n}\r\n');
    expect(/[^\r]\n/.test(r.text)).toBe(false);
  });

  it('matches CRLF text against an LF file and keeps LF', () => {
    const r = ok(applyEdit('a\nb\nc\n', 'a\r\nb', 'A\r\nB'));
    expect(r.text).toBe('A\nB\nc\n');
  });

  it('matches spaces against tabs and writes tabs', () => {
    const file = 'function f() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n';
    const r = ok(
      applyEdit(
        file,
        '  if (x) {\n    return 1;\n  }',
        '  if (x) {\n    log(x);\n    return 2;\n  }',
      ),
    );
    expect(r.how).toBe('whitespace');
    expect(r.text).toBe('function f() {\n\tif (x) {\n\t\tlog(x);\n\t\treturn 2;\n\t}\n}\n');
  });

  it('matches a block copied one indentation level off', () => {
    const file = 'class A {\n    m() {\n        return 1;\n    }\n}\n';
    const r = ok(applyEdit(file, 'm() {\n    return 1;\n}', 'm() {\n    return 2;\n}'));
    expect(r.text).toBe('class A {\n    m() {\n        return 2;\n    }\n}\n');
  });

  it('ignores trailing whitespace differences', () => {
    const r = ok(applyEdit('a = 1;   \nb = 2;\n', 'a = 1;\nb = 2;', 'a = 5;\nb = 2;'));
    expect(r.text).toBe('a = 5;\nb = 2;\n');
  });

  it('handles CRLF and tabs together and leaves the rest byte for byte', () => {
    const file = 'top\r\nfn() {\r\n\tone();\r\n}\r\nmixed\nend\r\n';
    const r = ok(applyEdit(file, 'fn() {\n  one();\n}', 'fn() {\n  one();\n  two();\n}'));
    expect(r.text).toBe('top\r\nfn() {\r\n\tone();\r\n\ttwo();\r\n}\r\nmixed\nend\r\n');
  });

  it('never guesses between two loose matches', () => {
    const file = 'if (a) {\n  go();\n}\nif (b) {\n    go();\n}\n';
    const r = applyEdit(file, '\tgo();', '\tstop();');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2 places/);
  });

  it('deletes whole lines when the new text is empty', () => {
    const r = ok(applyEdit('a\n\tb\nc\n', '  b', ''));
    expect(r.text).toBe('a\nc\n');
  });

  it('does not treat blank text as a match', () => {
    expect(applyEdit('a\n\n\nb\n', '   \n', 'x').ok).toBe(false);
  });
});

describe('dominantEol', () => {
  it('picks the most common line ending', () => {
    expect(dominantEol('a\r\nb\r\nc\n')).toBe('\r\n');
    expect(dominantEol('a\nb')).toBe('\n');
    expect(dominantEol('abc')).toBe('\n');
  });
});
