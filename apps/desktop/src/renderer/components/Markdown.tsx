import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { getEditor, setState, toast } from '../store';
import { fileIcon } from './icons';
import { Icon } from './Icon';
import { runInTerminal } from './Terminal';

/**
 * Minimal, injection-safe Markdown: builds React elements (no innerHTML), so model output
 * can never execute script in the renderer. Supports fences, headings, lists, quotes, tables,
 * inline code, bold, italics and links (opened externally, https only).
 */
export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      const code = readFence(lines, i);
      i = code.next;
      blocks.push(
        <CodeBlock
          key={key++}
          lang={code.lang}
          code={code.text}
          done={code.closed || !streaming}
        />,
      );
      continue;
    }
    if (HR.test(line)) {
      blocks.push(<hr key={key++} className="md-hr" />);
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <div key={key++} className={`md-h md-h${h[1]!.length}`}>
          {inline(h[2]!)}
        </div>,
      );
      i++;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const list = readList(lines, i, indentOf(line));
      i = list.next;
      blocks.push(<List key={key++} list={list} streaming={streaming} />);
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={key++} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>
                    <div className="md-cell">{inline(c)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j}>
                  {head.map((_, k) => (
                    <td key={k}>
                      <div className="md-cell">{inline(r[k] ?? '')}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key++}>{inline(q.join(' '))}</blockquote>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^\s*```/.test(lines[i]!) &&
      !/^(#{1,6})\s/.test(lines[i]!) &&
      !LIST_ITEM.test(lines[i]!) &&
      !HR.test(lines[i]!) &&
      !/^>\s?/.test(lines[i]!) &&
      !(TABLE_ROW.test(lines[i]!) && TABLE_SEP.test(lines[i + 1] ?? ''))
    )
      para.push(lines[i++]!);
    blocks.push(<p key={key++}>{inline(para.join('\n'))}</p>);
  }
  return <div className="md">{blocks}</div>;
}

const FENCE = /^(\s*)```\s*([\w+#.-]*)\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

const indentOf = (line: string) => /^\s*/.exec(line)![0].replace(/\t/g, '    ').length;

/** A ``` fence starting at `start`; the body loses the fence's own indentation (fences inside lists). */
function readFence(lines: string[], start: number) {
  const [, pad = '', lang = ''] = FENCE.exec(lines[start]!)!;
  const code: string[] = [];
  let i = start + 1;
  while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) {
    const l = lines[i++]!;
    code.push(l.startsWith(pad) ? l.slice(pad.length) : l.trimStart());
  }
  const closed = i < lines.length;
  return { lang, text: code.join('\n'), closed, next: closed ? i + 1 : i };
}

type Fence = ReturnType<typeof readFence>;
/** What follows an item's first line: more text, a nested list or a code block. */
type ItemPart = { text: string } | { list: ParsedList } | { fence: Fence };
type ListItem = { text: string; parts: ItemPart[] };
type ParsedList = { ordered: boolean; start: number; items: ListItem[]; next: number };

/**
 * A list at `indent`: deeper items become nested lists, indented text continues the item and
 * indented fences stay inside it, so "1. … ```code``` 2. …" keeps its numbering.
 */
function readList(lines: string[], start: number, indent: number): ParsedList {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const ordered = /\d/.test(first[2]!);
  const list: ParsedList = {
    ordered,
    start: ordered ? parseInt(first[2]!, 10) : 1,
    items: [],
    next: start,
  };
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = LIST_ITEM.exec(line);
    const ind = indentOf(line);
    if (m && ind === indent) {
      if (/\d/.test(m[2]!) !== ordered) break;
      list.items.push({ text: m[3]!, parts: [] });
      i++;
      continue;
    }
    const item = list.items[list.items.length - 1];
    if (!item) break;
    if (m && ind > indent) {
      const sub = readList(lines, i, ind);
      item.parts.push({ list: sub });
      i = sub.next;
      continue;
    }
    if (!line.trim()) {
      // A blank line ends the list unless the next line is still part of it.
      const nxt = lines[i + 1];
      if (
        nxt !== undefined &&
        nxt.trim() &&
        (indentOf(nxt) > indent || (LIST_ITEM.test(nxt) && indentOf(nxt) === indent))
      ) {
        i++;
        continue;
      }
      break;
    }
    if (ind <= indent) break;
    if (FENCE.test(line)) {
      const fence = readFence(lines, i);
      item.parts.push({ fence });
      i = fence.next;
      continue;
    }
    item.parts.push({ text: line.trim() });
    i++;
  }
  list.next = i;
  return list;
}

function List({ list, streaming }: { list: ParsedList; streaming?: boolean }) {
  const items = list.items.map((it, j) => (
    <li key={j}>
      {inline(it.text)}
      {it.parts.map((part, k) =>
        'list' in part ? (
          <List key={k} list={part.list} streaming={streaming} />
        ) : 'fence' in part ? (
          <CodeBlock
            key={k}
            lang={part.fence.lang}
            code={part.fence.text}
            done={part.fence.closed || !streaming}
          />
        ) : (
          <div key={k} className="md-li-text">
            {inline(part.text)}
          </div>
        ),
      )}
    </li>
  ));
  return list.ordered ? (
    <ol className="md-list" start={list.start}>
      {items}
    </ol>
  ) : (
    <ul className="md-list">{items}</ul>
  );
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** "| a | b |" → ["a", "b"] */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\(https:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    const s = m[0];
    if (m[1]) out.push(<code key={k++}>{s.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{s.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k++}>{s.slice(1, -1)}</em>);
    else {
      const [, label, url] = /\[([^\]]+)\]\(([^)]+)\)/.exec(s)!;
      out.push(
        <a
          key={k++}
          href="#"
          onClick={(e) => (e.preventDefault(), void window.omni.app.openExternal(url!))}
        >
          {label}
        </a>,
      );
    }
    last = m.index + s.length;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return out;
}

/** Fence names → file extension, so the code header shows the right file badge. */
const LANG_EXT: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  rust: 'rs',
  golang: 'go',
  ruby: 'rb',
  csharp: 'cs',
  'c++': 'cpp',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  console: 'sh',
  powershell: 'ps1',
  markdown: 'md',
  yaml: 'yml',
  dockerfile: 'dockerfile',
  text: 'txt',
  '': 'txt',
};

const SHELL = /^(bash|sh|shell|zsh|console|terminal|powershell|ps1|cmd)$/i;

function CodeBlock({ lang, code, done }: { lang: string; code: string; done: boolean }) {
  const [copied, setCopied] = useState(false);
  const insert = (replaceSelection: boolean) => {
    const ed = getEditor();
    const model = ed?.getModel();
    if (!ed || !model) return toast(t('noFolder'));
    const sel = ed.getSelection();
    if (!sel) return;
    const range = replaceSelection
      ? sel
      : {
          startLineNumber: sel.positionLineNumber,
          startColumn: sel.positionColumn,
          endLineNumber: sel.positionLineNumber,
          endColumn: sel.positionColumn,
        };
    ed.executeEdits('omni-chat', [{ range, text: code, forceMoveMarkers: true }]);
    ed.pushUndoStop();
    ed.focus();
  };
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">
          {fileIcon(`x.${LANG_EXT[lang.toLowerCase()] ?? lang.toLowerCase()}`)}
          {lang || 'text'}
        </span>
        {done && (
          <span className="code-actions">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              <Icon name={copied ? 'check' : 'copy'} size={12} />
              {copied ? t('copied') : t('copy')}
            </button>
            <button onClick={() => insert(false)}>
              <Icon name="insert" size={12} />
              {t('insert')}
            </button>
            <button onClick={() => insert(true)}>
              <Icon name="replace" size={12} />
              {t('replaceSel')}
            </button>
            {SHELL.test(lang) && (
              <button
                onClick={() => {
                  if (!confirm(t('confirmRun', { cmd: code }))) return;
                  setState({ panelOpen: true });
                  setTimeout(() => void runInTerminal(code), 300);
                }}
              >
                <Icon name="play" size={12} />
                {t('runInTerminal')}
              </button>
            )}
          </span>
        )}
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
