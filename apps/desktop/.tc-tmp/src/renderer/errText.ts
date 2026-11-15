/**
 * Human-readable text for an error thrown across IPC: drops Electron's
 * "Error invoking remote method 'x': Error: " prefix so the user sees the real cause.
 */
export const errText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );
