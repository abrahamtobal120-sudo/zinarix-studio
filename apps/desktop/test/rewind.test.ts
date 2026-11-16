import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OmniCore } from '@omni/core';
import { Agent } from '../src/main/agent.js';
import { Workspace } from '../src/main/workspace.js';
import { hunks } from '../src/shared/checkpoints.js';

/** Fase 2: checkpoints per exchange, "rewind here" and the turn's diff review. */

type Call = { name: string; args: Record<string, unknown> };

/** A scripted model: each stream call plays the next step (an empty step ends the run). */
function fakeCore(home: string, steps: Call[][]): OmniCore {
  let step = 0;
  let n = 0;
  return {
    paths: { home },
    async *stream() {
      for (const c of steps[step++] ?? [])
        yield { type: 'tool_call', id: `c${++n}`, name: c.name, argsDelta: JSON.stringify(c.args) };
      yield { type: 'done', stopReason: 'stop' };
    },
  } as unknown as OmniCore;
}

let root: string;
let ws: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zx-rewind-'));
  ws = join(root, 'project');
  mkdirSync(join(ws, 'src'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ORIGINAL: Record<string, string> = {
  'a.ts': 'export const a = 1;\r\nexport const b = 2;\r\n',
  'src/b.ts': '﻿// bom\nconst x = 1;',
  'src/c.md': '# title\n\nbody\n',
  'd.json': '{\n  "k": true\n}\n',
};
const write = (path: string, content: string): Call => ({
  name: 'write_file',
  args: { path, content },
});
const editC = (path: string, old_string: string, new_string: string): Call => ({
  name: 'edit_file',
  args: { path, old_string, new_string },
});

function setup(steps: Call[][], fresh = true) {
  if (fresh) for (const [p, c] of Object.entries(ORIGINAL)) writeFileSync(join(ws, p), c);
  const workspace = new Workspace(ws);
  const agent = new Agent(fakeCore(join(root, 'omni'), steps), () => workspace);
  agent.userKitRoot = null;
  const turn = (id: string) =>
    agent.run({
      conversationId: 'conv',
      turn: id,
      userMessage: { role: 'user', content: id },
      fallbackHistory: [],
      signal: new AbortController().signal,
      emit: () => {},
      ask: () => Promise.resolve('approve'),
    });
  return { agent, turn };
}
const disk = () =>
  Object.fromEntries(
    [...Object.keys(ORIGINAL), 'src/new.ts'].map((p) => [
      p,
      existsSync(join(ws, p)) ? readFileSync(join(ws, p)).toString('base64') : null,
    ]),
  );

describe('rewind', () => {
  it('puts 5 files back byte for byte, and keeps earlier exchanges', async () => {
    const { agent, turn } = setup([
      [
        editC('a.ts', 'const a = 1', 'const a = 10'),
        write('src/b.ts', 'replaced'),
        editC('src/c.md', 'body', 'new body'),
        write('d.json', '{}'),
        write('src/new.ts', 'created\n'),
      ],
      [],
      [editC('a.ts', 'const b = 2', 'const b = 20'), write('src/new.ts', 'again\n')],
      [],
    ]);
    const before = disk();
    await turn('t1');
    const afterT1 = disk();
    await turn('t2');
    expect(disk()).not.toEqual(afterT1);

    // Rewinding the second exchange leaves the first one's work.
    expect((await agent.rewind('conv', ['t2'])).sort()).toEqual(['a.ts', 'src/new.ts']);
    expect(disk()).toEqual(afterT1);

    // Rewinding the first: every file exactly as before (CRLF, BOM, no final newline).
    expect(await agent.rewind('conv', ['t1'])).toHaveLength(5);
    expect(disk()).toEqual(before);
    expect(agent.changedFiles('conv')).toBe(0);
  });

  it('puts non-UTF-8 files (Latin-1, binary) back byte for byte', async () => {
    // "café" in Latin-1 (0xE9 is not valid UTF-8) and a few bytes that are not text at all.
    const latin1 = Buffer.from('const s = "café";\n', 'latin1');
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80, 0x0a]);
    writeFileSync(join(ws, 'latin.ts'), latin1);
    writeFileSync(join(ws, 'src/logo.bin'), binary);
    const { agent, turn } = setup([
      [
        editC('latin.ts', 'const s', 'let s'),
        write('src/logo.bin', 'text now'),
        editC('a.ts', 'const a = 1', 'const a = 2'),
        write('src/c.md', 'x'),
        write('d.json', '[]'),
      ],
      [],
    ]);
    const before = disk();
    await turn('t1');
    expect(readFileSync(join(ws, 'latin.ts')).equals(latin1)).toBe(false);
    expect(await agent.rewindPreview('conv', ['t1'])).toHaveLength(5);
    expect(await agent.rewind('conv', ['t1'])).toHaveLength(5);
    expect(readFileSync(join(ws, 'latin.ts')).equals(latin1)).toBe(true);
    expect(readFileSync(join(ws, 'src/logo.bin')).equals(binary)).toBe(true);
    expect(disk()).toEqual(before);
  });

  it('revert also restores non-UTF-8 bytes, after a restart', async () => {
    const latin1 = Buffer.from('niño\r\n', 'latin1');
    writeFileSync(join(ws, 'latin.txt'), latin1);
    const { turn } = setup([[editC('latin.txt', 'ni', 'NI')], []]);
    await turn('t1');
    // A new agent (the app restarted) reads the checkpoints saved on disk.
    const { agent: again } = setup([], false);
    await again.revert('conv');
    expect(readFileSync(join(ws, 'latin.txt')).equals(latin1)).toBe(true);
  });

  it('rewinding an exchange takes the later ones with it', async () => {
    const { agent, turn } = setup([
      [write('a.ts', 'one')],
      [],
      [write('a.ts', 'two'), write('d.json', 'x')],
      [],
    ]);
    const before = disk();
    await turn('t1');
    await turn('t2');
    await agent.rewind('conv', ['t1', 't2']);
    expect(disk()).toEqual(before);
  });

  it('shows one exchange diff and applies a review by blocks', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}\n`).join('');
    const { agent, turn } = setup([
      [write('src/c.md', lines)],
      [],
      [
        editC('src/c.md', 'line 1\n', 'LINE 1\n'),
        editC('src/c.md', 'line 10\n', 'LINE 10\n'),
        write('src/new.ts', 'n\n'),
      ],
      [],
    ]);
    await turn('t1');
    await turn('t2');
    const files = await agent.turnDiff('conv', 't2');
    expect(files.map((f) => f.path)).toEqual(['src/c.md', 'src/new.ts']);
    const c = files[0]!;
    expect(c.before).toBe(lines);
    const h = hunks(c.before!, c.after!);
    expect(h).toHaveLength(2);
    expect(c.changedSince).toBe(false);
    // Keep the first block, reject the second.
    await agent.applyReview('conv', 't2', 'src/c.md', [1]);
    expect(readFileSync(join(ws, 'src/c.md'), 'utf8')).toBe(lines.replace('line 1\n', 'LINE 1\n'));
    // A file the exchange created, rejected whole, goes away; one it did not touch is refused.
    await agent.applyReview('conv', 't2', 'src/new.ts', [0]);
    expect(existsSync(join(ws, 'src/new.ts'))).toBe(false);
    await expect(agent.applyReview('conv', 't2', 'a.ts', [0])).rejects.toThrow();
    // The checkpoint stays: rewinding t2 still gives back the file from before it.
    await agent.rewind('conv', ['t2']);
    expect(readFileSync(join(ws, 'src/c.md'), 'utf8')).toBe(lines);
  });

  it('refuses to restore project files in another folder', async () => {
    const { agent, turn } = setup([[write('a.ts', 'x')], []]);
    await turn('t1');
    const other = join(root, 'other');
    mkdirSync(other);
    const otherWs = new Workspace(other);
    await expect(agent.rewind('conv', ['t1'], () => otherWs)).rejects.toThrow(/carpeta/);
    expect(readFileSync(join(ws, 'a.ts'), 'utf8')).toBe('x');
  });

  it('shows only what one exchange did, and undoes it under later changes', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}\n`).join('');
    writeFileSync(join(ws, 'src/c.md'), lines);
    const { agent, turn } = setup(
      [
        [editC('src/c.md', 'line 3\n', 'LINE 3\n')],
        [],
        [editC('src/c.md', 'line 10\n', 'X\n')],
        [],
      ],
      false,
    );
    await turn('t1');
    await turn('t2');
    const [c] = await agent.turnDiff('conv', 't1');
    // t2's edit is not mixed into t1's diff, and the file is flagged as changed since.
    expect(c!.after).toBe(lines.replace('line 3\n', 'LINE 3\n'));
    expect(c!.changedSince).toBe(true);
    expect(hunks(c!.before!, c!.after!)).toHaveLength(1);
    // Rejecting t1's block keeps t2's later edit.
    await agent.applyReview('conv', 't1', 'src/c.md', [0]);
    expect(readFileSync(join(ws, 'src/c.md'), 'utf8')).toBe(lines.replace('line 10\n', 'X\n'));
  });

  it('refuses a block that changed again later', async () => {
    const { agent, turn } = setup([
      [editC('src/c.md', 'body', 'new body')],
      [],
      [editC('src/c.md', 'new body', 'third body')],
      [],
    ]);
    await turn('t1');
    await turn('t2');
    await expect(agent.applyReview('conv', 't1', 'src/c.md', [0])).rejects.toThrow(/Volver aquí/);
    expect(readFileSync(join(ws, 'src/c.md'), 'utf8')).toBe('# title\n\nthird body\n');
  });

  it('previews a rewind and flags files edited by hand since', async () => {
    const { agent, turn } = setup([[write('a.ts', 'agent'), write('src/new.ts', 'n\n')], []]);
    await turn('t1');
    writeFileSync(join(ws, 'a.ts'), 'agent + my hand edit');
    expect(await agent.rewindPreview('conv', ['t1'])).toEqual([
      { path: 'a.ts', action: 'restore', edited: true },
      { path: 'src/new.ts', action: 'delete', edited: false },
    ]);
    // Nothing was written by the preview.
    expect(readFileSync(join(ws, 'a.ts'), 'utf8')).toBe('agent + my hand edit');
  });

  it('keeps the checkpoints after the app restarts', async () => {
    const first = setup([
      [editC('a.ts', 'const a = 1', 'const a = 10'), write('src/new.ts', 'created\n')],
      [],
    ]);
    const before = disk();
    await first.turn('t1');
    // A new agent (the app opened again) reads them from disk.
    const second = setup([], false);
    expect(second.agent.changedFiles('conv')).toBe(2);
    expect((await second.agent.turnDiff('conv', 't1')).map((f) => f.path)).toEqual([
      'a.ts',
      'src/new.ts',
    ]);
    expect(await second.agent.rewind('conv', ['t1'])).toHaveLength(2);
    expect(disk()).toEqual(before);
    // The rewind is saved too: a third start has nothing left to restore.
    expect(setup([], false).agent.changedFiles('conv')).toBe(0);
  });

  it('forgets the saved checkpoints with the conversation', async () => {
    const first = setup([[write('a.ts', 'x')], []]);
    await first.turn('t1');
    first.agent.forget('conv');
    expect(setup([], false).agent.changedFiles('conv')).toBe(0);
  });
});

