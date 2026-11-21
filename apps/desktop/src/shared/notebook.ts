/**
 * Jupyter notebooks (.ipynb, nbformat 4): parse, edit and write back without losing anything
 * the editor doesn't know about (unknown keys of the notebook, cells and outputs are kept), and
 * the pure part of running cells (Jupyter messaging protocol v5 messages and how the kernel's
 * iopub messages become cell outputs). No Node, DOM or Monaco imports: tested in Node.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface StreamOutput {
  output_type: 'stream';
  name: 'stdout' | 'stderr';
  text: string;
  extra: JsonObject;
}
export interface DataOutput {
  output_type: 'execute_result' | 'display_data';
  /** mime type -> value as in the file (string, array of lines or JSON). */
  data: JsonObject;
  metadata: JsonObject;
  execution_count?: number | null;
  /** Display id (update_display_data replaces it); runtime only, never written. */
  displayId?: string;
  extra: JsonObject;
}
export interface ErrorOutput {
  output_type: 'error';
  ename: string;
  evalue: string;
  traceback: string[];
  extra: JsonObject;
}
export type NbOutput = StreamOutput | DataOutput | ErrorOutput;

export type CellType = 'code' | 'markdown' | 'raw';

export interface NbCell {
  id?: string;
  cell_type: CellType;
  source: string;
  metadata: JsonObject;
  /** Code cells only. */
  outputs: NbOutput[];
  execution_count: number | null;
  /** Unknown keys (attachments, a future field…), written back as they were. */
  extra: JsonObject;
}

export interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: JsonObject;
  cells: NbCell[];
  extra: JsonObject;
  /** Indentation of the original file (Jupyter writes 1). */
  indent: number;
}

const isObj = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);

/** "a\n","b" (the file's list of lines) or a plain string → one string. */
export function joinLines(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x))).join('');
  return typeof v === 'string' ? v : '';
}

/** One string → the file's list of lines, each keeping its "\n" (like nbformat). */
export function splitLines(s: string): string[] {
  if (!s) return [];
  const out = s.split(/(?<=\n)/);
  return out;
}

function rest(o: JsonObject, known: readonly string[]): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(o)) if (!known.includes(k)) out[k] = v;
  return out;
}

const OUT_KNOWN: Record<string, readonly string[]> = {
  stream: ['output_type', 'name', 'text'],
  execute_result: ['output_type', 'data', 'metadata', 'execution_count'],
  display_data: ['output_type', 'data', 'metadata'],
  error: ['output_type', 'ename', 'evalue', 'traceback'],
};

/** An output as in the file; null for an unknown output_type (kept raw by the caller). */
export function parseOutput(o: unknown): NbOutput | null {
  if (!isObj(o)) return null;
  const type = o.output_type;
  if (type === 'stream')
    return {
      output_type: 'stream',
      name: o.name === 'stderr' ? 'stderr' : 'stdout',
      text: joinLines(o.text),
      extra: rest(o, OUT_KNOWN.stream!),
    };
  if (type === 'execute_result' || type === 'display_data')
    return {
      output_type: type,
      data: isObj(o.data) ? o.data : {},
      metadata: isObj(o.metadata) ? o.metadata : {},
      ...(type === 'execute_result'
        ? { execution_count: typeof o.execution_count === 'number' ? o.execution_count : null }
        : {}),
      extra: rest(o, OUT_KNOWN[type]!),
    };
  if (type === 'error')
    return {
      output_type: 'error',
      ename: typeof o.ename === 'string' ? o.ename : '',
      evalue: typeof o.evalue === 'string' ? o.evalue : '',
      traceback: Array.isArray(o.traceback) ? o.traceback.map(String) : [],
      extra: rest(o, OUT_KNOWN.error!),
    };
  return null;
}

/** Text mime types are written as lists of lines; the rest (base64, JSON) as they are. */
function writeMime(mime: string, v: Json): Json {
  if (typeof v === 'string' && (mime.startsWith('text/') || mime === 'image/svg+xml'))
    return splitLines(v);
  return v;
}

