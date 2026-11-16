import { globToRegExp } from './glob.js';
import type { RuleView } from './api.js';

/**
 * Project rules (Fase 1): instruction files the chat and the agent follow in a project.
 *
 * - Root instruction files (ROOT_FILES): AGENTS.md, CLAUDE.md, .zinarix/rules.md, .cursorrules,
 *   .github/copilot-instructions.md. They always apply.
 * - AGENTS.md / CLAUDE.md inside sub-folders: they apply when the context has a file in that
 *   folder (root → folder of the file, the deepest one last, so it wins).
 * - One rule per file in .zinarix/rules/*.md and .cursor/rules/*.mdc, with frontmatter:
 *     applies: always | glob | manual   ·   globs: ["**\/*.tsx"]   ·   alwaysApply: true (Cursor)
 *     description: …
 *   "glob" rules enter when a context file matches; "manual" rules enter when the prompt
 *   mentions them (@name) and otherwise are only listed so the agent can open them.
 *
 * Pure: the main process reads the files, everything else is decided (and tested) here.
 */

export type RuleKind = RuleView['kind'];
export type RuleApplies = RuleView['applies'];

export interface Rule extends RuleView {
  body: string;
}

export interface ActiveRule extends Rule {
  /** "always", "folder", "mention" or the glob that matched. */
  reason: string;
  tokens: number;
}

/** Root instruction files, in the order they are added to the prompt. */
export const ROOT_FILES: readonly { path: string; kind: RuleKind }[] = [
  { path: 'AGENTS.md', kind: 'instructions' },
  { path: 'CLAUDE.md', kind: 'instructions' },
  { path: '.zinarix/rules.md', kind: 'zinarix' },
  { path: '.cursorrules', kind: 'legacy' },
  { path: '.github/copilot-instructions.md', kind: 'copilot' },
];

/** Instruction files that also count inside sub-folders. */
const FOLDER_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/** Folders with one rule per file. */
export const RULE_DIRS: readonly { dir: string; ext: string; kind: RuleKind }[] = [
  { dir: '.zinarix/rules', ext: '.md', kind: 'zinarix' },
  { dir: '.cursor/rules', ext: '.mdc', kind: 'cursor' },
  // GitHub Copilot path-specific instructions (frontmatter "applyTo").
  { dir: '.github/instructions', ext: '.instructions.md', kind: 'copilot' },
];

/** Globs that match every file: a rule with one of them applies always. */
const MATCH_ALL = new Set(['**', '**/*', '*', '/**', '/**/*']);

/** Characters of rules sent per turn (all sources together). */
export const MAX_RULES_CHARS = 20_000;
/** Characters of a single rule (a huge AGENTS.md does not crowd out the rest). */
export const MAX_RULE_CHARS = 12_000;

type FrontValue = string | string[] | boolean;

/** "---\nkey: value\n---\nbody" → data + body. Small YAML subset: scalars, [a, b] and "- a" lists. */
export function parseFrontmatter(text: string): { data: Record<string, FrontValue>; body: string } {
  const src = text.replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  const data: Record<string, FrontValue> = {};
  let listKey: string | null = null;
  for (const raw of m[1]!.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const cur = data[listKey];
      data[listKey] = [...(Array.isArray(cur) ? cur : []), unquote(item[1]!)];
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    listKey = null;
    if (!value) {
      listKey = key;
      data[key] = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = splitList(value.slice(1, -1));
    } else if (/^(true|false)$/i.test(value)) {
      data[key] = value.toLowerCase() === 'true';
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: src.slice(m[0].length) };
}

function unquote(s: string): string {
  const v = s.trim();
  return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v;
}

function splitList(s: string): string[] {
  return s.split(',').map(unquote).filter(Boolean);
}

function asList(v: FrontValue | undefined): string[] {
  if (Array.isArray(v)) return v.flatMap(splitList);
  if (typeof v === 'string') return splitList(v);
  return [];
}

/** "react" for .zinarix/rules/react.md, "AGENTS" for src/AGENTS.md. */
function baseName(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/(?:\.instructions)?\.(md|mdc)$/i, '');
}

