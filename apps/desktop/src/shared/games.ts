/**
 * Fase 6 (plan de funciones): video games. Pure helpers shared by the main process (which
 * runs Godot) and the window (Games panel, .tscn viewer): reading project.godot and text
 * scenes, Godot's error output, project templates (Godot and web) and Unity / Unreal
 * project detection. No Node APIs here.
 */

// ───────────────────────── project.godot ─────────────────────────

export interface GodotProjectInfo {
  name: string;
  /** res:// path of run/main_scene ('' when unset). */
  mainScene: string;
  /** Engine version the project was saved with ("4.7"), from config/features. */
  version: string;
  /** "Forward Plus", "Mobile", "GL Compatibility"… */
  renderer: string;
  icon: string;
  /** Autoload singletons: name → res:// path. */
  autoloads: { name: string; path: string }[];
  /** Input map action names. */
  actions: string[];
  /** Window size from display/window/size/*. */
  width: number | null;
  height: number | null;
  /** config_version=5 is Godot 4; 4 or lower is Godot 3. */
  configVersion: number | null;
}

/** Splits an INI-like Godot file (project.godot, .tscn, .tres, export_presets.cfg). */
export function parseGodotIni(text: string): { section: string; key: string; value: string }[] {
  const out: { section: string; key: string; value: string }[] = [];
  let section = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t || t.startsWith(';') || t.startsWith('#')) continue;
    if (t.startsWith('[') && t.endsWith(']')) {
      section = t.slice(1, -1).trim();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Values may span several lines ({ … } dictionaries, long strings): join until balanced.
    while (i + 1 < lines.length && !balanced(value)) value += `\n${lines[++i]}`;
    out.push({ section, key, value });
  }
  return out;
}

export function balanced(v: string): boolean {
  let depth = 0;
  let str = false;
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (str) {
      if (c === '\\') i++;
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') str = true;
    else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
  }
  return depth <= 0 && !str;
}

/** "text" → text (Godot escapes), &"name" / ^"path" too; anything else as written. */
export function godotString(v: string): string {
  const m = /^[&^]?"([\s\S]*)"$/.exec(v.trim());
  if (!m) return v.trim();
  return m[1]!.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

export function parseProjectGodot(text: string): GodotProjectInfo {
  const entries = parseGodotIni(text);
  const get = (section: string, key: string) =>
    entries.find((e) => e.section === section && e.key === key)?.value;
  const features = get('application', 'config/features') ?? '';
  const feats = [...features.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  const num = (v: string | undefined) => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
  const cv = /^config_version\s*=\s*(\d+)/m.exec(text);
  return {
    name: godotString(get('application', 'config/name') ?? '') || 'Sin nombre',
    mainScene: godotString(get('application', 'run/main_scene') ?? ''),
    version: feats.find((f) => /^\d+\.\d+/.test(f)) ?? '',
    renderer:
      feats.find((f) => /forward|mobile|compatibility/i.test(f)) ??
      godotString(get('rendering', 'renderer/rendering_method') ?? ''),
    icon: godotString(get('application', 'config/icon') ?? ''),
    autoloads: entries
      .filter((e) => e.section === 'autoload')
      .map((e) => ({ name: e.key, path: godotString(e.value).replace(/^\*/, '') })),
    actions: entries.filter((e) => e.section === 'input').map((e) => e.key),
    width: num(get('display', 'window/size/viewport_width')),
    height: num(get('display', 'window/size/viewport_height')),
    configVersion: cv ? Number(cv[1]) : null,
  };
}

// ───────────────────────── .tscn scenes ─────────────────────────

export interface TscnResource {
  id: string;
  type: string;
  path?: string;
  /** Properties of a [sub_resource] (raw Godot values). */
  props?: Record<string, string>;
}

export interface TscnNode {
  name: string;
  /** Class ("CharacterBody2D"); '' for an instanced scene without type. */
  type: string;
  /** Path of the parent as written ("" for the root, "." for its children, "A/B"…). */
  parent: string | null;
  /** Path from the root ("." for the root, "Player", "Player/Sprite"). */
  path: string;
  /** res:// path of the scene this node instances. */
  instance?: string;
  /** res:// path of the attached script. */
  script?: string;
  groups: string[];
  /** Other properties, raw Godot values. */
  props: Record<string, string>;
  /** 1-based line of the [node] header (to open the file there). */
  line: number;
}

export interface TscnConnection {
  signal: string;
  from: string;
  to: string;
  method: string;
}

export interface TscnScene {
  /** gd_scene / gd_resource. */
  kind: string;
  format: number | null;
  uid: string;
  ext: TscnResource[];
  sub: TscnResource[];
  nodes: TscnNode[];
  connections: TscnConnection[];
}

/** Attributes of a header like [node name="A" type="B" parent="."]. */
export function headerAttrs(h: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w/]+)\s*=\s*("(?:[^"\\]|\\.)*"|[\w.]+\([^)]*\)|\[[^\]]*\]|[^\s\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h))) out[m[1]!] = m[2]!;
  return out;
}

