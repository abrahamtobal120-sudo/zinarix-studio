import { balanced, godotString, headerAttrs } from './games.js';

/**
 * Editing Godot .tscn scenes as text (Fase 6 del plan de funciones): set or remove a node's
 * property, add / remove / rename / reorder nodes, connect signals and attach scripts. Every
 * function takes the scene text and returns the new text, touching only the lines it must
 * (the rest of the file, its comments and line endings stay as they were), so the Scene view
 * and the AI edit the same document the user sees and can undo it. Bad input throws.
 */

const HEAD =
  /^\[(gd_scene|gd_resource|ext_resource|sub_resource|node|connection|editable|resource)\b/;

interface Sec {
  kind: string;
  attrs: Record<string, string>;
  /** Line of the header. */
  start: number;
  /** First line after the header. */
  body: number;
  /** First line of the next section (or the end). */
  end: number;
  /** Node path from the root ("." for the root). */
  path?: string;
}

interface Doc {
  eol: string;
  lines: string[];
  secs: Sec[];
}

function load(text: string): Doc {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const secs: Sec[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (HEAD.test(t)) {
      if (secs.length) secs[secs.length - 1]!.end = i;
      const start = i;
      let header = t;
      while (!balanced(header) && i + 1 < lines.length) header += ` ${lines[++i]!.trim()}`;
      const kind = /^\[(\w+)/.exec(header)![1]!;
      const attrs = headerAttrs(header.slice(kind.length + 1, -1));
      const sec: Sec = { kind, attrs, start, body: i + 1, end: lines.length };
      if (kind === 'node') {
        const name = attrs.name !== undefined ? godotString(attrs.name) : '?';
        const parent = attrs.parent !== undefined ? godotString(attrs.parent) : null;
        sec.path = parent === null ? '.' : parent === '.' ? name : `${parent}/${name}`;
      }
      secs.push(sec);
      continue;
    }
    // Multi-line values (arrays, dictionaries, strings) are not headers.
    const eq = lines[i]!.indexOf('=');
    if (secs.length && eq > 0) {
      let v = lines[i]!.slice(eq + 1).trim();
      while (!balanced(v) && i + 1 < lines.length) v += `\n${lines[++i]}`;
    }
  }
  return { eol, lines, secs };
}

const save = (d: Doc) => d.lines.join(d.eol);

/** Last line of a section that is not blank, +1. */
function bodyEnd(d: Doc, s: Sec): number {
  let e = s.end;
  while (e > s.body && !d.lines[e - 1]!.trim()) e--;
  return e;
}

function props(d: Doc, s: Sec): { key: string; from: number; to: number }[] {
  const out: { key: string; from: number; to: number }[] = [];
  for (let i = s.body; i < s.end; i++) {
    const line = d.lines[i]!;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const from = i;
    let v = line.slice(eq + 1).trim();
    while (!balanced(v) && i + 1 < s.end) v += `\n${d.lines[++i]}`;
    out.push({ key: line.slice(0, eq).trim(), from, to: i + 1 });
  }
  return out;
}

const nodes = (d: Doc) => d.secs.filter((s) => s.kind === 'node');

function node(d: Doc, path: string): Sec {
  const p = normPath(path);
  const s = nodes(d).find((n) => n.path === p);
  if (!s) throw new Error(`No node "${path}" in the scene.`);
  return s;
}

/** "Main/Player" or "./Player" → "Player" when Main is the root; "" / "." / root name → ".". */
function normPath(path: string): string {
  const p = path.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (!p || p === '.') return '.';
  return p;
}

/** Rewrites one attribute of a header (adds it before "]" when missing). */
function setAttr(d: Doc, s: Sec, key: string, raw: string): void {
  let header = d.lines
    .slice(s.start, s.body)
    .map((l) => l.trim())
    .join(' ');
  const re = new RegExp(`(\\b${key}\\s*=\\s*)("(?:[^"\\\\]|\\\\.)*"|[^\\s\\]]+)`);
  if (re.test(header)) header = header.replace(re, (_m, a: string) => `${a}${raw}`);
  else header = header.replace(/\]\s*$/, ` ${key}=${raw}]`);
  d.lines.splice(s.start, s.body - s.start, header);
}

// ───────────────────────── values ─────────────────────────

/** A Godot string literal. */
export function godotQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
}

/** Property names: position, theme_override_colors/font_color, metadata/_edit_lock_. */
export function validPropKey(k: unknown): k is string {
  return typeof k === 'string' && k.length <= 120 && /^[A-Za-z_][\w]*(?:[/:][\w]+)*$/.test(k);
}

