import { describe, expect, it } from 'vitest';
import {
  acceptsEffort,
  claudeKnobs,
  claudeModel,
  claudeSchema,
  noSampling,
  thinkingStyle,
} from '@omni/providers';

describe('claudeModel', () => {
  it.each([
    ['claude-opus-4-7', { family: 'opus', major: 4, minor: 7 }],
    ['claude-opus-4-20250514', { family: 'opus', major: 4, minor: 0 }],
    ['claude-haiku-4-5-20251001', { family: 'haiku', major: 4, minor: 5 }],
    ['claude-fable-5-2', { family: 'fable', major: 5, minor: 2 }],
    ['anthropic.claude-sonnet-4-5-20250929-v1:0', { family: 'sonnet', major: 4, minor: 5 }],
    ['claude-3-5-haiku-latest', { family: 'haiku', major: 3, minor: 5 }],
    ['claude-3-7-sonnet-20250219', { family: 'sonnet', major: 3, minor: 7 }],
  ])('%s', (id, want) => expect(claudeModel(id)).toEqual(want));

  it('is null for other vendors', () => {
    expect(claudeModel('kimi-k2')).toBeNull();
    expect(claudeModel('MiniMax-M2')).toBeNull();
  });
});

describe('capabilities by model', () => {
  const c = (id: string) => claudeModel(id)!;
  it('sampling knobs are gone from Opus 4.7 and every Claude 5', () => {
    for (const id of [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-2',
    ])
      expect(noSampling(c(id))).toBe(true);
    for (const id of [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-3-5-haiku-latest',
    ])
      expect(noSampling(c(id))).toBe(false);
  });
  it('thinking style and effort', () => {
    expect(thinkingStyle(c('claude-sonnet-4-6'))).toBe('adaptive');
    expect(thinkingStyle(c('claude-haiku-4-5'))).toBe('budget');
    expect(thinkingStyle(c('claude-3-7-sonnet-20250219'))).toBe('budget');
    expect(thinkingStyle(c('claude-3-5-haiku-latest'))).toBe('none');
    expect(acceptsEffort(c('claude-opus-4-5'))).toBe(true);
    expect(acceptsEffort(c('claude-sonnet-4-5'))).toBe(false);
  });
});

describe('claudeKnobs', () => {
  it('explains what it drops', () => {
    const k = claudeKnobs('claude-opus-5-5', { temperature: 0.3, topP: 0.8 }, 32000);
    expect(k.temperature).toBeUndefined();
    expect(k.topP).toBeUndefined();
    expect(k.dropped).toHaveLength(2);
  });
  it('Claude 4.x: both set → keeps temperature', () => {
    const k = claudeKnobs('claude-sonnet-4-5', { temperature: 0.3, topP: 0.8 }, 32000);
    expect(k).toMatchObject({ temperature: 0.3 });
    expect(k.topP).toBeUndefined();
  });
  it('Claude 3: both allowed', () => {
    const k = claudeKnobs('claude-3-5-haiku-latest', { temperature: 0.3, topP: 0.8 }, 4096);
    expect(k).toMatchObject({ temperature: 0.3, topP: 0.8, dropped: [] });
  });
  it('thinking keeps temperature 1 and top_p ≥ 0.95', () => {
    const k = claudeKnobs('claude-sonnet-4-6', { temperature: 1, reasoning: 'low' }, 32000);
    expect(k.temperature).toBe(1);
    const p = claudeKnobs('claude-sonnet-4-6', { topP: 0.97, reasoning: 'low' }, 32000);
    expect(p.topP).toBe(0.97);
  });
  it('budget stays below max_tokens, or thinking is dropped', () => {
    expect(claudeKnobs('claude-haiku-4-5', { reasoning: 'high' }, 8192).thinking).toEqual({
      type: 'enabled',
      budget_tokens: 7168,
    });
    const tiny = claudeKnobs('claude-haiku-4-5', { reasoning: 'high' }, 1500);
    expect(tiny.thinking).toBeUndefined();
    expect(tiny.dropped[0]).toMatch(/thinking/);
  });
  it('a model without thinking says so', () => {
    const k = claudeKnobs('claude-3-5-haiku-latest', { reasoning: 'low' }, 4096);
    expect(k.thinking).toBeUndefined();
    expect(k.effort).toBeUndefined();
    expect(k.dropped).toEqual(['thinking: este modelo no razona']);
  });
});

describe('claudeSchema', () => {
  it('closes nested objects and strips rejected constraints, keeping literal data', () => {
    const { schema, changed } = claudeSchema({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 5,
          items: { type: 'object', properties: { n: { type: 'number', maximum: 9 } } },
        },
        kind: { enum: [{ properties: 1 }] },
      },
      $defs: { x: { type: 'object', properties: {}, additionalProperties: true } },
    });
    expect(schema).toEqual({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { n: { type: 'number' } },
            additionalProperties: false,
          },
        },
        kind: { enum: [{ properties: 1 }] },
      },
      $defs: { x: { type: 'object', properties: {}, additionalProperties: false } },
      additionalProperties: false,
    });
    expect(changed.sort()).toEqual(['additionalProperties', 'maxItems', 'maximum', 'minItems']);
  });
  it('an acceptable schema comes back equal with nothing changed', () => {
    const s = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    };
    expect(claudeSchema(s)).toEqual({ schema: s, changed: [] });
  });
});
