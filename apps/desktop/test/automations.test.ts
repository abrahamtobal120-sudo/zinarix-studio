import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEventView, ChatRequestView } from '../src/shared/api.js';
import {
  CATCH_UP_MS,
  botAgentMarkdown,
  botBlock,
  botFromFile,
  botSlug,
  botToFile,
  checkSchedule,
  cleanBot,
  cleanOrigin,
  describeSchedule,
  dueAction,
  nextRun,
  taskPrompt,
  widgetApi,
  widgetFiles,
  widgetUrlIssue,
  type AutoTask,
  type BotDef,
} from '../src/shared/automations.js';
import { parseAgentDef } from '../src/shared/agentKit.js';
import { Automations, type AutomationRunner } from '../src/main/automations.js';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('schedules', () => {
  it('daily: later today, else tomorrow', () => {
    const s = { kind: 'daily' as const, time: '09:30', days: [] };
    expect(nextRun(s, at(2026, 3, 10, 8, 0))).toBe(at(2026, 3, 10, 9, 30));
    expect(nextRun(s, at(2026, 3, 10, 9, 30))).toBe(at(2026, 3, 11, 9, 30));
    expect(nextRun(s, at(2026, 3, 10, 23, 59))).toBe(at(2026, 3, 11, 9, 30));
  });

  it('daily on some week days only', () => {
    // 2026-03-13 is a Friday; next Monday (1) is 2026-03-16.
    const s = { kind: 'daily' as const, time: '07:00', days: [1] };
    expect(new Date(at(2026, 3, 13)).getDay()).toBe(5);
    expect(nextRun(s, at(2026, 3, 13, 12))).toBe(at(2026, 3, 16, 7, 0));
  });

  it('every N minutes and once', () => {
    expect(nextRun({ kind: 'every', minutes: 30 }, 1000)).toBe(1000 + 30 * 60_000);
    expect(nextRun({ kind: 'once', at: 5000 }, 1000)).toBe(5000);
    expect(nextRun({ kind: 'once', at: 5000 }, 6000)).toBeNull();
  });

  it('checks and cleans schedules', () => {
    expect(checkSchedule({ kind: 'daily', time: '25:00', days: [] })).toMatch(/HH:MM/);
    expect(checkSchedule({ kind: 'daily', time: '08:00', days: [3, 1, 1, 9] })).toEqual({
      kind: 'daily',
      time: '08:00',
      days: [1, 3],
    });
    // All seven days is the same as "every day".
    expect(checkSchedule({ kind: 'daily', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] })).toEqual({
      kind: 'daily',
      time: '08:00',
      days: [],
    });
    expect(checkSchedule({ kind: 'every', minutes: 1 })).toMatch(/5 minutos/);
    expect(checkSchedule({ kind: 'every', minutes: 90 })).toEqual({ kind: 'every', minutes: 90 });
  });

  it('describes schedules', () => {
    expect(describeSchedule({ kind: 'daily', time: '09:00', days: [] })).toBe('Todos los días a las 09:00');
    expect(describeSchedule({ kind: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] })).toBe(
      'De lunes a viernes a las 09:00',
    );
    expect(describeSchedule({ kind: 'every', minutes: 120 })).toBe('Cada 2 h');
    expect(describeSchedule({ kind: 'every', minutes: 45 }, 'en')).toBe('Every 45 min');
  });

  it('catches up recent missed runs only', () => {
    const t = { enabled: true, nextRun: 1000 } as AutoTask;
    expect(dueAction(t, 500)).toBe('wait');
    expect(dueAction(t, 1000 + 60_000)).toBe('run');
    expect(dueAction(t, 1000 + CATCH_UP_MS + 1)).toBe('skip');
    expect(dueAction({ ...t, enabled: false }, 2000)).toBe('wait');
  });

  it('tells unattended runs that changes are refused', () => {
    const p = taskPrompt({ name: 'Correo', prompt: 'Resume mi correo', tools: 'read' }, at(2026, 3, 10, 9));
    expect(p).toContain('Scheduled task "Correo"');
    expect(p).toContain('refused automatically');
    expect(p.endsWith('Resume mi correo')).toBe(true);
  });
});

