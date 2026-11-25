import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LspHost } from '../src/main/lsp.js';
import { diagnosticsNote, formatDiagnostics, languageOfPath } from '../src/main/lspCheck.js';

/** A4: after an edit the agent hears what the language server says about the file. */

describe('diagnostics as text for the model', () => {
  it('knows the language of a path only when a server exists for it', () => {
    expect(languageOfPath('src/app.py')).toBe('python');
    expect(languageOfPath('cmd/main.GO')).toBe('go');
    expect(languageOfPath('Dockerfile')).toBe('dockerfile');
    expect(languageOfPath('docker/Dockerfile.dev')).toBe('dockerfile');
    expect(languageOfPath('notes.txt')).toBeUndefined();
    expect(languageOfPath('.gitignore')).toBeUndefined();
  });

  it('lists errors first, then warnings, and drops hints', () => {
    const at = (line: number, character: number) => ({ start: { line, character } });
    const text = formatDiagnostics('a.py', [
      { severity: 2, message: 'unused', range: at(9, 0) },
      { severity: 4, message: 'hint', range: at(0, 0) },
      { severity: 1, message: 'undefined\n  name "x"', code: 'E0602', range: at(2, 4) },
      { message: 'no severity counts as an error', range: at(1, 0) },
    ]);
    expect(text.split('\n')).toEqual([
      'a.py:2:1: error: no severity counts as an error',
      'a.py:3:5: error: undefined name "x" [E0602]',
      'a.py:10:1: warning: unused',
    ]);
    expect(formatDiagnostics('a.py', [{ severity: 3, message: 'info' }])).toBe('');
  });

  it('caps a long list', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ severity: 1, message: `e${i}` }));
    const lines = formatDiagnostics('a.py', many).split('\n');
    expect(lines).toHaveLength(16);
    expect(lines[15]).toBe('… and 25 more');
  });

  it('adds nothing to the tool result when the answer is not known', () => {
    expect(diagnosticsNote(null)).toBe('');
    expect(diagnosticsNote('')).toContain('no errors');
    expect(diagnosticsNote('a.py:1:1: error: x')).toContain('a.py:1:1: error: x');
  });
});

describe('LspHost.check with a real server process', () => {
  const server = fileURLToPath(new URL('./fixtures/fake-lsp.mjs', import.meta.url));
  let root: string;
  let host: LspHost;
  const pushed: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zx-lsp-'));
    writeFileSync(join(root, 'a.py'), 'x = 1\n');
    pushed.length = 0;
    host = new LspHost(
      {
        diagnostics: (path) => pushed.push(path),
        status: () => undefined,
        applyEdit: () => Promise.resolve(false),
      },
      {
        enabled: () => true,
        commands: () => ({ python: `"${process.execPath}" "${server}"` }),
      },
    );
    host.setRoot(root);
  });
  afterEach(async () => {
    await host.dispose();
    // On Windows the folder stays locked until the server process (cwd = root) is gone.
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const ready = async () => {
    await host.open('a.py', 'python', 'x = 1\n');
    for (let i = 0; i < 200 && host.status('python')?.state !== 'ready'; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(host.status('python')?.state).toBe('ready');
    // The server's verdict on the first text has arrived before the edits start.
    await new Promise((r) => setTimeout(r, 200));
  };

  it('does not start a server just for the agent', async () => {
    expect(await host.check('a.py', 'x = BAD\n')).toBeNull();
    expect(host.status('python')).toBeNull();
  });

  it('reports the errors of an open file after the edit, and still tells the editor', async () => {
    await ready();
    expect(await host.check('a.py', 'x = 1\ny = BAD\n')).toBe('a.py:2:5: error: bad name [E1]');
    expect(pushed).toContain('a.py');
    // Fixed: the final verdict is "clean".
    expect(await host.check('a.py', 'x = 1\ny = 2\n')).toBe('');
    // Nothing changed: the server would stay silent, so there is nothing to wait for.
    expect(await host.check('a.py', 'x = 1\ny = 2\n')).toBeNull();
  });

  it('checks a file that is not open in the editor and closes it again', async () => {
    await ready();
    expect(await host.check('pkg/b.py', 'BAD = 1\n')).toBe('pkg/b.py:1:1: error: bad name [E1]');
    // Not left open: asking for it as a document finds nothing.
    expect(await host.request('pkg/b.py', 'textDocument/hover', {})).toBeNull();
  });

  it('knows nothing about files without a running server', async () => {
    await ready();
    expect(await host.check('notes.txt', 'BAD')).toBeNull();
    expect(await host.check('main.go', 'BAD')).toBeNull();
  });
});
