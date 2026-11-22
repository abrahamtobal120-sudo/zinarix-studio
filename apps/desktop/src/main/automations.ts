/**
 * "Automatizar" (see shared/automations.ts): the scheduler of the AI's scheduled tasks, the
 * user's bots ("Mis bots") and the website widget made from a bot. Everything is kept in
 * <home>/automations.json. A run is a normal AiService.chat request without a window: in
 * "read" mode every action that needs approval is refused, since nobody is watching.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatEventView, ChatRequestView, ToolDecision } from '../shared/api.js';
import {
  DELIVERIES,
  MAX_BOTS,
  MAX_TASKS,
  RUNS_KEPT,
  RUN_TEXT_MAX,
  checkSchedule,
  cleanBot,
  cleanWidget,
  dueAction,
  nextRun,
  taskPrompt,
  widgetFiles,
  type AutoRun,
  type AutoTask,
  type AutoTaskInput,
  type AutomationsStatus,
  type BotDef,
  type BotInput,
  type Delivery,
  type WidgetTarget,
} from '../shared/automations.js';
import type { Scope } from './ai.js';
import { Workspace } from './workspace.js';

/** What the service needs from AiService (an interface, so tests can fake it). */
export interface AutomationRunner {
  chat(
    requestId: string,
    req: ChatRequestView,
    emit: (requestId: string, ev: ChatEventView) => void,
    scope: Scope,
  ): Promise<void>;
  abort(requestId: string): void;
  toolDecision(requestId: string, toolCallId: string, decision: ToolDecision): void;
  answerQuestion(requestId: string, toolCallId: string, answer: string[] | null): void;
}

export interface AutomationOptions {
  /** Folder of automations.json (the app's home). */
  dir: string;
  runner: AutomationRunner;
  onChange?: (status: AutomationsStatus) => void;
  /** A run ended: system notification. */
  notify?: (title: string, body: string) => void;
  /** Sends a text to Telegram / Discord / WhatsApp; throws a readable error when it cannot. */
  deliver?: (kind: Delivery, text: string) => Promise<void>;
  /** The app's language (prompts and dates). */
  lang?: () => 'es' | 'en';
  /** Tick of the scheduler (tests use a small one). */
  tickMs?: number;
  now?: () => number;
  /** Longest run before it is stopped. */
  maxRunMs?: number;
}

interface Saved {
  version: 1;
  tasks: AutoTask[];
  runs: AutoRun[];
  bots: BotDef[];
}

