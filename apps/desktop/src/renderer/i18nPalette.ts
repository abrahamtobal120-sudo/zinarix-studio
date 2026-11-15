import { lang } from './i18n';

/** Strings of the unified palette (Fase 19), kept apart from i18n.ts. */
const es = {
  palPlaceholder: 'Busca archivos. Escribe > comandos, @ símbolos, # chats, : línea',
  palFiles: 'Archivos',
  palRecent: 'Recientes',
  palCommands: 'Comandos',
  palAi: 'IA y chat',
  palModels: 'Modelos',
  palSymbols: 'Símbolos del archivo',
  palChatsOpen: 'Chats abiertos',
  palChatsSaved: 'Conversaciones guardadas',
  palLine: 'Ir a la línea',
  palGoLine: 'Ir a la línea {line}, columna {col}',
  palLineHint: 'Escribe un número de línea entre 1 y {max}',
  palLineOut: 'El archivo tiene {max} líneas',
  palNoEditor: 'Abre un archivo para usar @ y :',
  palNoFolder: 'Abre una carpeta para buscar archivos',
  palNoSymbols: 'Este archivo no tiene símbolos',
  palLoading: 'Cargando…',
  palUseModel: 'Usar como modelo predeterminado',
  palChatWaiting: 'espera tu aprobación',
  palChatBusy: 'trabajando',
  palMessages: '{n} mensajes',
  palScopeFiles: 'archivos',
  palScopeCommands: 'comandos',
  palScopeSymbols: 'símbolos',
  palScopeChats: 'chats',
  palScopeLine: 'línea',
};

type PalKey = keyof typeof es;

const en: Record<PalKey, string> = {
  palPlaceholder: 'Search files. Type > commands, @ symbols, # chats, : line',
  palFiles: 'Files',
  palRecent: 'Recent',
  palCommands: 'Commands',
  palAi: 'AI and chat',
  palModels: 'Models',
  palSymbols: 'Symbols in the file',
  palChatsOpen: 'Open chats',
  palChatsSaved: 'Saved conversations',
  palLine: 'Go to line',
  palGoLine: 'Go to line {line}, column {col}',
  palLineHint: 'Type a line number between 1 and {max}',
  palLineOut: 'The file has {max} lines',
  palNoEditor: 'Open a file to use @ and :',
  palNoFolder: 'Open a folder to search files',
  palNoSymbols: 'This file has no symbols',
  palLoading: 'Loading…',
  palUseModel: 'Use as the default model',
  palChatWaiting: 'waiting for your approval',
  palChatBusy: 'working',
  palMessages: '{n} messages',
  palScopeFiles: 'files',
  palScopeCommands: 'commands',
  palScopeSymbols: 'symbols',
  palScopeChats: 'chats',
  palScopeLine: 'line',
};

export function tpal(key: PalKey, vars: Record<string, string | number> = {}): string {
  const dict = lang === 'en' ? en : es;
  return dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
