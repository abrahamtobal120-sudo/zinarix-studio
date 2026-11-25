import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cleanEnv,
  decide,
  hookVerdict,
  leakedToolCalls,
  loadProject,
  parseHooks,
  projectCommands,
  projectPrompt,
  projectTree,
  publishingAction,
  resolveInside,
  runHeadlessAgent,
  similarFiles,
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
  it('continues an answer that was cut off by the output limit', async () => {
    const cwd = tmp();
    const m = script([
      [
        { type: 'text', delta: 'Primera parte' },
        { type: 'done', stopReason: 'max_tokens' },
      ],
      [{ type: 'text', delta: ' y el final.' }],
    ]);
    const r = await runHeadlessAgent(m.stream, { prompt: 'go', cwd, hooks: false });
    expect(m.requests).toHaveLength(2);
    expect(JSON.stringify(m.requests[1]!.messages.at(-1))).toContain('cut off by the output limit');
    expect(r.text).toBe('Primera parte y el final.');
    expect(r.stop).toBe('done');
  });

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

describe('finding files (estudio, Fase 2)', () => {
  const project = () => {
    const root = tmp();
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'src', 'paginate.mjs'), 'export const a = 1;\n');
    writeFileSync(join(root, 'src', 'lib', 'slug.mjs'), 'export const b = 2;\n');
    writeFileSync(join(root, 'node_modules', 'x', 'app.js'), '');
    writeFileSync(join(root, 'README.md'), '# x\n');
    return root;
  };

  it('maps the project without build output', () => {
    const tree = projectTree(project());
    expect(tree.split('\n')).toEqual([
      'README.md',
      'src/',
      'src/lib/',
      'src/lib/slug.mjs',
      'src/paginate.mjs',
    ]);
    expect(projectTree(tmp())).toBe('');
    expect(projectTree(project(), 2)).toMatch(/cut at 2 entries/);
  });

  it('suggests the files that exist for a guessed path', () => {
    const root = project();
    // Right name, wrong folder; right stem, wrong extension; right folder, wrong name.
    expect(similarFiles(root, 'slug.mjs')[0]).toBe('src/lib/slug.mjs');
    expect(similarFiles(root, 'src/paginate.js')[0]).toBe('src/paginate.mjs');
    expect(similarFiles(root, './src/app.js')).toEqual(['src/paginate.mjs']);
    expect(similarFiles(root, 'lib/nothing.py')).toEqual([]);
  });

  it('gives the model the file map with the task and the real names on a miss', async () => {
    const root = project();
    const { stream, requests } = script([
      [call('1', 'read_file', { path: 'src/app.js' })],
      [call('2', 'edit_file', { path: 'paginate.js', old_string: 'a', new_string: 'b' })],
      [{ type: 'text', delta: 'ok' }],
    ]);
    const r = await runHeadlessAgent(stream, { prompt: 'fix it', cwd: root, approve: 'full' });
    expect(r.ok).toBe(true);
    const first = requests[0]!.messages;
    expect(first[0]!.content).not.toContain('paginate.mjs');
    expect(first[1]!.content).toMatch(
      /^fix it\n\n<project-files>\n[\s\S]*src\/paginate\.mjs\n<\/project-files>(\n\n<project-commands>[\s\S]*)?$/,
    );
    const results = requests[2]!.messages.filter((m) => m.role === 'tool');
    expect(results[0]!.content).toBe(
      'file not found: src/app.js. Files that exist: src/paginate.mjs',
    );
    expect(results[1]!.content).toContain('Files that exist: src/paginate.mjs');
  });
});

