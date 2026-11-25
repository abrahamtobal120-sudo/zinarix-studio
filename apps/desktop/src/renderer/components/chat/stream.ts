import type { ChatEventView } from '../../../shared/api';
import type { Turn } from './types';

/**
 * How one answer of the chat is written while it streams (C3). Pure: no React, no store and no
 * i18n, so the mapping from model events to what the chat shows is tested on its own.
 */

/** A change to the answer being written. */
export type TurnUpdate = (turn: Turn) => Turn;

type CostEvent = Extract<ChatEventView, { type: 'cost' }>;

/**
 * The change one event makes to the answer it belongs to; null when the event does not touch
 * the answer (conversation id, changed file, done). `meta` writes the tokens / cost line.
 */
export function eventUpdate(e: ChatEventView, meta: (c: CostEvent) => string): TurnUpdate | null {
  switch (e.type) {
    case 'start':
      return (turn) => ({ ...turn, model: `${e.provider}/${e.model}` });
    case 'text':
      return (turn) => {
        const parts = [...(turn.parts ?? [])];
        const last = parts[parts.length - 1];
        if (last?.kind === 'text')
          parts[parts.length - 1] = { kind: 'text', text: last.text + e.delta };
        else parts.push({ kind: 'text', text: e.delta });
        return { ...turn, content: turn.content + e.delta, parts };
      };
    case 'reasoning':
      return (turn) => ({ ...turn, reasoning: (turn.reasoning ?? '') + e.delta });
    case 'notice':
      return (turn) => ({ ...turn, notices: [...(turn.notices ?? []), e.message] });
    case 'tool_call':
      return (turn) => ({
        ...turn,
        parts: [
          ...(turn.parts ?? []),
          {
            kind: 'tool',
            id: e.id,
            name: e.name,
            args: e.args,
            ...(e.agent ? { agent: e.agent } : {}),
            status: 'running',
          },
        ],
      });
    case 'tool_approval':
      return stepUpdate(e.id, (s) => ({ ...s, status: 'approval', preview: e.preview }));
    case 'tool_output':
      return stepUpdate(e.id, (s) => ({ ...s, output: (s.output ?? '') + e.chunk }));
    case 'tool_result':
      return stepUpdate(e.id, (s) => ({
        ...s,
        status: e.ok ? 'ok' : 'error',
        summary: e.summary,
      }));
    case 'cost':
      return (turn) => ({ ...turn, meta: meta(e) });
    case 'error':
      return (turn) => ({ ...turn, error: e.message });
    default:
      return null;
  }
}

type Step = Extract<NonNullable<Turn['parts']>[number], { kind: 'tool' }>;

function stepUpdate(id: string, fn: (s: Step) => Step): TurnUpdate {
  return (turn) => ({
    ...turn,
    parts: (turn.parts ?? []).map((p) => (p.kind === 'tool' && p.id === id ? fn(p) : p)),
  });
}

/** Applies the changes to the answer of request `rid`; the other turns are left as they are. */
export function applyUpdates(turns: Turn[], rid: string, fns: readonly TurnUpdate[]): Turn[] {
  return turns.map((turn) =>
    turn.role === 'assistant' && turn.rid === rid ? fns.reduce((acc, fn) => fn(acc), turn) : turn,
  );
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * What the model reads of the conversation so far: failed and compacted messages are left out,
 * so are the exchanges still running (their question has no answer yet); a summary stands for
 * the messages it replaced. At most `max` messages, never starting with an answer.
 */
export function chatHistory(
  turns: readonly Turn[],
  isRunning: (rid: string) => boolean,
  summary: (text: string) => HistoryMessage[],
  max: number,
): HistoryMessage[] {
  const history = turns
    .filter((x) => !x.error && !x.compacted && !(x.rid && isRunning(x.rid)))
    .flatMap((x) => (x.summary ? summary(x.content) : [{ role: x.role, content: x.content }]))
    .slice(-max);
  if (history[0]?.role === 'assistant') history.shift();
  return history;
}

export interface Scheduler {
  /** Asks for `run` soon; returns how to cancel it. */
  (run: () => void): () => void;
}

/**
 * One render per frame. A minimised window gets no animation frames, so a timer runs it too.
 */
export const frameScheduler: Scheduler = (run) => {
  const frame = requestAnimationFrame(run);
  const timer = setTimeout(run, 120);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
};

/**
 * Gathers the changes that arrive within one frame (a burst of tokens, tool output) and hands
 * them over together: one setState per token re-rendered the whole chat for every token.
 */
export function batcher(
  apply: (fns: TurnUpdate[]) => void,
  schedule: Scheduler = frameScheduler,
): { push: (fn: TurnUpdate) => void; flush: () => void } {
  let pending: TurnUpdate[] = [];
  let cancel: (() => void) | null = null;
  const flush = (): void => {
    cancel?.();
    cancel = null;
    const fns = pending;
    if (!fns.length) return;
    pending = [];
    apply(fns);
  };
  return {
    push: (fn) => {
      pending.push(fn);
      cancel ??= schedule(flush);
    },
    flush,
  };
}
