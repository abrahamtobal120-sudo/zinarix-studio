import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import type { ChatMessage, ToolDefinition } from '@omni/shared';
import { registerSecret } from '@omni/security';
import type { ChatEventView, ToolDecision } from '../src/shared/api.js';
import { Agent, DELEGATION_TOOLS } from '../src/main/agent.js';
import {
  ToolTagFilter,
  parseToolCalls,
  protocolBlock,
  resultsMessage,
  toolsUnsupported,
  withProtocol,
} from '../src/main/textTools.js';
import { Workspace } from '../src/main/workspace.js';

/**
 * Every AI can act (text protocol for models without function calling and for CLI agents),
 * and one AI can hand work to another, always with the user's approval.
 */

describe('text tool protocol', () => {
  it('parses calls, keeps the transcript up to the last call and hides the blocks', () => {
    const text =
      'Voy a mirar.\n<tool_call>\n{"name": "list_dir", "arguments": {"path": "."}}\n</tool_call>\n' +
      '```json\n<tool_call>{"name":"read_file","args":{"path":"a.ts"}}</tool_call>\n```\nRESULTADO INVENTADO';
    const p = parseToolCalls(text, 'x');
    expect(p.calls.map((c) => [c.id, c.name, JSON.parse(c.arguments)])).toEqual([
      ['x1', 'list_dir', { path: '.' }],
      ['x2', 'read_file', { path: 'a.ts' }],
    ]);
    expect(p.kept).not.toContain('INVENTADO');
    expect(p.visible).toBe('Voy a mirar.');
    expect(p.errors).toEqual([]);
  });

  it('reports malformed blocks and accepts an unclosed last block', () => {
    const p = parseToolCalls('<tool_call>not json</tool_call><tool_call>{"name":"tree"', 'y');
    // Both are reported back to the model (the unclosed one is not valid JSON either).
    expect(p.errors).toEqual(['not json', '{"name":"tree"']);
    expect(p.calls).toHaveLength(0);
    const q = parseToolCalls('<tool_call>\n{"name":"tree","arguments":{}}', 'z');
    expect(q.calls.map((c) => c.name)).toEqual(['tree']);
  });

  it('the stream filter hides tool blocks split across chunks and what follows them', () => {
    const f = new ToolTagFilter();
    const chunks = [
      'Hola ',
      'mundo <tool',
      '_call>{"name":"x","argu',
      'ments":{}}</tool_',
      'call>',
      ' inventado',
    ];
    const out = chunks.map((c) => f.push(c)).join('') + f.flush();
    expect(out).toBe('Hola mundo ');
    const g = new ToolTagFilter();
    expect(g.push('a < b y <tool') + g.push('box>') + g.flush()).toBe('a < b y <toolbox>');
  });

  it('puts the protocol where each kind of model reads it', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    const block = protocolBlock(DELEGATION_TOOLS, false);
    expect(block).toContain('delegate_to_ai(model: string, task: string, mode?: "agent"|"chat")');
    const sys = withProtocol(msgs, block, 'system');
    expect((sys[0] as { content: string }).content).toContain('<zinarix-tools>');
    const usr = withProtocol(msgs, block, 'user');
    expect((usr[3] as { content: string }).content).toContain('<zinarix-tools>');
    expect((usr[1] as { content: string }).content).toBe('q1');
    // The original transcript is never modified.
    expect((msgs[0] as { content: string }).content).toBe('SYS');
  });

  it('recognizes providers that refuse tools', () => {
    for (const m of [
      'registry.ollama.ai/library/gemma:2b does not support tools',
      'tools is not supported for this model',
      'Unrecognized request argument supplied: tools',
      'function calling is not enabled for this model',
      'tools param requires --jinja flag',
    ])
      expect(toolsUnsupported(new Error(m)), m).toBe(true);
    for (const m of ['rate limit exceeded', 'invalid api key', 'context length exceeded'])
      expect(toolsUnsupported(new Error(m)), m).toBe(false);
    expect(resultsMessage([{ name: 'tree', ok: true, content: 'x' }], [])).toMatch(
      /<tool_result name="tree" ok="true">\nx\n<\/tool_result>/,
    );
  });
});

// ---------------------------------------------------------------------------------------

