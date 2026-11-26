import type { ChatMessage } from '@omni/shared';

/**
 * "Ahorrador de tokens": the chat sends less to the model and asks it for shorter answers.
 * Pure helpers shared by the chat and the agent (main) so the limits live in one place.
 */

/** Rides on the system prompt: shorter answers are the biggest saving on output tokens. */
export const SAVER_NOTE = `

<token-saver>
The user turned on token saver mode: every token costs them money. Be brief.
- Answer directly, without preambles, recaps of the question or closing offers.
- Show only the code that changes (with a line or two of context), never whole files that did not change.
- Prefer short lists over long paragraphs. Do not repeat what you already said in this conversation.
- In agent mode: read only the parts of files you need (use line ranges and search before reading whole files), avoid exploratory tool calls, and keep the final summary to a few lines.
Never skip anything the task needs to be correct: brevity is about words, not about quality.
</token-saver>`;

/** Past messages a chat in saver mode keeps (the rest of the history does not travel). */
export const SAVER_HISTORY_MESSAGES = 12;
/** Characters of past messages a chat in saver mode keeps (~7k tokens). */
export const SAVER_HISTORY_CHARS = 24_000;
/** Older answers longer than this are shortened (the newest exchange stays whole). */
export const SAVER_OLD_MESSAGE_CHARS = 2_000;
/** Characters of each attached context (open file, @mentions) in saver mode. */
export const SAVER_CONTEXT_CHARS = 12_000;
/** Characters of one tool result the agent keeps in saver mode. */
export const SAVER_TOOL_CHARS = 8_000;
/** Characters of recent tool results kept whole in saver mode (older ones become stubs). */
export const SAVER_KEEP_TOOL_CHARS = 40_000;
/** Agent conversations past this many tokens are summarized in saver mode. */
export const SAVER_CONTEXT_TOKENS = 24_000;

const textOf = (m: ChatMessage): string =>
  typeof m.content === 'string'
    ? m.content
    : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');

/** Keeps the start and the end of a long text (the middle is usually the least useful part). */
export function shorten(text: string, max: number, note = 'shortened to save tokens'): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max * 0.7);
  const tail = Math.max(0, max - head);
  return `${text.slice(0, head)}\n… [${note}] …\n${tail ? text.slice(-tail) : ''}`;
}

/**
 * The part of the chat history a saver-mode request sends: the newest messages that fit in
 * SAVER_HISTORY_CHARS (at most SAVER_HISTORY_MESSAGES), starting at a user message, with the
 * older long answers shortened. The last exchange always goes whole when it fits.
 */
export function saverHistory(history: ChatMessage[]): ChatMessage[] {
  const h = history.filter((m) => m.role !== 'system').slice(-SAVER_HISTORY_MESSAGES);
  const out: ChatMessage[] = [];
  let used = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    const m = h[i]!;
    // The newest two messages (the last exchange) keep their text; older ones get shortened.
    const recent = i >= h.length - 2;
    let msg: ChatMessage = m;
    if (!recent && typeof m.content === 'string' && m.content.length > SAVER_OLD_MESSAGE_CHARS)
      msg = { ...m, content: shorten(m.content, SAVER_OLD_MESSAGE_CHARS) } as ChatMessage;
    const size = textOf(msg).length;
    if (used + size > SAVER_HISTORY_CHARS && out.length) break;
    used += size;
    out.unshift(msg);
  }
  const first = out.findIndex((m) => m.role === 'user');
  return first < 0 ? [] : out.slice(first);
}

/** Context attachments in saver mode: each one shortened to SAVER_CONTEXT_CHARS. */
export function saverContext<T extends { content: string }>(context: T[]): T[] {
  return context.map((c) =>
    c.content.length > SAVER_CONTEXT_CHARS
      ? {
          ...c,
          content: shorten(
            c.content,
            SAVER_CONTEXT_CHARS,
            'shortened by token saver mode; read the file for the rest',
          ),
        }
      : c,
  );
}

/** The agent's summary threshold in saver mode (never above the model's own budget). */
export const saverBudget = (budget: number): number => Math.min(budget, SAVER_CONTEXT_TOKENS);
