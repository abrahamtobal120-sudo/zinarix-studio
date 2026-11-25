import { useEffect, useMemo, useState } from 'react';
import { fenceLanguage, toCodeTokens } from './highlightKinds';
import type { CodeToken } from './highlightKinds';
import { monaco } from './monaco';

/**
 * Code colours in the chat (estudio, punto C6), with the tokenizers the editor already ships.
 * Tokens become React spans (no innerHTML), like the rest of the chat's Markdown.
 */

/** Longer blocks stay plain: colouring them on every streamed chunk would cost frames. */
const MAX_CHARS = 40_000;
const MAX_STREAMING_CHARS = 8_000;

let known: Set<string> | null = null;
const languages = () => (known ??= new Set(monaco.languages.getLanguages().map((l) => l.id)));

/** Languages whose tokenizer finished loading (Monaco loads each on first use). */
const ready = new Set<string>();
const loading = new Map<string, Promise<void>>();

function load(id: string): Promise<void> {
  let p = loading.get(id);
  if (!p) {
    // colorize() waits for the language's tokenizer; tokenize() alone would not.
    p = monaco.editor.colorize('', id, {}).then(
      () => void ready.add(id),
      () => undefined,
    );
    loading.set(id, p);
  }
  return p;
}

/** Lines of coloured tokens for a code block, or null while there is nothing to colour. */
export function useCodeTokens(
  fence: string,
  code: string,
  streaming: boolean,
): CodeToken[][] | null {
  const id = fenceLanguage(fence, languages());
  const [, setLoaded] = useState(0);
  const isReady = id !== '' && ready.has(id);
  useEffect(() => {
    if (!id || ready.has(id)) return;
    let alive = true;
    void load(id).then(() => alive && setLoaded((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [id]);
  return useMemo(() => {
    if (!isReady || code.length > (streaming ? MAX_STREAMING_CHARS : MAX_CHARS)) return null;
    try {
      return toCodeTokens(code, monaco.editor.tokenize(code, id));
    } catch {
      return null;
    }
  }, [isReady, id, code, streaming]);
}
