import type { ExtThemeData } from './devtools';

/**
 * B6: turns what an Open VSX extension contributes (a VS Code color theme, snippets, a language
 * configuration) into what Zinarix can apply: Monaco token rules, the app's CSS variables and
 * completion items. Pure functions, no Monaco and no DOM, so they are tested on their own.
 */

// ---------------- colors ----------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" → channels (a: 0…1); null for anything else. */
export function parseHex(v: unknown): Rgb | null {
  if (typeof v !== 'string') return null;
  const m = /^#([0-9a-f]{3,8})$/i.exec(v.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

export function toHex(c: Rgb): string {
  const h = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** `top` painted over `under` (its alpha is used up; the result is opaque). */
export function over(top: Rgb, under: Rgb): Rgb {
  const a = top.a;
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  };
}

/** `amount` (0…1) of `b` mixed into `a`. */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return over({ ...b, a: amount }, a);
}

function luminance(c: Rgb): number {
  const ch = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG contrast ratio of two opaque colors (1…21). */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgb = { r: 0, g: 0, b: 0, a: 1 };

/** Moves `fg` towards white or black until it reads on `bg` with at least `min` contrast. */
export function readable(fg: Rgb, bg: Rgb, min: number): Rgb {
  if (contrast(fg, bg) >= min) return fg;
  // On a mid-tone background only one of the two can reach the contrast.
  const target = contrast(WHITE, bg) >= contrast(BLACK, bg) ? WHITE : BLACK;
  for (let i = 1; i <= 10; i++) {
    const c = mix(fg, target, i / 10);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

// ---------------- theme → app variables ----------------

export interface AppTheme {
  dark: boolean;
  /** Every CSS variable a custom theme must set (REQUIRED_VARS in renderer/themes.ts). */
  vars: Record<string, string>;
  /** Monaco editor colors (the theme's own keys; Monaco ignores the ones it does not know). */
  editor: Record<string, string>;
  rules: TokenRule[];
}

export interface TokenRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

/**
 * The app chrome from a VS Code theme. Themes leave many keys out and use see-through colors,
 * so every variable is computed here: taken from the theme when it is there, derived from the
 * editor background and text otherwise, and text colors are corrected until they can be read.
 */
export function themeToApp(data: ExtThemeData): AppTheme {
  const colors = data.theme.colors ?? {};
  const dark = data.base === 'vs-dark' || data.base === 'hc-black';
  const bg0 = parseHex(colors['editor.background']);
  const bg: Rgb = bg0
    ? over(bg0, dark ? BLACK : WHITE)
    : dark
      ? { r: 30, g: 30, b: 30, a: 1 }
      : WHITE;
  const pick = (under: Rgb, ...keys: string[]): Rgb | null => {
    for (const k of keys) {
      const c = parseHex(colors[k]);
      if (c && c.a > 0.02) return over(c, under);
    }
    return null;
  };
  const fg = readable(
    pick(bg, 'editor.foreground', 'foreground') ??
      (dark ? { r: 212, g: 212, b: 212, a: 1 } : { r: 36, g: 36, b: 36, a: 1 }),
    bg,
    7,
  );
  const side =
    pick(bg, 'sideBar.background', 'editorGroupHeader.tabsBackground') ?? mix(bg, fg, 0.04);
  const bg3 =
    pick(bg, 'input.background', 'editorWidget.background', 'dropdown.background') ??
    mix(bg, fg, 0.08);
  const bg4 =
    pick(bg, 'list.inactiveSelectionBackground', 'tab.inactiveBackground') ?? mix(bg, fg, 0.13);
  const activity = pick(bg, 'activityBar.background', 'titleBar.activeBackground') ?? side;
  // A border the same color as the surface is no border: keep it visible.
  // Borders stay quiet lines: some themes paint panel.border in their brightest color.
  let border =
    pick(bg, 'sideBar.border', 'editorGroup.border', 'panel.border', 'contrastBorder') ??
    mix(bg, fg, 0.16);
  const borderContrast = contrast(border, bg);
  if (borderContrast < 1.15 || (borderContrast > 2.4 && !data.base.startsWith('hc')))
    border = mix(bg, fg, 0.16);
  // The accent fills the main buttons: the first theme color that stands out from the page.
  const ACCENT_KEYS = [
    'button.background',
    'focusBorder',
    'activityBarBadge.background',
    'textLink.foreground',
    'progressBar.background',
    'editorCursor.foreground',
  ];
  let accent: Rgb | null = null;
  let accentKey = '';
  for (const k of ACCENT_KEYS) {
    const c = pick(bg, k);
    if (c && contrast(c, bg) >= 2.2) {
      accent = c;
      accentKey = k;
      break;
    }
  }
  accent ??= dark ? { r: 60, g: 140, b: 210, a: 1 } : { r: 0, g: 95, b: 184, a: 1 };
  const accentFg = readable(
    (accentKey === 'button.background' ? pick(accent, 'button.foreground') : null) ?? WHITE,
    accent,
    4.5,
  );
  const accentHover =
    (accentKey === 'button.background' ? pick(bg, 'button.hoverBackground') : null) ??
    mix(accent, dark ? WHITE : BLACK, 0.12);
  const focus = pick(bg, 'focusBorder') ?? accent;
  const sel =
    pick(bg, 'list.activeSelectionBackground', 'editor.selectionBackground') ??
    mix(bg, accent, 0.3);
  const hover = pick(bg, 'list.hoverBackground') ?? mix(bg, fg, 0.07);
  const status = pick(bg, 'statusBar.background') ?? activity;
  const statusFg = readable(pick(status, 'statusBar.foreground') ?? fg, status, 4.5);
  const text = (c: Rgb | null, fallback: Rgb) => readable(c ?? fallback, bg, 4.5);
  const danger = text(
    pick(bg, 'errorForeground', 'editorError.foreground', 'terminal.ansiRed'),
    dark ? { r: 244, g: 135, b: 113, a: 1 } : { r: 191, g: 38, b: 0, a: 1 },
  );
  const ok = text(
    pick(bg, 'gitDecoration.addedResourceForeground', 'terminal.ansiGreen'),
    dark ? { r: 115, g: 201, b: 145, a: 1 } : { r: 26, g: 127, b: 55, a: 1 },
  );
  const warn = text(
    pick(bg, 'editorWarning.foreground', 'terminal.ansiYellow'),
    dark ? { r: 220, g: 180, b: 90, a: 1 } : { r: 150, g: 100, b: 0, a: 1 },
  );
  const fgDim = readable(
    pick(bg, 'descriptionForeground', 'sideBar.foreground') ?? mix(fg, bg, 0.3),
    bg,
    4.5,
  );
  const brand = readable(accent, bg, 3);
  const brand2 = mix(brand, fg, 0.35);
  const vars: Record<string, string> = {
    '--bg': toHex(bg),
    '--bg-2': toHex(side),
    '--bg-3': toHex(bg3),
    '--bg-4': toHex(bg4),
    '--activity': toHex(activity),
    '--border': toHex(border),
    '--fg': toHex(fg),
    '--fg-dim': toHex(fgDim),
    '--fg-strong': toHex(readable(mix(fg, dark ? WHITE : BLACK, 0.5), bg, 7)),
    '--accent': toHex(accent),
    '--accent-hover': toHex(accentHover),
    '--accent-fg': toHex(accentFg),
    '--focus': toHex(focus),
    '--sel': toHex(sel),
    '--hover': toHex(hover),
    '--status': toHex(status),
    '--status-fg': toHex(statusFg),
    '--danger': toHex(danger),
    '--ok': toHex(ok),
    '--warn': toHex(warn),
    '--code-bg': toHex(pick(bg, 'textCodeBlock.background') ?? mix(bg, fg, 0.06)),
    '--brand': toHex(brand),
    '--brand-1': toHex(brand),
    '--brand-2': toHex(brand2),
    '--brand-grad': `linear-gradient(135deg, ${toHex(brand)}, ${toHex(brand2)})`,
  };
  const editor: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors)) if (parseHex(v)) editor[k] = v;
  return { dark, vars, editor, rules: themeRules(data.theme.tokenColors ?? []) };
}

// ---------------- TextMate scopes → Monaco tokens ----------------

/**
 * Monaco colors by its own token names (Monarch), VS Code themes by TextMate scopes. Each
 * line: a scope a theme would style, and the Monaco tokens that play that role.
 */
const SCOPE_TOKENS: [scope: string, tokens: string[]][] = [
  ['comment', ['comment']],
  ['string', ['string']],
  ['string.regexp', ['regexp']],
  ['constant.character.escape', ['string.escape']],
  ['constant.numeric', ['number']],
  ['constant.language', ['constant', 'keyword.json']],
  ['keyword', ['keyword']],
  ['storage.type', ['keyword.type']],
  ['keyword.operator', ['operator', 'operators']],
  ['punctuation', ['delimiter']],
  ['entity.name.type', ['type', 'type.identifier']],
  ['entity.name.function', ['function', 'entity.name.function']],
  ['variable', ['variable', 'identifier']],
  ['variable.parameter', ['variable.parameter']],
  ['entity.name.tag', ['tag', 'metatag']],
  ['entity.other.attribute-name', ['attribute.name']],
  ['string.quoted.double.html', ['attribute.value']],
  ['support.type.property-name', ['string.key.json', 'attribute.name.css']],
  ['markup.heading', ['keyword.md']],
  ['meta.annotation', ['annotation']],
];

interface TokenColor {
  scope?: unknown;
  settings?: { foreground?: unknown; fontStyle?: unknown };
}

function selectorsOf(scope: unknown): string[] {
  const list = Array.isArray(scope) ? scope : typeof scope === 'string' ? scope.split(',') : [];
  // "source.js meta.block string" styles strings in a context: the last part is the scope.
  return list
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().split(/\s+/).pop() ?? '')
    .filter((s) => s && !s.startsWith('-'));
}