const resId = (v: string | undefined): string | undefined => {
  if (!v) return undefined;
  const m = /^(?:Ext|Sub)Resource\(\s*"?([^")]*)"?\s*\)$/.exec(v.trim());
  return m ? m[1] : undefined;
};

export function parseTscn(text: string): TscnScene {
  const scene: TscnScene = {
    kind: '',
    format: null,
    uid: '',
    ext: [],
    sub: [],
    nodes: [],
    connections: [],
  };
  const lines = text.split(/\r?\n/);
  let cur: {
    kind: string;
    attrs: Record<string, string>;
    props: Record<string, string>;
    line: number;
  } | null = null;
  const flush = () => {
    if (!cur) return;
    const a = cur.attrs;
    const str = (k: string) => (a[k] !== undefined ? godotString(a[k]!) : undefined);
    if (cur.kind === 'gd_scene' || cur.kind === 'gd_resource') {
      scene.kind = cur.kind;
      scene.format = a.format ? Number(a.format) : null;
      scene.uid = str('uid') ?? '';
    } else if (cur.kind === 'ext_resource') {
      scene.ext.push({ id: str('id') ?? '', type: str('type') ?? '', path: str('path') });
    } else if (cur.kind === 'sub_resource') {
      scene.sub.push({ id: str('id') ?? '', type: str('type') ?? '', props: cur.props });
    } else if (cur.kind === 'node') {
      const name = str('name') ?? '?';
      const parent = str('parent') ?? null;
      const path = parent === null ? '.' : parent === '.' ? name : `${parent}/${name}`;
      const props = { ...cur.props };
      const scriptId = resId(props.script);
      delete props.script;
      const instId = resId(a.instance);
      const groups = a.groups ? [...a.groups.matchAll(/"([^"]*)"/g)].map((m) => m[1]!) : [];
      scene.nodes.push({
        name,
        type: str('type') ?? '',
        parent,
        path,
        instance: instId ? scene.ext.find((e) => e.id === instId)?.path : undefined,
        script: scriptId ? scene.ext.find((e) => e.id === scriptId)?.path : undefined,
        groups,
        props,
        line: cur.line,
      });
    } else if (cur.kind === 'connection') {
      scene.connections.push({
        signal: str('signal') ?? '',
        from: str('from') ?? '',
        to: str('to') ?? '',
        method: str('method') ?? '',
      });
    }
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t || t.startsWith(';')) continue;
    if (
      /^\[(gd_scene|gd_resource|ext_resource|sub_resource|node|connection|editable|resource)\b/.test(
        t,
      )
    ) {
      flush();
      let header = t;
      while (!balanced(header) && i + 1 < lines.length) header += ` ${lines[++i]!.trim()}`;
      const kind = /^\[(\w+)/.exec(header)![1]!;
      cur = { kind, attrs: headerAttrs(header.slice(kind.length + 1, -1)), props: {}, line: i + 1 };
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    while (!balanced(value) && i + 1 < lines.length) value += `\n${lines[++i]}`;
    cur.props[key] = value;
  }
  flush();
  return scene;
}

export interface SceneTreeItem {
  node: TscnNode;
  depth: number;
  children: number;
}

/** Nodes in tree order (each parent before its children) with their depth. */
export function sceneTree(nodes: TscnNode[]): SceneTreeItem[] {
  const kids = new Map<string, TscnNode[]>();
  let root: TscnNode | undefined;
  for (const n of nodes) {
    if (n.parent === null) {
      root ??= n;
      continue;
    }
    const p = n.parent === '.' ? '.' : n.parent;
    (kids.get(p) ?? kids.set(p, []).get(p)!).push(n);
  }
  const out: SceneTreeItem[] = [];
  const seen = new Set<string>();
  const walk = (n: TscnNode, depth: number) => {
    if (seen.has(n.path)) return;
    seen.add(n.path);
    const ch = kids.get(n.path) ?? [];
    out.push({ node: n, depth, children: ch.length });
    for (const c of ch) walk(c, depth + 1);
  };
  if (root) walk(root, 0);
  // Nodes whose parent is missing (broken scene): still listed, at the top level.
  for (const n of nodes) if (!seen.has(n.path)) walk(n, root ? 1 : 0);
  return out;
}

/** Compact text of a scene for the AI: one node per line, indented, with its key props. */
export function describeScene(scene: TscnScene, maxProps = 6): string {
  const lines: string[] = [];
  for (const { node, depth } of sceneTree(scene.nodes)) {
    const what = node.instance ? `instance of ${node.instance}` : node.type || '?';
    const extra: string[] = [];
    if (node.script) extra.push(`script=${node.script}`);
    if (node.groups.length) extra.push(`groups=${node.groups.join(',')}`);
    const props = Object.entries(node.props).slice(0, maxProps);
    for (const [k, v] of props)
      extra.push(`${k}=${v.length > 80 ? `${v.slice(0, 80)}…` : v.replace(/\n/g, ' ')}`);
    if (Object.keys(node.props).length > maxProps)
      extra.push(`(+${Object.keys(node.props).length - maxProps} props)`);
    lines.push(
      `${'  '.repeat(depth)}${node.name} (${what})  line ${node.line}${extra.length ? `  ${extra.join('  ')}` : ''}`,
    );
  }
  if (scene.connections.length) {
    lines.push('Signals:');
    const root = scene.nodes.find((n) => n.parent === null)?.name ?? '.';
    const who = (p: string) => (p === '.' ? root : p);
    for (const c of scene.connections)
      lines.push(`  ${who(c.from)}.${c.signal} → ${who(c.to)}.${c.method}()`);
  }
  return lines.join('\n');
}

// ───────────────────────── paths ─────────────────────────

/** res://a/b.gd → "<projectDir>/a/b.gd" relative to the open folder (null if not res://). */
export function resToRel(res: string, projectDir: string): string | null {
  const m = /^res:\/\/(.*)$/.exec(res.trim());
  if (!m) return null;
  const rest = m[1]!.replace(/\\/g, '/');
  if (rest.split('/').some((s) => s === '..')) return null;
  return projectDir ? `${projectDir}/${rest}` : rest;
}

/** A file relative to the open folder → res:// of the project in projectDir (null if outside). */
export function relToRes(rel: string, projectDir: string): string | null {
  const r = rel.replace(/\\/g, '/');
  if (!projectDir) return `res://${r}`;
  if (!r.startsWith(`${projectDir}/`)) return null;
  return `res://${r.slice(projectDir.length + 1)}`;
}

export function validProjectDir(d: unknown): d is string {
  if (typeof d !== 'string' || d.length > 500) return false;
  if (d === '') return true;
  if (/^([a-z]:)?[\\/]/i.test(d)) return false;
  return !d.split(/[\\/]/).some((s) => s === '..' || s === '' || s === '.');
}

/** res://… or project-relative scene file (.tscn / .scn), no "..". */
export function validScene(s: unknown): s is string {
  if (typeof s !== 'string' || !s || s.length > 400) return false;
  const p = s.replace(/^res:\/\//, '');
  if (/^([a-z]:)?[\\/]/i.test(p) || p.split(/[\\/]/).some((x) => x === '..')) return false;
  return /\.(tscn|scn)$/i.test(p);
}

/** An export preset name from export_presets.cfg ("Windows Desktop"). */
export function validPresetName(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 100 && /^[\w .()+-]+$/.test(s);
}

/** Folder name for a new project (a single folder level, no tricks). */
export function validNewFolder(s: unknown): s is string {
  return typeof s === 'string' && /^[\w][\w .-]{0,60}$/.test(s) && !/\.\.|\.$/.test(s);
}

// ───────────────────────── Godot output ─────────────────────────

export interface GodotProblem {
  severity: 'error' | 'warning';
  message: string;
  /** res:// path ('' when the message has no script location). */
  file: string;
  line: number;
  /** Function in which it happened, when Godot says. */
  func?: string;
}

/**
 * Errors and warnings in Godot's console output:
 *   SCRIPT ERROR: Invalid call…           ERROR: Failed to load…        WARNING: …
 *      at: _process (res://main.gd:14)       at: load (modules/…cpp:46)
 * and the LSP / --check-only style "res://a.gd:3 - Parse Error: …". Repeats of the same
 * error (one per frame) are merged and counted.
 */
export function parseGodotOutput(text: string): (GodotProblem & { count: number })[] {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
  const out: (GodotProblem & { count: number })[] = [];
  const add = (p: GodotProblem) => {
    const same = out.find((o) => o.message === p.message && o.file === p.file && o.line === p.line);
    if (same) same.count++;
    else out.push({ ...p, count: 1 });
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const head =
      /^\s*(SCRIPT ERROR|USER SCRIPT ERROR|ERROR|USER ERROR|WARNING|USER WARNING|SCRIPT WARNING):\s*(.*)$/.exec(
        l,
      );
    if (head) {
      const severity = /WARNING/.test(head[1]!) ? 'warning' : 'error';
      let message = head[2]!.trim();
      let file = '';
      let line = 0;
      let func: string | undefined;
      // The "at:" line, then maybe a GDScript backtrace with the user's script.
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const at = /^\s*at:\s*(.*?)\s*\((.*?):(\d+)\)\s*$/.exec(lines[j]!);
        if (at) {
          if (at[2]!.startsWith('res://')) {
            func = at[1] || undefined;
            file = at[2]!;
            line = Number(at[3]);
          }
          continue;
        }
        const bt = /^\s*\[\d+\]\s*(\S+)\s*\((res:\/\/.*?):(\d+)\)/.exec(lines[j]!);
        if (bt) {
          if (!file) {
            func = bt[1];
            file = bt[2]!;
            line = Number(bt[3]);
          }
          break;
        }
        if (/^\s*GDScript backtrace/.test(lines[j]!)) continue;
        if (!/^\s/.test(lines[j]!)) break;
      }
      // "Failed to load script "res://bad.gd" with error "Parse error"" names the file only.
      if (!file) {
        const named = /"(res:\/\/[^"]+\.(?:gd|tscn|tres|cs))"/.exec(message);
        if (named) file = named[1]!;
      }
      if (/^Parse Error:\s*/.test(message))
        message = message.replace(/^Parse Error:\s*/, 'Parse error: ');
      add({ severity, message, file, line, func });
      continue;
    }
    const parse = /^\s*(res:\/\/[^\s:]+):(\d+)\s*-\s*(Parse Error|Error|Warning)?:?\s*(.*)$/.exec(
      l,
    );
    if (parse)
      add({
        severity: /warning/i.test(parse[3] ?? '') ? 'warning' : 'error',
        message: parse[4]!.trim(),
        file: parse[1]!,
        line: Number(parse[2]),
      });
  }
  return out;
}

