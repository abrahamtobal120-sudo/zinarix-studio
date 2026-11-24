/**
 * Source map of a plain HTML file for the visual editor (Panel de Edición): a tolerant
 * tokenizer that numbers every element in document order and remembers where its start tag,
 * content and end tag are in the text. The preview gets the same numbers as
 * data-zx-src="file#N" attributes (added only to what is served, never to the file), so a
 * click in the preview knows the exact node to change, and edits rewrite only that span:
 * the rest of the file keeps its formatting byte for byte.
 */

export interface HtmlNode {
  /** Order of the start tag in the file (0-based). */
  index: number;
  tag: string;
  /** [start, end) of the start tag, "<" to ">" inclusive. */
  open: [number, number];
  /** [start, end) between the start and end tags; null for void/self-closed elements. */
  content: [number, number] | null;
  /** [start, end) of the end tag; null when there is none (void, implied or missing). */
  close: [number, number] | null;
  attrs: HtmlAttr[];
  parent: number | null;
  children: number[];
}

export interface HtmlAttr {
  name: string;
  value: string | null;
  /** [start, end) of the whole attribute (name="value"). */
  span: [number, number];
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
/** Elements whose content is raw text (a "<" inside is not a tag). */
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template', 'xmp']);
/** An open element of the key is closed implicitly when one of these starts. */
const IMPLIED_END: Record<string, Set<string>> = {
  p: new Set([
    'p',
    'div',
    'ul',
    'ol',
    'table',
    'section',
    'article',
    'header',
    'footer',
    'nav',
    'aside',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'pre',
    'blockquote',
    'hr',
    'main',
    'figure',
    'dl',
  ]),
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  option: new Set(['option', 'optgroup']),
  tr: new Set(['tr', 'tbody', 'tfoot']),
  td: new Set(['td', 'th', 'tr']),
  th: new Set(['td', 'th', 'tr']),
};

/** Inline tags kept when edited text comes back from the preview (everything else is text). */
export const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'code',
  'em',
  'i',
  'kbd',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
]);

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(src: string, from: number, to: number): HtmlAttr[] {
  const out: HtmlAttr[] = [];
  const body = src.slice(from, to);
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(body))) {
    out.push({
      name: m[1]!.toLowerCase(),
      value: m[2] ?? m[3] ?? m[4] ?? null,
      span: [from + m.index, from + m.index + m[0].length],
    });
  }
  return out;
}

/** End of a tag starting at `i` ("<"), skipping ">" inside quoted attribute values. */
function tagEnd(src: string, i: number): number {
  let quote = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return j + 1;
  }
  return -1;
}

/** Every element of an HTML document, in the order its start tag appears. */
export function parseHtml(src: string): HtmlNode[] {
  const nodes: HtmlNode[] = [];
  const stack: HtmlNode[] = [];
  const closeTop = (end: number, closeTag: [number, number] | null) => {
    const n = stack.pop()!;
    n.content = [n.open[1], end];
    n.close = closeTag;
  };
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const end = src.indexOf('>', lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(src.slice(lt, lt + 200));
      if (!m) {
        i = lt + 2;
        continue;
      }
      const name = m[1]!.toLowerCase();
      const end = lt + m[0].length;
      const at = stack.map((n) => n.tag).lastIndexOf(name);
      if (at >= 0) {
        // Elements left open inside (a missing </span>) end where their parent ends.
        while (stack.length > at + 1) closeTop(lt, null);
        closeTop(lt, [lt, end]);
      }
      i = end;
      continue;
    }
    const m = /^<([a-zA-Z][\w:-]*)/.exec(src.slice(lt, lt + 100));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const end = tagEnd(src, lt);
    if (end < 0) break;
    const tag = m[1]!.toLowerCase();
    // <p> ends when a block starts, <li> when the next <li> starts, and so on.
    while (stack.length && IMPLIED_END[stack.at(-1)!.tag]?.has(tag)) closeTop(lt, null);
    const selfClosed = src[end - 2] === '/';
    const parent = stack.at(-1) ?? null;
    const node: HtmlNode = {
      index: nodes.length,
      tag,
      open: [lt, end],
      content: null,
      close: null,
      attrs: parseAttrs(src, lt + 1 + m[1]!.length, selfClosed ? end - 2 : end - 1),
      parent: parent ? parent.index : null,
      children: [],
    };
    nodes.push(node);
    parent?.children.push(node.index);
    i = end;
    if (VOID.has(tag) || selfClosed) continue;
    if (RAW.has(tag)) {
      const re = new RegExp(`</${tag}\\s*>`, 'ig');
      re.lastIndex = end;
      const close = re.exec(src);
      const cEnd = close ? close.index : src.length;
      node.content = [end, cEnd];
      node.close = close ? [close.index, close.index + close[0].length] : null;
      i = close ? close.index + close[0].length : src.length;
      continue;
    }
    stack.push(node);
  }
  while (stack.length) closeTop(src.length, null);
  return nodes;
}

