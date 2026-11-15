/**
 * Fase 15 — approval policy of the headless agent (`omni agent -p`).
 *
 * Nobody is there to answer an approval prompt, so every action is decided up front by the
 * level the caller chose. What "Agente" mode would ask about becomes a refusal the model sees.
 *
 * | level      | read | edit files | run_command                        |
 * |------------|------|------------|------------------------------------|
 * | read-only  | yes  | no         | no                                 |
 * | auto-edit  | yes  | yes        | no                                 |
 * | full       | yes  | yes        | yes, except actions that publish   |
 *
 * Commands that act outside the machine (git push, gh pr create, npm publish, deploys) are
 * refused at every level: the CI job does that itself, after reading the result.
 *
 * Pure: no I/O, tested in packages/core/test/agent.test.ts.
 */

export const APPROVE_LEVELS = ['read-only', 'auto-edit', 'full'] as const;
export type ApproveLevel = (typeof APPROVE_LEVELS)[number];

export function isApproveLevel(v: unknown): v is ApproveLevel {
  return typeof v === 'string' && (APPROVE_LEVELS as readonly string[]).includes(v);
}

export const READ_TOOLS = ['list_files', 'read_file', 'search'] as const;
export const EDIT_TOOLS = ['write_file', 'edit_file'] as const;
export const COMMAND_TOOLS = ['run_command'] as const;

export type AgentToolName =
  (typeof READ_TOOLS)[number] | (typeof EDIT_TOOLS)[number] | (typeof COMMAND_TOOLS)[number];

export type Decision = { allow: true } | { allow: false; reason: string };

/** Tools offered to the model at this level (the policy still checks every call). */
export function toolsFor(level: ApproveLevel): AgentToolName[] {
  if (level === 'read-only') return [...READ_TOOLS];
  if (level === 'auto-edit') return [...READ_TOOLS, ...EDIT_TOOLS];
  return [...READ_TOOLS, ...EDIT_TOOLS, ...COMMAND_TOOLS];
}

/**
 * Commands that publish or deploy. Matched anywhere in the command line (also after `&&`,
 * `;` or a pipe), so `pnpm test && git push` is refused too.
 */
const PUBLISHING: readonly { re: RegExp; what: string }[] = [
  { re: /\bgit(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+push\b/i, what: 'git push' },
  { re: /\bgh\b\s+(?:pr|release|issue|repo|gist|api|workflow|secret)\b/i, what: 'gh' },
  { re: /\b(?:npm|pnpm|yarn|bun)\b[^;&|\n]*\bpublish\b/i, what: 'publish' },
  {
    re: /\b(?:vercel|netlify|firebase|flyctl|fly)\b[^;&|\n]*(?:\bdeploy\b|--prod\b)/i,
    what: 'deploy',
  },
  { re: /\bvercel\b\s*(?:$|[;&|\n])/i, what: 'deploy' },
  { re: /\b(?:twine|cargo)\b\s+(?:upload|publish)\b/i, what: 'publish' },
  { re: /\bdocker\b\s+push\b/i, what: 'docker push' },
];

/** The publishing action a command contains, or null. */
export function publishingAction(command: string): string | null {
  for (const p of PUBLISHING) if (p.re.test(command)) return p.what;
  return null;
}

export function decide(level: ApproveLevel, tool: string, args: Record<string, unknown>): Decision {
  if ((READ_TOOLS as readonly string[]).includes(tool)) return { allow: true };
  if ((EDIT_TOOLS as readonly string[]).includes(tool)) {
    return level === 'read-only'
      ? {
          allow: false,
          reason: `"${tool}" is not allowed: this run is read-only (--approve=read-only).`,
        }
      : { allow: true };
  }
  if (tool === 'run_command') {
    if (level !== 'full')
      return {
        allow: false,
        reason: `run_command is not allowed at --approve=${level}; it needs --approve=full.`,
      };
    const cmd = typeof args.command === 'string' ? args.command : '';
    const pub = publishingAction(cmd);
    if (pub)
      return {
        allow: false,
        reason: `"${pub}" publishes outside this machine and is never run by the headless agent. Leave it to the CI job.`,
      };
    return { allow: true };
  }
  return { allow: false, reason: `Unknown tool "${tool}".` };
}
