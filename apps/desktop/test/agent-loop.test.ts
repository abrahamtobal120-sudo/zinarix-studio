import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import type { ChatMessage } from '@omni/shared';
import type { ChatEventView } from '../src/shared/api.js';
import { Agent, validArgs } from '../src/main/agent.js';
import { Workspace } from '../src/main/workspace.js';

/**
 * A6: the loop does not take a broken step for a finished one. A cut-off answer is continued,
 * broken JSON arguments go back to the model, and the step limit is said out loud.
 */

interface Step {
  text?: string;
  /** Tool calls with their arguments as the raw string the model sent. */
  calls?: { name: string; raw: string }[];
  stop?: string;
}

function fakeCore(home: string, steps: (Step | undefined)[], seen: ChatMessage[][]) {
  let i = 0;
  let n = 0;
  return {
    paths: { home },
    resolveModel: () => ({ provider: 'p', model: 'm' }),
    provider: (id: string) => ({
      id,
      name: 'P',
      adapter: 'openai-compatible',
      category: 'cloud',
      supports: { tools: true },
      fallbackModels: [],
    }),
    models: { find: () => undefined, list: async () => ({ models: [] }) },
    connectedProviders: async () => [{ id: 'p' }],
    providerConfig: async () => ({}),
    async *stream(req: { messages: ChatMessage[]; tools?: unknown[] }) {
      // A3: the request for a summary of the old part of the conversation.
      if (JSON.stringify(req.messages[0]).includes('compacting')) {
        summaries.push(structuredClone(req.messages));
        if (summaryFails.on) throw new Error('boom');
        yield {
          type: 'text',
          delta: 'RESUMEN: el usuario pidió revisar a.txt y ya se revisó entero.',
        };
        yield { type: 'cost', usd: 0, inputTokens: 1, outputTokens: 1, latencyMs: 1 };
        yield { type: 'done', stopReason: 'end_turn' };
        return;
      }
      seen.push(structuredClone(req.messages));
      // Past the script, the model keeps calling a tool forever (for the step limit); the
      // path alternates so it is not the same call in a row, which ends the run earlier.
      const s = steps[i++] ?? {
        calls: [{ name: 'list_dir', raw: i % 2 ? '{"path":"."}' : '{"path":"./"}' }],
      };
      yield { type: 'start', provider: 'p', model: 'm' };
      if (s.text) yield { type: 'text', delta: s.text };
      for (const c of s.calls ?? [])
        yield { type: 'tool_call', id: `k${++n}`, name: c.name, argsDelta: c.raw };
      yield { type: 'cost', usd: 0, inputTokens: 1, outputTokens: 1, latencyMs: 1 };
      yield { type: 'done', stopReason: s.stop ?? (s.calls ? 'tool_use' : 'end_turn') };
    },
  } as unknown as OmniCore;
}

const summaries: ChatMessage[][] = [];
const summaryFails = { on: false };

let root: string;
let ws: string;
beforeEach(() => {
  // Most tests here edit a.txt directly; the read-before-change rule has its own tests below.
  process.env.ZINARIX_AGENT_EDIT_UNREAD = 'allow';
  summaries.length = 0;
  summaryFails.on = false;
  root = mkdtempSync(join(tmpdir(), 'zx-loop-'));
  ws = join(root, 'project');
  mkdirSync(ws);
  writeFileSync(join(ws, 'a.txt'), 'hola\n');
});
afterEach(() => {
  delete process.env.ZINARIX_AGENT_EDIT_UNREAD;
  rmSync(root, { recursive: true, force: true });
});

async function run(
  steps: (Step | undefined)[],
  prompts: string[] = ['go'],
  diagnostics?: (path: string, text: string) => Promise<string | null>,
) {
  const seen: ChatMessage[][] = [];
  const events: ChatEventView[] = [];
  const workspace = new Workspace(ws);
  const agent = new Agent(fakeCore(join(root, 'omni'), steps, seen), () => workspace);
  for (const p of prompts.slice(0, -1))
    await agent.run({
      conversationId: 'c',
      userMessage: { role: 'user', content: p },
      fallbackHistory: [],
      signal: new AbortController().signal,
      emit: () => undefined,
      ask: () => Promise.resolve('approve'),
    });
  const answer = await agent.run({
    conversationId: 'c',
    userMessage: { role: 'user', content: prompts[prompts.length - 1]! },
    ...(diagnostics ? { scope: { workspace: () => workspace, diagnostics } } : {}),
    fallbackHistory: [],
    signal: new AbortController().signal,
    emit: (ev) => events.push(ev),
    ask: () => Promise.resolve('approve'),
  });
  const notices = events
    .filter((e): e is Extract<ChatEventView, { type: 'notice' }> => e.type === 'notice')
    .map((e) => e.kind);
  return { answer, events, seen, notices };
}