/** One Godot value on one line: balanced brackets and quotes, nothing after it. */
export function validGodotValue(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (!t || t.length > 4000 || /[\r\n]/.test(t)) return false;
  let depth = 0;
  let str = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (str) {
      if (c === '\\') i++;
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') str = true;
    else if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c) && --depth < 0) return false;
    else if (c === ';' && depth === 0) return false;
  }
  return depth === 0 && !str;
}

/** Godot forbids . : @ / " % in node names. */
export function validNodeName(n: unknown): n is string {
  return (
    typeof n === 'string' &&
    n.trim() === n &&
    n.length > 0 &&
    n.length <= 100 &&
    !/[.:@/"%\[\]\r\n\\]/.test(n)
  );
}

export function validNodeType(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Z][A-Za-z0-9_]{0,63}$/.test(t);
}

export function validSignalName(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z_]\w{0,99}$/.test(s);
}

export type ValueKind =
  'bool' | 'int' | 'float' | 'string' | 'color' | 'vector2' | 'vector3' | 'other';

export function valueKind(v: string): ValueKind {
  const t = v.trim();
  if (t === 'true' || t === 'false') return 'bool';
  if (/^-?\d+$/.test(t)) return 'int';
  if (/^-?(\d+\.\d*|\.\d+|\d+)(e[-+]?\d+)?$/i.test(t)) return 'float';
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return 'string';
  if (/^Color\(\s*[-\d.e\s,]+\)$/i.test(t)) return 'color';
  if (/^Vector2i?\(\s*[-\d.e]+\s*,\s*[-\d.e]+\s*\)$/i.test(t)) return 'vector2';
  if (/^Vector3i?\(\s*[-\d.e]+\s*,\s*[-\d.e]+\s*,\s*[-\d.e]+\s*\)$/i.test(t)) return 'vector3';
  return 'other';
}

/** The numbers inside Vector2(…) / Color(…). */
export function valueNumbers(v: string): number[] {
  return (/\(([^)]*)\)/.exec(v)?.[1] ?? '').split(',').map((x) => Number(x.trim()));
}

/** A float the way Godot writes it (1 → "1.0"). */
export function godotFloat(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  const r = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(r) ? `${r}.0` : String(r);
}

const num = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** #rrggbb + alpha → Color(r, g, b, a) with 0–1 channels. */
export function colorFromHex(hex: string, alpha = 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error('Bad color.');
  const v = parseInt(m[1]!, 16);
  const c = (x: number) => num(Math.round((x / 255) * 10000) / 10000);
  return `Color(${c((v >> 16) & 255)}, ${c((v >> 8) & 255)}, ${c(v & 255)}, ${num(Math.max(0, Math.min(1, alpha)))})`;
}

export function hexFromColor(v: string): { hex: string; alpha: number } {
  const [r = 0, g = 0, b = 0, a = 1] = valueNumbers(v);
  const c = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return { hex: `#${c(r)}${c(g)}${c(b)}`, alpha: Math.max(0, Math.min(1, a)) };
}

