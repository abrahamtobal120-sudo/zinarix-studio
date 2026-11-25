import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import type { ChatMessage, ToolDefinition } from '@omni/shared';
import type { ChatEventView } from '../src/shared/api.js';
import { Agent, TOOLS, agentSystem } from '../src/main/agent.js';
import { Workspace } from '../src/main/workspace.js';
import {
  GROUP_IDS,
  TOOL_GROUPS,
  USE_TOOLS,
  USE_TOOLS_TOOL,
  groupOf,
  loadGroups,
  suggestGroups,
  toolLoaded,
} from '../src/main/toolGroups.js';

/** Estudio A2: the agent sends the core tools and loads the rest by group. */

const CORE = [
  'tree',
  'glob',
  'read_many_files',
  'test_results',
  'list_dir',
  'read_file',
  'search',
  'edit_file',
  'write_file',
  'run_command',
  'semantic_search',
  'docs_list',
  'docs_search',
  'list_memories',
  'remember',
  'forget',
];

describe('tool groups', () => {
  it('put every tool that is not core in exactly one group', () => {
    const grouped = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.name));
    expect(new Set(grouped).size).toBe(grouped.length);
    const core = TOOLS.map((t) => t.name).filter((n) => !groupOf(n));
    expect(core.sort()).toEqual(CORE.slice().sort());
    expect(grouped.every((n) => TOOLS.some((t) => t.name === n))).toBe(true);
    expect(USE_TOOLS_TOOL.description).toContain('- mail:');
    for (const id of GROUP_IDS) expect(USE_TOOLS_TOOL.description).toContain(`- ${id}:`);
  });

  it('cut what travels with a coding request to a fraction', () => {
    const size = (tools: ToolDefinition[]) => JSON.stringify(tools).length;
    const core = [...TOOLS.filter((t) => !groupOf(t.name)), USE_TOOLS_TOOL];
    const before = size(TOOLS) + agentSystem(new Set(GROUP_IDS)).length;
    const after = size(core) + agentSystem(new Set()).length;
    expect(core.length).toBeLessThanOrEqual(20);
    expect(after / before).toBeLessThan(0.25);
  });

  it('suggest groups from the message and the folder, not from ordinary coding words', () => {
    expect(suggestGroups('arregla el bug del login y corre las pruebas')).toEqual([]);
    expect(suggestGroups('fix the failing test in src/render.ts and add types')).toEqual([]);
    expect(suggestGroups('revisa mi correo y resume lo nuevo')).toEqual(['mail']);
    expect(suggestGroups('abre http://localhost:3000 y dime si carga')).toEqual(['browser']);
    expect(suggestGroups('haz un video corto con subtítulos')).toEqual(['video']);
    expect(suggestGroups('quita el fondo de logo.png')).toContain('image');
    expect(suggestGroups('levanta el contenedor de postgres')).toEqual(['docker', 'system']);
    const root = mkdtempSync(join(tmpdir(), 'zx-groups-'));
    try {
      writeFileSync(join(root, 'project.godot'), '');
      expect(suggestGroups('añade un enemigo', root)).toEqual(['game']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('load groups by id and explain how to use them once', () => {
    const loaded = new Set<string>();
    const r = loadGroups(loaded, ['mail', 'nope']);
    expect(r.ok).toBe(true);
    expect([...loaded]).toEqual(['mail']);
    expect(r.content).toContain('mail_list');
    expect(r.content).toContain('Unknown group ignored: nope');
    expect(toolLoaded('mail_list', loaded)).toBe(true);
    expect(toolLoaded('video_state', loaded)).toBe(false);
    expect(toolLoaded('read_file', loaded)).toBe(true);
    expect(loadGroups(loaded, ['mail']).content).toContain('already loaded');
    expect(loadGroups(loaded, ['nope']).ok).toBe(false);
    expect(loadGroups(loaded, 'docker').ok).toBe(true);
  });
});

type Call = { name: string; args: Record<string, unknown> };

function fakeCore(steps: Call[][], seen: { tools: string[][]; system: string[] }) {
  let step = 0;
  let n = 0;
  return {
    async *stream(req: { tools?: ToolDefinition[]; messages: ChatMessage[] }) {
      seen.tools.push((req.tools ?? []).map((t) => t.name));
      seen.system.push(String(req.messages[0]?.content ?? ''));
      for (const c of steps[step++] ?? [])
        yield { type: 'tool_call', id: `c${++n}`, name: c.name, argsDelta: JSON.stringify(c.args) };
      yield { type: 'done', stopReason: 'stop' };
    },
  } as unknown as OmniCore;
}

describe('the agent loop with tool groups', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zx-groups-'));
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
  });
  afterEach(() => {
    delete process.env.ZINARIX_AGENT_TOOLS;
    rmSync(root, { recursive: true, force: true });
  });

  function start(steps: Call[][]) {
    const seen = { tools: [] as string[][], system: [] as string[] };
    const events: ChatEventView[] = [];
    const workspace = new Workspace(root);
    const agent = new Agent(fakeCore(steps, seen), () => workspace);
    agent.userKitRoot = null;
    const say = (content: string) =>
      agent.run({
        conversationId: 'conv',
        userMessage: { role: 'user', content },
        fallbackHistory: [],
        signal: new AbortController().signal,
        emit: (e) => events.push(e),
        ask: () => Promise.resolve('approve'),
      });
    return { say, seen, events };
  }

  it('offers the core tools first and a group after use_tools loads it', async () => {
    const { say, seen, events } = start([
      [{ name: USE_TOOLS, args: { groups: ['docker'] } }],
      [],
      [],
    ]);
    await say('arregla el bug');
    expect(seen.tools[0]).toContain('read_file');
    expect(seen.tools[0]).toContain(USE_TOOLS);
    expect(seen.tools[0]).not.toContain('docker_ps');
    expect(seen.tools[0]).not.toContain('browser_open');
    expect(seen.tools[0]!.length).toBeLessThanOrEqual(22);
    expect(seen.system[0]).not.toContain('docker_ps');
    expect(seen.tools[1]).toContain('docker_ps');
    expect(seen.tools[1]).not.toContain('mail_list');
    const done = events.find((e) => e.type === 'tool_result');
    expect(done).toMatchObject({ ok: true, summary: 'herramientas: docker' });
    // The next turn keeps the group and explains it in the system prompt.
    await say('sigue');
    expect(seen.tools[2]).toContain('docker_ps');
    expect(seen.system[2]).toContain('docker_ps');
  });

  it('loads a group named in the message without spending a step', async () => {
    const { say, seen } = start([[]]);
    await say('revisa mi correo');
    expect(seen.tools[0]).toContain('mail_list');
    expect(seen.system[0]).toContain('mail_accounts');
    expect(seen.tools[0]).not.toContain('video_state');
  });

  it('runs a tool of a group that is not loaded and loads the group', async () => {
    const { say, seen, events } = start([[{ name: 'design_templates', args: {} }], []]);
    await say('hola');
    expect(seen.tools[0]).not.toContain('design_templates');
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true });
    expect(seen.tools[1]).toContain('design_templates');
  });

  it('ZINARIX_AGENT_TOOLS=all sends everything, as before', async () => {
    process.env.ZINARIX_AGENT_TOOLS = 'all';
    const { say, seen } = start([[]]);
    await say('hola');
    for (const t of TOOLS) expect(seen.tools[0]).toContain(t.name);
  });
});
