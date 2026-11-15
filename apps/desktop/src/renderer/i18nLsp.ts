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
    'Tras un cambio, la IA propone las siguientes ediciones (pueden ser de varias líneas): Tab salta a la primera, Tab otra vez la aplica y salta a la siguiente; Esc las descarta. Requiere el autocompletado con IA.',
  nextEditHint: '⇥ Tab',
  nextEditApply: '⇥ Tab para aplicar',
  nextEditJump: '⇥ Tab → línea {line}',
  nextEditCount: '{i} de {n}',
  nextEditImports: 'Se agregó {n} importación',
  nextEditImportsMany: 'Se agregaron {n} importaciones',
  autoImportSetting: 'Agregar importaciones al aceptar una sugerencia',
  autoImportSettingHint:
    'Si lo que aceptas usa un nombre sin importar, se agrega la importación (TypeScript/JavaScript, o el servidor de lenguaje). Solo cuando hay una sola opción clara.',
  statsTitle: 'Métrica de sugerencias',
  statsHint:
    'Cuántas sugerencias aceptas y cuánto tarda cada modelo. Con esto se ajusta la pausa antes de pedir otra.',
  statsEmpty: 'Todavía no hay datos: activa el autocompletado y escribe un poco.',
  statsKindInline: 'Autocompletado',
  statsKindNextEdit: 'Siguiente edición',
  statsModel: 'Modelo',
  statsRequests: 'Pedidas',
  statsShown: 'Mostradas',
  statsAccepted: 'Aceptadas',
  statsRate: 'Aceptación',
  statsSlow: 'p50 sobre {ms} ms: prueba un modelo más rápido para el rol "inline".',
  statsLowAccept: 'Casi no se aceptan: prueba otro modelo para el rol "inline".',
  statsClear: 'Borrar métrica',
  statsRefresh: 'Actualizar',
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
    'After a change, the AI proposes the next edits (they may span several lines): Tab jumps to the first one, Tab again applies it and jumps to the next; Esc dismisses them. Needs AI autocomplete.',
  nextEditHint: '⇥ Tab',
  nextEditApply: '⇥ Tab to apply',
  nextEditJump: '⇥ Tab → line {line}',
  nextEditCount: '{i} of {n}',
  nextEditImports: 'Added {n} import',
  nextEditImportsMany: 'Added {n} imports',
  autoImportSetting: 'Add imports when accepting a suggestion',
  autoImportSettingHint:
    'If what you accept uses a name that is not imported, the import is added (TypeScript/JavaScript, or the language server). Only when there is one clear choice.',
  statsTitle: 'Suggestion metric',
  statsHint:
    'How many suggestions you accept and how long each model takes. The pause before asking again is tuned from it.',
  statsEmpty: 'No data yet: turn on autocomplete and type a little.',
  statsKindInline: 'Autocomplete',
  statsKindNextEdit: 'Next edit',
  statsModel: 'Model',
  statsRequests: 'Requested',
  statsShown: 'Shown',
  statsAccepted: 'Accepted',
  statsRate: 'Acceptance',
  statsSlow: 'p50 above {ms} ms: try a faster model for the "inline" role.',
  statsLowAccept: 'Hardly ever accepted: try another model for the "inline" role.',
  statsClear: 'Clear metric',
  statsRefresh: 'Refresh',
};

export type LspKey = keyof typeof es;

export function tl(key: LspKey, vars: Record<string, string | number> = {}): string {
  const dict = lang === 'en' ? en : es;
  return dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
