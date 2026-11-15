import type { ChatMessage, ToolCall, ToolDefinition } from '@omni/shared';

/**
 * Tool use for models that cannot call tools natively (no function calling, or a CLI agent
 * like Claude Code / Codex / Gemini CLI that brings its own tools): the model writes
 *
 *   <tool_call>
 *   {"name": "browser_open", "arguments": {"url": "https://example.com"}}
 *   </tool_call>
 *
 * in its answer, Zinarix runs the tool (with the same approvals as always) and sends the
 * result back as a <tool_results> message. The format is the one most open models are
 * trained on (Hermes / Qwen), so even small local models follow it.
 */

const OPEN = '<tool_call>';
const CLOSE = '</tool_call>';

/** JSON-schema arguments rendered as a short signature: name(url: string, depth?: integer). */
function signature(t: ToolDefinition): string {
  const p = t.parameters as {
    properties?: Record<string, { type?: string; enum?: string[] }>;
    required?: string[];
  };
  const req = new Set(p.required ?? []);
  const args = Object.entries(p.properties ?? {}).map(([k, v]) => {
    const type = v.enum ? v.enum.map((e) => JSON.stringify(e)).join('|') : (v.type ?? 'any');
    return `${k}${req.has(k) ? '' : '?'}: ${type}`;
  });
  return `${t.name}(${args.join(', ')})`;
}

/** Instructions appended to the system prompt (API models) or the user message (CLI agents). */
export function protocolBlock(tools: ToolDefinition[], cli: boolean): string {
  const intro = cli
    ? 'Zinarix Studio (the app running you) gives you extra tools besides your own: a real web browser the user watches (you can open pages, read them, click and type), and other AI models you can ask for help. Keep using your own tools for files and commands; use these for the browser and for delegating.'
    : 'You can use tools.';
  const list = tools.map((t) => `- ${signature(t)}: ${t.description}`).join('\n');
  return (
    `<zinarix-tools>\n${intro}\n` +
    'To call a tool, write exactly this block (valid JSON inside) and then STOP writing until the result arrives:\n' +
    `${OPEN}\n{"name": "TOOL_NAME", "arguments": {"arg": "value"}}\n${CLOSE}\n` +
    'You may write several blocks in a row for independent calls. Never invent a tool result: ' +
    'Zinarix runs the tool (the user approves actions) and replies with a <tool_results> message. ' +
    'When the task is done, answer normally, with no tool_call block.\n' +
    `Available tools:\n${list}\n</zinarix-tools>`
  );
}

/** Copy of the conversation with the protocol added where the model will read it. */
export function withProtocol(
  messages: ChatMessage[],
  block: string,
  where: 'system' | 'user',
): ChatMessage[] {
  const out = [...messages];
  if (where === 'system') {
    const i = out.findIndex((m) => m.role === 'system');
    if (i >= 0) {
      const m = out[i] as Extract<ChatMessage, { role: 'system' }>;
      out[i] = { role: 'system', content: `${m.content}\n\n${block}` };
    } else out.unshift({ role: 'system', content: block });
    return out;
  }
  // CLI agents drop system prompts: the current (last) user message carries it.
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]!;
    if (m.role !== 'user') continue;
    out[i] =
      typeof m.content === 'string'
        ? { role: 'user', content: `${m.content}\n\n${block}` }
        : { role: 'user', content: [...m.content, { type: 'text', text: block }] };
    return out;
  }
  return [...out, { role: 'user', content: block }];
}

/** Length of the longest suffix of `s` that is a prefix of `tag` (a tag split across chunks). */
function partialSuffix(s: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--)
    if (s.endsWith(tag.slice(0, n))) return n;
  return 0;
}

/**
 * Streamed text as the user should see it: <tool_call> blocks are hidden (they become tool
 * cards), and so is anything written after a call in the same answer (weak models often go
 * on to imagine the result).
 */
export class ToolTagFilter {
  private buf = '';
  private inside = false;
  private sawCall = false;

