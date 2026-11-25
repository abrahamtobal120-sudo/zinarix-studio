import type { ChatMessage } from '@omni/shared';

/**
 * Keeps a long agent run inside the model's context window: once the conversation passes
 * the budget, the old part is replaced by a summary the model itself writes, and the recent
 * part stays word for word. Without this a long task grows until the provider rejects it.
 */

/** Context assumed for a model the catalog knows nothing about (small local models). */
export const DEFAULT_CONTEXT = 32_000;
/** Share of the usable context at which the old part gets summarized. */
const TRIGGER = 0.8;
/** Share of the budget the recent, untouched part may take after a summary. */
const KEEP = 0.35;
/** Old messages are cut to this many characters each when handed to the summarizer. */
const MAX_PIECE = 4_000;
const IMAGE_TOKENS = 1_000;

export const SUMMARY_TAG = 'conversation-summary';

/** Rough token count: ~3.5 characters per token covers code and Spanish well enough. */
export function conversationTokens(messages: ChatMessage[]): number {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else
      for (const p of m.content)
        if (p.type === 'text') chars += p.text.length;
        else images++;
    if (m.role === 'assistant')
      for (const c of m.toolCalls ?? []) chars += c.name.length + c.arguments.length;
    chars += 12;
  }
  return Math.ceil(chars / 3.5) + images * IMAGE_TOKENS;
}

/**
 * Tokens the conversation may reach before it is summarized: the model's context minus
 * what the fixed part of every request takes (tools, protocol) and room for the answer.
 */
export function contextBudget(context: number | null | undefined, fixedTokens = 0): number {
  const window = context && context > 0 ? context : DEFAULT_CONTEXT;
  const reserve = Math.min(16_000, Math.floor(window * 0.2));
  return Math.max(2_000, Math.floor((window - reserve - fixedTokens) * TRIGGER));
}

export interface SummarySplit {
  /** System messages: always kept. */
  head: ChatMessage[];
  /** What gets summarized. */
  old: ChatMessage[];
  /** Kept word for word. Starts at a user message, so no tool result loses its call. */
  recent: ChatMessage[];
}

const isTurnStart = (m: ChatMessage): boolean => m.role === 'user';

/**
 * Where to cut: the recent part is the longest tail that starts at a user message and fits
 * in KEEP of the budget. Returns null when there is nothing old worth summarizing.
 */
export function splitForSummary(messages: ChatMessage[], budget: number): SummarySplit | null {
  let h = 0;
  while (h < messages.length && messages[h]!.role === 'system') h++;
  const head = messages.slice(0, h);
  const body = messages.slice(h);
  const keep = budget * KEEP;
  let cut = -1;
  let fallback = -1;
  for (let i = body.length - 1; i > 0; i--) {
    if (!isTurnStart(body[i]!)) continue;
    if (fallback < 0) fallback = i;
    if (conversationTokens(body.slice(i)) > keep) break;
    cut = i;
  }
  // Even the last turn alone is over the share: still better than sending everything.
  if (cut < 0) cut = fallback;
  if (cut <= 0) return null;
  return { head, old: body.slice(0, cut), recent: body.slice(cut) };
}

function clip(text: string, max = MAX_PIECE): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max / 2)}\n… [${text.length - max} characters omitted] …\n${text.slice(-max / 2)}`;
}

/** The old part as plain text for the summarizer (works with any model, no tool history). */
export function compactTranscript(old: ChatMessage[]): string {
  const out: string[] = [];
  for (const m of old) {
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n');
    if (m.role === 'user') out.push(`USER:\n${clip(text)}`);
    else if (m.role === 'assistant') {
      const calls = (m.toolCalls ?? []).map((c) => `→ ${c.name}(${clip(c.arguments, 600)})`);
      out.push(`ASSISTANT:\n${[clip(text), ...calls].filter(Boolean).join('\n')}`);
    } else if (m.role === 'tool')
      out.push(`TOOL ${m.name ?? ''}${m.isError ? ' (error)' : ''}:\n${clip(text, 1_500)}`);
  }
  return out.join('\n\n');
}

const INSTRUCTIONS = `You are compacting a coding agent's conversation so the work can go on in a smaller context. Write the summary the agent will read instead of the conversation below. Keep, in this order:
1. What the user asked for, in their words where it matters, and every instruction or preference they gave.
2. What has been done: files created or changed (with paths) and commands that mattered, with their outcome.
3. What was learned about the project: relevant files, functions, conventions, errors seen and their cause.
4. What is left to do and the next step.
Be specific (paths, names, exact error messages). Do not invent anything. Answer with the summary only, in the language the user writes in.`;

/** The request that asks a model for the summary (no tools). */
export function summaryRequest(old: ChatMessage[]): ChatMessage[] {
  return [
    { role: 'system', content: INSTRUCTIONS },
    { role: 'user', content: `<conversation>\n${compactTranscript(old)}\n</conversation>` },
  ];
}

/** The conversation after compaction: system, summary, then the recent part untouched. */
export function applySummary(split: SummarySplit, summary: string): ChatMessage[] {
  const note: ChatMessage = {
    role: 'user',
    content: `<${SUMMARY_TAG}>\nThe earlier part of this conversation was summarized to save context. Files may have changed since: read them again before editing.\n\n${summary.trim()}\n</${SUMMARY_TAG}>`,
  };
  // Two user messages in a row are merged: some providers refuse them.
  const [first, ...rest] = split.recent;
  if (first && first.role === 'user' && typeof first.content === 'string')
    return [
      ...split.head,
      { role: 'user', content: `${note.content as string}\n\n${first.content}` },
      ...rest,
    ];
  return [...split.head, note, { role: 'assistant', content: 'Entendido.' }, ...split.recent];
}
