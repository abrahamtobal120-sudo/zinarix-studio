import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import type { ChatMessage, ToolDefinition } from '@omni/shared';
import type { ChatEventView, ToolDecision } from '../src/shared/api.js';
import {
  allowedTools,
  expandCommand,
  hookInput,
  hookMatches,
  hookOutcome,
  hooksFingerprint,
  hooksFor,
  kitPrompt,
  parseAgentDef,
  parseCommand,
  parseHookSettings,
  parseSkill,
  kitTemplate,
  skillPrompt,
  splitArgs,
  subagentModel,
} from '../src/shared/agentKit.js';
import { Agent } from '../src/main/agent.js';
import { HookTrust, createKitFile, loadKit } from '../src/main/hooks.js';
import { Workspace } from '../src/main/workspace.js';

describe('subagent, skill and command files', () => {
  it('reads a subagent with model and tools', () => {
    const a = parseAgentDef(
      '.zinarix/agents/Code Reviewer.md',
      '---\ndescription: Reviews diffs\nmodel: openai/gpt-5\ntools: [read, Bash]\n---\nYou review code.\n',
    );
    expect(a).toEqual({
      name: 'code-reviewer',
      description: 'Reviews diffs',
      model: 'openai/gpt-5',
      tools: ['read', 'Bash'],
      prompt: 'You review code.',
      path: '.zinarix/agents/Code Reviewer.md',
    });
  });

  it('"model: inherit" and no tools = the parent model and every tool', () => {
    const a = parseAgentDef('x/helper.md', '---\nname: helper\nmodel: inherit\n---\n# Helps\nbody');
    expect(a?.model).toBeUndefined();
    expect(a?.tools).toBeUndefined();
    expect(a?.description).toBe('Helps');
  });

  it('accepts Claude Code style "tools: Read, Grep, Glob"', () => {
    expect(parseAgentDef('a/r.md', '---\ntools: Read, Grep, Glob\n---\nx')?.tools).toEqual([
      'Read',
      'Grep',
      'Glob',
    ]);
  });

  it('reads a skill and a command', () => {
    expect(
      parseSkill('.zinarix/skills/pdf', '---\nname: pdf\ndescription: Fill PDF forms\n---\nSteps'),
    ).toEqual({
      name: 'pdf',
      description: 'Fill PDF forms',
      dir: '.zinarix/skills/pdf',
      body: 'Steps',
    });
    expect(
      parseCommand(
        '.zinarix/commands/fix-issue.md',
        '---\ndescription: Fix a GitHub issue\nargument-hint: <number>\nagent: true\n---\nFix issue #$1: $ARGUMENTS',
      ),
    ).toMatchObject({ name: 'fix-issue', argumentHint: '<number>', agent: true });
    expect(parseCommand('c/empty.md', '---\ndescription: x\n---\n')).toBeNull();
  });

  it('expands $ARGUMENTS and $1…$9; appends the arguments when the command uses neither', () => {
    expect(expandCommand('Fix #$1 ($ARGUMENTS)', '42 "high prio"')).toBe(
      'Fix #42 (42 "high prio")',
    );
    expect(expandCommand('Review $2', 'a "b c"')).toBe('Review b c');
    expect(expandCommand('Write tests', 'for utils.ts')).toBe('Write tests\n\nfor utils.ts');
    expect(expandCommand('Write tests', '')).toBe('Write tests');
    expect(splitArgs(`one "two three" 'four'`)).toEqual(['one', 'two three', 'four']);
  });
});

