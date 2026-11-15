import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { shellCommand } from './agentTools.js';

/**
 * Fase 15 — what the project adds to the headless agent, read the same way the desktop app
 * reads it (Fases 1 and 4):
 *
 * - Rules: AGENTS.md, CLAUDE.md, .zinarix/rules.md, .cursorrules,
 *   .github/copilot-instructions.md, and .zinarix/rules/*.md / .cursor/rules/*.mdc with
 *   `applies: always` (or `alwaysApply: true`). Glob and manual rules are listed so the agent
 *   can open them with read_file.
 * - Skills: .zinarix/skills/<name>/SKILL.md (and .claude/skills) of the project — only name and description
 *   go into the prompt; the agent reads SKILL.md when it uses one.
 * - Hooks: .zinarix/settings.json and .zinarix/settings.local.json, same contract as the app
 *   (exit 2 or {"decision":"block"} blocks the action and the reason goes to the model).
 */

export interface ProjectRule {
  path: string;
  name: string;
  applies: 'always' | 'glob' | 'manual';
  description: string;
  body: string;
}

export interface ProjectSkill {
  name: string;
  description: string;
  path: string;
}

export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface ProjectHook {
  event: HookEvent;
  matcher: string;
  command: string;
  /** Seconds. */
  timeout: number;
  source: string;
}

const ROOT_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.zinarix/rules.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
];
const RULE_DIRS = [
  { dir: '.zinarix/rules', ext: '.md' },
  { dir: '.cursor/rules', ext: '.mdc' },
];
const SKILL_DIRS = ['.zinarix/skills', '.claude/skills'];
const SETTINGS = ['.zinarix/settings.json', '.zinarix/settings.local.json'];

export const MAX_RULES_CHARS = 20_000;
const MAX_RULE_CHARS = 12_000;

/** Small YAML subset: `key: value`, `key: [a, b]`, `- a` lists, booleans. */
export function frontmatter(text: string): {
  data: Record<string, string | string[] | boolean>;
  body: string;
} {
  const src = text.replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string | string[] | boolean> = {};
  let listKey: string | null = null;
  const unq = (s: string) => {
    const v = s.trim();
    return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v;
  };
  for (const raw of m[1]!.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const cur = data[listKey];
      data[listKey] = [...(Array.isArray(cur) ? cur : []), unq(item[1]!)];
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
    } else if (value.startsWith('[') && value.endsWith(']'))
      data[key] = value.slice(1, -1).split(',').map(unq).filter(Boolean);
    else if (/^(true|false)$/i.test(value)) data[key] = value.toLowerCase() === 'true';
    else data[key] = unq(value);
  }
  return { data, body: src.slice(m[0].length) };
}

function read(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

export function parseProjectRule(path: string, text: string, ruleFile: boolean): ProjectRule {
  const { data, body } = frontmatter(text);
  const description = typeof data.description === 'string' ? data.description : '';
  const name = (path.split('/').pop() ?? path).replace(/\.(md|mdc)$/i, '');
  let applies: ProjectRule['applies'] = 'always';
  if (ruleFile) {
    const declared = typeof data.applies === 'string' ? data.applies.toLowerCase() : '';
    const globs = data.globs ?? data.glob;
    if (declared === 'always' || declared === 'glob' || declared === 'manual') applies = declared;
    else if (data.alwaysApply === true) applies = 'always';
    else if (globs && (Array.isArray(globs) ? globs.length : String(globs).trim()))
      applies = 'glob';
    else applies = 'manual';
  }
  return { path, name, applies, description, body: body.trim() };
}

export function loadRules(root: string): ProjectRule[] {
  const rules: ProjectRule[] = [];
  for (const p of ROOT_FILES) {
    const text = read(join(root, p));
    if (text?.trim()) rules.push(parseProjectRule(p, text, false));
  }
  for (const d of RULE_DIRS) {
    let names: string[] = [];
    try {
      names = readdirSync(join(root, d.dir))
        .filter((n) => n.endsWith(d.ext))
        .sort();
    } catch {
      continue;
    }
    for (const n of names) {
      const path = `${d.dir}/${n}`;
      const text = read(join(root, path));
      if (text?.trim()) rules.push(parseProjectRule(path, text, true));
    }
  }
  return rules;
}

export function loadSkills(root: string): ProjectSkill[] {
  const out: ProjectSkill[] = [];
  const seen = new Set<string>();
  {
    const base = root;
    for (const dir of SKILL_DIRS) {
      let names: string[] = [];
      try {
        names = readdirSync(join(base, dir)).sort();
      } catch {
        continue;
      }
      for (const n of names) {
        const file = join(base, dir, n, 'SKILL.md');
        const text = read(file);
        if (!text) continue;
        const { data } = frontmatter(text);
        const name = typeof data.name === 'string' && data.name ? data.name : n;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({
          name,
          description: typeof data.description === 'string' ? data.description : '',
          path: `${dir}/${n}/SKILL.md`,
        });
      }
    }
  }
  return out;
}

/** settings.json → its hooks (long form `{matcher, hooks:[{type,command}]}` or short form). */
export function parseHooks(json: string, source: string): ProjectHook[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const hooks = (data as { hooks?: unknown } | null)?.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const out: ProjectHook[] = [];
  for (const event of HOOK_EVENTS) {
    const groups = (hooks as Record<string, unknown>)[event];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!g || typeof g !== 'object') continue;
      const m = (g as { matcher?: unknown }).matcher;
      const matcher = typeof m === 'string' ? m : '';
      const inner = (g as { hooks?: unknown }).hooks;
      for (const h of Array.isArray(inner) ? inner : [g]) {
        if (!h || typeof h !== 'object') continue;
        const { type, command, timeout } = h as Record<string, unknown>;
        if (type !== undefined && type !== 'command') continue;
        if (typeof command !== 'string' || !command.trim()) continue;
        const t = typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 600) : 60;
        out.push({ event, matcher, command: command.trim(), timeout: t, source });
      }
    }
  }
  return out;
}

