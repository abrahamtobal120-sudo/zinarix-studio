/**
 * Pure conversions from VS Code extension data to what Monaco understands
 * (no monaco import: tested in Node).
 */

export interface MonacoRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: MonacoRule[];
  colors: Record<string, string>;
}

/** "#abc" / "#abcd" / "#aabbcc" / "#aabbccdd" → "#aabbcc[dd]"; null when not a hex color. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length <= 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return `#${h}`;
}

/**
 * TextMate scopes → the token names Monaco's Monarch grammars produce. Monaco matches theme
 * rules by dotted prefix ("keyword" matches "keyword.js"), so a scope maps to its own name
 * plus the generic Monarch token it corresponds to.
 */
const SCOPE_ALIASES: [RegExp, string[]][] = [
  [/^comment/, ['comment']],
  [/^string\.regexp/, ['regexp']],
  [/^string/, ['string']],
  [/^constant\.numeric/, ['number']],
  [/^constant\.language/, ['keyword']],
  [/^constant\.character\.escape/, ['string.escape']],
  [/^constant\.regexp/, ['regexp']],
  [/^keyword\.operator/, ['operator', 'delimiter']],
  [/^keyword/, ['keyword']],
  [/^storage\.type/, ['keyword', 'type']],
  [/^storage/, ['keyword']],
  [/^(entity\.name\.(type|class)|support\.(type|class))/, ['type', 'type.identifier']],
  [/^entity\.name\.tag/, ['tag']],
  [/^entity\.other\.attribute-name/, ['attribute.name']],
  [/^(meta\.decorator|entity\.name\.decorator|punctuation\.decorator)/, ['annotation']],
  [/^entity\.name\.function|^support\.function/, ['predefined']],
  [/^variable\.parameter/, ['variable.parameter']],
  [/^variable/, ['variable', 'identifier']],
  [/^punctuation/, ['delimiter']],
  [/^invalid/, ['invalid']],
  [/^markup\.heading/, ['keyword.md']],
  [/^markup\.bold/, ['strong']],
  [/^markup\.italic/, ['emphasis']],
];

interface TokenColor {
  scope?: string | string[];
  settings?: { foreground?: string; background?: string; fontStyle?: string };
}

/** A VS Code color theme as a Monaco theme. */
export function toMonacoTheme(
  theme: { colors?: Record<string, string>; tokenColors?: unknown[] },
  base: MonacoThemeData['base'],
): MonacoThemeData {
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors ?? {})) {
    const hex = normalizeHex(v);
    if (hex) colors[k] = hex;
  }
  const exact: MonacoRule[] = [];
  const aliased = new Map<string, MonacoRule>();
  for (const raw of theme.tokenColors ?? []) {
    const tc = raw as TokenColor;
    const s = tc?.settings;
    if (!s) continue;
    const fg = normalizeHex(s.foreground)?.slice(1);
    const bg = normalizeHex(s.background)?.slice(1);
    const fontStyle = typeof s.fontStyle === 'string' ? s.fontStyle.trim() : undefined;
    const style: Omit<MonacoRule, 'token'> = {
      ...(fg ? { foreground: fg } : {}),
      ...(bg ? { background: bg } : {}),
      ...(fontStyle !== undefined ? { fontStyle } : {}),
    };
    if (!Object.keys(style).length) continue;
    const scopes =
      tc.scope === undefined
        ? ['']
        : (Array.isArray(tc.scope) ? tc.scope : tc.scope.split(','))
            .map((x) => String(x).trim())
            // "source.js keyword" (descendant selectors): Monaco has no nesting; use the last.
            .map((x) => x.split(/\s+/).pop() ?? '');
    for (const scope of scopes) {
      exact.push({ token: scope, ...style });
      for (const [re, tokens] of SCOPE_ALIASES)
        if (re.test(scope)) {
          // The first (most general) definition of an alias wins, like a theme's own order.
          for (const t of tokens) if (!aliased.has(t)) aliased.set(t, { token: t, ...style });
          break;
        }
    }
  }
  // Aliases first, then the exact scopes (later rules win in Monaco).
  const rules = [...aliased.values(), ...exact];
  // Default foreground/background (scope-less entry or editor colors).
  const def = exact.find((r) => r.token === '');
  if (!def && colors['editor.foreground'])
    rules.unshift({ token: '', foreground: colors['editor.foreground'].slice(1, 7) });
  return { base, inherit: true, rules, colors };
}

/** Whether a VS Code theme base is dark. */
export function isDarkBase(base: MonacoThemeData['base']): boolean {
  return base === 'vs-dark' || base === 'hc-black';
}

/** App chrome (CSS variables) derived from an editor theme's colors. */
export function chromeVars(colors: Record<string, string>): Record<string, string> {
  const c = (...keys: string[]) => {
    for (const k of keys) if (colors[k]) return colors[k]!.slice(0, 7);
    return undefined;
  };
  const vars: Record<string, string | undefined> = {
    '--bg': c('editor.background'),
    '--bg-2': c('sideBar.background', 'editorGroupHeader.tabsBackground', 'editor.background'),
    '--bg-3': c('tab.inactiveBackground', 'sideBarSectionHeader.background', 'input.background'),
    '--bg-4': c('list.hoverBackground', 'input.background', 'dropdown.background'),
    '--activity': c('activityBar.background', 'sideBar.background'),
    '--border': c('panel.border', 'sideBar.border', 'editorGroup.border', 'contrastBorder'),
    '--fg': c('editor.foreground', 'foreground'),
    '--fg-dim': c('descriptionForeground', 'tab.inactiveForeground', 'editorLineNumber.foreground'),
    '--accent': c('button.background', 'focusBorder', 'activityBarBadge.background'),
    '--accent-hover': c('button.hoverBackground', 'button.background'),
    '--accent-fg': c('button.foreground'),
    '--focus': c('focusBorder', 'button.background'),
    '--sel': c('list.activeSelectionBackground', 'editor.selectionBackground'),
    '--hover': c('list.hoverBackground'),
    '--status': c('statusBar.background'),
    '--code-bg': c('textCodeBlock.background', 'editor.background'),
  };
  return Object.fromEntries(Object.entries(vars).filter((e): e is [string, string] => !!e[1]));
}

export interface SnippetItem {
  label: string;
  insertText: string;
  detail: string;
  documentation?: string;
}

/** A VS Code snippets file as completion items (Monaco shares the TextMate snippet syntax). */
export function snippetItems(data: Record<string, unknown>): SnippetItem[] {
  const out: SnippetItem[] = [];
  for (const [name, raw] of Object.entries(data)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as { prefix?: unknown; body?: unknown; description?: unknown };
    const body = Array.isArray(s.body) ? s.body.map(String).join('\n') : typeof s.body === 'string' ? s.body : null;
    if (body === null) continue;
    const prefixes = Array.isArray(s.prefix)
      ? s.prefix.map(String)
      : typeof s.prefix === 'string'
        ? [s.prefix]
        : [];
    for (const p of prefixes)
      if (p)
        out.push({
          label: p,
          insertText: body,
          detail: name,
          ...(typeof s.description === 'string' ? { documentation: s.description } : {}),
        });
  }
  return out;
}
