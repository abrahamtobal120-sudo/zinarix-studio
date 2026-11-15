/**
 * Fase 3: how the chat works (ask / plan / agent / auto-approve), the agent's live task
 * list (todo_write) and its multiple-choice questions (ask_user). Pure: no Electron, no I/O.
 */

/** ask = plain chat (no tools); plan = read-only agent that ends with a plan; agent = the
 * usual agent (every change approved); auto = file edits in the project need no approval. */
export type ChatMode = 'ask' | 'plan' | 'agent' | 'auto';

/** The modes in which the agent runs (ask is a plain chat). */
export type AgentRunMode = Exclude<ChatMode, 'ask'>;

/** Shift+Tab order. */
export const CHAT_MODES: readonly ChatMode[] = ['ask', 'plan', 'agent', 'auto'];

export function isChatMode(v: unknown): v is ChatMode {
  return typeof v === 'string' && (CHAT_MODES as readonly string[]).includes(v);
}

/** The next mode for Shift+Tab (or the previous one with back = true). */
export function nextMode(mode: ChatMode, back = false): ChatMode {
  const i = CHAT_MODES.indexOf(mode);
  const n = CHAT_MODES.length;
  return CHAT_MODES[(i + (back ? n - 1 : 1)) % n]!;
}

/** The mode of a chat saved before Fase 3 (only an agent on/off switch). */
export function modeFrom(saved: unknown, legacyAgent?: boolean): ChatMode {
  if (isChatMode(saved)) return saved;
  return legacyAgent === false ? 'ask' : 'agent';
}

/** The agent runs (tools) in every mode but ask. */
export const usesAgent = (m: ChatMode): boolean => m !== 'ask';

/**
 * Tools that plan mode adds to the read-only ones: the task list, questions, and helpers
 * (which inherit plan mode, so they cannot write either). Browser navigation reads pages;
 * clicking and typing could submit forms, so they stay out.
 */
const PLAN_EXTRA = new Set([
  'todo_write',
  'ask_user',
  'browser_open',
  'browser_read',
  'browser_scroll',
  'browser_back',
  'list_ai_models',
  'delegate_to_ai',
  'task',
  'use_skill',
]);

/**
 * Whether plan mode lets a tool run. `readOnly` is the agent's set of tools that change
 * nothing; MCP tools pass only when their server marks them read-only.
 */
export function planAllows(
  name: string,
  readOnly: ReadonlySet<string>,
  mcpReadOnly?: boolean,
): boolean {
  if (name.startsWith('mcp__')) return mcpReadOnly === true;
  return readOnly.has(name) || PLAN_EXTRA.has(name);
}

export const PLAN_REFUSAL =
  'Plan mode is on: this tool changes things and is disabled until the user approves the plan. ' +
  'Keep investigating with read-only tools, then answer with the plan.';

/** Appended to the system prompt in plan mode. */
export const PLAN_PROMPT = `

PLAN MODE is on. You may only investigate: read files, search, list, browse documentation. Every tool that changes something (edits, writes, commands, sending, deleting) is refused, so do not try them.
If something important is unclear, ask with ask_user before planning.
Your final answer must be the plan, in Markdown, for the user to approve, edit or reject:
## Objetivo (one or two sentences)
## Pasos (numbered, concrete: which file, what change, how it is verified)
## Archivos (the files to create or change)
## Riesgos (what could break, open questions)
Write the headings in the user's language. Do not start the work: it begins only after approval.`;

/** Helpers (delegate_to_ai, subagents) started in plan mode. */
export const PLAN_HELPER_PROMPT = `

PLAN MODE is on: only read-only tools work and every tool that changes something is refused. Investigate and report what you found.`;

/** Appended to the system prompt in agent and auto modes: when to keep a task list. */
export const TODO_PROMPT = `
For work of 3 or more steps, keep a task list with todo_write (the user sees it live): write it at the start, mark one task in_progress when you start it and completed as soon as it is done, and add tasks you discover. Skip it for quick one-step requests.`;

const APPROVAL_HEAD = {
  en: 'I approve this plan. Carry it out now, step by step, keeping the task list up to date:',
  es: 'Apruebo este plan. Ejecútalo ahora, paso a paso, y mantén la lista de tareas al día:',
} as const;

/** The user's approved plan, as the message that starts the work. */
export function planApprovedPrompt(plan: string, lang: 'es' | 'en' = 'es'): string {
  return `${APPROVAL_HEAD[lang]}\n\n${plan.trim()}`;
}

/** Whether a user message is the approval of a plan (planApprovedPrompt, in any language). */
export function isPlanApproval(text: string): boolean {
  const s = text.trimStart();
  return Object.values(APPROVAL_HEAD).some((h) => s.startsWith(h));
}

/** open = waiting for the user's verdict; null = not a plan, or the user just went on. */
export type PlanState = 'open' | 'approved' | 'rejected' | null;