describe('subagent tools', () => {
  const all = [
    'tree',
    'glob',
    'list_dir',
    'read_file',
    'read_many_files',
    'search',
    'edit_file',
    'write_file',
    'run_command',
    'browser_open',
    'browser_read',
    'mcp__db__query',
    'task',
    'use_skill',
  ];

  it('"read" only gives read tools', () => {
    const s = allowedTools(['read'], all);
    expect([...s].sort()).toEqual([
      'glob',
      'list_dir',
      'read_file',
      'read_many_files',
      'search',
      'tree',
    ]);
    expect(s.has('write_file')).toBe(false);
    expect(s.has('run_command')).toBe(false);
  });

  it('maps Claude Code names, prefixes and exact names', () => {
    const s = allowedTools(['Edit', 'Bash', 'browser', 'mcp'], all);
    expect(s.has('edit_file') && s.has('write_file') && s.has('run_command')).toBe(true);
    expect(s.has('browser_open') && s.has('mcp__db__query')).toBe(true);
    expect(allowedTools(['read_file'], all)).toEqual(new Set(['read_file']));
  });

  it('never lets a subagent launch subagents', () => {
    expect(allowedTools(undefined, all).has('task')).toBe(false);
    expect(allowedTools(['*', 'task'], all).has('task')).toBe(false);
    expect(allowedTools(undefined, all).has('use_skill')).toBe(true);
  });
});

describe('hooks', () => {
  const settings = JSON.stringify({
    hooks: {
      PostToolUse: [
        { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] },
      ],
      PreToolUse: [
        { matcher: 'run_command', hooks: [{ command: 'check.sh', timeout: 5 }] },
        { matcher: '*', command: 'log.sh' },
      ],
      Stop: [{ hooks: [{ command: 'tests.sh' }] }],
      Nope: [{ hooks: [{ command: 'x' }] }],
    },
  });

  it('parses the Claude Code format (and the short form), ignores unknown events', () => {
    const h = parseHookSettings(settings, '.zinarix/settings.json');
    expect(h.map((x) => `${x.event}:${x.matcher}:${x.command}:${x.timeout}`)).toEqual([
      'PreToolUse:run_command:check.sh:5',
      'PreToolUse:*:log.sh:60',
      'PostToolUse:Edit|Write:prettier --write:60',
      'Stop::tests.sh:60',
    ]);
    expect(parseHookSettings('not json', 'x')).toEqual([]);
    expect(
      parseHookSettings('{"hooks":{"Stop":[{"hooks":[{"type":"prompt","command":"x"}]}]}}', 'x'),
    ).toEqual([]);
  });

  it('matches Zinarix and Claude Code tool names', () => {
    expect(hookMatches('Edit|Write', 'edit_file')).toBe(true);
    expect(hookMatches('Edit|Write', 'write_file')).toBe(true);
    expect(hookMatches('Edit|Write', 'run_command')).toBe(false);
    expect(hookMatches('Bash', 'run_command')).toBe(true);
    expect(hookMatches('mcp__.*', 'mcp__db__query')).toBe(true);
    expect(hookMatches('', 'anything')).toBe(true);
    expect(hookMatches('([', '([')).toBe(true); // bad regex: exact name
    const h = parseHookSettings(settings, 's');
    expect(hooksFor(h, 'PreToolUse', 'run_command').map((x) => x.command)).toEqual([
      'check.sh',
      'log.sh',
    ]);
    expect(hooksFor(h, 'PreToolUse', 'read_file').map((x) => x.command)).toEqual(['log.sh']);
  });

  it('exit 2 blocks with stderr; other errors only warn; JSON decision block works', () => {
    expect(hookOutcome({ code: 2, stdout: '', stderr: 'no rm here\n' })).toEqual({
      block: true,
      message: 'no rm here',
    });
    expect(hookOutcome({ code: 1, stdout: '', stderr: 'boom' })).toEqual({
      block: false,
      message: '',
      warning: 'boom',
    });
    expect(hookOutcome({ code: 0, stdout: 'extra context', stderr: '' })).toEqual({
      block: false,
      message: 'extra context',
    });
    expect(
      hookOutcome({ code: 0, stdout: '{"decision":"block","reason":"lint"}', stderr: '' }).block,
    ).toBe(true);
    expect(hookOutcome({ code: null, stdout: '', stderr: '', timedOut: true }).block).toBe(false);
  });

  it('the trust key changes when a command changes', () => {
    const a = parseHookSettings(settings, 's');
    const b = parseHookSettings(settings.replace('tests.sh', 'evil.sh'), 's');
    expect(hooksFingerprint(a)).toBe(hooksFingerprint(parseHookSettings(settings, 'other')));
    expect(hooksFingerprint(a)).not.toBe(hooksFingerprint(b));
  });

  it('hook input carries the absolute file_path for tools with a path', () => {
    const i = hookInput('PostToolUse', {
      sessionId: 'c1',
      cwd: '/p',
      tool: 'write_file',
      input: { path: 'a.ts', content: 'x' },
      absPath: '/p/a.ts',
      response: { ok: true, content: 'done' },
    });
    expect(i).toMatchObject({
      hook_event_name: 'PostToolUse',
      tool_name: 'write_file',
      tool_input: { path: 'a.ts', file_path: '/p/a.ts' },
      tool_response: { success: true },
    });
  });

  it('kitPrompt lists subagents only where they can be launched', () => {
    const kit = {
      agents: [{ name: 'rev', description: 'Reviews', prompt: '', path: '' }],
      skills: [{ name: 'pdf', description: 'PDFs', dir: '', body: '' }],
      commands: [],
      hooks: [],
    };
    expect(kitPrompt(kit, true)).toContain('- rev: Reviews');
    expect(kitPrompt(kit, false)).not.toContain('rev');
    expect(kitPrompt(kit, false)).toContain('- pdf: PDFs');
  });
});

