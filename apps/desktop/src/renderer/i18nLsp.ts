import { lang } from './i18n';

/** Strings of the language servers and next-edit features (kept apart from i18n.ts). */
const es = {
  lspSetting: 'Servidores de lenguaje (LSP)',
  lspSettingHint:
    'Ir a la definición, renombrar, buscar referencias, autocompletado y errores en Python, Go, Rust, C/C++, Java, C#, PHP, Ruby… usando el servidor instalado en tu equipo.',
  lspCommands: 'Comandos propios por lenguaje',
  lspCommandsHint:
    'Una línea por lenguaje: id=comando. Ej.: python=pylsp · typescript=typescript-language-server --stdio',
  lspRestart: 'Reiniciar servidores',
  lspStarting: 'iniciando…',
  lspMissing: '{label}: no hay servidor de lenguaje instalado. Instálalo con: {hint}',
  lspError: '{label}: el servidor de lenguaje falló: {detail}',
  lspOffShort: 'LSP apagado',
  lspNoServerShort: 'sin servidor',
  lspOutside: 'Algunos cambios eran para archivos fuera del proyecto y no se aplicaron.',
  lspNoDefinition: 'No se encontró la definición.',
  nextEditSetting: 'Predecir la siguiente edición (Tab)',
  nextEditSettingHint:
    'Tras un cambio, la IA adivina la siguiente línea a editar: Tab salta ahí y la aplica, Esc la descarta. Requiere el autocompletado con IA.',
  nextEditHint: '⇥ Tab',
};

const en: Record<keyof typeof es, string> = {
  lspSetting: 'Language servers (LSP)',
  lspSettingHint:
    'Go to definition, rename, find references, completion and errors for Python, Go, Rust, C/C++, Java, C#, PHP, Ruby… using the server installed on your computer.',
  lspCommands: 'Custom command per language',
  lspCommandsHint:
    'One line per language: id=command. E.g. python=pylsp · typescript=typescript-language-server --stdio',
  lspRestart: 'Restart servers',
  lspStarting: 'starting…',
  lspMissing: '{label}: no language server installed. Install it with: {hint}',
  lspError: '{label}: the language server failed: {detail}',
  lspOffShort: 'LSP off',
  lspNoServerShort: 'no server',
  lspOutside: 'Some changes were for files outside the project and were not applied.',
  lspNoDefinition: 'Definition not found.',
  nextEditSetting: 'Predict the next edit (Tab)',
  nextEditSettingHint:
    'After a change, the AI guesses the next line to edit: Tab jumps there and applies it, Esc dismisses it. Needs AI autocomplete.',
  nextEditHint: '⇥ Tab',
};

export type LspKey = keyof typeof es;

export function tl(key: LspKey, vars: Record<string, string | number> = {}): string {
  const dict = lang === 'en' ? en : es;
  return dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
