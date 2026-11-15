import { describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import {
  adaptiveDebounce,
  cursorOnHunk,
  formatRecentEdits,
  hunkStillValid,
  latencyAdvice,
  lineDiff,
  parseNextEdits,
  percentile,
  pushRecentEdit,
  rebaseAfterUserEdit,
  relocateHunk,
  shiftAfterApply,
  suggestionStats,
  typedToward,
  visitOrder,
} from '../src/shared/nextEdit.js';
import type { NextEditHunk, SuggestionEvent } from '../src/shared/nextEdit.js';
import { NEXT_EDIT_SYSTEM, predictNextEdit, trimWindow } from '../src/main/nextEdit.js';

const FILE = [
  'export function total(items, rate) {', // 1
  '  return items.reduce((s, x) => s + x * rate, 0);', // 2
  '}', // 3
  '', // 4
  'const a = total(cart, rate);', // 5
  'const b = total(other, rate);', // 6
  'log(total(list, rate));', // 7
];

/** Applies a hunk to an array of lines (what the editor does on Tab). */
function applyHunk(lines: string[], h: NextEditHunk): string[] {
  return [...lines.slice(0, h.startLine - 1), ...h.replacement, ...lines.slice(h.endLine)];
}

describe('parseNextEdits', () => {
  const req = { startLine: 1, lines: FILE };

  it('reads several edits, sorted, and checks each original against the document', () => {
    const text = JSON.stringify({
      edits: [
        {
          start: 6,
          end: 6,
          original: 'const b = total(other, rate);',
          replacement: 'const b = total(other, taxRate);',
        },
        {
          line: 5,
          original: 'const a = total(cart, rate);',
          replacement: 'const a = total(cart, taxRate);',
        },
        // wrong original: the model is not looking at the real line
        { line: 7, original: 'log(total(xs, rate));', replacement: 'log(total(xs, taxRate));' },
      ],
    });
    const h = parseNextEdits(text, req);
    expect(h.map((x) => x.startLine)).toEqual([5, 6]);
    expect(h[0]!.replacement).toEqual(['const a = total(cart, taxRate);']);
  });

  it('accepts multi-line edits (start..end) and multi-line replacements', () => {
    const text = `\`\`\`json
{"edits":[{"start":1,"end":3,"original":"export function total(items, rate) {\\n  return items.reduce((s, x) => s + x * rate, 0);\\n}","replacement":"export function total(items, rate = 1) {\\n  if (!items.length) return 0;\\n  return items.reduce((s, x) => s + x * rate, 0);\\n}"}]}
\`\`\``;
    const [h] = parseNextEdits(text, req);
    expect(h).toMatchObject({ startLine: 1, endLine: 3 });
    expect(h!.replacement).toHaveLength(4);
  });

  it('still reads the single-edit answer of the first version, a bare array and "none"', () => {
    expect(
      parseNextEdits('{"line":5,"original":"const a = total(cart, rate);","replacement":"x"}', req),
    ).toHaveLength(1);
    expect(parseNextEdits('[{"line":6,"replacement":"y"}]', req)).toHaveLength(1);
    expect(parseNextEdits('none', req)).toEqual([]);
    expect(parseNextEdits('', req)).toEqual([]);
    expect(parseNextEdits('not json {', req)).toEqual([]);
  });

  it('drops no-ops, edits outside the window and overlapping blocks', () => {
    const text = JSON.stringify({
      edits: [
        { line: 2, replacement: FILE[1] }, // no change
        { line: 99, replacement: 'x' }, // outside
        { start: 5, end: 6, replacement: 'a\nb' },
        { line: 6, replacement: 'overlaps' },
      ],
    });
    const h = parseNextEdits(text, req);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ startLine: 5, endLine: 6 });
  });

  it('respects the window offset (startLine > 1)', () => {
    const h = parseNextEdits('{"edits":[{"line":11,"replacement":"z"}]}', {
      startLine: 10,
      lines: ['a', 'b'],
    });
    expect(h[0]).toMatchObject({ startLine: 11, original: ['b'] });
  });
});

