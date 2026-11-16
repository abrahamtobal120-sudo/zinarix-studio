import { describe, expect, it } from 'vitest';
import type { ChatMode } from '../src/shared/agentModes';
import { CHAT_MODES } from '../src/shared/agentModes';
import {
  alwaysAsks,
  decide,
  isGitPush,
  type Decision,
  type PolicyContext,
} from '../src/shared/approvalPolicy';
import { protectedWrite } from '../src/main/guard';
import { isWriteSql } from '../src/main/system';

const ctx: PolicyContext = {
  readOnly: new Set(['read_file', 'search', 'list_dir', 'vercel_logs', 'supabase_tables']),
  isProtected: (p) => protectedWrite(p) !== null,
  isWriteSql,
};

type Row = [tool: string, args: Record<string, unknown>, expected: Record<ChatMode, Decision>];
const row = (ask: Decision, plan: Decision, agent: Decision, auto: Decision, full: Decision) => ({
  ask,
  plan,
  agent,
  auto,
  full,
});

/** Every mode × every kind of tool. */
const TABLE: Row[] = [
  ['read_file', { path: 'src/a.ts' }, row('deny', 'auto', 'auto', 'auto', 'auto')],
  ['search', { query: 'x' }, row('deny', 'auto', 'auto', 'auto', 'auto')],
  ['todo_write', { todos: [] }, row('deny', 'auto', 'auto', 'auto', 'auto')],
  ['ask_user', { question: '?', options: ['a', 'b'] }, row('deny', 'auto', 'auto', 'auto', 'auto')],
  ['edit_file', { path: 'src/a.ts' }, row('deny', 'deny', 'ask', 'auto', 'auto')],
  ['write_file', { path: 'src/new.ts' }, row('deny', 'deny', 'ask', 'auto', 'auto')],
  // Protected files ask even with auto-approve.
  ['write_file', { path: 'AGENTS.md' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['edit_file', { path: '.env' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['edit_file', { path: 'package.json' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  // Full access runs commands on its own; auto-approve outside a sandbox does not.
  ['run_command', { command: 'pnpm test' }, row('deny', 'deny', 'ask', 'ask', 'auto')],
  ['run_command', { command: 'net user', admin: true }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['run_command', { command: 'git push origin main' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['mail_send', { to: 'a@b.c', subject: 's', text: 't' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['mail_save_draft', { to: 'a@b.c' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['vercel_logs', { deployment: 'd' }, row('deny', 'auto', 'auto', 'auto', 'auto')],
  ['vercel_redeploy', { deployment: 'd' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['vercel_promote', { project: 'p', deployment: 'd' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['vercel_set_env', { key: 'K', value: 'v' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['vercel_cancel', { deployment: 'd' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['supabase_tables', { ref: 'r' }, row('deny', 'auto', 'auto', 'auto', 'auto')],
  ['supabase_query', { sql: 'select 1' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['supabase_query', { sql: 'delete from users' }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['browser_open', { url: 'example.com' }, row('deny', 'ask', 'ask', 'ask', 'ask')],
  ['browser_click', { ref: 1 }, row('deny', 'deny', 'ask', 'ask', 'ask')],
  ['delegate_to_ai', { model: 'm', task: 't' }, row('deny', 'ask', 'ask', 'ask', 'ask')],
  ['mcp__fs__write', {}, row('deny', 'deny', 'ask', 'ask', 'ask')],
];

describe('decide: the full table', () => {
  for (const [tool, args, expected] of TABLE)
    for (const mode of CHAT_MODES)
      it(`${mode} · ${tool} ${JSON.stringify(args)} → ${expected[mode]}`, () => {
        expect(decide(mode, tool, args, ctx)).toBe(expected[mode]);
      });

  it('lets a read-only MCP tool through plan mode (still asked)', () => {
    expect(decide('plan', 'mcp__fs__read', {}, { ...ctx, mcpReadOnly: true })).toBe('ask');
    expect(decide('plan', 'mcp__fs__read', {}, { ...ctx, mcpReadOnly: false })).toBe('deny');
  });

  it('full access: what leaves the machine still asks, and protected files too', () => {
    for (const tool of ['mail_send', 'vercel_redeploy', 'vercel_set_env', 'browser_click'])
      expect(decide('full', tool, {}, ctx)).toBe('ask');
    expect(decide('full', 'run_command', { command: 'git -C x push' }, ctx)).toBe('ask');
    expect(decide('full', 'supabase_query', { sql: 'drop table t' }, ctx)).toBe('ask');
    expect(decide('full', 'edit_file', { path: '.env' }, ctx)).toBe('ask');
    expect(decide('full', 'edit_file', { path: 'src/a.ts' })).toBe('ask');
  });

  it('is conservative without context: no auto-approved edits, every SQL is a write', () => {
    expect(decide('auto', 'edit_file', { path: 'src/a.ts' })).toBe('ask');
    expect(decide('agent', 'read_file', { path: 'a' })).toBe('ask');
    expect(alwaysAsks('supabase_query', { sql: 'select 1' })).toBe(true);
  });
});

describe('alwaysAsks: never takes an "Always" answer', () => {
  it.each([
    ['mail_send', {}, true],
    ['mail_save_draft', {}, false],
    ['run_command', { command: 'git push' }, true],
    ['run_command', { command: 'git status' }, false],
    ['vercel_redeploy', {}, true],
    ['vercel_some_new_tool', {}, true],
    ['vercel_deployments', {}, false],
    ['supabase_query', { sql: 'update t set a = 1' }, true],
    ['supabase_query', { sql: 'select * from t' }, false],
    ['edit_file', { path: 'a.ts' }, false],
  ] as const)('%s %j → %s', (tool, args, expected) => {
    expect(alwaysAsks(tool, args, ctx)).toBe(expected);
  });
});

describe('isGitPush', () => {
  it.each([
    'git push',
    'git push --force origin main',
    'cd repo && git push',
    'git -C ../repo push',
    'git -c user.name=x push origin',
    'pnpm test; git push',
    '/usr/bin/git push',
    'C:\\Git\\bin\\git.exe push',
    'echo $(git push)',
  ])('finds %s', (c) => expect(isGitPush(c)).toBe(true));

  it.each(['git status', 'git log --oneline', 'echo push', 'git commit -m push', 'gitpush', ''])(
    'ignores %s',
    (c) => expect(isGitPush(c)).toBe(false),
  );
});