/**
 * "Volver aquí" → "Restaurar conversación" (Fase 2): the saved history is cut at that question
 * (core history.truncateAtUser, tested in packages/core) and the agent drops its transcript
 * (resetMessages), so the next turn starts from what is left. The code is not touched; with
 * "ambas" the files go back too.
 */
describe('restore conversation', () => {
  type Msg = { role: string; content: unknown };
  function recordingAgent(steps: Call[][]) {
    let step = 0;
    let n = 0;
    const sent: Msg[][] = [];
    const core = {
      paths: { home: join(root, 'omni') },
      async *stream(req: { messages: Msg[] }) {
        sent.push(req.messages.map((m) => ({ role: m.role, content: m.content })));
        for (const c of steps[step++] ?? [])
          yield { type: 'tool_call', id: `c${++n}`, name: c.name, argsDelta: JSON.stringify(c.args) };
        yield { type: 'text', delta: `answer ${step}` };
        yield { type: 'done', stopReason: 'stop' };
      },
    } as unknown as OmniCore;
    for (const [p, c] of Object.entries(ORIGINAL)) writeFileSync(join(ws, p), c);
    const workspace = new Workspace(ws);
    const agent = new Agent(core, () => workspace);
    agent.userKitRoot = null;
    const turn = (id: string, text: string, history: Msg[] = []) =>
      agent.run({
        conversationId: 'conv',
        turn: id,
        userMessage: { role: 'user', content: text },
        fallbackHistory: history as never,
        signal: new AbortController().signal,
        emit: () => {},
        ask: () => Promise.resolve('approve'),
      });
    const texts = (i: number) => sent[i]!.map((m) => String(m.content));
    return { agent, turn, sent, texts };
  }

  it('the next turn starts from the history before that question; files stay', async () => {
    const r = recordingAgent([[write('a.ts', 'first')], [], [write('d.json', 'second')], [], []]);
    await r.turn('t1', 'first question');
    await r.turn('t2', 'second question');
    const afterBoth = disk();
    // Restore the conversation at the 2nd question (index 1): only the transcript changes.
    r.agent.resetMessages('conv');
    await r.turn('t3', 'another question', [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'answer 2' },
    ]);
    const last = r.texts(r.sent.length - 1);
    expect(last).toContain('first question');
    expect(last).toContain('another question');
    expect(last.some((c) => c.includes('second question'))).toBe(false);
    expect(disk()).toEqual(afterBoth);
    // Its checkpoints are still there: "restore code" can still undo the cut exchange.
    expect(r.agent.changedFiles('conv')).toBe(2);
  });

  it('"both" puts the files back and forgets the transcript', async () => {
    const r = recordingAgent([[write('a.ts', 'first')], [], [write('d.json', 'second')], [], []]);
    await r.turn('t1', 'first question');
    const afterT1 = disk();
    await r.turn('t2', 'second question');
    expect(await r.agent.rewind('conv', ['t2'])).toEqual(['d.json']);
    r.agent.resetMessages('conv');
    expect(disk()).toEqual(afterT1);
    await r.turn('t3', 'again', [{ role: 'user', content: 'first question' }]);
    expect(r.texts(r.sent.length - 1).some((c) => c.includes('second question'))).toBe(false);
  });
});
