import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import type { ChatMessage, ToolDefinition } from '@omni/shared';
import type { ChatEventView, ToolDecision } from '../src/shared/api.js';
import { Agent } from '../src/main/agent.js';
import { Workspace } from '../src/main/workspace.js';
import {
  COMPUTER_MODE_NOTE,
  type ComputerRunHooks,
  type ComputerService,
} from '../src/main/computerTools.js';

/** "Controlar la compu": the chat switch, with the real agent loop and a fake computer. */

type Call = { name: string; args: Record<string, unknown> };

function fakeCore(steps: Call[][]) {
  let step = 0;
  let n = 0;
  return {
    async *stream(_req: { tools?: ToolDefinition[]; messages: ChatMessage[] }) {
      for (const c of steps[step++] ?? [])
        yield { type: 'tool_call', id: `c${++n}`, name: c.name, argsDelta: JSON.stringify(c.args) };
      yield { type: 'done', stopReason: 'stop' };
    },
  } as unknown as OmniCore;
}

function fakeComputer(log: string[]): ComputerService {
  return {
    unavailable: async () => null,
    screenshot: async () => ({ mediaType: 'image/jpeg', data: 'AAAA', width: 1280, height: 720 }),
    cursor: async () => ({ x: 500, y: 500 }),
    move: async (x, y) => void log.push(`move ${x},${y}`),
    click: async (x, y) => void log.push(`click ${x},${y}`),
    drag: async () => void log.push('drag'),
    scroll: async () => void log.push('scroll'),
    type: async (t) => void log.push(`type ${t}`),
    keys: async (c) => void log.push(`keys ${[...c.mods, c.key].join('+')}`),
    zoom: async (x, y, w, h) => (
      log.push(`zoom ${x},${y} ${w}x${h}`),
      { mediaType: 'image/png', data: 'BBBB', width: w * 2, height: h * 2 }
    ),
    open: async (t) =>
      void log.push(
        `open ${t.kind}:${t.kind === 'url' ? t.url : t.kind === 'file' ? t.path : t.name}`,
      ),
    windows: async () => [
      { id: '1', app: 'notepad', title: 'Sin título: Bloc de notas' },
      { id: '2', app: 'EXCEL', title: 'Ventas.xlsx - Excel' },
    ],
    focus: async (id) => (log.push(`focus ${id}`), true),
  };
}

function hooks(log: string[]): ComputerRunHooks {
  return {
    before: async () => void log.push('before'),
    after: async () => void log.push('after'),
    status: (t) => void log.push(`status ${t}`),
    needUser: () => void log.push('needUser'),
    end: () => void log.push('end'),
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zx-computer-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup() {
  const log: string[] = [];
  const workspace = new Workspace(root);
  let core = fakeCore([]);
  const agent = new Agent(
    {
      // Each run plays the steps given to `turn`.
      stream: (req: never) => (core as unknown as { stream: (r: never) => unknown }).stream(req),
    } as unknown as OmniCore,
    () => workspace,
  );
  agent.userKitRoot = null;
  agent.computer = fakeComputer(log);
  const turn = async (calls: Call[], computer?: ComputerRunHooks) => {
    core = fakeCore([calls, []]);
    const asked: string[] = [];
    const events: ChatEventView[] = [];
    await agent.run({
      conversationId: 'conv',
      userMessage: { role: 'user', content: 'go' },
      fallbackHistory: [],
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      ask: (id): Promise<ToolDecision> => {
        asked.push(id);
        return Promise.resolve('approve');
      },
      ...(computer ? { computer } : {}),
    });
    const results = events.flatMap((e) => (e.type === 'tool_result' ? [e] : []));
    return { asked, results };
  };
  return { log, turn };
}

const click = { name: 'computer_click', args: { x: 100, y: 200 } };
const shot = { name: 'computer_screenshot', args: {} };

describe('Controlar la compu (chat switch)', () => {
  it('without the switch, seeing the screen and controlling it are approved', async () => {
    const { turn, log } = setup();
    const r = await turn([shot, click]);
    expect(r.asked).toHaveLength(2);
    expect(log).toContain('click 100,200');
  });

  it('with the switch on, acts without asking and reports each action', async () => {
    const { turn, log } = setup();
    const h: string[] = [];
    const r = await turn(
      [shot, click, { name: 'computer_type', args: { text: 'hola' } }],
      hooks(h),
    );
    expect(r.asked).toEqual([]);
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(log).toEqual(['click 100,200', 'type hola']);
    // The window gets out of the way before every action, and the bar shows what was done.
    expect(h.filter((x) => x === 'before')).toHaveLength(3);
    expect(h).toContain('status clic en 100,200');
    expect(h.indexOf('before')).toBeLessThan(h.indexOf('status pantalla capturada'));
  });

  it('still asks for delicate shortcuts', async () => {
    const { turn, log } = setup();
    const r = await turn([{ name: 'computer_key', args: { keys: 'alt+f4' } }], hooks([]));
    expect(r.asked).toHaveLength(1);
    expect(log).toEqual(['keys alt+f4']);
  });

  it('turning the switch off asks again', async () => {
    const { turn } = setup();
    expect((await turn([click], hooks([]))).asked).toEqual([]);
    expect((await turn([click])).asked).toHaveLength(1);
  });

  it('after a pause the old action is not carried out, and the bar learns where the mouse is', async () => {
    const { turn, log } = setup();
    const h: string[] = [];
    let first = true;
    const paused: ComputerRunHooks = {
      ...hooks(h),
      before: async (_s, looks) => {
        h.push(`before${looks ? ' looks' : ''}`);
        if (first && !looks) {
          first = false;
          return 'paused note';
        }
        return undefined;
      },
    };
    const r = await turn([click, shot, click], paused);
    expect(r.results[0]).toMatchObject({ ok: false });
    expect(log).toEqual(['click 100,200']);
    expect(h).toEqual([
      'before',
      'before looks',
      'status pantalla capturada',
      'before',
      'after',
      'status clic en 100,200',
    ]);
  });

  it('tells the model the switch is on and what is off limits', () => {
    expect(COMPUTER_MODE_NOTE).toMatch(/Controlar la compu/);
    expect(COMPUTER_MODE_NOTE).toMatch(/never click it/);
    expect(COMPUTER_MODE_NOTE).toMatch(/passwords/);
  });
});
