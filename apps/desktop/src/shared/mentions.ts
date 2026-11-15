/**
 * Fase 8 — context mentions in the chat besides "@file": @git, @terminal, @problems, @web and
 * @docs. Pure parsing and formatting; the chat (renderer) and main fill in the content.
 */

export type MentionKind = 'git' | 'terminal' | 'problems' | 'web' | 'docs';

export interface Mention {
  kind: MentionKind;
  /** "@git:abc123" → "abc123"; "@terminal:2" → "2"; "@web:https://…" → the URL; "@docs:react". */
  arg?: string;
}

/** The special mentions, in the order the "@" menu offers them. */
export const MENTION_KINDS: MentionKind[] = ['git', 'terminal', 'problems', 'web', 'docs'];

const ARG_OK: Record<MentionKind, RegExp> = {
  // a commit hash, HEAD~n, or "staged"
  git: /^(?:[0-9a-f]{4,40}|HEAD(?:~\d{1,3})?|staged)$/i,
  terminal: /^\d{1,2}$/,
  problems: /^(?:errors|all)$/i,
  web: /^https?:\/\/\S+$/i,
  docs: /^[\w.-]{1,80}$/,
};

/**
 * Special mentions in a prompt ("@git", "@git:HEAD~1", "@terminal:2", "@problems",
 * "@web:https://…", "@docs:name"). A mention must start the text or follow whitespace; an
 * argument that is not valid for its kind makes the whole mention plain text. Duplicates
 * collapse; at most 8.
 */
export function parseMentions(prompt: string): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  for (const m of prompt.matchAll(
    /(^|\s)@(git|terminal|problems|web|docs)(?::(\S+))?(?=$|\s|[,.;!?)])/gi,
  )) {
    const kind = m[2]!.toLowerCase() as MentionKind;
    let arg = m[3];
    if (arg !== undefined) {
      // trailing punctuation belongs to the sentence ("see @web:https://x.dev/a.")
      arg = arg.replace(/[.,;:!?)]+$/, '');
      if (!ARG_OK[kind].test(arg)) continue;
    }
    const key = `${kind}:${arg ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(arg === undefined ? { kind } : { kind, arg });
    if (out.length >= 8) break;
  }
  return out;
}

/** The prompt with the special mentions removed (what is left is the question). */
export function stripMentions(prompt: string): string {
  return prompt
    .replace(/(^|\s)@(?:git|terminal|problems|web|docs)(?::\S+)?(?=$|\s)/gi, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Chat context source of a mention ("git", "git:HEAD~1", "problems"…). */
export function mentionSource(m: Mention): string {
  return m.arg ? `${m.kind}:${m.arg}` : m.kind;
}

export interface ProblemLike {
  path: string;
  line: number;
  column: number;
  message: string;
  /** 'error' | 'warning' | 'info' */
  severity: 'error' | 'warning' | 'info';
  source?: string;
  code?: string;
}

/**
 * The Problems list as text for the model: errors first, grouped by file, at most `max`
 * entries and `maxChars` characters. "errors" keeps only errors.
 */
export function formatProblems(
  problems: ProblemLike[],
  only: 'all' | 'errors' = 'all',
  max = 120,
  maxChars = 20_000,
): string {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  const list = problems
    .filter((p) => only === 'all' || p.severity === 'error')
    .sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path) || a.line - b.line,
    );
  if (!list.length) return '';
  const shown = list.slice(0, max);
  const lines = shown.map((p) => {
    const tag = [p.source, p.code].filter(Boolean).join(' ');
    return `${p.path}:${p.line}:${p.column} ${p.severity}${tag ? ` [${tag}]` : ''}: ${p.message.replace(/\s+/g, ' ').trim()}`;
  });
  const counts = (['error', 'warning', 'info'] as const)
    .map((s) => [s, list.filter((p) => p.severity === s).length] as const)
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${s}${n === 1 ? '' : 's'}`)
    .join(', ');
  let text = `${counts}\n${lines.join('\n')}`;
  if (list.length > shown.length) text += `\n… ${list.length - shown.length} more`;
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}
