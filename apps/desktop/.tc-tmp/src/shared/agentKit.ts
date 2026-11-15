import { parseFrontmatter } from './rules.js';

/**
 * Fase 4: what a project (or the user) adds to the agent, from plain files.
 *
 * - Subagents  .zinarix/agents/<name>.md         frontmatter: name, description, model, tools
 * - Skills     .zinarix/skills/<name>/SKILL.md   frontmatter: name, description (+ scripts next to it)
 * - Commands   .zinarix/commands/<name>.md       frontmatter: description, argument-hint, agent, model
 * - Hooks      .zinarix/settings.json            { "hooks": { "PreToolUse": [{ "matcher", "hooks": [{ "command" }] }] } }
 *
 * The same layout under .claude/ (agents, skills, commands) is read too: they are text formats.
 * Hooks are only read from Zinarix's own settings files.
 *
 * Pure: main/agentKit.ts reads the files, everything else is decided (and tested) here.
 */

export interface AgentDef {
  name: string;
  description: string;
  /** "provider/model"; undefined = the model of the agent that launches it. */
  model?: string;
  /** Tool names or groups as written (read, edit, bash…); undefined = every tool. */
  tools?: string[];
  prompt: string;
  path: string;
}

export interface SkillDef {
  name: string;
  description: string;
  /** Folder of the skill (relative to the project, or absolute for user skills). */
  dir: string;
  body: string;
}

export interface CommandDef {
  name: string;
  description: string;
  argumentHint?: string;
  /** true = runs in agent mode; false = plain chat; undefined = the current mode. */
  agent?: boolean;
  model?: string;
  body: string;
  path: string;
}

export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookDef {
  event: HookEvent;
  /** Tool name pattern (regex, "|" separated); "" or "*" = every tool. */
  matcher: string;
  command: string;
  /** Seconds. */
  timeout: number;
  /** Settings file it came from. */
  source: string;
}

export interface AgentKit {
  agents: AgentDef[];
  skills: SkillDef[];
  commands: CommandDef[];
  hooks: HookDef[];
}

export const EMPTY_KIT: AgentKit = { agents: [], skills: [], commands: [], hooks: [] };

export const DEFAULT_HOOK_TIMEOUT = 60;
const MAX_HOOK_TIMEOUT = 600;

/** Folders read, project first. User-level ones live in ~/.zinarix. */
export const KIT_DIRS = {
  agents: ['.zinarix/agents', '.claude/agents'],
  skills: ['.zinarix/skills', '.claude/skills'],
  commands: ['.zinarix/commands', '.claude/commands'],
  settings: ['.zinarix/settings.json', '.zinarix/settings.local.json'],
} as const;

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** "My Reviewer" → "my-reviewer": names used in tool calls and "/" commands. */
export function kitName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.(md|mdc)$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function list(v: unknown): string[] | undefined {
  const items = Array.isArray(v)
    ? v.flatMap((x) => String(x).split(','))
    : typeof v === 'string'
      ? v.split(',')
      : null;
  if (!items) return undefined;
  const out = items.map((s) => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function fileBase(path: string): string {
  return path.split('/').pop() ?? path;
}

/** One subagent file. null when it has no usable name. */
export function parseAgentDef(path: string, src: string): AgentDef | null {
  const { data, body } = parseFrontmatter(src);
  const name = kitName(text(data.name) || fileBase(path));
  if (!NAME_RE.test(name)) return null;
  const model = text(data.model);
  return {
    name,
    description: text(data.description) || firstLine(body),
    ...(model && model !== 'inherit' ? { model } : {}),
    ...(list(data.tools) ? { tools: list(data.tools) } : {}),
    prompt: body.trim(),
    path,
  };
}

/** One SKILL.md (dir = its folder). */
export function parseSkill(dir: string, src: string): SkillDef | null {
  const { data, body } = parseFrontmatter(src);
  const name = kitName(text(data.name) || fileBase(dir));
  if (!NAME_RE.test(name)) return null;
  return { name, description: text(data.description) || firstLine(body), dir, body: body.trim() };
}

/** One "/" command file. */
export function parseCommand(path: string, src: string): CommandDef | null {
  const { data, body } = parseFrontmatter(src);
  const name = kitName(fileBase(path));
  if (!NAME_RE.test(name) || !body.trim()) return null;
  const hint = text(data['argument-hint']) || text(data.argumentHint);
  const model = text(data.model);
  return {
    name,
    description: text(data.description) || firstLine(body),
    ...(hint ? { argumentHint: hint } : {}),
    ...(typeof data.agent === 'boolean' ? { agent: data.agent } : {}),
    ...(model ? { model } : {}),
    body: body.trim(),
    path,
  };
}

function firstLine(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find(Boolean);
  return (line ?? '').slice(0, 160);
}

/**
 * The prompt of a "/" command: $ARGUMENTS is everything typed after the name, $1…$9 the
 * words. A command that uses neither gets the arguments appended.
 */
export function expandCommand(body: string, args: string): string {
  const words = splitArgs(args);
  const uses = /\$ARGUMENTS|\$[1-9]/.test(body);
  const out = body
    .replace(/\$ARGUMENTS/g, args.trim())
    .replace(/\$([1-9])/g, (_, n: string) => words[Number(n) - 1] ?? '');
  return !uses && args.trim() ? `${out}\n\n${args.trim()}` : out;
}

/** Words of the arguments; "quoted text" stays one word. */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  for (const m of args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

/** Later definitions with an existing name are dropped (the project wins over the user). */
export function dedupe<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.name) ? false : (seen.add(i.name), true)));
}

