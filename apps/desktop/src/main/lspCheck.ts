/**
 * What the agent is told about a file right after it edited it (estudio, punto A4): the
 * errors the language server reports, as short text. Pure, so it can be tested without a
 * server.
 */

/** File extension → Monaco language id, for the languages that have a server (shared/lsp.ts). */
const BY_EXT: Record<string, string> = {
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  m: 'objective-c',
  java: 'java',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  lua: 'lua',
  sh: 'shell',
  bash: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  zig: 'zig',
  hs: 'haskell',
  tf: 'hcl',
  hcl: 'hcl',
  gd: 'gdscript',
};

export function languageOfPath(path: string): string | undefined {
  const name = path.split('/').pop() ?? path;
  if (/^Dockerfile(\..+)?$/i.test(name)) return 'dockerfile';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? BY_EXT[name.slice(dot + 1).toLowerCase()] : undefined;
}

interface Diagnostic {
  severity?: number;
  message?: string;
  source?: string;
  code?: string | number;
  range?: { start?: { line?: number; character?: number } };
}

const MAX_LINES = 15;

/**
 * Errors (and warnings, after them) of one file as `path:line:col: error: message` lines.
 * Hints and information are left out: they are noise for the model. Empty string = clean.
 */
export function formatDiagnostics(path: string, diagnostics: unknown[]): string {
  const rows = (diagnostics as Diagnostic[])
    .filter((d) => d && typeof d.message === 'string' && (d.severity ?? 1) <= 2)
    .sort(
      (a, b) =>
        (a.severity ?? 1) - (b.severity ?? 1) ||
        (a.range?.start?.line ?? 0) - (b.range?.start?.line ?? 0),
    );
  if (!rows.length) return '';
  const lines = rows.slice(0, MAX_LINES).map((d) => {
    const line = (d.range?.start?.line ?? 0) + 1;
    const col = (d.range?.start?.character ?? 0) + 1;
    const kind = (d.severity ?? 1) === 1 ? 'error' : 'warning';
    const code = d.code !== undefined ? ` [${d.code}]` : '';
    const message = d.message!.replace(/\s*\n\s*/g, ' ').slice(0, 300);
    return `${path}:${line}:${col}: ${kind}: ${message}${code}`;
  });
  if (rows.length > MAX_LINES) lines.push(`… and ${rows.length - MAX_LINES} more`);
  return lines.join('\n');
}

/** The note appended to the result of an edit. `text` comes from formatDiagnostics. */
export function diagnosticsNote(text: string | null): string {
  if (text === null) return '';
  if (!text) return '\nThe language server reports no errors in this file.';
  return `\nThe language server reports these problems in the file after your edit (fix the ones you caused):\n${text}`;
}
