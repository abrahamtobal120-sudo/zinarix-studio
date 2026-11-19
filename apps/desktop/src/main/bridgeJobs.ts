/**
 * Tasks left on the permanent bridge (blenderBridge.ts): POST /v1/jobs queues a chat request
 * and answers at once; the queue runs it in the background and keeps the answer, so the
 * caller (Blender, a web app, a script) can go away and come back for it later.
 *
 * Everything is saved to <userData>/bridge-jobs.json: if the window is closed, the app quits
 * or the computer turns off, the tasks still waiting (and the one cut halfway) run again the
 * next time Zinarix opens (also at login, see main.ts). No Electron imports: tests drive it.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BridgeChatRequest } from './blenderBridge.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface BridgeJob {
  id: string;
  status: JobStatus;
  /** Free label from the caller ("render notes", "scene 3"…), shown in the list. */
  title?: string;
  request: BridgeChatRequest;
  created: number;
  started?: number;
  finished?: number;
  /** Runs started (a run cut by a shutdown counts too). */
  attempts: number;
  /** Not before this time (a retry after a failure waits a little). */
  notBefore?: number;
  result?: { text: string; model: string };
  error?: string;
}

export interface JobRunner {
  complete(req: BridgeChatRequest, signal: AbortSignal): Promise<{ text: string; model: string }>;
}

export interface JobQueueOptions {
  /** Tries per task before it is left as "error". */
  maxAttempts?: number;
  /** Time limit of one run. */
  timeoutMs?: number;
  /** Finished tasks are forgotten after this long. */
  keepMs?: number;
  /** Most tasks kept (the oldest finished ones go first). */
  maxJobs?: number;
  /** Wait before a retry, times the attempt number. */
  retryMs?: number;
  now?: () => number;
}

const FINISHED: ReadonlySet<JobStatus> = new Set(['done', 'error', 'cancelled']);

export class QueueFullError extends Error {}

export class BridgeJobQueue {
  private jobs: BridgeJob[] = [];
  private readonly file: string;
  private running: { id: string; ctrl: AbortController } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly keepMs: number;
  private readonly maxJobs: number;
  private readonly retryMs: number;
  private readonly now: () => number;
  /** Called after every change (the tray's counter, the status bar). */
  onChange: (() => void) | null = null;

  constructor(
    userData: string,
    private readonly runner: JobRunner,
    opts: JobQueueOptions = {},
  ) {
    this.file = join(userData, 'bridge-jobs.json');
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    this.keepMs = opts.keepMs ?? 7 * 24 * 60 * 60_000;
    this.maxJobs = opts.maxJobs ?? 200;
    this.retryMs = opts.retryMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    this.load();
  }

  /** Starts working through the queue (tasks left from the last session included). */
  start(): void {
    this.stopped = false;
    this.pump();
  }

  /** Stops (app quitting): the running task goes back to the queue for the next session. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const r = this.running;
    if (r) {
      const job = this.find(r.id);
      if (job && job.status === 'running') job.status = 'queued';
      this.running = null;
      r.ctrl.abort(new Error('Zinarix is closing'));
    }
    this.save();
  }

  /** Waiting or running tasks: while there are any, the app keeps working in the background. */
  get pending(): number {
    return this.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  }