/* ------------------------------------------------------------------ tools of a subagent */

/** Groups a subagent may name in "tools:" (Zinarix names and Claude Code's names). */
const TOOL_GROUPS: Record<string, string[]> = {
  read: ['tree', 'glob', 'list_dir', 'read_file', 'read_many_files', 'search', 'semantic_search'],
  grep: ['search', 'semantic_search'],
  glob: ['glob', 'tree'],
  ls: ['list_dir', 'tree'],
  edit: ['edit_file', 'write_file'],
  write: ['write_file', 'edit_file'],
  multiedit: ['edit_file'],
  bash: ['run_command'],
  terminal: ['run_command'],
  command: ['run_command'],
  web: [
    'browser_open',
    'browser_read',
    'browser_click',
    'browser_type',
    'browser_scroll',
    'browser_back',
  ],
  webfetch: ['browser_open', 'browser_read'],
  websearch: ['browser_open', 'browser_read'],
  docs: ['docs_list', 'docs_search'],
  memory: ['list_memories', 'remember', 'forget'],
  skills: ['use_skill'],
};

/**
 * The tool names a subagent may use. undefined (no "tools:") = every tool it is offered.
 * "browser", "mail", "mcp"… also work as prefixes (browser_*, mail_*, mcp__*).
 * A subagent never launches other subagents (no "task").
 */
export function allowedTools(spec: string[] | undefined, available: string[]): Set<string> {
  const all = available.filter((n) => n !== 'task');
  if (!spec) return new Set(all);
  const out = new Set<string>();
  for (const raw of spec) {
    const k = raw.trim();
    const low = k.toLowerCase().replace(/[\s_-]/g, '');
    if (k === '*') all.forEach((n) => out.add(n));
    for (const n of TOOL_GROUPS[low] ?? []) if (all.includes(n)) out.add(n);
    if (all.includes(k)) out.add(k);
    const prefix = low === 'mcp' ? 'mcp__' : `${k.toLowerCase()}_`;
    if (/^[a-z]+$/i.test(k)) for (const n of all) if (n.startsWith(prefix)) out.add(n);
    // mcp__server__* style patterns
    if (k.endsWith('*')) for (const n of all) if (n.startsWith(k.slice(0, -1))) out.add(n);
  }
  out.delete('task');
  return out;
}

/* ------------------------------------------------------------------------------- hooks */

/** Claude Code's names for Zinarix tools, so "Edit|Write" matchers work in both. */
const TOOL_ALIASES: Record<string, string> = {
  edit_file: 'Edit',
  write_file: 'Write',
  run_command: 'Bash',
  read_file: 'Read',
  read_many_files: 'Read',
  search: 'Grep',
  glob: 'Glob',
  list_dir: 'LS',
  browser_open: 'WebFetch',
  task: 'Task',
  use_skill: 'Skill',
};

/** settings.json → its hooks. Unknown events and entries without a command are ignored. */
export function parseHookSettings(json: string, source: string): HookDef[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const hooks = (data as { hooks?: unknown } | null)?.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const out: HookDef[] = [];
  for (const event of HOOK_EVENTS) {
    const groups = (hooks as Record<string, unknown>)[event];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!g || typeof g !== 'object') continue;
      const matcher = text((g as { matcher?: unknown }).matcher);
      const inner = (g as { hooks?: unknown }).hooks;
      // Short form: { "matcher": "...", "command": "..." }
      const entries = Array.isArray(inner) ? inner : [g];
      for (const h of entries) {
        if (!h || typeof h !== 'object') continue;
        const { type, command, timeout } = h as Record<string, unknown>;
        if (type !== undefined && type !== 'command') continue;
        const cmd = text(command);
        if (!cmd) continue;
        const t = typeof timeout === 'number' && timeout > 0 ? timeout : DEFAULT_HOOK_TIMEOUT;
        out.push({ event, matcher, command: cmd, timeout: Math.min(t, MAX_HOOK_TIMEOUT), source });
      }
    }
  }
  return out;
}

