import { lang } from './i18n';

/**
 * True when the window is newer than the app behind it: the app was updated (or rebuilt) while it
 * was open, so the window asks for something the running main process does not know yet. Only
 * closing the app and opening it again fixes that.
 */
export const needsRestart = (e: unknown): boolean =>
  /No handler registered for '|is not a function|Cannot read propert(y|ies) of undefined/.test(
    e instanceof Error ? e.message : String(e),
  );

export const RESTART_TEXT =
  lang === 'en'
    ? 'Zinarix was updated while it was open. Close it and open it again to use this.'
    : 'Zinarix se actualizó mientras estaba abierto. Ciérralo y vuelve a abrirlo para usar esto.';

/**
 * Human-readable text for an error thrown across IPC: drops Electron's
 * "Error invoking remote method 'x': Error: " prefix so the user sees the real cause.
 */
export const errText = (e: unknown): string =>
  /No handler registered for '/.test(e instanceof Error ? e.message : String(e))
    ? RESTART_TEXT
    : (e instanceof Error ? e.message : String(e)).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      );