describe('Tab flow (Fase 8 acceptance): a renamed parameter reaches the 3 calls in successive jumps', () => {
  it('jump → apply → next jump, with lines shifted by multi-line edits', () => {
    // The user renamed `rate` to `taxRate` in the signature and body (lines 1-2).
    let doc = [...FILE];
    doc[0] = 'export function total(items, taxRate) {';
    doc[1] = '  return items.reduce((s, x) => s + x * taxRate, 0);';
    const answer = JSON.stringify({
      edits: [
        { line: 7, original: 'log(total(list, rate));', replacement: 'log(total(list, taxRate));' },
        // a multi-line edit: adds a line (shifts what comes after it)
        {
          line: 5,
          original: 'const a = total(cart, rate);',
          replacement: '// cart\nconst a = total(cart, taxRate);',
        },
        {
          line: 6,
          original: 'const b = total(other, rate);',
          replacement: 'const b = total(other, taxRate);',
        },
      ],
    });
    let queue = visitOrder(parseNextEdits(answer, { startLine: 1, lines: doc }), 2);
    expect(queue.map((h) => h.startLine)).toEqual([5, 6, 7]);

    let cursor = 2;
    const visited: number[] = [];
    let tabs = 0;
    while (queue.length) {
      const h = queue[0]!;
      tabs++;
      if (!cursorOnHunk(h, cursor)) {
        cursor = h.startLine; // first Tab: jump
        visited.push(cursor);
        continue;
      }
      expect(hunkStillValid(h, (n) => doc[n - 1])).toBe(true);
      doc = applyHunk(doc, h); // second Tab: apply
      cursor = h.startLine + h.replacement.length - 1;
      queue = shiftAfterApply(queue.slice(1), h);
    }
    expect(visited).toEqual([5, 7, 8]); // the 2nd and 3rd calls moved down by the added line
    expect(tabs).toBe(6);
    expect(doc.filter((l) => l.includes('rate)') && !l.includes('taxRate'))).toEqual([]);
    expect(doc.join('\n')).toContain('log(total(list, taxRate));');
    expect(doc).toHaveLength(FILE.length + 1);
  });
});

describe('hunk helpers', () => {
  const h: NextEditHunk = { startLine: 5, endLine: 6, original: ['a', 'b'], replacement: ['x'] };

  it('shiftAfterApply moves later hunks, keeps earlier ones and drops overlaps', () => {
    const rest: NextEditHunk[] = [
      { startLine: 2, endLine: 2, original: ['p'], replacement: ['q'] },
      { startLine: 6, endLine: 6, original: ['b'], replacement: ['B'] },
      { startLine: 9, endLine: 9, original: ['z'], replacement: ['Z'] },
    ];
    expect(shiftAfterApply(rest, h).map((x) => x.startLine)).toEqual([2, 8]);
  });

  it('visitOrder starts at the cursor and wraps', () => {
    const list = [9, 2, 5].map((n) => ({
      startLine: n,
      endLine: n,
      original: [''],
      replacement: ['x'],
    }));
    expect(visitOrder(list, 4).map((x) => x.startLine)).toEqual([5, 9, 2]);
    expect(visitOrder(list, 1).map((x) => x.startLine)).toEqual([2, 5, 9]);
    expect(visitOrder(list, 20).map((x) => x.startLine)).toEqual([2, 5, 9]);
  });

  it('relocateHunk follows lines moved by an auto-import, and gives up when they changed', () => {
    const doc = ["import { x } from './x';", '', 'z', 'a', 'b'];
    const moved = relocateHunk({ ...h, startLine: 2, endLine: 3 }, (n) => doc[n - 1]);
    expect(moved).toMatchObject({ startLine: 4, endLine: 5 });
    expect(relocateHunk(h, (n) => ['q', 'r'][n - 1])).toBeNull();
  });
});

describe('recent edits', () => {
  it('lineDiff finds the changed block', () => {
    expect(lineDiff(['a', 'b', 'c'], ['a', 'B', 'X', 'c'])).toEqual({
      line: 2,
      before: ['b'],
      after: ['B', 'X'],
    });
    expect(lineDiff(['a'], ['a'])).toBeNull();
    expect(lineDiff(['a', 'b'], ['a'])).toEqual({ line: 2, before: ['b'], after: [] });
  });

  it('typing on one line is one edit; typing it back is none', () => {
    let list = pushRecentEdit([], { path: 'a.ts', line: 3, before: ['rate'], after: ['rateX'] });
    list = pushRecentEdit(list, { path: 'a.ts', line: 3, before: ['rateX'], after: ['rateXY'] });
    expect(list).toEqual([{ path: 'a.ts', line: 3, before: ['rate'], after: ['rateXY'] }]);
    list = pushRecentEdit(list, { path: 'a.ts', line: 3, before: ['rateXY'], after: ['rate'] });
    expect(list).toEqual([]);
  });

  it('keeps the last N and formats them as small diffs', () => {
    let list: ReturnType<typeof pushRecentEdit> = [];
    for (let i = 1; i <= 12; i++)
      list = pushRecentEdit(
        list,
        { path: 'a.ts', line: i * 10, before: [`o${i}`], after: [`n${i}`] },
        8,
      );
    expect(list).toHaveLength(8);
    const text = formatRecentEdits(list);
    expect(text).toContain('a.ts:120\n-o12\n+n12');
    expect(text).not.toContain('a.ts:40\n');
  });
});