export function serializeOutput(o: NbOutput): JsonObject {
  if (o.output_type === 'stream')
    return { ...o.extra, output_type: 'stream', name: o.name, text: splitLines(o.text) };
  if (o.output_type === 'error')
    return {
      ...o.extra,
      output_type: 'error',
      ename: o.ename,
      evalue: o.evalue,
      traceback: o.traceback,
    };
  const data: JsonObject = {};
  for (const [k, v] of Object.entries(o.data)) data[k] = writeMime(k, v);
  return {
    ...o.extra,
    output_type: o.output_type,
    data,
    metadata: o.metadata,
    ...(o.output_type === 'execute_result' ? { execution_count: o.execution_count ?? null } : {}),
  };
}

const CELL_KNOWN = ['id', 'cell_type', 'source', 'metadata', 'outputs', 'execution_count'];

/** Outputs of unknown types travel in the cell's extra under this key, in order. */
const RAW_OUTPUTS = '__zinarix_raw_outputs';

export class NotebookError extends Error {}

function detectIndent(text: string): number {
  const m = /^\{\r?\n( +)"/.exec(text);
  return m ? m[1]!.length : 1;
}

/** Reads a .ipynb file. Throws NotebookError when it isn't a v4 notebook. */
export function parseNotebook(text: string): Notebook {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim() ? text : '{}');
  } catch (e) {
    throw new NotebookError(`invalid JSON: ${(e as Error).message}`);
  }
  if (!isObj(raw)) throw new NotebookError('not a notebook (no top-level object)');
  // An empty file is a new notebook.
  if (!Object.keys(raw).length) return emptyNotebook();
  const major = raw.nbformat;
  if (typeof major !== 'number') throw new NotebookError('missing nbformat');
  if (major !== 4) throw new NotebookError(`unsupported nbformat ${major} (only 4)`);
  if (!Array.isArray(raw.cells)) throw new NotebookError('missing cells');
  const cells: NbCell[] = raw.cells.map((c, i) => {
    if (!isObj(c)) throw new NotebookError(`cell ${i + 1} is not an object`);
    const type: CellType =
      c.cell_type === 'markdown' || c.cell_type === 'raw' ? c.cell_type : 'code';
    const outputs: NbOutput[] = [];
    const extra = rest(c, CELL_KNOWN);
    if (c.cell_type !== type) extra.cell_type = c.cell_type ?? null; // odd type: kept as is
    if (Array.isArray(c.outputs)) {
      const unknown: Json[] = [];
      for (const o of c.outputs) {
        const p = parseOutput(o);
        if (p) outputs.push(p);
        else unknown.push(o);
      }
      if (unknown.length) extra[RAW_OUTPUTS] = unknown;
    }
    return {
      ...(typeof c.id === 'string' ? { id: c.id } : {}),
      cell_type: type,
      source: joinLines(c.source),
      metadata: isObj(c.metadata) ? c.metadata : {},
      outputs,
      execution_count: typeof c.execution_count === 'number' ? c.execution_count : null,
      extra,
    };
  });
  return {
    nbformat: 4,
    nbformat_minor: typeof raw.nbformat_minor === 'number' ? raw.nbformat_minor : 5,
    metadata: isObj(raw.metadata) ? raw.metadata : {},
    cells,
    extra: rest(raw, ['nbformat', 'nbformat_minor', 'metadata', 'cells']),
    indent: detectIndent(text),
  };
}

/** Keys sorted like nbformat's writer (json.dumps(sort_keys=True)), so diffs stay small. */
function sortKeys(v: Json): Json {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isObj(v)) return v;
  const out: JsonObject = {};
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]!);
  return out;
}

export function serializeCell(c: NbCell): JsonObject {
  const { [RAW_OUTPUTS]: rawOutputs, ...extra } = c.extra;
  const out: JsonObject = {
    ...extra,
    ...(c.id !== undefined ? { id: c.id } : {}),
    cell_type: (extra.cell_type as string | undefined) ?? c.cell_type,
    metadata: c.metadata,
    source: splitLines(c.source),
  };
  if (c.cell_type === 'code') {
    out.execution_count = c.execution_count;
    out.outputs = [...c.outputs.map(serializeOutput), ...(Array.isArray(rawOutputs) ? rawOutputs : [])];
  }
  return out;
}

/** Writes the notebook the way Jupyter does (sorted keys, indent 1, final newline). */
export function serializeNotebook(nb: Notebook): string {
  const obj: JsonObject = {
    ...nb.extra,
    cells: nb.cells.map(serializeCell),
    metadata: nb.metadata,
    nbformat: nb.nbformat,
    nbformat_minor: nb.nbformat_minor,
  };
  return `${JSON.stringify(sortKeys(obj), null, nb.indent || 1)}\n`;
}

export function emptyNotebook(): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    cells: [newCell('code', '', 5)],
    extra: {},
    indent: 1,
  };
}

/** nbformat 4.5+ cell ids: 1-64 chars of [a-zA-Z0-9-_]. */
export function newCellId(rand: () => number = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += abc[Math.floor(rand() * abc.length)];
  return s;
}

export function newCell(type: CellType, source = '', minor = 5): NbCell {
  return {
    ...(minor >= 5 ? { id: newCellId() } : {}),
    cell_type: type,
    source,
    metadata: {},
    outputs: [],
    execution_count: null,
    extra: {},
  };
}

/** Kernel language of the notebook (for the cell editors): "python", "julia"… */
export function notebookLanguage(nb: Notebook): string {
  const li = nb.metadata.language_info;
  if (isObj(li) && typeof li.name === 'string') return li.name.toLowerCase();
  const ks = nb.metadata.kernelspec;
  if (isObj(ks) && typeof ks.language === 'string') return ks.language.toLowerCase();
  return 'python';
}

export function kernelName(nb: Notebook): string | null {
  const ks = nb.metadata.kernelspec;
  return isObj(ks) && typeof ks.name === 'string' && ks.name ? ks.name : null;
}

// ---------------- rendering helpers ----------------

/** Richest mime type the editor can show, in Jupyter's order of preference. */
export const MIME_ORDER = [
  'application/vnd.jupyter.widget-view+json',
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

export function pickMime(data: JsonObject, supported: readonly string[]): string | null {
  for (const m of MIME_ORDER) if (m in data && supported.includes(m)) return m;
  for (const m of Object.keys(data)) if (supported.includes(m)) return m;
  return null;
}

export function mimeText(v: Json | undefined): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || Array.isArray(v)) return joinLines(v);
  return JSON.stringify(v, null, 2);
}

 
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/** Terminal-style "\r" (progress bars) and "\b": what is left on screen. */
export function collapseCarriageReturns(s: string): string {
  if (!s.includes('\r') && !s.includes('\b')) return s;
  return s
    .split('\n')
    .map((line) => {
      let cur = line;
      if (cur.includes('\r')) {
        const parts = cur.split('\r');
        // A trailing "\r" (Windows line end or a pending overwrite) keeps the last text.
        while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
        cur = parts[parts.length - 1]!;
      }
       
      while (cur.includes('\b')) cur = cur.replace(/[^\x08]\x08|^\x08+/, '');
      return cur;
    })
    .join('\n');
}

// ---------------- Jupyter messaging (protocol v5) ----------------

export interface KernelMessage {
  header: {
    msg_id: string;
    msg_type: string;
    session: string;
    username: string;
    date: string;
    version: string;
  };
  parent_header: Partial<KernelMessage['header']>;
  metadata: JsonObject;
  content: JsonObject;
  channel: 'shell' | 'iopub' | 'stdin' | 'control';
  buffers?: unknown[];
}

export function kernelMessage(
  msgType: string,
  content: JsonObject,
  ids: { msgId: string; session: string; channel?: KernelMessage['channel']; date?: string },
): KernelMessage {
  return {
    header: {
      msg_id: ids.msgId,
      msg_type: msgType,
      session: ids.session,
      username: 'zinarix',
      date: ids.date ?? new Date().toISOString(),
      version: '5.3',
    },
    parent_header: {},
    metadata: {},
    content,
    channel: ids.channel ?? 'shell',
    buffers: [],
  };
}

export function executeRequest(
  code: string,
  ids: { msgId: string; session: string; date?: string },
): KernelMessage {
  return kernelMessage(
    'execute_request',
    {
      code,
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    },
    ids,
  );
}

/** Outputs of a running cell plus the pending "clear_output(wait=True)". */
export interface OutputState {
  outputs: NbOutput[];
  clearPending: boolean;
}

/**
 * Applies one iopub message (already matched to the cell by parent msg_id) to the cell's
 * outputs: stream (merged with the previous stream of the same name), execute_result,
 * display_data, update_display_data, error and clear_output. Other types are ignored.
 */
export function applyIopub(
  st: OutputState,
  msgType: string,
  content: JsonObject,
): OutputState {
  if (msgType === 'clear_output') {
    if (content.wait === true) return { outputs: st.outputs, clearPending: true };
    return { outputs: [], clearPending: false };
  }
  if (msgType === 'update_display_data') {
    const id = isObj(content.transient) ? content.transient.display_id : undefined;
    if (typeof id !== 'string') return st;
    const outputs = st.outputs.map((o) =>
      o.output_type !== 'stream' && o.output_type !== 'error' && o.displayId === id
        ? {
            ...o,
            data: isObj(content.data) ? content.data : {},
            metadata: isObj(content.metadata) ? content.metadata : {},
          }
        : o,
    );
    return { ...st, outputs };
  }
  let next: NbOutput | null = null;
  if (msgType === 'stream') {
    next = {
      output_type: 'stream',
      name: content.name === 'stderr' ? 'stderr' : 'stdout',
      text: typeof content.text === 'string' ? content.text : '',
      extra: {},
    };
  } else if (msgType === 'execute_result' || msgType === 'display_data') {
    const id = isObj(content.transient) ? content.transient.display_id : undefined;
    next = {
      output_type: msgType,
      data: isObj(content.data) ? content.data : {},
      metadata: isObj(content.metadata) ? content.metadata : {},
      ...(msgType === 'execute_result'
        ? {
            execution_count:
              typeof content.execution_count === 'number' ? content.execution_count : null,
          }
        : {}),
      ...(typeof id === 'string' ? { displayId: id } : {}),
      extra: {},
    };
  } else if (msgType === 'error') {
    next = {
      output_type: 'error',
      ename: typeof content.ename === 'string' ? content.ename : '',
      evalue: typeof content.evalue === 'string' ? content.evalue : '',
      traceback: Array.isArray(content.traceback) ? content.traceback.map(String) : [],
      extra: {},
    };
  }
  if (!next) return st;
  const base = st.clearPending ? [] : st.outputs;
  const last = base[base.length - 1];
  if (next.output_type === 'stream' && last?.output_type === 'stream' && last.name === next.name)
    return {
      outputs: [...base.slice(0, -1), { ...last, text: collapseCarriageReturns(last.text + next.text) }],
      clearPending: false,
    };
  if (next.output_type === 'stream') next.text = collapseCarriageReturns(next.text);
  return { outputs: [...base, next], clearPending: false };
}

// ---------------- kernel API (main <-> renderer) ----------------

/** Whether notebooks can run here, and with what. */
export type JupyterStatus =
  | { ok: true; python: string; version: string }
  | {
      ok: false;
      /** no-python: no interpreter found; no-jupyter: Python without jupyter_server/ipykernel. */
      reason: 'no-python' | 'no-jupyter';
      /** Interpreters that were tried. */
      tried: string[];
    };

export interface KernelInfo {
  name: string;
  displayName: string;
  language: string;
}

export type KernelState = 'starting' | 'idle' | 'busy' | 'restarting' | 'dead';

export type NotebookEvent =
  | { kind: 'kernel'; path: string; state: KernelState; message?: string }
  | { kind: 'output'; path: string; cellId: string; msgType: string; content: JsonObject }
  | {
      kind: 'done';
      path: string;
      cellId: string;
      status: 'ok' | 'error' | 'aborted';
      executionCount: number | null;
    };

/** pip line shown when Jupyter is missing (the editor never pretends to run cells). */
export const JUPYTER_INSTALL = 'python -m pip install jupyter_server ipykernel';

// ---------------- Fase 2A mejoras: ANSI colors, .py export, completions, variables ----------------

/** A run of output text with the terminal style it was printed with. */
export interface AnsiSpan {
  text: string;
  /** 0–15 = the 16 terminal colors (a class), or a CSS "rgb(…)" for 256-color / true color. */
  fg?: number | string;
  bg?: number | string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

function color256(n: number): number | string {
  if (n < 16) return n;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const c = (x: number) => (x ? 55 + x * 40 : 0);
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
}

type AnsiStyle = Omit<AnsiSpan, 'text'>;
const sameStyle = (a: AnsiStyle, b: AnsiStyle) =>
  a.fg === b.fg &&
  a.bg === b.bg &&
  !!a.bold === !!b.bold &&
  !!a.dim === !!b.dim &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline;

/**
 * Splits text with ANSI SGR codes (IPython tracebacks, colored logs) into styled runs.
 * Other escape codes (cursor moves, window titles) are dropped.
 */
export function ansiSpans(s: string): AnsiSpan[] {
  const out: AnsiSpan[] = [];
  let st: AnsiStyle = {};
  const re = /\u001b\[([0-9;?]*)([A-Za-z])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev, st)) prev.text += text;
    else out.push({ text, ...st });
  };
  for (let m = re.exec(s); m; m = re.exec(s)) {
    push(s.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== 'm') continue;
    const codes = (m[1] || '0').split(';').map((x) => Number(x || 0));
    const next: AnsiStyle = { ...st };
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!;
      if (c === 0) {
        delete next.fg;
        delete next.bg;
        delete next.bold;
        delete next.dim;
        delete next.italic;
        delete next.underline;
      } else if (c === 1) next.bold = true;
      else if (c === 2) next.dim = true;
      else if (c === 3) next.italic = true;
      else if (c === 4) next.underline = true;
      else if (c === 22) {
        delete next.bold;
        delete next.dim;
      } else if (c === 23) delete next.italic;
      else if (c === 24) delete next.underline;
      else if (c >= 30 && c <= 37) next.fg = c - 30;
      else if (c >= 90 && c <= 97) next.fg = c - 90 + 8;
      else if (c === 39) delete next.fg;
      else if (c >= 40 && c <= 47) next.bg = c - 40;
      else if (c >= 100 && c <= 107) next.bg = c - 100 + 8;
      else if (c === 49) delete next.bg;
      else if (c === 38 || c === 48) {
        const key = c === 38 ? 'fg' : 'bg';
        if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
          next[key] = color256(Math.max(0, Math.min(255, codes[i + 2]!)));
          i += 2;
        } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
          const [r, g, b] = [codes[i + 2]!, codes[i + 3]!, codes[i + 4]!].map((v) =>
            Math.max(0, Math.min(255, v)),
          );
          next[key] = `rgb(${r},${g},${b})`;
          i += 4;
        }
      }
    }
    st = next;
  }
  push(s.slice(last));
  return out;
}

/**
 * The notebook as a script in the "percent" format that VS Code, Spyder, PyCharm and jupytext
 * read back as cells: `# %%` before code, `# %% [markdown]` with the text commented out.
 */
export function notebookToScript(nb: Notebook): string {
  const lang = notebookLanguage(nb);
  const comment = ['python', 'julia', 'r', 'ruby', 'bash', 'sh', 'perl'].includes(lang) ? '#' : '//';
  const parts: string[] = [];
  for (const c of nb.cells) {
    const src = c.source.replace(/\s+$/, '');
    if (c.cell_type === 'code') parts.push(`${comment} %%\n${src}`);
    else
      parts.push(
        `${comment} %% [${c.cell_type === 'markdown' ? 'markdown' : 'raw'}]\n` +
          src
            .split('\n')
            .map((l) => (l ? `${comment} ${l}` : comment))
            .join('\n'),
      );
  }
  return `${parts.join('\n\n')}\n`;
}

/** File extension of the exported script. */
export function scriptExtension(nb: Notebook): string {
  const li = nb.metadata.language_info;
  const ext = isObj(li) && typeof li.file_extension === 'string' ? li.file_extension : '';
  if (/^\.[A-Za-z0-9]{1,8}$/.test(ext)) return ext;
  const lang = notebookLanguage(nb);
  return lang === 'julia' ? '.jl' : lang === 'r' ? '.r' : lang === 'javascript' ? '.js' : '.py';
}

/** UTF-16 offset (JavaScript strings) → Unicode code points (Jupyter's cursor_pos). */
export function toCodePoints(s: string, offset: number): number {
  return [...s.slice(0, offset)].length;
}

/** Unicode code points (Jupyter) → UTF-16 offset in the same string. */
export function fromCodePoints(s: string, cp: number): number {
  let n = 0;
  let i = 0;
  for (const ch of s) {
    if (n >= cp) break;
    i += ch.length;
    n++;
  }
  return i;
}

