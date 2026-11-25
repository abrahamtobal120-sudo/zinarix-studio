import { describe, expect, it } from 'vitest';
import {
  FALLBACK_VIEWPORT,
  TURN_PAGE,
  hiddenTurns,
  rowRange,
  scrollToRow,
  showEarlier,
} from '../src/renderer/virtualList';

describe('rowRange (explorer tree)', () => {
  it('mounts only the rows on screen plus the overscan', () => {
    // 10 000 rows of 24 px, a 480 px viewport scrolled to row 1000.
    expect(rowRange(24_000, 480, 24, 10_000, 5)).toEqual({ start: 995, end: 1025 });
  });

  it('never leaves the list', () => {
    expect(rowRange(0, 480, 24, 10_000, 5)).toEqual({ start: 0, end: 25 });
    expect(rowRange(10_000 * 24, 480, 24, 10_000, 5)).toEqual({ start: 9975, end: 10_000 });
  });

  it('mounts a short list whole', () => {
    expect(rowRange(0, 480, 24, 7)).toEqual({ start: 0, end: 7 });
  });

  it('copes with a scrollTop left beyond a list that just shrank', () => {
    expect(rowRange(50_000, 480, 24, 30, 2)).toEqual({ start: 8, end: 30 });
  });

  it('mounts a screenful while the list is hidden (height 0)', () => {
    const r = rowRange(0, 0, 24, 10_000, 0);
    expect(r).toEqual({ start: 0, end: FALLBACK_VIEWPORT / 24 });
  });

  it('is empty for an empty list', () => {
    expect(rowRange(100, 480, 24, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('scrollToRow', () => {
  it('does not move when the row is already in view', () => {
    expect(scrollToRow(5, 0, 480, 24)).toBeNull();
    expect(scrollToRow(19, 0, 480, 24)).toBeNull();
  });

  it('scrolls down just enough to show a row below', () => {
    expect(scrollToRow(20, 0, 480, 24)).toBe(24);
  });

  it('scrolls up to a row above', () => {
    expect(scrollToRow(3, 240, 480, 24)).toBe(72);
  });
});

describe('hiddenTurns (chat)', () => {
  it('mounts a short conversation whole', () => {
    expect(hiddenTurns(0, TURN_PAGE, true)).toBe(0);
    expect(hiddenTurns(7, 12, true)).toBe(0);
  });

  it('mounts only the last page of a long conversation that was just loaded', () => {
    expect(hiddenTurns(0, 500, true)).toBe(500 - TURN_PAGE);
  });

  it('lets a live conversation grow to two pages before cutting it back', () => {
    expect(hiddenTurns(0, TURN_PAGE * 2, true)).toBe(0);
    expect(hiddenTurns(0, TURN_PAGE * 2 + 1, true)).toBe(TURN_PAGE + 1);
  });

  it('never unmounts anything while the reader is scrolled up', () => {
    expect(hiddenTurns(100, 500, false)).toBe(100);
    expect(hiddenTurns(0, 500, false)).toBe(0);
  });

  it('starts over when the conversation shrank below the hidden count', () => {
    expect(hiddenTurns(460, 100, false)).toBe(100 - TURN_PAGE);
    expect(hiddenTurns(460, 10, false)).toBe(0);
  });

  it('brings one page back per step and stops at the start', () => {
    expect(showEarlier(100)).toBe(100 - TURN_PAGE);
    expect(showEarlier(10)).toBe(0);
  });
});
