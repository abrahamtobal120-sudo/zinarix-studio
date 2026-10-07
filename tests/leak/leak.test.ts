/**
 * Canary test (Phase 1 acceptance): plant a fake API key, drive the real CLI end to end
 * against a hostile mock provider that echoes credentials back in model lists, streamed
 * text and error bodies, then scan every byte the app produced — stdout, stderr, logs,
 * SQLite, config — for the key or any recognizable slice of it.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, mockServer, sse } from '../helpers/mock-server.js';

const CLI = fileURLToPath(new URL('../../apps/cli/dist/index.js', import.meta.url));
const CANARY = `sk-proj-CANARY${randomBytes(16).toString('hex')}`;
const ENV_CANARY = `envkey-CANARY${randomBytes(12).toString('hex')}`;
const hasCli = existsSync(CLI);

let home: string;
let server: Awaited<ReturnType<typeof mockServer>>;
let mode: 'ok' | 'unauthorized' = 'ok';
const transcript: string[] = [];

function run(
  args: string[],
  opts: { input?: string; env?: Record<string, string> } = {},
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
        ...opts.env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => {
      transcript.push(`$ omni ${args.join(' ')}\n${stdout}\n${stderr}`);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(opts.input ?? '');
  });
}

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? allFiles(p) : [p];
  });
}

/** The key itself, plus the distinctive middle that would survive partial echoes. */
function needles(key: string): string[] {
  return [key, key.slice(8, 28), Buffer.from(key).toString('base64')];
}

describe.skipIf(!hasCli)('API keys never leak (canary)', () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'omni-leak-'));
    server = await mockServer((req, res) => {
      const auth = String(req.headers.authorization ?? '');
      if (mode === 'unauthorized')
        return json(res, 401, { error: { message: `Invalid key: ${auth} (${req.url})` } });
      if (req.url.startsWith('/models'))
        return json(res, 200, { data: [{ id: 'echo', description: `served for ${auth}` }] });
      sse(res, [
        { data: { choices: [{ delta: { content: `Your header was ${auth}. ` } }] } },
        {
          data: {
            choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 4 },
          },
        },
        '[DONE]',
      ]);
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  it('runs the full CLI flow without exposing the key anywhere', async () => {
    expect(
      (
        await run([
          'providers',
          'add-custom',
          '--id',
          'leak',
          '--base-url',
          `${server.url}/v1`.replace('/v1', ''),
        ])
      ).code,
    ).toBe(0);
    const add = await run(['auth', 'add', 'leak', '--key-stdin', '--file-vault'], {
      input: CANARY,
    });
    expect(add.code).toBe(0);
    expect((await run(['auth', 'list'])).stdout).toContain('sk-…');
    await run(['auth', 'list', '--json']);
    await run(['models', '-p', 'leak', '--refresh']);
    await run(['models', '-p', 'leak', '--json']);
    await run(['use', 'leak/echo']);
    const ask = await run(['ask', 'hola'], { env: { OMNI_DEBUG: '1' } });
    expect(ask.code).toBe(0);
    expect(ask.stdout).toContain('[REDACTADO]');
    await run(['ask', '--json', 'hola']);
    await run(['ask', '-f', join(home, 'config.json'), 'resume'], {
      input: `stdin with ${CANARY}`,
    });
    await run(['history', 'list']);
    await run(['usage', '--json']);

    mode = 'unauthorized';
    const denied = await run(['ask', 'hola'], { env: { OMNI_DEBUG: '1' } });
    expect(denied.code).toBe(3);
    await run(['auth', 'test', 'leak']);
    mode = 'ok';

    // Same flow with the key supplied via environment variable (CI path).
    await run(['providers', 'add-custom', '--id', 'envleak', '--base-url', server.url]);
    await run(['auth', 'add', 'envleak', '--no-test'], {
      input: '',
      env: { OMNI_KEY_ENVLEAK: ENV_CANARY },
    }).catch(() => undefined);
    await run(['ask', '-m', 'envleak/echo', 'hola'], {
      env: { OMNI_KEY_ENVLEAK: ENV_CANARY, OMNI_DEBUG: '1' },
    });

    const everything = [
      ...transcript,
      ...allFiles(home)
        .filter((f) => !f.endsWith('vault.enc'))
        .map((f) => readFileSync(f).toString('latin1')),
    ].join('\n');

    // Sanity: the server really did receive the key, so the scan is meaningful.
    expect(server.requests.some((r) => String(r.headers.authorization).includes(CANARY))).toBe(
      true,
    );
    expect(server.requests.some((r) => String(r.headers.authorization).includes(ENV_CANARY))).toBe(
      true,
    );
    for (const n of [...needles(CANARY), ...needles(ENV_CANARY)])
      expect(everything).not.toContain(n);
    // The vault exists and is encrypted.
    expect(readFileSync(join(home, 'vault.enc'), 'utf8')).not.toContain('CANARY');
  }, 60_000);
});
