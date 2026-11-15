/**
 * Language servers in the editor: every Monaco model of a language with a server (Python, Go,
 * Rust…) is opened in main's LspHost, and Monaco's providers (completion, hover, definition,
 * references, rename, symbols, formatting, signature help) ask that server through lsp:request.
 * Diagnostics come back as markers (owner "lsp"), which the Problems panel lists.
 */
import { LSP_LANGUAGES, MONACO_NATIVE, type LspStatus } from '../shared/lsp';
import { tl } from './i18nLsp';
import {
  applyTextEdits,
  completionKind,
  docString,
  editsByFile,
  locationsOf,
  markdownOf,
  markerSeverity,
  symbolKind,
  toLspPosition,
  toLspRange,
  toMonacoRange,
  wsPath,
  wsUri,
  type HoverContents,
  type LspRange,
  type LspTextEdit,
} from './lspConvert';
import { languageFor, monaco } from './monaco';
import { api, getState, openFile, toast } from './store';

/** Workspace path of a model ("src/a.py"), or null for models that are not project files. */
export function modelPath(model: monaco.editor.ITextModel): string | null {
  return model.uri.scheme === 'file' ? model.uri.path.replace(/^\//, '') : null;
}

export function fileUriOf(path: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'file', path: `/${path}` });
}

/** Paths whose model is open in main's LspHost. */
const opened = new Set<string>();
const statuses = new Map<string, LspStatus>();
const statusListeners = new Set<() => void>();

export function lspStatuses(): LspStatus[] {
  return [...statuses.values()];
}
export function onLspStatus(l: () => void): () => void {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
}

function usesServer(language: string): boolean {
  const custom = getState().prefs.lspCommands[language]?.trim();
  if (custom) return true;
  return !MONACO_NATIVE.has(language) && LSP_LANGUAGES.some((l) => l.ids.includes(language));
}

function textDoc(model: monaco.editor.ITextModel) {
  return { uri: wsUri(modelPath(model)!) };
}

/** lsp:request for a model, or null when it has no server. */
async function request<T>(
  model: monaco.editor.ITextModel,
  method: string,
  params: Record<string, unknown>,
): Promise<T | null> {
  const path = modelPath(model);
  if (!path || !opened.has(path)) return null;
  try {
    return (await api().lsp.request(path, method, { textDocument: textDoc(model), ...params })) as T;
  } catch {
    return null;
  }
}

function posParams(model: monaco.editor.ITextModel, p: monaco.Position) {
  return { position: toLspPosition(p), textDocument: textDoc(model) };
}

/** A model for a project file (created hidden when it is not open, so peek views can show it). */
async function ensureModel(path: string): Promise<monaco.editor.ITextModel | null> {
  const uri = fileUriOf(path);
  const existing = monaco.editor.getModel(uri);
  if (existing) return existing;
  try {
    const f = await api().workspace.readFile(path);
    if (f.binary || f.tooLarge) return null;
    return monaco.editor.getModel(uri) ?? monaco.editor.createModel(f.content, languageFor(path), uri);
  } catch {
    return null;
  }
}

async function toLocations(v: unknown): Promise<monaco.languages.Location[]> {
  const out: monaco.languages.Location[] = [];
  for (const l of locationsOf(v)) {
    const p = wsPath(l.uri);
    if (p === null || !(await ensureModel(p))) continue;
    out.push({ uri: fileUriOf(p), range: toMonacoRange(l.range) });
  }
  return out;
}

function toMonacoEdits(edits: LspTextEdit[] | null | undefined): monaco.languages.TextEdit[] {
  return (edits ?? []).map((e) => ({ range: toMonacoRange(e.range), text: e.newText }));
}

