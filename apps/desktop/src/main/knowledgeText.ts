/**
 * Pure text helpers for Zinarix's knowledge features (semantic code search, indexed docs):
 * tokenizing code and prose, chunking, a BM25 ranker, cosine similarity and HTML to text.
 * No I/O here, so it is unit-tested directly (apps/desktop/test/knowledge.test.ts).
 */

export interface Chunk {
  /** Project-relative path (code) or page URL (docs). */
  source: string;
  /** 1-based first and last line of the chunk (code); 0 for docs. */
  start: number;
  end: number;
  text: string;
  /** Page title (docs) — boosts matches, shown in results. */
  title?: string;
}

const STOP = new Set(
  'the a an and or of to in on for is are be by with as at it this that from not no if else then return var let const function def class import export new de la el los las un una y o en por para con que se del al es'.split(
    ' ',
  ),
);

/**
 * Words of a text: identifiers split on camelCase, snake_case, kebab-case and digits
 * ("parseHTTPResponse_v2" → parse, http, response, v2, plus the whole identifier), lowercased.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}_$]+/gu)) {
    const word = m[0];
    if (word.length > 64) continue;
    const lower = word.toLowerCase();
    const parts = word
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_$]+/)
      .map((p) => p.toLowerCase())
      .filter((p) => p.length > 1 && !STOP.has(p));
    for (const p of parts) out.push(stem(p));
    if (parts.length > 1 && !STOP.has(lower)) out.push(lower);
  }
  return out;
}

/** A light stemmer (plural and common suffixes) so "handlers" finds "handler". */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Lines [lo, hi) as overlapping windows: the fallback for text with no structure to cut on. */
function windowRange(
  source: string,
  lines: string[],
  lo: number,
  hi: number,
  size: number,
  out: Chunk[],
): void {
  const step = Math.max(1, size - Math.round(size / 5));
  for (let i = lo; i < hi; i += step) {
    pushRange(source, lines, i, Math.min(hi, i + size), out);
    if (i + size >= hi) break;
  }
}

/** One chunk for lines [lo, hi), without the blank lines around it. */
function pushRange(source: string, lines: string[], lo: number, hi: number, out: Chunk[]): void {
  while (lo < hi && !lines[lo]!.trim()) lo++;
  while (hi > lo && !lines[hi - 1]!.trim()) hi--;
  if (lo >= hi) return;
  out.push({ source, start: lo + 1, end: hi, text: lines.slice(lo, hi).join('\n').slice(0, 8000) });
}

/**
 * Cuts lines [lo, hi) where declarations start: a line at `indent` that follows a blank line
 * and is not a closing bracket. Small neighbours are packed together up to `size` lines; a
 * block that is too long is cut the same way one level deeper (the methods of a class).
 */
function packRange(
  source: string,
  lines: string[],
  lo: number,
  hi: number,
  indent: number,
  size: number,
  depth: number,
  out: Chunk[],
): void {
  if (hi - lo <= size) return pushRange(source, lines, lo, hi, out);
  const starts = [lo];
  for (let i = lo + 1; i < hi; i++) {
    const line = lines[i]!;
    if (!line.trim() || indentOf(line) !== indent || lines[i - 1]!.trim()) continue;
    if (/^([)\]}]|end\b)/.test(line.trimStart())) continue;
    starts.push(i);
  }
  if (starts.length === 1) {
    // One block: look for the next level of indentation that has blank-line separated parts.
    let deeper = Infinity;
    for (let i = lo + 1; i < hi; i++) {
      const line = lines[i]!;
      if (!line.trim() || lines[i - 1]!.trim()) continue;
      const n = indentOf(line);
      if (n > indent && n < deeper) deeper = n;
    }
    if (depth < 6 && deeper !== Infinity) {
      return packRange(source, lines, lo, hi, deeper, size, depth + 1, out);
    }
    return windowRange(source, lines, lo, hi, size, out);
  }
  const max = Math.round(size * 1.5);
  let from = lo;
  for (let b = 0; b < starts.length; b++) {
    const start = starts[b]!;
    const end = starts[b + 1] ?? hi;
    if (end - from <= size) continue;
    // This block does not fit with the ones gathered so far: close them.
    if (start > from) pushRange(source, lines, from, start, out);
    from = start;
    if (end - start > max) {
      packRange(source, lines, start, end, indent, size, depth + 1, out);
      from = end;
    }
  }
  pushRange(source, lines, from, hi, out);
}

/**
 * Splits a source file into chunks that follow its structure (plan A8): functions, classes and
 * top-level paragraphs stay whole instead of being cut every `size` lines, so a search result
 * is a complete piece of code. No parser: it reads indentation and blank lines, which holds for
 * every language formatted the usual way; text without that shape falls back to line windows.
 */