/** The theme's token colors as Monaco rules: for each role, its most specific matching entry. */
export function themeRules(tokenColors: unknown[]): TokenRule[] {
  const out: TokenRule[] = [];
  for (const [scope, tokens] of SCOPE_TOKENS) {
    let best: TokenColor['settings'] | undefined;
    let bestLen = -1;
    for (const raw of tokenColors) {
      const tc = raw as TokenColor;
      if (!tc || typeof tc !== 'object' || !tc.settings) continue;
      for (const sel of selectorsOf(tc.scope)) {
        if (scope !== sel && !scope.startsWith(`${sel}.`)) continue;
        // Later entries win ties, as in VS Code.
        if (sel.length >= bestLen) {
          best = tc.settings;
          bestLen = sel.length;
        }
      }
    }
    if (!best) continue;
    const c = parseHex(best.foreground);
    const style = typeof best.fontStyle === 'string' ? best.fontStyle.trim() : undefined;
    if (!c && style === undefined) continue;
    for (const token of tokens) {
      const rule: TokenRule = { token };
      if (c) rule.foreground = toHex(c).slice(1);
      if (style !== undefined) rule.fontStyle = style;
      out.push(rule);
    }
  }
  return out;
}

// ---------------- snippets ----------------

export interface SnippetItem {
  name: string;
  prefix: string;
  body: string;
  description: string;
}

