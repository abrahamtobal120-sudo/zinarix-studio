// Phase 16 guard: the renderer CSS takes colors, font sizes and layers from ui/tokens.css
// (or the theme blocks), never as loose literals. This stands in for a stylelint rule and runs
// with the rest of the suite, so a stray hex fails `pnpm test`.
import { readdirSync, readFileSync } from 'node:fs';
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
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
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
    const bad = lines.filter(([, l]) => /#[0-9a-f]{3,8}\b/i.test(l)).map(([w, l]) => `${w} ${l.trim()}`);
    expect(bad).toEqual([]);
  });

  it('font sizes in px come from the type scale', () => {
    const bad = lines.filter(([, l]) => /font-size:\s*[0-9.]+px/.test(l)).map(([w, l]) => `${w} ${l.trim()}`);
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
      lines.flatMap(([, l]) => [...l.matchAll(/var\((--(?:text|z|space|elevation|radius-(?:xs|md|lg|full))[\w-]*)/g)].map((m) => m[1]!)),
    );
    expect([...used].filter((u) => !defined.has(u))).toEqual([]);
  });

  it('the type scale stays small: 8 interface sizes and 2 display sizes', () => {
    const sizes = [...defined].filter((d) => d.startsWith('--text-'));
    expect(sizes).toHaveLength(10);
  });

  it('the dark and light themes are declared once', () => {
    const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
    expect(css.match(/:root\[data-theme='dark'\]\s*\{/g)).toHaveLength(1);
    expect(css.match(/^:root\[data-theme='light'\]\s*\{/gm)).toHaveLength(1);
  });
});