type Turn = (req: {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
}) => { text?: string; calls?: { name: string; args: Record<string, unknown> }[] } | Error;

interface Model {
  adapter?: string;
  tools?: boolean;
  turns: Turn[];
}

/** A core with several scripted models ("provider/model"). */
function fakeCore(home: string, models: Record<string, Model>, seen: Record<string, unknown[]>) {
  const step: Record<string, number> = {};
  let n = 0;
  const ref = (m?: string) => {
    const [provider, model] = (m ?? 'p1/boss').split('/') as [string, string];
    return { provider, model };
  };
  return {
    paths: { home },
    resolveModel: (m?: string) => ref(m),
    provider: (id: string) => {
      const any = Object.entries(models).find(([k]) => k.startsWith(`${id}/`))?.[1];
      if (!any) throw new Error(`unknown provider ${id}`);
      return {
        id,
        name: id.toUpperCase(),
        adapter: any.adapter ?? 'openai-compatible',
        category: 'cloud',
        supports: { tools: any.tools !== false },
        fallbackModels: [],
      };
    },
    models: { find: () => undefined, list: async () => ({ models: [] }) },
    connectedProviders: async () =>
      [...new Set(Object.keys(models).map((k) => k.split('/')[0]))].map((id) => ({ id })),
    providerConfig: async () => ({}),
    async *stream(req: { model?: string; messages: ChatMessage[]; tools?: ToolDefinition[] }) {
      const key = `${ref(req.model).provider}/${ref(req.model).model}`;
      (seen[key] ??= []).push(structuredClone(req));
      const m = models[key]!;
      const turn = m.turns[step[key] ?? 0];
      step[key] = (step[key] ?? 0) + 1;
      const r = turn ? turn(req) : { text: 'fin' };
      if (r instanceof Error) throw r;
      yield { type: 'start', provider: ref(req.model).provider, model: ref(req.model).model };
      if (r.text) yield { type: 'text', delta: r.text };
      for (const c of r.calls ?? [])
        yield { type: 'tool_call', id: `k${++n}`, name: c.name, argsDelta: JSON.stringify(c.args) };
      yield { type: 'cost', usd: 0.001, inputTokens: 10, outputTokens: 5, latencyMs: 1 };
      yield { type: 'done', stopReason: 'stop' };
    },
  } as unknown as OmniCore;
}

let root: string;
let ws: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zx-multi-'));
  ws = join(root, 'project');
  mkdirSync(ws);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function run(
  models: Record<string, Model>,
  opts: { model?: string; decide?: (name: string, id: string) => ToolDecision; agent?: Agent } = {},
) {
  const seen: Record<string, unknown[]> = {};
  const events: ChatEventView[] = [];
  const asked: { name: string; id: string }[] = [];
  const workspace = new Workspace(ws);
  const agent =
    opts.agent ?? new Agent(fakeCore(join(root, 'omni'), models, seen), () => workspace);
  const answer = await agent.run({
    conversationId: 'c',
    model: opts.model,
    userMessage: { role: 'user', content: 'go' },
    fallbackHistory: [],
    signal: new AbortController().signal,
    emit: (ev) => events.push(ev),
    ask: (id) => {
      const ev = events.find((e) => e.type === 'tool_call' && e.id === id) as
        { name: string } | undefined;
      asked.push({ name: ev?.name ?? '?', id });
      return Promise.resolve(opts.decide?.(ev?.name ?? '', id) ?? 'approve');
    },
  });
  return { agent, answer, events, asked, seen };
}

const text = (events: ChatEventView[]) =>
  events
    .filter((e): e is Extract<ChatEventView, { type: 'text' }> => e.type === 'text')
    .map((e) => e.delta)
    .join('');