const bot = (over: Partial<BotDef> = {}): BotDef => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Atención',
  icon: '🛍️',
  description: 'Clientes',
  instructions: 'Sé amable.',
  knowledge: 'Horario: 9 a 18.',
  model: 'openai/gpt-5-mini',
  mode: 'chat',
  docs: [],
  greeting: '¡Hola!',
  widget: { title: 'Ayuda', color: '#112233', position: 'right', origins: [], perMinute: 10 },
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('bots', () => {
  it('cleans the form', () => {
    expect(() => cleanBot({ name: '  ' })).toThrow(/nombre/);
    const b = cleanBot({
      name: ' Tutor ',
      model: 'not a model',
      mode: 'other' as 'chat',
      widget: { color: 'red', origins: ['Example.com/x', 'ftp://x', 'https://a.dev'], perMinute: 999 },
    });
    expect(b.name).toBe('Tutor');
    expect(b.model).toBeUndefined();
    expect(b.mode).toBe('chat');
    expect(b.icon).toBe('🤖');
    expect(b.widget.color).toBe('#6d5efc');
    expect(b.widget.origins).toEqual(['https://example.com', 'https://a.dev']);
    expect(b.widget.perMinute).toBe(60);
    expect(cleanOrigin('javascript:alert(1)')).toBeNull();
  });

  it('exports and imports a bot file (without the author’s Vercel link)', () => {
    const b = bot({ widget: { ...bot().widget, vercelUrl: 'https://x.vercel.app', vercelProject: 'p' } });
    const file = botToFile(b);
    expect(file).not.toContain('vercel.app');
    const back = botFromFile(file);
    expect(back.name).toBe(b.name);
    expect(back.instructions).toBe(b.instructions);
    expect(back.widget.color).toBe('#112233');
    expect(() => botFromFile('{"name":"x"}')).toThrow(/no es un bot/);
    expect(() => botFromFile('nope')).toThrow(/JSON/);
  });

  it('becomes a subagent the Agent Kit reads', () => {
    const md = botAgentMarkdown(bot());
    const a = parseAgentDef(`.zinarix/agents/${botSlug('Atención')}.md`, md);
    expect(a?.name).toBe('atencion');
    expect(a?.description).toBe('Clientes');
    expect(a?.model).toBe('openai/gpt-5-mini');
    expect(a?.prompt).toContain('Sé amable.');
    expect(a?.prompt).toContain('Horario: 9 a 18.');
  });

  it('puts instructions, knowledge and doc passages in the system block', () => {
    const s = botBlock(bot(), [{ source: 'https://d.dev/a', title: 'A "b"', text: 'Pasaje' }]);
    expect(s).toContain('<bot_instructions>\nSé amable.');
    expect(s).toContain('<bot_knowledge>\nHorario');
    expect(s).toContain(`<doc source="https://d.dev/a" title="A 'b'">`);
  });
});

