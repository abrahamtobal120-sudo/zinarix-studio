/**
 * Fase 8 — adds the missing imports after an AI suggestion is accepted (ghost text or next
 * edit). Waits for the language service to report the new "cannot find name" errors in the
 * inserted range, asks it for quick fixes (Monaco's TypeScript worker for TS/JS, the LSP
 * server for the rest) and applies the import fix when there is exactly one sensible choice.
 */
import {
  TS_MISSING_NAME_CODES,
  looksLikeMissingName,
  pickImportCandidate,
} from '../shared/autoImport';
import { lspQuickFixes, modelPath } from './lsp';
import { editsByFile, toMonacoRange } from './lspConvert';
import { monaco } from './monaco';

/** How long to wait for the diagnostics of the inserted code. */
const WAIT_MS = 2000;
const POLL_MS = 150;

/** >0 while an import is being written into a model (the edit is ours, not the user's). */
let applying = 0;

/** True while auto-import is changing a document: listeners must not take it as typing. */
export function applyingImports(): boolean {
  return applying > 0;
}

/** Applies edits to the model as one auto-import step (flagged as ours while it runs). */
function pushEdits(
  model: monaco.editor.ITextModel,
  ops: monaco.editor.IIdentifiedSingleEditOperation[],
): void {
  applying++;
  try {
    model.pushEditOperations([], ops, () => null);
  } finally {
    applying--;
  }
}

function markersIn(model: monaco.editor.ITextModel, range: monaco.IRange): monaco.editor.IMarker[] {
  return monaco.editor
    .getModelMarkers({ resource: model.uri })
    .filter(
      (m) =>
        m.severity === monaco.MarkerSeverity.Error &&
        m.startLineNumber >= range.startLineNumber &&
        m.endLineNumber <= range.endLineNumber,
    );
}

function codeOf(m: monaco.editor.IMarker): number | undefined {
  const c = typeof m.code === 'string' ? m.code : m.code?.value;
  const n = Number(c);
  return Number.isFinite(n) ? n : undefined;
}

function isMissing(m: monaco.editor.IMarker, ts: boolean): boolean {
  if (ts) return TS_MISSING_NAME_CODES.includes(codeOf(m) ?? -1);
  return looksLikeMissingName(m.message);
}

async function waitForMarkers(
  model: monaco.editor.ITextModel,
  range: monaco.IRange,
  ts: boolean,
  version: number,
): Promise<monaco.editor.IMarker[]> {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (model.isDisposed() || model.getVersionId() !== version) return [];
    const found = markersIn(model, range).filter((m) => isMissing(m, ts));
    if (found.length) return found;
  }
  return [];
}

interface TsFix {
  fixName?: string;
  description: string;
  changes: {
    fileName: string;
    textChanges: { span: { start: number; length: number }; newText: string }[];
  }[];
}

async function tsFixes(
  model: monaco.editor.ITextModel,
  marker: monaco.editor.IMarker,
): Promise<TsFix[]> {
  const lang = model.getLanguageId();
  const getter =
    lang === 'javascript'
      ? monaco.typescript.getJavaScriptWorker
      : monaco.typescript.getTypeScriptWorker;
  const worker = await (await getter())(model.uri);
  const start = model.getOffsetAt({
    lineNumber: marker.startLineNumber,
    column: marker.startColumn,
  });
  const end = model.getOffsetAt({ lineNumber: marker.endLineNumber, column: marker.endColumn });
  const opts = model.getOptions();
  const fixes = (await worker.getCodeFixesAtPosition(
    model.uri.toString(),
    start,
    end,
    [codeOf(marker)!],
    { insertSpaces: opts.insertSpaces, tabSize: opts.tabSize, indentSize: opts.indentSize },
  )) as TsFix[];
  return fixes.filter((f) => !f.fixName || f.fixName === 'import' || /import/i.test(f.fixName));
}

function applyTsFix(model: monaco.editor.ITextModel, fix: TsFix): boolean {
  const mine = fix.changes.filter((c) => c.fileName === model.uri.toString());
  // A fix that touches other files is not "just an import": leave it to Ctrl+.
  if (!mine.length || mine.length !== fix.changes.length) return false;
  const ops = mine
    .flatMap((c) => c.textChanges)
    .map((tc) => {
      const a = model.getPositionAt(tc.span.start);
      const b = model.getPositionAt(tc.span.start + tc.span.length);
      return {
        range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column),
        text: tc.newText,
      };
    });
  pushEdits(model, ops);
  return true;
}

/**
 * An LSP import fix applied to this model only. A fix that also touches other files or
 * creates / renames / deletes files is not "just an import": it is left to the user's Ctrl+.
 */
function applyLspFix(model: monaco.editor.ITextModel, edit: unknown): boolean {
  const path = modelPath(model);
  const { files, outside, ops } = editsByFile(edit);
  const mine = path ? files.get(path) : undefined;
  if (!mine?.length || outside || ops.length || files.size !== 1) return false;
  pushEdits(
    model,
    mine.map((e) => ({ range: toMonacoRange(e.range), text: e.newText })),
  );
  return true;
}

/**
 * Adds the imports the code inserted in `range` needs. Returns how many were added. Never
 * throws: no language service, no errors or an ambiguous fix all just mean 0.
 */
export async function addMissingImports(
  model: monaco.editor.ITextModel,
  range: monaco.IRange,
): Promise<number> {
  try {
    const lang = model.getLanguageId();
    const ts = lang === 'typescript' || lang === 'javascript';
    const markers = await waitForMarkers(model, range, ts, model.getVersionId());
    if (!markers.length) return 0;
    let added = 0;
    const done = new Set<string>();
    // Imports go above the inserted code: each one moves the next markers down by the
    // lines it added.
    let shift = 0;
    // The fixes are computed for the text as it was asked; if the user typed meanwhile their
    // offsets are stale, and writing them would put the import in the wrong place.
    let expected = model.getVersionId();
    const untouched = () => !model.isDisposed() && model.getVersionId() === expected;
    for (const original of markers.slice(0, 6)) {
      const m = {
        ...original,
        startLineNumber: original.startLineNumber + shift,
        endLineNumber: original.endLineNumber + shift,
      };
      const name = model.getValueInRange(m);
      if (done.has(name)) continue;
      done.add(name);
      const before = model.getLineCount();
      if (ts) {
        const fixes = await tsFixes(model, m);
        const pick = pickImportCandidate(fixes.map((f) => ({ ...f, title: f.description })));
        if (!untouched()) break;
        if (pick && applyTsFix(model, pick)) added++;
      } else {
        const actions = await lspQuickFixes(model, m, [m]);
        if (!actions) return added; // no language server for this file
        const pick = pickImportCandidate(actions.filter((a) => a.edit));
        if (!untouched()) break;
        if (pick && applyLspFix(model, pick.edit)) added++;
      }
      expected = model.getVersionId();
      shift += model.getLineCount() - before;
    }
    if (added) model.pushStackElement();
    return added;
  } catch {
    return 0;
  }
}
