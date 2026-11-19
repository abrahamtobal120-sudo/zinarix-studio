/**
 * Tasks left on the permanent bridge: queued, run in the background, saved to disk, and
 * continued after a shutdown (window closed, computer off).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlenderBridge } from '../src/main/blenderBridge.js';
import { BridgeJobQueue, type JobRunner } from '../src/main/bridgeJobs.js';

const dir = () => mkdtempSync(join(tmpdir(), 'zx-jobs-'));
const req = (text: string) => ({ messages: [{ role: 'user' as const, content: text }] });
const until = async (ok: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const echo: JobRunner = {
  complete: async (r) => ({ text: `re: ${r.messages.at(-1)!.content}`, model: 'x/y' }),
};

const queues: BridgeJobQueue[] = [];
const bridges: BlenderBridge[] = [];
afterEach(async () => {
  queues.splice(0).forEach((q) => q.stop());
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});
const queue = (d: string, runner: JobRunner, opts = {}) => {
  const q = new BridgeJobQueue(d, runner, opts);
  queues.push(q);
  return q;
};

describe('BridgeJobQueue', () => {
  it('runs tasks in order and keeps the answers on disk', async () => {
    const d = dir();
    const q = queue(d, echo);
    q.start();
    const a = q.add(req('uno'), 'primera');
    const b = q.add(req('dos'));
    await until(() => q.get(b.id)?.status === 'done');
    expect(q.get(a.id)).toMatchObject({
      status: 'done',
      title: 'primera',
      result: { text: 're: uno' },
    });
    expect(q.pending).toBe(0);
    const again = new BridgeJobQueue(d, echo);
    expect(again.get(b.id)?.result?.text).toBe('re: dos');
  });

  it('a task cut by a shutdown runs again in the next session', async () => {
    const d = dir();
    let release: () => void = () => undefined;
    const slow: JobRunner = {
      complete: (_r, signal) =>
        new Promise((resolve, reject) => {
          release = () => resolve({ text: 'late', model: 'x/y' });
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    };
    const q = queue(d, slow);
    q.start();
    const j = q.add(req('hola'));
    await until(() => q.get(j.id)?.status === 'running');
    q.stop(); // the app quits
    release();
    expect(JSON.parse(readFileSync(join(d, 'bridge-jobs.json'), 'utf8'))[0].status).toBe('queued');
    const next = queue(d, echo);
    expect(next.pending).toBe(1);
    next.start();
    await until(() => next.get(j.id)?.status === 'done');
    expect(next.get(j.id)).toMatchObject({ attempts: 2, result: { text: 're: hola' } });
  });

  it('a "running" task in the file (power cut) is queued again on load', () => {
    const d = dir();
    writeFileSync(
      join(d, 'bridge-jobs.json'),
      JSON.stringify([
        { id: 'job_a', status: 'running', request: req('x'), created: 1, attempts: 1 },
      ]),
    );
    expect(new BridgeJobQueue(d, echo).get('job_a')?.status).toBe('queued');
  });

  it('retries a failure, then gives up', async () => {
    let calls = 0;
    const bad: JobRunner = {
      complete: async () => {
        calls++;
        throw new Error('offline');
      },
    };
    const q = queue(dir(), bad, { retryMs: 1, maxAttempts: 3 });
    q.start();
    const j = q.add(req('x'));
    await until(() => q.get(j.id)?.status === 'error');
    expect(calls).toBe(3);
    expect(q.get(j.id)?.error).toBe('offline');
  });

  it('cancels a waiting task and removes a finished one', async () => {
    const q = queue(dir(), echo);
    const j = q.add(req('x')); // not started: stays queued
    expect(q.cancel(j.id)).toBe(true);
    expect(q.get(j.id)?.status).toBe('cancelled');
    expect(q.cancel(j.id)).toBe(true);
    expect(q.get(j.id)).toBeNull();
    expect(q.cancel('job_nope')).toBe(false);
  });

  it('forgets old finished tasks', () => {
    const d = dir();
    writeFileSync(
      join(d, 'bridge-jobs.json'),
      JSON.stringify([
        { id: 'old', status: 'done', request: req('x'), created: 1, finished: 1, attempts: 1 },
        { id: 'new', status: 'queued', request: req('x'), created: 1, attempts: 0 },
      ]),
    );
    const q = new BridgeJobQueue(d, echo, { keepMs: 1000, now: () => 10_000 });
    expect(q.list().map((j) => j.id)).toEqual(['new']);
  });
});

describe('bridge /v1/jobs', () => {
  it('queues, lists, reads and cancels over HTTP', async () => {
    const q = queue(dir(), echo);
    q.start();
    const b = new BlenderBridge({ models: async () => [], complete: echo.complete }, { jobs: q });
    bridges.push(b);
    const { url, token } = await b.start();
    const call = (path: string, init: RequestInit = {}) =>
      fetch(`${url}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      });
    const posted = await call('/jobs', {
      method: 'POST',
      body: JSON.stringify({ title: 'notas', messages: [{ role: 'user', content: 'hola' }] }),
    });
    expect(posted.status).toBe(202);
    const job = (await posted.json()) as { id: string; status: string; title: string };
    expect(job).toMatchObject({ object: 'bridge.job', title: 'notas' });
    await until(() => q.get(job.id)?.status === 'done');
    const got = (await (await call(`/jobs/${job.id}`)).json()) as {
      status: string;
      completion: { choices: { message: { content: string } }[] };
    };
    expect(got.status).toBe('done');
    expect(got.completion.choices[0]!.message.content).toBe('re: hola');
    const list = (await (await call('/jobs')).json()) as { data: { id: string }[] };
    expect(list.data.map((j) => j.id)).toEqual([job.id]);
    expect((await call(`/jobs/${job.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/jobs/${job.id}`)).status).toBe(404);
    expect((await call('/jobs', { method: 'POST', body: '{"messages":[]}' })).status).toBe(400);
  });

  it('answers 404 when the bridge has no queue (not permanent)', async () => {
    const b = new BlenderBridge({ models: async () => [], complete: echo.complete });
    bridges.push(b);
    const { url, token } = await b.start();
    const r = await fetch(`${url}/jobs`, { headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(404);
  });
});