/**
 * The state of each message's plan. A verdict given in this session wins; otherwise it is
 * read from what the user sent next, so it survives reopening the conversation: the approval
 * message means approved, anything else means the plan was left behind (no buttons). Only a
 * plan with nothing after it is still open.
 */
export function planStates(
  turns: readonly {
    role: 'user' | 'assistant';
    content: string;
    mode?: ChatMode;
    plan?: 'approved' | 'rejected';
    error?: string;
  }[],
): PlanState[] {
  const out: PlanState[] = turns.map(() => null);
  let nextUser: string | undefined;
  for (let i = turns.length - 1; i >= 0; i--) {
    const x = turns[i]!;
    if (x.role === 'user') {
      nextUser = x.content;
      continue;
    }
    if (x.mode !== 'plan' || !x.content.trim() || x.error) continue;
    if (x.plan) out[i] = x.plan;
    else if (nextUser === undefined) out[i] = 'open';
    else if (isPlanApproval(nextUser)) out[i] = 'approved';
  }
  return out;
}

// ---------------- todo_write ----------------

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface Todo {
  content: string;
  status: TodoStatus;
  /** Present-tense label shown while it is in progress ("Corriendo las pruebas"). */
  activeForm?: string;
}

export const MAX_TODOS = 50;
const MAX_TODO_TEXT = 300;
const STATUSES = new Set<TodoStatus>(['pending', 'in_progress', 'completed']);

/**
 * The list the model sent, checked: an error message instead when it is unusable. Text is
 * trimmed and cut, unknown statuses become pending and duplicates are dropped.
 */
export function parseTodos(raw: unknown): { todos: Todo[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: '"todos" must be an array of {content, status}.' };
  if (raw.length > MAX_TODOS) return { error: `At most ${MAX_TODOS} tasks.` };
  const todos: Todo[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== 'object') return { error: 'Each task must be {content, status}.' };
    const o = x as Record<string, unknown>;
    const content = typeof o.content === 'string' ? o.content.trim().slice(0, MAX_TODO_TEXT) : '';
    if (!content) return { error: 'Each task needs a non-empty "content".' };
    if (seen.has(content)) continue;
    seen.add(content);
    const status = STATUSES.has(o.status as TodoStatus) ? (o.status as TodoStatus) : 'pending';
    const activeForm =
      typeof o.activeForm === 'string' && o.activeForm.trim()
        ? o.activeForm.trim().slice(0, MAX_TODO_TEXT)
        : undefined;
    todos.push({ content, status, ...(activeForm ? { activeForm } : {}) });
  }
  return { todos };
}

export function todoProgress(todos: readonly Todo[]): { done: number; total: number } {
  return { done: todos.filter((t) => t.status === 'completed').length, total: todos.length };
}

/** What the model reads back after todo_write. */
export function todosResult(todos: readonly Todo[]): string {
  if (!todos.length) return 'Task list cleared.';
  const { done, total } = todoProgress(todos);
  const mark = { pending: '[ ]', in_progress: '[~]', completed: '[x]' } as const;
  const busy = todos.filter((t) => t.status === 'in_progress').length;
  return (
    `Task list updated (${done}/${total} done).\n` +
    todos.map((t) => `${mark[t.status]} ${t.content}`).join('\n') +
    (busy > 1 ? '\nNote: keep only one task in_progress at a time.' : '')
  );
}

// ---------------- ask_user ----------------

export interface Question {
  question: string;
  options: string[];
  /** The user may pick several options. */
  multiple: boolean;
}

export const MAX_OPTIONS = 6;

export function parseQuestion(a: Record<string, unknown>): Question | { error: string } {
  const question = typeof a.question === 'string' ? a.question.trim().slice(0, 1000) : '';
  if (!question) return { error: 'ask_user needs a "question".' };
  const raw = Array.isArray(a.options) ? a.options : [];
  const options = [
    ...new Set(
      raw
        .filter((o): o is string => typeof o === 'string')
        .map((o) => o.trim().slice(0, 200))
        .filter(Boolean),
    ),
  ];
  if (options.length < 2) return { error: 'ask_user needs at least 2 distinct "options".' };
  if (options.length > MAX_OPTIONS)
    return { error: `ask_user takes at most ${MAX_OPTIONS} options.` };
  return { question, options, multiple: a.multiple === true };
}

/** What the model reads back: the user's choice, their own words, or no answer. */
export function answerResult(q: Question, answer: readonly string[] | null): string {
  if (!answer || !answer.length)
    return 'The user did not answer. Go on with your best judgment and say what you assumed.';
  const picked = answer.map((x) => x.trim()).filter(Boolean);
  const own = picked.filter((x) => !q.options.includes(x));
  return (
    `The user answered "${q.question}":\n` +
    picked.map((x) => `- ${x}${own.includes(x) ? ' (in their own words)' : ''}`).join('\n')
  );
}