describe('website widget', () => {
  it('maps adapters and refuses local providers', () => {
    expect(widgetApi('openai-compatible')).toBe('openai');
    expect(widgetApi('anthropic')).toBe('anthropic');
    expect(widgetApi('google-gemini')).toBe('gemini');
    expect(widgetApi('cli-agent')).toBeNull();
    expect(widgetUrlIssue('http://localhost:11434/v1')).toMatch(/https/);
    expect(widgetUrlIssue('https://127.0.0.1:1234')).toMatch(/computadora/);
    expect(widgetUrlIssue('https://api.openai.com/v1')).toBeNull();
  });

  const target = { api: 'openai' as const, baseUrl: 'https://api.example.com/v1', model: 'm1', provider: 'Example' };

  it('never writes a key into the files, and the scripts are valid JS', () => {
    const files = widgetFiles(bot({ instructions: 'x </script> y' }), target);
    expect(files.map((f) => f.file).sort()).toEqual(['README.md', 'api/chat.js', 'index.html', 'vercel.json', 'widget.js']);
    for (const f of files) expect(f.text).not.toMatch(/sk-|Bearer [A-Za-z0-9]/);
    const chat = files.find((f) => f.file === 'api/chat.js')!.text;
    expect(chat).not.toContain('</script>');
    expect(() => new Function(files.find((f) => f.file === 'widget.js')!.text)).not.toThrow();
    expect(() => new Function('module', 'process', chat)).not.toThrow();
  });

  /** Loads api/chat.js as Vercel would (CommonJS) with a fake fetch. */
  function handler(origins: string[] = [], env: Record<string, string> = { BOT_API_KEY: 'k-test' }) {
    const chat = widgetFiles(bot({ widget: { ...bot().widget, origins, perMinute: 2 } }), target).find(
      (f) => f.file === 'api/chat.js',
    )!.text;
    const mod = { exports: null as unknown as (req: unknown, res: unknown) => Promise<void> };
    new Function('module', 'process', chat)(mod, { env });
    return mod.exports;
  }
  function res() {
    const r = {
      code: 0,
      body: null as unknown,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        r.headers[k] = v;
      },
      status(c: number) {
        r.code = c;
        return r;
      },
      json(b: unknown) {
        r.body = b;
        return r;
      },
      end() {
        return r;
      },
    };
    return r;
  }

  it('answers through the provider with the bot’s system prompt', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Hola 👋' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const r = res();
    await handler()({ method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' }, body: { messages: [{ role: 'user', content: 'hola' }] } }, r);
    expect(r.code).toBe(200);
    expect(r.body).toEqual({ reply: 'Hola 👋' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe('m1');
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).toContain('Sé amable.');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k-test');
    vi.unstubAllGlobals();
  });

  it('blocks other sites, floods and a missing key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))));
    const h = handler(['https://mine.com']);
    const bad = res();
    await h({ method: 'POST', headers: { origin: 'https://evil.com' }, body: { messages: [{ role: 'user', content: 'x' }] } }, bad);
    expect(bad.code).toBe(403);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = res();
      await h({ method: 'POST', headers: { origin: 'https://mine.com', 'x-forwarded-for': '9.9.9.9' }, body: { messages: [{ role: 'user', content: 'x' }] } }, r);
      codes.push(r.code);
    }
    expect(codes).toEqual([200, 200, 429]);
    const nokey = res();
    await handler([], {})({ method: 'POST', headers: {}, body: { messages: [{ role: 'user', content: 'x' }] } }, nokey);
    expect(nokey.code).toBe(503);
    vi.unstubAllGlobals();
  });
});

