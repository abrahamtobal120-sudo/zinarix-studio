import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CatalogEntry, ChatChunk, ChatRequest, CliProfile } from '@omni/shared';
import { CliStreamParser, cliDeniedHint, cliMode, cliPrompt, getAdapter } from '@omni/providers';
import type { ProviderConfig } from '@omni/providers';

const dir = mkdtempSync(join(tmpdir(), 'omni-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function entry(profile: CliProfile): CatalogEntry {
  return {
    id: `${profile}-cli`,
    name: profile,
    adapter: 'cli-agent',
    baseUrl: 'https://example.com',
    baseUrlParams: [],
    auth: { type: 'none' },
    envVars: [],
    region: 'global',
    category: 'cli',
    modelsEndpoint: null,
    supports: {
      listModels: true,
      streaming: true,
      tools: false,
      vision: false,
      jsonMode: false,
      embeddings: false,
      fim: false,
    },
    fallbackModels: [{ id: 'default' }],
    cli: { profile, command: profile },
    status: 'active',
    verifiedAt: null,
  };
}

/** A fake CLI: records its argv, stdin and cwd, then prints `lines`. */
function fakeCli(name: string, lines: string[], exitCode = 0): string {
  const file = join(dir, name);
  writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(file + '.call.json')}, JSON.stringify({ argv: process.argv.slice(2), input, cwd: process.cwd() }));
  for (const l of ${JSON.stringify(lines)}) process.stdout.write(l + '\\n');
  process.exit(${exitCode});
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

function cfg(
  profile: CliProfile,
  command: string,
  params: Record<string, string> = {},
): ProviderConfig {
  return { entry: entry(profile), baseUrl: 'https://example.com', params: { command, ...params } };
}

async function collect(c: ProviderConfig, req: ChatRequest): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const ch of getAdapter('cli-agent').chat(c, req, new AbortController().signal))
    out.push(ch);
  return out;
}

const text = (chunks: ChatChunk[]) =>
  chunks.map((c) => (c.type === 'text' ? c.delta : '')).join('');

describe('cliPrompt', () => {
  it('sends the last message alone, or with earlier turns as history; drops system prompts', () => {
    expect(
      cliPrompt([
        { role: 'system', content: 'S' },
        { role: 'user', content: 'hola' },
      ]),
    ).toBe('hola');
    const p = cliPrompt([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'uno' },
      { role: 'assistant', content: 'dos' },
      { role: 'user', content: 'tres' },
    ]);
    expect(p).toContain(
      '<conversation-history>\nUser:\nuno\n\nAssistant:\ndos\n</conversation-history>',
    );
    expect(p.endsWith('tres')).toBe(true);
    expect(p).not.toContain('S\n');
  });
});

describe('cliMode', () => {
  const c = cfg('claude', 'x', { mode: 'full' });
  it('chat only answers; agent mode uses the configured level inside a folder', () => {
    expect(cliMode(c, { model: 'm', messages: [], cwd: '/p' })).toBe('read');
    expect(
      cliMode(c, {
        model: 'm',
        messages: [],
        tools: [{ name: 't', description: '', parameters: {} }],
      }),
    ).toBe('read');
    expect(
      cliMode(c, {
        model: 'm',
        messages: [],
        tools: [{ name: 't', description: '', parameters: {} }],
        cwd: '/p',
      }),
    ).toBe('full');
    expect(
      cliMode(cfg('claude', 'x'), {
        model: 'm',
        messages: [],
        tools: [{ name: 't', description: '', parameters: {} }],
        cwd: '/p',
      }),
    ).toBe('edit');
  });
});

describe('cliDeniedHint', () => {
  const base = { model: 'm', messages: [{ role: 'user' as const, content: 'x' }] };
  const tools = [{ name: 't', description: '', parameters: {} }];
  const cfgWith = (mode?: string) =>
    ({ params: mode ? { mode } : {} }) as unknown as ProviderConfig;
  it('points at the Agent switch, the folder or the provider mode', () => {
    expect(cliDeniedHint(cfgWith(), base as ChatRequest)).toContain('**Agente**');
    expect(cliDeniedHint(cfgWith(), { ...base, tools } as ChatRequest)).toContain('carpeta');
    expect(cliDeniedHint(cfgWith('read'), { ...base, tools, cwd: '/p' } as ChatRequest)).toContain(
      '**edit**',
    );
    expect(cliDeniedHint(cfgWith(), { ...base, tools, cwd: '/p' } as ChatRequest)).toContain(
      '**full**',
    );
  });
});

