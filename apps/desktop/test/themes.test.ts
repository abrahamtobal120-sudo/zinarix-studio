import { describe, expect, it, vi } from 'vitest';

// themes.ts imports the Monaco bundle (workers, DOM); the data under test does not need it.
vi.mock('../src/renderer/monaco', () => ({ monaco: { editor: {} } }));

const { CUSTOM_THEMES, REQUIRED_VARS } = await import('../src/renderer/themes.js');

function luminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TEXT = 4.5;
const UI = 3;

describe('custom themes', () => {
  for (const [id, th] of Object.entries(CUSTOM_THEMES)) {
    const v = th.vars as Record<string, string>;

    it(`${id} sets every required variable`, () => {
      for (const k of REQUIRED_VARS) expect(v[k], k).toBeTruthy();
    });

    it(`${id} meets WCAG AA on its main pairs`, () => {
      const pairs: [string, string, number][] = [
        ['--fg', '--bg', TEXT],
        ['--fg', '--bg-2', TEXT],
        ['--fg-dim', '--bg', TEXT],
        ['--danger', '--bg', TEXT],
        ['--ok', '--bg', TEXT],
        ['--warn', '--bg', TEXT],
        ['--brand', '--bg', TEXT],
        ['--status-fg', '--status', TEXT],
        ['--accent-fg', '--accent', TEXT],
        ['--accent-fg', '--accent-hover', TEXT],
        ['--focus', '--bg', UI],
      ];
      for (const [fg, bg, min] of pairs) {
        expect(contrast(v[fg]!, v[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
      }
      // Primary buttons draw white text on the brand gradient.
      for (const k of ['--brand-1', '--brand-2']) {
        expect(contrast('#ffffff', v[k]!), `#fff on ${k}`).toBeGreaterThanOrEqual(TEXT);
      }
    });
  }
});