/** Does this matcher cover the tool? Regex (anchored) against the Zinarix and Claude names. */
export function hookMatches(matcher: string, tool: string | undefined): boolean {
  const m = matcher.trim();
  if (!m || m === '*' || tool === undefined) return true;
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${m})$`);
  } catch {
    return m === tool;
  }
  const alias = TOOL_ALIASES[tool];
  return re.test(tool) || (alias !== undefined && re.test(alias));
}

export function hooksFor(hooks: HookDef[], event: HookEvent, tool?: string): HookDef[] {
  return hooks.filter((h) => h.event === event && hookMatches(h.matcher, tool));
}

/**
 * Hook commands run code from the project: the user approves them once per set of commands.
 * The key changes whenever a command (or where it applies) changes.
 */
export function hooksFingerprint(hooks: HookDef[]): string {
  const src = hooks.map((h) => `${h.event}\u0000${h.matcher}\u0000${h.command}`).join('\u0001');
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    a = ((a << 5) + a + c) | 0;
    b = ((b << 5) + b + c * 31) | 0;
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

export interface HookResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

/**
 * What a hook's result means (same contract as Claude Code):
 * exit 0 = go on (stdout is extra context for UserPromptSubmit) · exit 2 = block, stderr goes
 * to the model · anything else = a warning for the user, the action goes on.
 * stdout JSON {"decision":"block","reason":"…"} also blocks.
 */
export function hookOutcome(r: HookResult): HookOutcome {
  const out = r.stdout.trim();
  const err = r.stderr.trim();
  if (r.timedOut) return { block: false, message: '', warning: 'timeout' };
  if (r.code === 2) return { block: true, message: err || out || 'Blocked by a hook.' };
  if (r.code === 0) {
    if (out.startsWith('{')) {
      let j: Record<string, unknown> | null = null;
      try {
        const v = JSON.parse(out) as unknown;
        if (v && typeof v === 'object' && !Array.isArray(v)) j = v as Record<string, unknown>;
      } catch {
        // plain text that starts with "{"
      }
      if (j) return jsonOutcome(j);
    }
    return { block: false, message: out };
  }
  return { block: false, message: '', warning: err || out || `exit ${String(r.code)}` };
}

export interface HookOutcome {
  block: boolean;
  /** block: why (for the model); otherwise extra context for the model ("" = none). */
  message: string;
  /** Something went wrong with the hook itself (shown to the user, the action goes on). */
  warning?: string;
  /** systemMessage of the JSON output: shown to the user, the model does not see it. */
  notice?: string;
}

/**
 * Claude Code's JSON output (exit 0): {"decision":"block","reason"} ·
 * {"continue":false,"stopReason"} · {"hookSpecificOutput":{"permissionDecision":"deny",
 * "permissionDecisionReason","additionalContext"}} · {"systemMessage"}.
 * "allow" / "ask" never skip Zinarix's own approval: a hook can only add restrictions.
 */
function jsonOutcome(j: Record<string, unknown>): HookOutcome {
  const spec =
    j.hookSpecificOutput && typeof j.hookSpecificOutput === 'object'
      ? (j.hookSpecificOutput as Record<string, unknown>)
      : {};
  const notice = text(j.systemMessage);
  const extra = notice ? { notice } : {};
  if (j.decision === 'block')
    return { block: true, message: text(j.reason) || 'Blocked by a hook.', ...extra };
  if (spec.permissionDecision === 'deny')
    return {
      block: true,
      message: text(spec.permissionDecisionReason) || text(j.reason) || 'Blocked by a hook.',
      ...extra,
    };
  if (j.continue === false)
    return {
      block: true,
      message: text(j.stopReason) || text(j.reason) || 'Stopped by a hook.',
      ...extra,
    };
  return { block: false, message: text(spec.additionalContext), ...extra };
}

/* --------------------------------------------------------------------- new kit files */

export type KitKind = 'agent' | 'skill' | 'command';

/**
 * Where a new subagent / skill / command of the project goes, and what it starts with.
 * `taken` = names already used, so "nuevo" becomes "nuevo-2" instead of overwriting.
 */
export function kitTemplate(
  kind: KitKind,
  rawName: string,
  taken: Iterable<string> = [],
): { name: string; path: string; content: string } {
  const used = new Set(taken);
  const base = kitName(rawName) || kind;
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base.slice(0, 60)}-${i}`;
  if (kind === 'agent')
    return {
      name,
      path: `.zinarix/agents/${name}.md`,
      content: `---
name: ${name}
description: Cuándo usar este subagente (el agente principal lo lee para decidir)
tools: read, grep
# model: openai/gpt-5   (sin "model" usa el mismo modelo que el agente principal)
---

Eres un subagente especializado. Describe aquí su rol, cómo trabaja y qué debe
entregar en su respuesta final (es lo único que verá el agente que lo lanzó).
`,
    };
  if (kind === 'skill')
    return {
      name,
      path: `.zinarix/skills/${name}/SKILL.md`,
      content: `---
name: ${name}
description: Qué hace esta skill y cuándo usarla (solo esto se carga hasta que se usa)
---

# ${name}

Instrucciones paso a paso. Puedes poner scripts o plantillas en esta misma carpeta
y mencionarlos aquí: el agente recibe la lista de archivos al cargar la skill.
`,
    };
  return {
    name,
    path: `.zinarix/commands/${name}.md`,
    content: `---
description: Qué hace /${name}
argument-hint: <texto>
---

Escribe aquí el prompt. $ARGUMENTS se cambia por lo que escribas después de /${name}
($1, $2… por cada palabra).
`,
  };
}

