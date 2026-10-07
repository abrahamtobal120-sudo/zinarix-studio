/**
 * Minimal i18n: every user-facing string lives here in both Spanish and English.
 * Keys are typed, so a missing translation is a compile error.
 */
const es = {
  'err.auth':
    'La llave de {provider} fue rechazada (401/403). Revísala con `omni auth add {provider}`.',
  'err.no_key': 'No hay llave para {provider}. Agrégala con `omni auth add {provider}`.',
  'usage.period.day': 'hoy',
  'usage.period.month': 'este mes',
  'usage.period.all': 'todo',
  'err.rate_limit': 'Límite de peticiones alcanzado en {provider}. Intenta más tarde.',
  'err.server': 'El proveedor {provider} devolvió un error de servidor.',
  'err.timeout': 'Tiempo de espera agotado con {provider}.',
  'err.network': 'No se pudo conectar con {provider}.',
  'err.bad_request': 'Petición inválida para {provider}: {detail}',
  'err.not_found': 'No encontrado en {provider}: {detail}',
  'err.aborted': 'Cancelado.',
  'err.config': 'Error de configuración: {detail}',
  'err.budget': 'Presupuesto agotado: {detail}',
  'err.privacy': 'Bloqueado por el modo 100 % local: {detail}',
  'err.unsupported': 'No soportado: {detail}',
  'err.unknown': 'Error inesperado: {detail}',
  'auth.prompt': 'Pega la API key de {provider} (no se mostrará): ',
  'auth.saved': 'Llave de {provider} guardada en {store}.',
  'auth.testing': 'Probando conexión con {provider}…',
  'auth.test_ok': 'Conexión correcta con {provider}.',
  'auth.test_fail': 'La prueba de conexión falló: {detail}',
  'auth.removed': 'Llave de {provider} eliminada.',
  'auth.none': 'No hay proveedores conectados. Usa `omni auth add <proveedor>`.',
  'auth.no_key_needed': '{provider} no requiere llave.',
  'auth.empty': 'La llave está vacía.',
  'auth.get_key': 'Consigue una llave en: {url}',
  'provider.unknown': 'Proveedor desconocido: {provider}. Usa `omni providers` para ver la lista.',
  'provider.deprecated': 'Aviso: {provider} está marcado como obsoleto en el catálogo. {notes}',
  'provider.custom_added': 'Proveedor personalizado {provider} agregado.',
  'models.none': 'No se encontraron modelos.',
  'models.fetch_failed': 'No se pudo listar modelos de {provider}: {detail}',
  'use.set': 'Modelo por defecto: {model}',
  'use.no_default': 'No hay modelo por defecto. Usa `omni use <proveedor>/<modelo>` o `-m`.',
  'ask.no_prompt': 'Escribe una pregunta o envía texto por stdin.',
  'chat.welcome':
    'Zinarix Studio chat · {model}  —  /model <p/m> cambia de modelo · /clear · /exit',
  'chat.thinking': 'pensando…',
  'chat.switched': 'Modelo cambiado a {model}',
  'usage.none': 'Sin uso registrado en el periodo.',
  'redaction.notice': 'Se ocultaron {count} posible(s) secreto(s) antes de enviar el contexto.',
  'catalog.updated': 'Catálogo actualizado: {count} proveedores (firma verificada).',
  'catalog.bad_signature': 'La firma del catálogo no es válida; no se aplicó la actualización.',
  'wipe.done': 'Se borraron todas las llaves, el historial y la caché.',
  'wipe.confirm': 'Esto borrará todas las llaves e historial. Repite con --yes para confirmar.',
  'budget.warn': 'Aviso: llevas el {pct} % del presupuesto {period} de {provider}.',
  'privacy.local_only_on': 'Modo 100 % local activado: se bloquean proveedores en la nube.',
  'privacy.local_only_off': 'Modo 100 % local desactivado.',
  'vault.password': 'Contraseña maestra de la bóveda: ',
  'vault.keychain_unavailable':
    'El keychain del sistema no está disponible; se usará la bóveda cifrada ~/.omni/vault.enc.',
  'history.none': 'Sin conversaciones.',
} as const;

