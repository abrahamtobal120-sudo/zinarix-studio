import { describe, expect, it } from 'vitest';
import { MAX_PINNED, recommend, type Answers } from '../src/renderer/profile';

const base: Answers = { uses: [], level: 'some', ai: 'unsure', help: 'ask', look: 'dark' };

describe('questionnaire recommend', () => {
  it('pins the main panel of each use first', () => {
    const r = recommend({ ...base, uses: ['arch3d', 'video', 'web'] });
    expect(r.pinned.slice(0, 3)).toEqual(['sketchup', 'video', 'browser']);
    expect(r.start).toBe('sketchup');
  });
  it('never pins more than the limit and no duplicates', () => {
    const r = recommend({ ...base, uses: ['web', 'graphics', 'cloud', 'arch3d', 'print3d', 'office'] });
    expect(r.pinned.length).toBe(MAX_PINNED);
    expect(new Set(r.pinned).size).toBe(r.pinned.length);
  });
  it('nothing chosen: nothing pinned', () => {
    expect(recommend(base)).toEqual({ pinned: [], start: null });
  });
});