/** Claude Code's model aliases in subagent files → the Anthropic models they stand for. */
const CLAUDE_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  haiku: 'claude-haiku-5-5',
};

/**
 * The model a subagent runs on: its "model:" when Zinarix can run it ("provider/model", or a
 * Claude Code alias like "sonnet" when Anthropic is set up). undefined = the launching agent's.
 */
export function subagentModel(
  spec: string,
  resolve: (m: string) => string | undefined,
): string | undefined {
  const m = spec.trim();
  if (!m || m === 'inherit') return undefined;
  if (m.includes('/')) return resolve(m);
  const alias = CLAUDE_ALIASES[m.toLowerCase()];
  if (alias) return resolve(`anthropic/${alias}`);
  if (/^claude-/i.test(m)) return resolve(`anthropic/${m}`);
  return undefined;
}

/** The prompt sent when the user types /<skill> in the chat. */
export function skillPrompt(name: string, args: string): string {
  const rest = args.trim();
  const what = rest ? ` for this:\n\n${rest}` : ' now.';
  return `Use the skill "${name}" (call use_skill first to load it)${what}`;
}

/** The JSON a hook gets on stdin. file_path is added for tools that take a path. */
export function hookInput(
  event: HookEvent,
  fields: {
    sessionId: string;
    cwd?: string;
    tool?: string;
    input?: Record<string, unknown>;
    response?: { ok: boolean; content: string };
    prompt?: string;
    stopActive?: boolean;
    absPath?: string;
  },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    hook_event_name: event,
    session_id: fields.sessionId,
    cwd: fields.cwd ?? null,
  };
  if (fields.tool !== undefined) {
    base.tool_name = fields.tool;
    base.tool_input = {
      ...(fields.input ?? {}),
      ...(fields.absPath ? { file_path: fields.absPath } : {}),
    };
  }
  if (fields.response)
    base.tool_response = {
      success: fields.response.ok,
      output: fields.response.content.slice(0, 20_000),
    };
  if (fields.prompt !== undefined) base.prompt = fields.prompt;
  if (fields.stopActive !== undefined) base.stop_hook_active = fields.stopActive;
  return base;
}

/* ------------------------------------------------------------------- prompt for the agent */

/** Lines for the system prompt: the subagents and skills it can use (descriptions only). */
export function kitPrompt(kit: AgentKit, canLaunch: boolean): string {
  const parts: string[] = [];
  if (canLaunch && kit.agents.length)
    parts.push(
      'Subagents of this project (launch one with the task tool; each works with its own context and tools and returns its answer):\n' +
        kit.agents.map((a) => `- ${a.name}: ${a.description || '(no description)'}`).join('\n'),
    );
  if (kit.skills.length)
    parts.push(
      'Skills of this project (call use_skill with the name to load its full instructions before doing that kind of task):\n' +
        kit.skills.map((s) => `- ${s.name}: ${s.description || '(no description)'}`).join('\n'),
    );
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}
