/**
 * Playground model (Phase 9): the request the panel builds, JSON Schema validation of
 * structured replies, "Get code" snippets and versioned prompt templates. Pure: no
 * Electron, no network, so main, the renderer and the tests share it.
 */

export type Reasoning = 'low' | 'medium' | 'high';

export interface PlaygroundAttachment {
  name: string;
  mediaType: string;
  /** base64 */
  data: string;
}

export interface PlaygroundTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Everything the Playground sends; also what a template version stores (minus attachments). */
export interface PlaygroundParams {
  system: string;
  prompt: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoning?: Reasoning;
  tools: PlaygroundTool[];
  /** JSON Schema text as the user typed it; empty = free text reply. */
  schema: string;
  /** Exact enforcement (OpenAI strict); only offered when the schema allows it. */
  strict?: boolean;
}

export interface PlaygroundRunRequest extends PlaygroundParams {
  /** "provider/model" */
  model: string;
  attachments: PlaygroundAttachment[];
}

export interface JsonCheck {
  ok: boolean;
  /** The reply parsed as JSON (absent when it is not JSON). */
  parsed?: boolean;
  errors: string[];
}

export interface PlaygroundResult {
  model: string;
  provider?: string;
  text: string;
  reasoning: string;
  toolCalls: { name: string; arguments: string }[];
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
  latencyMs: number;
  /** Time to first streamed token. */
  firstTokenMs?: number;
  stopReason?: string;
  json?: JsonCheck;
  error?: string;
  notices: string[];
}

export type PlaygroundEvent =
  | { type: 'start'; provider: string; model: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'notice'; message: string }
  | { type: 'done'; result: PlaygroundResult };

export const EMPTY_PARAMS: PlaygroundParams = {
  system: '',
  prompt: '',
  tools: [],
  schema: '',
};

// ---------- attachments ----------

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const EXT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

/** MIME type of a file the Playground accepts, or null. */
export function attachmentType(name: string, reported = ''): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const t = EXT_TYPES[ext];
  if (t) return t;
  return /^(image|audio|video)\//.test(reported) || reported === 'application/pdf' ? reported : null;
}

export type AttachmentKind = 'image' | 'pdf' | 'audio' | 'video' | 'text';
export function attachmentKind(mediaType: string): AttachmentKind {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType === 'application/pdf') return 'pdf';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('video/')) return 'video';
  return 'text';
}

/**
 * Which attachment kinds an adapter sends natively (the rest arrive as a text note).
 * Mirrors packages/providers: keep both in step.
 */
export function adapterAccepts(adapter: string): AttachmentKind[] {
  switch (adapter) {
    case 'google-gemini':
    case 'google-vertex':
      return ['image', 'pdf', 'audio', 'video', 'text'];
    case 'anthropic':
    case 'openai-responses':
    case 'aws-bedrock':
      return ['image', 'pdf', 'text'];
    case 'openai-compatible':
      return ['image', 'pdf', 'audio', 'text'];
    default:
      return ['image', 'text'];
  }
}

// ---------- schema ----------

export interface ParsedSchema {
  schema?: Record<string, unknown>;
  error?: string;
}

