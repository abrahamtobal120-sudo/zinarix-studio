import type { ThemeId } from '../shared/api';
import { monaco } from './monaco';

/**
 * Color themes. Each one is a base (the dark or light block at the top of ui/tokens.css) plus CSS
 * variable overrides for the app chrome and a Monaco theme for the editor.
 */

/**
 * Variables every custom theme must set. A custom theme that inherits one of these from the
 * base stylesheet ends up with mixed colors (the base violet, a red that fails contrast on the
 * theme background, an unreadable status bar...), so the compiler requires all of them.
 */
export const REQUIRED_VARS = [
  '--bg',
  '--bg-2',
  '--bg-3',
  '--bg-4',
  '--activity',
  '--border',
  '--fg',
  '--fg-dim',
  '--fg-strong',
  '--accent',
  '--accent-hover',
  '--accent-fg',
  '--focus',
  '--sel',
  '--hover',
  '--status',
  '--status-fg',
  '--danger',
  '--ok',
  '--warn',
  '--code-bg',
  '--brand',
  '--brand-1',
  '--brand-2',
  '--brand-grad',
] as const;
export type RequiredVar = (typeof REQUIRED_VARS)[number];
export type ThemeVars = Record<RequiredVar, string>;

export interface ThemeDef {
  label: string;
  dark: boolean;
  /** Overrides of the CSS variables declared in ui/tokens.css (:root). Empty for the base themes. */
  vars: Readonly<Record<string, string>>;
  /** Editor colors (Monaco), on top of vs / vs-dark. */
  editor: Record<string, string>;
  rules?: monaco.editor.ITokenThemeRule[];
}

/** A custom theme: same shape, but every required variable must be present. */
export interface CustomThemeDef extends ThemeDef {
  vars: ThemeVars;
}

export type CustomThemeId = Exclude<ThemeId, 'dark' | 'light'>;

const grad = (a: string, b: string): string => `linear-gradient(135deg, ${a}, ${b})`;

/**
 * Custom themes. Contrast rules (checked in test/themes.test.ts):
 * text colors (--fg, --fg-dim, --danger, --ok, --warn, --brand) >= 4.5:1 on --bg,
 * --status-fg on --status and --accent-fg on --accent >= 4.5:1, white on --brand-1/--brand-2
 * (primary buttons) >= 4.5:1 and --focus >= 3:1 on --bg.
 */