/** Builds a value of the same kind as `like` from what the user typed. */
export function valueLike(like: string, typed: string): string {
  const t = typed.trim();
  switch (valueKind(like)) {
    case 'int':
      if (/^-?\d+$/.test(t)) return t;
      break;
    case 'float':
      if (t !== '' && Number.isFinite(Number(t)))
        return /[.e]/i.test(t) ? t : godotFloat(Number(t));
      break;
    case 'string':
      if (!/^"/.test(t)) return godotQuote(typed);
      break;
  }
  return t;
}

// ───────────────────────── node edits ─────────────────────────

/** Sets (value) or removes (null) a property of a node; value is a raw Godot value. */
export function setNodeProp(text: string, path: string, key: string, value: string | null): string {
  if (!validPropKey(key)) throw new Error(`Bad property name "${key}".`);
  if (value !== null && !validGodotValue(value))
    throw new Error(
      `Bad value for ${key}: one Godot value on one line (e.g. 1.0, "text", Vector2(10, 20), Color(1, 0, 0, 1)).`,
    );
  const d = load(text);
  const s = node(d, path);
  const have = props(d, s).find((p) => p.key === key);
  const line = value === null ? null : `${key} = ${value.trim()}`;
  if (have) {
    if (line === null) d.lines.splice(have.from, have.to - have.from);
    else d.lines.splice(have.from, have.to - have.from, line);
  } else if (line !== null) {
    const at = bodyEnd(d, s);
    d.lines.splice(at, 0, line);
    // A section that was only a header followed directly by the next one: keep a blank line.
    if (at === s.end && at < d.lines.length - 1 && d.lines[at + 1]!.trim())
      d.lines.splice(at + 1, 0, '');
  } else return text;
  return save(d);
}

function children(d: Doc, path: string): Sec[] {
  return nodes(d).filter(
    (n) => n.path !== path && (path === '.' ? n.path !== '.' : n.path!.startsWith(`${path}/`)),
  );
}

function directChildren(d: Doc, path: string): Sec[] {
  return nodes(d).filter((n) => {
    const p = n.attrs.parent !== undefined ? godotString(n.attrs.parent) : null;
    return p === path;
  });
}

/** Adds a node under parent (at the end of its children). Returns the text and the new path. */
export function addNode(
  text: string,
  parent: string,
  name: string,
  type: string,
  initial: Record<string, string> = {},
): { text: string; path: string } {
  if (!validNodeName(name)) throw new Error(`Bad node name "${name}" (no . : @ / " %).`);
  if (!validNodeType(type))
    throw new Error(`Bad node class "${type}" (like Sprite2D, CollisionShape2D, Label).`);
  for (const [k, v] of Object.entries(initial)) {
    if (!validPropKey(k)) throw new Error(`Bad property name "${k}".`);
    if (!validGodotValue(v)) throw new Error(`Bad value for ${k}.`);
  }
  const d = load(text);
  const par = node(d, parent);
  const pp = par.path!;
  if (directChildren(d, pp).some((c) => (c.attrs.name ? godotString(c.attrs.name) : '') === name))
    throw new Error(`"${pp === '.' ? 'The root' : pp}" already has a child called "${name}".`);
  const block = [par, ...children(d, pp)];
  const last = block.reduce((a, b) => (b.start > a.start ? b : a));
  const at = bodyEnd(d, last);
  const lines = [
    '',
    `[node name=${godotQuote(name)} type=${godotQuote(type)} parent=${godotQuote(pp)}]`,
    ...Object.entries(initial).map(([k, v]) => `${k} = ${v.trim()}`),
  ];
  d.lines.splice(at, 0, ...lines);
  return { text: save(d), path: pp === '.' ? name : `${pp}/${name}` };
}

const under = (p: string, root: string) => p === root || p.startsWith(`${root}/`);

/** Removes a node, its children and the signal connections that involve them. */
export function removeNode(text: string, path: string): string {
  const d = load(text);
  const s = node(d, path);
  if (s.path === '.') throw new Error('The root node cannot be removed.');
  const p = s.path!;
  const gone = d.secs.filter((x) => {
    if (x.kind === 'node') return under(x.path!, p);
    if (x.kind === 'connection' || x.kind === 'editable') {
      const a = x.attrs;
      const from = a.from ? godotString(a.from) : '';
      const to = a.to ? godotString(a.to) : '';
      const ed = a.path ? godotString(a.path) : '';
      return (from && under(from, p)) || (to && under(to, p)) || (ed && under(ed, p));
    }
    return false;
  });
  for (const x of gone.sort((a, b) => b.start - a.start)) d.lines.splice(x.start, x.end - x.start);
  return save(d);
}

// ───────────────────────── node paths (rename follows the references) ─────────────────────────

const segs = (p: string) => (p === '.' ? [] : p.split('/'));
const joinSegs = (s: string[]) => (s.length ? s.join('/') : '.');

/**
 * A node path written relative to `holder` (NodePath("../Enemy"), $Sprite, get_node("A/B"))
 * as a scene path ("." = root). null for paths this file cannot follow: absolute (/root/…),
 * unique (%Name) or above the scene's root.
 */
export function resolveNodePath(holder: string, rel: string): string | null {
  if (!rel || rel.startsWith('/') || rel.startsWith('%')) return null;
  const out = segs(holder);
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else if (part.startsWith('%')) return null;
    else out.push(part);
  }
  return joinSegs(out);
}

/** The path from holder to target the way Godot writes it ("Sprite", "../Enemy", "."). */
export function relativeNodePath(holder: string, target: string): string {
  const a = segs(holder);
  const b = segs(target);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const r = [...a.slice(i).map(() => '..'), ...b.slice(i)];
  return r.length ? r.join('/') : '.';
}

/** A rename of one node: old and new scene path. */
export interface NodeRename {
  old: string;
  now: string;
  /** The node is a scene-unique node (%Name): its old and new name. */
  unique?: { old: string; now: string };
}

