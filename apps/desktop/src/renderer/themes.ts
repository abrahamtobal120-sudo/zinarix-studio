import type { ThemeId } from '../shared/api';
import { monaco } from './monaco';

/**
 * Color themes. Each one is a base (the dark or light stylesheet in styles.css) plus CSS
 * variable overrides for the app chrome and a Monaco theme for the editor.
 */
interface ThemeDef {
  label: string;
  dark: boolean;
  /** Overrides of the CSS variables declared in styles.css (:root). */
  vars: Record<string, string>;
  /** Editor colors (Monaco), on top of vs / vs-dark. */
  editor: Record<string, string>;
  rules?: monaco.editor.ITokenThemeRule[];
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  dark: { label: 'Oscuro', dark: true, vars: {}, editor: {} },
  light: { label: 'Claro', dark: false, vars: {}, editor: {} },
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
      '--accent': '#238636',
      '--accent-hover': '#2ea043',
      '--focus': '#58a6ff',
      '--sel': '#1f3a5f',
      '--hover': '#1b2230',
      '--status': '#1f6feb',
      '--code-bg': '#010409',
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
      '--accent': '#bd93f9',
      '--accent-hover': '#caa9fa',
      '--accent-fg': '#1e1f29',
      '--focus': '#bd93f9',
      '--sel': '#44475a',
      '--hover': '#343746',
      '--status': '#6272a4',
      '--code-bg': '#1e1f29',
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
      '--accent': '#a6e22e',
      '--accent-hover': '#b6f23e',
      '--accent-fg': '#1e1f1c',
      '--focus': '#e6db74',
      '--sel': '#49483e',
      '--hover': '#33342c',
      '--status': '#75715e',
      '--code-bg': '#1e1f1c',
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
      '--fg-dim': '#8b95a7',
      '--accent': '#5e81ac',
      '--accent-hover': '#6d8fba',
      '--focus': '#88c0d0',
      '--sel': '#434c5e',
      '--hover': '#353c4a',
      '--status': '#4c566a',
      '--code-bg': '#242933',
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
      '--border': '#d3cbb7',
      '--fg': '#586e75',
      '--fg-dim': '#93a1a1',
      '--fg-strong': '#073642',
      '--accent': '#268bd2',
      '--accent-hover': '#2aa198',
      '--focus': '#268bd2',
      '--sel': '#eee8d5',
      '--hover': '#efe8d3',
      '--status': '#b58900',
      '--code-bg': '#f5efdc',
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
      '--border': '#d0d7de',
      '--fg': '#24292f',
      '--fg-dim': '#57606a',
      '--accent': '#1f883d',
      '--accent-hover': '#1a7f37',
      '--focus': '#0969da',
      '--sel': '#ddf4ff',
      '--status': '#24292f',
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

export function isDark(id: ThemeId): boolean {
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
  return `zs-${THEMES[id] ? id : 'dark'}`;
}

/** Applies the app colors (CSS variables) and the editor theme. */
export function applyThemeColors(id: ThemeId): void {
  const th = THEMES[id] ?? THEMES.dark;
  const root = document.documentElement;
  root.dataset.theme = th.dark ? 'dark' : 'light';
  root.removeAttribute('style');
  for (const [k, v] of Object.entries(th.vars)) root.style.setProperty(k, v);
  monaco.editor.setTheme(monacoTheme(id));
}
