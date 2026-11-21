import { describe, expect, it } from 'vitest';
import {
  COMPUTER_CONTROL_KEY,
  COMPUTER_SCREEN_KEY,
  computerPreview,
  parseComputerArgs,
  parseKeys,
  runComputerTool,
  shotSize,
  toImage,
  toScreen,
  type ComputerService,
} from '../src/main/computerTools.js';
import { TOOLS, dropOldShots } from '../src/main/agent.js';
import type { ChatMessage } from '@omni/shared';

function fakeService(cursor = { x: 500, y: 500 }) {
  const log: string[] = [];
  const svc: ComputerService = {
    unavailable: async () => null,
    screenshot: async () => ({ mediaType: 'image/jpeg', data: 'AAAA', width: 1280, height: 720 }),
    cursor: async () => cursor,
    move: async (x, y) => void log.push(`move ${x},${y}`),
    click: async (x, y, b, n) => void log.push(`click ${x},${y} ${b} ${n}`),
    drag: async (a, b, c, d) => void log.push(`drag ${a},${b}>${c},${d}`),
    scroll: async (x, y, dx, dy) => void log.push(`scroll ${x},${y} ${dx},${dy}`),
    type: async (t) => void log.push(`type ${t}`),
    keys: async (c) => void log.push(`keys ${c.mods.join('+')}|${c.key}`),
    zoom: async (x, y, w, h) => (log.push(`zoom ${x},${y} ${w}x${h}`), { mediaType: 'image/png', data: 'BBBB', width: w * 2, height: h * 2 }),
    open: async (t) => void log.push(`open ${t.kind}:${t.kind === 'url' ? t.url : t.kind === 'file' ? t.path : t.name}`),
    windows: async () => [{ id: '1', app: 'notepad', title: 'Sin título: Bloc de notas' }, { id: '2', app: 'EXCEL', title: 'Ventas.xlsx - Excel' }],
    focus: async (id) => (log.push(`focus ${id}`), true),
  };
  return { svc, log };
}

describe('computer use', () => {
  it('offers the tools to the agent', () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of ['computer_screenshot', 'computer_click', 'computer_type', 'computer_key'])
      expect(names).toContain(n);
  });

  it('scales screenshots and maps coordinates back to the screen', () => {
    expect(shotSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(shotSize(1024, 768)).toEqual({ width: 1024, height: 768 });
    const img = { width: 1280, height: 720 };
    const scr = { width: 3840, height: 2160 };
    expect(toScreen(640, 360, img, scr)).toEqual({ x: 1920, y: 1080 });
    expect(toScreen(5000, -3, img, scr)).toEqual({ x: 3837, y: 0 });
    expect(toImage(1920, 1080, img, scr)).toEqual({ x: 640, y: 360 });
  });

  it('parses shortcuts', () => {
    expect(parseKeys('ctrl+shift+T')).toEqual({ mods: ['ctrl', 'shift'], key: 't' });
    expect(parseKeys('Win')).toEqual({ mods: ['meta'], key: null });
    expect(parseKeys('cmd+space')).toEqual({ mods: ['meta'], key: 'space' });
    expect(parseKeys('Enter')).toEqual({ mods: [], key: 'enter' });
    expect(parseKeys('ctrl++')).toEqual({ mods: ['ctrl'], key: '+' });
    expect(parseKeys('ArrowDown')).toEqual({ mods: [], key: 'down' });
    expect(parseKeys('ñ')).toEqual({ mods: [], key: 'ñ' });
    expect(parseKeys('ctrl+a+b')).toHaveProperty('error');
    expect(parseKeys('hyper')).toHaveProperty('error');
  });

  it('validates arguments', () => {
    expect(parseComputerArgs('computer_click', { x: 10, y: 20, double: true })).toEqual({
      kind: 'click',
      x: 10,
      y: 20,
      button: 'left',
      count: 2,
    });
    expect(parseComputerArgs('computer_click', { x: -1, y: 2 })).toHaveProperty('error');
    expect(parseComputerArgs('computer_scroll', { x: 1, y: 2, direction: 'up' })).toMatchObject({
      dy: -5,
      dx: 0,
    });
    expect(parseComputerArgs('computer_type', { text: '' })).toHaveProperty('error');
  });

  it('approves the screen and the control separately; risky shortcuts every time', () => {
    expect(computerPreview('computer_screenshot', {}).allowKey).toBe(COMPUTER_SCREEN_KEY);
    const click = computerPreview('computer_click', { x: 1, y: 2 });
    expect(click.allowKey).toBe(COMPUTER_CONTROL_KEY);
    expect(click.risk).toBe('high');
    expect(computerPreview('computer_key', { keys: 'alt+f4' }).allowKey).toBeUndefined();
    expect(computerPreview('computer_key', { keys: 'ctrl+c' }).allowKey).toBe(COMPUTER_CONTROL_KEY);
  });

  it('acts and returns a fresh screenshot', async () => {
    const { svc, log } = fakeService();
    const r = await runComputerTool(svc, 'computer_click', { x: 100, y: 50 }, undefined, 0);
    expect(r.ok).toBe(true);
    expect(r.image?.width).toBe(1280);
    expect(log).toEqual(['click 100,50 left 1']);
    const k = await runComputerTool(svc, 'computer_key', { keys: 'win+r' }, undefined, 0);
    expect(k.ok).toBe(true);
    expect(log.at(-1)).toBe('keys meta|r');
  });

  it('stops when the user parks the mouse in the top-left corner', async () => {
    const { svc, log } = fakeService({ x: 0, y: 1 });
    const r = await runComputerTool(svc, 'computer_type', { text: 'hola' }, undefined, 0);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/top-left corner/);
    expect(log).toEqual([]);
    // Looking at the screen is still allowed.
    expect((await runComputerTool(svc, 'computer_screenshot', {}, undefined, 0)).ok).toBe(true);
  });

  it('reports a platform that cannot be driven', async () => {
    const { svc } = fakeService();
    svc.unavailable = async () => 'needs xdotool';
    const r = await runComputerTool(svc, 'computer_screenshot', {}, undefined, 0);
    expect(r).toMatchObject({ ok: false, content: 'needs xdotool' });
  });

  it('keeps only the newest screenshots in the conversation', () => {
    const shot = (n: number): ChatMessage => ({
      role: 'user',
      content: [
        { type: 'text', text: `[zinarix-screenshot] #${n}` },
        { type: 'image', mediaType: 'image/jpeg', data: 'AAAA' },
      ],
    });
    const msgs: ChatMessage[] = [shot(1), { role: 'assistant', content: 'x' }, shot(2), shot(3)];
    dropOldShots(msgs);
    expect(typeof msgs[0]!.content).toBe('string');
    expect(typeof msgs[2]!.content).toBe('string');
    expect(Array.isArray(msgs[3]!.content)).toBe(true);
  });
});
