import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    return new EditorWorker();
  },
};

export { monaco };

const EXT_LANG: Record<string, string> = {};
for (const lang of monaco.languages.getLanguages()) {
  for (const ext of lang.extensions ?? []) EXT_LANG[ext.toLowerCase()] ??= lang.id;
  for (const name of lang.filenames ?? []) EXT_LANG[name.toLowerCase()] ??= lang.id;
}

export function languageFor(path: string): string {
  const name = path.split('/').pop()!.toLowerCase();
  if (EXT_LANG[name]) return EXT_LANG[name]!;
  const dot = name.lastIndexOf('.');
  return (dot >= 0 && EXT_LANG[name.slice(dot)]) || 'plaintext';
}
