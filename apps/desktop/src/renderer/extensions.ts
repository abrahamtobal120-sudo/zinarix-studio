import type { InstalledExtension } from '../shared/devtools';
import { extThemeId, langConfig, snippetItems, themeToApp } from '../shared/extContrib';
import { addLanguageFiles, monaco } from './monaco';
import { api, applyTheme, getState } from './store';
import {
  EXT_THEME_KEY,
  extThemeOverride,
  reloadExtThemeOverride,
  setExtThemeOverride,
} from './themes';

/**
 * B6: applies what the installed extensions contribute (see shared/extContrib.ts):
 * languages and snippets go to Monaco, and one of their color themes can replace the app's.
 */

let installed: InstalledExtension[] = [];
const listeners = new Set<() => void>();
/** Snippet providers of the enabled extensions (replaced on every reload). */
let snippetProviders: monaco.IDisposable[] = [];
/** Languages already registered: Monaco cannot forget one, so each is added once. */
const registered = new Set<string>();

/** Grows on every change of the installed list or of the theme in use. */
let version = 0;
export function extensionsVersion(): number {
  return version;
}
function notify(): void {
  version++;
  for (const fn of listeners) fn();
}

export function installedExtensions(): InstalledExtension[] {
  return installed;
}

export function onExtensions(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface ExtThemeChoice {
  id: string;
  label: string;
  extension: string;
  dark: boolean;
  /** bg, side bar, accent and text, for the preview card. */
  preview: { bg: string; side: string; accent: string; fg: string };
}

/** Themes of the enabled extensions. */
export function extThemes(): ExtThemeChoice[] {
  const out: ExtThemeChoice[] = [];
  for (const ext of installed) {
    if (!ext.enabled) continue;
    for (const th of ext.themes) {
      const app = themeToApp(th);
      out.push({
        id: extThemeId(ext.id, th.label),
        label: th.label,
        extension: ext.displayName,
        dark: app.dark,
        preview: {
          bg: app.vars['--bg']!,
          side: app.vars['--bg-2']!,
          accent: app.vars['--accent']!,
          fg: app.vars['--fg']!,
        },
      });
    }
  }
  return out;
}

export function activeExtTheme(): string | null {
  return extThemeOverride()?.id ?? null;
}

function findTheme(id: string) {
  for (const ext of installed)
    if (ext.enabled)
      for (const th of ext.themes) if (extThemeId(ext.id, th.label) === id) return th;
  return null;
}

/** Shows a theme of an extension (false when it is not installed or Monaco refuses it). */
export function showExtTheme(id: string): boolean {
  const th = findTheme(id);
  if (!th) return false;
  const app = themeToApp(th);
  try {
    setExtThemeOverride({
      id,
      dark: app.dark,
      vars: app.vars,
      editor: app.editor,
      rules: app.rules,
    });
  } catch {
    setExtThemeOverride(null);
    applyTheme(getState().settings.theme);
    return false;
  }
  applyTheme(getState().settings.theme);
  notify();
  return true;
}

/** Back to the built-in theme chosen in Settings. */
export function clearExtTheme(): void {
  if (!extThemeOverride()) return;
  setExtThemeOverride(null);
  applyTheme(getState().settings.theme);
  notify();
}

function registerLanguages(ext: InstalledExtension): void {
  const known = new Set(monaco.languages.getLanguages().map((l) => l.id));
  for (const lang of ext.languages) {
    if (registered.has(lang.id)) continue;
    registered.add(lang.id);
    const extensions = lang.extensions ?? [];
    const filenames = lang.filenames ?? [];
    // A language Monaco already colors keeps its own definition; only new file names are added.
    if (!known.has(lang.id)) {
      monaco.languages.register({ id: lang.id, extensions, filenames, aliases: lang.aliases });
      try {
        monaco.languages.setLanguageConfiguration(lang.id, langConfig(lang.configuration));
      } catch {
        // a configuration Monaco refuses only loses brackets and comments
      }
    }
    addLanguageFiles(lang.id, extensions, filenames);
  }
}

function registerSnippets(list: InstalledExtension[]): void {
  for (const d of snippetProviders) d.dispose();
  snippetProviders = [];
  const known = new Set(monaco.languages.getLanguages().map((l) => l.id));
  const byLang = new Map<string, { ext: string; items: ReturnType<typeof snippetItems> }[]>();
  for (const ext of list)
    for (const s of ext.snippets) {
      if (!known.has(s.language)) continue;
      const items = snippetItems(s.snippets);
      if (!items.length) continue;
      const cur = byLang.get(s.language) ?? [];
      cur.push({ ext: ext.displayName, items });
      byLang.set(s.language, cur);
    }
  for (const [language, groups] of byLang)
    snippetProviders.push(
      monaco.languages.registerCompletionItemProvider(language, {
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          );
          return {
            suggestions: groups.flatMap((g) =>
              g.items.map((it) => ({
                label: { label: it.prefix, description: it.name },
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: g.ext,
                documentation: it.description || it.body,
                insertText: it.body,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              })),
            ),
          };
        },
      }),
    );
}

/** Reads the installed extensions and applies them. Safe to call again after any change. */
export async function loadExtensions(): Promise<InstalledExtension[]> {
  try {
    installed = await api().extensions.list();
  } catch {
    installed = [];
  }
  const enabled = installed.filter((e) => e.enabled);
  for (const ext of enabled) registerLanguages(ext);
  registerSnippets(enabled);
  // The chosen theme went away (uninstalled or disabled): back to the built-in one.
  const active = extThemeOverride();
  if (active && !findTheme(active.id)) {
    setExtThemeOverride(null);
    applyTheme(getState().settings.theme);
  }
  notify();
  return installed;
}

let started = false;
/** Called once when the app starts. */
export function startExtensions(): void {
  if (started) return;
  started = true;
  void loadExtensions();
  api().on((ev) => {
    if (ev.type === 'extensions:changed') void loadExtensions();
  });
  // Another window picked or left an extension theme.
  window.addEventListener('storage', (e) => {
    if (e.key !== EXT_THEME_KEY) return;
    reloadExtThemeOverride();
    applyTheme(getState().settings.theme);
    notify();
  });
}
