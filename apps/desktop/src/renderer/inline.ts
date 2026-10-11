import { languageFor, monaco } from './monaco';
import { api, getEditor, getState, newRequestId } from './store';

/** Pause after the last keystroke before asking the model (keeps token use low). */
const DEBOUNCE_MS = 550;

let registered = false;

/**
 * AI autocomplete (ghost text, Tab to accept), like Copilot. Uses the model assigned to the
 * "inline" role (or the default one). Off unless enabled in Settings.
 */
export function registerInlineCompletions(): void {
  if (registered) return;
  registered = true;
  monaco.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model, position, _context, token) {
      const none = { items: [] };
      const st = getState();
      if (!st.prefs.inlineCompletions) return none;
      if (model !== getEditor()?.getModel() || model.uri.scheme !== 'file') return none;
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
      if (token.isCancellationRequested) return none;
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
      if (!prefix.trim()) return none;
      const path = model.uri.path.replace(/^\//, '');
      const rid = newRequestId();
      const sub = token.onCancellationRequested(() => void api().ai.abort(rid));
      try {
        const text = await api().ai.complete(rid, {
          path,
          language: languageFor(path),
          prefix,
          suffix,
        });
        if (!text || token.isCancellationRequested) return none;
        return {
          items: [
            {
              insertText: text,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
            },
          ],
        };
      } catch {
        return none;
      } finally {
        sub.dispose();
      }
    },
    disposeInlineCompletions() {},
  });
}
