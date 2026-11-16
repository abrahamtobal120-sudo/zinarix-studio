/**
 * Fase 3: whether a tool call runs on its own, asks the user, or is refused, given the
 * chat's mode. Pure (no Electron, no I/O) so Fase 5 can extend it and the whole table is
 * tested in test/approvalPolicy.test.ts.
 *
 * - auto: the mode lets it run without asking.
 * - ask: it goes to the approval card. A per-session "Always" answer may cover it later,
 *   unless alwaysAsks() is true (then it asks every time and offers no "Always").
 * - deny: refused before asking (approving it would not make it run anyway).
 *
 * Per-target checks that come after (blocked commands, the per-site browser approval,
 * project hooks) are not part of this decision.
 */
import type { ChatMode } from './agentModes.js';
import { planAllows } from './agentModes.js';
import { sandboxComplete, type SandboxCaps } from './sandbox.js';

export type Decision = 'auto' | 'ask' | 'deny';

export interface PolicyContext {
  /** The agent's tools that change nothing (they run without asking). */
  readOnly?: ReadonlySet<string>;
  /** An MCP tool whose server marks it read-only. */
  mcpReadOnly?: boolean;
  /** A file that makes other programs run code, holds secrets or rules. Missing = every
   * file counts as protected, so auto-approve only applies when the caller says how. */
  isProtected?: (path: string) => boolean;
  /** Whether a SQL text changes data. Missing = every query counts as a write. */
  isWriteSql?: (sql: string) => boolean;
  /** Fase 5B: the sandbox a background task's commands run in. Auto mode runs run_command
   * without asking only when every protection is active (writes and network); otherwise,
   * or outside a task (undefined), commands ask as always. */
  sandbox?: SandboxCaps;
}

/** Tools that need no approval in any mode that runs the agent. */
const FREE = new Set(['todo_write', 'ask_user', 'list_ai_models', 'use_skill']);

/** Project file edits that auto-approve lets through (commands still ask). */
const FILE_EDITS = new Set(['edit_file', 'write_file']);

/** Vercel tools that only read; every other vercel_* (also future ones) changes something. */
const VERCEL_READS = new Set([
  'vercel_accounts',
  'vercel_projects',
  'vercel_project',
  'vercel_deployments',
  'vercel_logs',
]);

const NONE: ReadonlySet<string> = new Set();
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Options of git that take a value as the next word (`git -C dir push`). */
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

/**
 * Whether a shell command runs `git push` anywhere in it: after `cd x &&`, behind global
 * options (`git -C repo push`), or with a path to git (`/usr/bin/git`, `git.exe`).
 */
export function isGitPush(command: string): boolean {
  for (const part of command.split(/&&|\|\||[;&|\n()`]|\$\(/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!.replace(/^["']|["']$/g, '');
      if (!/(^|[\\/])git(\.exe)?$/i.test(w)) continue;
      let j = i + 1;
      while (j < words.length && words[j]!.startsWith('-')) {
        j += GIT_VALUE_OPTS.has(words[j]!) ? 2 : 1;
      }
      if (words[j] === 'push') return true;
    }
  }
  return false;
}

/**
 * Actions that always ask, in every mode, and never take an "Always" answer: sending mail,
 * git push, Vercel changes, Supabase SQL that writes and Blender scripts (code outside the sandbox).
 */
export function alwaysAsks(
  tool: string,
  args: Record<string, unknown>,
  ctx: PolicyContext = {},
): boolean {
  if (tool === 'mail_send') return true;
  // Fase 14: Python inside Blender runs outside any sandbox, even with full access.
  if (tool === 'blender_script') return true;
  if (tool === 'run_command') return isGitPush(str(args.command));
  if (tool.startsWith('vercel_')) return !VERCEL_READS.has(tool);
  if (tool === 'supabase_query') return (ctx.isWriteSql ?? (() => true))(str(args.sql));
  return false;
}

/** The decision for one tool call in a mode. */
export function decide(
  mode: ChatMode,
  tool: string,
  args: Record<string, unknown>,
  ctx: PolicyContext = {},
): Decision {
  // Ask is a plain chat: the agent does not run.
  if (mode === 'ask') return 'deny';
  const readOnly = ctx.readOnly ?? NONE;
  // Plan: anything that changes something is refused, even when the model calls it.
  if (mode === 'plan' && !planAllows(tool, readOnly, ctx.mcpReadOnly)) return 'deny';
  if (alwaysAsks(tool, args, ctx)) return 'ask';
  if (FREE.has(tool) || (readOnly.has(tool) && !tool.startsWith('mcp__'))) return 'auto';
  // Files that make other programs run code, hold secrets or rules ask even with full
  // access: a prompt injection could plant a hook or a script that runs later.
  if ((mode === 'auto' || mode === 'full') && FILE_EDITS.has(tool)) {
    const isProtected = ctx.isProtected ?? (() => true);
    return isProtected(str(args.path)) ? 'ask' : 'auto';
  }
  // Auto in the worktree: a command confined by a complete sandbox runs on its own.
  if (mode === 'auto' && tool === 'run_command' && sandboxComplete(ctx.sandbox)) {
    return args.admin === true ? 'deny' : 'auto';
  }
  // Full access: commands run on their own (blocked commands are still refused by the
  // agent); running as administrator still asks, since the OS dialog asks anyway.
  if (mode === 'full' && tool === 'run_command') return args.admin === true ? 'ask' : 'auto';
  return 'ask';
}
