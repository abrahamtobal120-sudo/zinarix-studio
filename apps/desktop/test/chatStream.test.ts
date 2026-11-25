import { describe, expect, it } from 'vitest';
import type { ChatEventView } from '../src/shared/api';
import {
  applyUpdates,
  batcher,
  chatHistory,
  eventUpdate,
  type TurnUpdate,
} from '../src/renderer/components/chat/stream';
import type { Turn } from '../src/renderer/components/chat/types';

const meta = (): string => 'META';
const answer = (rid = 'r1'): Turn => ({ id: `a-${rid}`, role: 'assistant', content: '', rid });
const run = (events: ChatEventView[], turn: Turn = answer()): Turn =>
  events.reduce((acc, e) => eventUpdate(e, meta)?.(acc) ?? acc, turn);

describe('eventUpdate (what each model event does to the answer)', () => {
  it('joins text deltas into one part and into the content', () => {
    const out = run([
      { type: 'text', delta: 'Ho' },
      { type: 'text', delta: 'la' },
    ]);
    expect(out.content).toBe('Hola');
    expect(out.parts).toEqual([{ kind: 'text', text: 'Hola' }]);
  });

  it('starts a new text part after a tool call', () => {
    const out = run([
      { type: 'text', delta: 'Leo.' },
      { type: 'tool_call', id: 't1', name: 'read_file', args: { path: 'a.ts' } },
      { type: 'text', delta: 'Listo.' },
    ]);
    expect(out.parts?.map((p) => p.kind)).toEqual(['text', 'tool', 'text']);
    expect(out.content).toBe('Leo.Listo.');
  });

  it('follows a tool call through approval, output and result', () => {
    const out = run([
      { type: 'tool_call', id: 't1', name: 'run_command', args: { command: 'ls' }, agent: 'x/y' },
      { type: 'tool_call', id: 't2', name: 'read_file', args: {} },
      {
        type: 'tool_approval',
        id: 't1',
        name: 'run_command',
        args: {},
        preview: { kind: 'command' } as never,
      },
      { type: 'tool_output', id: 't1', chunk: 'a' },
      { type: 'tool_output', id: 't1', chunk: 'b' },
      { type: 'tool_result', id: 't1', ok: false, summary: 'falló' },
      { type: 'tool_result', id: 't2', ok: true, summary: 'ok' },
    ]);
    const [a, b] = out.parts as Extract<NonNullable<Turn['parts']>[number], { kind: 'tool' }>[];
    expect(a).toMatchObject({
      id: 't1',
      agent: 'x/y',
      status: 'error',
      output: 'ab',
      summary: 'falló',
      preview: { kind: 'command' },
    });
    expect(b).toMatchObject({ id: 't2', status: 'ok', summary: 'ok' });
    expect(b).not.toHaveProperty('agent');
  });

  it('writes the model, the reasoning, the notices, the cost line and the error', () => {
    const out = run([
      { type: 'start', provider: 'ollama', model: 'qwen' },
      { type: 'reasoning', delta: 'pien' },
      { type: 'reasoning', delta: 'so' },
      { type: 'notice', message: 'uno', kind: 'info' },
      { type: 'notice', message: 'dos', kind: 'info' },
      { type: 'cost', usd: null, inputTokens: 1, outputTokens: 2, latencyMs: 3 },
      { type: 'error', message: 'sin red', code: 'network' },
    ]);
    expect(out).toMatchObject({
      model: 'ollama/qwen',
      reasoning: 'pienso',
      notices: ['uno', 'dos'],
      meta: 'META',
      error: 'sin red',
    });
  });

  it('leaves the answer alone for events that are not about it', () => {
    expect(eventUpdate({ type: 'conversation', id: 'c' }, meta)).toBeNull();
    expect(eventUpdate({ type: 'done', stopReason: 'end' }, meta)).toBeNull();
    expect(eventUpdate({ type: 'file_changed', path: 'a.ts' }, meta)).toBeNull();
  });

  it('does not change the turn it was given', () => {
    const turn = answer();
    run([{ type: 'text', delta: 'x' }], turn);
    expect(turn).toEqual(answer());
  });
});

