import { describe, expect, it } from 'vitest';
import { isLegacyModel, siblingIds } from '../src/renderer/legacyModels';

describe('isLegacyModel', () => {
  const ids = [
    'gpt-5.5',
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-5.4-mini-2026-03-17',
    'claude-haiku-4-5',
  ];
  const sib = siblingIds(ids);

  it('hides dated snapshots only when the undated alias is listed too', () => {
    expect(isLegacyModel('gpt-4o-2024-05-13', sib)).toBe(true);
    // gpt-5.4-mini itself is not in the list: the snapshot is the only way to reach it
    expect(isLegacyModel('gpt-5.4-mini-2026-03-17', sib)).toBe(false);
  });

  it('hides previous generations, keeps current ones', () => {
    expect(isLegacyModel('gpt-4o', sib)).toBe(true);
    expect(isLegacyModel('gpt-3.5-turbo', sib)).toBe(true);
    expect(isLegacyModel('models/gemini-1.5-pro', sib)).toBe(true);
    expect(isLegacyModel('gpt-5.5', sib)).toBe(false);
    expect(isLegacyModel('claude-haiku-4-5', sib)).toBe(false);
    expect(isLegacyModel('o3', sib)).toBe(false);
    expect(isLegacyModel('meta-llama/llama-3.3-70b-instruct', sib)).toBe(false);
  });
});
