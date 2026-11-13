import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OmniCore } from '@omni/core';
import type { ToolDefinition } from '@omni/shared';
import { redact } from '@omni/security';
import type { DocSourceView, KnowledgeHit, MemoryView } from '../shared/api.js';
import { isSecretFile } from './guard.js';
import type { SystemPreview } from './system.js';
import { assertNotMetadata } from './system.js';
import type { Workspace } from './workspace.js';
import {
  bm25Scores,
  buildBm25,
  chunkLines,
  chunkProse,
  cosine,
  docLinks,
  htmlToText,
  rank,
} from './knowledgeText.js';
import type { Bm25Index, Chunk } from './knowledgeText.js';

const MAX_MEMORIES = 300;
const MAX_MEMORY_CHARS = 600;
/** Characters of memories that go into every system prompt at most. */
const MAX_PROMPT_MEMORIES = 5000;

const DOC_MAX_PAGES = 60;
const DOC_TIMEOUT = 15_000;
const DOC_MAX_BYTES = 3 * 1024 * 1024;

const CODE_MAX_FILE = 512 * 1024;
const CODE_MAX_FILES = 15_000;
/** Chunks embedded at most per index (the rest stays lexical-only). */
const MAX_EMBEDDED = 8000;
const EMBED_BATCH = 64;
/** Re-scan the project for changed files at most this often. */
const REFRESH_EVERY = 4000;

const SKIP_EXT =
  /\.(png|jpe?g|gif|bmp|ico|webp|avif|svg|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|o|a|so|dll|dylib|exe|bin|wasm|mp[34]|mov|avi|webm|ogg|wav|flac|ttf|otf|woff2?|eot|psd|sqlite|db|lock|map|pyc|DS_Store)$/i;
const SKIP_NAME = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum)$|\.min\.(js|css)$/i;

// ---------------------------------------------------------------- vectors on disk

function packVector(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString('base64');
}
function unpackVector(s: string): Float32Array {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}

interface StoredChunk extends Chunk {
  /** base64 Float32 embedding (of `vecModel`). */
  vec?: string;
}

interface CodeFile {
  mtime: number;
  size: number;
  chunks: StoredChunk[];
}

interface CodeIndexFile {
  version: 1;
  root: string;
  vecModel?: string;
  files: Record<string, CodeFile>;
}

interface DocIndexFile {
  version: 1;
  vecModel?: string;
  chunks: StoredChunk[];
}

interface MemoryFile {
  version: 1;
  items: MemoryView[];
}

interface DocsMeta {
  version: 1;
  sources: DocSourceView[];
}

/** An index ready to rank: its chunks, BM25 tables and vectors (when there are). */
interface Ranked {
  chunks: StoredChunk[];
  bm25: Bm25Index;
  vecs: (Float32Array | undefined)[];
  vecModel?: string;
}

function ranked(chunks: StoredChunk[], vecModel?: string): Ranked {
  return {
    chunks,
    bm25: buildBm25(chunks),
    vecs: chunks.map((c) => (c.vec ? unpackVector(c.vec) : undefined)),
    vecModel,
  };
}

/**
 * Zinarix's knowledge: memories (preferences the user wants kept between conversations),
 * external documentation indexed from a URL (@Docs) and a search index of the open project
 * by meaning (embeddings when an embedding model is set, BM25 otherwise). Everything lives
 * on disk under the app's data folder.
 */
export class Knowledge {
  private memoryCache?: MemoryFile;
  private docsMeta?: DocsMeta;
  private readonly docIndex = new Map<string, Ranked>();
  private readonly crawls = new Map<string, AbortController>();
  private readonly code = new Map<
    string,
    { file: CodeIndexFile; ranked?: Ranked; checked: number; busy?: Promise<void> }
  >();
  /** Told when memories or docs change (main broadcasts to the windows). */
  onChange?: () => void;

  constructor(
    private readonly dir: string,
    private readonly core: OmniCore,
  ) {}

  // ---------------------------------------------------------------- memories