describe('acceptance metric', () => {
  const ev = (o: Partial<SuggestionEvent>): SuggestionEvent => ({
    kind: 'nextEdit',
    model: 'groq/fast',
    outcome: 'shown',
    at: 0,
    ...o,
  });

  it('percentile by nearest rank', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([300, 100, 200], 50)).toBe(200);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it('summarises per kind and model: requests, shown, accepted, rate, p50 / p90', () => {
    const rows = suggestionStats([
      ev({ latencyMs: 200 }),
      ev({ latencyMs: 300 }),
      ev({ outcome: 'empty', latencyMs: 250 }),
      ev({ outcome: 'error' }),
      ev({ outcome: 'accepted' }),
      ev({ kind: 'inline', model: 'x/slow', latencyMs: 900 }),
    ]);
    expect(rows[0]).toMatchObject({
      kind: 'nextEdit',
      model: 'groq/fast',
      requests: 4,
      shown: 2,
      accepted: 1,
      acceptRate: 0.5,
      p50: 250,
    });
    expect(rows[1]).toMatchObject({ kind: 'inline', p50: 900 });
  });

  it('tunes the debounce from the acceptance rate and gives advice', () => {
    const base = {
      kind: 'nextEdit' as const,
      model: 'm',
      requests: 40,
      shown: 30,
      accepted: 0,
      p50: 200,
      p90: 300,
    };
    expect(adaptiveDebounce(undefined)).toBe(450);
    expect(adaptiveDebounce({ ...base, acceptRate: 0.05 })).toBe(900);
    expect(adaptiveDebounce({ ...base, acceptRate: 0.6 })).toBe(315);
    expect(adaptiveDebounce({ ...base, acceptRate: 0.6, p50: 800 })).toBe(450);
    expect(latencyAdvice({ ...base, acceptRate: 0.3, p50: 650 })).toBe('slow');
    expect(latencyAdvice({ ...base, acceptRate: 0.05 })).toBe('lowAccept');
    expect(latencyAdvice({ ...base, acceptRate: 0.3 })).toBeNull();
  });
});