export const movedPath = (p: string, r: NodeRename) =>
  under(p, r.old) ? r.now + p.slice(r.old.length) : p;

/**
 * A path written in `holder` (before the rename) as it must read after it; null = unchanged.
 * Only the segment that names the renamed node changes, so the path keeps the way it was
 * written ("../Player" → "../Hero", "./Player/Sprite" → "./Hero/Sprite").
 */
export function renamedRef(rel: string, holder: string, r: NodeRename): string | null {
  const colon = rel.indexOf(':');
  const path = colon < 0 ? rel : rel.slice(0, colon);
  const suffix = colon < 0 ? '' : rel.slice(colon);
  if (r.unique && path === `%${r.unique.old}`) return `%${r.unique.now}${suffix}`;
  if (resolveNodePath(holder, path) === null) return null;
  const newName = r.now.split('/').pop()!;
  const at = segs(holder);
  let changed = false;
  const parts = path.split('/').map((part) => {
    if (part === '' || part === '.') return part;
    if (part === '..') {
      at.pop();
      return part;
    }
    at.push(part);
    if (joinSegs(at) === r.old) {
      changed = true;
      return newName;
    }
    return part;
  });
  return changed ? parts.join('/') + suffix : null;
}

const NODEPATH_IN_SCENE = /NodePath\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

/** A script attached to a node of the scene: what renaming means for its $paths. */
export interface ScriptRef {
  /** res:// path of the script. */
  res: string;
  /** Scene path of the node it is attached to (before the rename). */
  holder: string;
}

/** Scripts attached (as ext_resource) to the nodes of a scene. */
export function sceneScripts(text: string): ScriptRef[] {
  const d = load(text);
  const ext = new Map<string, string>();
  for (const x of d.secs)
    if (x.kind === 'ext_resource' && x.attrs.id && x.attrs.path)
      ext.set(godotString(x.attrs.id), godotString(x.attrs.path));
  const out: ScriptRef[] = [];
  for (const n of nodes(d))
    for (const p of props(d, n)) {
      if (p.key !== 'script') continue;
      const m = /ExtResource\(\s*"?([^")\s]+)"?\s*\)/.exec(d.lines[p.from]!);
      const res = m ? ext.get(m[1]!) : undefined;
      if (res && /\.gd$/i.test(res)) out.push({ res, holder: n.path! });
    }
  return out;
}

const IDENT_PATH = /^[A-Za-z_]\w*(?:\/[A-Za-z_]\w*)*$/;

/**
 * Updates the node paths of a GDScript attached to `holder` after a rename: $Path, $"Path",
 * %Unique, get_node / get_node_or_null / has_node("…"), NodePath("…") and ^"…". Comments are
 * left alone. Returns the new code and how many references changed.
 */
export function renameInScript(
  code: string,
  holder: string,
  r: NodeRename,
): { code: string; count: number } {
  let count = 0;
  const fix = (rel: string) => {
    const n = renamedRef(rel, holder, r);
    if (n !== null) count++;
    return n;
  };
  const lines = code.split('\n').map((line) => {
    const hash = codeEnd(line);
    let head = line.slice(0, hash);
    const tail = line.slice(hash);
    // Calls and literals with a quoted path.
    head = head.replace(
      /\b(get_node|get_node_or_null|has_node|NodePath)(\s*\(\s*)(["'])((?:(?!\3)[^\\]|\\.)*)\3/g,
      (m, fn: string, open: string, q: string, p: string) => {
        const n = fix(p);
        return n === null ? m : `${fn}${open}${q}${n}${q}`;
      },
    );
    head = head.replace(/\^(["'])((?:(?!\1)[^\\]|\\.)*)\1/g, (m, q: string, p: string) => {
      const n = fix(p);
      return n === null ? m : `^${q}${n}${q}`;
    });
    // $"…" / $'…'
    head = head.replace(/\$(["'])((?:(?!\1)[^\\]|\\.)*)\1/g, (m, q: string, p: string) => {
      const n = fix(p);
      return n === null ? m : `$${q}${n}${q}`;
    });
    // $Path/To/Node and %Unique (unquoted), outside string literals.
    head = outsideStrings(head, (part) =>
      part.replace(
        /([$%])([A-Za-z_]\w*(?:\/[A-Za-z_]\w*)*)/g,
        (m, sig: string, p: string, at: number, all: string) => {
          // %Name only as a node reference (not the modulo operator: "a % b", "x%2").
          if (sig === '%' && (!r.unique || /[\w)\]]\s*$/.test(all.slice(0, at)))) return m;
          const n = fix(sig === '%' ? `%${p}` : p);
          if (n === null) return m;
          if (sig === '%') return n;
          return IDENT_PATH.test(n) ? `$${n}` : `$"${n}"`;
        },
      ),
    );
    return head + tail;
  });
  return { code: lines.join('\n'), count };
}

/** Applies fn to the parts of a line of code that are not inside "…" or '…' (strings kept). */
function outsideStrings(line: string, fn: (part: string) => string): string {
  let out = '';
  let from = 0;
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '\\') i++;
      else if (c === q) {
        out += line.slice(from, i + 1);
        from = i + 1;
        q = null;
      }
    } else if (c === '"' || c === "'") {
      out += fn(line.slice(from, i));
      from = i;
      q = c;
    }
  }
  return out + (q ? line.slice(from) : fn(line.slice(from)));
}

