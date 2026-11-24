import { createElement, memo, useState, type ReactNode } from 'react';
import { Markdown } from '../Markdown';
import { openLink } from '../../links';
import {
  mimeText,
  pickMime,
  stripAnsi,
  type JsonObject,
  type NbOutput,
} from '../../../shared/notebook';
import { tn } from './notebookStrings';
import { Icon } from '../Icon';
import { AnsiText } from './Ansi';

/** What the view can show, richest first (widgets fall back to their text). */
const SUPPORTED = [
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'text/markdown',
  'text/latex',
  'application/json',
  'text/plain',
] as const;

// ------------------------------------------------------------------ safe HTML

/** Tags kept from HTML outputs (pandas tables, simple rich reprs). Everything else: its text. */
const TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'div',
  'span',
  'p',
  'br',
  'hr',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'code',
  'pre',
  'kbd',
  'samp',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'details',
  'summary',
  'img',
  'a',
]);
/** Dropped with their content. */
const DROP = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'template',
  'noscript',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'textarea',
]);

function convert(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag)) return null;
  const kids = [...el.childNodes].map((n, i) => convert(n, i));
  if (!TAGS.has(tag)) return kids.length ? createElement('span', { key }, ...kids) : null;
  const props: Record<string, unknown> = { key };
  const span = (name: string) => {
    const v = Number(el.getAttribute(name));
    if (Number.isInteger(v) && v > 0 && v < 1000)
      props[name === 'colspan' ? 'colSpan' : 'rowSpan'] = v;
  };
  if (tag === 'td' || tag === 'th') {
    span('colspan');
    span('rowspan');
  }
  if (tag === 'img') {
    // Only pictures embedded in the output itself; nothing is fetched from the network.
    const src = el.getAttribute('src') ?? '';
    if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) return null;
    props.src = src;
    props.alt = el.getAttribute('alt') ?? '';
    return createElement('img', props);
  }
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      props.href = href;
      props.onClick = (e: MouseEvent) => {
        e.preventDefault();
        openLink(href);
      };
    }
  }
  if (tag === 'br' || tag === 'hr' || tag === 'col') return createElement(tag, props);
  return createElement(tag, props, ...kids);
}

/** HTML of an output as React elements: no scripts, styles, events or remote resources. */
export const SafeHtml = memo(function SafeHtml({ html }: { html: string }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return <div className="nb-html">{[...doc.body.childNodes].map((n, i) => convert(n, i))}</div>;
});

// ------------------------------------------------------------------ outputs

function DataView({ data, metadata }: { data: JsonObject; metadata: JsonObject }) {
  const mime = pickMime(data, SUPPORTED);
  const widget = 'application/vnd.jupyter.widget-view+json' in data;
  if (!mime) return widget ? <div className="nb-out-note">{tn('widget')}</div> : null;
  const value = data[mime];
  const text = mimeText(value);
  const meta = (metadata[mime] ?? {}) as { width?: number; height?: number };
  const size = {
    ...(typeof meta.width === 'number' ? { width: meta.width } : {}),
    ...(typeof meta.height === 'number' ? { height: meta.height } : {}),
  };
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif')
    return (
      <img
        className="nb-img"
        alt=""
        src={`data:${mime};base64,${text.replace(/\s+/g, '')}`}
        {...size}
      />
    );
  if (mime === 'image/svg+xml')
    // As an <img>, an SVG cannot run script.
    return (
      <img
        className="nb-img"
        alt=""
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`}
        {...size}
      />
    );
  if (mime === 'text/html') return <SafeHtml html={text} />;
  if (mime === 'text/markdown')
    return (
      <div className="nb-md">
        <Markdown text={text} />
      </div>
    );
  if (mime === 'application/json')
    return <pre className="nb-pre">{JSON.stringify(value, null, 2)}</pre>;
  return (
    <>
      {widget && <div className="nb-out-note">{tn('widget')}</div>}
      <pre className="nb-pre">
        <AnsiText text={text} />
      </pre>
    </>
  );
}

/** Longest stream text drawn at once (a runaway print loop would freeze the view). */
const MAX_STREAM = 200_000;

function StreamText({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  if (all || text.length <= MAX_STREAM) return <AnsiText text={text} />;
  return (
    <>
      <button className="nb-more" onClick={() => setAll(true)}>
        {tn('showAll', { n: Math.round(text.length / 1000) })}
      </button>
      {'\n…\n'}
      <AnsiText text={text.slice(text.length - MAX_STREAM)} />
    </>
  );
}

export const OutputView = memo(function OutputView({
  o,
  onFix,
}: {
  o: NbOutput;
  onFix?: () => void;
}) {
  if (o.output_type === 'stream')
    return (
      <pre className={`nb-pre ${o.name === 'stderr' ? 'nb-stderr' : ''}`}>
        <StreamText text={o.text} />
      </pre>
    );
  if (o.output_type === 'error')
    return (
      <div className="nb-error-box">
        <pre className="nb-pre nb-error">
          {o.traceback.length ? (
            <AnsiText text={o.traceback.join('\n')} />
          ) : (
            `${o.ename}: ${o.evalue}`
          )}
        </pre>
        {onFix && (
          <div className="nb-error-actions">
            <button className="btn" onClick={onFix} title={tn('fixAiTip')}>
              <Icon name="sparkle" size={14} /> {tn('fixAi')}
            </button>
            <button
              className="btn ghost"
              onClick={() =>
                void navigator.clipboard.writeText(
                  stripAnsi(o.traceback.join('\n')) || `${o.ename}: ${o.evalue}`,
                )
              }
            >
              {tn('copyError')}
            </button>
          </div>
        )}
      </div>
    );
  return <DataView data={o.data} metadata={o.metadata} />;
});
