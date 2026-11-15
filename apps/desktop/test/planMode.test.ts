import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import type { ChatMessage, ToolDefinition } from '@omni/shared';
import type { ChatEventView, ToolDecision } from '../src/shared/api.js';
import type { AgentRunMode } from '../src/shared/agentModes.js';
import { Agent } from '../src/main/agent.js';
import { Workspace } from '../src/main/workspace.js';

/** Fase 3: plan mode, auto-approve, todo_write and ask_user, with the real agent loop. */

type Call = { name: string; args: Record<string, unknown> };

/** A scripted model: each stream call plays the next step (an empty step ends the run). */
function fakeCore(
  steps: Call[][],
  seen: { tools: string[][]; system: string[]; readOnly: boolean[] },
) {
  let step = 0;
  let n = 0;
  return {
    async *stream(req: { tools?: ToolDefinition[]; messages: ChatMessage[]; readOnly?: boolean }) {
      seen.tools.push((req.tools ?? []).map((t) => t.name));
      seen.system.push(String(req.messages[0]?.content ?? ''));
      seen.readOnly.push(req.readOnly === true);
      for (const c of steps[step++] ?? [])
        yield { type: 'tool_call', id: `c${++n}`, name: c.name, argsDelta: JSON.stringify(c.args) };
      yield { type: 'done', stopReason: 'stop' };
    },
  } as unknown as OmniCore;
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zx-plan-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(
  mode: AgentRunMode | undefined,
  steps: Call[][],
  extra: {
    ask?: (id: string) => Promise<ToolDecision>;
    answer?: (id: string) => Promise<string[] | null>;
  } = {},
) {
  const seen = { tools: [] as string[][], system: [] as string[], readOnly: [] as boolean[] };
  const events: ChatEventView[] = [];
  const asked: string[] = [];
  const workspace = new Workspace(root);
  const agent = new Agent(fakeCore(steps, seen), () => workspace);
  agent.userKitRoot = null;
  const done = agent.run({
    conversationId: 'conv',
    mode,
    userMessage: { role: 'user', content: 'go' },
    fallbackHistory: [],
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    ask:
      extra.ask ??
      ((id) => {
        asked.push(id);
        return Promise.resolve('approve');
      }),
    answer: extra.answer,
  });
  return { done, seen, events, asked, agent };
}
const results = (events: ChatEventView[]) =>
  events.flatMap((e) =>
    e.type === 'tool_result' ? [{ id: e.id, ok: e.ok, summary: e.summary }] : [],
  );
const file = () => readFileSync(join(root, 'src/a.ts'), 'utf8');

describe('plan mode', () => {
  it('refuses every write tool even when the model calls it, and asks nothing', async () => {
    const { done, events, asked, seen } = run('plan', [
      [
        { name: 'read_file', args: { path: 'src/a.ts' } },
        { name: 'edit_file', args: { path: 'src/a.ts', old_string: '1', new_string: '2' } },
        { name: 'write_file', args: { path: 'src/new.ts', content: 'x' } },
        { name: 'run_command', args: { command: 'echo hi > out.txt' } },
        { name: 'browser_click', args: { ref: 1 } },
      ],
      [],
    ]);
    await done;
    expect(file()).toBe('export const a = 1;\n');
    expect(existsSync(join(root, 'src/new.ts'))).toBe(false);
    expect(existsSync(join(root, 'out.txt'))).toBe(false);
    expect(asked).toEqual([]);
    const r = results(events);
    expect(r[0]).toMatchObject({ id: 'c1', ok: true });
    for (const id of ['c2', 'c3', 'c4', 'c5'])
      expect(r.find((x) => x.id === id)).toMatchObject({
        ok: false,
        summary: 'bloqueado: modo Plan',
      });
    // Not even offered, and the prompt says it is a plan.
    expect(seen.tools[0]).toContain('read_file');
    expect(seen.tools[0]).toContain('todo_write');
    expect(seen.tools[0]).not.toContain('edit_file');
    expect(seen.tools[0]).not.toContain('run_command');
    expect(seen.system[0]).toContain('PLAN MODE is on');
    expect(seen.readOnly[0]).toBe(true);
  });

  it('agent mode writes again (with approval) once the plan is approved', async () => {
    const { done, asked, seen } = run('agent', [
      [{ name: 'edit_file', args: { path: 'src/a.ts', old_string: '1', new_string: '2' } }],
      [],
    ]);
    await done;
    expect(file()).toBe('export const a = 2;\n');
    expect(asked).toEqual(['c1']);
    expect(seen.system[0]).not.toContain('PLAN MODE');
    expect(seen.readOnly[0]).toBe(false);
  });
});

describe('auto-approve mode', () => {
  it('edits project files without asking, but still asks for commands', async () => {
    const { done, asked } = run('auto', [
      [
        { name: 'edit_file', args: { path: 'src/a.ts', old_string: '1', new_string: '3' } },
        { name: 'write_file', args: { path: 'src/b.ts', content: 'b' } },
        { name: 'run_command', args: { command: 'node --version' } },
      ],
      [],
    ]);
    await done;
    expect(file()).toBe('export const a = 3;\n');
    expect(readFileSync(join(root, 'src/b.ts'), 'utf8')).toBe('b');
    expect(asked).toEqual(['c3']);
  });

  it('still asks for files that can run code or hold secrets', async () => {
    const { done, asked } = run('auto', [
      [{ name: 'write_file', args: { path: '.env', content: 'K=1' } }],
      [],
    ]);
    await done;
    expect(asked).toEqual(['c1']);
  });
});

describe('todo_write and ask_user', () => {
  it('todo_write reports progress back', async () => {
    const { done, events, agent } = run('agent', [
      [
        {
          name: 'todo_write',
          args: {
            todos: [
              { content: 'Leer', status: 'completed' },
              { content: 'Editar', status: 'in_progress' },
            ],
          },
        },
      ],
      [],
    ]);
    await done;
    expect(results(events)[0]).toMatchObject({ ok: true, summary: '1/2' });
    const tool = agent.session('conv').messages.find((m) => m.role === 'tool');
    expect(String(tool?.content)).toContain('(1/2 done)');
  });

  it('ask_user waits for the answer and passes it to the model', async () => {
    const { done, events, agent } = run(
      'plan',
      [
        [{ name: 'ask_user', args: { question: '¿Qué base?', options: ['Postgres', 'SQLite'] } }],
        [],
      ],
      { answer: () => Promise.resolve(['SQLite']) },
    );
    await done;
    const q = events.find((e) => e.type === 'tool_approval');
    expect(q).toMatchObject({
      preview: {
        question: { question: '¿Qué base?', options: ['Postgres', 'SQLite'], multiple: false },
      },
    });
    expect(results(events)[0]).toMatchObject({ ok: true, summary: 'SQLite' });
    const tool = agent.session('conv').messages.find((m) => m.role === 'tool');
    expect(String(tool?.content)).toContain('- SQLite');
  });

  it('without anyone to answer, the agent goes on alone', async () => {
    const { done, events } = run('agent', [
      [{ name: 'ask_user', args: { question: 'q', options: ['a', 'b'] } }],
      [],
    ]);
    await done;
    expect(events.some((e) => e.type === 'tool_approval')).toBe(false);
    expect(results(events)[0]).toMatchObject({ ok: true, summary: 'sin respuesta' });
  });
});