/** Index where a GDScript line's comment starts (outside strings), or its length. */
function codeEnd(line: string): number {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#') return i;
  }
  return line.length;
}

/**
 * Renames a node and updates its children's parent paths, the signal connections and the
 * NodePath("…") values of the scene that point into it. `rename` says what moved, for the
 * scripts of the scene (renameInScript).
 */
export function renameNode(
  text: string,
  path: string,
  name: string,
): { text: string; path: string; rename?: NodeRename; refs: number } {
  if (!validNodeName(name)) throw new Error(`Bad node name "${name}" (no . : @ / " %).`);
  const d = load(text);
  const s = node(d, path);
  const old = s.path!;
  if (old === '.') {
    setAttr(d, s, 'name', godotQuote(name));
    return { text: save(d), path: '.', refs: 0 };
  }
  const parent = godotString(s.attrs.parent!);
  if (
    directChildren(d, parent).some(
      (c) => c !== s && (c.attrs.name ? godotString(c.attrs.name) : '') === name,
    )
  )
    throw new Error(`There is already a node called "${name}" there.`);
  const now = parent === '.' ? name : `${parent}/${name}`;
  const move = (p: string) => (under(p, old) ? now + p.slice(old.length) : p);
  const oldName = s.attrs.name ? godotString(s.attrs.name) : name;
  const unique = props(d, s).some(
    (p) => p.key === 'unique_name_in_owner' && /=\s*true\b/.test(d.lines[p.from]!),
  );
  const rn: NodeRename = { old, now, ...(unique ? { unique: { old: oldName, now: name } } : {}) };
  let refs = 0;
  // Bottom-up so the header rewrites (which can join lines) keep the indices of the others valid.
  for (const x of [...d.secs].sort((a, b) => b.start - a.start)) {
    // NodePath("…") values first: same line count, and they sit below the header.
    if (x.kind === 'node')
      for (let i = x.body; i < x.end; i++)
        d.lines[i] = d.lines[i]!.replace(NODEPATH_IN_SCENE, (m, p: string) => {
          const n = renamedRef(godotString(`"${p}"`), x.path!, rn);
          if (n === null) return m;
          refs++;
          return `NodePath(${godotQuote(n)})`;
        });
    if (x === s) setAttr(d, x, 'name', godotQuote(name));
    else if (x.kind === 'node' && x.attrs.parent && under(godotString(x.attrs.parent), old))
      setAttr(d, x, 'parent', godotQuote(move(godotString(x.attrs.parent))));
    else if (x.kind === 'connection') {
      for (const k of ['to', 'from'])
        if (x.attrs[k] && under(godotString(x.attrs[k]!), old))
          setAttr(d, x, k, godotQuote(move(godotString(x.attrs[k]!))));
    } else if (x.kind === 'editable' && x.attrs.path && under(godotString(x.attrs.path), old))
      setAttr(d, x, 'path', godotQuote(move(godotString(x.attrs.path))));
  }
  return { text: save(d), path: now, rename: rn, refs };
}

/** What renames do to the scripts of a scene: per script, the edits to apply in order. */
export interface ScriptRenames {
  res: string;
  edits: { holder: string; rename: NodeRename }[];
}

/** Collects, for each script of the scene (before the renames), the renames that concern it. */
export function scriptRenames(before: string, renames: NodeRename[]): ScriptRenames[] {
  if (!renames.length) return [];
  const out = new Map<string, ScriptRenames>();
  for (const sr of sceneScripts(before)) {
    // Each rename applies to the holder as it was named at that point.
    let holder = sr.holder;
    for (const r of renames) {
      const e = out.get(sr.res) ?? { res: sr.res, edits: [] };
      e.edits.push({ holder, rename: r });
      out.set(sr.res, e);
      holder = movedPath(holder, r);
    }
  }
  return [...out.values()];
}