/** Applies a WorkspaceEdit: open files through their model (undo works), the rest on disk. */
export async function applyWorkspaceEdit(edit: unknown): Promise<boolean> {
  const { files, outside, ops } = editsByFile(edit);
  try {
    for (const op of ops) {
      if (op.kind === 'create') await api().workspace.createFile(op.path).catch(() => undefined);
      else if (op.kind === 'rename' && op.to) await api().workspace.rename(op.path, op.to);
      else if (op.kind === 'delete') await api().workspace.trash(op.path);
    }
    for (const [path, edits] of files) {
      const model = monaco.editor.getModel(fileUriOf(path));
      if (model) {
        model.pushStackElement();
        model.pushEditOperations(
          [],
          edits.map((e) => ({ range: toMonacoRange(e.range), text: e.newText })),
          () => null,
        );
        model.pushStackElement();
      } else {
        const f = await api().workspace.readFile(path);
        if (f.binary || f.tooLarge) continue;
        await api().workspace.writeFile(path, applyTextEdits(f.content, edits));
      }
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    return false;
  }
  if (outside) toast(tl('lspOutside'));
  return true;
}

// ---------------- providers (one set per language, registered on first use) ----------------

const registered = new Map<string, monaco.IDisposable[]>();

function register(language: string): void {
  if (registered.has(language)) return;
  const sel = language;
  const status = () => statuses.get(language);
  const d: monaco.IDisposable[] = [];

  d.push(
    monaco.languages.registerCompletionItemProvider(sel, {
      // Common trigger characters; the server's own list is checked below.
      triggerCharacters: ['.', ':', '>', '"', "'", '/', '@', '<', '(', '$', '-'],
      async provideCompletionItems(model, position, ctx) {
        const trig = ctx.triggerCharacter;
        if (trig && !(status()?.triggerCharacters ?? []).includes(trig)) return { suggestions: [] };
        const r = await request<
          | { isIncomplete?: boolean; items: LspCompletion[] }
          | LspCompletion[]
        >(model, 'textDocument/completion', {
          position: toLspPosition(position),
          context: trig ? { triggerKind: 2, triggerCharacter: trig } : { triggerKind: 1 },
        });
        if (!r) return { suggestions: [] };
        const items = Array.isArray(r) ? r : r.items;
        const word = model.getWordUntilPosition(position);
        const fallback = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        return {
          incomplete: !Array.isArray(r) && Boolean(r.isIncomplete),
          suggestions: items.slice(0, 500).map((it) => toSuggestion(it, fallback, model)),
        };
      },
      async resolveCompletionItem(item) {
        const raw = (item as { _lsp?: LspCompletion; _model?: monaco.editor.ITextModel })._lsp;
        const model = (item as { _model?: monaco.editor.ITextModel })._model;
        if (!raw || !model) return item;
        const path = modelPath(model);
        if (!path) return item;
        try {
          const res = (await api().lsp.request(path, 'completionItem/resolve', raw)) as LspCompletion;
          if (res?.documentation) item.documentation = docString(res.documentation);
          if (res?.detail) item.detail = res.detail;
          if (res?.additionalTextEdits)
            item.additionalTextEdits = toMonacoEdits(res.additionalTextEdits);
        } catch {
          // keep the item as it is
        }
        return item;
      },
    }),
  );

  d.push(
    monaco.languages.registerHoverProvider(sel, {
      async provideHover(model, position) {
        const r = await request<{ contents: HoverContents; range?: LspRange }>(
          model,
          'textDocument/hover',
          posParams(model, position),
        );
        const md = markdownOf(r?.contents);
        if (!md.length) return null;
        return {
          contents: md.map((value) => ({ value })),
          range: r?.range ? toMonacoRange(r.range) : undefined,
        };
      },
    }),
  );

  const locProvider = (method: string) => ({
    async provide(model: monaco.editor.ITextModel, position: monaco.Position, extra = {}) {
      const r = await request<unknown>(model, method, { ...posParams(model, position), ...extra });
      return toLocations(r);
    },
  });
  const def = locProvider('textDocument/definition');
  const typeDef = locProvider('textDocument/typeDefinition');
  const impl = locProvider('textDocument/implementation');
  const refs = locProvider('textDocument/references');
  d.push(
    monaco.languages.registerDefinitionProvider(sel, {
      provideDefinition: (m, p) => def.provide(m, p),
    }),
    monaco.languages.registerTypeDefinitionProvider(sel, {
      provideTypeDefinition: (m, p) => typeDef.provide(m, p),
    }),
    monaco.languages.registerImplementationProvider(sel, {
      provideImplementation: (m, p) => impl.provide(m, p),
    }),
    monaco.languages.registerReferenceProvider(sel, {
      provideReferences: (m, p, ctx) =>
        refs.provide(m, p, { context: { includeDeclaration: ctx.includeDeclaration } }),
    }),
  );

  d.push(
    monaco.languages.registerRenameProvider(sel, {
      async provideRenameEdits(model, position, newName) {
        const r = await request<unknown>(model, 'textDocument/rename', {
          ...posParams(model, position),
          newName,
        });
        if (!r) return { edits: [], rejectReason: tl('lspNoDefinition') };
        // Applied by us (also files that are not open), so Monaco gets an empty edit.
        await applyWorkspaceEdit(r);
        return { edits: [] };
      },
    }),
  );

  d.push(
    monaco.languages.registerDocumentSymbolProvider(sel, {
      async provideDocumentSymbols(model) {
        const r = await request<LspSymbol[]>(model, 'textDocument/documentSymbol', {});
        return (r ?? []).map(toSymbol);
      },
    }),
  );

  d.push(
    monaco.languages.registerDocumentFormattingEditProvider(sel, {
      async provideDocumentFormattingEdits(model, options) {
        const r = await request<LspTextEdit[]>(model, 'textDocument/formatting', {
          options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
        });
        return toMonacoEdits(r);
      },
    }),
    monaco.languages.registerDocumentRangeFormattingEditProvider(sel, {
      async provideDocumentRangeFormattingEdits(model, range, options) {
        const r = await request<LspTextEdit[]>(model, 'textDocument/rangeFormatting', {
          range: toLspRange(range),
          options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
        });
        return toMonacoEdits(r);
      },
    }),
  );

  d.push(
    monaco.languages.registerSignatureHelpProvider(sel, {
      signatureHelpTriggerCharacters: ['(', ','],
      async provideSignatureHelp(model, position) {
        const r = await request<{
          signatures: {
            label: string;
            documentation?: string | { kind: string; value: string };
            parameters?: { label: string | [number, number]; documentation?: string | { kind: string; value: string } }[];
          }[];
          activeSignature?: number;
          activeParameter?: number;
        }>(model, 'textDocument/signatureHelp', { position: toLspPosition(position) });
        if (!r?.signatures?.length) return null;
        return {
          value: {
            signatures: r.signatures.map((s) => ({
              label: s.label,
              documentation: docString(s.documentation),
              parameters: (s.parameters ?? []).map((p) => ({
                label: p.label,
                documentation: docString(p.documentation),
              })),
            })),
            activeSignature: r.activeSignature ?? 0,
            activeParameter: r.activeParameter ?? 0,
          },
          dispose() {},
        };
      },
    }),
  );

  d.push(
    monaco.languages.registerCodeActionProvider(sel, {
      async provideCodeActions(model, range, ctx) {
        const diagnostics = ctx.markers.map(
          (m) => (m as unknown as { _lsp?: unknown })._lsp ?? markerToDiagnostic(m),
        );
        const r = await request<LspCodeAction[]>(model, 'textDocument/codeAction', {
          range: toLspRange(range),
          context: { diagnostics },
        });
        const actions: monaco.languages.CodeAction[] = [];
        for (const a of r ?? []) {
          if (!a.edit) continue; // commands without edits need the server's executeCommand
          const edits: monaco.languages.IWorkspaceTextEdit[] = [];
          for (const [p, list] of editsByFile(a.edit).files)
            for (const e of list)
              edits.push({
                resource: fileUriOf(p),
                textEdit: { range: toMonacoRange(e.range), text: e.newText },
                versionId: undefined,
              });
          actions.push({ title: a.title, kind: a.kind, isPreferred: a.isPreferred, edit: { edits } });
        }
        return { actions, dispose() {} };
      },
    }),
  );

  registered.set(language, d);
}

interface LspCompletion {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  insertTextFormat?: number;
  filterText?: string;
  sortText?: string;
  textEdit?: { range?: LspRange; insert?: LspRange; replace?: LspRange; newText: string };
  additionalTextEdits?: LspTextEdit[];
  deprecated?: boolean;
  tags?: number[];
}

function toSuggestion(
  it: LspCompletion,
  fallback: monaco.IRange,
  model: monaco.editor.ITextModel,
): monaco.languages.CompletionItem {
  const te = it.textEdit;
  const range = te
    ? te.range
      ? toMonacoRange(te.range)
      : { insert: toMonacoRange(te.insert!), replace: toMonacoRange(te.replace!) }
    : fallback;
  const item: monaco.languages.CompletionItem & { _lsp?: LspCompletion; _model?: unknown } = {
    label: it.label,
    kind: completionKind(it.kind) as monaco.languages.CompletionItemKind,
    detail: it.detail,
    documentation: docString(it.documentation),
    insertText: te?.newText ?? it.insertText ?? it.label,
    insertTextRules:
      it.insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    filterText: it.filterText,
    sortText: it.sortText,
    range,
    additionalTextEdits: toMonacoEdits(it.additionalTextEdits),
    tags: it.deprecated || it.tags?.includes(1) ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
  };
  item._lsp = it;
  item._model = model;
  return item;
}

interface LspSymbol {
  name: string;
  detail?: string;
  kind: number;
  range?: LspRange;
  selectionRange?: LspRange;
  location?: { uri: string; range: LspRange };
  children?: LspSymbol[];
}

function toSymbol(s: LspSymbol): monaco.languages.DocumentSymbol {
  const range = toMonacoRange(s.range ?? s.location!.range);
  return {
    name: s.name,
    detail: s.detail ?? '',
    kind: symbolKind(s.kind) as monaco.languages.SymbolKind,
    tags: [],
    range,
    selectionRange: s.selectionRange ? toMonacoRange(s.selectionRange) : range,
    children: s.children?.map(toSymbol),
  };
}

interface LspCodeAction {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  edit?: unknown;
}

function markerToDiagnostic(m: monaco.editor.IMarkerData) {
  return {
    range: toLspRange(m),
    message: m.message,
    severity: m.severity === 8 ? 1 : m.severity === 4 ? 2 : m.severity === 2 ? 3 : 4,
  };
}

// ---------------- documents ----------------

const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function openModel(model: monaco.editor.ITextModel): Promise<void> {
  const path = modelPath(model);
  if (!path || !getState().workspace || !getState().prefs.lsp) return;
  const language = model.getLanguageId();
  if (!usesServer(language)) return;
  register(language);
  const status = await api()
    .lsp.open(path, language, model.getValue())
    .catch(() => null);
  if (!status || model.isDisposed()) return;
  opened.add(path);
  setStatus(status);
}

function setStatus(s: LspStatus): void {
  const prev = statuses.get(s.language);
  statuses.set(s.language, s);
  if (s.state === 'missing' && prev?.state !== 'missing')
    toast(tl('lspMissing', { label: s.label, hint: s.detail ?? '' }));
  if (s.state === 'error' && prev?.state !== 'error')
    toast(tl('lspError', { label: s.label, detail: s.detail ?? '' }));
  for (const l of statusListeners) l();
}

function watchModel(model: monaco.editor.ITextModel): void {
  if (model.uri.scheme !== 'file') return;
  void openModel(model);
  const subs = [
    model.onDidChangeContent(() => {
      const path = modelPath(model);
      if (!path || !opened.has(path)) return;
      clearTimeout(changeTimers.get(path));
      changeTimers.set(
        path,
        setTimeout(() => {
          if (!model.isDisposed()) void api().lsp.change(path, model.getValue());
        }, 250),
      );
    }),
    model.onDidChangeLanguage(() => {
      const path = modelPath(model);
      if (path && opened.delete(path)) void api().lsp.close(path);
      void openModel(model);
    }),
  ];
  model.onWillDispose(() => {
    for (const s of subs) s.dispose();
    const path = modelPath(model);
    if (path && opened.delete(path)) {
      clearTimeout(changeTimers.get(path));
      void api().lsp.close(path);
    }
  });
}

/** Tells the server a file was saved (some servers only re-check on save). */
export function lspSaved(path: string): void {
  if (!opened.has(path)) return;
  const model = monaco.editor.getModel(fileUriOf(path));
  clearTimeout(changeTimers.get(path));
  void (async () => {
    if (model && !model.isDisposed()) await api().lsp.change(path, model.getValue());
    await api().lsp.save(path);
  })();
}

/** Reopens every model (after a folder change or a server restart). */
export function reopenAll(): void {
  opened.clear();
  for (const m of monaco.editor.getModels()) void openModel(m);
}

let installed = false;
export function installLsp(): void {
  if (installed) return;
  installed = true;
  for (const m of monaco.editor.getModels()) watchModel(m);
  monaco.editor.onDidCreateModel(watchModel);

  // Go to definition in another file: open it as a tab.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== 'file') return false;
      const path = resource.path.replace(/^\//, '');
      const pos = !selectionOrPosition
        ? undefined
        : 'lineNumber' in selectionOrPosition
          ? { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column }
          : { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn };
      void openFile(path, pos);
      return true;
    },
  });

  api().on((ev) => {
    if (ev.type === 'lsp:diagnostics') {
      const model = monaco.editor.getModel(fileUriOf(ev.path));
      if (!model) return;
      const markers = (ev.diagnostics as LspDiagnostic[]).map((d) => {
        const m: monaco.editor.IMarkerData & { _lsp?: unknown } = {
          ...toMonacoRange(d.range),
          message: d.message,
          severity: markerSeverity(d.severity) as monaco.MarkerSeverity,
          source: d.source,
          code: d.code === undefined ? undefined : String(d.code),
        };
        m._lsp = d;
        return m;
      });
      monaco.editor.setModelMarkers(model, 'lsp', markers);
    } else if (ev.type === 'lsp:status') setStatus(ev.status);
    else if (ev.type === 'lsp:applyEdit')
      void applyWorkspaceEdit(ev.edit).then((ok) => api().lsp.applyEditResult(ev.id, ok));
    else if (ev.type === 'workspace') {
      statuses.clear();
      for (const l of statusListeners) l();
      // Main stopped the servers of the old folder; the models of the new one open again.
      setTimeout(reopenAll, 0);
    }
  });
}

interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: number;
  source?: string;
  code?: string | number;
}