export function chunkCode(source: string, text: string, size = 60): Chunk[] {
  const out: Chunk[] = [];
  if (!text.trim()) return out;
  const lines = text.split('\n');
  packRange(source, lines, 0, lines.length, 0, size, 0, out);
  return out;
}

/** Splits prose (a docs page) into chunks of about `max` characters on paragraph breaks. */
export function chunkProse(source: string, title: string, text: string, max = 1800): Chunk[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Chunk[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) out.push({ source, start: 0, end: 0, text: cur.trim(), title });
    cur = '';
  };
  for (const p of paras) {
    if (cur && cur.length + p.length > max) push();
    if (p.length > max) {
      for (let i = 0; i < p.length; i += max) {
        cur = p.slice(i, i + max);
        push();
      }
    } else cur += (cur ? '\n\n' : '') + p;
  }
  push();
  return out;
}

export interface Bm25Index {
  /** Per chunk: term → count. */
  docs: Record<string, number>[];
  lengths: number[];
  df: Record<string, number>;
  avgLen: number;
}

/** Builds a BM25 index; the source path / page title count as extra (boosted) words. */
export function buildBm25(chunks: Chunk[]): Bm25Index {
  const docs: Record<string, number>[] = [];
  const lengths: number[] = [];
  const df: Record<string, number> = {};
  for (const c of chunks) {
    const tf: Record<string, number> = {};
    const words = tokenize(c.text);
    // The file name and folders (or the page title) say a lot about what a chunk is about.
    const meta = tokenize(`${c.source.replace(/^https?:\/\/[^/]+/, '')} ${c.title ?? ''}`);
    for (const w of words) tf[w] = (tf[w] ?? 0) + 1;
    for (const w of meta) tf[w] = (tf[w] ?? 0) + 3;
    for (const w of Object.keys(tf)) df[w] = (df[w] ?? 0) + 1;
    docs.push(tf);
    lengths.push(words.length + meta.length * 3);
  }
  const avgLen = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  return { docs, lengths, df, avgLen };
}

/** BM25 score of every chunk for the query (k1 = 1.2, b = 0.75). */
export function bm25Scores(index: Bm25Index, query: string): number[] {
  const terms = [...new Set(tokenize(query))];
  const n = index.docs.length;
  const k1 = 1.2;
  const b = 0.75;
  return index.docs.map((tf, i) => {
    let s = 0;
    for (const t of terms) {
      const f = tf[t];
      if (!f) continue;
      const df = index.df[t] ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * index.lengths[i]!) / index.avgLen));
    }
    return s;
  });
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Ranks chunks: BM25 alone, or a blend with embedding similarity when vectors exist
 * (both normalized to 0..1). Returns chunk indexes, best first, with their score.
 */
export function rank(
  lexical: number[],
  semantic: (number | undefined)[] | undefined,
  limit: number,
): { index: number; score: number }[] {
  const maxL = Math.max(0, ...lexical);
  const scored = lexical.map((l, i) => {
    const ln = maxL > 0 ? l / maxL : 0;
    const sv = semantic?.[i];
    const score = sv === undefined ? ln : 0.65 * Math.max(0, sv) + 0.35 * ln;
    return { index: i, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

/** Readable text of an HTML page (scripts, styles and navigation chrome removed). */
export function htmlToText(html: string): { title: string; text: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();
  let body =
    /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ??
    /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ??
    html;
  body = body
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(h[1-6])[^>]*>/gi, '\n\n## ')
    .replace(/<\/(p|div|section|li|tr|h[1-6]|pre|table|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(
      /&(#?\w+);/g,
      (m, e: string) =>
        ENTITIES[e] ??
        (e.startsWith('#x')
          ? String.fromCodePoint(parseInt(e.slice(2), 16))
          : e.startsWith('#')
            ? String.fromCodePoint(Number(e.slice(1)) || 32)
            : m),
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return { title: decode(title), text: body.trim() };
}

function decode(s: string): string {
  return s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);
}

/**
 * Links of a page that stay under the docs root (same origin, path below the root's
 * folder), without fragments or queries, deduplicated.
 */
export function docLinks(html: string, pageUrl: string, root: string): string[] {
  const base = new URL(root);
  const prefix = base.pathname.endsWith('/') ? base.pathname : base.pathname.replace(/[^/]*$/, '');
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)[^"']*["']/gi)) {
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, '&'), pageUrl);
      if (u.origin !== base.origin || !u.pathname.startsWith(prefix)) continue;
      if (
        /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|tgz|mp4|css|js|json|xml|woff2?)$/i.test(
          u.pathname,
        )
      )
        continue;
      u.hash = '';
      u.search = '';
      out.add(u.toString());
    } catch {
      // malformed href
    }
  }
  return [...out];
}