/** Applies scriptRenames edits to a script's code. */
export function applyScriptRenames(
  code: string,
  sr: ScriptRenames,
): { code: string; count: number } {
  let c = code;
  let count = 0;
  for (const e of sr.edits) {
    const r = renameInScript(c, e.holder, e.rename);
    c = r.code;
    count += r.count;
  }
  return { code: c, count };
}

/** Moves a node one place up (-1) or down (1) among its siblings, with its children. */
export function moveNode(text: string, path: string, dir: -1 | 1): string {
  const d = load(text);
  const s = node(d, path);
  if (s.path === '.') throw new Error('The root node cannot move.');
  const sibs = directChildren(d, godotString(s.attrs.parent!));
  const i = sibs.indexOf(s);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return text;
  const span = (x: Sec) => {
    const all = [x, ...children(d, x.path!)];
    return { from: Math.min(...all.map((a) => a.start)), to: Math.max(...all.map((a) => a.end)) };
  };
  const [a, b] = dir < 0 ? [span(sibs[j]!), span(s)] : [span(s), span(sibs[j]!)];
  if (a.to !== b.from)
    throw new Error('The nodes are not in tree order in the file; reorder them in Godot.');
  const blockA = d.lines.slice(a.from, a.to);
  const blockB = d.lines.slice(b.from, b.to);
  // Keep the blank line that ends each block where it was.
  const trail = (x: string[]) => {
    let n = 0;
    while (n < x.length && !x[x.length - 1 - n]!.trim()) n++;
    return n;
  };
  const ta = trail(blockA);
  const tb = trail(blockB);
  const coreA = blockA.slice(0, blockA.length - ta);
  const coreB = blockB.slice(0, blockB.length - tb);
  d.lines.splice(
    a.from,
    a.to - a.from + b.to - b.from,
    ...coreB,
    ...blockA.slice(blockA.length - ta),
    ...coreA,
    ...blockB.slice(blockB.length - tb),
  );
  return save(d);
}

// ───────────────────────── signals and scripts ─────────────────────────

export function connectSignal(
  text: string,
  signal: string,
  from: string,
  to: string,
  method: string,
): string {
  if (!validSignalName(signal) || !validSignalName(method))
    throw new Error('Bad signal or method name.');
  const d = load(text);
  const f = node(d, from).path!;
  const t = node(d, to).path!;
  const exists = d.secs.some(
    (x) =>
      x.kind === 'connection' &&
      godotString(x.attrs.signal ?? '') === signal &&
      godotString(x.attrs.from ?? '') === f &&
      godotString(x.attrs.to ?? '') === t &&
      godotString(x.attrs.method ?? '') === method,
  );
  if (exists) return text;
  let end = d.lines.length;
  while (end > 0 && !d.lines[end - 1]!.trim()) end--;
  const firstConn = !d.secs.some((x) => x.kind === 'connection');
  d.lines.splice(
    end,
    0,
    ...(firstConn || end === 0 ? [''] : []),
    `[connection signal=${godotQuote(signal)} from=${godotQuote(f)} to=${godotQuote(t)} method=${godotQuote(method)}]`,
  );
  if (d.lines[d.lines.length - 1] !== '') d.lines.push('');
  return save(d);
}

export function disconnectSignal(
  text: string,
  signal: string,
  from: string,
  to: string,
  method?: string,
): string {
  const d = load(text);
  const f = normPath(from);
  const t = normPath(to);
  const gone = d.secs.filter(
    (x) =>
      x.kind === 'connection' &&
      godotString(x.attrs.signal ?? '') === signal &&
      godotString(x.attrs.from ?? '') === f &&
      godotString(x.attrs.to ?? '') === t &&
      (!method || godotString(x.attrs.method ?? '') === method),
  );
  if (!gone.length) throw new Error(`No connection ${from}.${signal} → ${to}.`);
  for (const x of gone.sort((a, b) => b.start - a.start)) d.lines.splice(x.start, x.end - x.start);
  return save(d);
}