describe('applyUpdates', () => {
  it('writes only into the answer of that request', () => {
    const turns: Turn[] = [
      { id: 'u1', role: 'user', content: 'p', rid: 'r1' },
      answer('r1'),
      { id: 'u2', role: 'user', content: 'q', rid: 'r2' },
      answer('r2'),
    ];
    const add: TurnUpdate = (t) => ({ ...t, content: `${t.content}!` });
    const out = applyUpdates(turns, 'r2', [add, add]);
    expect(out.map((t) => t.content)).toEqual(['p', '', 'q', '!!']);
    expect(out[1]).toBe(turns[1]);
  });
});

describe('chatHistory (what the model reads)', () => {
  const summary = (text: string) => [
    { role: 'user' as const, content: `resumen: ${text}` },
    { role: 'assistant' as const, content: 'ok' },
  ];
  const none = (): boolean => false;

  it('leaves out failed, compacted and still running messages', () => {
    const turns: Turn[] = [
      { id: '1', role: 'user', content: 'viejo', compacted: true },
      { id: '2', role: 'assistant', content: 'R', summary: true },
      { id: '3', role: 'user', content: 'a' },
      { id: '4', role: 'assistant', content: 'b' },
      { id: '5', role: 'assistant', content: 'roto', error: 'x' },
      { id: '6', role: 'user', content: 'en curso', rid: 'live' },
      { id: '7', role: 'assistant', content: 'medio', rid: 'live' },
    ];
    expect(chatHistory(turns, (rid) => rid === 'live', summary, 400)).toEqual([
      { role: 'user', content: 'resumen: R' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
  });

  it('keeps the last messages and never starts with an answer', () => {
    const turns: Turn[] = [
      { id: '1', role: 'user', content: 'a' },
      { id: '2', role: 'assistant', content: 'b' },
      { id: '3', role: 'user', content: 'c' },
      { id: '4', role: 'assistant', content: 'd' },
    ];
    expect(chatHistory(turns, none, summary, 3)).toEqual([
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ]);
    expect(chatHistory([], none, summary, 3)).toEqual([]);
  });
});

describe('batcher (one render per frame)', () => {
  const manual = () => {
    let job: (() => void) | null = null;
    let cancelled = 0;
    return {
      schedule: (fn: () => void) => {
        job = fn;
        return () => {
          job = null;
          cancelled++;
        };
      },
      tick: () => job?.(),
      scheduled: () => job !== null,
      cancelled: () => cancelled,
    };
  };
  const mark =
    (s: string): TurnUpdate =>
    (t) => ({ ...t, content: t.content + s });

  it('hands over everything pushed within one frame at once, in order', () => {
    const m = manual();
    const calls: string[] = [];
    const b = batcher(
      (fns) => calls.push(fns.reduce((acc, fn) => fn(acc), answer()).content),
      m.schedule,
    );
    b.push(mark('a'));
    b.push(mark('b'));
    b.push(mark('c'));
    expect(calls).toEqual([]);
    m.tick();
    expect(calls).toEqual(['abc']);
    // The next burst asks for a frame of its own.
    expect(m.scheduled()).toBe(false);
    b.push(mark('d'));
    m.tick();
    expect(calls).toEqual(['abc', 'd']);
  });

  it('flush writes right away and cancels the waiting frame', () => {
    const m = manual();
    const calls: number[] = [];
    const b = batcher((fns) => calls.push(fns.length), m.schedule);
    b.push(mark('a'));
    b.flush();
    expect(calls).toEqual([1]);
    expect(m.scheduled()).toBe(false);
    // Nothing waiting: nothing is handed over.
    b.flush();
    expect(calls).toEqual([1]);
  });
});
