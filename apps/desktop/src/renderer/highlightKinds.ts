/**
 * Code colours in the chat (estudio, punto C6): turns Monaco's token types into the few
 * kinds the chat styles. Kept apart from highlight.ts so it can be tested without Monaco.
 */

export type CodeKind =
  'comment' | 'string' | 'keyword' | 'number' | 'type' | 'tag' | 'attr' | 'regexp' | '';

export interface CodeToken {
  text: string;
  kind: CodeKind;
}

/** Monaco token type ("keyword.ts", "string.key.json", "attribute.name.html") → kind. */
export function kindOf(type: string): CodeKind {
  const t = type.toLowerCase();
  if (t.startsWith('comment')) return 'comment';
  if (t.startsWith('regexp')) return 'regexp';
  // JSON and YAML keys read better as names than as strings.
  if (t.startsWith('string.key') || t.startsWith('attribute.name')) return 'attr';
  if (t.startsWith('string') || t.startsWith('attribute.value')) return 'string';
  if (t.startsWith('keyword') || t.startsWith('storage')) return 'keyword';
  if (t.startsWith('number') || t.startsWith('constant')) return 'number';
  if (t.startsWith('type') || t.startsWith('annotation') || t.startsWith('namespace'))
    return 'type';
  if (t.startsWith('tag') || t.startsWith('metatag')) return 'tag';
  return '';
}

/**
 * Cuts each line at Monaco's token offsets and merges neighbours of the same kind, so the
 * chat renders a handful of spans per line instead of one per bracket.
 */
export function toCodeTokens(
  code: string,
  lines: readonly (readonly { offset: number; type: string }[])[],
): CodeToken[][] {
  return code.split('\n').map((line, i) => {
    const marks = lines[i] ?? [];
    const out: CodeToken[] = [];
    const push = (text: string, kind: CodeKind) => {
      if (!text) return;
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.text += text;
      else out.push({ text, kind });
    };
    if (!marks.length) push(line, '');
    marks.forEach((m, j) => {
      if (j === 0 && m.offset > 0) push(line.slice(0, m.offset), '');
      push(line.slice(m.offset, marks[j + 1]?.offset ?? line.length), kindOf(m.type));
    });
    return out;
  });
}

/** Names models write after ``` that are not a Monaco language id or a file extension. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  console: 'shell',
  terminal: 'shell',
  ps1: 'powershell',
  pwsh: 'powershell',
  cmd: 'bat',
  batch: 'bat',
  yml: 'yaml',
  md: 'markdown',
  docker: 'dockerfile',
  jsonc: 'json',
  json5: 'json',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  svg: 'xml',
  toml: 'ini',
  env: 'ini',
  kt: 'kotlin',
  gd: 'gdscript',
  tf: 'hcl',
  patch: 'diff',
  text: '',
  txt: '',
  plaintext: '',
  plain: '',
  output: '',
  log: '',
};

/** The Monaco language of a fence name, or '' when there is nothing to colour. */
export function fenceLanguage(fence: string, known: ReadonlySet<string>): string {
  const name = fence.trim().toLowerCase();
  if (!name) return '';
  const id = name in ALIASES ? ALIASES[name]! : name;
  return known.has(id) ? id : '';
}