/** The console output without the engine's banner and repeated progress lines. */
export function cleanGodotOutput(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\[\s*\d+% \]|^\[ DONE \]/.test(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** "4.7.2.stable.official.ed1daf0bf" → { major 4, minor 7, text "4.7.2" }. */
export function parseGodotVersion(
  out: string,
): { major: number; minor: number; text: string; mono: boolean } | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?\.([a-z0-9]+)/i.exec(out);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    text: `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}`,
    mono: /mono/i.test(out),
  };
}

/** Width / height of a PNG from its header (null when it isn't one). */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47)
    return null;
  const u32 = (o: number) =>
    ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  return { width: u32(16), height: u32(20) };
}

// ───────────────────────── export presets ─────────────────────────

export interface GodotPreset {
  name: string;
  platform: string;
  exportPath: string;
}

export function parseExportPresets(text: string): GodotPreset[] {
  const out: GodotPreset[] = [];
  for (const e of parseGodotIni(text)) {
    if (!/^preset\.\d+$/.test(e.section)) continue;
    const idx = Number(e.section.split('.')[1]);
    const p = (out[idx] ??= { name: '', platform: '', exportPath: '' });
    if (e.key === 'name') p.name = godotString(e.value);
    else if (e.key === 'platform') p.platform = godotString(e.value);
    else if (e.key === 'export_path') p.exportPath = godotString(e.value);
  }
  return out.filter((p) => p && p.name);
}