  push(delta: string): string {
    this.buf += delta;
    let out = '';
    for (;;) {
      if (this.inside) {
        const end = this.buf.indexOf(CLOSE);
        if (end < 0) {
          this.buf = this.buf.slice(-(CLOSE.length - 1));
          return out;
        }
        this.buf = this.buf.slice(end + CLOSE.length);
        this.inside = false;
        this.sawCall = true;
        continue;
      }
      const start = this.buf.indexOf(OPEN);
      if (start >= 0) {
        if (!this.sawCall) out += this.buf.slice(0, start).replace(/```[\w-]*\s*$/, '');
        this.buf = this.buf.slice(start + OPEN.length);
        this.inside = true;
        continue;
      }
      const keep = partialSuffix(this.buf, OPEN);
      if (!this.sawCall) out += this.buf.slice(0, this.buf.length - keep);
      this.buf = this.buf.slice(this.buf.length - keep);
      return out;
    }
  }

  flush(): string {
    const rest = this.inside || this.sawCall ? '' : this.buf;
    this.buf = '';
    return rest;
  }
}

/** Lenient JSON: fences and text around the object are tolerated. */
function parseJson(body: string): unknown {
  const clean = body
    .replace(/^\s*```[\w-]*\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    const a = clean.indexOf('{');
    const b = clean.lastIndexOf('}');
    if (a < 0 || b <= a) return undefined;
    try {
      return JSON.parse(clean.slice(a, b + 1));
    } catch {
      return undefined;
    }
  }
}

export interface ParsedCalls {
  calls: ToolCall[];
  /** Malformed blocks (reported back to the model so it can fix them). */
  errors: string[];
  /** The answer as kept in the transcript: up to the last tool call (later text is dropped). */
  kept: string;
  /** What the user saw (blocks removed). */
  visible: string;
}

export function parseToolCalls(text: string, idPrefix: string): ParsedCalls {
  const calls: ToolCall[] = [];
  const errors: string[] = [];
  const re = /<tool_call>([\s\S]*?)(<\/tool_call>|$)/g;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) break;
    lastEnd = m.index + m[0].length;
    const v = parseJson(m[1]!) as Record<string, unknown> | undefined;
    const name = v && (v.name ?? v.tool ?? v.function);
    const args = v && (v.arguments ?? v.args ?? v.parameters ?? v.input ?? {});
    if (typeof name !== 'string' || !name || typeof args !== 'object' || args === null) {
      errors.push(m[1]!.trim().slice(0, 300));
      continue;
    }
    calls.push({ id: `${idPrefix}${calls.length + 1}`, name, arguments: JSON.stringify(args) });
  }
  const kept = lastEnd >= 0 ? text.slice(0, lastEnd) : text;
  const first = text.indexOf(OPEN);
  const visible = (first >= 0 ? text.slice(0, first).replace(/```[\w-]*\s*$/, '') : text).trim();
  return { calls, errors, kept: kept.trim(), visible };
}

/** The message that carries tool results back to a text-protocol model. */
export function resultsMessage(
  results: { name: string; ok: boolean; content: string }[],
  errors: string[],
): string {
  const body = results
    .map((r) => `<tool_result name="${r.name}" ok="${r.ok}">\n${r.content}\n</tool_result>`)
    .join('\n');
  const bad = errors.length
    ? `\n<tool_error>These tool_call blocks were not valid JSON with "name" and "arguments" and were not run:\n${errors.join('\n---\n')}</tool_error>`
    : '';
  return (
    `<tool_results>\n${body}${bad}\n</tool_results>\n` +
    'Continue the task with these results. To call another tool write a <tool_call> block; when you are done, answer normally.'
  );
}

/**
 * The provider refused the request because of the tools (the model has no function
 * calling): such a model can still act through the text protocol.
 */
export function toolsUnsupported(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /\b(tools?|function[ _-]?call(ing|s)?|functions)\b/i.test(msg) &&
    /(not|n't|no)\s+(be\s+)?(support|allow|enabled|available|accept)|unsupported|unrecognized|unknown (parameter|field|argument)|extra (inputs|fields)|--jinja|invalid/i.test(
      msg,
    )
  );
}
