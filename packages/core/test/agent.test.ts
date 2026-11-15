import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cleanEnv,
  decide,
  hookVerdict,
  loadProject,
  parseHooks,
  projectPrompt,
  publishingAction,
  resolveInside,
  runHeadlessAgent,
  toolsFor,
} from '../src/index.js';
import type { OmniEvent, StreamRequest } from '../src/index.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'zx-agent-'));

/** A fake model: each call returns the next scripted turn and records the request. */
function script(turns: OmniEvent[][]) {
  const requests: StreamRequest[] = [];
  let i = 0;
  const stream = async function* (req: StreamRequest): AsyncGenerator<OmniEvent> {
    requests.push(structuredClone(req));
    yield { type: 'start', provider: 'fake', model: 'm' };
    for (const ev of turns[i++] ?? [{ type: 'text', delta: 'done' }]) yield ev;
    yield { type: 'cost', usd: 0.001, inputTokens: 10, outputTokens: 5, latencyMs: 1 };
  };
  return { stream, requests };
}

const call = (id: string, name: string, args: unknown): OmniEvent => ({
  type: 'tool_call',
  id,
  name,
  argsDelta: JSON.stringify(args),
});

describe('approval policy', () => {
  it('follows the level table', () => {
    expect(decide('read-only', 'read_file', {})).toEqual({ allow: true });
    expect(decide('read-only', 'write_file', {}).allow).toBe(false);
    expect(decide('read-only', 'run_command', { command: 'ls' }).allow).toBe(false);
    expect(decide('auto-edit', 'edit_file', {}).allow).toBe(true);
    expect(decide('auto-edit', 'run_command', { command: 'ls' }).allow).toBe(false);
    expect(decide('full', 'run_command', { command: 'pnpm test' }).allow).toBe(true);
    expect(decide('full', 'mystery', {}).allow).toBe(false);
    expect(toolsFor('read-only')).toEqual(['list_files', 'read_file', 'search']);
    expect(toolsFor('full')).toContain('run_command');
  });

  it('never publishes, even at full', () => {
    for (const cmd of [
      'git push origin main',
      'pnpm test && git push',
      'git -C x push --force',
      'gh pr create --fill',
      'npm publish',
      'pnpm --filter x publish',
      'vercel --prod',
      'docker push img',
    ]) {
      expect(publishingAction(cmd), cmd).not.toBeNull();
      expect(decide('full', 'run_command', { command: cmd }).allow, cmd).toBe(false);
    }
    for (const cmd of ['git status', 'git commit -m push', 'pnpm test', 'gh --version'])
      expect(publishingAction(cmd), cmd).toBeNull();
  });
});

describe('path confinement', () => {
  it('rejects paths outside the project and .git', () => {
    const root = tmp();
    mkdirSync(join(root, 'src'));
    expect(resolveInside(root, 'src/a.ts')).toMatch(/a\.ts$/);
    expect(() => resolveInside(root, '../x')).toThrow(/outside/);
    expect(() => resolveInside(root, join(tmpdir(), 'elsewhere.txt'))).toThrow(/outside/);
    expect(() => resolveInside(root, '.git/config')).toThrow(/\.git/);
    expect(() => resolveInside(root, '')).toThrow(/required/);
  });

  it('rejects links and junctions that lead out', () => {
    const root = tmp();
    const outside = tmp();
    symlinkSync(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => resolveInside(root, 'link/secret.txt')).toThrow(/link or junction/);
  });

  it('drops credentials from the environment of commands', () => {
    const env = cleanEnv({
      PATH: '/bin',
      HOME: '/h',
      GITHUB_TOKEN: 'x',
      OPENAI_API_KEY: 'x',
      AWS_SECRET_ACCESS_KEY: 'x',
      NPM_AUTH: 'x',
      OMNI_VAULT_PASSWORD: 'x',
    });
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH']);
  });
});

describe('project rules, skills and hooks', () => {
  it('puts always-rules in the prompt and lists the others and the skills', () => {
    const root = tmp();
    writeFileSync(join(root, 'AGENTS.md'), 'Use tabs.');
    mkdirSync(join(root, '.zinarix/rules'), { recursive: true });
    writeFileSync(join(root, '.zinarix/rules/always.md'), '---\napplies: always\n---\nBe brief.');
    writeFileSync(
      join(root, '.zinarix/rules/react.md'),
      '---\nglobs: ["**/*.tsx"]\ndescription: React style\n---\nHooks first.',
    );
    mkdirSync(join(root, '.zinarix/skills/deploy'), { recursive: true });
    writeFileSync(
      join(root, '.zinarix/skills/deploy/SKILL.md'),
      '---\nname: deploy\ndescription: How to ship\n---\nSteps.',
    );
    const ctx = loadProject(root);
    const { text, used } = projectPrompt(ctx);
    expect(used).toEqual(['AGENTS.md', '.zinarix/rules/always.md']);
    expect(text).toContain('Use tabs.');
    expect(text).toContain('Be brief.');
    expect(text).not.toContain('Hooks first.');
    expect(text).toContain('.zinarix/rules/react.md — React style');
    expect(text).toContain('deploy (.zinarix/skills/deploy/SKILL.md) — How to ship');
  });

  it('parses hook settings and their verdicts', () => {
    const hooks = parseHooks(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check' }] }],
          PostToolUse: [{ matcher: 'Edit|Write', command: 'fmt', timeout: 5 }],
          Nope: [{ command: 'x' }],
        },
      }),
      's.json',
    );
    expect(hooks.map((h) => [h.event, h.matcher, h.command, h.timeout])).toEqual([
      ['PreToolUse', 'Bash', 'check', 60],
      ['PostToolUse', 'Edit|Write', 'fmt', 5],
    ]);
    expect(hookVerdict(2, '', 'no')).toEqual({ block: true, message: 'no' });
    expect(hookVerdict(0, '{"decision":"block","reason":"r"}', '').block).toBe(true);
    expect(hookVerdict(1, '', 'oops')).toMatchObject({ block: false, warning: 'oops' });
    expect(hookVerdict(0, 'ctx', '')).toEqual({ block: false, message: 'ctx' });
  });
});