// ───────────────────────── what the Games panel shows ─────────────────────────

export interface GodotStatus {
  state: 'ready' | 'missing';
  exe?: string;
  version?: string;
  mono?: boolean;
  /** Where it was found: 'custom' (chosen by the user), 'env', 'path' or 'scan'. */
  source?: 'custom' | 'env' | 'path' | 'scan';
}

export interface GodotProject {
  /** Folder relative to the open folder ('' = the folder itself). */
  dir: string;
  info: GodotProjectInfo;
  /** Scenes (.tscn) relative to the open folder, the main one first. */
  scenes: string[];
  scripts: number;
  presets: GodotPreset[];
}

export interface WebGameProject {
  dir: string;
  /** index.html relative to the open folder. */
  entry: string;
  /** What it uses, guessed from the page and its scripts. */
  lib: 'three' | 'phaser' | 'pixi' | 'babylon' | 'canvas';
}

export interface GamesScan {
  godot: GodotProject[];
  others: OtherEngineProject[];
  web: WebGameProject[];
}

// ───────────────────────── other engines ─────────────────────────

export type EngineKind = 'godot' | 'unity' | 'unreal' | 'web';

export interface OtherEngineProject {
  kind: 'unity' | 'unreal';
  /** Folder relative to the open folder ('' = the folder itself). */
  dir: string;
  name: string;
  /** Unity: m_EditorVersion; Unreal: EngineAssociation ("5.4" or a GUID). */
  version: string;
  /** Unreal: the .uproject file name. */
  file?: string;
}

/** Unity's ProjectSettings/ProjectVersion.txt → "2022.3.10f1". */
export function parseUnityVersion(text: string): string {
  return /m_EditorVersion:\s*(\S+)/.exec(text)?.[1] ?? '';
}

/** A .uproject (JSON) → EngineAssociation. */
export function parseUproject(text: string): { engine: string; modules: string[] } {
  try {
    const j = JSON.parse(text) as { EngineAssociation?: string; Modules?: { Name?: string }[] };
    return {
      engine: j.EngineAssociation ?? '',
      modules: (j.Modules ?? []).map((m) => m.Name ?? '').filter(Boolean),
    };
  } catch {
    return { engine: '', modules: [] };
  }
}

// ───────────────────────── templates ─────────────────────────

export type GameTemplate =
  | 'godot-platformer'
  | 'godot-topdown'
  | 'godot-3d'
  | 'godot-empty'
  | 'web-canvas'
  | 'web-phaser'
  | 'web-three';

export const GAME_TEMPLATES: { id: GameTemplate; engine: 'godot' | 'web' }[] = [
  { id: 'godot-platformer', engine: 'godot' },
  { id: 'godot-topdown', engine: 'godot' },
  { id: 'godot-3d', engine: 'godot' },
  { id: 'godot-empty', engine: 'godot' },
  { id: 'web-canvas', engine: 'web' },
  { id: 'web-phaser', engine: 'web' },
  { id: 'web-three', engine: 'web' },
];

