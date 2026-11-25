import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@omni/shared';
import {
  DEFAULT_CONTEXT,
  SUMMARY_TAG,
  applySummary,
  compactTranscript,
  contextBudget,
  conversationTokens,
  splitForSummary,
  summaryRequest,
} from '@omni/core';

const sys: ChatMessage = { role: 'system', content: 'SYS' };
const user = (t: string): ChatMessage => ({ role: 'user', content: t });
const call = (id: string, big = 0): ChatMessage[] => [
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id, name: 'read_file', arguments: '{"path":"a.ts"}' }],
  },
  { role: 'tool', toolCallId: id, name: 'read_file', content: 'x'.repeat(big) },
];

describe('context budget', () => {
  it('estimates tokens from text, tool calls and images', () => {
    expect(conversationTokens([])).toBe(0);
    expect(conversationTokens([user('a'.repeat(3500))])).toBeGreaterThan(1000);
    expect(conversationTokens([user('a'.repeat(3500))])).toBeLessThan(1010);
    const img: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'mira' },
        { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      ],
    };
    expect(conversationTokens([img])).toBeGreaterThan(1000);
  });

  it('leaves room for the answer and for the fixed part of the request', () => {
    expect(contextBudget(200_000)).toBe(Math.floor((200_000 - 16_000) * 0.8));
    expect(contextBudget(8_000)).toBe(Math.floor((8_000 - 1_600) * 0.8));
    expect(contextBudget(null)).toBe(contextBudget(DEFAULT_CONTEXT));
    expect(contextBudget(200_000, 10_000)).toBeLessThan(contextBudget(200_000));
    // Never zero or negative, even when the tools alone fill a tiny model.
    expect(contextBudget(4_000, 50_000)).toBe(2_000);
  });
});

describe('splitting a conversation for its summary', () => {
  it('keeps the system prompt and cuts at a user message', () => {
    const msgs = [
      sys,
      user('tarea 1'),
      ...call('a', 40_000),
      { role: 'assistant', content: 'hecho 1' } as ChatMessage,
      user('tarea 2'),
      ...call('b', 100),
      { role: 'assistant', content: 'hecho 2' } as ChatMessage,
    ];
    const s = splitForSummary(msgs, 10_000)!;
    expect(s.head).toEqual([sys]);
    expect(s.recent[0]).toEqual(user('tarea 2'));
    expect(s.old[0]).toEqual(user('tarea 1'));
    expect(s.old).toHaveLength(4);
    // No tool result is separated from the call that asked for it.
    expect(s.recent.filter((m) => m.role === 'tool')).toHaveLength(1);
  });

  it('has nothing to cut in a single turn', () => {
    expect(splitForSummary([sys, user('x'), ...call('a', 90_000)], 1_000)).toBeNull();
    expect(splitForSummary([sys], 1_000)).toBeNull();
  });

  it('still cuts when the last turn alone is over its share', () => {
    const msgs = [sys, user('vieja'), ...call('a', 500), user('nueva'), ...call('b', 90_000)];
    const s = splitForSummary(msgs, 1_000)!;
    expect(s.recent[0]).toEqual(user('nueva'));
  });

  it('keeps as many recent turns as fit', () => {
    const msgs = [sys, user('1'), ...call('a', 50_000), user('2'), ...call('b', 50), user('3')];
    const s = splitForSummary(msgs, 10_000)!;
    expect(s.recent[0]).toEqual(user('2'));
  });
});

describe('the summary', () => {
  it('hands the old part to the summarizer as plain, clipped text', () => {
    const t = compactTranscript([user('arregla el bug'), ...call('a', 50_000)]);
    expect(t).toContain('USER:\narregla el bug');
    expect(t).toContain('→ read_file({"path":"a.ts"})');
    expect(t).toContain('characters omitted');
    expect(t.length).toBeLessThan(3_000);
    const req = summaryRequest([user('hola')]);
    expect(req.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('replaces the old part and never leaves two user messages in a row', () => {
    const s = splitForSummary(
      [sys, user('1'), ...call('a', 50_000), user('2'), ...call('b', 50)],
      10_000,
    )!;
    const out = applySummary(s, '  RESUMEN  ');
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    const first = out[1] as { content: string };
    expect(first.content).toContain(`<${SUMMARY_TAG}>`);
    expect(first.content).toContain('RESUMEN');
    expect(first.content.endsWith('\n\n2')).toBe(true);
    expect(conversationTokens(out)).toBeLessThan(500);
  });

  it('keeps a recent message with images intact', () => {
    const img: ChatMessage = {
      role: 'user',
      content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }],
    };
    const out = applySummary({ head: [sys], old: [user('1')], recent: [img] }, 'R');
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(out[3]).toBe(img);
  });
});