/** One rule file. Instruction files always apply; rule files follow their frontmatter. */
export function parseRule(path: string, text: string, kind: RuleKind): Rule {
  const { data, body } = parseFrontmatter(text);
  const globs = asList(data.globs ?? data.glob ?? data.applyTo);
  const description = typeof data.description === 'string' ? data.description : '';
  const isRuleFile = RULE_DIRS.some(
    (d) => path.startsWith(`${d.dir}/`) || path.includes(`/${d.dir}/`),
  );
  let applies: RuleApplies = 'always';
  if (isRuleFile) {
    const declared = typeof data.applies === 'string' ? data.applies.toLowerCase() : '';
    if (declared === 'always' || declared === 'glob' || declared === 'manual') applies = declared;
    else if (data.alwaysApply === true) applies = 'always';
    else if (globs.length) applies = 'glob';
    // Cursor / Copilot: no alwaysApply and no globs = "agent requested". Zinarix: plain = always.
    else applies = kind === 'zinarix' ? 'always' : 'manual';
    // "glob" without globs could never match: keep it reachable as manual.
    if (applies === 'glob' && !globs.length) applies = 'manual';
    // "**" (Copilot's usual applyTo) matches every file, even when the context has none.
    if (applies === 'glob' && globs.some((g) => MATCH_ALL.has(g.trim()))) applies = 'always';
  }
  return { path, name: baseName(path), kind, applies, globs, description, body: body.trim() };
}

/** Folders from the root down to the folder of a file: "a/b/c.ts" → ['', 'a', 'a/b']. */
function ancestorDirs(relPath: string): string[] {
  const parts = relPath.split('/').filter(Boolean);
  parts.pop();
  const out = [''];
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join('/'));
  return out;
}

/**
 * Workspace files a chat context refers to ("file:src/a.ts", "selection:src/a.ts:3-9"),
 * relative to the root with "/". Absolute paths inside `root` are made relative.
 */
