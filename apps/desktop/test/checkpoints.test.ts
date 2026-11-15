import { describe, expect, it } from 'vitest';
import {
  applyReview,
  changedTurns,
  diffLines,
  editedSince,
  hunks,
  revertHunks,
  rewindPlan,
  splitLines,
  turnFiles,
  type CheckpointLike,
} from '../src/shared/checkpoints';

const cp = (seq: number, turn: string, path: string, before: string | null): CheckpointLike => ({
  seq,
  turn,
  path,
  before,
  root: '/ws',
});

describe('rewindPlan', () => {
  const cps = [
    cp(1, 't1', 'a.ts', 'a0'),
    cp(2, 't2', 'a.ts', 'a1'),
    cp(3, 't2', 'b.ts', null),
    cp(4, 't3', 'a.ts', 'a2'),
    cp(5, 't3', 'c.ts', 'c0'),
  ];

  it('restores each file to its content before the chosen exchange', () => {
    const { restore, keep } = rewindPlan(cps, ['t2', 't3']);
    expect(restore.map((r) => [r.path, r.before])).toEqual([
      ['a.ts', 'a1'],
      ['b.ts', null],
      ['c.ts', 'c0'],
    ]);
    expect(keep.map((c) => c.seq)).toEqual([1]);
  });

  it('cuts by order: later changes go too even if their exchange was not listed', () => {
    const { restore, keep } = rewindPlan(cps, ['t2']);
    expect(restore.map((r) => r.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(keep).toHaveLength(1);
  });

  it('does nothing for an exchange without changes', () => {
    expect(rewindPlan(cps, ['nope']).restore).toEqual([]);
    expect(rewindPlan(cps, ['nope']).keep).toHaveLength(5);
  });

  it('keeps the same path in another folder or outside the project apart', () => {
    const { restore } = rewindPlan(
      [
        { ...cp(1, 't', 'x', 'in-ws') },
        { ...cp(2, 't', 'x', 'other'), root: '/other' },
        { seq: 3, turn: 't', path: 'x', before: 'abs', absolute: true, backup: '/b/1' },
      ],
      ['t'],
    );
    expect(restore.map((r) => r.before)).toEqual(['in-ws', 'other', 'abs']);
    expect(restore[2]!.backups).toEqual(['/b/1']);
  });

  it('lists the files of one exchange and the exchanges with changes', () => {
    expect(turnFiles(cps, 't3').map((r) => [r.path, r.before])).toEqual([
      ['a.ts', 'a2'],
      ['c.ts', 'c0'],
    ]);
    expect(changedTurns(cps)).toEqual(['t1', 't2', 't3']);
  });
});

describe('line diff', () => {
  it('splits keeping line endings exactly', () => {
    for (const s of ['', 'a', 'a\n', 'a\r\nb', '﻿x\r\n\r\ny', '\n\n'])
      expect(splitLines(s).join('')).toBe(s);
  });

  it('finds the changed lines', () => {
    const d = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(d.map((l) => `${l.kind[0]}${l.text.trim()}`)).toEqual(['sa', 'db', 'aB', 'sc', 'ad']);
  });

  it('groups changes into blocks with context', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}\n`).join('');
    const after = before.replace('l2\n', 'L2\n').replace('l15\n', 'L15\nnew\n');
    const h = hunks(before, after, 2);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ index: 0, oldStart: 3, newStart: 3, added: 1, removed: 1 });
    expect(h[1]).toMatchObject({ index: 1, oldStart: 16, newStart: 16, added: 2, removed: 1 });
    expect(h[0]!.lines.map((l) => l.text.trim())).toEqual(['l0', 'l1', 'l2', 'L2', 'l3', 'l4']);
  });

  it('accepting or rejecting blocks rebuilds the file byte for byte', () => {
    const before = 'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\neight\r\nnine';
    const after = 'one\r\nTWO\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\neight\r\nNINE\n';
    expect(hunks(before, after)).toHaveLength(2);
    expect(applyReview(before, after, new Set())).toBe(after);
    expect(applyReview(before, after, new Set([0, 1]))).toBe(before);
    expect(applyReview(before, after, new Set([0]))).toBe(
      'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\neight\r\nNINE\n',
    );
    expect(applyReview(before, after, new Set([1]))).toBe(
      'one\r\nTWO\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\neight\r\nnine',
    );
  });

  it('handles a new file and an emptied one', () => {
    expect(hunks('', 'x\ny\n')).toHaveLength(1);
    expect(applyReview('', 'x\n', new Set([0]))).toBe('');
    expect(applyReview('x\n', '', new Set([0]))).toBe('x\n');
  });

  it('falls back to one block for huge changes', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}\n`).join('');
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}\n`).join('');
    const h = hunks(a, b);
    expect(h).toHaveLength(1);
    expect(applyReview(a, b, new Set([0]))).toBe(a);
  });
});

describe('after a later change', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}\n`).join('');

  it('remembers what the last change left, per file', () => {
    const cps: CheckpointLike[] = [
      { path: 'a', before: 'v0', after: 'v1', turn: 't1', seq: 1 },
      { path: 'a', before: 'v1', after: 'v2', turn: 't1', seq: 2 },
      { path: 'b', before: null, turn: 't1', seq: 3 },
    ];
    const [a, b] = turnFiles(cps, 't1');
    expect(a).toMatchObject({ before: 'v0', after: 'v2' });
    expect(b!.after).toBeUndefined();
    expect(editedSince(a!, 'v2')).toBe(false);
    expect(editedSince(a!, 'v2 + hand')).toBe(true);
    // Not recorded (older checkpoints): never reported as edited.
    expect(editedSince(b!, 'anything')).toBe(false);
  });

  it('undoes a block in a file that kept changing elsewhere', () => {
    const before = lines(20);
    const after = before.replace('l3\n', 'L3\n').replace('l15\n', 'L15\n');
    const now = after.replace('l9\n', 'later\n');
    const r = revertHunks(now, before, after, new Set([0]));
    expect(r.failed).toEqual([]);
    expect(r.text).toBe(now.replace('L3\n', 'l3\n'));
  });

  it('refuses a block whose lines changed again, and keeps the others', () => {
    const before = lines(20);
    const after = before.replace('l3\n', 'L3\n').replace('l15\n', 'L15\n');
    const now = after.replace('L3\n', 'again\n');
    const r = revertHunks(now, before, after, new Set([0, 1]));
    expect(r.failed).toEqual([0]);
    expect(r.text).toBe(now.replace('L15\n', 'l15\n'));
  });

  it('finds blocks at the edges, and pure insertions', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\n';
    const after = `top\n${before}end\n`;
    const now = after.replace('d\n', 'D\n');
    expect(revertHunks(now, before, after, new Set([0, 1]))).toEqual({
      text: before.replace('d\n', 'D\n'),
      failed: [],
    });
  });

  it('refuses a block found more than once', () => {
    const before = lines(10);
    const after = before.replace('l4\n', 'l4\nNEW\n');
    // Someone pasted the same lines again: the block and its context are no longer unique.
    const now = after.replace('l8\n', 'l2\nl3\nl4\nNEW\nl5\nl6\nl7\nl8\n');
    expect(revertHunks(now, before, after, new Set([0])).failed).toEqual([0]);
  });

  it('is the plain review when nothing changed since', () => {
    const before = lines(10);
    const after = before.replace('l2\n', 'L2\n');
    expect(revertHunks(after, before, after, new Set([0])).text).toBe(before);
  });
});