export function loadHooks(root: string): ProjectHook[] {
  return SETTINGS.flatMap((p) => {
    const text = read(join(root, p));
    return text ? parseHooks(text, p) : [];
  });
}

/** Claude Code names, so a matcher written for it ("Edit|Write", "Bash") also works. */
const ALIASES: Record<string, string> = {
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  run_command: 'Bash',
  list_files: 'LS',
  search: 'Grep',
};

export function hookMatches(matcher: string, tool: string | undefined): boolean {
  const m = matcher.trim();
  if (!m || m === '*' || tool === undefined) return true;
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${m})$`);
  } catch {
    return m === tool;
  }
  const alias = ALIASES[tool];
  return re.test(tool) || (alias !== undefined && re.test(alias));
}

export interface HookVerdict {
  block: boolean;
  /** Why it blocked (for the model), or extra context ("" = none). */
  message: string;
  warning?: string;
}

/** exit 0 = go on · exit 2 = block (stderr to the model) · other = warning, goes on. */
export function hookVerdict(
  code: number | null,
  stdout: string,
  stderr: string,
  timedOut = false,
): HookVerdict {
  const out = stdout.trim();
  const err = stderr.trim();
  if (timedOut) return { block: false, message: '', warning: 'timeout' };
  if (code === 2) return { block: true, message: err || out || 'Blocked by a hook.' };
  if (code !== 0)
    return { block: false, message: '', warning: err || out || `exit ${String(code)}` };
  if (out.startsWith('{')) {
    try {
      const j = JSON.parse(out) as Record<string, unknown>;
      const spec = (j.hookSpecificOutput ?? {}) as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === 'string' ? v : '');
      if (j.decision === 'block')
        return { block: true, message: s(j.reason) || 'Blocked by a hook.' };
      if (spec.permissionDecision === 'deny')
        return { block: true, message: s(spec.permissionDecisionReason) || 'Blocked by a hook.' };
      if (j.continue === false)
        return { block: true, message: s(j.stopReason) || 'Stopped by a hook.' };
      return { block: false, message: s(spec.additionalContext) };
    } catch {
      // plain text starting with "{"
    }
  }
  return { block: false, message: out };
}

/** Runs one hook command with the event JSON on stdin. */
export function runHook(
  hook: ProjectHook,
  input: Record<string, unknown>,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<HookVerdict> {
  return new Promise((done) => {
    const sh = shellCommand(hook.command);
    const child = spawn(sh.file, sh.args, {
      cwd,
      env: { ...env, ZINARIX_PROJECT_DIR: cwd, CLAUDE_PROJECT_DIR: cwd },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, hook.timeout * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ block: false, message: '', warning: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(hookVerdict(code, stdout.slice(0, 20_000), stderr.slice(0, 20_000), timedOut));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

export interface ProjectContext {
  rules: ProjectRule[];
  skills: ProjectSkill[];
  hooks: ProjectHook[];
}

export function loadProject(root: string): ProjectContext {
  return {
    rules: existsSync(root) ? loadRules(root) : [],
    skills: existsSync(root) ? loadSkills(root) : [],
    hooks: existsSync(root) ? loadHooks(root) : [],
  };
}

/** The part of the system prompt the project adds. Returns also the paths of the rules used. */
export function projectPrompt(ctx: ProjectContext): { text: string; used: string[] } {
  const parts: string[] = [];
  const used: string[] = [];
  let budget = MAX_RULES_CHARS;
  for (const r of ctx.rules.filter((x) => x.applies === 'always')) {
    if (budget <= 0) break;
    const body = r.body.slice(0, Math.min(MAX_RULE_CHARS, budget));
    budget -= body.length;
    used.push(r.path);
    parts.push(`<rule path="${r.path}">\n${body}\n</rule>`);
  }
  const lines: string[] = [];
  if (parts.length) lines.push('Project rules (follow them):', ...parts);
  const other = ctx.rules.filter((x) => x.applies !== 'always');
  if (other.length) {
    lines.push(
      'Other rules of the project; open one with read_file when the task touches what it describes:',
      ...other.map((r) => `- ${r.path}${r.description ? ` — ${r.description}` : ''}`),
    );
  }
  if (ctx.skills.length) {
    lines.push(
      'Skills available; to use one, read its SKILL.md with read_file and follow it:',
      ...ctx.skills.map(
        (s) => `- ${s.name} (${s.path})${s.description ? ` — ${s.description}` : ''}`,
      ),
    );
  }
  return { text: lines.join('\n'), used };
}
