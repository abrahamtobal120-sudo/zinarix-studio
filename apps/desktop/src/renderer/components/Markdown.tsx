import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { getEditor, setState, toast } from '../store';
import { runInTerminal } from './Terminal';

/**
 * Minimal, injection-safe Markdown: builds React elements (no innerHTML), so model output
 * can never execute script in the renderer. Supports fences, headings, lists, quotes,
 * inline code, bold, italics and links (opened externally, https only).
 */
export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? '';
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      const closed = i < lines.length;
      i++;
      blocks.push(
        <CodeBlock key={key++} lang={lang} code={code.join('\n')} done={closed || !streaming} />,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <div key={key++} className={`md-h md-h${h[1]!.length}`}>
          {inline(h[2]!)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i]!))
        items.push(lines[i++]!.replace(/^\s*([-*+]|\d+\.)\s+/, ''));
      blocks.push(
        <ul key={key++} className="md-list">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>,
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
      !/^(#{1,4})\s/.test(lines[i]!) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)
    )
      para.push(lines[i++]!);
    blocks.push(<p key={key++}>{inline(para.join('\n'))}</p>);
  }
  return <div className="md">{blocks}</div>;
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
        <span>{lang || 'text'}</span>
        {done && (
          <span className="code-actions">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? t('copied') : t('copy')}
            </button>
            <button onClick={() => insert(false)}>{t('insert')}</button>
            <button onClick={() => insert(true)}>{t('replaceSel')}</button>
            {SHELL.test(lang) && (
              <button
                onClick={() => {
                  if (!confirm(t('confirmRun', { cmd: code }))) return;
                  setState({ panelOpen: true });
                  setTimeout(() => void runInTerminal(code), 300);
                }}
              >
                ▶ {t('runInTerminal')}
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
