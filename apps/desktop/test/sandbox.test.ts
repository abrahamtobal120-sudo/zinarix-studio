import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import type { ChatEventView } from '../src/shared/api.js';
import { decide } from '../src/shared/approvalPolicy';
import {
  NO_SANDBOX,
  bwrapArgs,
  isSecretEnv,
  macProfile,
  sandboxComplete,
  sbplString,
  secretDirs,
  taskEnv,
  type SandboxCaps,
} from '../src/shared/sandbox';
import { detectSandbox, sandboxedSpawn } from '../src/main/sandbox';
import { Agent, type TaskScope } from '../src/main/agent.js';
import { Workspace } from '../src/main/workspace.js';

/** Fase 5B: the sandbox of background tasks and "Auto in the worktree". */

const FULL: SandboxCaps = { kind: 'bwrap', write: true, network: true };
const NO_NET: SandboxCaps = { kind: 'bwrap', write: true, network: false, reason: 'x' };
const READ_ONLY = new Set(['read_file']);

describe('decide with a sandbox', () => {
  const cmd = { command: 'pnpm test' };
  it('auto runs commands on its own only inside a complete sandbox', () => {
    expect(decide('auto', 'run_command', cmd, { sandbox: FULL })).toBe('auto');
    expect(decide('auto', 'run_command', cmd, { sandbox: NO_NET })).toBe('ask');
    expect(decide('auto', 'run_command', cmd, { sandbox: NO_SANDBOX })).toBe('ask');
    expect(decide('auto', 'run_command', cmd, {})).toBe('ask');
  });
  it('the other modes do not change with the sandbox', () => {
    expect(decide('agent', 'run_command', cmd, { sandbox: FULL })).toBe('ask');
    expect(decide('plan', 'run_command', cmd, { sandbox: FULL, readOnly: READ_ONLY })).toBe('deny');
    expect(decide('ask', 'run_command', cmd, { sandbox: FULL })).toBe('deny');
  });
  it('what leaves the machine still asks, even in a complete sandbox', () => {
    expect(decide('auto', 'run_command', { command: 'git push origin x' }, { sandbox: FULL })).toBe(
      'ask',
    );
    expect(decide('auto', 'mail_send', { to: 'a@b.c' }, { sandbox: FULL })).toBe('ask');
    expect(decide('auto', 'vercel_redeploy', {}, { sandbox: FULL })).toBe('ask');
    expect(decide('auto', 'supabase_query', { sql: 'delete from t' }, { sandbox: FULL })).toBe(
      'ask',
    );
  });
  it('admin is never automatic', () => {
    expect(decide('auto', 'run_command', { command: 'x', admin: true }, { sandbox: FULL })).toBe(
      'deny',
    );
  });
  it('sandboxComplete needs both protections', () => {
    expect(sandboxComplete(FULL)).toBe(true);
    expect(sandboxComplete(NO_NET)).toBe(false);
    expect(sandboxComplete({ ...FULL, kind: 'none' })).toBe(false);
    expect(sandboxComplete(undefined)).toBe(false);
  });
});

describe('taskEnv: no tokens or keys in a task command', () => {
  const base = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    PWD: '/w',
    LANG: 'es_MX.UTF-8',
    NODE_ENV: 'test',
    XDG_SESSION_TYPE: 'x11',
    GITHUB_TOKEN: 'ghp_1',
    GH_TOKEN: 'ghp_2',
    NPM_TOKEN: 'n',
    NODE_AUTH_TOKEN: 'n',
    OPENAI_API_KEY: 'sk',
    MY_SERVICE_APIKEY: 'k',
    AWS_SECRET_ACCESS_KEY: 's',
    AWS_ACCESS_KEY_ID: 'a',
    STRIPE_SECRET: 's',
    DB_PASSWORD: 'p',
    SSH_AUTH_SOCK: '/tmp/agent',
    GIT_ASKPASS: '/x',
    DATABASE_URL: 'postgres://u:p@h/d',
    OMNI_KEY_OPENAI: 'k',
    UNDEFINED: undefined,
  };
  it('removes credentials and keeps ordinary variables', () => {
    const env = taskEnv(base, { PORT: '4101' });
    expect(Object.keys(env).sort()).toEqual(
      ['HOME', 'LANG', 'NODE_ENV', 'PATH', 'PORT', 'PWD', 'XDG_SESSION_TYPE'].sort(),
    );
  });
  it('is case-insensitive', () => {
    expect(isSecretEnv('github_token')).toBe(true);
    expect(isSecretEnv('Path')).toBe(false);
    expect(isSecretEnv('KEYBOARD_LAYOUT')).toBe(false);
  });
});

describe('bubblewrap arguments', () => {
  const p = {
    root: '/data/worktrees/r/t1',
    tmp: '/tmp/zinarix-task-t1',
    hidden: ['/data', '/home/u/.ssh'],
  };
  const args = bwrapArgs(p);
  it('read-only system, no network, dies with the app', () => {
    expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(args).toContain('--unshare-net');
    expect(args).toContain('--die-with-parent');
  });
  it('hides the data folder and the keys, then gives the worktree back writable', () => {
    const hideData = args.indexOf('/data');
    const bindRoot = args.lastIndexOf(p.root);
    expect(args[hideData - 1]).toBe('--tmpfs');
    expect(args[args.indexOf('/home/u/.ssh') - 1]).toBe('--tmpfs');
    expect(args[bindRoot - 2]).toBe('--bind');
    expect(bindRoot).toBeGreaterThan(hideData);
  });
  it('secretDirs lists the usual key folders', () => {
    expect(secretDirs('/home/u')).toContain('/home/u/.ssh');
    expect(secretDirs('/home/u/')).toContain('/home/u/.aws');
  });
});