export const CUSTOM_THEMES: Record<CustomThemeId, CustomThemeDef> = {
  midnight: {
    label: 'Medianoche',
    dark: true,
    vars: {
      '--bg': '#0d1117',
      '--bg-2': '#161b22',
      '--bg-3': '#1c2230',
      '--bg-4': '#262f3f',
      '--activity': '#0b0f16',
      '--border': '#30363d',
      '--fg': '#c9d1d9',
      '--fg-dim': '#8b949e',
      '--fg-strong': '#f0f6fc',
      '--accent': '#238636',
      '--accent-hover': '#1f7a31',
      '--accent-fg': '#ffffff',
      '--focus': '#58a6ff',
      '--sel': '#1f3a5f',
      '--hover': '#1b2230',
      '--status': '#1f6feb',
      '--status-fg': '#ffffff',
      '--danger': '#f85149',
      '--ok': '#3fb950',
      '--warn': '#d29922',
      '--code-bg': '#010409',
      '--brand': '#58a6ff',
      '--brand-1': '#1f6feb',
      '--brand-2': '#1a7f37',
      '--brand-grad': grad('#1f6feb', '#1a7f37'),
    },
    editor: {
      'editor.background': '#0d1117',
      'editor.lineHighlightBackground': '#161b22',
      'editorGutter.background': '#0d1117',
      'minimap.background': '#0d1117',
    },
  },
  dracula: {
    label: 'Drácula',
    dark: true,
    vars: {
      '--bg': '#282a36',
      '--bg-2': '#21222c',
      '--bg-3': '#2f3241',
      '--bg-4': '#44475a',
      '--activity': '#191a21',
      '--border': '#3b3e51',
      '--fg': '#f8f8f2',
      '--fg-dim': '#9ea3c0',
      '--fg-strong': '#ffffff',
      '--accent': '#bd93f9',
      '--accent-hover': '#caa9fa',
      '--accent-fg': '#1e1f29',
      '--focus': '#bd93f9',
      '--sel': '#44475a',
      '--hover': '#343746',
      '--status': '#6272a4',
      '--status-fg': '#ffffff',
      '--danger': '#ff6e6e',
      '--ok': '#50fa7b',
      '--warn': '#f1fa8c',
      '--code-bg': '#1e1f29',
      '--brand': '#bd93f9',
      '--brand-1': '#8a4fd6',
      '--brand-2': '#b03d82',
      '--brand-grad': grad('#8a4fd6', '#b03d82'),
    },
    editor: {
      'editor.background': '#282a36',
      'editor.foreground': '#f8f8f2',
      'editor.lineHighlightBackground': '#44475a75',
      'editor.selectionBackground': '#44475a',
      'editorCursor.foreground': '#f8f8f0',
    },
    rules: [
      { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
      { token: 'string', foreground: 'f1fa8c' },
      { token: 'keyword', foreground: 'ff79c6' },
      { token: 'number', foreground: 'bd93f9' },
      { token: 'type', foreground: '8be9fd', fontStyle: 'italic' },
      { token: 'identifier.function', foreground: '50fa7b' },
    ],
  },
  monokai: {
    label: 'Monokai',
    dark: true,
    vars: {
      '--bg': '#272822',
      '--bg-2': '#1e1f1c',
      '--bg-3': '#2f302a',
      '--bg-4': '#3e3d32',
      '--activity': '#171814',
      '--border': '#3e3d32',
      '--fg': '#f8f8f2',
      '--fg-dim': '#a59f85',
      '--fg-strong': '#ffffff',
      '--accent': '#a6e22e',
      '--accent-hover': '#b6f23e',
      '--accent-fg': '#1e1f1c',
      '--focus': '#e6db74',
      '--sel': '#49483e',
      '--hover': '#33342c',
      '--status': '#75715e',
      '--status-fg': '#f8f8f2',
      '--danger': '#ff4f8b',
      '--ok': '#a6e22e',
      '--warn': '#e6db74',
      '--code-bg': '#1e1f1c',
      '--brand': '#ae81ff',
      '--brand-1': '#8c5ad9',
      '--brand-2': '#3f7a8a',
      '--brand-grad': grad('#8c5ad9', '#3f7a8a'),
    },
    editor: {
      'editor.background': '#272822',
      'editor.foreground': '#f8f8f2',
      'editor.lineHighlightBackground': '#3e3d32',
      'editor.selectionBackground': '#49483e',
    },
    rules: [
      { token: 'comment', foreground: '75715e' },
      { token: 'string', foreground: 'e6db74' },
      { token: 'keyword', foreground: 'f92672' },
      { token: 'number', foreground: 'ae81ff' },
      { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
    ],
  },
  nord: {
    label: 'Nord',
    dark: true,
    vars: {
      '--bg': '#2e3440',
      '--bg-2': '#272c36',
      '--bg-3': '#343b48',
      '--bg-4': '#3b4252',
      '--activity': '#242933',
      '--border': '#3b4252',
      '--fg': '#d8dee9',
      // #9ba5b8 was 4.46:1 on --hover; one step lighter passes AA on every panel.
      '--fg-dim': '#a0aabc',
      '--fg-strong': '#eceff4',
      '--accent': '#4b6c94',
      '--accent-hover': '#56789f',
      '--accent-fg': '#ffffff',
      '--focus': '#88c0d0',
      '--sel': '#434c5e',
      '--hover': '#353c4a',
      '--status': '#4c566a',
      '--status-fg': '#ffffff',
      '--danger': '#e8838b',
      '--ok': '#a3be8c',
      '--warn': '#ebcb8b',
      '--code-bg': '#242933',
      '--brand': '#88c0d0',
      '--brand-1': '#4b6c94',
      '--brand-2': '#3f7a8a',
      '--brand-grad': grad('#4b6c94', '#3f7a8a'),
    },
    editor: {
      'editor.background': '#2e3440',
      'editor.foreground': '#d8dee9',
      'editor.lineHighlightBackground': '#3b4252',
      'editor.selectionBackground': '#434c5e',
    },
    rules: [
      { token: 'comment', foreground: '616e88', fontStyle: 'italic' },
      { token: 'string', foreground: 'a3be8c' },
      { token: 'keyword', foreground: '81a1c1' },
      { token: 'number', foreground: 'b48ead' },
      { token: 'type', foreground: '8fbcbb' },
    ],
  },
  'solarized-light': {
    label: 'Solarized claro',
    dark: false,
    vars: {
      '--bg': '#fdf6e3',
      '--bg-2': '#eee8d5',
      '--bg-3': '#e8e1cc',
      '--bg-4': '#ddd6c1',
      '--activity': '#e8e1cc',
      '--border': '#d3cbb7',
      '--fg': '#475b62',
      // #657b83 (the value suggested in the review) is still 4.1:1 on --bg; a step darker passes AA.
      // #5c7078 was 4.24:1 on --bg-2 (panels); one step darker passes AA there too.
      '--fg-dim': '#54666d',
      '--fg-strong': '#073642',
      '--accent': '#1f6fa8',
      '--accent-hover': '#1a5f91',
      '--accent-fg': '#ffffff',
      '--focus': '#1e6fa8',
      '--sel': '#eee8d5',
      '--hover': '#efe8d3',
      '--status': '#b58900',
      '--status-fg': '#002b36',
      '--danger': '#b8231f',
      '--ok': '#5f7a00',
      '--warn': '#8a6400',
      '--code-bg': '#f5efdc',
      '--brand': '#5a5fb5',
      '--brand-1': '#5a5fb5',
      '--brand-2': '#1f6fa8',
      '--brand-grad': grad('#5a5fb5', '#1f6fa8'),
    },
    editor: {
      'editor.background': '#fdf6e3',
      'editor.foreground': '#586e75',
      'editor.lineHighlightBackground': '#eee8d5',
      'editor.selectionBackground': '#e3dcc6',
    },
    rules: [
      { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
      { token: 'string', foreground: '2aa198' },
      { token: 'keyword', foreground: '859900' },
      { token: 'number', foreground: 'd33682' },
      { token: 'type', foreground: 'b58900' },
    ],
  },
  'github-light': {
    label: 'GitHub claro',
    dark: false,
    vars: {
      '--bg': '#ffffff',
      '--bg-2': '#f6f8fa',
      '--bg-3': '#eff2f5',
      '--bg-4': '#e6eaef',
      '--activity': '#f6f8fa',
      '--border': '#d0d7de',
      '--fg': '#24292f',
      '--fg-dim': '#57606a',
      '--fg-strong': '#1f2328',
      '--accent': '#1f883d',
      '--accent-hover': '#1a7f37',
      '--accent-fg': '#ffffff',
      '--focus': '#0969da',
      '--sel': '#ddf4ff',
      '--hover': '#eaeef2',
      '--status': '#24292f',
      '--status-fg': '#ffffff',
      '--danger': '#cf222e',
      '--ok': '#1a7f37',
      '--warn': '#9a6700',
      '--code-bg': '#f6f8fa',
      '--brand': '#8250df',
      '--brand-1': '#8250df',
      '--brand-2': '#0969da',
      '--brand-grad': grad('#8250df', '#0969da'),
    },
    editor: { 'editor.lineHighlightBackground': '#f6f8fa' },
    rules: [
      { token: 'comment', foreground: '6e7781' },
      { token: 'string', foreground: '0a3069' },
      { token: 'keyword', foreground: 'cf222e' },
      { token: 'number', foreground: '0550ae' },
      { token: 'type', foreground: '953800' },
    ],
  },
};

export const THEMES: Record<ThemeId, ThemeDef> = {
  dark: { label: 'Oscuro', dark: true, vars: {}, editor: {} },
  light: { label: 'Claro', dark: false, vars: {}, editor: {} },
  ...CUSTOM_THEMES,
};

/**
 * B6: a theme from an installed extension, shown instead of the built-in one while it is set.
 * The built-in id stays in the settings; picking a built-in theme clears this.
 */
export interface ExtThemeOverride {
  id: string;
  dark: boolean;
  vars: Readonly<Record<string, string>>;
  editor: Record<string, string>;
  rules: monaco.editor.ITokenThemeRule[];
}
const EXT_MONACO = 'zs-ext';
/** The chosen extension theme, already converted, so the app starts with it (no flash). */
export const EXT_THEME_KEY = 'zs.extTheme';

function defineExt(th: ExtThemeOverride): void {
  monaco.editor.defineTheme(EXT_MONACO, {
    base: th.dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: th.rules,
    colors: th.editor,
  });
}

function savedExtTheme(): ExtThemeOverride | null {
  try {
    const raw = localStorage.getItem(EXT_THEME_KEY);
    if (!raw) return null;
    const th = JSON.parse(raw) as ExtThemeOverride;
    if (typeof th.id !== 'string' || typeof th.vars !== 'object' || !Array.isArray(th.rules))
      return null;
    defineExt(th);
    return th;
  } catch {
    // unreadable or a color Monaco refuses: the built-in theme is used
    return null;
  }
}
let extTheme: ExtThemeOverride | null = savedExtTheme();

export function extThemeOverride(): ExtThemeOverride | null {
  return extTheme;
}

/** Sets (or clears, with null) the extension theme. Call applyThemeColors afterwards. */
export function setExtThemeOverride(th: ExtThemeOverride | null): void {
  if (th) defineExt(th);
  extTheme = th;
  try {
    if (th) localStorage.setItem(EXT_THEME_KEY, JSON.stringify(th));
    else localStorage.removeItem(EXT_THEME_KEY);
  } catch {
    // storage full or blocked: the theme still applies until the app closes
  }
}

/** Another window changed the extension theme: take the saved one. */
export function reloadExtThemeOverride(): void {
  extTheme = savedExtTheme();
}

export function isDark(id: ThemeId): boolean {
  if (extTheme) return extTheme.dark;
  return (THEMES[id] ?? THEMES.dark).dark;
}

let defined = false;
function defineMonacoThemes(): void {
  if (defined) return;
  defined = true;
  for (const [id, th] of Object.entries(THEMES)) {
    monaco.editor.defineTheme(`zs-${id}`, {
      base: th.dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: th.rules ?? [],
      colors: th.editor,
    });
  }
}

/** Monaco theme name for an app theme (also used by the diff views). */
export function monacoTheme(id: ThemeId): string {
  defineMonacoThemes();
  if (extTheme) return EXT_MONACO;
  return `zs-${THEMES[id] ? id : 'dark'}`;
}

/** Applies the app colors (CSS variables) and the editor theme. */
export function applyThemeColors(id: ThemeId): void {
  const th = extTheme ?? THEMES[id] ?? THEMES.dark;
  const root = document.documentElement;
  root.dataset.theme = th.dark ? 'dark' : 'light';
  root.removeAttribute('style');
  for (const [k, v] of Object.entries(th.vars)) root.style.setProperty(k, v);
  monaco.editor.setTheme(monacoTheme(id));
  // Canvas views (the 3D viewport) can't read CSS variables live: tell them to repaint.
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Fired on window after the app colors change. */
export const THEME_EVENT = 'zs-theme-change';