describe('models that write their tool calls as text (estudio, A6)', () => {
  const names = new Set(['read_file', 'edit_file']);

  it('finds calls written as plain JSON, and only those that name a real tool', () => {
    const text =
      'I will read it.\n```json\n{"name": "read_file", "arguments": {"path": "a {b}.txt"}}\n```\n' +
      '{"name": "edit_file", "arguments": {"path": "a.txt", "old_string": "}", "new_string": "\\"x\\""}}\n' +
      'Then the summary.';
    const found = leakedToolCalls(text, names, 'c');
    expect(found.calls.map((c) => [c.id, c.name])).toEqual([
      ['c1', 'read_file'],
      ['c2', 'edit_file'],
    ]);
    expect(JSON.parse(found.calls[1]!.arguments)).toEqual({
      path: 'a.txt',
      old_string: '}',
      new_string: '"x"',
    });
    expect(found.visible).toBe('I will read it.');
    expect(found.kept.endsWith('"\\"x\\""}}')).toBe(true);

    for (const plain of [
      'The config is {"name": "my-app", "version": "1.0.0"}.',
      '{"name": "delete_everything", "arguments": {}}',
      '{"name": "read_file"}',
      'broken {"name": "read_file", "arguments": {',
    ])
      expect(leakedToolCalls(plain, names, 'c').calls, plain).toEqual([]);
  });

  it('runs calls the model wrote as JSON and goes on with the text protocol', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.txt'), 'hello world\n');
    const { stream, requests } = script([
      [
        {
          type: 'text',
          delta:
            '{"name": "read_file", "arguments": {"path": "a.txt"}}\n' +
            '{"name": "edit_file", "arguments": {"path": "a.txt", "old_string": "world", "new_string": "there"}}',
        },
      ],
      [
        {
          type: 'text',
          delta: '<tool_call>\n{"name": "read_file", "arguments": {"path": "a.txt"}}\n</tool_call>',
        },
      ],
      [{ type: 'text', delta: 'Changed the greeting.' }],
    ]);
    const shown: string[] = [];
    const r = await runHeadlessAgent(stream, {
      prompt: 'change it',
      cwd: dir,
      approve: 'auto-edit',
      hooks: false,
      onEvent: (ev) => {
        if (ev.type === 'text') shown.push(ev.delta);
      },
    });
    expect(r.stop).toBe('done');
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hello there\n');
    expect(r.tools.map((t) => [t.name, t.ok])).toEqual([
      ['read_file', true],
      ['edit_file', true],
      ['read_file', true],
    ]);
    expect(r.text).toBe('Changed the greeting.');
    // First request: native tools. After the leak: no tools, the protocol in the system
    // prompt and the results in a user message.
    expect(requests[0]!.tools?.length).toBeGreaterThan(0);
    expect(requests[1]!.tools).toBeUndefined();
    const sys = requests[1]!.messages.find((m) => m.role === 'system');
    expect(String(sys?.content)).toContain('<zinarix-tools>');
    const last = requests[1]!.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(String(last.content)).toContain('<tool_result name="edit_file" ok="true">');
    expect(requests[2]!.messages.some((m) => m.role === 'tool')).toBe(false);
    // The <tool_call> block of the second turn is not shown as answer text.
    expect(shown.join('')).not.toContain('<tool_call>');
  });

  it('closes a call that lacks its last brace and reports one that is cut short', () => {
    const open = leakedToolCalls(
      'Ok.\n{"name": "edit_file", "arguments": {"path": "a.txt", "edits": [{"old_string": "a", "new_string": "b"}]}',
      names,
      'c',
    );
    expect(open.errors).toEqual([]);
    expect(JSON.parse(open.calls[0]!.arguments)).toEqual({
      path: 'a.txt',
      edits: [{ old_string: 'a', new_string: 'b' }],
    });
    const cut = leakedToolCalls('{"name": "read_file", "arguments": {"path": "a.t', names, 'c');
    expect(cut.calls).toEqual([]);
    expect(cut.errors).toHaveLength(1);
    // Not a tool: left alone.
    expect(leakedToolCalls('{"name": "other", "arguments": {', names, 'c').errors).toEqual([]);
  });

  it('does not let the model change a file it has not read', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.txt'), 'hello world\n');
    const edit = { path: 'a.txt', old_string: 'world', new_string: 'there' };
    const { stream, requests } = script([
      [call('1', 'edit_file', edit)],
      [call('2', 'write_file', { path: 'a.txt', content: 'x' })],
      [call('3', 'write_file', { path: 'new.txt', content: 'new' })],
      [call('4', 'read_file', { path: 'a.txt' })],
      [call('5', 'edit_file', edit)],
      [call('6', 'edit_file', { path: 'new.txt', old_string: 'new', new_string: 'newer' })],
      [{ type: 'text', delta: 'Done.' }],
    ]);
    const r = await runHeadlessAgent(stream, {
      prompt: 'change it',
      cwd: dir,
      approve: 'auto-edit',
      hooks: false,
    });
    expect(r.tools.map((t) => t.ok)).toEqual([false, false, true, true, true, true]);
    const refused = requests[1]!.messages.at(-1)!;
    expect(String(refused.content)).toContain('Call read_file on it first');
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hello there\n');
    expect(readFileSync(join(dir, 'new.txt'), 'utf8')).toBe('newer');
  });

  it('switches to the text protocol when the provider refuses the tools', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    const requests: StreamRequest[] = [];
    const stream = async function* (req: StreamRequest): AsyncGenerator<OmniEvent> {
      requests.push(structuredClone(req));
      yield { type: 'start', provider: 'fake', model: 'm' };
      if (req.tools) throw new Error('registry.ollama.ai/x does not support tools');
      yield requests.length === 2
        ? {
            type: 'text',
            delta: '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>',
          }
        : { type: 'text', delta: 'It says one.' };
    };
    const r = await runHeadlessAgent(stream, {
      prompt: 'what does it say',
      cwd: dir,
      approve: 'read-only',
      hooks: false,
    });
    expect(r).toMatchObject({ stop: 'done', text: 'It says one.' });
    expect(r.steps).toBe(2);
    expect(r.tools).toEqual([{ name: 'read_file', args: { path: 'a.txt' }, ok: true }]);
  });
});