/** Parses the schema box. Empty = no structured output. */
export function parseSchema(text: string): ParsedSchema {
  if (!text.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { error: `JSON inválido: ${(e as Error).message}` };
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return { error: 'El esquema debe ser un objeto JSON.' };
  const s = v as Record<string, unknown>;
  // Every provider wants an object at the root of a structured reply.
  if (s.type !== 'object') return { error: 'La raíz del esquema debe ser "type": "object".' };
  return { schema: s };
}

/**
 * True when OpenAI strict mode accepts the schema: every object sets
 * additionalProperties:false and lists every property in required.
 */
export function isStrictCompatible(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return true;
  if (Array.isArray(schema)) return schema.every(isStrictCompatible);
  const s = schema as Record<string, unknown>;
  const isObject = s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'));
  if (isObject) {
    if (s.additionalProperties !== false) return false;
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const req = Array.isArray(s.required) ? s.required : [];
    if (Object.keys(props).some((k) => !req.includes(k))) return false;
  }
  for (const [k, v] of Object.entries(s)) {
    if (k === 'properties' && v && typeof v === 'object') {
      if (!Object.values(v).every(isStrictCompatible)) return false;
    } else if (['items', 'anyOf', 'oneOf', 'allOf', '$defs', 'definitions'].includes(k)) {
      const inner = k === '$defs' || k === 'definitions' ? Object.values(v ?? {}) : v;
      if (!isStrictCompatible(inner)) return false;
    }
  }
  return true;
}

/** The reply as JSON: tolerates surrounding whitespace and a ```json fence. */
export function parseJsonReply(text: string): { value?: unknown; error?: string } {
  let t = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(t);
  if (fence) t = fence[1]!.trim();
  try {
    return { value: JSON.parse(t) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
}

/**
 * Validates a value against the JSON Schema keywords structured outputs use (type, enum,
 * const, properties, required, additionalProperties, items, anyOf/oneOf/allOf, $ref to
 * $defs, min/max length and items, minimum/maximum, pattern). Unknown keywords are ignored.
 * Returns readable errors with a JSON path; empty = valid.
 */
export function validateJson(value: unknown, schema: unknown, max = 20): string[] {
  const errors: string[] = [];
  const root = (schema ?? {}) as Record<string, unknown>;
  const resolve = (s: Record<string, unknown>): Record<string, unknown> => {
    const ref = s.$ref;
    if (typeof ref !== 'string') return s;
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
    const defs = m ? (root[m[1]!] as Record<string, unknown> | undefined) : undefined;
    const target = m && defs ? defs[decodeURIComponent(m[2]!)] : undefined;
    return target && typeof target === 'object' ? (target as Record<string, unknown>) : {};
  };
  const walk = (v: unknown, raw: unknown, path: string, depth: number): void => {
    if (errors.length >= max || depth > 64) return;
    if (raw === true || raw === undefined) return;
    if (raw === false) {
      errors.push(`${path}: no se permite ningún valor`);
      return;
    }
    if (typeof raw !== 'object' || raw === null) return;
    const s = resolve(raw as Record<string, unknown>);
    const push = (msg: string) => errors.push(`${path}: ${msg}`);
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
      if (!types.some((t) => typeMatches(v, t))) {
        push(`se esperaba ${types.join(' o ')}, llegó ${typeOf(v)}`);
        return;
      }
    }
    if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v)))
      push(`debe ser uno de ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    if (s.const !== undefined && JSON.stringify(s.const) !== JSON.stringify(v))
      push(`debe ser ${JSON.stringify(s.const)}`);
    for (const key of ['anyOf', 'oneOf'] as const) {
      const variants = s[key];
      if (!Array.isArray(variants)) continue;
      const passing = variants.filter((sub) => validateJsonFrom(v, sub, root).length === 0).length;
      if (key === 'anyOf' ? passing === 0 : passing !== 1)
        push(
          key === 'anyOf'
            ? 'no cumple ninguna de las opciones (anyOf)'
            : `debe cumplir exactamente una opción (oneOf), cumple ${passing}`,
        );
    }
    if (Array.isArray(s.allOf)) for (const sub of s.allOf) walk(v, sub, path, depth + 1);
    if (typeof v === 'string') {
      if (typeof s.minLength === 'number' && v.length < s.minLength)
        push(`mínimo ${s.minLength} caracteres`);
      if (typeof s.maxLength === 'number' && v.length > s.maxLength)
        push(`máximo ${s.maxLength} caracteres`);
      if (typeof s.pattern === 'string') {
        try {
          if (!new RegExp(s.pattern, 'u').test(v)) push(`no coincide con ${s.pattern}`);
        } catch {
          /* a pattern JS can't compile is not the reply's fault */
        }
      }
    }
    if (typeof v === 'number') {
      if (typeof s.minimum === 'number' && v < s.minimum) push(`mínimo ${s.minimum}`);
      if (typeof s.maximum === 'number' && v > s.maximum) push(`máximo ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === 'number' && v.length < s.minItems)
        push(`mínimo ${s.minItems} elementos`);
      if (typeof s.maxItems === 'number' && v.length > s.maxItems)
        push(`máximo ${s.maxItems} elementos`);
      if (s.items !== undefined && !Array.isArray(s.items))
        v.forEach((item, i) => walk(item, s.items, `${path}[${i}]`, depth + 1));
    }
    if (typeOf(v) === 'object') {
      const obj = v as Record<string, unknown>;
      const props = (s.properties ?? {}) as Record<string, unknown>;
      if (Array.isArray(s.required))
        for (const r of s.required)
          if (typeof r === 'string' && !(r in obj)) push(`falta la propiedad "${r}"`);
      for (const [k, child] of Object.entries(obj)) {
        if (k in props) walk(child, props[k], `${path}.${k}`, depth + 1);
        else if (s.additionalProperties === false) push(`propiedad no permitida "${k}"`);
        else if (typeof s.additionalProperties === 'object')
          walk(child, s.additionalProperties, `${path}.${k}`, depth + 1);
      }
    }
  };
  walk(value, root, '$', 0);
  return errors.slice(0, max);
}

/** validateJson for a sub-schema that shares the root's $defs. */
function validateJsonFrom(value: unknown, sub: unknown, root: Record<string, unknown>): string[] {
  if (typeof sub !== 'object' || sub === null) return validateJson(value, sub);
  const defs = {
    ...(root.$defs ? { $defs: root.$defs } : {}),
    ...(root.definitions ? { definitions: root.definitions } : {}),
  };
  return validateJson(value, { ...defs, ...(sub as Record<string, unknown>) });
}

