import { t } from '../../i18n';

let cache: Record<string, string> | null = null;

/** Friendly name of an element for people who don't program: h1 → "Título", img → "Imagen". */
export function tagName(tag: string): string {
  if (!cache) {
    cache = {};
    for (const pair of t('dzTags').split(',')) {
      const [k, v] = pair.split('=');
      if (k && v) cache[k.trim()] = v.trim();
    }
  }
  return cache[tag] ?? cache['*'] ?? tag;
}
