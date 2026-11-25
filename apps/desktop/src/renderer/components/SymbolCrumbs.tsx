import { useEffect, useState } from 'react';
import { symbolChain, type SymbolNode } from '../../shared/symbolPath';
import { t } from '../i18n';
import { monaco } from '../monaco';
import { getMainEditor, setState, useStore } from '../store';

type Editor = monaco.editor.IStandaloneCodeEditor;

/** Symbol tree of the editor's file, from whatever provider Monaco has (TS worker, LSP…). */
export async function documentSymbols(ed: Editor | null): Promise<SymbolNode[]> {
  const model = ed?.getModel();
  if (!ed || !model) return [];
  // Monaco registers this command (its outline uses it); the editor's command service is the
  // only way to reach it from the standalone API.
  const svc = (
    ed as unknown as {
      _commandService?: { executeCommand(id: string, ...args: unknown[]): Promise<unknown> };
    }
  )._commandService;
  try {
    return ((await svc?.executeCommand('_executeDocumentSymbolProvider', model.uri)) ??
      []) as SymbolNode[];
  } catch {
    return [];
  }
}

/**
 * The symbols of the file open in the main editor, kept fresh while it is edited. Empty while
 * `enabled` is false or the editor shows another file (a viewer tab, a tab switch in flight).
 */
export function useDocumentSymbols(path: string | null, enabled = true): SymbolNode[] {
  const [symbols, setSymbols] = useState<SymbolNode[]>([]);

  useEffect(() => {
    setSymbols([]);
    if (!path || !enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const uri = monaco.Uri.from({ scheme: 'file', path: `/${path}` }).toString();
    const load = (wait: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const ed = getMainEditor();
        if (ed?.getModel()?.uri.toString() !== uri) return void (live && setSymbols([]));
        void documentSymbols(ed).then((s) => live && setSymbols(s));
      }, wait);
    };
    // The language worker may still be starting when the file opens: ask again a bit later.
    load(150);
    const again = setTimeout(() => load(0), 2500);
    const sub = getMainEditor()?.onDidChangeModelContent(() => load(600));
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(again);
      sub?.dispose();
    };
  }, [path, enabled]);

  return symbols;
}

/**
 * B7: the symbols around the cursor (class › method), after the path in the breadcrumbs.
 * A click opens the list of symbols of the file.
 */
export function SymbolCrumbs({ path }: { path: string }) {
  // The cursor in the store follows the focused group; these crumbs describe the main one.
  const cursor = useStore((s) => (s.editorFocus === 1 && s.split ? null : s.cursor));
  const symbols = useDocumentSymbols(path);

  const chain = cursor ? symbolChain(symbols, cursor.line, cursor.column) : [];
  if (!chain.length) return null;
  return (
    <button
      className="crumb-symbols"
      title={t('crumbSymbols')}
      onClick={() => setState({ modal: { kind: 'symbols' } })}
    >
      {chain.map((s, i) => (
        <span key={`${i}:${s.name}`}>
          <span className="crumb-sep" aria-hidden="true">
            ›
          </span>
          {s.name}
        </span>
      ))}
    </button>
  );
}