const last = (msgs: ChatMessage[]) => JSON.stringify(msgs[msgs.length - 1]);

describe('agent loop errors (A6)', () => {
  it('tells valid JSON objects from broken arguments', () => {
    expect(validArgs('')).toBe(true);
    expect(validArgs('{"path":"a"}')).toBe(true);
    expect(validArgs('{"path":"a')).toBe(false);
    expect(validArgs('[1]')).toBe(false);
    expect(validArgs('"x"')).toBe(false);
  });

  it('continues an answer that was cut off by the output limit', async () => {
    const r = await run([{ text: 'Primera parte', stop: 'max_tokens' }, { text: ' y el final.' }]);
    expect(r.seen).toHaveLength(2);
    expect(last(r.seen[1]!)).toContain('cut off by the output limit');
    expect(r.notices).toContain('continue');
    expect(r.answer).toBe('Primera parte y el final.');
  });

  it('stops continuing after three cut-off answers in a row', async () => {
    const cut = { text: 'x', stop: 'max_tokens' };
    const r = await run([cut, cut, cut, cut, { text: 'no se llega aquí' }]);
    expect(r.seen).toHaveLength(4);
    expect(r.answer).toBe('xxxx');
  });

  it('reports broken JSON arguments to the model instead of running the tool with {}', async () => {
    const r = await run([
      { calls: [{ name: 'write_file', raw: '{"path":"b.txt","content":"mitad' }] },
      { text: 'Listo.' },
    ]);
    expect(last(r.seen[1]!)).toContain('not valid JSON');
    const result = r.events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ ok: false });
    expect(r.answer).toBe('Listo.');
  });

  it('says so when it stops at the step limit', async () => {
    const r = await run([]);
    expect(r.seen).toHaveLength(60);
    expect(r.answer).toContain('límite de 60 pasos');
  });

  it('adds no step-limit note to a normal ending', async () => {
    const r = await run([{ text: 'Hecho.' }]);
    expect(r.answer).not.toContain('límite');
    expect(r.answer).toBe('Hecho.');
  });

  it('summarizes the old part of a conversation that nears the context limit (A3)', async () => {
    // 32 000 tokens of context are assumed for an unknown model: 100 000 characters do not fit.
    const big = `revisa esto: ${'dato '.repeat(20_000)}`;
    const r = await run([{ text: 'Revisado.' }, { text: 'Sigo.' }], [big, 'sigue']);
    expect(summaries).toHaveLength(1);
    expect(JSON.stringify(summaries[0])).toContain('revisa esto');
    const sent = r.seen[1]!;
    const body = JSON.stringify(sent);
    expect(body).toContain('conversation-summary');
    expect(body).toContain('RESUMEN: el usuario pidió revisar a.txt');
    expect(body).not.toContain('dato dato');
    expect(body).toContain('sigue');
    expect(sent[0]!.role).toBe('system');
    expect(r.notices.filter((k) => k === 'compact')).toHaveLength(2);
    expect(r.answer).toBe('Sigo.');
  });

  it('leaves the conversation alone when the summary fails', async () => {
    summaryFails.on = true;
    const big = `revisa esto: ${'dato '.repeat(20_000)}`;
    const r = await run([{ text: 'Revisado.' }, { text: 'Sigo.' }], [big, 'sigue']);
    expect(JSON.stringify(r.seen[1])).toContain('dato dato');
    expect(r.answer).toBe('Sigo.');
  });

  it('does not summarize a short conversation', async () => {
    await run([{ text: 'a' }, { text: 'b' }], ['uno', 'dos']);
    expect(summaries).toHaveLength(0);
  });

  it('tells the model what the language server says after an edit (A4)', async () => {
    const asked: string[] = [];
    const r = await run(
      [
        {
          calls: [
            { name: 'edit_file', raw: '{"path":"a.txt","old_string":"hola","new_string":"adios"}' },
          ],
        },
        { text: 'Listo.' },
      ],
      ['go'],
      (path, text) => {
        asked.push(`${path}|${text.trim()}`);
        return Promise.resolve('a.txt:1:1: error: nombre sin definir');
      },
    );
    expect(asked).toEqual(['a.txt|adios']);
    const result = last(r.seen[1]!);
    expect(result).toContain('Edited a.txt');
    expect(result).toContain('a.txt:1:1: error: nombre sin definir');
  });

  it('an edit still works when the diagnostics fail or are not known', async () => {
    const edit = {
      calls: [{ name: 'edit_file', raw: '{"path":"a.txt","old_string":"hola","new_string":"x"}' }],
    };
    const boom = await run([edit, { text: 'ok' }], ['go'], () => Promise.reject(new Error('boom')));
    expect(last(boom.seen[1]!)).toContain('Edited a.txt.');
    expect(last(boom.seen[1]!)).not.toContain('language server');
  });

  it('applies several edits to one file in a single call, all or nothing (A5)', async () => {
    writeFileSync(join(ws, 'b.txt'), ['uno', 'dos', 'tres', ''].join('\n'));
    const edits = (list: object[]) => ({
      calls: [{ name: 'edit_file', raw: JSON.stringify({ path: 'b.txt', edits: list }) }],
    });
    const r = await run([
      edits([
        { old_string: 'uno', new_string: '1' },
        { old_string: 'tres', new_string: '3' },
      ]),
      edits([
        { old_string: 'dos', new_string: '2' },
        { old_string: 'no existe', new_string: 'x' },
      ]),
      { text: 'Listo.' },
    ]);
    expect(last(r.seen[1]!)).toContain('Edited b.txt');
    expect(last(r.seen[2]!)).toContain('edits[1] did not apply, so nothing was changed');
    expect(readFileSync(join(ws, 'b.txt'), 'utf8')).toBe(['1', 'dos', '3', ''].join('\n'));
  });
});

