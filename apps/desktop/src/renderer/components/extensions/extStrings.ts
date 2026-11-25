import { lang } from '../../i18n';

/** Strings of the Extensions panel (B6). */
const es = {
  title: 'Extensiones',
  desc: 'Temas de color, fragmentos de código y lenguajes de Open VSX',
  search: 'Buscar temas, fragmentos…',
  installed: 'Instaladas',
  results: 'Resultados',
  none: 'Todavía no hay extensiones instaladas. Busca un tema arriba, por ejemplo "dracula".',
  noResults: 'Sin resultados para "{q}".',
  searching: 'Buscando…',
  searchFail: 'No se pudo consultar Open VSX: {err}',
  install: 'Instalar',
  installing: 'Instalando…',
  installedOk: 'Se instaló {name}.',
  installFail: 'No se pudo instalar: {err}',
  already: 'Instalada',
  update: 'Actualizar a {v}',
  uninstall: 'Quitar',
  uninstallAsk: '¿Quitar la extensión {name}?',
  disable: 'Desactivar',
  enable: 'Activar',
  disabled: 'desactivada',
  themes: 'Temas',
  useTheme: 'Usar',
  inUse: 'En uso',
  leaveTheme: 'Volver al tema de Zinarix',
  snippets: '{n} fragmentos',
  languages: 'Lenguajes: {list}',
  unsupported: 'No se puede usar aquí: {list}',
  nothing:
    'Esta extensión no trae temas, fragmentos ni lenguajes: Zinarix no puede usar nada de ella.',
  downloads: '{n} descargas',
  note: 'Zinarix usa de cada extensión solo los temas, los fragmentos y la configuración de lenguajes. Las extensiones que ejecutan código no funcionan.',
  unCode: 'código',
  unGrammars: 'coloreado de sintaxis',
  refresh: 'Actualizar',
};

const en: Record<keyof typeof es, string> = {
  title: 'Extensions',
  desc: 'Color themes, snippets and languages from Open VSX',
  search: 'Search themes, snippets…',
  installed: 'Installed',
  results: 'Results',
  none: 'No extensions installed yet. Search for a theme above, for example "dracula".',
  noResults: 'No results for "{q}".',
  searching: 'Searching…',
  searchFail: 'Could not reach Open VSX: {err}',
  install: 'Install',
  installing: 'Installing…',
  installedOk: '{name} was installed.',
  installFail: 'Could not install: {err}',
  already: 'Installed',
  update: 'Update to {v}',
  uninstall: 'Remove',
  uninstallAsk: 'Remove the extension {name}?',
  disable: 'Disable',
  enable: 'Enable',
  disabled: 'disabled',
  themes: 'Themes',
  useTheme: 'Use',
  inUse: 'In use',
  leaveTheme: 'Back to the Zinarix theme',
  snippets: '{n} snippets',
  languages: 'Languages: {list}',
  unsupported: 'Cannot be used here: {list}',
  nothing:
    'This extension has no themes, snippets or languages: Zinarix cannot use anything from it.',
  downloads: '{n} downloads',
  note: 'Zinarix uses only the themes, snippets and language configuration of each extension. Extensions that run code do not work.',
  unCode: 'code',
  unGrammars: 'syntax coloring',
  refresh: 'Refresh',
};

export type KeyExt = keyof typeof es;

export function tx(key: KeyExt, vars: Record<string, string | number> = {}): string {
  const s = (lang === 'en' ? en : es)[key];
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