export function isGameTemplate(t: unknown): t is GameTemplate {
  return GAME_TEMPLATES.some((x) => x.id === t);
}

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function projectGodot(
  name: string,
  mainScene: string,
  opts: { w: number; h: number; renderer: string; actions: Record<string, number[]> },
): string {
  const key = (code: number) =>
    `Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":${code},"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)`;
  const input = Object.entries(opts.actions)
    .map(([a, codes]) => `${a}={\n"deadzone": 0.2,\n"events": [${codes.map(key).join(', ')}]\n}`)
    .join('\n');
  return `; Engine configuration file.
; Created by Zinarix Studio. Open it with Godot 4.

config_version=5

[application]

config/name=${q(name)}
run/main_scene=${q(mainScene)}
config/features=PackedStringArray("4.3", ${q(opts.renderer)})

[display]

window/size/viewport_width=${opts.w}
window/size/viewport_height=${opts.h}
window/stretch/mode="canvas_items"
${input ? `\n[input]\n\n${input}\n` : ''}
[rendering]

renderer/rendering_method=${q(opts.renderer === 'Forward Plus' ? 'forward_plus' : opts.renderer === 'Mobile' ? 'mobile' : 'gl_compatibility')}
`;
}

// Physical key codes (Godot's Key enum).
const K = {
  left: 4194319,
  right: 4194321,
  up: 4194320,
  down: 4194322,
  space: 32,
  a: 65,
  d: 68,
  w: 87,
  s: 83,
};

const GITIGNORE = '# Godot 4\n.godot/\n/android/\n*.translation\nexport_presets.cfg\n';