/** Attribute that tells the preview which node of which file an element is. */
export const SRC_ATTR = 'data-zx-src';

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The page as served to the preview: each start tag gets data-zx-src="file#N". Only the
 * served copy carries it; files on disk never do.
 */
export function annotate(src: string, file: string): string {
  const nodes = parseHtml(src);
  let out = '';
  let last = 0;
  for (const n of nodes) {
    const selfClosed = src[n.open[1] - 2] === '/';
    const at = selfClosed ? n.open[1] - 2 : n.open[1] - 1;
    out += `${src.slice(last, at)} ${SRC_ATTR}="${escAttr(`${file}#${n.index}`)}"`;
    last = at;
  }
  return out + src.slice(last);
}

/** Removes any data-zx-* attribute (a safety net: they must never reach a file). */
export function stripMarkers(html: string): string {
  return html.replace(/\s+data-zx-[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g, '');
}

// ---------------------------------------------------------------- edits

export class EditError extends Error {}

function nodeAt(src: string, index: number): HtmlNode {
  const n = parseHtml(src)[index];
  if (!n) throw new EditError('El elemento ya no existe en el archivo.');
  return n;
}

/** True when the element only holds text and inline formatting (safe to edit in place). */
export function isTextNode(src: string, index: number): boolean {
  const nodes = parseHtml(src);
  const n = nodes[index];
  if (!n || !n.content || VOID.has(n.tag) || RAW.has(n.tag)) return false;
  const inline = (k: number): boolean => {
    const c = nodes[k]!;
    return INLINE_TAGS.has(c.tag) && c.children.every(inline);
  };
  return n.children.every(inline);
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SAFE_ATTRS = new Set(['href', 'title', 'class', 'target', 'rel', 'lang', 'dir', 'datetime']);

/**
 * Cleans the HTML of an edited text before it is written: only inline formatting tags stay
 * (with harmless attributes), scripts and event handlers are dropped, any other tag keeps
 * just its text.
 */
export function sanitizeInline(html: string): string {
  const src = stripMarkers(html);
  let out = '';
  let i = 0;
  const open: string[] = [];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, lt);
    const end = tagEnd(src, lt);
    if (end < 0) {
      out += escText(src.slice(lt));
      break;
    }
    const raw = src.slice(lt, end);
    i = end;
    const close = /^<\/([a-zA-Z][\w-]*)/.exec(raw);
    if (close) {
      const name = close[1]!.toLowerCase();
      const at = open.lastIndexOf(name);
      if (at >= 0) {
        while (open.length > at) out += `</${open.pop()}>`;
      }
      continue;
    }
    const m = /^<([a-zA-Z][\w-]*)/.exec(raw);
    if (!m) continue; // comments and the like
    const name = m[1]!.toLowerCase();
    if (name === 'script' || name === 'style') {
      const re = new RegExp(`</${name}\\s*>`, 'ig');
      re.lastIndex = i;
      const c = re.exec(src);
      i = c ? c.index + c[0].length : src.length;
      continue;
    }
    if (!INLINE_TAGS.has(name)) continue;
    const attrs = parseAttrs(raw, m[0].length, raw.length - 1)
      .filter((a) => SAFE_ATTRS.has(a.name) && a.value !== null)
      .filter((a) => a.name !== 'href' || !/^\s*(javascript|data|vbscript):/i.test(a.value!))
      .map((a) => ` ${a.name}="${escAttr(a.value!)}"`)
      .join('');
    if (name === 'br') out += `<br${attrs}>`;
    else {
      out += `<${name}${attrs}>`;
      open.push(name);
    }
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** New content of a text element (inline formatting allowed, see sanitizeInline). */
export function setText(src: string, index: number, html: string): string {
  const n = nodeAt(src, index);
  if (!isTextNode(src, index) || !n.content)
    throw new EditError(
      'Este elemento tiene otros elementos dentro y no se puede escribir encima.',
    );
  return src.slice(0, n.content[0]) + sanitizeInline(html) + src.slice(n.content[1]);
}

/** CSS properties the panel may write, in plain words for the person using it. */
export const STYLE_PROPS = new Set([
  'color',
  'background-color',
  'background',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'text-decoration',
  'text-align',
  'text-transform',
  'line-height',
  'letter-spacing',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border-radius',
  'border',
  'width',
  'height',
  'max-width',
  'opacity',
  'box-shadow',
]);

/** A value that cannot break out of a style attribute or load anything. */
export function safeCssValue(v: string): boolean {
  return (
    v.length <= 200 &&
    /^[#\w\s.,%()+\-/'"]*$/.test(v) &&
    !/url\s*\(|expression|javascript:|@import|\\/i.test(v) &&
    !/"/.test(v.replace(/'[^']*'/g, ''))
  );
}

/** Declarations of a style attribute, in order. */
export function parseStyle(style: string): [string, string][] {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .flatMap((d) => {
      const at = d.indexOf(':');
      return at > 0
        ? [[d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim()] as [string, string]]
        : [];
    });
}

/**
 * Sets (or with null, removes) properties in the element's style attribute. The attribute
 * is created when missing and removed when it ends up empty.
 */
export function setStyle(
  src: string,
  index: number,
  styles: Record<string, string | null>,
): string {
  const n = nodeAt(src, index);
  for (const [k, v] of Object.entries(styles)) {
    if (!STYLE_PROPS.has(k)) throw new EditError(`No se puede cambiar "${k}".`);
    if (v !== null && !safeCssValue(v)) throw new EditError(`El valor "${v}" no es válido.`);
  }
  const attr = n.attrs.find((a) => a.name === 'style');
  const decls = parseStyle(attr?.value ?? '');
  for (const [k, v] of Object.entries(styles)) {
    const at = decls.findIndex(([p]) => p === k);
    if (v === null || v === '') {
      if (at >= 0) decls.splice(at, 1);
    } else if (at >= 0) decls[at] = [k, v];
    else decls.push([k, v]);
  }
  const value = decls.map(([k, v]) => `${k}: ${v}`).join('; ');
  const text = value ? `style="${value.replace(/"/g, "'")}"` : '';
  if (attr) {
    // Removing the attribute also removes the space before it.
    let from = attr.span[0];
    if (!text) while (from > 0 && /\s/.test(src[from - 1]!)) from--;
    return src.slice(0, from) + text + src.slice(attr.span[1]);
  }
  if (!text) return src;
  const selfClosed = src[n.open[1] - 2] === '/';
  const at = selfClosed ? n.open[1] - 2 : n.open[1] - 1;
  // "<img src=x />": the new attribute goes before the slash, with one space.
  const before = src.slice(0, at).replace(/\s+$/, '');
  return `${before} ${text}${selfClosed ? ' ' : ''}${src.slice(at)}`;
}

/** Number of elements and their tags: an edit of text or style must keep both. */
export function shape(src: string): string {
  return parseHtml(src)
    .map((n) => n.tag)
    .join(',');
}