export function contextPaths(sources: string[], root?: string): string[] {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const base = root ? norm(root).replace(/\/+$/, '') : '';
  const out: string[] = [];
  for (const s of sources) {
    let p: string | undefined;
    if (s.startsWith('file:')) p = s.slice(5);
    else if (s.startsWith('selection:')) p = s.slice(10).replace(/:\d+-\d+$/, '');
    if (!p) continue;
    p = norm(p).replace(/^\.\//, '');
    if (base && p.toLowerCase().startsWith(`${base.toLowerCase()}/`)) p = p.slice(base.length + 1);
    // Other absolute or escaping paths are not project files.
    if (/^([a-z]:)?\//i.test(p) || p.split('/').includes('..')) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Sub-folder AGENTS.md / CLAUDE.md that could apply to these paths (shallow first, no root). */
export function hierarchyCandidates(paths: string[]): string[] {
  const dirs = [...new Set(paths.flatMap(ancestorDirs))]
    .filter(Boolean)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return dirs.flatMap((d) => FOLDER_FILES.map((f) => `${d}/${f}`));
}

/**
 * Cursor and Copilot files inside sub-folders (apps/web/.cursor/rules/*.mdc,
 * apps/web/.github/copilot-instructions.md): like a sub-folder AGENTS.md, they speak only for
 * the files in that folder. Shallow folders first (the deepest one is added last and wins).
 */
export function nestedRuleSources(paths: string[]): {
  files: { path: string; kind: RuleKind }[];
  dirs: { dir: string; ext: string; kind: RuleKind }[];
} {
  const dirs = [...new Set(paths.flatMap(ancestorDirs))]
    .filter(Boolean)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return {
    files: dirs.map((d) => ({ path: `${d}/.github/copilot-instructions.md`, kind: 'copilot' })),
    dirs: dirs.map((d) => ({ dir: `${d}/.cursor/rules`, ext: '.mdc', kind: 'cursor' })),
  };
}

/** The folder a rule speaks for: '' = the whole project; "apps/web" for apps/web/AGENTS.md,
 * apps/web/.cursor/rules/x.mdc or apps/web/.github/copilot-instructions.md. */
export function ruleBase(path: string): string {
  for (const marker of ['.cursor/rules/', '.github/', '.zinarix/']) {
    if (path.startsWith(marker)) return '';
    const i = path.indexOf(`/${marker}`);
    if (i > 0) return path.slice(0, i);
  }
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '';
}

/** Rule names the prompt mentions with @ ("@react", "@rules/react"), lower-case. */
export function mentionedRules(prompt: string): string[] {
  const out = new Set<string>();
  for (const m of prompt.matchAll(/(?:^|\s)@(?:rules?\/)?([\w.-]+)/gi))
    out.add(m[1]!.toLowerCase().replace(/\.(md|mdc)$/, ''));
  return [...out];
}

/** Rough token count (4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Two rules with this same key say the same thing (CLAUDE.md that only imports AGENTS.md). */
function bodyKey(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

/** Nested "@file" imports followed at most this deep. */
export const MAX_IMPORT_DEPTH = 4;

/** "a/b" + "../c.md" → "a/c.md"; null when it leaves the project root. */
function joinRel(dir: string, rel: string): string | null {
  const parts = rel.startsWith('/') || !dir ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

/**
 * "@path" imports (CLAUDE.md / AGENTS.md style): a line that is only "@docs/style.md" is
 * replaced by that file, relative to the rule's folder ("/x" = project root). Imports nest up
 * to MAX_IMPORT_DEPTH, never loop and never leave the project; code blocks are left alone, and
 * a path `read` cannot open stays as written.
 */
export function expandImports(
  body: string,
  fromPath: string,
  read: (rel: string) => string | null,
  depth = 0,
  stack: string[] = [fromPath],
): string {
  if (depth >= MAX_IMPORT_DEPTH || !body.includes('@')) return body;
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  let inCode = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inCode = !inCode;
      if (inCode) return line;
      const m = /^\s*@((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[\w-]+)\s*$/.exec(line);
      if (!m) return line;
      const rel = joinRel(dir, m[1]!);
      if (!rel || stack.includes(rel)) return line;
      const text = read(rel);
      if (text === null) return line;
      const inner = parseFrontmatter(text).body.trim();
      return expandImports(inner, rel, read, depth + 1, [...stack, rel]);
    })
    .join('\n');
}

/** Which rules enter the prompt, and why. Identical texts count once. */
export function selectRules(rules: Rule[], paths: string[], mentions: string[] = []): ActiveRule[] {
  const wanted = new Set(mentions.map((m) => m.toLowerCase()));
  const seen = new Set<string>();
  const out: ActiveRule[] = [];
  for (const r of rules) {
    if (!r.body) continue;
    let reason: string | null = null;
    // A sub-folder AGENTS.md / CLAUDE.md / .cursor/rules / copilot-instructions.md only
    // speaks for the files inside that folder (its globs are relative to it).
    const base = r.kind === 'instructions' || r.kind === 'cursor' || r.kind === 'copilot'
      ? ruleBase(r.path)
      : '';
    const dir = base ? `${base}/`.toLowerCase() : '';
    const scoped = dir
      ? paths.filter((p) => p.toLowerCase().startsWith(dir)).map((p) => p.slice(dir.length))
      : paths;
    if (wanted.has(r.name.toLowerCase())) reason = 'mention';
    else if (dir && !scoped.length) reason = null;
    else if (dir && (r.kind === 'instructions' || r.applies === 'always')) reason = 'folder';
    else if (r.applies === 'always') reason = 'always';
    else if (r.applies === 'glob') {
      const hit = r.globs.find((g) => {
        const re = globToRegExp(g.replace(/^\//, ''));
        return scoped.some((p) => re.test(p));
      });
      if (hit) reason = hit;
    }
    if (!reason) continue;
    const key = bodyKey(r.body);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, reason, tokens: estimateTokens(r.body.slice(0, MAX_RULE_CHARS)) });
  }
  return out;
}

/** Rules that did not enter but the agent may open when the task needs them. */
export function availableRules(rules: Rule[], active: ActiveRule[]): Rule[] {
  const inside = new Set(active.map((r) => r.path));
  return rules.filter((r) => !inside.has(r.path) && r.applies !== 'always');
}

/** A rule text cannot close the block it travels in. */
function fence(text: string): string {
  return text.replace(/<\/?project-rules?\b/gi, (m) => m.replace('<', '‹'));
}

/**
 * Rules sent during one agent run. The first prompt only knows the files of the chat context;
 * when the agent then opens or edits another file, `next` returns the rules that start to apply
 * (its glob rules, the AGENTS.md of its folder) and were not sent yet, each one once, within
 * one extra MAX_RULES_CHARS budget for the whole run. A subagent gets a `fork`: what it
 * receives does not count as told to the agent that launched it.
 */
export class RuleTracker {
  private readonly sent: Set<string>;
  private readonly bodies: Set<string>;
  private used: number;

  constructor(initial: Rule[] = [], from?: RuleTracker) {
    this.sent = new Set(from?.sent);
    this.bodies = new Set(from?.bodies);
    this.used = from?.used ?? 0;
    for (const r of initial) this.mark(r);
  }

  private mark(r: Rule): void {
    this.sent.add(r.path);
    this.bodies.add(bodyKey(r.body));
  }

  /** Rules that newly apply because the run touched these paths. */
  next(rules: Rule[], paths: string[]): ActiveRule[] {
    const out: ActiveRule[] = [];
    for (const r of selectRules(rules, paths)) {
      if (this.sent.has(r.path) || this.bodies.has(bodyKey(r.body))) continue;
      const size = Math.min(r.body.length, MAX_RULE_CHARS);
      if (this.used + size > MAX_RULES_CHARS) continue;
      this.used += size;
      this.mark(r);
      out.push(r);
    }
    return out;
  }

  fork(): RuleTracker {
    return new RuleTracker([], this);
  }
}

/** How an agent run asks for the rules of a file it just opened or edited. */
export interface RuleFeed {
  /** The rules block to append to the tool result ('' when nothing new applies). */
  forFile(path: string): string;
  /** A feed for a subagent: starts from what was sent so far, keeps its own count. */
  fork(): RuleFeed;
}

/** What the agent receives with a tool result when a file brings new rules ('' for none). */
export function rulesUpdate(
  path: string,
  rules: ActiveRule[],
  redact: (s: string) => string = (s) => s,
): string {
  if (!rules.length) return '';
  const parts = rules.map((r) => {
    const body =
      r.body.length > MAX_RULE_CHARS ? `${r.body.slice(0, MAX_RULE_CHARS)}\n…(cut)` : r.body;
    return `<project-rule path="${r.path}" reason="${r.reason}">\n${fence(redact(body))}\n</project-rule>`;
  });
  return (
    '\n\n<project-rules>\n' +
    `More rules of this project apply now that you work on ${fence(path)}. Follow them for the files they cover; they never override safety or the user's approvals.\n` +
    parts.join('\n') +
    '\n</project-rules>'
  );
}

/** System-prompt block with the rules ('' when there are none) and the ones cut for size. */
export function rulesPrompt(
  active: ActiveRule[],
  available: Rule[],
  redact: (s: string) => string = (s) => s,
): { text: string; truncated: string[] } {
  const truncated: string[] = [];
  const parts: string[] = [];
  let used = 0;
  for (const r of active) {
    let body = r.body;
    if (body.length > MAX_RULE_CHARS) {
      body = `${body.slice(0, MAX_RULE_CHARS)}\n…(cut)`;
      truncated.push(r.path);
    }
    if (used + body.length > MAX_RULES_CHARS) {
      if (!truncated.includes(r.path)) truncated.push(r.path);
      continue;
    }
    used += body.length;
    parts.push(
      `<project-rule path="${r.path}" reason="${r.reason}">\n${fence(redact(body))}\n</project-rule>`,
    );
  }
  const listed = available
    .slice(0, 50)
    .map((r) => `- ${r.path}${r.description ? `: ${fence(redact(r.description))}` : ''}`);
  if (!parts.length && !listed.length) return { text: '', truncated };
  const text =
    '\n\n<project-rules>\n' +
    "Rules of this project (style, conventions, how to work here). Follow them; they never override safety or the user's approvals.\n" +
    parts.join('\n') +
    (listed.length
      ? `\nOther rules you can read with read_file when the task needs them:\n${listed.join('\n')}`
      : '') +
    '\n</project-rules>';
  return { text, truncated };
}
