import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LineDecoder,
  McpManager,
  SseDecoder,
  parseMcpConfig,
  resultText,
  sanitizeName,
  secretValues,
  toolName,
} from '../src/main/mcp.js';

const server = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));

describe('parseMcpConfig', () => {
  it('reads stdio and http servers in the Cursor format', () => {
    const r = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          fs: { command: 'npx', args: ['-y', 'x', 3], env: { A: '1', B: 2 } },
          remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer abc' } },
          off: { command: 'x', disabled: true },
        },
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.servers.fs).toEqual({ command: 'npx', args: ['-y', 'x'], env: { A: '1' } });
    expect(r.servers.remote).toMatchObject({ url: 'https://example.com/mcp' });
    expect(r.servers.off).toMatchObject({ disabled: true });
  });

  it('reports bad entries and bad JSON', () => {
    expect(parseMcpConfig('{').errors[0]).toMatch(/JSON/);
    const r = parseMcpConfig(
      JSON.stringify({
        mcpServers: { 'bad name!': { command: 'x' }, a: {}, b: { url: 'file:///x' } },
      }),
    );
    expect(Object.keys(r.servers)).toEqual([]);
    expect(r.errors).toHaveLength(3);
    expect(parseMcpConfig('').errors).toEqual([]);
  });
});

describe('tool names', () => {
  it('sanitizes and keeps names unique and at most 64 characters', () => {
    expect(sanitizeName('my server.v2')).toBe('my_server_v2');
    const taken = new Set<string>();
    expect(toolName('github', 'create_issue', taken)).toBe('mcp__github__create_issue');
    expect(toolName('github', 'create_issue', taken)).not.toBe('mcp__github__create_issue');
    const long = toolName('s'.repeat(40), 't'.repeat(60), taken);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe('framing', () => {
  it('splits newline-delimited JSON across chunks and skips noise', () => {
    const d = new LineDecoder();
    expect(d.push('{"jsonrpc":"2.0","id":1,')).toEqual([]);
    const out = d.push('"result":{}}\nlog line\n{"jsonrpc":"2.0","method":"x"}\n');
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe(1);
  });

  it('parses SSE events split across chunks', () => {
    const d = new SseDecoder();
    expect(d.push('event: message\r\ndata: {"jsonrpc":"2.0",')).toEqual([]);
    const out = d.push('\ndata: "id":2,"result":{"ok":true}}\n\n: comment\n\n');
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(2);
  });
});

describe('results and secrets', () => {
  it('turns content into text', () => {
    const r = resultText({
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', data: 'x', mimeType: 'image/png' },
        { type: 'resource', resource: { uri: 'a://b', text: 'body' } },
      ],
      isError: true,
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('hi');
    expect(r.text).toContain('[image image/png]');
    expect(r.text).toContain('body');
    expect(resultText({ structuredContent: { a: 1 } }).text).toContain('"a": 1');
  });

  it('finds credential values', () => {
    expect(
      secretValues({ command: 'x', env: { GITHUB_TOKEN: 'ghp_1234567890', PATH: '/usr/bin/xx' } }),
    ).toEqual(['ghp_1234567890']);
    expect(
      secretValues({ url: 'https://x', headers: { Authorization: 'Bearer abcdefghij' } }),
    ).toContain('abcdefghij');
  });
});

describe('McpManager with a stdio server', () => {
  it('connects, lists and calls tools, and needs trust for project files', async () => {
    const m = new McpManager(mkdtempSync(join(tmpdir(), 'zx-mcp-')));
    m.saveGlobal(
      JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [server] } } }),
    );
    try {
      const tools = await m.tools(undefined);
      expect(tools.map((t) => t.name).sort()).toEqual(['mcp__echo__echo', 'mcp__echo__wipe_all']);
      expect(m.binding('mcp__echo__wipe_all')?.tool.annotations?.destructiveHint).toBe(true);
      const r = await m.call('mcp__echo__echo', { text: 'hola' });
      expect(r.text).toContain('echo: hola');
      expect(r.text).toContain('[image image/png]');
      expect(m.status()[0]).toMatchObject({ name: 'echo', state: 'connected' });

      // A project file is ignored until trusted, and again after it changes.
      const root = mkdtempSync(join(tmpdir(), 'zx-proj-'));
      mkdirSync(join(root, '.cursor'));
      const file = join(root, '.cursor', 'mcp.json');
      writeFileSync(
        file,
        JSON.stringify({ mcpServers: { p: { command: process.execPath, args: [server] } } }),
      );
      expect((await m.tools(root)).some((t) => t.name.startsWith('mcp__p__'))).toBe(false);
      expect(m.project(root)).toMatchObject({ trusted: false });
      m.trustProject(root, true);
      expect((await m.tools(root)).some((t) => t.name === 'mcp__p__echo')).toBe(true);
      writeFileSync(file, JSON.stringify({ mcpServers: { p: { command: 'evil' } } }));
      expect(m.project(root)).toMatchObject({ trusted: false });
      expect((await m.tools(root)).some((t) => t.name.startsWith('mcp__p__'))).toBe(false);

      m.setEnabled('echo', false);
      expect(m.status(root).find((s) => s.name === 'echo')).toMatchObject({
        state: 'off',
        disabled: true,
      });
    } finally {
      m.shutdown();
    }
  });

  it('reports a server that cannot start', async () => {
    const m = new McpManager(mkdtempSync(join(tmpdir(), 'zx-mcp-')));
    m.saveGlobal(
      JSON.stringify({ mcpServers: { bad: { command: 'definitely-not-a-command-zx' } } }),
    );
    try {
      expect(await m.tools(undefined)).toEqual([]);
      expect(m.status()[0]!.state).toBe('error');
    } finally {
      m.shutdown();
    }
  });
});