/** Checks a finished reply against the schema it was asked to follow. */
export function checkReply(text: string, schema: Record<string, unknown>): JsonCheck {
  const p = parseJsonReply(text);
  if (p.error !== undefined) return { ok: false, parsed: false, errors: [`No es JSON: ${p.error}`] };
  const errors = validateJson(p.value, schema);
  return { ok: errors.length === 0, parsed: true, errors };
}

// ---------- compare ----------

export const MAX_COMPARE = 4;

/** Badges for the comparison table: cheapest, fastest and fewest output tokens among the OK ones. */
export function compareBadges(results: PlaygroundResult[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const ok = results.map((r, i) => ({ r, i })).filter(({ r }) => !r.error);
  if (ok.length < 2) return out;
  const add = (i: number, b: string) => out.set(i, [...(out.get(i) ?? []), b]);
  const priced = ok.filter(({ r }) => r.usd !== null);
  if (priced.length >= 2) {
    const min = Math.min(...priced.map(({ r }) => r.usd!));
    for (const { r, i } of priced) if (r.usd === min) add(i, 'cheapest');
  }
  const fast = Math.min(...ok.map(({ r }) => r.latencyMs));
  for (const { r, i } of ok) if (r.latencyMs === fast) add(i, 'fastest');
  return out;
}

// ---------- templates ----------

export interface TemplateVersion {
  v: number;
  savedAt: number;
  params: PlaygroundParams;
  /** Model the version was tried with (informative). */
  model?: string;
  note?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  versions: TemplateVersion[];
}

export const MAX_VERSIONS = 50;

function sameParams(a: PlaygroundParams, b: PlaygroundParams): boolean {
  return JSON.stringify(normalizeParams(a)) === JSON.stringify(normalizeParams(b));
}

/** Keeps only the fields a template stores, with stable key order. */
export function normalizeParams(p: Partial<PlaygroundParams>): PlaygroundParams {
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const tools = Array.isArray(p.tools)
    ? p.tools
        .filter((t) => t && typeof t.name === 'string')
        .map((t) => ({
          name: String(t.name),
          description: String(t.description ?? ''),
          parameters:
            t.parameters && typeof t.parameters === 'object'
              ? t.parameters
              : { type: 'object', properties: {} },
        }))
    : [];
  const r = p.reasoning;
  return {
    system: String(p.system ?? ''),
    prompt: String(p.prompt ?? ''),
    ...(num(p.temperature) !== undefined ? { temperature: num(p.temperature) } : {}),
    ...(num(p.topP) !== undefined ? { topP: num(p.topP) } : {}),
    ...(num(p.maxTokens) !== undefined ? { maxTokens: num(p.maxTokens) } : {}),
    ...(r === 'low' || r === 'medium' || r === 'high' ? { reasoning: r } : {}),
    tools,
    schema: String(p.schema ?? ''),
    ...(p.strict ? { strict: true } : {}),
  };
}

/**
 * Saves params as the next version of a template. Saving what the latest version already
 * holds changes nothing (returns the same object). Oldest versions drop past MAX_VERSIONS.
 */
export function addVersion(
  tpl: PromptTemplate,
  params: PlaygroundParams,
  now: number,
  extra: { model?: string; note?: string } = {},
): PromptTemplate {
  const last = tpl.versions[tpl.versions.length - 1];
  if (last && sameParams(last.params, params) && !extra.note) return tpl;
  const v = (last?.v ?? 0) + 1;
  const version: TemplateVersion = {
    v,
    savedAt: now,
    params: normalizeParams(params),
    ...(extra.model ? { model: extra.model } : {}),
    ...(extra.note ? { note: extra.note.slice(0, 200) } : {}),
  };
  return { ...tpl, versions: [...tpl.versions, version].slice(-MAX_VERSIONS) };
}

/** Line diff summary between two versions, for the history list ("+3 −1 líneas"). */
export function versionDelta(a: PlaygroundParams, b: PlaygroundParams): { added: number; removed: number } {
  const lines = (p: PlaygroundParams) =>
    [p.system, p.prompt, p.schema, JSON.stringify(p.tools)].join('\n').split('\n');
  const before = lines(a);
  const after = lines(b);
  const count = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const ca = count(before);
  const cb = count(after);
  let added = 0;
  let removed = 0;
  for (const [k, n] of cb) added += Math.max(0, n - (ca.get(k) ?? 0));
  for (const [k, n] of ca) removed += Math.max(0, n - (cb.get(k) ?? 0));
  return { added, removed };
}

/** Fills {{variables}} of a template prompt. Unknown names stay as written. */
export function fillVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}

export function templateVariables(p: PlaygroundParams): string[] {
  const out = new Set<string>();
  for (const m of `${p.system}\n${p.prompt}`.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) out.add(m[1]!);
  return [...out];
}