describe('runs that go nowhere (estudio, A6)', () => {
  it('asks once when the answer shows code but no file was changed', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.txt'), 'hello world\n');
    const { stream, requests } = script([
      [{ type: 'text', delta: 'The fix:\n```js\nconst a = 1;\n```' }],
      [call('1', 'read_file', { path: 'a.txt' })],
      [call('2', 'edit_file', { path: 'a.txt', old_string: 'world', new_string: 'there' })],
      [{ type: 'text', delta: 'Saved:\n```\nhello there\n```' }],
    ]);
    const r = await runHeadlessAgent(stream, {
      prompt: 'fix it',
      cwd: dir,
      approve: 'auto-edit',
      hooks: false,
    });
    expect(r).toMatchObject({ stop: 'done', steps: 4, filesChanged: ['a.txt'] });
    expect(String(requests[1]!.messages.at(-1)!.content)).toContain('nothing was saved');
    expect(requests).toHaveLength(4);
  });

  it('does not ask in a read-only run', async () => {
    const dir = tmp();
    const { stream, requests } = script([[{ type: 'text', delta: '```js\nconst a = 1;\n```' }]]);
    const r = await runHeadlessAgent(stream, {
      prompt: 'explain',
      cwd: dir,
      approve: 'read-only',
      hooks: false,
    });
    expect(r.stop).toBe('done');
    expect(requests).toHaveLength(1);
  });

  it('warns about a call repeated in a row, then stops the run', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    const same = (id: string) => [call(id, 'read_file', { path: 'a.txt' })];
    const { stream, requests } = script(['1', '2', '3', '4', '5', '6', '7'].map(same));
    const r = await runHeadlessAgent(stream, {
      prompt: 'read it',
      cwd: dir,
      approve: 'read-only',
      hooks: false,
    });
    expect(r.stop).toBe('error');
    expect(r.error).toContain('same read_file call 6 times');
    expect(r.steps).toBe(6);
    const result = (n: number) => String(requests[n]!.messages.at(-1)!.content);
    expect(result(2)).not.toContain('times in a row');
    expect(result(3)).toContain('this exact call 3 times in a row');
  });

  it('does not count a call as repeated when another came in between', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    const read = (id: string) => [call(id, 'read_file', { path: 'a.txt' })];
    const list = (id: string) => [call(id, 'list_files', {})];
    const { stream } = script([
      read('1'),
      list('2'),
      read('3'),
      list('4'),
      read('5'),
      list('6'),
      read('7'),
      [{ type: 'text', delta: 'ok' }],
    ]);
    const r = await runHeadlessAgent(stream, {
      prompt: 'read it',
      cwd: dir,
      approve: 'read-only',
      hooks: false,
    });
    expect(r.stop).toBe('done');
  });
});

describe('what the project can run (estudio, Fase 2)', () => {
  it('lists the scripts of package.json, or says there is no test setup', () => {
    const withScripts = tmp();
    writeFileSync(
      join(withScripts, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run', build: 'tsc -b' } }),
    );
    expect(projectCommands(withScripts)).toBe('npm run test: vitest run\nnpm run build: tsc -b');

    const noScripts = tmp();
    writeFileSync(join(noScripts, 'package.json'), '{"name":"x"}');
    expect(projectCommands(noScripts)).toContain('no test command');

    const bare = tmp();
    writeFileSync(join(bare, 'a.mjs'), '');
    expect(projectCommands(bare)).toContain('no package.json and no test runner');

    // Another ecosystem, or a package.json that does not parse: nothing is claimed.
    const python = tmp();
    writeFileSync(join(python, 'pyproject.toml'), '');
    expect(projectCommands(python)).toBe('');
    const broken = tmp();
    writeFileSync(join(broken, 'package.json'), '{');
    expect(projectCommands(broken)).toBe('');
  });

  it('tells the model at full approval only', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.mjs'), '');
    for (const [approve, told] of [
      ['full', true],
      ['auto-edit', false],
    ] as const) {
      const { stream, requests } = script([[{ type: 'text', delta: 'ok' }]]);
      await runHeadlessAgent(stream, { prompt: 'x', cwd: dir, approve, hooks: false });
      const user = String(requests[0]!.messages.at(-1)!.content);
      expect(user.includes('<project-commands>'), approve).toBe(told);
    }
  });
});