/** A VS Code snippet file ({ name: { prefix, body, description } }) as flat items. */
export function snippetItems(file: Record<string, unknown>): SnippetItem[] {
  const out: SnippetItem[] = [];
  for (const [name, raw] of Object.entries(file)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as { prefix?: unknown; body?: unknown; description?: unknown };
    const body = Array.isArray(s.body)
      ? s.body.filter((x) => typeof x === 'string').join('\n')
      : typeof s.body === 'string'
        ? s.body
        : '';
    if (!body) continue;
    const prefixes = (Array.isArray(s.prefix) ? s.prefix : [s.prefix]).filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    const description = Array.isArray(s.description)
      ? s.description.filter((x) => typeof x === 'string').join('\n')
      : typeof s.description === 'string'
        ? s.description
        : '';
    for (const prefix of prefixes) out.push({ name, prefix, body, description });
  }
  return out;
}

// ---------------- language configuration ----------------

export interface LangConfig {
  comments?: { lineComment?: string; blockComment?: [string, string] };
  brackets?: [string, string][];
  autoClosingPairs?: { open: string; close: string; notIn?: string[] }[];
  surroundingPairs?: { open: string; close: string }[];
}

function pair(v: unknown): [string, string] | null {
  if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' && v[0] && v[1])
    return [v[0], v[1]];
  if (v && typeof v === 'object') {
    const o = v as { open?: unknown; close?: unknown };
    if (typeof o.open === 'string' && typeof o.close === 'string' && o.open && o.close)
      return [o.open, o.close];
  }
  return null;
}

/**
 * The declarative part of a language-configuration.json (comments, brackets, pairs). The
 * regular expressions (wordPattern, indentation and onEnter rules) are left out: they come
 * from a download and a bad one would hang the editor on every key press.
 */
export function langConfig(raw: Record<string, unknown> | undefined): LangConfig {
  const out: LangConfig = {};
  if (!raw) return out;
  const c = raw.comments as { lineComment?: unknown; blockComment?: unknown } | undefined;
  if (c && typeof c === 'object') {
    const comments: NonNullable<LangConfig['comments']> = {};
    if (typeof c.lineComment === 'string' && c.lineComment) comments.lineComment = c.lineComment;
    const block = pair(c.blockComment);
    if (block) comments.blockComment = block;
    if (comments.lineComment || comments.blockComment) out.comments = comments;
  }
  const pairs = (v: unknown) =>
    (Array.isArray(v) ? v : []).map(pair).filter((p): p is [string, string] => p !== null);
  const brackets = pairs(raw.brackets);
  if (brackets.length) out.brackets = brackets;
  const closing = (Array.isArray(raw.autoClosingPairs) ? raw.autoClosingPairs : [])
    .map((v) => {
      const p = pair(v);
      if (!p) return null;
      const notIn = (v as { notIn?: unknown }).notIn;
      return {
        open: p[0],
        close: p[1],
        ...(Array.isArray(notIn)
          ? { notIn: notIn.filter((x): x is string => typeof x === 'string') }
          : {}),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (closing.length) out.autoClosingPairs = closing;
  const surround = pairs(raw.surroundingPairs).map(([open, close]) => ({ open, close }));
  if (surround.length) out.surroundingPairs = surround;
  return out;
}

/** Stable id of one theme of one extension (kept in the saved choice). */
export function extThemeId(extId: string, label: string): string {
  return `${extId}::${label}`;
}