describe('predictNextEdit (main)', () => {
  it('sends a trimmed window, parses several edits and reports model and latency', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`);
    let prompt = '';
    const core = {
      async complete(req: { messages: { role: string; content: string }[] }) {
        expect(req.messages[0]!.content).toBe(NEXT_EDIT_SYSTEM);
        prompt = req.messages[1]!.content;
        return {
          text: '{"edits":[{"line":200,"original":"line 200","replacement":"LINE 200"},{"line":210,"original":"line 210","replacement":"LINE 210"}]}',
          provider: 'groq',
          model: 'fast',
        };
      },
    } as unknown as OmniCore;
    const req = {
      path: 'a.ts',
      language: 'typescript',
      edits: '-a\n+b',
      startLine: 1,
      lines,
      cursor: { line: 200, column: 1 },
    };
    const view = trimWindow(req);
    expect(view.lines.length).toBe(160);
    expect(view.startLine).toBeLessThanOrEqual(200);
    const r = await predictNextEdit(core, req, new AbortController().signal);
    expect(r.model).toBe('groq/fast');
    expect(r.hunks.map((h) => h.startLine)).toEqual([200, 210]);
    expect(prompt).toContain('<recent-edits>\n-a\n+b');
    expect(prompt).not.toContain('| line 1\n');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('a failing model means no suggestion, flagged as error', async () => {
    const core = { complete: async () => Promise.reject(new Error('down')) } as unknown as OmniCore;
    const r = await predictNextEdit(
      core,
      {
        path: 'a',
        language: 'x',
        edits: '',
        startLine: 1,
        lines: ['a'],
        cursor: { line: 1, column: 1 },
      },
      new AbortController().signal,
    );
    expect(r).toMatchObject({ hunks: [], error: true });
  });
});

describe('next edit — the user keeps typing', () => {
  /** Applies a user change to a document and returns what rebaseAfterUserEdit needs. */
  function userEdit(doc: string[], next: string[]) {
    const d = lineDiff(doc, next)!;
    const lineAt = (n: number) => next[n - 1];
    return { d, lineAt };
  }

  const doc = ['function f(a) {', '  return g(a);', '}', '', 'g(1);', 'g(2);'];
  const hunks: NextEditHunk[] = [
    { startLine: 5, endLine: 5, original: ['g(1);'], replacement: ['g(1, ctx);'] },
    { startLine: 6, endLine: 6, original: ['g(2);'], replacement: ['g(2, ctx);'] },
  ];

  it('typing what the suggestion proposes keeps it on screen', () => {
    expect(typedToward(['g(1);'], ['g(1, c);'], ['g(1, ctx);'])).toBe(true);
    expect(typedToward(['g(1);'], ['g(1, x);'], ['g(1, ctx);'])).toBe(false);
    // deleting toward a shorter replacement
    expect(typedToward(['h(a, b);'], ['h(a, );'], ['h(a);'])).toBe(true);
    expect(typedToward(['h(a, b);'], ['h(a, b);'], ['h(a);'])).toBe(false);
    // indentation does not count
    expect(typedToward(['  g(1);'], ['    g(1, c);'], ['  g(1, ctx);'])).toBe(true);

    const next = [...doc];
    next[4] = 'g(1, ct);';
    const { d, lineAt } = userEdit(doc, next);
    const r = rebaseAfterUserEdit(hunks, d, lineAt);
    expect(r.typedThrough).toBe(true);
    expect(r.completed).toBe(false);
    expect(r.queue).toHaveLength(2);
    expect(r.queue[0]).toMatchObject({
      startLine: 5,
      original: ['g(1, ct);'],
      replacement: ['g(1, ctx);'],
    });
  });

  it('typing it all removes that hunk and keeps the next one', () => {
    const next = [...doc];
    next[4] = 'g(1, ctx);';
    const { d, lineAt } = userEdit(doc, next);
    const r = rebaseAfterUserEdit(hunks, d, lineAt);
    expect(r.completed).toBe(true);
    expect(r.queue).toEqual([hunks[1]]);
  });

  it('typing something else drops the hunk it touched', () => {
    const next = [...doc];
    next[4] = 'g(1, other);';
    const { d, lineAt } = userEdit(doc, next);
    const r = rebaseAfterUserEdit(hunks, d, lineAt);
    expect(r.typedThrough).toBe(false);
    expect(r.queue).toEqual([hunks[1]]);
  });

  it('a change above moves the hunks below it', () => {
    const next = ['// note', ...doc];
    const { d, lineAt } = userEdit(doc, next);
    const r = rebaseAfterUserEdit(hunks, d, lineAt);
    expect(r.typedThrough).toBe(false);
    expect(r.queue.map((h) => h.startLine)).toEqual([6, 7]);
  });

  it('pressing Enter inside a multi-line suggestion follows it', () => {
    const d0 = ['if (x) {', '}'];
    const h: NextEditHunk = {
      startLine: 1,
      endLine: 2,
      original: d0,
      replacement: ['if (x) {', '  run();', '}'],
    };
    const typed = ['if (x) {', '  ru', '}'];
    const { d, lineAt } = userEdit(d0, typed);
    const r = rebaseAfterUserEdit([h], d, lineAt);
    expect(r.typedThrough).toBe(true);
    expect(r.queue[0]).toMatchObject({ startLine: 1, endLine: 3, original: typed });
    const done = ['if (x) {', '  run();', '}'];
    const e = userEdit(typed, done);
    expect(rebaseAfterUserEdit(r.queue, e.d, e.lineAt)).toMatchObject({
      completed: true,
      queue: [],
    });
  });

  it('deleting the lines a deletion hunk proposes completes it', () => {
    const d0 = ['a', 'debug();', 'b'];
    const h: NextEditHunk = { startLine: 2, endLine: 2, original: ['debug();'], replacement: [] };
    const { d, lineAt } = userEdit(d0, ['a', 'b']);
    expect(rebaseAfterUserEdit([h], d, lineAt)).toMatchObject({ completed: true, queue: [] });
  });
});
