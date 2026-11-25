import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '@omni/shared';
import { firstRunModel } from '../src/renderer/firstModel';

const model = (provider: string, id: string, tools: boolean | null, context: number | null) =>
  ({
    provider,
    id,
    kind: 'chat',
    context,
    inputPrice: 0,
    outputPrice: 0,
    capabilities: { tools, vision: null, reasoning: null, fim: null },
    source: 'live',
  }) as ModelInfo;

describe('firstRunModel', () => {
  it('picks a model of the detected provider, never of another one', () => {
    const models = [model('openai', 'gpt', true, 400_000), model('ollama', 'small', null, 4096)];
    expect(firstRunModel(models, ['ollama'])).toBe('ollama/small');
  });

  it('prefers a model that can use tools, then the largest context', () => {
    const models = [
      model('ollama', 'no-tools', false, 128_000),
      model('ollama', 'a', true, 8192),
      model('ollama', 'b', true, 32_768),
    ];
    expect(firstRunModel(models, ['ollama'])).toBe('ollama/b');
  });

  it('keeps the first of the list on a tie', () => {
    const models = [model('ollama', 'x', null, null), model('ollama', 'y', null, null)];
    expect(firstRunModel(models, ['ollama'])).toBe('ollama/x');
  });

  it('gives nothing when the detected provider has no chat model', () => {
    expect(firstRunModel([model('openai', 'gpt', true, 1)], ['ollama'])).toBeNull();
    expect(firstRunModel([], ['ollama'])).toBeNull();
  });
});