describe('every AI can use tools', () => {
  it('a model without function calling acts through the text protocol', async () => {
    const r = await run(
      {
        'p2/plain': {
          tools: false,
          turns: [
            () => ({
              text: 'Miro.\n<tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call>\nInventado',
            }),
            () => ({ text: 'Listo.' }),
          ],
        },
      },
      { model: 'p2/plain' },
    );
    const reqs = r.seen['p2/plain'] as { messages: ChatMessage[]; tools?: unknown }[];
    expect(reqs[0]!.tools).toBeUndefined();
    expect((reqs[0]!.messages[0] as { content: string }).content).toContain('<zinarix-tools>');
    const last = reqs[1]!.messages.at(-1) as { role: string; content: string };
    expect(last.role).toBe('user');
    expect(last.content).toContain('<tool_result name="list_dir" ok="true">');
    expect(r.events.some((e) => e.type === 'tool_call' && e.name === 'list_dir')).toBe(true);
    expect(text(r.events)).not.toMatch(/tool_call|Inventado/);
    expect(r.answer).toContain('Listo.');
  });

  it('falls back to the text protocol when the provider refuses tools', async () => {
    const r = await run(
      {
        'p1/old': {
          turns: [
            () => new Error('registry.ollama.ai/library/old does not support tools'),
            () => ({ text: '<tool_call>{"name":"tree","arguments":{}}</tool_call>' }),
            () => ({ text: 'Hecho.' }),
          ],
        },
      },
      { model: 'p1/old' },
    );
    expect(
      r.events.some((e) => e.type === 'notice' && /herramientas por texto/.test(e.message)),
    ).toBe(true);
    expect(r.events.some((e) => e.type === 'tool_call' && e.name === 'tree')).toBe(true);
    expect(r.answer).toBe('Hecho.');
  });

  it('a CLI agent gets the browser and delegation tools in its prompt, not the file tools', async () => {
    const r = await run(
      {
        'cli/claude': {
          adapter: 'cli-agent',
          tools: false,
          turns: [
            () => ({
              text: '<tool_call>{"name":"read_file","arguments":{"path":"x"}}</tool_call>',
            }),
            () => ({ text: 'ok' }),
          ],
        },
      },
      { model: 'cli/claude' },
    );
    const reqs = r.seen['cli/claude'] as { messages: ChatMessage[]; tools?: unknown[] }[];
    // The list still goes (that is what lets the CLI edit), the protocol rides the user message.
    expect(reqs[0]!.tools?.length).toBeGreaterThan(0);
    const user = reqs[0]!.messages.at(-1) as { content: string };
    expect(user.content).toContain('browser_open(url: string)');
    expect(user.content).not.toContain('write_file(');
    const results = (reqs[1]!.messages.at(-1) as { content: string }).content;
    expect(results).toContain('not offered by Zinarix here');
  });
});

describe('one AI delegates to another, with the user’s approval', () => {
  const boss = (task: string): Model => ({
    turns: [
      () => ({ calls: [{ name: 'delegate_to_ai', args: { model: 'p1/helper', task } }] }),
      (req) => ({
        text: `Jefe: ${String((req.messages.at(-1) as { content: string }).content).includes('helper listo') ? 'recibido' : 'nada'}`,
      }),
    ],
  });

  it('runs the helper after approval; its actions are approved too and can be reverted', async () => {
    const r = await run({
      'p1/boss': boss('crea a.txt'),
      'p1/helper': {
        turns: [
          () => ({
            calls: [{ name: 'write_file', args: { path: 'a.txt', content: 'del ayudante' } }],
          }),
          () => ({ text: 'helper listo' }),
        ],
      },
    });
    expect(r.asked.map((a) => a.name)).toEqual(['delegate_to_ai', 'write_file']);
    expect(r.asked[1]!.id).toMatch(/^k\d+>k\d+$/);
    const helperCall = r.events.find((e) => e.type === 'tool_call' && e.name === 'write_file');
    expect(helperCall).toMatchObject({ agent: 'p1/helper' });
    // The helper's text streams into the delegation card, not into the boss's answer.
    expect(text(r.events)).not.toContain('helper listo');
    expect(r.events.some((e) => e.type === 'tool_output' && e.chunk.includes('helper listo'))).toBe(
      true,
    );
    // One cost event for the whole turn (the UI ends the turn on it).
    expect(r.events.filter((e) => e.type === 'cost')).toHaveLength(1);
    expect(r.answer).toContain('Jefe: recibido');
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('del ayudante');
    expect(await r.agent.revert('c')).toEqual(['a.txt']);
    expect(existsSync(join(ws, 'a.txt'))).toBe(false);
  });

  it('a denied delegation never reaches the helper', async () => {
    const r = await run(
      { 'p1/boss': boss('x'), 'p1/helper': { turns: [() => ({ text: 'no debería' })] } },
      { decide: (name) => (name === 'delegate_to_ai' ? 'deny' : 'approve') },
    );
    expect(r.seen['p1/helper']).toBeUndefined();
    expect(r.answer).toContain('Jefe: nada');
  });

  it('a helper cannot delegate again, and unknown models are refused before asking', async () => {
    const r = await run({
      'p1/boss': {
        turns: [
          () => ({ calls: [{ name: 'delegate_to_ai', args: { model: 'zz/none', task: 't' } }] }),
          () => ({ calls: [{ name: 'delegate_to_ai', args: { model: 'p1/helper', task: 't' } }] }),
          () => ({ text: 'fin' }),
        ],
      },
      'p1/helper': {
        turns: [
          () => ({ calls: [{ name: 'delegate_to_ai', args: { model: 'p1/boss', task: 'loop' } }] }),
          (req) => ({ text: String((req.messages.at(-1) as { content: string }).content) }),
        ],
      },
    });
    // Only the valid delegation was put to the user.
    expect(r.asked.map((a) => a.name)).toEqual(['delegate_to_ai']);
    const results = r.events.filter(
      (e): e is Extract<ChatEventView, { type: 'tool_result' }> => e.type === 'tool_result',
    );
    expect(results[0]).toMatchObject({ ok: false, summary: 'modelo desconocido' });
    expect(results.some((x) => x.summary === 'no permitido')).toBe(true);
  });
});