export interface NbCompletion {
  text: string;
  /** function, class, module, keyword, instance, statement, param, path, property… */
  type?: string;
  signature?: string;
}

export interface NbCompletions {
  /** Replaced range, as UTF-16 offsets of the cell's code. */
  start: number;
  end: number;
  matches: NbCompletion[];
}

/** complete_reply → matches (with their kind when the kernel says it). */
export function parseCompleteReply(code: string, content: JsonObject): NbCompletions | null {
  if (content.status !== 'ok' || !Array.isArray(content.matches)) return null;
  const start = fromCodePoints(code, Number(content.cursor_start ?? 0));
  const end = fromCodePoints(code, Number(content.cursor_end ?? 0));
  const meta = isObj(content.metadata) ? content.metadata._jupyter_types_experimental : undefined;
  const types = new Map<string, { type?: string; signature?: string }>();
  if (Array.isArray(meta))
    for (const t of meta)
      if (isObj(t) && typeof t.text === 'string')
        types.set(t.text, {
          ...(typeof t.type === 'string' && t.type !== '<unknown>' ? { type: t.type } : {}),
          ...(typeof t.signature === 'string' && t.signature ? { signature: t.signature } : {}),
        });
  const seen = new Set<string>();
  const matches: NbCompletion[] = [];
  for (const m of content.matches)
    if (typeof m === 'string' && !seen.has(m)) {
      seen.add(m);
      matches.push({ text: m, ...types.get(m) });
    }
  return { start, end, matches };
}

/** One variable of the kernel, for the variables panel and notebook_variables. */
export interface NbVariable {
  name: string;
  type: string;
  /** "3x4" for arrays and data frames. */
  shape: string;
  /** len() when the value has one, else -1. */
  size: number;
  /** Short repr (≤ 200 characters). */
  value: string;
}

/**
 * Python run silently (no history, no execution count) to list the user's variables; the
 * result comes back as a user_expression, base64 JSON so no quoting can break it. Modules,
 * functions, classes and IPython's own names are left out.
 */
export const PY_VARIABLES_CODE = `def __zinarix_vars():
    import base64, json, reprlib
    r = reprlib.Repr()
    r.maxstring = 200; r.maxother = 200; r.maxlist = 20; r.maxdict = 20; r.maxlevel = 2
    skip = {'In', 'Out', 'exit', 'quit', 'get_ipython'}
    hide = {'module', 'function', 'builtin_function_or_method', 'type', 'method', 'ABCMeta'}
    out = []
    for n, v in list(get_ipython().user_ns.items()):
        if n.startswith('_') or n in skip:
            continue
        t = type(v)
        if t.__name__ in hide:
            continue
        try:
            sh = getattr(v, 'shape', None)
            shape = 'x'.join(str(x) for x in sh) if isinstance(sh, tuple) else ''
        except Exception:
            shape = ''
        try:
            size = len(v)
        except Exception:
            size = -1
        try:
            val = r.repr(v)
        except Exception:
            val = '<?>'
        if len(val) > 200:
            val = val[:200] + '...'
        mod = getattr(t, '__module__', '') or ''
        name = t.__name__ if mod in ('builtins', '') else mod.split('.')[0] + '.' + t.__name__
        out.append([n, name, shape, size if isinstance(size, int) else -1, val])
        if len(out) >= 500:
            break
    return base64.b64encode(json.dumps(out).encode()).decode()
`;
export const PY_VARIABLES_EXPR = '__zinarix_vars()';

/** The user_expression of PY_VARIABLES_CODE → variables (null when it failed). */
export function parseVariables(expr: Json | undefined): NbVariable[] | null {
  if (!isObj(expr) || expr.status !== 'ok' || !isObj(expr.data)) return null;
  const raw = mimeText(expr.data['text/plain']).trim().replace(/^['"]|['"]$/g, '');
  let rows: unknown;
  try {
    rows = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((r): r is unknown[] => Array.isArray(r) && r.length === 5)
    .map(([name, type, shape, size, value]) => ({
      name: String(name),
      type: String(type),
      shape: String(shape),
      size: typeof size === 'number' ? size : -1,
      value: String(value),
    }));
}