describe('headless agent loop', () => {
  it('edits a file and finishes with a summary', async () => {
    const root = tmp();
    writeFileSync(join(root, 'a.txt'), 'hello world\n');
    writeFileSync(join(root, 'AGENTS.md'), 'Rule X.');
    const { stream, requests } = script([
      [call('1', 'read_file', { path: 'a.txt' })],
      [call('2', 'edit_file', { path: 'a.txt', old_string: 'world', new_string: 'there' })],
      [{ type: 'text', delta: 'Changed a.txt.' }],
    ]);
    const events: string[] = [];
    const r = await runHeadlessAgent(stream, {
      prompt: 'fix it',
      cwd: root,
      approve: 'auto-edit',
      onEvent: (e) => events.push(e.type),
    });
    expect(r).toMatchObject({
      ok: true,
      stop: 'done',
      text: 'Changed a.txt.',
      model: 'fake/m',
      steps: 3,
      filesChanged: ['a.txt'],
      rules: ['AGENTS.md'],
    });
    expect(r.usage.inputTokens).toBe(30);
    expect(r.usage.usd).toBeCloseTo(0.003);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('hello there\n');
    expect(events).toContain('file_changed');
    // Rules in the system prompt, only the tools of the level offered.
    const sys = requests[0]!.messages[0]!;
    expect(sys.role === 'system' && sys.content).toContain('Rule X.');
    expect(requests[0]!.tools!.map((t) => t.name)).not.toContain('run_command');
    // The read result went back to the model.
    const toolMsg = requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg && toolMsg.content).toContain('hello world');
  });

  it('refuses writes in read-only even if the model tries', async () => {
    const root = tmp();
    const { stream, requests } = script([
      [call('1', 'write_file', { path: 'x.txt', content: 'x' })],
      [{ type: 'text', delta: 'ok' }],
    ]);
    const r = await runHeadlessAgent(stream, { prompt: 'p', cwd: root, approve: 'read-only' });
    expect(r.ok).toBe(true);
    expect(r.tools[0]).toMatchObject({ name: 'write_file', ok: false });
    expect(r.tools[0]!.denied).toMatch(/read-only/);
    expect(r.filesChanged).toEqual([]);
    const toolMsg = requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toMatchObject({ isError: true });
  });

  it('stops at max steps', async () => {
    const root = tmp();
    const loop = Array.from({ length: 5 }, (_, i) => [call(String(i), 'list_files', {})]);
    const { stream } = script(loop);
    const r = await runHeadlessAgent(stream, {
      prompt: 'p',
      cwd: root,
      approve: 'read-only',
      maxSteps: 2,
    });
    expect(r).toMatchObject({ ok: false, stop: 'max_steps', steps: 2 });
  });

  it('reports a model error', async () => {
    const root = tmp();
    const stream = async function* (): AsyncGenerator<OmniEvent> {
      throw new Error('boom');
    };
    const r = await runHeadlessAgent(stream, { prompt: 'p', cwd: root, approve: 'read-only' });
    expect(r).toMatchObject({ ok: false, stop: 'error', error: 'boom' });
  });

  it('runs commands at full and lets a PreToolUse hook block one', async () => {
    const root = tmp();
    mkdirSync(join(root, '.zinarix'));
    // Blocks any command that mentions "forbidden" (exit 2, reason on stderr).
    const hook = `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(s.includes('forbidden')){console.error('nope');process.exit(2)}})"`;
    writeFileSync(
      join(root, '.zinarix/settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', command: hook }] } }),
    );
    const { stream } = script([
      [
        call('1', 'run_command', { command: 'node -e "console.log(6*7)"' }),
        call('2', 'run_command', { command: 'echo forbidden' }),
      ],
      [{ type: 'text', delta: 'done' }],
    ]);
    const outputs: string[] = [];
    const r = await runHeadlessAgent(stream, {
      prompt: 'p',
      cwd: root,
      approve: 'full',
      onEvent: (e) => {
        if (e.type === 'tool_result') outputs.push(e.content);
      },
    });
    expect(r.ok).toBe(true);
    expect(r.tools[0]).toMatchObject({ name: 'run_command', ok: true });
    expect(outputs[0]).toContain('42');
    expect(r.tools[1]!.denied).toMatch(/PreToolUse hook: nope/);
  });
});