export type MessageKey = keyof typeof es;

const en: Record<MessageKey, string> = {
  'err.auth':
    'The {provider} key was rejected (401/403). Check it with `omni auth add {provider}`.',
  'err.no_key': 'No key for {provider}. Add one with `omni auth add {provider}`.',
  'usage.period.day': 'today',
  'usage.period.month': 'this month',
  'usage.period.all': 'all time',
  'err.rate_limit': 'Rate limit reached on {provider}. Try again later.',
  'err.server': 'Provider {provider} returned a server error.',
  'err.timeout': 'Timed out talking to {provider}.',
  'err.network': 'Could not connect to {provider}.',
  'err.bad_request': 'Invalid request for {provider}: {detail}',
  'err.not_found': 'Not found on {provider}: {detail}',
  'err.aborted': 'Cancelled.',
  'err.config': 'Configuration error: {detail}',
  'err.budget': 'Budget exhausted: {detail}',
  'err.privacy': 'Blocked by 100% local mode: {detail}',
  'err.unsupported': 'Not supported: {detail}',
  'err.unknown': 'Unexpected error: {detail}',
  'auth.prompt': 'Paste the {provider} API key (input hidden): ',
  'auth.saved': '{provider} key saved to {store}.',
  'auth.testing': 'Testing connection to {provider}…',
  'auth.test_ok': 'Connected to {provider}.',
  'auth.test_fail': 'Connection test failed: {detail}',
  'auth.removed': '{provider} key removed.',
  'auth.none': 'No providers connected. Use `omni auth add <provider>`.',
  'auth.no_key_needed': '{provider} does not need a key.',
  'auth.empty': 'The key is empty.',
  'auth.get_key': 'Get a key at: {url}',
  'provider.unknown': 'Unknown provider: {provider}. Run `omni providers` to see the list.',
  'provider.deprecated': 'Warning: {provider} is marked deprecated in the catalog. {notes}',
  'provider.custom_added': 'Custom provider {provider} added.',
  'models.none': 'No models found.',
  'models.fetch_failed': 'Could not list models from {provider}: {detail}',
  'use.set': 'Default model: {model}',
  'use.no_default': 'No default model. Use `omni use <provider>/<model>` or `-m`.',
  'ask.no_prompt': 'Type a question or pipe text through stdin.',
  'chat.welcome': 'Zinarix Studio chat · {model}  —  /model <p/m> switches model · /clear · /exit',
  'chat.thinking': 'thinking…',
  'chat.switched': 'Model switched to {model}',
  'usage.none': 'No usage recorded in this period.',
  'redaction.notice': '{count} possible secret(s) were hidden before sending the context.',
  'catalog.updated': 'Catalog updated: {count} providers (signature verified).',
  'catalog.bad_signature': 'Invalid catalog signature; the update was not applied.',
  'wipe.done': 'All keys, history and cache were deleted.',
  'wipe.confirm': 'This deletes every key and all history. Repeat with --yes to confirm.',
  'budget.warn': 'Warning: you have used {pct}% of the {period} {provider} budget.',
  'privacy.local_only_on': '100% local mode enabled: cloud providers are blocked.',
  'privacy.local_only_off': '100% local mode disabled.',
  'vault.password': 'Vault master password: ',
  'vault.keychain_unavailable':
    'The OS keychain is unavailable; using the encrypted vault ~/.omni/vault.enc.',
  'history.none': 'No conversations.',
};

export type Locale = 'es' | 'en';
const dictionaries: Record<Locale, Record<MessageKey, string>> = { es, en };

let current: Locale = detectLocale();

export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  const raw = env.OMNI_LANG ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? '';
  return raw.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = dictionaries[current][key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}
