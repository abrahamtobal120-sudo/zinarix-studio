/**
 * LSP ⇄ Monaco conversions that need no Monaco import (so they are unit-tested in Node).
 * LSP positions are 0-based (line, UTF-16 character); Monaco's are 1-based. Both count
 * UTF-16 code units, so only the +1/-1 changes.
 */
import { WS_URI } from '../shared/lsp';

export interface LspPosition {
  line: number;
  character: number;
}
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}
export interface MonacoRangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export function toLspPosition(p: { lineNumber: number; column: number }): LspPosition {
  return { line: p.lineNumber - 1, character: p.column - 1 };
}

export function toMonacoRange(r: LspRange): MonacoRangeLike {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

export function toLspRange(r: MonacoRangeLike): LspRange {
  return {
    start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
    end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
  };
}

/** zx-ws:/ URI of a workspace path, and back (null for files outside the workspace). */
export function wsUri(path: string): string {
  return WS_URI + path;
}
export function wsPath(uri: string): string | null {
  return uri.startsWith(WS_URI) ? uri.slice(WS_URI.length) : null;
}

/** LSP CompletionItemKind (1-based) → Monaco CompletionItemKind. */
const COMPLETION_KIND: Record<number, number> = {
  1: 18, // Text
  2: 0, // Method
  3: 1, // Function
  4: 2, // Constructor
  5: 3, // Field
  6: 4, // Variable
  7: 5, // Class
  8: 7, // Interface
  9: 8, // Module
  10: 9, // Property
  11: 12, // Unit
  12: 13, // Value
  13: 15, // Enum
  14: 17, // Keyword
  15: 27, // Snippet
  16: 19, // Color
  17: 20, // File
  18: 21, // Reference
  19: 23, // Folder
  20: 16, // EnumMember
  21: 14, // Constant
  22: 6, // Struct
  23: 10, // Event
  24: 11, // Operator
  25: 24, // TypeParameter
};
export function completionKind(kind: number | undefined): number {
  return (kind && COMPLETION_KIND[kind]) ?? 18;
}

/** LSP SymbolKind (1..26) → Monaco SymbolKind (0..25, same order). */
export function symbolKind(kind: number | undefined): number {
  return kind && kind >= 1 && kind <= 26 ? kind - 1 : 12;
}

/** LSP DiagnosticSeverity → Monaco MarkerSeverity (Hint 1, Info 2, Warning 4, Error 8). */
export function markerSeverity(sev: number | undefined): number {
  switch (sev) {
    case 1:
      return 8;
    case 2:
      return 4;
    case 3:
      return 2;
    case 4:
      return 1;
    default:
      return 8;
  }
}

type MarkedString = string | { language: string; value: string };
export type HoverContents =
  | MarkedString
  | MarkedString[]
  | { kind: 'markdown' | 'plaintext'; value: string };

/** Hover / documentation contents → Markdown strings. */
export function markdownOf(c: HoverContents | undefined | null): string[] {
  if (c === undefined || c === null) return [];
  if (Array.isArray(c)) return c.flatMap((x) => markdownOf(x));
  if (typeof c === 'string') return c ? [c] : [];
  if ('kind' in c) {
    if (!c.value) return [];
    return [c.kind === 'plaintext' ? '```text\n' + c.value + '\n```' : c.value];
  }
  return c.value ? ['```' + c.language + '\n' + c.value + '\n```'] : [];
}

export function docString(
  d: string | { kind: string; value: string } | undefined,
): string | { value: string } | undefined {
  if (!d) return undefined;
  if (typeof d === 'string') return d;
  return d.kind === 'markdown' ? { value: d.value } : d.value;
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

/** Applies LSP text edits to a string (for files that are not open in the editor). */
export function applyTextEdits(text: string, edits: LspTextEdit[]): string {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const offset = (p: LspPosition) => {
    if (p.line >= starts.length) return text.length;
    const lineStart = starts[p.line]!;
    const lineEnd = p.line + 1 < starts.length ? starts[p.line + 1]! - 1 : text.length;
    return Math.min(lineStart + p.character, lineEnd);
  };
  const sorted = edits
    .map((e) => ({ s: offset(e.range.start), e: offset(e.range.end), t: e.newText }))
    .sort((a, b) => b.s - a.s || b.e - a.e);
  let out = text;
  for (const x of sorted) out = out.slice(0, x.s) + x.t + out.slice(x.e);
  return out;
}

/** A Location / LocationLink / array of them → flat list of {uri, range}. */
export function locationsOf(v: unknown): { uri: string; range: LspRange }[] {
  if (!v) return [];
  const list = Array.isArray(v) ? v : [v];
  const out: { uri: string; range: LspRange }[] = [];
  for (const x of list as Record<string, unknown>[]) {
    if (typeof x.targetUri === 'string')
      out.push({
        uri: x.targetUri,
        range: (x.targetSelectionRange ?? x.targetRange) as LspRange,
      });
    else if (typeof x.uri === 'string' && x.range) out.push({ uri: x.uri, range: x.range as LspRange });
  }
  return out;
}

/** WorkspaceEdit → edits per workspace path (create/rename/delete operations listed apart). */
export function editsByFile(edit: unknown): {
  files: Map<string, LspTextEdit[]>;
  outside: number;
  ops: { kind: 'create' | 'rename' | 'delete'; path: string; to?: string }[];
} {
  const files = new Map<string, LspTextEdit[]>();
  const ops: { kind: 'create' | 'rename' | 'delete'; path: string; to?: string }[] = [];
  let outside = 0;
  const add = (uri: string, edits: LspTextEdit[]) => {
    const p = wsPath(uri);
    if (p === null) {
      outside++;
      return;
    }
    files.set(p, [...(files.get(p) ?? []), ...edits]);
  };
  const e = (edit ?? {}) as {
    changes?: Record<string, LspTextEdit[]>;
    documentChanges?: Record<string, unknown>[];
  };
  if (e.documentChanges) {
    for (const dc of e.documentChanges) {
      if (dc.kind === 'create' || dc.kind === 'delete') {
        const p = wsPath(String(dc.uri));
        if (p !== null) ops.push({ kind: dc.kind, path: p });
        else outside++;
      } else if (dc.kind === 'rename') {
        const p = wsPath(String(dc.oldUri));
        const to = wsPath(String(dc.newUri));
        if (p !== null && to !== null) ops.push({ kind: 'rename', path: p, to });
        else outside++;
      } else {
        const td = dc.textDocument as { uri: string } | undefined;
        if (td) add(td.uri, (dc.edits as LspTextEdit[]) ?? []);
      }
    }
  } else if (e.changes) {
    for (const [uri, edits] of Object.entries(e.changes)) add(uri, edits);
  }
  return { files, outside, ops };
}
