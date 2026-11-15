import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentExitCode, describeCall } from '../src/commands/agent.js';
import { mockServer, sse } from '../../../tests/helpers/mock-server.js';

describe('omni agent helpers', () => {
  it('maps the stop reason to an exit code', () => {
    expect(agentExitCode({ stop: 'done' })).toBe(0);
    expect(agentExitCode({ stop: 'aborted' })).toBe(130);
    expect(agentExitCode({ stop: 'max_steps' })).toBe(1);
    expect(agentExitCode({ stop: 'error', errorExit: 3 })).toBe(3);
    expect(agentExitCode({ stop: 'error' })).toBe(1);
  });

  it('describes a tool call in one line', () => {
    expect(describeCall('run_command', { command: 'pnpm   test' })).toBe('run_command pnpm test');
    expect(describeCall('list_files', {})).toBe('list_files');
  });
});

const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe.skipIf(!existsSync(CLI))('omni agent end to end', () => {
  let home: string;
  let project: string;
  let server: Awaited<ReturnType<typeof mockServer>>;
  let turn = 0;

  const run = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        cwd: project,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: home,
          OMNI_HOME: home,
          OMNI_NO_KEYCHAIN: '1',
          OMNI_VAULT_PASSWORD: 'test-master-pw',
          NO_COLOR: '1',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end('');
    });

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'omni-agent-home-'));
    project = mkdtempSync(join(tmpdir(), 'omni-agent-proj-'));
    writeFileSync(join(project, 'AGENTS.md'), 'Always answer in one line.');
    writeFileSync(join(project, 'notes.txt'), 'the answer is 42\n');
    server = await mockServer((req, res) => {
      if (!req.url.includes('chat/completions')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'm' }] }));
        return;
      }
      const base = { id: 'x', object: 'chat.completion.chunk', model: 'm' };
      if (turn++ % 2 === 0)
        sse(res, [
          {
            data: {
              ...base,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                      },
                    ],
                  },
                },
              ],
            },
          },
          { data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] } },
          '[DONE]',
        ]);
      else
        sse(res, [
          { data: { ...base, choices: [{ index: 0, delta: { content: 'It is 42.' } }] } },
          { data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] } },
          '[DONE]',
        ]);
    });
    const add = await run([
      'providers',
      'add-custom',
      '--id',
      'fake',
      '--base-url',
      server.url,
      '--no-auth',
      '--local',
    ]);
    if (add.code !== 0) throw new Error(`add-custom failed: ${add.stderr}`);
  });
  afterAll(async () => {
    await server?.close();
  });

  it('runs read-only with --json, following AGENTS.md', async () => {
    const r = await run(['agent', '-p', 'what is the answer?', '-m', 'fake/m', '--json']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out).toMatchObject({
      ok: true,
      stop: 'done',
      text: 'It is 42.',
      approve: 'read-only',
      rules: ['AGENTS.md'],
      filesChanged: [],
    });
    expect((out.tools as { name: string; ok: boolean }[])[0]).toMatchObject({
      name: 'read_file',
      ok: true,
    });
    // Rules in the system prompt, the file content went back as the tool result.
    const first = JSON.parse(server.requests.find((q) => q.url.includes('chat'))!.body) as {
      messages: { role: string; content: string }[];
      tools: { function: { name: string } }[];
    };
    expect(first.messages[0]!.content).toContain('Always answer in one line.');
    expect(first.tools.map((t) => t.function.name)).toEqual(['list_files', 'read_file', 'search']);
    const second = server.requests.filter((q) => q.url.includes('chat')).at(-1)!.body;
    expect(second).toContain('the answer is 42');
  });

  it('rejects an unknown approval level', async () => {
    const r = await run(['agent', '-p', 'x', '-m', 'fake/m', '--approve', 'yolo']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/read-only, auto-edit, full/);
    expect(readFileSync(join(project, 'notes.txt'), 'utf8')).toBe('the answer is 42\n');
  });
});
