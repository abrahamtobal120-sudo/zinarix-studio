import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionFailureExitCode } from '../src/commands/auth.js';
import { isSensitiveHeader, parseHeaderLines, splitKeyHeader } from '../src/commands/providers.js';
import { json, mockServer } from '../../../tests/helpers/mock-server.js';

describe('auth test exit codes', () => {
  it('returns 3 only when the provider rejected the key', () => {
    expect(connectionFailureExitCode({ error: 'HTTP 401: invalid key' })).toBe(3);
    expect(connectionFailureExitCode({ error: 'HTTP 403: forbidden' })).toBe(3);
    expect(connectionFailureExitCode({ code: 'auth' })).toBe(3);
  });

  it('separates rate limits and network / server / unverifiable failures', () => {
    expect(connectionFailureExitCode({ error: 'HTTP 429: slow down' })).toBe(4);
    expect(connectionFailureExitCode({ error: 'connect ECONNREFUSED 127.0.0.1:1' })).toBe(1);
    expect(connectionFailureExitCode({ error: 'HTTP 502: bad gateway' })).toBe(1);
    expect(connectionFailureExitCode({ code: 'network', error: 'HTTP 401: x' })).toBe(1);
    expect(connectionFailureExitCode({ unverified: true, error: 'cannot verify' })).toBe(1);
  });
});

describe('custom provider headers', () => {
  it('recognizes credential headers', () => {
    for (const h of ['Authorization', 'x-api-key', 'api-key', 'X-Auth-Token', 'Cookie', 'x-key'])
      expect(isSensitiveHeader(h)).toBe(true);
    for (const h of ['X-Org', 'anthropic-version', 'x-keyboard'])
      expect(isSensitiveHeader(h)).toBe(false);
  });

  it('parses header lines from stdin', () => {
    expect(parseHeaderLines('# comment\nx-api-key: abc\n\nX-Org=o=1\r\n')).toEqual({
      'x-api-key': 'abc',
      'X-Org': 'o=1',
    });
    expect(() => parseHeaderLines('nonsense')).toThrow(/Name: value/);
  });

  it('moves the key header out of the plain-text headers', () => {
    expect(splitKeyHeader({ 'x-api-key': 'abc', 'X-Org': 'o' })).toEqual({
      auth: { type: 'header', header: 'x-api-key' },
      key: 'abc',
      rest: { 'X-Org': 'o' },
    });
    expect(splitKeyHeader({ Authorization: 'Bearer tok' })).toEqual({
      auth: { type: 'bearer', header: 'Authorization' },
      key: 'tok',
      rest: {},
    });
    // Ambiguous: two credential headers and no --auth-header -> nothing is moved.
    const two = { 'x-api-key': 'a', 'x-token': 'b' };
    expect(splitKeyHeader(two)).toEqual({
      auth: { type: 'bearer', header: 'Authorization' },
      rest: two,
    });
    expect(splitKeyHeader(two, 'X-Token')).toMatchObject({ key: 'b', rest: { 'x-api-key': 'a' } });
    // --auth-header without a value: the key is added later with `omni auth add`.
    expect(splitKeyHeader({}, 'api-key')).toEqual({
      auth: { type: 'header', header: 'api-key' },
      rest: {},
    });
  });
});

// End to end against the built CLI (skipped when apps/cli/dist has not been built).
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const SECRET = 'hdr-SECRET-0123456789abcdef';

describe.skipIf(!existsSync(CLI))('omni CLI end to end', () => {
  let home: string;
  let server: Awaited<ReturnType<typeof mockServer>>;

  function run(
    args: string[],
    input = '',
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], {
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
      child.stdin.end(input);
    });
  }
  const config = () => {
    const p = join(home, 'config.json');
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'omni-cli-'));
    server = await mockServer((_req, res) => json(res, 401, { error: { message: 'bad key' } }));
  });
  afterAll(async () => {
    await server?.close();
  });

  it('reports the version from package.json', async () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string };
    expect((await run(['--version'])).stdout.trim()).toBe(pkg.version);
  });

  it('auth add does not register the provider when no key was given', async () => {
    const r = await run(['auth', 'add', 'openai', '--no-test']);
    expect(r.code).toBe(2);
    expect(config()).not.toContain('"openai"');
  });

  it('keeps header secrets out of config.json and argv', async () => {
    const add = await run(
      ['providers', 'add-custom', '--id', 'hdr', '--base-url', server.url, '--header-stdin'],
      `x-api-key: ${SECRET}\nX-Org: acme\n`,
    );
    expect(add.code).toBe(0);
    expect(config()).toContain('acme');
    expect(config()).not.toContain(SECRET);

    // The key is sent from the vault, and a 401 is "invalid key" (3).
    const test = await run(['auth', 'test', 'hdr']);
    expect(test.code).toBe(3);
    expect(server.requests.at(-1)?.headers['x-api-key']).toBe(SECRET);
    expect(server.requests.at(-1)?.headers['x-org']).toBe('acme');

    // Every model failing makes compare exit non-zero.
    const cmp = await run(['compare', 'hola', '-m', 'hdr/a', '-m', 'hdr/b']);
    expect(cmp.code).toBe(3);
  });

  it('warns about secrets passed on the command line', async () => {
    const r = await run([
      'providers',
      'add-custom',
      '--id',
      'argv',
      '--base-url',
      server.url,
      '--header',
      `x-api-key=${SECRET}`,
    ]);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/historial del shell/);
    expect(config()).not.toContain(SECRET);
  });

  it('auth test returns 1 (not 3) when the provider is unreachable', async () => {
    const down = await mockServer(() => undefined);
    const url = down.url;
    await down.close();
    await run(['providers', 'add-custom', '--id', 'down', '--base-url', url, '--no-auth']);
    const r = await run(['auth', 'test', 'down']);
    expect(r.code).toBe(1);
  });
});
