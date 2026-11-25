import { describe, expect, it } from 'vitest';
import { MAX_FOLDERS, MAX_TABS, parseSessions, putSession } from '../src/renderer/tabSession.js';

describe('open tabs per folder (estudio B4)', () => {
  it('saves and reads back the tabs, the one in front and the cursor', () => {
    const all = putSession(
      {},
      'C:/p',
      {
        tabs: [{ path: 'C:/p/a.ts', line: 12, column: 4 }, { path: 'C:/p/b.ts' }],
        active: 'C:/p/b.ts',
      },
      1000,
    );
    expect(parseSessions(JSON.stringify(all))).toEqual({
      'C:/p': {
        tabs: [{ path: 'C:/p/a.ts', line: 12, column: 4 }, { path: 'C:/p/b.ts' }],
        active: 'C:/p/b.ts',
        at: 1000,
      },
    });
  });

  it('forgets a folder whose tabs were all closed', () => {
    const one = putSession({}, 'C:/p', { tabs: [{ path: 'C:/p/a.ts' }], active: null }, 1);
    expect(putSession(one, 'C:/p', { tabs: [], active: null }, 2)).toEqual({});
  });

  it('keeps only the most recent folders and a bounded number of tabs', () => {
    let all = {};
    for (let i = 0; i < MAX_FOLDERS + 5; i++)
      all = putSession(all, `C:/p${i}`, { tabs: [{ path: `C:/p${i}/a.ts` }], active: null }, i);
    expect(Object.keys(all)).toHaveLength(MAX_FOLDERS);
    expect(all).not.toHaveProperty('C:/p0');
    expect(all).toHaveProperty(`C:/p${MAX_FOLDERS + 4}`);
    const many = Array.from({ length: MAX_TABS + 10 }, (_, i) => ({ path: `C:/p/${i}.ts` }));
    const big = putSession({}, 'C:/p', { tabs: many, active: `C:/p/${MAX_TABS + 5}.ts` }, 1);
    expect(big['C:/p']!.tabs).toHaveLength(MAX_TABS);
    // The tab in front was cut off: nothing is marked as active.
    expect(big['C:/p']!.active).toBeNull();
  });

  it('drops malformed storage instead of failing', () => {
    expect(parseSessions(null)).toEqual({});
    expect(parseSessions('not json')).toEqual({});
    expect(parseSessions('[1,2]')).toEqual({});
    const raw = JSON.stringify({
      'C:/ok': {
        tabs: [
          { path: 'C:/ok/a.ts', line: 3 },
          { path: 'C:/ok/a.ts' },
          { path: 7 },
          null,
          { path: 'C:/ok/b.ts', line: -2, column: 'x' },
        ],
        active: 'C:/ok/gone.ts',
        at: 'yesterday',
      },
      'C:/bad': { tabs: 'nope' },
      'C:/empty': { tabs: [] },
    });
    expect(parseSessions(raw)).toEqual({
      'C:/ok': {
        tabs: [{ path: 'C:/ok/a.ts', line: 3, column: 1 }, { path: 'C:/ok/b.ts' }],
        active: null,
        at: 0,
      },
    });
  });
});

describe('the side editor group in the saved tabs (estudio B1)', () => {
  const tabs = [{ path: 'C:/p/a.ts' }, { path: 'C:/p/b.ts' }];

  it('saves and reads back the side group', () => {
    const all = putSession(
      {},
      'C:/p',
      { tabs, active: 'C:/p/a.ts', split: { paths: ['C:/p/b.ts'], active: 'C:/p/b.ts' } },
      1,
    );
    expect(parseSessions(JSON.stringify(all))['C:/p']!.split).toEqual({
      paths: ['C:/p/b.ts'],
      active: 'C:/p/b.ts',
    });
  });

  it('leaves it out when the editor was not split', () => {
    const all = putSession({}, 'C:/p', { tabs, active: null, split: null }, 1);
    expect(all['C:/p']).not.toHaveProperty('split');
  });

  it('drops side files that are not tabs and repairs the one in front', () => {
    const all = putSession(
      {},
      'C:/p',
      {
        tabs,
        active: null,
        split: { paths: ['C:/p/gone.ts', 'C:/p/b.ts', 'C:/p/b.ts'], active: 'C:/p/gone.ts' },
      },
      1,
    );
    expect(all['C:/p']!.split).toEqual({ paths: ['C:/p/b.ts'], active: 'C:/p/b.ts' });
    const none = putSession(
      {},
      'C:/p',
      { tabs, active: null, split: { paths: ['C:/p/gone.ts'], active: 'C:/p/gone.ts' } },
      1,
    );
    expect(none['C:/p']).not.toHaveProperty('split');
  });

  it('ignores a malformed side group in storage', () => {
    const raw = JSON.stringify({ 'C:/p': { tabs, active: null, at: 1, split: { paths: 'x' } } });
    expect(parseSessions(raw)['C:/p']).not.toHaveProperty('split');
    const raw2 = JSON.stringify({ 'C:/p': { tabs, active: null, at: 1, split: 7 } });
    expect(parseSessions(raw2)['C:/p']).not.toHaveProperty('split');
  });
});
