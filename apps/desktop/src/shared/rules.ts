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
];

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
  return file.replace(/\.(md|mdc)$/i, '');
}

/** One rule file. Instruction files always apply; rule files follow their frontmatter. */
export function parseRule(path: string, text: string, kind: RuleKind): Rule {
  const { data, body } = parseFrontmatter(text);
  const globs = asList(data.globs ?? data.glob);
  const description = typeof data.description === 'string' ? data.description : '';
  const isRuleFile = RULE_DIRS.some((d) => path.startsWith(`${d.dir}/`));
  let applies: RuleApplies = 'always';
  if (isRuleFile) {
    const declared = typeof data.applies === 'string' ? data.applies.toLowerCase() : '';
    if (declared === 'always' || declared === 'glob' || declared === 'manual') applies = declared;
    else if (data.alwaysApply === true) applies = 'always';
    else if (globs.length) applies = 'glob';
    // Cursor: no alwaysApply and no globs = "agent requested". Zinarix: plain file = always.
    else applies = kind === 'cursor' ? 'manual' : 'always';
    // "glob" without globs could never match: keep it reachable as manual.
    if (applies === 'glob' && !globs.length) applies = 'manual';
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

/** Which rules enter the prompt, and why. Identical texts count once. */
export function selectRules(rules: Rule[], paths: string[], mentions: string[] = []): ActiveRule[] {
  const wanted = new Set(mentions.map((m) => m.toLowerCase()));
  const seen = new Set<string>();
  const out: ActiveRule[] = [];
  for (const r of rules) {
    if (!r.body) continue;
    let reason: string | null = null;
    const slash = r.path.lastIndexOf('/');
    const isFolder = r.kind === 'instructions' && slash > 0;
    const dir = isFolder ? `${r.path.slice(0, slash)}/`.toLowerCase() : '';
    if (wanted.has(r.name.toLowerCase())) reason = 'mention';
    else if (isFolder) {
      // A sub-folder AGENTS.md / CLAUDE.md only speaks for the files inside that folder.
      if (paths.some((p) => p.toLowerCase().startsWith(dir))) reason = 'folder';
    } else if (r.applies === 'always') reason = 'always';
    else if (r.applies === 'glob') {
      const hit = r.globs.find((g) => {
        const re = globToRegExp(g.replace(/^\//, ''));
        return paths.some((p) => re.test(p));
      });
      if (hit) reason = hit;
    }
    if (!reason) continue;
    const key = r.body.replace(/\s+/g, ' ');
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