describe('CliStreamParser', () => {
  it('reads Claude Code stream-json (partial deltas, tools, usage)', () => {
    const p = new CliStreamParser();
    const out = [
      { type: 'system', subtype: 'init' },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Voy a leer.' } },
      },
      {
        type: 'assistant',
        message: {
          model: 'claude',
          content: [
            { type: 'text', text: 'Voy a leer.' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
          ],
        },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Listo' } },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Voy a leer.Listo',
        usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 3 },
      },
    ].flatMap((e) => p.push(JSON.stringify(e)));
    out.push(...p.finish());
    expect(text(out)).toBe('Voy a leer.\n\nListo');
    expect(out).toContainEqual({ type: 'reasoning', delta: '▸ Read a.ts\n' });
    expect(out).toContainEqual({
      type: 'usage',
      inputTokens: 15,
      outputTokens: 3,
      cachedTokens: 5,
    });
    expect(out.some((c) => c.type === 'tool_call')).toBe(false);
  });

  it('turns a Claude Code error result (expired login) into an error, not answer text', () => {
    const p = new CliStreamParser();
    const out = [
      {
        type: 'assistant',
        message: {
          model: '<synthetic>',
          content: [{ type: 'text', text: 'Failed to authenticate' }],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'Failed to authenticate: OAuth session expired',
      },
    ].flatMap((e) => p.push(JSON.stringify(e)));
    expect(text(out)).toBe('');
    expect(p.error).toContain('OAuth');
  });

  it('tells the user which tools Claude Code was not allowed to use', () => {
    const p = new CliStreamParser();
    const out = [
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'No pude.' } },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'No pude.',
        permission_denials: [
          { tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'wmctrl -l' } },
        ],
      },
    ].flatMap((e) => p.push(JSON.stringify(e)));
    out.push(...p.finish());
    expect(text(out)).toContain('Bash (wmctrl -l)');
    expect(text(out)).toContain('**full**');
    expect(p.error).toBeUndefined();
  });

  it('reads Codex exec --json', () => {
    const p = new CliStreamParser();
    const out = [
      { type: 'thread.started', thread_id: 't' },
      { type: 'item.completed', item: { type: 'reasoning', text: 'pensando' } },
      { type: 'item.started', item: { type: 'command_execution', command: 'ls' } },
      {
        type: 'item.completed',
        item: { type: 'file_change', changes: [{ path: 'a.ts', kind: 'update' }] },
      },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Hecho.' } },
      {
        type: 'turn.completed',
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 },
      },
    ].flatMap((e) => p.push(JSON.stringify(e)));
    out.push(...p.finish());
    expect(text(out)).toBe('Hecho.');
    expect(out).toContainEqual({ type: 'reasoning', delta: '▸ $ ls\n' });
    expect(out).toContainEqual({ type: 'reasoning', delta: '▸ editar a.ts\n' });
    expect(out).toContainEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 7,
      cachedTokens: 40,
    });
  });

  it('reads Gemini CLI stream-json', () => {
    const p = new CliStreamParser();
    const out = [
      { type: 'init', model: 'gemini-2.5-pro' },
      { type: 'message', role: 'user', content: 'hola' },
      { type: 'message', role: 'assistant', content: 'Ho', delta: true },
      { type: 'message', role: 'assistant', content: 'la', delta: true },
      { type: 'tool_use', tool_name: 'read_file', parameters: { path: 'x' } },
      { type: 'result', status: 'success', stats: { input_tokens: 9, output_tokens: 2 } },
    ].flatMap((e) => p.push(JSON.stringify(e)));
    out.push(...p.finish());
    expect(text(out)).toBe('Hola');
    expect(out).toContainEqual({ type: 'usage', inputTokens: 9, outputTokens: 2 });
  });

  it('falls back to plain output when the CLI printed no JSON', () => {
    const p = new CliStreamParser();
    p.push('respuesta simple');
    expect(text(p.finish())).toBe('respuesta simple');
  });
});

describe('cli-agent adapter (fake CLI processes)', () => {
  it('runs Claude Code with the prompt on stdin, in the project folder, with edit permission in agent mode', async () => {
    const bin = fakeCli('claude', [
      JSON.stringify({
        type: 'assistant',
        message: { model: 'x', content: [{ type: 'text', text: 'hola desde claude' }] },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    ]);
    const out = await collect(cfg('claude', bin), {
      model: 'sonnet',
      messages: [{ role: 'user', content: 'di hola' }],
      tools: [{ name: 'read_file', description: '', parameters: {} }],
      cwd: dir,
    });
    expect(text(out)).toBe('hola desde claude');
    expect(out.at(-1)).toEqual({ type: 'done', stopReason: 'stop' });
    const call = JSON.parse(
      await import('node:fs').then((fs) => fs.readFileSync(bin + '.call.json', 'utf8')),
    );
    expect(call.input).toBe('di hola');
    expect(call.argv).toEqual(
      expect.arrayContaining(['-p', '--model', 'sonnet', '--permission-mode', 'acceptEdits']),
    );
    expect(call.cwd).toBe(dir);
  });

  it('"default" model passes no model flag; chat mode is read-only (Codex sandbox)', async () => {
    const bin = fakeCli('codex', [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }),
    ]);
    const out = await collect(cfg('codex', bin), {
      model: 'default',
      messages: [{ role: 'user', content: 'x' }],
      cwd: dir,
    });
    expect(text(out)).toBe('ok');
    const call = JSON.parse(
      await import('node:fs').then((fs) => fs.readFileSync(bin + '.call.json', 'utf8')),
    );
    expect(call.argv).not.toContain('-m');
    expect(call.argv).toEqual(
      expect.arrayContaining(['exec', '--json', '--sandbox', 'read-only', '-']),
    );
  });

  it('reports a failed login as an auth error with how to sign in', async () => {
    const bin = fakeCli(
      'claude2',
      [
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Failed to authenticate: OAuth session expired',
        }),
      ],
      1,
    );
    await expect(
      collect(cfg('claude', bin), { model: 'default', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({
      code: 'auth',
      message: expect.stringContaining('/login'),
    });
  });

  it('a missing CLI is a config error with install instructions', async () => {
    await expect(
      collect(cfg('gemini', join(dir, 'no-such-cli')), {
        model: 'default',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toMatchObject({
      code: 'config',
      message: expect.stringContaining('@google/gemini-cli'),
    });
    const t = await getAdapter('cli-agent').testConnection(cfg('gemini', join(dir, 'no-such-cli')));
    expect(t.ok).toBe(false);
  });

  it('rejects model names that are not plain identifiers', async () => {
    const bin = fakeCli('claude3', []);
    await expect(
      collect(cfg('claude', bin), {
        model: 'x; rm -rf /',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });
});
