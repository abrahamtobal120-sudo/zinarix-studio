import { monaco } from '../../monaco';
import { api } from '../../store';
import { getDoc } from './notebookModel';

/**
 * Completions and hover docs in the cells of a notebook, from its running kernel (Jupyter's
 * complete_request / inspect_request), like JupyterLab: the kernel knows the variables, imports
 * and objects of what already ran. Only the cells' own models (scheme "nbcell") ask, and only
 * while no cell is running (a kernel busy with a cell answers after it, too late to be useful).
 */

const KIND: Record<string, monaco.languages.CompletionItemKind> = {};
function kindOf(type: string | undefined): monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  if (!Object.keys(KIND).length)
    Object.assign(KIND, {
      function: K.Function,
      method: K.Method,
      class: K.Class,
      module: K.Module,
      keyword: K.Keyword,
      instance: K.Variable,
      statement: K.Variable,
      param: K.Variable,
      path: K.File,
      property: K.Property,
      magic: K.Snippet,
    });
  return (type ? KIND[type] : undefined) ?? K.Text;
}

/** The notebook of a cell model (uri nbcell:/<path>#<uid>), when its kernel can answer. */
function notebookOf(model: monaco.editor.ITextModel): string | null {
  if (model.uri.scheme !== 'nbcell') return null;
  const path = model.uri.path.replace(/^\//, '');
  const d = getDoc(path);
  // "busy" with no cell queued = our own quick requests (variables, another completion).
  return d && (d.kernel === 'idle' || (d.kernel === 'busy' && !d.queue.length)) ? path : null;
}

let installed = false;

export function installCellIntellisense(): void {
  if (installed) return;
  installed = true;
  const selector: monaco.languages.LanguageSelector = { scheme: 'nbcell' };

  monaco.languages.registerCompletionItemProvider(selector, {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position, _ctx, token) {
      const path = notebookOf(model);
      if (!path) return { suggestions: [] };
      const code = model.getValue();
      const r = await api()
        .notebook.complete(path, code, model.getOffsetAt(position))
        .catch(() => null);
      if (!r || token.isCancellationRequested || !r.matches.length) return { suggestions: [] };
      const a = model.getPositionAt(r.start);
      const b = model.getPositionAt(r.end);
      const range = new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
      return {
        suggestions: r.matches.slice(0, 500).map((m, i) => ({
          label: m.text,
          kind: kindOf(m.type),
          insertText: m.text,
          range,
          ...(m.signature || m.type ? { detail: m.signature ?? m.type } : {}),
          // The kernel's order (best first), not Monaco's alphabetical one.
          sortText: String(i).padStart(4, '0'),
        })),
      };
    },
  });

  monaco.languages.registerHoverProvider(selector, {
    async provideHover(model, position, token) {
      const path = notebookOf(model);
      const word = model.getWordAtPosition(position);
      if (!path || !word) return null;
      // At the end of the name, the kernel resolves "obj.attr" up to here.
      const at = model.getOffsetAt({ lineNumber: position.lineNumber, column: word.endColumn });
      const text = await api()
        .notebook.inspect(path, model.getValue(), at)
        .catch(() => null);
      if (!text || token.isCancellationRequested) return null;
      return {
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        ),
        contents: [{ value: `\`\`\`text\n${text.replace(/```/g, "'''")}\n\`\`\`` }],
      };
    },
  });
}
