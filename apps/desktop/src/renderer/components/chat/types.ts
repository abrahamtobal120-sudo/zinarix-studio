import type { ToolDecision, ToolPreview } from '../../../shared/api';
import type { ChatMode } from '../../../shared/agentModes';
import { t } from '../../i18n';

/** Readable label for a context source ("file:src/a.ts", "terminal:2:selection", …). */
export function contextLabel(source: string): string {
  const term = /^terminal:(\d+)(:selection)?$/.exec(source);
  if (term) return t(term[2] ? 'termSelection' : 'termSession', { n: term[1]! });
  // Fase 8 mentions: "@git", "@git:HEAD~1", "@problems", "@web:https://…", "@docs:react".
  if (/^(git|problems|web|docs)(:|$)/.test(source)) return `@${source}`;
  return source.replace(/^(file|selection):/, '');
}

export interface ToolStep {
  kind: 'tool';
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** A helper AI (delegate_to_ai) made this call: its model. */
  agent?: string;
  status: 'running' | 'approval' | 'ok' | 'error';
  summary?: string;
  output?: string;
  preview?: ToolPreview;
}
export type Part = { kind: 'text'; text: string } | ToolStep;

export interface Turn {
  /** Stable identity of the message in the list (React key): survives edit / regenerate. */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts?: Part[];
  model?: string;
  meta?: string;
  error?: string;
  notices?: string[];
  reasoning?: string;
  context?: string[];
  /** Images sent with this message (data: URLs, shown as thumbnails). */
  images?: string[];
  /** Request of the exchange (question and answer share it): several can run at once. */
  rid?: string;
  /** Fase 3: answered in plan mode (it ends with a plan to approve), and the user's verdict. */
  mode?: ChatMode;
  plan?: 'approved' | 'rejected';
  /** "Compactar chat": summed up in a summary turn; hidden, and no longer sent as history. */
  compacted?: boolean;
  /** "Compactar chat": this turn is the summary that replaces the compacted ones. */
  summary?: boolean;
  /** Messages the summary replaces (those of earlier summaries included). */
  summaryOf?: number;
}

/** What a message of the list can do; one stable object per chat (see `turnActions`). */
export interface TurnActions {
  editLast: () => void;
  regenerate: () => void;
  continueLast: () => void;
  agentOff: () => void;
  copy: (turn: Turn) => void;
  quote: (turn: Turn) => void;
  handoff: (turn: Turn) => void;
  decide: (toolCallId: string, d: ToolDecision, rid?: string) => void;
  /** The user's answer to an ask_user question (Fase 3). */
  answer: (toolCallId: string, answer: string[] | null, rid?: string) => void;
  /** Fase 3: approve (and run, in agent or auto-approve mode), edit or reject a plan. */
  approvePlan: (turn: Turn, mode?: 'agent' | 'auto') => void;
  editPlan: (turn: Turn) => void;
  rejectPlan: (turn: Turn) => void;
  /** "Volver aquí" on a user message (Fase 2). */
  rewind: (turn: Turn) => void;
  /** Diff of the files an answer changed, by blocks (Fase 2). */
  review: (turn: Turn) => void;
}

/** Tools whose file changes are checkpointed (rewind / review, Fase 2). */
export const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'write_system_file', 'set_env_var']);
export const stepsOf = (turn: Turn, names: ReadonlySet<string>) =>
  (turn.parts ?? []).filter(
    (p): p is ToolStep => p.kind === 'tool' && names.has(p.name) && p.status === 'ok',
  ).length;