  private memoryFile(): MemoryFile {
    if (this.memoryCache) return this.memoryCache;
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'memories.json'), 'utf8')) as MemoryFile;
      this.memoryCache = { version: 1, items: Array.isArray(raw.items) ? raw.items : [] };
    } catch {
      this.memoryCache = { version: 1, items: [] };
    }
    return this.memoryCache;
  }

  private async saveMemories(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, 'memories.json'), JSON.stringify(this.memoryFile(), null, 1));
    this.onChange?.();
  }

  /** Global memories plus those of `project` (an absolute folder), newest first. */
  memories(project?: string, all = false): MemoryView[] {
    return this.memoryFile()
      .items.filter((m) => all || m.scope === 'global' || (project && m.project === project))
      .sort((a, b) => b.created - a.created);
  }

  async addMemory(text: string, scope: 'global' | 'project', project?: string): Promise<MemoryView> {
    const clean = redact(text.replace(/\s+/g, ' ').trim()).slice(0, MAX_MEMORY_CHARS);
    if (!clean) throw new Error('empty memory');
    if (scope === 'project' && !project) throw new Error('no project folder is open');
    const f = this.memoryFile();
    const same = f.items.find(
      (m) => m.text === clean && m.scope === scope && (scope === 'global' || m.project === project),
    );
    if (same) return same;
    const item: MemoryView = {
      id: randomUUID().slice(0, 8),
      text: clean,
      scope,
      ...(scope === 'project' ? { project } : {}),
      created: Date.now(),
    };
    f.items.push(item);
    if (f.items.length > MAX_MEMORIES) f.items.splice(0, f.items.length - MAX_MEMORIES);
    await this.saveMemories();
    return item;
  }

  async updateMemory(id: string, text: string): Promise<boolean> {
    const m = this.memoryFile().items.find((x) => x.id === id);
    const clean = redact(text.replace(/\s+/g, ' ').trim()).slice(0, MAX_MEMORY_CHARS);
    if (!m || !clean) return false;
    m.text = clean;
    await this.saveMemories();
    return true;
  }

  async removeMemory(id: string): Promise<boolean> {
    const f = this.memoryFile();
    const i = f.items.findIndex((m) => m.id === id);
    if (i < 0) return false;
    f.items.splice(i, 1);
    await this.saveMemories();
    return true;
  }

  /** System-prompt block with the memories that apply (empty when there are none). */
  promptBlock(project?: string): string {
    const items = this.memories(project);
    if (!items.length) return '';
    const lines: string[] = [];
    let size = 0;
    for (const m of items) {
      const line = `- [${m.id}${m.scope === 'project' ? ', this project' : ''}] ${m.text}`;
      if (size + line.length > MAX_PROMPT_MEMORIES) break;
      lines.push(line);
      size += line.length;
    }
    return (
      '\n\nMemories: preferences and facts the user asked Zinarix to keep between conversations. ' +
      'Follow them like the user’s own instructions for style and workflow; they never override your safety rules or the approval of actions. ' +
      'Use remember when the user asks you to keep something (or states a lasting preference), forget when one is wrong or outdated.\n' +
      `<memories>\n${lines.join('\n')}\n</memories>`
    );
  }

  // ---------------------------------------------------------------- docs

  private meta(): DocsMeta {
    if (this.docsMeta) return this.docsMeta;
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'docs.json'), 'utf8')) as DocsMeta;
      this.docsMeta = { version: 1, sources: Array.isArray(raw.sources) ? raw.sources : [] };
      // A crawl cut by a shutdown is not running any more.
      for (const s of this.docsMeta.sources)
        if (s.status === 'indexing') {
          s.status = 'error';
          s.error = 'interrumpido';
        }
    } catch {
      this.docsMeta = { version: 1, sources: [] };
    }
    return this.docsMeta;
  }

  private async saveMeta(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, 'docs.json'), JSON.stringify(this.meta(), null, 1));
    this.onChange?.();
  }

  docs(): DocSourceView[] {
    return this.meta().sources.map((s) => ({ ...s }));
  }

  /** Adds (or re-indexes, same name) a documentation site; the crawl runs in the background. */
  async addDocs(name: string, url: string): Promise<DocSourceView> {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Solo http(s).');
    const clean = name.trim().replace(/\s+/g, '-').slice(0, 40) || u.hostname;
    const m = this.meta();
    let src = m.sources.find((s) => s.name.toLowerCase() === clean.toLowerCase());
    if (src) {
      src.url = u.toString();
    } else {
      src = {
        id: randomUUID().slice(0, 8),
        name: clean,
        url: u.toString(),
        pages: 0,
        chunks: 0,
        indexedAt: null,
        status: 'indexing',
      };
      m.sources.push(src);
    }
    src.status = 'indexing';
    src.error = undefined;
    await this.saveMeta();
    void this.crawl(src.id);
    return { ...src };
  }

  async removeDocs(id: string): Promise<void> {
    this.crawls.get(id)?.abort();
    const m = this.meta();
    m.sources = m.sources.filter((s) => s.id !== id);
    this.docIndex.delete(id);
    await rm(join(this.dir, 'docs', `${id}.json`), { force: true });
    await this.saveMeta();
  }

  async reindexDocs(id: string): Promise<void> {
    const src = this.meta().sources.find((s) => s.id === id);
    if (!src) throw new Error('unknown docs source');
    await this.addDocs(src.name, src.url);
  }

  private async crawl(id: string): Promise<void> {
    this.crawls.get(id)?.abort();
    const ctrl = new AbortController();
    this.crawls.set(id, ctrl);
    const src = this.meta().sources.find((s) => s.id === id);
    if (!src) return;
    const root = src.url;
    const queue = [root];
    const seen = new Set(queue);
    const chunks: StoredChunk[] = [];
    let pages = 0;
    try {
      while (queue.length && pages < DOC_MAX_PAGES && !ctrl.signal.aborted) {
        const batch = queue.splice(0, 3);
        const got = await Promise.all(batch.map((u) => fetchPage(u, root, ctrl.signal)));
        for (const page of got) {
          if (!page) continue;
          pages++;
          const { title, text } = page.html ? htmlToText(page.body) : { title: '', text: page.body };
          chunks.push(...chunkProse(page.url, title || page.url, redact(text)));
          if (page.html)
            for (const link of docLinks(page.body, page.url, root))
              if (!seen.has(link) && seen.size < DOC_MAX_PAGES * 4) {
                seen.add(link);
                queue.push(link);
              }
        }
        src.pages = pages;
        this.onChange?.();
        await new Promise((r) => setTimeout(r, 150));
      }
      if (ctrl.signal.aborted) return;
      if (!chunks.length) throw new Error('no se pudo leer texto de esa dirección');
      const vecModel = await this.embedChunks(chunks, ctrl.signal).catch(() => undefined);
      const file: DocIndexFile = { version: 1, vecModel, chunks };
      await mkdir(join(this.dir, 'docs'), { recursive: true });
      await writeFile(join(this.dir, 'docs', `${id}.json`), JSON.stringify(file));
      this.docIndex.set(id, ranked(chunks, vecModel));
      Object.assign(src, {
        status: 'ready',
        pages,
        chunks: chunks.length,
        indexedAt: Date.now(),
        error: undefined,
        embedded: !!vecModel,
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      src.status = 'error';
      src.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.crawls.get(id) === ctrl) this.crawls.delete(id);
    }
    if (this.meta().sources.includes(src)) await this.saveMeta();
  }

  private async loadDoc(id: string): Promise<Ranked | undefined> {
    const hit = this.docIndex.get(id);
    if (hit) return hit;
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'docs', `${id}.json`), 'utf8')) as DocIndexFile;
      const r = ranked(raw.chunks, raw.vecModel);
      this.docIndex.set(id, r);
      return r;
    } catch {
      return undefined;
    }
  }

  /** Best chunks of the indexed docs (one source by name or id, or all of them). */
  async docsSearch(query: string, source?: string, limit = 6): Promise<KnowledgeHit[]> {
    const wanted = source?.replace(/^@?docs:/i, '').toLowerCase();
    const sources = this.meta().sources.filter(
      (s) => !wanted || s.name.toLowerCase() === wanted || s.id === wanted,
    );
    if (wanted && !sources.length) throw new Error(`no docs named "${source}"`);
    const hits: KnowledgeHit[] = [];
    const qvec = new Map<string, Float32Array | undefined>();
    for (const s of sources) {
      const r = await this.loadDoc(s.id);
      if (!r) continue;
      if (r.vecModel && !qvec.has(r.vecModel))
        qvec.set(r.vecModel, await this.embedQuery(query, r.vecModel));
      for (const h of this.rankIndex(r, query, qvec.get(r.vecModel ?? ''), limit))
        hits.push({ ...h, label: s.name });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ---------------------------------------------------------------- project code

  private codePath(root: string): string {
    const h = createHash('sha256').update(root).digest('hex').slice(0, 16);
    return join(this.dir, 'code', `${h}.json`);
  }

  private codeState(root: string) {
    let st = this.code.get(root);
    if (!st) {
      let file: CodeIndexFile = { version: 1, root, files: {} };
      try {
        const p = this.codePath(root);
        if (existsSync(p)) {
          const raw = JSON.parse(readFileSync(p, 'utf8')) as CodeIndexFile;
          if (raw.root === root && raw.files) file = raw;
        }
      } catch {
        // rebuilt below
      }
      st = { file, checked: 0 };
      this.code.set(root, st);
    }
    return st;
  }

  /** Brings the project's index up to date (changed, new and deleted files). */
  async refreshCode(ws: Workspace, signal?: AbortSignal, force = false): Promise<void> {
    const st = this.codeState(ws.root);
    if (st.busy) return st.busy;
    if (!force && st.ranked && Date.now() - st.checked < REFRESH_EVERY) return;
    st.busy = (async () => {
      const files = (await ws.listFiles(CODE_MAX_FILES)).filter(
        (p) => !SKIP_EXT.test(p) && !SKIP_NAME.test(p) && !isSecretFile(p),
      );
      let dirty = !st.ranked;
      const keep = new Set(files);
      for (const p of Object.keys(st.file.files))
        if (!keep.has(p)) {
          delete st.file.files[p];
          dirty = true;
        }
      for (const p of files) {
        if (signal?.aborted) break;
        let s;
        try {
          s = await stat(ws.resolve(p));
        } catch {
          continue;
        }
        const old = st.file.files[p];
        if (old && old.mtime === s.mtimeMs && old.size === s.size) continue;
        dirty = true;
        if (s.size > CODE_MAX_FILE) {
          st.file.files[p] = { mtime: s.mtimeMs, size: s.size, chunks: [] };
          continue;
        }
        const f = await ws.readFile(p).catch(() => undefined);
        const chunks = f && !f.binary && !f.tooLarge ? chunkLines(p, f.content) : [];
        st.file.files[p] = { mtime: s.mtimeMs, size: s.size, chunks };
      }
      const all = Object.values(st.file.files).flatMap((f) => f.chunks);
      const model = this.core.config.roles.embeddings;
      if (model && signal && !signal.aborted) {
        if (st.file.vecModel !== model) for (const c of all) delete c.vec;
        const missing = all.filter((c) => !c.vec).length;
        if (missing) {
          dirty = true;
          st.file.vecModel = await this.embedChunks(all, signal).catch(() => st.file.vecModel);
        }
      }
      if (dirty || !st.ranked) {
        st.ranked = ranked(all, st.file.vecModel);
        await mkdir(join(this.dir, 'code'), { recursive: true });
        await writeFile(this.codePath(ws.root), JSON.stringify(st.file)).catch(() => undefined);
      }
      st.checked = Date.now();
    })().finally(() => {
      st.busy = undefined;
    });
    return st.busy;
  }

  /** Searches the open project by meaning (or by its words when there are no embeddings). */
  async codeSearch(
    ws: Workspace,
    query: string,
    limit = 8,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{ hits: KnowledgeHit[]; semantic: boolean; files: number }> {
    await this.refreshCode(ws, signal);
    const st = this.codeState(ws.root);
    const r = st.ranked!;
    const qv = r.vecModel ? await this.embedQuery(query, r.vecModel) : undefined;
    return {
      hits: this.rankIndex(r, query, qv, limit),
      semantic: !!qv,
      files: Object.keys(st.file.files).length,
    };
  }

  // ---------------------------------------------------------------- ranking / embeddings

  private rankIndex(
    r: Ranked,
    query: string,
    qv: Float32Array | undefined,
    limit: number,
  ): KnowledgeHit[] {
    const lexical = bm25Scores(r.bm25, query);
    const semantic = qv ? r.vecs.map((v) => (v ? cosine(qv, v) : undefined)) : undefined;
    // Several chunks of one file overlap: keep the best one per region.
    const out: KnowledgeHit[] = [];
    for (const { index, score } of rank(lexical, semantic, limit * 4)) {
      const c = r.chunks[index]!;
      if (out.some((h) => h.source === c.source && h.start <= c.end && c.start <= h.end && c.start))
        continue;
      out.push({ source: c.source, start: c.start, end: c.end, title: c.title, text: c.text, score });
      if (out.length >= limit) break;
    }
    return out;
  }

  private async embedQuery(query: string, model: string): Promise<Float32Array | undefined> {
    if (model !== this.core.config.roles.embeddings) return undefined;
    try {
      const r = await this.core.embed([query], AbortSignal.timeout(20_000), model);
      const v = r?.vectors[0];
      return v ? new Float32Array(v) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Embeds the chunks that have no vector yet (up to MAX_EMBEDDED); returns the model used. */
  private async embedChunks(chunks: StoredChunk[], signal: AbortSignal): Promise<string | undefined> {
    const model = this.core.config.roles.embeddings;
    if (!model) return undefined;
    const todo = chunks.filter((c) => !c.vec).slice(0, MAX_EMBEDDED);
    for (let i = 0; i < todo.length && !signal.aborted; i += EMBED_BATCH) {
      const batch = todo.slice(i, i + EMBED_BATCH);
      const r = await this.core.embed(
        batch.map((c) => `${c.title ?? c.source}\n${c.text}`.slice(0, 6000)),
        signal,
        model,
      );
      if (!r) return undefined;
      r.vectors.forEach((v, k) => {
        if (batch[k]) batch[k].vec = packVector(v);
      });
    }
    return model;
  }

  embedModel(): string | null {
    return this.core.config.roles.embeddings ?? null;
  }

  setEmbedModel(ref: string | null): void {
    const roles = { ...this.core.config.roles };
    if (ref) {
      this.core.resolveModel(ref);
      this.core.provider(ref.split('/')[0]!);
      roles.embeddings = ref;
    } else delete roles.embeddings;
    this.core.saveConfig({ ...this.core.config, roles });
    this.onChange?.();
  }
}

/** One docs page (HTML or plain text/markdown), redirects followed only inside the docs site. */
async function fetchPage(
  url: string,
  root: string,
  signal: AbortSignal,
): Promise<{ url: string; body: string; html: boolean } | undefined> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    await assertNotMetadata(u.hostname);
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(DOC_TIMEOUT)]),
        headers: { 'user-agent': 'ZinarixStudio-Docs/1.0', accept: 'text/html,text/plain,text/markdown' },
      });
    } catch {
      return undefined;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return undefined;
      const next = new URL(loc, u);
      if (next.origin !== new URL(root).origin) return undefined;
      current = next.toString();
      continue;
    }
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? '';
    const html = /html/i.test(type);
    if (!html && !/text\/(plain|markdown|x-markdown)/i.test(type)) return undefined;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > DOC_MAX_BYTES) return undefined;
    const body = (await res.text()).slice(0, DOC_MAX_BYTES);
    return { url: current, body, html };
  }
  return undefined;
}