/** Adds an [ext_resource] (reusing one with the same path and type). Returns the text and its id. */
export function addExtResource(
  text: string,
  type: string,
  res: string,
): { text: string; id: string } {
  if (!/^res:\/\/[^"\r\n]+$/.test(res) || res.split('/').includes('..'))
    throw new Error(`Bad resource path "${res}" (res://…).`);
  if (!validNodeType(type)) throw new Error(`Bad resource type "${type}".`);
  const d = load(text);
  const exts = d.secs.filter((x) => x.kind === 'ext_resource');
  const same = exts.find(
    (x) => godotString(x.attrs.path ?? '') === res && godotString(x.attrs.type ?? '') === type,
  );
  if (same) return { text, id: godotString(same.attrs.id ?? '') };
  const ids = new Set(exts.map((x) => godotString(x.attrs.id ?? '')));
  let n = exts.length + 1;
  while (ids.has(`${n}_zs`)) n++;
  const id = `${n}_zs`;
  const line = `[ext_resource type=${godotQuote(type)} path=${godotQuote(res)} id=${godotQuote(id)}]`;
  const after = exts.length
    ? exts[exts.length - 1]!
    : d.secs.find((x) => x.kind === 'gd_scene' || x.kind === 'gd_resource');
  if (!after) throw new Error('This is not a Godot scene (no [gd_scene] header).');
  const at = bodyEnd(d, after);
  d.lines.splice(at, 0, ...(exts.length ? [line] : ['', line]));
  // Old scenes count their resources in load_steps.
  const head = d.secs.find((x) => x.kind === 'gd_scene');
  if (head?.attrs.load_steps && /^\d+$/.test(head.attrs.load_steps))
    setAttr(d, head, 'load_steps', String(Number(head.attrs.load_steps) + 1));
  return { text: save(d), id };
}

/** Attaches a script (res://…gd) to a node; null detaches it. */
export function attachScript(text: string, path: string, res: string | null): string {
  if (res === null) return setNodeProp(text, path, 'script', null);
  node(load(text), path);
  const r = addExtResource(text, 'Script', res);
  return setNodeProp(r.text, path, 'script', `ExtResource(${godotQuote(r.id)})`);
}

/** A starter script for a node class. */
export function scriptTemplate(type: string): string {
  const t = validNodeType(type) ? type : 'Node';
  const body = /^(CharacterBody2D|CharacterBody3D|RigidBody2D|RigidBody3D|Area2D|Area3D)$/.test(t)
    ? 'func _physics_process(delta: float) -> void:\n\tpass\n'
    : 'func _process(delta: float) -> void:\n\tpass\n';
  return `extends ${t}\n\n\nfunc _ready() -> void:\n\tpass\n\n\n${body}`;
}

// ───────────────────────── batch (the AI tool) ─────────────────────────

export type SceneOp =
  | { op: 'set'; node: string; prop: string; value: string | null }
  | { op: 'add'; parent: string; name: string; type: string; props?: Record<string, string> }
  | { op: 'remove'; node: string }
  | { op: 'rename'; node: string; name: string }
  | { op: 'move'; node: string; dir: -1 | 1 }
  | { op: 'connect'; signal: string; from: string; to: string; method: string }
  | { op: 'disconnect'; signal: string; from: string; to: string; method?: string }
  | { op: 'script'; node: string; path: string | null };

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Checks the shape of AI-given ops (values are checked when applied). */
export function parseSceneOps(raw: unknown): SceneOp[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('ops: a non-empty list.');
  if (raw.length > 100) throw new Error('At most 100 ops at a time.');
  return raw.map((o, i): SceneOp => {
    const a = (o ?? {}) as Record<string, unknown>;
    switch (a.op) {
      case 'set':
        return {
          op: 'set',
          node: str(a.node) || '.',
          prop: str(a.prop),
          value:
            a.value === null
              ? null
              : typeof a.value === 'number' || typeof a.value === 'boolean'
                ? String(a.value)
                : str(a.value),
        };
      case 'add': {
        const p =
          a.props && typeof a.props === 'object'
            ? Object.fromEntries(
                Object.entries(a.props as Record<string, unknown>).map(([k, v]) => [
                  k,
                  typeof v === 'string' ? v : String(v),
                ]),
              )
            : undefined;
        return {
          op: 'add',
          parent: str(a.parent) || '.',
          name: str(a.name),
          type: str(a.type),
          props: p,
        };
      }
      case 'remove':
        return { op: 'remove', node: str(a.node) };
      case 'rename':
        return { op: 'rename', node: str(a.node), name: str(a.name) };
      case 'move':
        return { op: 'move', node: str(a.node), dir: a.dir === 'up' || a.dir === -1 ? -1 : 1 };
      case 'connect':
        return {
          op: 'connect',
          signal: str(a.signal),
          from: str(a.from) || '.',
          to: str(a.to) || '.',
          method: str(a.method),
        };
      case 'disconnect':
        return {
          op: 'disconnect',
          signal: str(a.signal),
          from: str(a.from) || '.',
          to: str(a.to) || '.',
          method: str(a.method) || undefined,
        };
      case 'script':
        return {
          op: 'script',
          node: str(a.node) || '.',
          path: a.path === null || a.path === '' ? null : str(a.path),
        };
    }
    throw new Error(
      `ops[${i}]: unknown op ${JSON.stringify(a.op)} (set, add, remove, rename, move, connect, disconnect, script).`,
    );
  });
}

export function describeSceneOp(o: SceneOp): string {
  switch (o.op) {
    case 'set':
      return o.value === null
        ? `${o.node}: quitar ${o.prop}`
        : `${o.node}.${o.prop} = ${o.value.length > 60 ? `${o.value.slice(0, 60)}…` : o.value}`;
    case 'add':
      return `añadir ${o.name} (${o.type}) en ${o.parent}`;
    case 'remove':
      return `borrar ${o.node} y sus hijos`;
    case 'rename':
      return `renombrar ${o.node} → ${o.name}`;
    case 'move':
      return `mover ${o.node} ${o.dir < 0 ? 'arriba' : 'abajo'}`;
    case 'connect':
      return `conectar ${o.from}.${o.signal} → ${o.to}.${o.method}()`;
    case 'disconnect':
      return `desconectar ${o.from}.${o.signal} → ${o.to}`;
    case 'script':
      return o.path ? `script de ${o.node}: ${o.path}` : `quitar el script de ${o.node}`;
  }
}

/** Applies ops in order; all or nothing (throws "ops[i]: …"). */
export function applySceneOps(text: string, ops: SceneOp[]): string {
  return applySceneOpsFull(text, ops).text;
}

/** applySceneOps, also giving the renames done (for the scripts: scriptRenames). */
export function applySceneOpsFull(
  text: string,
  ops: SceneOp[],
): { text: string; renames: NodeRename[] } {
  const renames: NodeRename[] = [];
  let t = text;
  ops.forEach((o, i) => {
    try {
      switch (o.op) {
        case 'set':
          t = setNodeProp(t, o.node, o.prop, o.value);
          break;
        case 'add':
          t = addNode(t, o.parent, o.name, o.type, o.props).text;
          break;
        case 'remove':
          t = removeNode(t, o.node);
          break;
        case 'rename': {
          const r = renameNode(t, o.node, o.name);
          t = r.text;
          if (r.rename) renames.push(r.rename);
          break;
        }
        case 'move':
          t = moveNode(t, o.node, o.dir);
          break;
        case 'connect':
          t = connectSignal(t, o.signal, o.from, o.to, o.method);
          break;
        case 'disconnect':
          t = disconnectSignal(t, o.signal, o.from, o.to, o.method);
          break;
        case 'script':
          t = attachScript(t, o.node, o.path);
          break;
      }
    } catch (e) {
      throw new Error(`ops[${i}] (${o.op}): ${(e as Error).message}`);
    }
  });
  return { text: t, renames };
}

/** Node classes offered when adding a node (any class name is accepted). */
export const COMMON_NODE_TYPES = [
  'Node',
  'Node2D',
  'Sprite2D',
  'AnimatedSprite2D',
  'CharacterBody2D',
  'RigidBody2D',
  'StaticBody2D',
  'Area2D',
  'CollisionShape2D',
  'CollisionPolygon2D',
  'Camera2D',
  'TileMapLayer',
  'Marker2D',
  'Path2D',
  'Line2D',
  'Polygon2D',
  'PointLight2D',
  'GPUParticles2D',
  'CPUParticles2D',
  'AudioStreamPlayer2D',
  'Timer',
  'AnimationPlayer',
  'Node3D',
  'MeshInstance3D',
  'CharacterBody3D',
  'RigidBody3D',
  'StaticBody3D',
  'Area3D',
  'CollisionShape3D',
  'Camera3D',
  'DirectionalLight3D',
  'OmniLight3D',
  'SpotLight3D',
  'WorldEnvironment',
  'GPUParticles3D',
  'AudioStreamPlayer3D',
  'Control',
  'CanvasLayer',
  'Label',
  'Button',
  'TextureRect',
  'ColorRect',
  'Panel',
  'VBoxContainer',
  'HBoxContainer',
  'MarginContainer',
  'ProgressBar',
  'LineEdit',
  'AudioStreamPlayer',
];