const MAX_PARALLEL = 2;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Automations {
  private data: Saved;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** task id -> request id of its run in progress. */
  private live = new Map<string, string>();
  private readonly file: string;
  private readonly now: () => number;

  constructor(private o: AutomationOptions) {
    this.file = join(o.dir, 'automations.json');
    this.now = o.now ?? Date.now;
    this.data = this.load();
  }

  // ---------------- Storage ----------------

  private load(): Saved {
    const empty: Saved = { version: 1, tasks: [], runs: [], bots: [] };
    if (!existsSync(this.file)) return empty;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const runs = (Array.isArray(j.runs) ? j.runs : []).map((r) =>
        // A run left halfway when the app closed.
        r.state === 'running'
          ? { ...r, state: 'failed' as const, error: 'Zinarix se cerró durante la tarea.', endedAt: r.startedAt }
          : r,
      );
      return {
        version: 1,
        tasks: Array.isArray(j.tasks) ? j.tasks : [],
        runs,
        bots: (Array.isArray(j.bots) ? j.bots : []).map((b) => ({ ...b, widget: cleanWidget(b.widget, b.name) })),
      };
    } catch {
      // Unreadable: keep a copy instead of losing it on the next save.
      try {
        renameSync(this.file, `${this.file}.bad-${Date.now()}`);
      } catch {
        // ignore
      }
      return empty;
    }
  }

  private save(): void {
    mkdirSync(this.o.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  private changed(): void {
    this.save();
    this.o.onChange?.(this.status());
  }

  status(): AutomationsStatus {
    return {
      tasks: this.data.tasks.map((t) => ({ ...t })),
      runs: this.data.runs.map((r) => ({ ...r })),
      bots: this.data.bots.map((b) => ({ ...b, widget: { ...b.widget } })),
      running: [...this.live.keys()],
    };
  }

  // ---------------- Scheduler ----------------

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.o.tickMs ?? 30_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const rid of this.live.values()) this.o.runner.abort(rid);
  }

  /** Runs what is due (at most MAX_PARALLEL at once; the rest waits for the next tick). */
  tick(): void {
    const now = this.now();
    let dirty = false;
    for (const t of this.data.tasks) {
      if (this.live.has(t.id)) continue;
      const a = dueAction(t, now);
      if (a === 'skip') {
        t.nextRun = this.after(t, now);
        dirty = true;
      } else if (a === 'run' && this.live.size < MAX_PARALLEL) {
        t.nextRun = this.after(t, now);
        void this.run(t, false);
      }
    }
    if (dirty) this.changed();
  }

  private after(t: AutoTask, from: number): number | null {
    const n = nextRun(t.schedule, from);
    if (n === null && t.schedule.kind === 'once') t.enabled = false;
    return n;
  }

  // ---------------- Tasks ----------------

  private cleanTask(input: AutoTaskInput): Omit<AutoTask, 'id' | 'createdAt' | 'nextRun'> {
    const name = String(input.name ?? '').trim().slice(0, 80);
    if (!name) throw new Error('Ponle un nombre a la tarea.');
    const prompt = String(input.prompt ?? '').trim().slice(0, 8000);
    if (!prompt) throw new Error('Escribe qué tiene que hacer la IA.');
    const schedule = checkSchedule(input.schedule);
    if (typeof schedule === 'string') throw new Error(schedule);
    if (input.bot && !this.data.bots.some((b) => b.id === input.bot)) throw new Error('Ese bot ya no existe.');
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    return {
      name,
      prompt,
      schedule,
      enabled: input.enabled !== false,
      ...(model ? { model } : {}),
      ...(input.bot ? { bot: input.bot } : {}),
      tools: input.tools === 'read' ? 'read' : 'none',
      ...(input.folder ? { folder: String(input.folder) } : {}),
      deliver: [...new Set((input.deliver ?? []).filter((d) => DELIVERIES.includes(d)))],
    };
  }

  createTask(input: AutoTaskInput): AutomationsStatus {
    if (this.data.tasks.length >= MAX_TASKS) throw new Error(`Máximo ${MAX_TASKS} tareas.`);
    const clean = this.cleanTask(input);
    const now = this.now();
    const t: AutoTask = {
      ...clean,
      id: randomUUID(),
      createdAt: now,
      nextRun: clean.enabled ? nextRun(clean.schedule, now) : null,
    };
    if (t.schedule.kind === 'once' && t.nextRun === null) throw new Error('Esa fecha ya pasó.');
    this.data.tasks.push(t);
    this.changed();
    return this.status();
  }

  updateTask(id: string, input: AutoTaskInput): AutomationsStatus {
    const t = this.task(id);
    const clean = this.cleanTask(input);
    // Optional fields left out of the form are removed.
    delete t.model;
    delete t.bot;
    delete t.folder;
    Object.assign(t, clean);
    t.nextRun = t.enabled ? nextRun(t.schedule, this.now()) : null;
    if (t.enabled && t.schedule.kind === 'once' && t.nextRun === null) throw new Error('Esa fecha ya pasó.');
    this.changed();
    return this.status();
  }

  setEnabled(id: string, on: boolean): AutomationsStatus {
    const t = this.task(id);
    t.enabled = on;
    t.nextRun = on ? nextRun(t.schedule, this.now()) : null;
    if (on && t.nextRun === null) {
      t.enabled = false;
      throw new Error('Esa fecha ya pasó: cambia el horario.');
    }
    this.changed();
    return this.status();
  }

  deleteTask(id: string): AutomationsStatus {
    const rid = this.live.get(id);
    if (rid) this.o.runner.abort(rid);
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this.changed();
    return this.status();
  }

  /** "Ejecutar ahora": a run outside the timetable (its next scheduled run stays). */
  runNow(id: string): AutomationsStatus {
    const t = this.task(id);
    if (this.live.has(id)) throw new Error('Esa tarea ya se está ejecutando.');
    void this.run(t, true);
    return this.status();
  }

  cancel(id: string): AutomationsStatus {
    const rid = this.live.get(id);
    if (rid) this.o.runner.abort(rid);
    return this.status();
  }

  clearRuns(task?: string): AutomationsStatus {
    this.data.runs = this.data.runs.filter((r) => r.state === 'running' || (task !== undefined && r.task !== task));
    this.changed();
    return this.status();
  }

  private task(id: string): AutoTask {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) throw new Error('Esa tarea ya no existe.');
    return t;
  }

  /** One unattended run of a task. */
  async run(t: AutoTask, manual: boolean): Promise<AutoRun> {
    const rid = `auto:${t.id}:${randomUUID().slice(0, 8)}`;
    const bot = t.bot ? this.bot(t.bot) : undefined;
    const r: AutoRun = {
      id: randomUUID(),
      task: t.id,
      taskName: t.name,
      startedAt: this.now(),
      state: 'running',
      text: '',
      usd: 0,
      denied: 0,
      ...(manual ? { manual: true } : {}),
    };
    this.live.set(t.id, rid);
    t.lastRun = r.startedAt;
    this.data.runs.unshift(r);
    this.data.runs = this.data.runs.slice(0, RUNS_KEPT);
    this.changed();
    const lang = this.o.lang?.() ?? 'es';
    const ws = t.tools === 'read' && t.folder && existsSync(t.folder) ? new Workspace(t.folder) : undefined;
    const limit = setTimeout(() => {
      r.error = 'Tardó demasiado: se detuvo.';
      this.o.runner.abort(rid);
    }, this.o.maxRunMs ?? 10 * 60_000);
    let failed: string | undefined;
    try {
      await this.o.runner.chat(
        rid,
        {
          agent: t.tools === 'read',
          ...(t.tools === 'read' ? { mode: 'agent' as const } : {}),
          model: t.model ?? bot?.model,
          prompt: taskPrompt(t, r.startedAt, lang),
          history: [],
          context: [],
          ...(ws ? { folder: t.folder } : { noFolder: true }),
          ...(bot ? { bot: bot.id } : {}),
          uiLang: lang,
        },
        (_id, ev) => {
          switch (ev.type) {
            case 'start':
              r.model = `${ev.provider}/${ev.model}`;
              break;
            case 'conversation':
              r.conversationId = ev.id;
              break;
            case 'text':
              if (r.text.length < RUN_TEXT_MAX) r.text = (r.text + ev.delta).slice(0, RUN_TEXT_MAX);
              break;
            case 'tool_approval':
              // Nobody is watching: questions get "let the agent decide", actions a no.
              if (ev.name === 'ask_user') this.o.runner.answerQuestion(rid, ev.id, null);
              else {
                r.denied++;
                this.o.runner.toolDecision(rid, ev.id, 'deny');
              }
              break;
            case 'cost':
              r.usd = r.usd === null || ev.usd === null ? null : r.usd + ev.usd;
              break;
            case 'error':
              failed = ev.message;
              break;
          }
        },
        { workspace: () => ws },
      );
    } catch (e) {
      failed = msg(e);
    } finally {
      clearTimeout(limit);
    }
    this.live.delete(t.id);
    r.endedAt = this.now();
    if (failed || r.error) {
      r.state = 'failed';
      r.error = r.error ?? failed;
    } else r.state = 'ok';
    r.text = r.text.trim();
    this.changed();
    await this.report(t, r);
    this.changed();
    return r;
  }

  /** Notification, and the chosen chat apps. */
  private async report(t: AutoTask, r: AutoRun): Promise<void> {
    const body = r.state === 'ok' ? r.text : `Error: ${r.error ?? '?'}`;
    this.o.notify?.(`${r.state === 'ok' ? '✓' : '✗'} ${t.name}`, body.slice(0, 200) || '(sin texto)');
    if (!t.deliver.length || !this.o.deliver) return;
    const text = `⏰ ${t.name}\n\n${body || '(sin texto)'}`;
    const problems: string[] = [];
    for (const kind of t.deliver) {
      try {
        await this.o.deliver(kind, text);
      } catch (e) {
        problems.push(`${kind === 'whatsapp' ? 'WhatsApp' : kind[0]!.toUpperCase() + kind.slice(1)}: ${msg(e)}`);
      }
    }
    if (problems.length) r.delivery = problems;
  }

  // ---------------- Bots ----------------

  bot(id: string): BotDef | undefined {
    return this.data.bots.find((b) => b.id === id);
  }

  createBot(input: Partial<BotInput>): { status: AutomationsStatus; id: string } {
    if (this.data.bots.length >= MAX_BOTS) throw new Error(`Máximo ${MAX_BOTS} bots.`);
    const clean = cleanBot(input);
    const now = this.now();
    const b: BotDef = { ...clean, id: randomUUID(), createdAt: now, updatedAt: now };
    this.data.bots.push(b);
    this.changed();
    return { status: this.status(), id: b.id };
  }

  updateBot(id: string, input: Partial<BotInput>): AutomationsStatus {
    const b = this.bot(id);
    if (!b) throw new Error('Ese bot ya no existe.');
    // The Vercel link survives edits of the form.
    const clean = cleanBot({ ...input, widget: { ...b.widget, ...input.widget } });
    delete b.model;
    Object.assign(b, clean, { updatedAt: this.now() });
    this.changed();
    return this.status();
  }

  deleteBot(id: string): AutomationsStatus {
    this.data.bots = this.data.bots.filter((b) => b.id !== id);
    for (const t of this.data.tasks) if (t.bot === id) delete t.bot;
    this.changed();
    return this.status();
  }

  /** Remembers where the widget was published. */
  setPublished(id: string, url: string, project: string): AutomationsStatus {
    const b = this.bot(id);
    if (!b) throw new Error('Ese bot ya no existe.');
    b.widget = cleanWidget({ ...b.widget, vercelUrl: url, vercelProject: project }, b.name);
    this.changed();
    return this.status();
  }

  /** The widget folder of a bot, written to `dir` (created; existing files replaced). */
  writeWidget(id: string, target: WidgetTarget, dir: string): string[] {
    const b = this.bot(id);
    if (!b) throw new Error('Ese bot ya no existe.');
    const files = widgetFiles(b, target);
    for (const f of files) {
      const p = join(dir, f.file);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, f.text);
    }
    return files.map((f) => f.file);
  }
}