// ---------------------------------------------------------------- agent tools

export const KNOWLEDGE_PROMPT_PART = `- semantic_search: searches the open project by meaning (describe what you are looking for: "where are auth tokens refreshed", "the component that renders the chat input"). Prefer it over search when you do not know the exact words or file names; then read the files it points to.
- docs_list, docs_search: external documentation the user indexed in Zinarix (@Docs). When the user mentions @docs:<name> or asks about a library they indexed, search it before answering.
- remember, forget, list_memories: memories kept between conversations. Use remember when the user asks you to remember something or states a lasting preference ("always use pnpm", "answer in English"); the user approves each one.`;

const SCOPE = {
  type: 'string',
  enum: ['global', 'project'],
  description: '"project": only for the open project folder; "global" (default): every project',
};

export const KNOWLEDGE_TOOLS: ToolDefinition[] = [
  {
    name: 'semantic_search',
    description:
      'Search the open project by meaning: returns the most relevant code chunks (path, lines, snippet) for a natural-language description.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are looking for, in words' },
        limit: { type: 'integer', description: 'Results (default 8, max 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'docs_list',
    description: 'List the external documentation sites the user indexed in Zinarix (@Docs).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'docs_search',
    description:
      'Search the indexed external documentation: returns the most relevant passages with their page URLs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        source: { type: 'string', description: 'Name of one docs source from docs_list (default: all)' },
        limit: { type: 'integer', description: 'Results (default 6, max 15)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_memories',
    description: 'List the memories saved for the user (global and for this project), with their ids.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'remember',
    description:
      'Save a memory kept between conversations: a short, self-contained preference or fact (one sentence).',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' }, scope: SCOPE },
      required: ['text'],
    },
  },
  {
    name: 'forget',
    description: 'Delete a saved memory by its id (from list_memories or the memories block).',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

export const KNOWLEDGE_TOOL_NAMES = new Set(KNOWLEDGE_TOOLS.map((t) => t.name));
export const KNOWLEDGE_READ_ONLY = ['semantic_search', 'docs_list', 'docs_search', 'list_memories'];
/** Tools that work without an open folder. */
export const KNOWLEDGE_NO_FOLDER = ['docs_list', 'docs_search', 'list_memories', 'remember', 'forget'];

export function knowledgePreview(
  name: string,
  a: Record<string, unknown>,
  k: Knowledge | undefined,
): SystemPreview | null {
  if (name === 'remember')
    return {
      risk: 'medium',
      warning:
        'La IA guardará una memoria que verá en todas tus conversaciones' +
        (a.scope === 'project' ? ' de este proyecto.' : '.') +
        ' Puedes verlas y borrarlas en Configuración › Memorias.',
      allowKey: 'memory:remember',
      action: `recordar: "${String(a.text ?? '').slice(0, 300)}"`,
    };
  if (name === 'forget') {
    const m = k?.memories(undefined, true).find((x) => x.id === a.id);
    return {
      risk: 'medium',
      warning: 'La IA borrará una memoria guardada.',
      allowKey: 'memory:forget',
      action: `olvidar: "${m?.text.slice(0, 300) ?? String(a.id)}"`,
    };
  }
  return null;
}

function hitsText(hits: KnowledgeHit[], code: boolean): string {
  return hits
    .map((h, i) =>
      code
        ? `${i + 1}. ${h.source}:${h.start}-${h.end}\n${h.text.split('\n').slice(0, 40).join('\n')}`
        : `${i + 1}. [${h.label}] ${h.title ?? ''} — ${h.source}\n${h.text}`,
    )
    .join('\n\n---\n\n');
}

export async function runKnowledgeTool(
  k: Knowledge,
  name: string,
  a: Record<string, unknown>,
  ws: Workspace | undefined,
  signal: AbortSignal,
): Promise<{ content: string; summary: string }> {
  const num = (v: unknown, def: number, max: number) =>
    Math.max(1, Math.min(max, typeof v === 'number' ? Math.floor(v) : def));
  switch (name) {
    case 'semantic_search': {
      if (!ws) throw new Error('No folder is open in the editor.');
      const r = await k.codeSearch(ws, String(a.query ?? ''), num(a.limit, 8, 20), signal);
      if (!r.hits.length) return { content: 'No matches.', summary: 'sin resultados' };
      const how = r.semantic ? 'by meaning (embeddings)' : 'by relevance (BM25; no embedding model set)';
      return {
        content: `${r.hits.length} results ${how}, from ${r.files} indexed files:\n\n${hitsText(r.hits, true)}`,
        summary: `${r.hits.length} resultados${r.semantic ? ' (semántico)' : ''}`,
      };
    }
    case 'docs_list': {
      const d = k.docs();
      if (!d.length)
        return {
          content: 'No documentation is indexed. The user can add some in Settings › Docs or with /docs <name> <url>.',
          summary: 'sin docs',
        };
      return {
        content: d
          .map((s) => `- ${s.name}: ${s.url} · ${s.status} · ${s.pages} pages, ${s.chunks} passages`)
          .join('\n'),
        summary: `${d.length} fuentes`,
      };
    }
    case 'docs_search': {
      const hits = await k.docsSearch(
        String(a.query ?? ''),
        typeof a.source === 'string' && a.source ? a.source : undefined,
        num(a.limit, 6, 15),
      );
      if (!hits.length) return { content: 'No matches in the indexed docs.', summary: 'sin resultados' };
      return { content: hitsText(hits, false), summary: `${hits.length} pasajes` };
    }
    case 'list_memories': {
      const m = k.memories(ws?.root);
      return {
        content: m.length
          ? m.map((x) => `- [${x.id}] (${x.scope}) ${x.text}`).join('\n')
          : 'No memories saved.',
        summary: `${m.length} memorias`,
      };
    }
    case 'remember': {
      const scope = a.scope === 'project' ? 'project' : 'global';
      const m = await k.addMemory(String(a.text ?? ''), scope, ws?.root);
      return { content: `Saved memory ${m.id}.`, summary: 'memoria guardada' };
    }
    case 'forget': {
      const ok = await k.removeMemory(String(a.id ?? ''));
      return { content: ok ? 'Forgotten.' : 'No memory with that id.', summary: ok ? 'olvidada' : 'no existe' };
    }
  }
  throw new Error(`unknown tool ${name}`);
}