  list(): BridgeJob[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  get(id: string): BridgeJob | null {
    const j = this.find(id);
    return j ? { ...j } : null;
  }

  add(request: BridgeChatRequest, title?: string): BridgeJob {
    this.prune();
    if (this.jobs.length >= this.maxJobs) throw new QueueFullError('Too many tasks queued.');
    const job: BridgeJob = {
      id: `job_${randomUUID()}`,
      status: 'queued',
      ...(title ? { title: title.slice(0, 200) } : {}),
      request,
      created: this.now(),
      attempts: 0,
    };
    this.jobs.push(job);
    this.changed();
    this.pump();
    return { ...job };
  }

  /** Cancels a waiting or running task; a finished one is removed. false = unknown id. */
  cancel(id: string): boolean {
    const job = this.find(id);
    if (!job) return false;
    if (FINISHED.has(job.status)) {
      this.jobs = this.jobs.filter((j) => j !== job);
    } else {
      job.status = 'cancelled';
      job.finished = this.now();
      if (this.running?.id === id) {
        this.running.ctrl.abort(new Error('cancelled'));
        this.running = null;
      }
    }
    this.changed();
    this.pump();
    return true;
  }

  private find(id: string): BridgeJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  private pump(): void {
    if (this.stopped || this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = this.now();
    const waiting = this.jobs.filter((j) => j.status === 'queued');
    const next = waiting.find((j) => !j.notBefore || j.notBefore <= now);
    if (!next) {
      // Only retries waiting for their time: come back then.
      const soon = Math.min(...waiting.map((j) => j.notBefore ?? now));
      if (waiting.length) this.timer = setTimeout(() => this.pump(), Math.max(0, soon - now));
      this.timer?.unref?.();
      return;
    }
    void this.run(next);
  }

  private async run(job: BridgeJob): Promise<void> {
    const ctrl = new AbortController();
    this.running = { id: job.id, ctrl };
    job.status = 'running';
    job.started = this.now();
    job.attempts += 1;
    delete job.notBefore;
    // Saved before the run: a shutdown in the middle leaves it "running", requeued on load.
    this.changed();
    const limit = setTimeout(
      () => ctrl.abort(new Error('The model took too long.')),
      this.timeoutMs,
    );
    try {
      const r = await this.runner.complete(job.request, ctrl.signal);
      if (this.running?.id !== job.id) return; // cancelled or stopped meanwhile
      job.status = 'done';
      job.result = { text: r.text, model: r.model };
      delete job.error;
      job.finished = this.now();
    } catch (e) {
      if (this.running?.id !== job.id) return;
      job.error = e instanceof Error ? e.message : String(e);
      if (job.attempts < this.maxAttempts) {
        // Offline after a restart, a provider hiccup: try again a bit later.
        job.status = 'queued';
        job.notBefore = this.now() + this.retryMs * job.attempts;
      } else {
        job.status = 'error';
        job.finished = this.now();
      }
    } finally {
      clearTimeout(limit);
      if (this.running?.id === job.id) this.running = null;
    }
    this.changed();
    this.pump();
  }

  private load(): void {
    let raw: unknown = [];
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      /* first run or a broken file */
    }
    const list = Array.isArray(raw) ? raw : [];
    this.jobs = list.filter(
      (j): j is BridgeJob =>
        !!j &&
        typeof j === 'object' &&
        typeof (j as BridgeJob).id === 'string' &&
        typeof (j as BridgeJob).status === 'string' &&
        Array.isArray((j as BridgeJob).request?.messages),
    );
    let fixed = false;
    for (const j of this.jobs) {
      if (j.status !== 'running') continue;
      // Cut by a shutdown (window closed, computer off): it runs again, unless out of tries.
      fixed = true;
      if (j.attempts >= this.maxAttempts) {
        j.status = 'error';
        j.error = 'Interrupted too many times.';
        j.finished = this.now();
      } else j.status = 'queued';
    }
    if (this.prune() || fixed) this.save();
  }

  /** Forgets old finished tasks; true when something was removed. */
  private prune(): boolean {
    const before = this.jobs.length;
    const limit = this.now() - this.keepMs;
    this.jobs = this.jobs.filter(
      (j) => !FINISHED.has(j.status) || (j.finished ?? j.created) > limit,
    );
    const extra = this.jobs.length - this.maxJobs;
    if (extra > 0) {
      const old = new Set(
        this.jobs
          .filter((j) => FINISHED.has(j.status))
          .sort((a, b) => (a.finished ?? 0) - (b.finished ?? 0))
          .slice(0, extra),
      );
      this.jobs = this.jobs.filter((j) => !old.has(j));
    }
    return this.jobs.length !== before;
  }

  private changed(): void {
    this.save();
    try {
      this.onChange?.();
    } catch {
      /* a listener's problem is not the queue's */
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      // Owner-only: prompts and answers may be private. Renamed so a power cut never
      // leaves half a file.
      writeFileSync(tmp, JSON.stringify(this.jobs), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (e) {
      console.error('[bridge-jobs] save failed:', e);
    }
  }
}

/** A task as the HTTP API shows it (OpenAI-like completion once it is done). */
export function jobView(j: BridgeJob): Record<string, unknown> {
  return {
    id: j.id,
    object: 'bridge.job',
    status: j.status,
    ...(j.title ? { title: j.title } : {}),
    created: Math.floor(j.created / 1000),
    ...(j.started ? { started: Math.floor(j.started / 1000) } : {}),
    ...(j.finished ? { finished: Math.floor(j.finished / 1000) } : {}),
    attempts: j.attempts,
    ...(j.error ? { error: { message: j.error } } : {}),
    ...(j.result
      ? {
          completion: {
            id: `chatcmpl-${j.id}`,
            object: 'chat.completion',
            created: Math.floor((j.finished ?? j.created) / 1000),
            model: j.result.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: j.result.text },
                finish_reason: 'stop',
              },
            ],
          },
        }
      : {}),
  };
}