describe('sandbox-exec profile', () => {
  const p = { root: '/data/w/t "1"', tmp: '/tmp/t1', hidden: ['/data'] };
  const prof = macProfile(p);
  it('denies network and writes, then allows the worktree and temp', () => {
    expect(prof).toContain('(deny network*)');
    expect(prof.indexOf('(deny file-write*)')).toBeLessThan(prof.indexOf('(allow file-write*'));
    expect(prof).toContain(sbplString('/tmp/t1'));
  });
  it('escapes quotes and gives the worktree back after hiding the data folder', () => {
    expect(sbplString('a"b\\c')).toBe('"a\\"b\\\\c"');
    const last = prof.split('\n').at(-1)!;
    expect(last).toBe(`(allow file-read* file-write* (subpath ${sbplString(p.root)}))`);
  });
});

describe('detection', () => {
  it('Windows reports no sandbox, with a reason (never faked)', async () => {
    const c = await detectSandbox('win32');
    expect(c.kind).toBe('none');
    expect(sandboxComplete(c)).toBe(false);
    expect(c.reason).toMatch(/Windows/);
    expect(sandboxedSpawn(c, { root: 'C:\\w', tmp: 'C:\\t', hidden: [] }, 'x')).toBeUndefined();
  });
});

// The real thing, only where bubblewrap works (Linux CI with bwrap installed).
const bwrapWorks =
  process.platform === 'linux' &&
  spawnSync('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--', '/bin/true']).status === 0;

describe.skipIf(!bwrapWorks)('bubblewrap, for real', () => {
  it('no network, no writes outside the worktree, writes inside work', () => {
    const data = mkdtempSync(join(tmpdir(), 'zx-data-'));
    const root = join(data, 'worktrees', 't1');
    const tmp = mkdtempSync(join(tmpdir(), 'zx-ttmp-'));
    mkdirSync(root, { recursive: true });
    const other = join(data, 'tasks.json');
    writeFileSync(other, 'secret');
    const outside = join(homedir(), `zx-sandbox-probe-${process.pid}`);
    const sh = (c: string) => {
      const s = sandboxedSpawn(FULL, { root, tmp, hidden: [data] }, c)!;
      return spawnSync(s.file, s.args, { cwd: root, encoding: 'utf8' });
    };
    try {
      expect(sh('echo ok > inside.txt').status).toBe(0);
      expect(readFileSync(join(root, 'inside.txt'), 'utf8')).toBe('ok\n');
      expect(sh(`echo x > ${outside}`).status).not.toBe(0);
      expect(existsSync(outside)).toBe(false);
      expect(sh(`cat ${other}`).status).not.toBe(0);
      expect(sh('exec 3<>/dev/tcp/1.1.1.1/80 || exit 9').status).not.toBe(0);
    } finally {
      rmSync(data, { recursive: true, force: true });
      rmSync(tmp, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  });
});

/** A scripted model: each stream call plays the next step (an empty step ends the run). */
function fakeCore(steps: { name: string; args: Record<string, unknown> }[][]) {
  let step = 0;
  let n = 0;
  return {
    async *stream() {
      for (const c of steps[step++] ?? [])
        yield { type: 'tool_call', id: `c${++n}`, name: c.name, argsDelta: JSON.stringify(c.args) };
      yield { type: 'done', stopReason: 'stop' };
    },
  } as unknown as OmniCore;
}

describe('a task in "Auto in the worktree" (agent loop)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zx-box-'));
    // Not token-shaped, so redaction cannot hide a leak: only taskEnv can.
    process.env.GITHUB_TOKEN = 'zx-marker-123';
  });
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    rmSync(root, { recursive: true, force: true });
  });

  async function runTask(task: TaskScope, command: string) {
    const events: ChatEventView[] = [];
    const asked: string[] = [];
    const workspace = new Workspace(root);
    const agent = new Agent(
      fakeCore([[{ name: 'run_command', args: { command } }], []]),
      () => workspace,
    );
    agent.userKitRoot = null;
    await agent.run({
      conversationId: 'task',
      mode: 'auto',
      userMessage: { role: 'user', content: 'go' },
      fallbackHistory: [],
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      ask: (id) => {
        asked.push(id);
        return Promise.resolve('approve');
      },
      scope: { workspace: () => workspace, task },
    });
    const result = events.find((e) => e.type === 'tool_result');
    const output = events.map((e) => (e.type === 'tool_output' ? e.chunk : '')).join('');
    return { asked, result, output };
  }

  const printToken =
    process.platform === 'win32' ? 'echo "[$env:GITHUB_TOKEN]"' : 'echo "[$GITHUB_TOKEN]"';

  it('without a sandbox, every command asks, and it gets no tokens', async () => {
    const { asked, result, output } = await runTask({ root, sandbox: undefined }, printToken);
    expect(asked).toHaveLength(1);
    expect(result).toMatchObject({ ok: true });
    expect(output).toContain('[]');
    expect(output).not.toContain('zx-marker-123');
  });

  it('with an incomplete sandbox, it still asks', async () => {
    const { asked } = await runTask(
      { root, sandbox: { caps: NO_NET, paths: { root, tmp: root, hidden: [] } } },
      printToken,
    );
    expect(asked).toHaveLength(1);
  });

  it('with a complete sandbox, it runs without asking, and only confined', async () => {
    const { asked, result } = await runTask(
      { root, sandbox: { caps: FULL, paths: { root, tmp: root, hidden: [] } } },
      'echo confined',
    );
    expect(asked).toEqual([]);
    // Where bwrap is missing the confined start fails: it never falls back to running free.
    if (!bwrapWorks) expect(result).toMatchObject({ ok: false });
    else expect(result).toMatchObject({ ok: true });
  });
});
