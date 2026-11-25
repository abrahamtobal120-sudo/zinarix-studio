import { InlineCache, worthAsking } from '../shared/inlineCache';
import { adaptiveDebounce } from '../shared/nextEdit';
import { addMissingImports } from './autoImport';
import { tl } from './i18nLsp';
import { languageFor, monaco } from './monaco';
import { api, getEditor, getState, newRequestId, toast } from './store';

/** Pause after the last keystroke before asking the model (keeps token use low). */
const DEBOUNCE_MS = 550;
/** Re-read the acceptance metric (adaptive debounce) at most this often. */
const STATS_EVERY = 5 * 60_000;
const ACCEPTED_COMMAND = 'zx.inlineCompletion.accepted';

let registered = false;
let debounce = DEBOUNCE_MS;
let statsAt = 0;
/** Suggestions already made: typing through one, or coming back, asks nothing. */
const cache = new InlineCache();

function refreshDebounce(): void {
  if (Date.now() - statsAt < STATS_EVERY) return;
  statsAt = Date.now();
  void api()
    .ai.suggestionStats()
    .then((rows) => {
      debounce = adaptiveDebounce(
        rows.find((r) => r.kind === 'inline'),
        DEBOUNCE_MS,
      );
    })
    .catch(() => undefined);
}

/**
 * Fase 8: runs after a ghost-text suggestion is accepted — counts it for the acceptance metric
 * and adds the imports the inserted code needs.
 */
function onAccepted(uri: string, line: number, lines: number): void {
  void api()
    .ai.suggestionOutcome('inline', 'accepted', 1)
    .catch(() => undefined);
  if (!getState().prefs.autoImport) return;
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  if (!model) return;
  const range = {
    startLineNumber: line,
    startColumn: 1,
    endLineNumber: Math.min(model.getLineCount(), line + lines - 1),
    endColumn: 1,
  };
  void addMissingImports(model, range).then((n) => {
    if (n) toast(n === 1 ? tl('nextEditImports', { n }) : tl('nextEditImportsMany', { n }));
  });
}

/**
 * AI autocomplete (ghost text, Tab to accept), like Copilot. Uses the model assigned to the
 * "inline" role (or the default one). Off unless enabled in Settings.
 */
export function registerInlineCompletions(): void {
  if (registered) return;
  registered = true;
  monaco.editor.registerCommand(
    ACCEPTED_COMMAND,
    (_accessor, uri: string, line: number, lines: number) => onAccepted(uri, line, lines),
  );
  monaco.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model, position, _context, token) {
      const none = { items: [] };
      const st = getState();
      if (!st.prefs.inlineCompletions) return none;
      if (model !== getEditor()?.getModel() || model.uri.scheme !== 'file') return none;
      const full = model.getFullModelRange();
      const prefix = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const suffix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: full.endLineNumber,
        endColumn: full.endColumn,
      });
      if (!worthAsking(prefix, suffix)) return none;
      const path = model.uri.path.replace(/^\//, '');
      const item = (text: string) => ({
        items: [
          {
            insertText: text,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
            command: {
              id: ACCEPTED_COMMAND,
              title: '',
              arguments: [model.uri.toString(), position.lineNumber, text.split('\n').length],
            },
          },
        ],
      });
      const known = cache.get(path, prefix, suffix);
      if (known !== undefined) return known ? item(known) : none;
      refreshDebounce();
      await new Promise((r) => setTimeout(r, debounce));
      if (token.isCancellationRequested) return none;
      const rid = newRequestId();
      const sub = token.onCancellationRequested(() => void api().ai.abort(rid));
      try {
        const text = await api().ai.complete(rid, {
          path,
          language: languageFor(path),
          prefix,
          suffix,
        });
        if (token.isCancellationRequested) return none;
        // Empty answers are not kept: they may be a provider error, worth asking again.
        if (text) cache.put(path, prefix, suffix, text);
        return text ? item(text) : none;
      } catch {
        return none;
      } finally {
        sub.dispose();
      }
    },
    disposeInlineCompletions() {},
  });
}