describe('agent guards shared with the terminal agent (A7)', () => {
  const editA = {
    calls: [
      { name: 'edit_file', raw: '{"path":"a.txt","old_string":"hola","new_string":"adios"}' },
    ],
  };
  const readA = { calls: [{ name: 'read_file', raw: '{"path":"a.txt"}' }] };

  it('does not change a file the model has not read, and says how to go on', async () => {
    delete process.env.ZINARIX_AGENT_EDIT_UNREAD;
    const r = await run([editA, readA, editA, { text: 'Listo.' }]);
    expect(last(r.seen[1]!)).toContain('You have not read a.txt');
    expect(last(r.seen[3]!)).toContain('Edited a.txt');
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('adios\n');
    // The refusal comes before the approval card: nothing was asked for the blind edit.
    const approvals = r.events.filter((e) => e.type === 'tool_approval');
    expect(approvals.length).toBeLessThanOrEqual(1);
  });

  it('does not overwrite an unread file, but creates new ones and rewrites its own', async () => {
    delete process.env.ZINARIX_AGENT_EDIT_UNREAD;
    const write = (path: string, content: string) => ({
      calls: [{ name: 'write_file', raw: JSON.stringify({ path, content }) }],
    });
    const r = await run([
      write('a.txt', 'pisado'),
      write('nuevo.txt', 'uno'),
      write('nuevo.txt', 'dos'),
      { text: 'Listo.' },
    ]);
    expect(last(r.seen[1]!)).toContain('You have not read a.txt');
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('hola\n');
    expect(readFileSync(join(ws, 'nuevo.txt'), 'utf8')).toBe('dos');
  });

  it('a file read in an earlier turn of the conversation can be edited later', async () => {
    delete process.env.ZINARIX_AGENT_EDIT_UNREAD;
    const r = await run([readA, { text: 'Leído.' }, editA, { text: 'Listo.' }], ['lee', 'cambia']);
    expect(last(r.seen[3]!)).toContain('Edited a.txt');
  });

  it('warns at the third identical call and stops at the sixth', async () => {
    const same = { calls: [{ name: 'read_file', raw: '{"path":"a.txt"}' }] };
    const r = await run(Array.from({ length: 20 }, () => same));
    expect(r.seen).toHaveLength(6);
    expect(last(r.seen[2]!)).not.toContain('times in a row');
    expect(last(r.seen[3]!)).toContain('this exact call 3 times in a row');
    expect(r.answer).toContain('repitió la misma llamada (read_file) 6 veces');
    expect(r.answer).not.toContain('límite de 60 pasos');
  });

  it('tells the model which commands the project has', async () => {
    writeFileSync(join(ws, 'package.json'), '{"scripts":{"test":"vitest run"}}');
    const r = await run([{ text: 'ok' }]);
    const system = r.seen[0]![0]!;
    expect(system.role).toBe('system');
    expect(String(system.content)).toContain('<project-commands>\nnpm run test: vitest run');
  });
});
