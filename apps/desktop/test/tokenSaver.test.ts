import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@omni/shared';
import {
  SAVER_CONTEXT_CHARS,
  SAVER_CONTEXT_TOKENS,
  SAVER_HISTORY_CHARS,
  SAVER_HISTORY_MESSAGES,
  SAVER_OLD_MESSAGE_CHARS,
  saverBudget,
  saverContext,
  saverHistory,
  shorten,
} from '../src/shared/tokenSaver.js';
import { pastMessages } from '../src/main/ai.js';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const bot = (content: string): ChatMessage => ({ role: 'assistant', content });

describe('token saver', () => {
  it('shorten keeps short texts and cuts long ones keeping both ends', () => {
    expect(shorten('hola', 10)).toBe('hola');
    const long = `INICIO${'x'.repeat(5000)}FINAL`;
    const out = shorten(long, 1000);
    expect(out.length).toBeLessThan(1100);
    expect(out.startsWith('INICIO')).toBe(true);
    expect(out.endsWith('FINAL')).toBe(true);
    expect(out).toContain('shortened');
  });

  it('saverHistory keeps only the newest messages, starting at a user message', () => {
    const h: ChatMessage[] = [];
    for (let i = 0; i < 40; i++) h.push(user(`q${i}`), bot(`a${i}`));
    const out = saverHistory(h);
    expect(out.length).toBeLessThanOrEqual(SAVER_HISTORY_MESSAGES);
    expect(out[0]!.role).toBe('user');
    expect(out.at(-1)).toEqual(bot('a39'));
  });

  it('saverHistory shortens old long answers but keeps the last exchange whole', () => {
    const big = 'y'.repeat(6000);
    const out = saverHistory([user('q1'), bot(big), user('q2'), bot(big)]);
    expect(out).toHaveLength(4);
    expect((out[1]!.content as string).length).toBeLessThan(SAVER_OLD_MESSAGE_CHARS + 100);
    expect(out[3]!.content).toBe(big);
  });

  it('saverHistory stays under the character budget', () => {
    const h: ChatMessage[] = [];
    for (let i = 0; i < 6; i++) h.push(user('u'.repeat(1900)), bot('b'.repeat(1900)));
    const out = saverHistory(h);
    const chars = out.reduce((n, m) => n + (m.content as string).length, 0);
    expect(chars).toBeLessThanOrEqual(SAVER_HISTORY_CHARS);
    expect(out[0]!.role).toBe('user');
  });

  it('saverHistory drops system messages', () => {
    expect(saverHistory([{ role: 'system', content: 's' }, user('q'), bot('a')])).toEqual([
      user('q'),
      bot('a'),
    ]);
  });

  it('saverContext shortens only the big attachments', () => {
    const out = saverContext([
      { source: 'a.ts', content: 'corto' },
      { source: 'b.ts', content: 'z'.repeat(SAVER_CONTEXT_CHARS * 3) },
    ]);
    expect(out[0]!.content).toBe('corto');
    expect(out[1]!.source).toBe('b.ts');
    expect(out[1]!.content.length).toBeLessThan(SAVER_CONTEXT_CHARS + 200);
  });

  it('saverBudget never goes above the model budget', () => {
    expect(saverBudget(10_000)).toBe(10_000);
    expect(saverBudget(500_000)).toBe(SAVER_CONTEXT_TOKENS);
  });

  it('pastMessages uses the saver history only when the switch is on', () => {
    const h: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) h.push(user(`q${i}`), bot(`a${i}`));
    expect(pastMessages({ history: h })).toHaveLength(60);
    expect(pastMessages({ history: h, saver: true }).length).toBeLessThanOrEqual(
      SAVER_HISTORY_MESSAGES,
    );
  });
});
