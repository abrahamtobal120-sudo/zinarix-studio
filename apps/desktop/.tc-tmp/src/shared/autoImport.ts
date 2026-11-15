/**
 * Fase 8 — automatic imports when a suggestion is accepted. After the editor inserts a
 * suggestion, the language service (Monaco's TypeScript worker or an LSP server) is asked for
 * quick fixes on the new "cannot find name" errors; this picks the import fix to apply. Pure.
 */

export interface ImportCandidate {
  title: string;
  isPreferred?: boolean;
  kind?: string;
}

const IMPORT_TITLE = /\bimport\b|^use\s/i;
const NOT_ADD = /\b(remove|organi[sz]e|unused|sort|delete|convert|disable|ignore)\b/i;

/** TypeScript error codes of a name that is not in scope (an import can fix them). */
export const TS_MISSING_NAME_CODES = [2304, 2552, 2503, 2686, 18004];

/** True for a diagnostic message that says a name is missing (used for LSP servers). */
export function looksLikeMissingName(message: string): boolean {
  return /^undefined: [\w.]+$|cannot find (name|symbol|module|value|type|function|struct|macro|trait)\b|is not defined|undefined (name|variable|identifier)|not found in (this )?scope|unresolved (reference|name|import)|undeclared name|"[^"]+" is not defined|unknown (name|identifier)/i.test(
    message,
  );
}

/**
 * The import fix to apply without asking, or null. Only import fixes count; when there are
 * several different ones (e.g. two modules export the same name) the server's preferred one is
 * used if it marks exactly one, otherwise nothing is applied — guessing the wrong module is
 * worse than leaving the error for the user's Ctrl+.
 */
export function pickImportCandidate<T extends ImportCandidate>(candidates: T[]): T | null {
  const byTitle = new Map<string, T>();
  for (const c of candidates) {
    if (!IMPORT_TITLE.test(c.title) || NOT_ADD.test(c.title)) continue;
    if (c.kind && !/^quickfix/.test(c.kind) && !/import/i.test(c.kind)) continue;
    if (!byTitle.has(c.title)) byTitle.set(c.title, c);
  }
  const list = [...byTitle.values()];
  if (list.length === 1) return list[0]!;
  const preferred = list.filter((c) => c.isPreferred);
  return preferred.length === 1 ? preferred[0]! : null;
}

/** Text changes given as offsets, applied back to front (so earlier offsets stay valid). */
export function applyOffsetChanges(
  text: string,
  changes: { start: number; length: number; newText: string }[],
): string {
  let out = text;
  for (const c of [...changes].sort((a, b) => b.start - a.start))
    out = out.slice(0, c.start) + c.newText + out.slice(c.start + c.length);
  return out;
}
