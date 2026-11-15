import { posix } from 'node:path';
import type {
  ExtLanguageData,
  ExtSnippetData,
  ExtThemeData,
} from '../../shared/devtools.js';
import { parseJsonc } from '../debug/config.js';
import { extractEntry, readZip, safeEntryPath, type ZipEntry } from './zip.js';

/** Per-file cap inside a .vsix (themes and snippets are small). */
const MAX_FILE = 8 * 1024 * 1024;
const MAX_ICON = 256 * 1024;
/** Theme "include" chains deeper than this are cut (cycles). */
const MAX_INCLUDE = 8;

export interface ParsedVsix {
  manifest: Record<string, unknown>;
  themes: ExtThemeData[];
  languages: ExtLanguageData[];
  snippets: ExtSnippetData[];
  unsupported: string[];
  icon?: string;
  /** Files to keep on disk (archive path without "extension/" → bytes). */
  files: Map<string, Buffer>;
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Contribution points Zinarix applies; everything else is listed as unsupported. */
const SUPPORTED = new Set(['themes', 'snippets', 'languages']);

function uiBase(ui: unknown): ExtThemeData['base'] {
  if (ui === 'vs') return 'vs';
  if (ui === 'hc-black') return 'hc-black';
  if (ui === 'hc-light') return 'hc-light';
  return 'vs-dark';
}

/** Reads a .vsix: the manifest, the contributions Monaco can use, and the files they need. */
export function parseVsix(buf: Buffer): ParsedVsix {
  const entries = new Map<string, ZipEntry>();
  for (const e of readZip(buf)) {
    const p = safeEntryPath(e.name);
    if (p && p.startsWith('extension/')) entries.set(p.slice('extension/'.length), e);
  }
  const files = new Map<string, Buffer>();
  const read = (rel: string): Buffer => {
    const p = safeEntryPath(posix.normalize(rel));
    if (!p) throw new Error(`invalid path in the extension: ${rel}`);
    const cached = files.get(p);
    if (cached) return cached;
    const e = entries.get(p);
    if (!e) throw new Error(`missing file in the extension: ${p}`);
    const data = extractEntry(buf, e, MAX_FILE);
    files.set(p, data);
    return data;
  };
  const json = <T>(rel: string): T => parseJsonc<T>(read(rel).toString('utf8'));

  const manifest = json<Record<string, unknown>>('package.json');
  const contributes = (manifest.contributes ?? {}) as Record<string, unknown>;
  const unsupported: string[] = [];
  if (manifest.main || manifest.browser) unsupported.push('code');
  for (const k of Object.keys(contributes)) if (!SUPPORTED.has(k)) unsupported.push(k);

  // Themes (VS Code color themes, JSON with "include").
  const themes: ExtThemeData[] = [];
  const loadTheme = (rel: string, depth: number): ExtThemeData['theme'] => {
    if (/\.tmTheme$/i.test(rel)) throw new Error('tmTheme');
    const t = json<{ include?: string; colors?: Record<string, string>; tokenColors?: unknown }>(
      rel,
    );
    let base: ExtThemeData['theme'] = {};
    if (t.include && depth < MAX_INCLUDE)
      base = loadTheme(posix.join(posix.dirname(rel), t.include), depth + 1);
    // tokenColors may itself be a path to a tmTheme/JSON file.
    let tokenColors: unknown[] = [];
    if (Array.isArray(t.tokenColors)) tokenColors = t.tokenColors;
    else if (typeof t.tokenColors === 'string' && !/\.tmTheme$/i.test(t.tokenColors)) {
      const tc = json<{ tokenColors?: unknown[] } | unknown[]>(
        posix.join(posix.dirname(rel), t.tokenColors),
      );
      tokenColors = Array.isArray(tc) ? tc : (tc.tokenColors ?? []);
    }
    return {
      colors: { ...base.colors, ...t.colors },
      tokenColors: [...(base.tokenColors ?? []), ...tokenColors],
    };
  };
  for (const raw of Array.isArray(contributes.themes) ? contributes.themes : []) {
    const th = raw as { label?: string; id?: string; uiTheme?: string; path?: string };
    if (!th.path) continue;
    try {
      themes.push({
        label: th.label ?? th.id ?? posix.basename(th.path),
        base: uiBase(th.uiTheme),
        theme: loadTheme(th.path, 0),
      });
    } catch (e) {
      if (!unsupported.includes('themes (tmTheme)') && String(e).includes('tmTheme'))
        unsupported.push('themes (tmTheme)');
    }
  }

  // Languages (+ language-configuration.json).
  const languages: ExtLanguageData[] = [];
  for (const raw of Array.isArray(contributes.languages) ? contributes.languages : []) {
    const l = raw as Record<string, unknown>;
    if (typeof l.id !== 'string') continue;
    let configuration: Record<string, unknown> | undefined;
    if (typeof l.configuration === 'string')
      try {
        configuration = json<Record<string, unknown>>(l.configuration);
      } catch {
        // a broken config only loses brackets/comments for that language
      }
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : undefined);
    languages.push({
      id: l.id,
      extensions: strs(l.extensions),
      filenames: strs(l.filenames),
      aliases: strs(l.aliases),
      configuration,
    });
  }

  // Snippets.
  const snippets: ExtSnippetData[] = [];
  for (const raw of Array.isArray(contributes.snippets) ? contributes.snippets : []) {
    const s = raw as { language?: string; path?: string };
    if (!s.path) continue;
    try {
      const data = json<Record<string, unknown>>(s.path);
      for (const lang of (s.language ?? '').split(',').map((x) => x.trim()).filter(Boolean))
        snippets.push({ language: lang, snippets: data });
    } catch {
      // unreadable snippet file: skipped
    }
  }
  if (Array.isArray(contributes.grammars) && contributes.grammars.length)
    if (!unsupported.includes('grammars')) unsupported.push('grammars');

  let icon: string | undefined;
  if (typeof manifest.icon === 'string') {
    const ext = posix.extname(manifest.icon).toLowerCase();
    const p = safeEntryPath(manifest.icon);
    const e = p ? entries.get(p) : undefined;
    if (e && IMAGE_TYPES[ext] && e.size <= MAX_ICON)
      try {
        icon = `data:${IMAGE_TYPES[ext]};base64,${extractEntry(buf, e, MAX_ICON).toString('base64')}`;
      } catch {
        // no icon
      }
  }
  return { manifest, themes, languages, snippets, unsupported, icon, files };
}