/* ------------------------------------------------------------------- with the agent loop */

type Call = { name: string; args: Record<string, unknown> };

function fakeCore(turns: Call[][], offered: string[][]): OmniCore {
  let step = 0;
  let n = 0;
  return {
    paths: { home: tmpdir() },
    async *stream(req: { messages: ChatMessage[]; tools?: ToolDefinition[] }) {
      offered.push((req.tools ?? []).map((t) => t.name));
      for (const c of turns[step++] ?? [])
        yield { type: 'tool_call', id: `c${++n}`, name: c.name, argsDelta: JSON.stringify(c.args) };
      yield { type: 'done', stopReason: 'stop' };
    },
  } as unknown as OmniCore;
}

let root: string;
let ws: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zx-kit-'));
  ws = join(root, 'project');
  mkdirSync(join(ws, '.zinarix', 'agents'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A hook command that runs a Node script (same on PowerShell and sh). */
function nodeHook(script: string, body: string): string {
  const file = join(root, script);
  writeFileSync(file, body);
  const q = (s: string) => `"${s}"`;
  const cmd = `${q(process.execPath)} ${q(file)}`;
  return process.platform === 'win32' ? `& ${cmd}` : cmd;
}

async function run(
  turns: Call[][],
  decide: (name: string) => ToolDecision = () => 'approve',
  trust?: HookTrust,
) {
  const offered: string[][] = [];
  const asked: string[] = [];
  const events: ChatEventView[] = [];
  const workspace = new Workspace(ws);
  const agent = new Agent(fakeCore(turns, offered), () => workspace);
  agent.userKitRoot = null;
  if (trust) agent.hookTrust = trust;
  const answer = await agent.run({
    conversationId: 'c',
    userMessage: { role: 'user', content: 'go' },
    fallbackHistory: [],
    signal: new AbortController().signal,
    emit: (ev) => events.push(ev),
    ask: (id) => {
      const leaf = id.split('>').pop()!;
      const ev = events.find((e) => e.type === 'tool_call' && e.id.split('>').pop() === leaf) as
        { name: string } | undefined;
      asked.push(ev?.name ?? id);
      return Promise.resolve(decide(ev?.name ?? ''));
    },
  });
  const results = events.filter((e) => e.type === 'tool_result') as Extract<
    ChatEventView,
    { type: 'tool_result' }
  >[];
  return { asked, events, offered, results, answer };
}

describe('subagents in the agent loop', () => {
  it('a subagent with tools: [read] cannot write (not offered, refused if called)', async () => {
    writeFileSync(
      join(ws, '.zinarix', 'agents', 'reader.md'),
      '---\ndescription: Reads code\ntools: [read]\n---\nYou only read.\n',
    );
    const r = await run([
      [{ name: 'task', args: { subagent: 'reader', prompt: 'Write hack.txt' } }],
      // the subagent tries to write anyway
      [{ name: 'write_file', args: { path: 'hack.txt', content: 'x' } }],
      [], // subagent ends
      [], // main agent ends
    ]);
    expect(existsSync(join(ws, 'hack.txt'))).toBe(false);
    expect(r.offered[0]).toContain('task');
    expect(r.offered[1]).toContain('read_file');
    expect(r.offered[1]).not.toContain('write_file');
    expect(r.offered[1]).not.toContain('run_command');
    expect(r.offered[1]).not.toContain('task');
    expect(r.results.some((e) => e.summary === 'no permitida para este subagente')).toBe(true);
    // launching it was approved like any action
    expect(r.asked).toEqual(['task']);
  });

  it('task is only offered when the project defines subagents', async () => {
    rmSync(join(ws, '.zinarix'), { recursive: true, force: true });
    const r = await run([[]]);
    expect(r.offered[0]).not.toContain('task');
    expect(r.offered[0]).not.toContain('use_skill');
  });

  it('use_skill loads the SKILL.md body and lists its files', async () => {
    const dir = join(ws, '.zinarix', 'skills', 'release');
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\ndescription: Ship a release\n---\nRun scripts/bump.sh',
    );
    writeFileSync(join(dir, 'scripts', 'bump.sh'), 'echo');
    const r = await run([[{ name: 'use_skill', args: { name: 'release' } }], []]);
    expect(r.results[0]).toMatchObject({ ok: true, summary: 'skill release' });
    const kit = loadKit(new Workspace(ws), null);
    expect(kit.skills.map((s) => s.name)).toEqual(['release']);
  });
});

describe('hooks in the agent loop', () => {
  it('PostToolUse runs after every edit (a formatter) once the user approves the hooks', async () => {
    const fmt = nodeHook(
      'fmt.cjs',
      `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=JSON.parse(s);const f=i.tool_input.file_path;const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').trim().toUpperCase()+'\\n');});`,
    );
    writeFileSync(
      join(ws, '.zinarix', 'settings.json'),
      JSON.stringify({
        hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ command: fmt }] }] },
      }),
    );
    const r = await run([
      [{ name: 'write_file', args: { path: 'a.txt', content: '  hello  ' } }],
      [
        {
          name: 'edit_file',
          args: { path: 'a.txt', old_string: 'HELLO', new_string: 'HELLO world' },
        },
      ],
      [],
    ]);
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('HELLO WORLD\n');
    // hooks approved once, then each write as usual
    expect(r.asked.filter((n) => n === 'project_hooks')).toHaveLength(1);
  }, 30_000);

  it('PreToolUse exit 2 blocks the action and the message reaches the model', async () => {
    const deny = nodeHook(
      'deny.cjs',
      `process.stderr.write('No writes on Fridays');process.exit(2);`,
    );
    writeFileSync(
      join(ws, '.zinarix', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ command: deny }] }] } }),
    );
    const r = await run([[{ name: 'write_file', args: { path: 'b.txt', content: 'x' } }], []]);
    expect(existsSync(join(ws, 'b.txt'))).toBe(false);
    expect(r.results.at(-1)?.summary).toContain('No writes on Fridays');
    // the write itself never got to ask
    expect(r.asked).toEqual(['project_hooks']);
  }, 30_000);

  it('hooks the user turns down do not run', async () => {
    const marker = join(root, 'ran.txt');
    const hook = nodeHook(
      'mark.cjs',
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`,
    );
    writeFileSync(
      join(ws, '.zinarix', 'settings.json'),
      JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ command: hook }] }] } }),
    );
    await run([[{ name: 'write_file', args: { path: 'c.txt', content: 'x' } }], []], (name) =>
      name === 'project_hooks' ? 'deny' : 'approve',
    );
    expect(existsSync(join(ws, 'c.txt'))).toBe(true);
    expect(existsSync(marker)).toBe(false);
  }, 30_000);

  it('"always" trusts the hook set for the folder; a changed command asks again', async () => {
    const trustDir = join(root, 'userdata');
    mkdirSync(trustDir);
    const hook = nodeHook('ok.cjs', '');
    const settings = (cmd: string) =>
      writeFileSync(
        join(ws, '.zinarix', 'settings.json'),
        JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: cmd }] }] } }),
      );
    settings(hook);
    const decide = (n: string): ToolDecision => (n === 'project_hooks' ? 'always' : 'approve');
    const first = await run(
      [[{ name: 'list_dir', args: { path: '.' } }], []],
      decide,
      new HookTrust(trustDir),
    );
    expect(first.asked).toEqual(['project_hooks']);
    const again = await run(
      [[{ name: 'list_dir', args: { path: '.' } }], []],
      decide,
      new HookTrust(trustDir),
    );
    expect(again.asked).toEqual([]);
    settings(`${hook} --changed`);
    const changed = await run(
      [[{ name: 'list_dir', args: { path: '.' } }], []],
      decide,
      new HookTrust(trustDir),
    );
    expect(changed.asked).toEqual(['project_hooks']);
  }, 30_000);

  it('a Stop hook with exit 2 sends the agent back to work (bounded)', async () => {
    const stop = nodeHook('stop.cjs', `process.stderr.write('Tests are failing');process.exit(2);`);
    writeFileSync(
      join(ws, '.zinarix', 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: stop }] }] } }),
    );
    const r = await run([[], [], [], [], []]);
    // 1 normal end + 3 rounds sent back, then it stops anyway
    expect(r.offered).toHaveLength(4);
    expect(r.events.filter((e) => e.type === 'notice' && e.kind === 'hook')).toHaveLength(3);
  }, 30_000);
});

/* -------------------------------------------------------------- Fase 4, improvements */

describe('Claude Code hook JSON output', () => {
  const ok = (stdout: string) => hookOutcome({ code: 0, stdout, stderr: '' });

  it('permissionDecision "deny" blocks with its reason', () => {
    expect(
      ok(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'No .env edits',
          },
        }),
      ),
    ).toMatchObject({ block: true, message: 'No .env edits' });
  });

  it('"allow" never skips approval: it is just "go on"', () => {
    expect(ok(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }))).toEqual({
      block: false,
      message: '',
    });
  });

  it('continue:false stops with stopReason; systemMessage is a notice for the user', () => {
    expect(
      ok(JSON.stringify({ continue: false, stopReason: 'Build broken', systemMessage: 'hey' })),
    ).toEqual({ block: true, message: 'Build broken', notice: 'hey' });
  });

  it('additionalContext becomes context for the model', () => {
    expect(
      ok(JSON.stringify({ hookSpecificOutput: { additionalContext: 'Lint: 2 warnings' } })),
    ).toEqual({ block: false, message: 'Lint: 2 warnings' });
  });

  it('text that only looks like JSON stays plain text', () => {
    expect(ok('{not json')).toEqual({ block: false, message: '{not json' });
  });
});

describe('subagent model', () => {
  const have = new Set(['anthropic/claude-sonnet-5-5', 'openai/gpt-5']);
  const resolve = (m: string) => (have.has(m) ? m : undefined);

  it('takes provider/model when it is available, else inherits', () => {
    expect(subagentModel('openai/gpt-5', resolve)).toBe('openai/gpt-5');
    expect(subagentModel('groq/llama', resolve)).toBeUndefined();
  });

  it('maps the Claude Code aliases to Anthropic models', () => {
    expect(subagentModel('sonnet', resolve)).toBe('anthropic/claude-sonnet-5-5');
    expect(subagentModel('Opus', resolve)).toBeUndefined(); // not connected
    expect(subagentModel('inherit', resolve)).toBeUndefined();
    expect(subagentModel('gpt-5', resolve)).toBeUndefined(); // no provider: cannot guess
  });
});

describe('new kit files and /skill', () => {
  it('kitTemplate picks a free name and a path per kind', () => {
    expect(kitTemplate('agent', 'Mi Revisor')).toMatchObject({
      name: 'mi-revisor',
      path: '.zinarix/agents/mi-revisor.md',
    });
    expect(kitTemplate('skill', 'pdf', ['pdf', 'pdf-2']).path).toBe(
      '.zinarix/skills/pdf-3/SKILL.md',
    );
    expect(kitTemplate('command', '', []).path).toBe('.zinarix/commands/command.md');
  });

  it('templates parse back into valid definitions', () => {
    const a = kitTemplate('agent', 'rev');
    expect(parseAgentDef(a.path, a.content)).toMatchObject({
      name: 'rev',
      tools: ['read', 'grep'],
    });
    const s = kitTemplate('skill', 'pdf');
    expect(parseSkill('.zinarix/skills/pdf', s.content)?.name).toBe('pdf');
    const c = kitTemplate('command', 'fix');
    expect(parseCommand(c.path, c.content)?.argumentHint).toBe('<texto>');
  });

  it('createKitFile writes the file and never overwrites', () => {
    const w = new Workspace(ws);
    const first = createKitFile(w, 'command', 'deploy');
    expect(first).toBe('.zinarix/commands/deploy.md');
    writeFileSync(join(ws, first), '---\ndescription: mine\n---\nkeep me');
    const second = createKitFile(w, 'command', 'deploy');
    expect(second).toBe('.zinarix/commands/deploy-2.md');
    expect(readFileSync(join(ws, first), 'utf8')).toContain('keep me');
    expect(createKitFile(w, 'skill', 'pdf')).toBe('.zinarix/skills/pdf/SKILL.md');
    expect(loadKit(w, null).skills.map((k) => k.name)).toEqual(['pdf']);
  });

  it('skillPrompt asks the agent to load the skill first', () => {
    expect(skillPrompt('pdf', '  fill form.pdf ')).toBe(
      'Use the skill "pdf" (call use_skill first to load it) for this:\n\nfill form.pdf',
    );
    expect(skillPrompt('pdf', '')).toContain('now.');
  });
});

describe('Fase 4 improvements in the agent loop', () => {
  it('a subagent whose model is not available runs on the main model (with a notice)', async () => {
    writeFileSync(
      join(ws, '.zinarix', 'agents', 'fast.md'),
      '---\ndescription: Fast\nmodel: haiku\n---\nBe quick.\n',
    );
    const r = await run([
      [{ name: 'task', args: { subagent: 'fast', prompt: 'Say hi' } }],
      [], // subagent ends
      [], // main agent ends
    ]);
    expect(r.results.find((e) => e.summary === 'fast terminó')).toBeTruthy();
    expect(
      r.events.some((e) => e.type === 'notice' && e.message.includes('"haiku" no está disponible')),
    ).toBe(true);
  });

  it('PostToolUse output on exit 0 reaches the model as context', async () => {
    const lint = nodeHook('lint.cjs', `process.stdout.write('Lint: 1 warning in a.txt');`);
    writeFileSync(
      join(ws, '.zinarix', 'settings.json'),
      JSON.stringify({
        hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ command: lint }] }] },
      }),
    );
    let seen = '';
    const offered: string[][] = [];
    const core = fakeCore(
      [[{ name: 'write_file', args: { path: 'a.txt', content: 'x' } }], []],
      offered,
    ) as unknown as { stream: (req: { messages: ChatMessage[] }) => AsyncGenerator<unknown> };
    const inner = core.stream.bind(core);
    core.stream = async function* (req) {
      seen = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      yield* inner(req);
    };
    const workspace = new Workspace(ws);
    const agent = new Agent(core as unknown as OmniCore, () => workspace);
    agent.userKitRoot = null;
    await agent.run({
      conversationId: 'c',
      userMessage: { role: 'user', content: 'go' },
      fallbackHistory: [],
      signal: new AbortController().signal,
      emit: () => undefined,
      ask: () => Promise.resolve('approve'),
    });
    expect(seen).toContain('<hook-context event="PostToolUse">');
    expect(seen).toContain('Lint: 1 warning in a.txt');
  }, 30_000);
});