describe('Automations service', () => {
  let dir: string;
  let now: number;
  let calls: { rid: string; req: ChatRequestView }[];
  let decisions: string[];
  let runner: AutomationRunner;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zs-auto-'));
    now = at(2026, 3, 10, 8, 0);
    calls = [];
    decisions = [];
    runner = {
      async chat(rid, req, emit) {
        calls.push({ rid, req });
        const e = (ev: ChatEventView) => emit(rid, ev);
        e({ type: 'start', provider: 'p', model: 'm' });
        e({ type: 'conversation', id: 'conv-1' });
        e({ type: 'tool_approval', id: 't1', name: 'mail_send', args: {}, preview: {} } as unknown as ChatEventView);
        e({ type: 'text', delta: 'Resumen listo.' });
        e({ type: 'cost', usd: 0.01, inputTokens: 1, outputTokens: 1, latencyMs: 1 });
        e({ type: 'done', stopReason: 'end' });
      },
      abort: () => undefined,
      toolDecision: (_r, id, d) => decisions.push(`${id}:${d}`),
      answerQuestion: () => undefined,
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = (deliver?: (k: string, t: string) => Promise<void>) =>
    new Automations({ dir, runner, now: () => now, deliver, notify: () => undefined });

  it('runs a due task unattended, refusing actions, and keeps the result', async () => {
    const sent: string[] = [];
    const a = make(async (k, t) => {
      if (k === 'discord') throw new Error('no está conectado');
      sent.push(`${k}:${t}`);
    });
    a.createTask({
      name: 'Correo',
      prompt: 'Resume',
      schedule: { kind: 'daily', time: '09:00', days: [] },
      enabled: true,
      tools: 'read',
      deliver: ['telegram', 'discord'],
    });
    const task = a.status().tasks[0]!;
    expect(task.nextRun).toBe(at(2026, 3, 10, 9, 0));
    a.tick();
    expect(calls).toHaveLength(0);
    now = at(2026, 3, 10, 9, 1);
    a.tick();
    await vi.waitFor(() => expect(a.status().runs[0]?.state).toBe('ok'));
    await vi.waitFor(() => expect(a.status().runs[0]?.delivery).toBeDefined());
    expect(calls[0]!.req.agent).toBe(true);
    expect(calls[0]!.req.mode).toBe('agent');
    expect(calls[0]!.req.noFolder).toBe(true);
    expect(decisions).toEqual(['t1:deny']);
    const run = a.status().runs[0]!;
    expect(run.text).toBe('Resumen listo.');
    expect(run.denied).toBe(1);
    expect(run.usd).toBeCloseTo(0.01);
    expect(run.conversationId).toBe('conv-1');
    expect(sent[0]).toBe('telegram:⏰ Correo\n\nResumen listo.');
    expect(run.delivery).toEqual(['Discord: no está conectado']);
    expect(a.status().tasks[0]!.nextRun).toBe(at(2026, 3, 11, 9, 0));
    // Saved to disk and read back.
    expect(JSON.parse(readFileSync(join(dir, 'automations.json'), 'utf8')).runs).toHaveLength(1);
    expect(make().status().runs[0]!.text).toBe('Resumen listo.');
  });

  it('a "once" task turns itself off after running; chat-only tasks get no tools', async () => {
    const a = make();
    a.createTask({
      name: 'Una vez',
      prompt: 'Hola',
      schedule: { kind: 'once', at: now + 60_000 },
      enabled: true,
      tools: 'none',
      deliver: [],
    });
    expect(() =>
      a.createTask({ name: 'Pasada', prompt: 'x', schedule: { kind: 'once', at: now - 1 }, enabled: true, tools: 'none', deliver: [] }),
    ).toThrow(/pasó/);
    now += 2 * 60_000;
    a.tick();
    await vi.waitFor(() => expect(a.status().runs[0]?.state).toBe('ok'));
    expect(calls[0]!.req.agent).toBe(false);
    const t = a.status().tasks[0]!;
    expect(t.enabled).toBe(false);
    expect(t.nextRun).toBeNull();
  });

  it('runs with a bot: its id and model ride along; deleting the bot unlinks tasks', async () => {
    const a = make();
    const { id } = a.createBot({ name: 'Tutor', model: 'openai/gpt-5', instructions: 'Explica.' });
    a.createTask({ name: 'Clase', prompt: 'Enséñame', schedule: { kind: 'every', minutes: 60 }, enabled: true, tools: 'none', deliver: [], bot: id });
    const task = a.status().tasks[0]!;
    a.runNow(task.id);
    await vi.waitFor(() => expect(a.status().runs[0]?.state).toBe('ok'));
    expect(calls[0]!.req.bot).toBe(id);
    expect(calls[0]!.req.model).toBe('openai/gpt-5');
    expect(a.status().runs[0]!.manual).toBe(true);
    a.deleteBot(id);
    expect(a.status().tasks[0]!.bot).toBeUndefined();
  });

  it('marks a run left halfway as failed after a restart', () => {
    const a = make();
    a.createTask({ name: 'X', prompt: 'y', schedule: { kind: 'every', minutes: 60 }, enabled: true, tools: 'none', deliver: [] });
    runner.chat = () => new Promise(() => undefined);
    void a.run(a.status().tasks[0]!, true);
    expect(a.status().runs[0]!.state).toBe('running');
    const b = make();
    expect(b.status().runs[0]!.state).toBe('failed');
  });
});