describe('review fixes', () => {
  it('one conversation never runs twice at the same time (two tabs or windows)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: Record<string, unknown[]> = {};
    const workspace = new Workspace(ws);
    const agent = new Agent(
      fakeCore(
        join(root, 'omni'),
        {
          'p1/boss': {
            turns: [() => ({ calls: [{ name: 'write_file', args: { path: 'x', content: '1' } }] })],
          },
        },
        seen,
      ),
      () => workspace,
    );
    const base = {
      conversationId: 'same',
      fallbackHistory: [],
      signal: new AbortController().signal,
      emit: () => {},
    };
    const first = agent.run({
      ...base,
      userMessage: { role: 'user', content: 'a' },
      ask: async () => (await gate, 'deny' as ToolDecision),
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      agent.run({
        ...base,
        userMessage: { role: 'user', content: 'b' },
        ask: async () => 'approve',
      }),
    ).rejects.toThrow(/ya está trabajando/);
    release();
    await first;
  });

  it('a CLI agent as helper is high risk, approved one at a time, and asked never again "always"', async () => {
    const r = await run(
      {
        'p1/boss': {
          turns: [
            () => ({
              calls: [{ name: 'delegate_to_ai', args: { model: 'cli/claude', task: 't1' } }],
            }),
            () => ({
              calls: [{ name: 'delegate_to_ai', args: { model: 'cli/claude', task: 't2' } }],
            }),
            () => ({ text: 'fin' }),
          ],
        },
        'cli/claude': {
          adapter: 'cli-agent',
          tools: false,
          turns: [() => ({ text: 'a' }), () => ({ text: 'b' })],
        },
      },
      { decide: () => 'always' },
    );
    expect(r.asked.map((a) => a.name)).toEqual(['delegate_to_ai', 'delegate_to_ai']);
    const approval = r.events.find((e) => e.type === 'tool_approval');
    expect(approval).toMatchObject({ preview: { risk: 'high', noAlways: true } });
  });

  it('what a helper writes is redacted before it reaches the screen', async () => {
    const key = 'sk-proj-ZX9secretvalue0123456789abcdefABCDEF';
    registerSecret(key);
    const r = await run({
      'p1/boss': {
        turns: [
          () => ({
            calls: [
              { name: 'delegate_to_ai', args: { model: 'p1/helper', task: 't', mode: 'chat' } },
            ],
          }),
          () => ({ text: 'ok' }),
        ],
      },
      'p1/helper': { turns: [() => ({ text: `la llave es ${key} listo` })] },
    });
    const shown = r.events
      .filter((e): e is Extract<ChatEventView, { type: 'tool_output' }> => e.type === 'tool_output')
      .map((e) => e.chunk)
      .join('');
    expect(shown).toContain('listo');
    expect(shown).not.toContain(key);
  });
});
