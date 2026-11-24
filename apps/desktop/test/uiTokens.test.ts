// Phase 16 guard: the renderer CSS takes colors, font sizes and layers from ui/tokens.css
// (or the theme blocks), never as loose literals. This stands in for a stylelint rule and runs
// with the rest of the suite, so a stray hex fails `pnpm test`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../src/renderer');
const TOKENS = join(ROOT, 'ui', 'tokens.css');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(p);
    return p.endsWith('.css') ? [p] : [];
  });
}

/** Lines outside :root theme blocks, with comments removed, as [file:line, text]. */
function ruleLines(file: string): [string, string][] {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, ' '),
  );
  const out: [string, string][] = [];
  let inTheme = false;
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*:root/.test(line)) inTheme = true;
    else if (line.includes('{')) inTheme = false;
    if (!inTheme) out.push([`${relative(ROOT, file)}:${i + 1}`, line]);
  });
  return out;
}

const files = cssFiles(ROOT).filter((f) => f !== TOKENS);
const lines = files.flatMap(ruleLines);
const tokens = readFileSync(TOKENS, 'utf8');
const defined = new Set([...tokens.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!));

describe('ui tokens', () => {
  it('no hex colors outside tokens.css and the theme blocks', () => {
    const bad = lines
      .filter(([, l]) => /#[0-9a-f]{3,8}\b/i.test(l))
      .map(([w, l]) => `${w} ${l.trim()}`);
    expect(bad).toEqual([]);
  });

  it('font sizes in px come from the type scale', () => {
    const bad = lines
      .filter(([, l]) => /font-size:\s*[0-9.]+px/.test(l))
      .map(([w, l]) => `${w} ${l.trim()}`);
    expect(bad).toEqual([]);
  });

  it('z-index above 10 uses a named layer', () => {
    const bad = lines
      .filter(([, l]) => {
        const m = /z-index:\s*(-?\d+)/.exec(l);
        return m ? Math.abs(Number(m[1])) > 10 : false;
      })
      .map(([w, l]) => `${w} ${l.trim()}`);
    expect(bad).toEqual([]);
  });

  it('every --text-*, --z-*, --space-* and --elevation-* used is defined', () => {
    const used = new Set(
      lines.flatMap(([, l]) =>
        [...l.matchAll(/var\((--(?:text|z|space|elevation|radius-(?:xs|md|lg|full))[\w-]*)/g)].map(
          (m) => m[1]!,
        ),
      ),
    );
    expect([...used].filter((u) => !defined.has(u))).toEqual([]);
  });

  it('the type scale stays small: 8 interface sizes and 2 display sizes', () => {
    const sizes = [...defined].filter((d) => d.startsWith('--text-'));
    expect(sizes).toHaveLength(10);
  });

  it('the dark and light themes are declared once, in tokens.css', () => {
    expect(tokens.match(/:root\[data-theme='dark'\]\s*\{/g)).toHaveLength(1);
    // --bg is the first variable of a theme: one Dark block and one Light block, nowhere else.
    expect(tokens.match(/^\s*--bg:/gm)).toHaveLength(2);
    expect(files.filter((f) => /^\s*--bg:/m.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});

/** Top-level blocks of a CSS text (comments and strings skipped), as their preludes. */
function topLevel(css: string): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      i = end < 0 ? src.length : end;
    } else if (c === '{') {
      if (depth === 0) out.push(src.slice(start, i).trim());
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (c === ';' && depth === 0) {
      out.push(src.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return out;
}

const STYLES = join(ROOT, 'styles');
const OVERRIDES = join(STYLES, 'overrides.css');
const LAYERS = ['reset', 'tokens', 'base', 'components', 'features', 'utilities'];

describe('cascade layers (16B)', () => {
  it('styles.css is gone: the app CSS lives in styles/', () => {
    expect(existsSync(join(ROOT, 'styles.css'))).toBe(false);
    expect(readdirSync(STYLES).filter((f) => f.endsWith('.css')).length).toBeGreaterThan(10);
  });

  it('the layer order is declared once, first thing in tokens.css', () => {
    const first = topLevel(tokens)[0];
    expect(first).toBe(`@layer ${LAYERS.join(', ')};`);
    const all = cssFiles(ROOT).flatMap((f) =>
      topLevel(readFileSync(f, 'utf8')).filter((p) => /^@layer [^{]*;$/.test(p) && p.includes(',')),
    );
    expect(all).toHaveLength(1);
  });

  it('every renderer CSS file is inside a known layer, except styles/overrides.css', () => {
    const bad = cssFiles(ROOT)
      .filter((f) => f !== OVERRIDES)
      .flatMap((f) =>
        topLevel(readFileSync(f, 'utf8'))
          .filter(
            (p) =>
              !(p.startsWith('@layer ') && LAYERS.includes(p.slice(7).replace(/[;\s].*$/, ''))),
          )
          .filter((p) => !(f === TOKENS && p.startsWith('@layer ') && p.endsWith(';')))
          .map((p) => `${relative(ROOT, f)}: ${p.slice(0, 60)}`),
      );
    expect(bad).toEqual([]);
  });

  it('overrides.css only touches what Monaco and xterm draw', () => {
    const css = readFileSync(OVERRIDES, 'utf8');
    const selectors = topLevel(css).flatMap((p) => p.split(','));
    expect(selectors.length).toBeGreaterThan(0);
    const bad = selectors
      .map((s) => s.trim())
      .filter((s) => !/^(\.monaco-editor|\.xterm)\b|::-webkit-scrollbar/.test(s));
    expect(bad).toEqual([]);
  });

  it('no file in styles/ is longer than 1,200 lines', () => {
    const long = readdirSync(STYLES)
      .filter((f) => f.endsWith('.css'))
      .map((f) => [f, readFileSync(join(STYLES, f), 'utf8').split('\n').length] as const)
      .filter(([, n]) => n > 1200);
    expect(long).toEqual([]);
  });

  it('styles/index.ts imports every file of styles/, overrides.css last', () => {
    const index = readFileSync(join(STYLES, 'index.ts'), 'utf8');
    const imported = [...index.matchAll(/import '\.\/([^']+)'/g)].map((m) => m[1]);
    const onDisk = readdirSync(STYLES).filter((f) => f.endsWith('.css'));
    expect([...imported].sort()).toEqual([...onDisk].sort());
    expect(imported.at(-1)).toBe('overrides.css');
  });

  it('generic element rules skip the primitives ([data-ui])', () => {
    const css = readFileSync(join(STYLES, '02-app.css'), 'utf8');
    expect(css).toMatch(/^button:where\(:not\(\[data-ui\]\)\) \{/m);
    expect(css).not.toMatch(/^button \{/m);
  });
});