/** Files of a new game project (paths relative to the new folder). */
export function gameTemplateFiles(t: GameTemplate, name: string): Record<string, string> {
  switch (t) {
    case 'godot-empty':
      return {
        'project.godot': projectGodot(name, 'res://main.tscn', {
          w: 1152,
          h: 648,
          renderer: 'Forward Plus',
          actions: {},
        }),
        'main.tscn': `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]

[node name="Main" type="Node2D"]
script = ExtResource("1_main")

[node name="Label" type="Label" parent="."]
offset_left = 40.0
offset_top = 40.0
offset_right = 600.0
offset_bottom = 80.0
theme_override_font_sizes/font_size = 28
text = ${q(name)}
`,
        'main.gd': `extends Node2D


func _ready() -> void:
\tprint("${name.replace(/"/g, '')}: listo")
`,
        '.gitignore': GITIGNORE,
      };
    case 'godot-platformer':
      return {
        'project.godot': projectGodot(name, 'res://main.tscn', {
          w: 960,
          h: 540,
          renderer: 'GL Compatibility',
          actions: {
            move_left: [K.left, K.a],
            move_right: [K.right, K.d],
            jump: [K.space, K.up, K.w],
          },
        }),
        'main.tscn': `[gd_scene load_steps=6 format=3]

[ext_resource type="PackedScene" path="res://player.tscn" id="1_player"]
[ext_resource type="Script" path="res://main.gd" id="2_main"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_floor"]
size = Vector2(1400, 40)

[sub_resource type="RectangleShape2D" id="RectangleShape2D_step"]
size = Vector2(200, 24)

[sub_resource type="RectangleShape2D" id="RectangleShape2D_coin"]
size = Vector2(24, 24)

[node name="Main" type="Node2D"]
script = ExtResource("2_main")

[node name="Sky" type="ColorRect" parent="."]
offset_left = -400.0
offset_top = -400.0
offset_right = 1800.0
offset_bottom = 700.0
color = Color(0.53, 0.75, 0.95, 1)

[node name="Floor" type="StaticBody2D" parent="."]
position = Vector2(480, 520)

[node name="Shape" type="CollisionShape2D" parent="Floor"]
shape = SubResource("RectangleShape2D_floor")

[node name="Look" type="ColorRect" parent="Floor"]
offset_left = -700.0
offset_top = -20.0
offset_right = 700.0
offset_bottom = 20.0
color = Color(0.3, 0.6, 0.25, 1)

[node name="Step" type="StaticBody2D" parent="."]
position = Vector2(620, 390)

[node name="Shape" type="CollisionShape2D" parent="Step"]
shape = SubResource("RectangleShape2D_step")

[node name="Look" type="ColorRect" parent="Step"]
offset_left = -100.0
offset_top = -12.0
offset_right = 100.0
offset_bottom = 12.0
color = Color(0.55, 0.38, 0.22, 1)

[node name="Coin" type="Area2D" parent="."]
position = Vector2(620, 340)

[node name="Shape" type="CollisionShape2D" parent="Coin"]
shape = SubResource("RectangleShape2D_coin")

[node name="Look" type="ColorRect" parent="Coin"]
offset_left = -12.0
offset_top = -12.0
offset_right = 12.0
offset_bottom = 12.0
color = Color(1, 0.82, 0.1, 1)

[node name="Player" parent="." instance=ExtResource("1_player")]
position = Vector2(200, 440)

[node name="Score" type="Label" parent="."]
offset_left = 20.0
offset_top = 16.0
offset_right = 400.0
offset_bottom = 50.0
theme_override_font_sizes/font_size = 24
text = "Monedas: 0"

[connection signal="body_entered" from="Coin" to="." method="_on_coin_body_entered"]
`,
        'main.gd': `extends Node2D

var score := 0


func _on_coin_body_entered(body: Node2D) -> void:
\tif body.name != "Player":
\t\treturn
\tscore += 1
\t$Score.text = "Monedas: %d" % score
\t$Coin.queue_free()
\tprint("moneda recogida: ", score)
`,
        'player.tscn': `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://player.gd" id="1_player"]

[sub_resource type="RectangleShape2D" id="RectangleShape2D_body"]
size = Vector2(32, 48)

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1_player")

[node name="Shape" type="CollisionShape2D" parent="."]
shape = SubResource("RectangleShape2D_body")

[node name="Look" type="ColorRect" parent="."]
offset_left = -16.0
offset_top = -24.0
offset_right = 16.0
offset_bottom = 24.0
color = Color(0.9, 0.3, 0.35, 1)

[node name="Camera" type="Camera2D" parent="."]
position = Vector2(0, -60)
limit_left = -400
limit_bottom = 560
`,
        'player.gd': `extends CharacterBody2D

const SPEED := 260.0
const JUMP_VELOCITY := -520.0

var gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")


func _physics_process(delta: float) -> void:
\tif not is_on_floor():
\t\tvelocity.y += gravity * delta
\tif Input.is_action_just_pressed("jump") and is_on_floor():
\t\tvelocity.y = JUMP_VELOCITY
\tvar dir := Input.get_axis("move_left", "move_right")
\tvelocity.x = dir * SPEED if dir else move_toward(velocity.x, 0, SPEED)
\tmove_and_slide()
`,
        'README.md': `# ${name}\n\nPlataformas 2D hecho con Godot 4. Flechas o A/D para moverte, espacio para saltar.\n\nAbre la carpeta en Godot, o en Zinarix: Más → Juegos → ▶ Ejecutar.\n`,
        '.gitignore': GITIGNORE,
      };
    case 'godot-topdown':
      return {
        'project.godot': projectGodot(name, 'res://main.tscn', {
          w: 960,
          h: 540,
          renderer: 'GL Compatibility',
          actions: {
            move_left: [K.left, K.a],
            move_right: [K.right, K.d],
            move_up: [K.up, K.w],
            move_down: [K.down, K.s],
          },
        }),
        'main.tscn': `[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://player.gd" id="1_player"]

[sub_resource type="CircleShape2D" id="CircleShape2D_player"]
radius = 16.0

[sub_resource type="RectangleShape2D" id="RectangleShape2D_wall"]
size = Vector2(40, 300)

[node name="Main" type="Node2D"]

[node name="Ground" type="ColorRect" parent="."]
offset_right = 960.0
offset_bottom = 540.0
color = Color(0.18, 0.22, 0.2, 1)

[node name="Wall" type="StaticBody2D" parent="."]
position = Vector2(600, 270)

[node name="Shape" type="CollisionShape2D" parent="Wall"]
shape = SubResource("RectangleShape2D_wall")

[node name="Look" type="ColorRect" parent="Wall"]
offset_left = -20.0
offset_top = -150.0
offset_right = 20.0
offset_bottom = 150.0
color = Color(0.45, 0.45, 0.5, 1)

[node name="Player" type="CharacterBody2D" parent="."]
position = Vector2(300, 270)
motion_mode = 1
script = ExtResource("1_player")

[node name="Shape" type="CollisionShape2D" parent="Player"]
shape = SubResource("CircleShape2D_player")

[node name="Look" type="ColorRect" parent="Player"]
offset_left = -16.0
offset_top = -16.0
offset_right = 16.0
offset_bottom = 16.0
color = Color(0.35, 0.8, 0.95, 1)
`,
        'player.gd': `extends CharacterBody2D

const SPEED := 220.0


func _physics_process(_delta: float) -> void:
\tvar dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
\tvelocity = dir * SPEED
\tmove_and_slide()
`,
        '.gitignore': GITIGNORE,
      };
    case 'godot-3d':
      return {
        'project.godot': projectGodot(name, 'res://main.tscn', {
          w: 1152,
          h: 648,
          renderer: 'Forward Plus',
          actions: {
            move_left: [K.left, K.a],
            move_right: [K.right, K.d],
            move_forward: [K.up, K.w],
            move_back: [K.down, K.s],
            jump: [K.space],
          },
        }),
        'main.tscn': `[gd_scene load_steps=9 format=3]

[ext_resource type="Script" path="res://player.gd" id="1_player"]

[sub_resource type="ProceduralSkyMaterial" id="ProceduralSkyMaterial_sky"]

[sub_resource type="Sky" id="Sky_main"]
sky_material = SubResource("ProceduralSkyMaterial_sky")

[sub_resource type="Environment" id="Environment_main"]
background_mode = 2
sky = SubResource("Sky_main")
tonemap_mode = 2

[sub_resource type="BoxShape3D" id="BoxShape3D_floor"]
size = Vector3(30, 1, 30)

[sub_resource type="BoxMesh" id="BoxMesh_floor"]
size = Vector3(30, 1, 30)

[sub_resource type="CapsuleShape3D" id="CapsuleShape3D_player"]

[sub_resource type="CapsuleMesh" id="CapsuleMesh_player"]

[node name="Main" type="Node3D"]

[node name="Environment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_main")

[node name="Sun" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.866, -0.354, 0.354, 0, 0.707, 0.707, -0.5, -0.612, 0.612, 0, 8, 0)
shadow_enabled = true

[node name="Floor" type="StaticBody3D" parent="."]
position = Vector3(0, -0.5, 0)

[node name="Shape" type="CollisionShape3D" parent="Floor"]
shape = SubResource("BoxShape3D_floor")

[node name="Mesh" type="MeshInstance3D" parent="Floor"]
mesh = SubResource("BoxMesh_floor")

[node name="Player" type="CharacterBody3D" parent="."]
position = Vector3(0, 1, 0)
script = ExtResource("1_player")

[node name="Shape" type="CollisionShape3D" parent="Player"]
shape = SubResource("CapsuleShape3D_player")

[node name="Mesh" type="MeshInstance3D" parent="Player"]
mesh = SubResource("CapsuleMesh_player")

[node name="Camera" type="Camera3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 0.94, 0.342, 0, -0.342, 0.94, 0, 2.5, 5)
`,
        'player.gd': `extends CharacterBody3D

const SPEED := 5.0
const JUMP_VELOCITY := 4.5

var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")


func _physics_process(delta: float) -> void:
\tif not is_on_floor():
\t\tvelocity.y -= gravity * delta
\tif Input.is_action_just_pressed("jump") and is_on_floor():
\t\tvelocity.y = JUMP_VELOCITY
\tvar input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
\tvar dir := (transform.basis * Vector3(input.x, 0, input.y)).normalized()
\tif dir:
\t\tvelocity.x = dir.x * SPEED
\t\tvelocity.z = dir.z * SPEED
\telse:
\t\tvelocity.x = move_toward(velocity.x, 0, SPEED)
\t\tvelocity.z = move_toward(velocity.z, 0, SPEED)
\tmove_and_slide()
`,
        '.gitignore': GITIGNORE,
      };
    case 'web-canvas':
      return {
        'index.html': `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #10141c; display: grid; place-items: center; }
  canvas { background: #1b2433; max-width: 100vw; max-height: 100vh; image-rendering: pixelated; }
</style>
</head>
<body>
<canvas id="game" width="960" height="540"></canvas>
<script type="module" src="game.js"></script>
</body>
</html>
`,
        'game.js': `// ${name.replace(/\n/g, ' ')}: juego 2D con canvas, sin librerías.
// Flechas o A/D para moverte, espacio para saltar. Recoge las monedas.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));

const GRAVITY = 1500;
const player = { x: 100, y: 300, w: 32, h: 48, vx: 0, vy: 0, onGround: false };
const platforms = [
  { x: 0, y: 500, w: 960, h: 40 },
  { x: 300, y: 390, w: 180, h: 20 },
  { x: 560, y: 300, w: 180, h: 20 },
];
let coins = [{ x: 380, y: 350 }, { x: 640, y: 260 }, { x: 850, y: 460 }];
let score = 0;

function update(dt) {
  const left = keys.has('ArrowLeft') || keys.has('KeyA');
  const right = keys.has('ArrowRight') || keys.has('KeyD');
  player.vx = (right - left) * 260;
  if ((keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW')) && player.onGround) player.vy = -560;
  player.vy += GRAVITY * dt;
  player.x = Math.max(0, Math.min(canvas.width - player.w, player.x + player.vx * dt));
  player.y += player.vy * dt;
  player.onGround = false;
  for (const p of platforms) {
    const over = player.x + player.w > p.x && player.x < p.x + p.w;
    if (over && player.vy >= 0 && player.y + player.h > p.y && player.y + player.h - player.vy * dt <= p.y + 1) {
      player.y = p.y - player.h;
      player.vy = 0;
      player.onGround = true;
    }
  }
  coins = coins.filter((c) => {
    const hit = Math.abs(player.x + player.w / 2 - c.x) < 24 && Math.abs(player.y + player.h / 2 - c.y) < 32;
    if (hit) score++;
    return !hit;
  });
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#4c8c3c';
  for (const p of platforms) ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.fillStyle = '#ffd21a';
  for (const c of coins) { ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#e64d59';
  ctx.fillRect(player.x, player.y, player.w, player.h);
  ctx.fillStyle = '#fff';
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(coins.length ? \`Monedas: \${score}\` : '¡Ganaste!', 20, 40);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`,
        'README.md': `# ${name}\n\nJuego web 2D con canvas, sin librerías. Abre \`index.html\` con un servidor local (en Zinarix: Más → Juegos → Vista previa).\n`,
      };
    case 'web-phaser':
      return {
        'index.html': `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #0d1117; display: grid; place-items: center; }
  canvas { max-width: 100vw; max-height: 100vh; }
</style>
<script src="lib/phaser.min.js"></script>
</head>
<body>
<script src="game.js"></script>
</body>
</html>
`,
        'game.js': `// ${name.replace(/\n/g, ' ')}: plataformas 2D con Phaser (copiado en lib/, funciona sin internet).
// Flechas o WASD para moverte, Espacio / ↑ / W para saltar. Junta todas las monedas.

class Nivel extends Phaser.Scene {
  constructor() {
    super('nivel');
  }

  create() {
    // Texturas dibujadas con código (cámbialas por imágenes con this.load.image en preload()).
    const g = this.add.graphics();
    g.fillStyle(0xe64d59).fillRoundedRect(0, 0, 32, 44, 6).generateTexture('jugador', 32, 44).clear();
    g.fillStyle(0x4c8c3c).fillRect(0, 0, 64, 20).generateTexture('suelo', 64, 20).clear();
    g.fillStyle(0xffd21a).fillCircle(10, 10, 10).generateTexture('moneda', 20, 20).destroy();

    this.cameras.main.setBackgroundColor('#87bff2');
    this.plataformas = this.physics.add.staticGroup();
    for (let x = 32; x < 960; x += 64) this.plataformas.create(x, 530, 'suelo');
    for (const [x, y, n] of [[300, 420, 3], [600, 330, 3], [820, 230, 2], [150, 260, 2]])
      for (let i = 0; i < n; i++) this.plataformas.create(x + i * 64, y, 'suelo');

    this.jugador = this.physics.add.sprite(100, 450, 'jugador');
    this.jugador.setCollideWorldBounds(true);
    this.physics.add.collider(this.jugador, this.plataformas);

    this.monedas = this.physics.add.staticGroup();
    for (const [x, y] of [[300, 380], [400, 380], [630, 290], [850, 190], [180, 220], [520, 490]])
      this.monedas.create(x, y, 'moneda');
    this.puntos = 0;
    this.texto = this.add.text(16, 14, 'Monedas: 0', { fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#ffffff' });
    this.physics.add.overlap(this.jugador, this.monedas, (_j, moneda) => {
      moneda.destroy();
      this.puntos++;
      this.texto.setText(this.monedas.countActive() ? \`Monedas: \${this.puntos}\` : '¡Ganaste! (R para repetir)');
    });

    this.teclas = this.input.keyboard.addKeys('LEFT,RIGHT,UP,A,D,W,SPACE,R');
  }

  update() {
    const t = this.teclas;
    const izq = t.LEFT.isDown || t.A.isDown;
    const der = t.RIGHT.isDown || t.D.isDown;
    this.jugador.setVelocityX(izq === der ? 0 : izq ? -260 : 260);
    const salta = t.UP.isDown || t.W.isDown || t.SPACE.isDown;
    if (salta && this.jugador.body.blocked.down) this.jugador.setVelocityY(-560);
    if (Phaser.Input.Keyboard.JustDown(t.R)) this.scene.restart();
  }
}

// window.juego: para revisar el estado desde la consola (o en pruebas automáticas).
window.juego = new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 560,
  physics: { default: 'arcade', arcade: { gravity: { y: 1200 } } },
  scene: [Nivel],
});
`,
        'README.md': `# ${name}\n\nJuego web 2D con Phaser 4 (copiado en \`lib/phaser.min.js\`, licencia MIT, funciona sin internet). Ábrelo con un servidor local (en Zinarix: Más → Juegos → Jugar). Documentación: https://docs.phaser.io\n`,
      };
    case 'web-three':
      return {
        'index.html': `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0d1117; }
  #hud { position: fixed; left: 16px; top: 12px; color: #fff; font: 18px system-ui, sans-serif; }
</style>
<script type="importmap">
{ "imports": { "three": "./lib/three.module.min.js" } }
</script>
</head>
<body>
<div id="hud">WASD / flechas para moverte</div>
<script type="module" src="game.js"></script>
</body>
</html>
`,
        'game.js': `// ${name.replace(/\n/g, ' ')}: juego 3D con three.js.
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87bff2);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 10, 4);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x4c8c3c }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const player = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe64d59 }));
player.position.y = 0.5;
player.castShadow = true;
scene.add(player);

for (let i = 0; i < 12; i++) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1 + Math.random() * 2, 1), new THREE.MeshStandardMaterial({ color: 0x8a6a4a }));
  box.position.set((Math.random() - 0.5) * 30, box.geometry.parameters.height / 2, (Math.random() - 0.5) * 30);
  box.castShadow = true;
  scene.add(box);
}

const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const speed = 6 * dt;
  if (keys.has('KeyW') || keys.has('ArrowUp')) player.position.z -= speed;
  if (keys.has('KeyS') || keys.has('ArrowDown')) player.position.z += speed;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) player.position.x -= speed;
  if (keys.has('KeyD') || keys.has('ArrowRight')) player.position.x += speed;
  player.rotation.y += dt;
  camera.position.set(player.position.x, 6, player.position.z + 9);
  camera.lookAt(player.position);
  renderer.render(scene, camera);
});
`,
        'README.md': `# ${name}\n\nJuego web 3D con three.js (copiado en \`lib/\`, funciona sin internet). Ábrelo con un servidor local (en Zinarix: Más → Juegos → Vista previa).\n`,
      };
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

/** Main scene to open after creating a project from a template. */
export function templateEntry(t: GameTemplate): string {
  return t.startsWith('web-')
    ? 'game.js'
    : t === 'godot-platformer' || t === 'godot-topdown'
      ? 'player.gd'
      : 'main.tscn';
}
