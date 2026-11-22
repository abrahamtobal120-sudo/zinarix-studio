import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocSourceView } from '../../../shared/api';
import {
  describeSchedule,
  type AutoRun,
  type AutoTask,
  type AutoTaskInput,
  type BotDef,
  type BotInput,
  type Delivery,
  type Schedule,
} from '../../../shared/automations';
import { confirmDialog } from '../../confirm';
import { errText, needsRestart } from '../../errText';
import { lang } from '../../i18n';
import { openLink } from '../../links';
import { api, newChat, setState, toast, useStore } from '../../store';
import { Icon } from '../Icon';
import { ta } from './automationsStrings';
import './automations.css';

type Tab = 'tasks' | 'bots' | 'widget';
const DATE_FMT = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const when = (ts: number) => DATE_FMT.format(ts);
const DAY_LETTERS = lang === 'en' ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DELIVERY_NAMES: Record<Delivery, string> = { telegram: 'Telegram', discord: 'Discord', whatsapp: 'WhatsApp' };
const ICONS = ['🤖', '💬', '🛍️', '🧑‍💻', '📚', '🧠', '📈', '🛠️', '🎨', '🩺', '⚖️', '🏠'];

/** Runs an API call; errors become a toast. */
async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast(errText(e));
    return undefined;
  }
}

function useModels(): string[] {
  const models = useStore((s) => s.models);
  return useMemo(() => models.map((m) => `${m.provider}/${m.id}`), [models]);
}

/** Opens a chat that talks as the bot. */
export function openBotChat(bot: BotDef): void {
  newChat({
    bot: bot.id,
    title: `${bot.icon} ${bot.name}`.slice(0, 60),
    mode: bot.mode === 'agent' ? 'agent' : 'ask',
    ...(bot.model ? { model: bot.model } : {}),
    ...(bot.mode === 'chat' ? { noFolder: true } : {}),
  });
  setState({ chatOpen: true });
}

export function AutomationsPanel() {
  const status = useStore((s) => s.automations);
  const [tab, setTab] = useState<Tab>('tasks');
  // Why the panel has nothing to show: 'restart' when the running app is older than this window.
  const [problem, setProblem] = useState<{ kind: 'restart' | 'error'; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const automations = await api().automations.status();
      setProblem(null);
      setState({ automations });
    } catch (e) {
      setProblem({ kind: needsRestart(e) ? 'restart' : 'error', text: errText(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const restart = async () => {
    try {
      await api().app.relaunch();
    } catch {
      // An app that old cannot restart itself either: the user closes and opens it.
      toast(ta('restartManual'));
    }
  };
  return (
    <div className="run-panel auto-panel">
      <div className="sidebar-title">
        <span>{ta('title')}</span>
      </div>
      <div className="auto-tabs" role="tablist">
        {(['tasks', 'bots', 'widget'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`auto-tab${tab === k ? ' on' : ''}`}
            onClick={() => setTab(k)}
          >
            <Icon name={k === 'tasks' ? 'clock' : k === 'bots' ? 'bot' : 'globe'} size={14} />{' '}
            {k === 'tasks' ? ta('tabTasks') : k === 'bots' ? ta('tabBots') : ta('tabWidget')}
          </button>
        ))}
      </div>
      <div className="run-body auto-body">
        {problem?.kind === 'restart' ? (
          <div className="auto-notice" role="alert">
            <strong>{ta('restartTitle')}</strong>
            <p className="small">{ta('restartBody')}</p>
            <div className="auto-actions">
              <button className="primary" onClick={() => void restart()}>
                {ta('restartNow')}
              </button>
              <button onClick={() => void load()}>{ta('retry')}</button>
            </div>
          </div>
        ) : !status ? (
          problem ? (
            <div className="auto-notice" role="alert">
              <p className="small">{ta('loadFailed', { error: problem.text })}</p>
              <div className="auto-actions">
                <button onClick={() => void load()}>{ta('retry')}</button>
              </div>
            </div>
          ) : (
            <div className="dim small">{ta('loading')}</div>
          )
        ) : tab === 'tasks' ? (
          <TasksTab tasks={status.tasks} runs={status.runs} bots={status.bots} running={status.running} />
        ) : tab === 'bots' ? (
          <BotsTab bots={status.bots} />
        ) : (
          <WidgetTab bots={status.bots} />
        )}
      </div>
    </div>
  );
}

// ---------------- Tasks ----------------

const blankTask = (): AutoTaskInput => ({
  name: '',
  prompt: '',
  schedule: { kind: 'daily', time: '09:00', days: [] },
  enabled: true,
  tools: 'read',
  deliver: [],
});

function TasksTab({ tasks, runs, bots, running }: { tasks: AutoTask[]; runs: AutoRun[]; bots: BotDef[]; running: string[] }) {
  const [editing, setEditing] = useState<{ id?: string; input: AutoTaskInput } | null>(null);
  const templates: { name: string; prompt: string; schedule: Schedule }[] = [
    { name: ta('tplMail'), prompt: ta('tplMailPrompt'), schedule: { kind: 'daily', time: '09:00', days: [] } },
    { name: ta('tplDeps'), prompt: ta('tplDepsPrompt'), schedule: { kind: 'daily', time: '10:00', days: [1] } },
    { name: ta('tplVercel'), prompt: ta('tplVercelPrompt'), schedule: { kind: 'every', minutes: 60 } },
    { name: ta('tplNews'), prompt: ta('tplNewsPrompt'), schedule: { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5] } },
  ];
  const root = useStore((s) => s.workspace?.root);
  if (editing)
    return (
      <TaskForm
        initial={editing.input}
        id={editing.id}
        bots={bots}
        onDone={() => setEditing(null)}
      />
    );
  return (
    <>
      <p className="dim small">{ta('tasksIntro')}</p>
      <button className="primary auto-wide" onClick={() => setEditing({ input: blankTask() })}>
        <Icon name="plus" size={14} /> {ta('newTask')}
      </button>
      {tasks.length === 0 && (
        <div className="auto-templates">
          <p className="dim small">{ta('noTasks')}</p>
          {templates.map((tp) => (
            <button
              key={tp.name}
              className="auto-chip"
              onClick={() =>
                setEditing({
                  input: {
                    ...blankTask(),
                    name: tp.name,
                    prompt: tp.prompt,
                    schedule: tp.schedule,
                    ...(tp.name === ta('tplDeps') && root ? { folder: root } : {}),
                  },
                })
              }
            >
              {tp.name}
            </button>
          ))}
        </div>
      )}
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          running={running.includes(task.id)}
          bot={bots.find((b) => b.id === task.bot)}
          onEdit={() =>
            setEditing({
              id: task.id,
              input: {
                name: task.name,
                prompt: task.prompt,
                schedule: task.schedule,
                enabled: task.enabled,
                model: task.model,
                bot: task.bot,
                tools: task.tools,
                folder: task.folder,
                deliver: task.deliver,
              },
            })
          }
        />
      ))}
      <p className="dim small auto-note">
        <Icon name="info" size={12} /> {ta('tasksOpenOnly')}
      </p>
      <Runs runs={runs} />
    </>
  );
}

function TaskRow({ task, running, bot, onEdit }: { task: AutoTask; running: boolean; bot?: BotDef; onEdit: () => void }) {
  const set = (p: Promise<unknown>) => void act(() => p);
  return (
    <div className={`auto-card${task.enabled ? '' : ' off'}`}>
      <div className="auto-card-head">
        <label className="auto-switch" title={ta('enabled')}>
          <input
            type="checkbox"
            checked={task.enabled}
            onChange={(e) =>
              void act(() => api().automations.setEnabled(task.id, e.target.checked)).then(
                (s) => s && setState({ automations: s }),
              )
            }
          />
        </label>
        <strong className="auto-card-title">
          {bot ? `${bot.icon} ` : ''}
          {task.name}
        </strong>
      </div>
      <div className="dim small">
        {describeSchedule(task.schedule, lang === 'en' ? 'en' : 'es')} ·{' '}
        {running
          ? ta('running')
          : !task.enabled
            ? ta('paused')
            : task.nextRun
              ? ta('next', { at: when(task.nextRun) })
              : ta('noNext')}
      </div>
      <div className="auto-actions">
        {running ? (
          <button className="link small" onClick={() => set(api().automations.cancel(task.id))}>
            <Icon name="stop" size={12} /> {ta('stop')}
          </button>
        ) : (
          <button
            className="link small"
            onClick={() =>
              void act(() => api().automations.runNow(task.id)).then((s) => {
                if (s) {
                  setState({ automations: s });
                  toast(ta('started'));
                }
              })
            }
          >
            <Icon name="play" size={12} /> {ta('runNow')}
          </button>
        )}
        <button className="link small" onClick={onEdit}>
          <Icon name="edit" size={12} /> {ta('edit')}
        </button>
        <button
          className="link small"
          onClick={async () => {
            if (!(await confirmDialog(ta('removeTaskAsk', { name: task.name }), { danger: true }))) return;
            const s = await act(() => api().automations.deleteTask(task.id));
            if (s) setState({ automations: s });
          }}
        >
          <Icon name="trash" size={12} /> {ta('remove')}
        </button>
      </div>
    </div>
  );
}

function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function TaskForm({ initial, id, bots, onDone }: { initial: AutoTaskInput; id?: string; bots: BotDef[]; onDone: () => void }) {
  const [f, setF] = useState<AutoTaskInput>(initial);
  const [can, setCan] = useState<Record<Delivery, boolean>>({ telegram: false, discord: false, whatsapp: false });
  const models = useModels();
  const root = useStore((s) => s.workspace?.root);
  useEffect(() => {
    void api().automations.deliveries().then(setCan).catch(() => undefined);
  }, []);
  const patch = (p: Partial<AutoTaskInput>) => setF((x) => ({ ...x, ...p }));
  const s = f.schedule;
  const setKind = (kind: Schedule['kind']) =>
    patch({
      schedule:
        kind === 'daily'
          ? { kind, time: '09:00', days: [] }
          : kind === 'every'
            ? { kind, minutes: 60 }
            : { kind, at: Date.now() + 60 * 60_000 },
    });
  const save = async () => {
    const input: AutoTaskInput = {
      ...f,
      model: f.model || undefined,
      bot: f.bot || undefined,
      folder: f.tools === 'read' ? f.folder || undefined : undefined,
    };
    const r = await act(() =>
      id ? api().automations.updateTask(id, input) : api().automations.createTask(input),
    );
    if (r) {
      setState({ automations: r });
      onDone();
    }
  };
  const everyHours = s.kind === 'every' && s.minutes % 60 === 0;
  return (
    <div className="auto-form">
      <label className="auto-field">
        <span>{ta('name')}</span>
        <input value={f.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} autoFocus />
      </label>
      <label className="auto-field">
        <span>{ta('prompt')}</span>
        <textarea rows={4} value={f.prompt} placeholder={ta('promptPh')} onChange={(e) => patch({ prompt: e.target.value })} />
      </label>
      <div className="auto-field">
        <span>{ta('when')}</span>
        <select value={s.kind} onChange={(e) => setKind(e.target.value as Schedule['kind'])}>
          <option value="daily">{ta('daily')}</option>
          <option value="every">{ta('every')}</option>
          <option value="once">{ta('once')}</option>
        </select>
        {s.kind === 'daily' && (
          <>
            <div className="auto-inline">
              <span className="small">{ta('at')}</span>
              <input type="time" value={s.time} onChange={(e) => patch({ schedule: { ...s, time: e.target.value } })} />
            </div>
            <div className="small dim">{ta('days')}</div>
            <div className="auto-days">
              {DAY_LETTERS.map((d, i) => {
                const on = s.days.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    className={`auto-day${on ? ' on' : ''}`}
                    onClick={() =>
                      patch({
                        schedule: { ...s, days: on ? s.days.filter((x) => x !== i) : [...s.days, i].sort() },
                      })
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {s.kind === 'every' && (
          <div className="auto-inline">
            <span className="small">{ta('everyN')}</span>
            <input
              type="number"
              min={everyHours ? 1 : 5}
              value={everyHours ? s.minutes / 60 : s.minutes}
              onChange={(e) => {
                const n = Math.max(1, Number(e.target.value) || 1);
                patch({ schedule: { kind: 'every', minutes: everyHours ? n * 60 : n } });
              }}
            />
            <select
              value={everyHours ? 'h' : 'm'}
              onChange={(e) =>
                patch({
                  schedule: {
                    kind: 'every',
                    minutes: e.target.value === 'h' ? Math.max(1, Math.round(s.minutes / 60)) * 60 : Math.max(5, s.minutes),
                  },
                })
              }
            >
              <option value="m">{ta('minutes')}</option>
              <option value="h">{ta('hours')}</option>
            </select>
          </div>
        )}
        {s.kind === 'once' && (
          <input
            type="datetime-local"
            value={toLocalInput(s.at)}
            onChange={(e) => {
              const at = new Date(e.target.value).getTime();
              if (Number.isFinite(at)) patch({ schedule: { kind: 'once', at } });
            }}
          />
        )}
      </div>
      <label className="auto-field">
        <span>{ta('bot')}</span>
        <select value={f.bot ?? ''} onChange={(e) => patch({ bot: e.target.value || undefined })}>
          <option value="">{ta('botNone')}</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.icon} {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="auto-field">
        <span>{ta('model')}</span>
        <select value={f.model ?? ''} onChange={(e) => patch({ model: e.target.value || undefined })}>
          <option value="">{ta('modelDefault')}</option>
          {[...new Set([...(f.model ? [f.model] : []), ...models])].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <div className="auto-field">
        <span>{ta('tools')}</span>
        <label className="auto-radio">
          <input type="radio" checked={f.tools === 'none'} onChange={() => patch({ tools: 'none' })} /> {ta('toolsNone')}
        </label>
        <label className="auto-radio">
          <input type="radio" checked={f.tools === 'read'} onChange={() => patch({ tools: 'read' })} /> {ta('toolsRead')}
        </label>
        {f.tools === 'read' && <div className="small dim">{ta('toolsReadHint')}</div>}
      </div>
      {f.tools === 'read' && (
        <div className="auto-field">
          <span>{ta('folder')}</span>
          <div className="auto-inline">
            <span className="small auto-path" title={f.folder}>
              {f.folder ? f.folder.split(/[\\/]/).pop() : ta('folderNone')}
            </span>
            {root && f.folder !== root && (
              <button className="link small" onClick={() => patch({ folder: root })}>
                {ta('folderCurrent')}
              </button>
            )}
            <button
              className="link small"
              onClick={() =>
                void api()
                  .workspace.pickChatFolder()
                  .then((r) => r && patch({ folder: r.path }))
              }
            >
              {ta('folderPick')}
            </button>
            {f.folder && (
              <button className="link small" aria-label={ta('folderNone')} onClick={() => patch({ folder: undefined })}>
                <Icon name="x" size={11} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="auto-field">
        <span>{ta('deliver')}</span>
        {(['telegram', 'discord', 'whatsapp'] as const).map((k) => (
          <label key={k} className="auto-radio">
            <input
              type="checkbox"
              checked={f.deliver.includes(k)}
              onChange={(e) =>
                patch({ deliver: e.target.checked ? [...f.deliver, k] : f.deliver.filter((x) => x !== k) })
              }
            />{' '}
            {DELIVERY_NAMES[k]} {!can[k] && <span className="dim small">{ta('deliverOff')}</span>}
          </label>
        ))}
        <div className="small dim">{ta('deliverHint')}</div>
      </div>
      <label className="auto-radio">
        <input type="checkbox" checked={f.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> {ta('enabled')}
      </label>
      <div className="auto-actions">
        <button className="primary" disabled={!f.name.trim() || !f.prompt.trim()} onClick={() => void save()}>
          {id ? ta('save') : ta('create')}
        </button>
        <button onClick={onDone}>{ta('cancel')}</button>
      </div>
    </div>
  );
}

function Runs({ runs }: { runs: AutoRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="auto-runs">
      <div className="auto-section">
        <span>{ta('history')}</span>
        {runs.some((r) => r.state !== 'running') && (
          <button
            className="link small"
            onClick={async () => {
              if (!(await confirmDialog(ta('clearAsk'), { danger: true }))) return;
              const s = await act(() => api().automations.clearRuns());
              if (s) setState({ automations: s });
            }}
          >
            {ta('clear')}
          </button>
        )}
      </div>
      {runs.length === 0 && <p className="dim small">{ta('noRuns')}</p>}
      {runs.slice(0, 30).map((r) => {
        const isOpen = open === r.id;
        return (
          <div key={r.id} className={`auto-run auto-run-${r.state}`}>
            <button className="auto-run-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
              <span className="auto-run-dot" aria-hidden="true" />
              <span className="auto-run-name">{r.taskName}</span>
              <span className="dim small">
                {when(r.startedAt)}
                {r.manual ? ` · ${ta('manual')}` : ''}
              </span>
            </button>
            {!isOpen && r.state !== 'running' && (
              <div className="small dim auto-run-peek">{r.error ?? r.text.slice(0, 140)}</div>
            )}
            {isOpen && (
              <div className="auto-run-body">
                {r.state === 'running' && <div className="small dim">{ta('running')}</div>}
                {r.error && <div className="small auto-error">{r.error}</div>}
                {r.text && <div className="small auto-run-text">{r.text}</div>}
                {r.denied > 0 && <div className="small dim"><Icon name="warning" size={14} /> {ta('denied', { n: r.denied })}</div>}
                {r.delivery?.map((d) => (
                  <div key={d} className="small auto-error">
                    {d}
                  </div>
                ))}
                <div className="dim small">
                  {r.model ?? ''}
                  {r.usd ? ` · $${r.usd.toFixed(4)}` : ''}
                </div>
                <div className="auto-actions">
                  {r.conversationId && (
                    <button
                      className="link small"
                      onClick={() => {
                        newChat({ conversationId: r.conversationId, title: r.taskName.slice(0, 60) });
                        setState({ chatOpen: true });
                      }}
                    >
                      <Icon name="message" size={12} /> {ta('openChat')}
                    </button>
                  )}
                  {r.text && (
                    <button
                      className="link small"
                      onClick={() => void navigator.clipboard.writeText(r.text).then(() => toast(ta('copied')))}
                    >
                      <Icon name="copy" size={12} /> {ta('copy')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Bots ----------------

const blankBot = (): BotInput => ({
  name: '',
  icon: '🤖',
  description: '',
  instructions: '',
  knowledge: '',
  mode: 'chat',
  docs: [],
  greeting: '',
});

function BotsTab({ bots }: { bots: BotDef[] }) {
  const [editing, setEditing] = useState<{ id?: string; input: BotInput } | null>(null);
  const templates: BotInput[] = [
    { ...blankBot(), name: ta('tplSupport'), icon: '🛍️', description: ta('tplSupportDesc'), instructions: ta('tplSupportInstr'), knowledge: ta('tplSupportKnow'), greeting: ta('greetingPh') },
    { ...blankBot(), name: ta('tplReviewer'), icon: '🧑‍💻', description: ta('tplReviewerDesc'), instructions: ta('tplReviewerInstr'), mode: 'agent' },
    { ...blankBot(), name: ta('tplTutor'), icon: '📚', description: ta('tplTutorDesc'), instructions: ta('tplTutorInstr') },
  ];
  if (editing) return <BotForm initial={editing.input} id={editing.id} onDone={() => setEditing(null)} />;
  return (
    <>
      <p className="dim small">{ta('botsIntro')}</p>
      <div className="auto-actions">
        <button className="primary" onClick={() => setEditing({ input: blankBot() })}>
          <Icon name="plus" size={14} /> {ta('newBot')}
        </button>
        <button
          onClick={() =>
            void act(() => api().automations.importBot()).then((r) => {
              if (!r) return;
              setState({ automations: r.status });
              toast(ta('imported'));
            })
          }
        >
          <Icon name="download" size={14} /> {ta('importBot')}
        </button>
      </div>
      {bots.length === 0 && (
        <div className="auto-templates">
          <p className="dim small">{ta('noBots')}</p>
          {templates.map((tp) => (
            <button key={tp.name} className="auto-chip" onClick={() => setEditing({ input: tp })}>
              {tp.icon} {tp.name}
            </button>
          ))}
        </div>
      )}
      {bots.map((b) => (
        <div key={b.id} className="auto-card">
          <div className="auto-card-head">
            <span className="auto-bot-icon" aria-hidden="true">
              {b.icon}
            </span>
            <div className="auto-card-text">
              <strong className="auto-card-title">{b.name}</strong>
              {b.description && <div className="dim small">{b.description}</div>}
              <div className="dim small">
                {b.mode === 'agent' ? ta('modeAgent').split(' (')[0] : ta('modeChat').split(' (')[0]}
                {b.model ? ` · ${b.model}` : ''}
              </div>
            </div>
          </div>
          <div className="auto-actions">
            <button className="link small" onClick={() => openBotChat(b)}>
              <Icon name="message" size={12} /> {ta('useInChat')}
            </button>
            <button
              className="link small"
              onClick={() =>
                setEditing({
                  id: b.id,
                  input: {
                    name: b.name,
                    icon: b.icon,
                    description: b.description,
                    instructions: b.instructions,
                    knowledge: b.knowledge,
                    model: b.model,
                    mode: b.mode,
                    docs: b.docs,
                    greeting: b.greeting,
                  },
                })
              }
            >
              <Icon name="edit" size={12} /> {ta('edit')}
            </button>
            <button
              className="link small"
              onClick={() => void act(() => api().automations.exportBot(b.id)).then((ok) => ok && toast(ta('exported')))}
            >
              <Icon name="external" size={12} /> {ta('exportBot')}
            </button>
            <button
              className="link small"
              onClick={() =>
                void act(() => api().automations.saveAsAgent(b.id)).then(
                  (path) => path && toast(ta('asAgentDone', { path })),
                )
              }
            >
              <Icon name="users" size={12} /> {ta('asAgent')}
            </button>
            <button
              className="link small"
              onClick={async () => {
                if (!(await confirmDialog(ta('removeBotAsk', { name: b.name }), { danger: true }))) return;
                const s = await act(() => api().automations.deleteBot(b.id));
                if (s) setState({ automations: s });
              }}
            >
              <Icon name="trash" size={12} /> {ta('remove')}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function BotForm({ initial, id, onDone }: { initial: BotInput; id?: string; onDone: () => void }) {
  const [f, setF] = useState<BotInput>(initial);
  const [docs, setDocs] = useState<DocSourceView[]>([]);
  const models = useModels();
  useEffect(() => {
    void api().knowledge.docs().then(setDocs).catch(() => undefined);
  }, []);
  const patch = (p: Partial<BotInput>) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    const input = { ...f, model: f.model || undefined };
    if (id) {
      const s = await act(() => api().automations.updateBot(id, input));
      if (!s) return;
      setState({ automations: s });
    } else {
      const r = await act(() => api().automations.createBot(input));
      if (!r) return;
      setState({ automations: r.status });
    }
    toast(ta('botSaved'));
    onDone();
  };
  return (
    <div className="auto-form">
      <div className="auto-field">
        <span>{ta('icon')}</span>
        <div className="auto-icons">
          {[...new Set([f.icon, ...ICONS])].map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={f.icon === i}
              className={`auto-icon${f.icon === i ? ' on' : ''}`}
              onClick={() => patch({ icon: i })}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      <label className="auto-field">
        <span>{ta('name')}</span>
        <input value={f.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} autoFocus />
      </label>
      <label className="auto-field">
        <span>{ta('description')}</span>
        <input value={f.description} maxLength={300} onChange={(e) => patch({ description: e.target.value })} />
      </label>
      <label className="auto-field">
        <span>{ta('instructions')}</span>
        <textarea rows={6} value={f.instructions} placeholder={ta('instructionsPh')} onChange={(e) => patch({ instructions: e.target.value })} />
      </label>
      <label className="auto-field">
        <span>{ta('knowledge')}</span>
        <textarea rows={5} value={f.knowledge} placeholder={ta('knowledgePh')} onChange={(e) => patch({ knowledge: e.target.value })} />
      </label>
      <label className="auto-field">
        <span>{ta('model')}</span>
        <select value={f.model ?? ''} onChange={(e) => patch({ model: e.target.value || undefined })}>
          <option value="">{ta('modelDefault')}</option>
          {[...new Set([...(f.model ? [f.model] : []), ...models])].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <div className="auto-field">
        <span>{ta('mode')}</span>
        <label className="auto-radio">
          <input type="radio" checked={f.mode === 'chat'} onChange={() => patch({ mode: 'chat' })} /> {ta('modeChat')}
        </label>
        <label className="auto-radio">
          <input type="radio" checked={f.mode === 'agent'} onChange={() => patch({ mode: 'agent' })} /> {ta('modeAgent')}
        </label>
      </div>
      <div className="auto-field">
        <span>{ta('docs')}</span>
        {docs.length === 0 && <div className="small dim">{ta('docsNone')}</div>}
        {docs.map((d) => (
          <label key={d.id} className="auto-radio">
            <input
              type="checkbox"
              checked={f.docs.includes(d.name)}
              onChange={(e) =>
                patch({ docs: e.target.checked ? [...f.docs, d.name] : f.docs.filter((x) => x !== d.name) })
              }
            />{' '}
            {d.name} <span className="dim small">{d.url}</span>
          </label>
        ))}
      </div>
      <label className="auto-field">
        <span>{ta('greeting')}</span>
        <input value={f.greeting} maxLength={500} placeholder={ta('greetingPh')} onChange={(e) => patch({ greeting: e.target.value })} />
      </label>
      <div className="auto-actions">
        <button className="primary" disabled={!f.name.trim()} onClick={() => void save()}>
          {id ? ta('save') : ta('create')}
        </button>
        <button onClick={onDone}>{ta('cancel')}</button>
      </div>
    </div>
  );
}

// ---------------- Widget ----------------

function WidgetTab({ bots }: { bots: BotDef[] }) {
  const [botId, setBotId] = useState<string>(bots[0]?.id ?? '');
  const bot = bots.find((b) => b.id === botId) ?? bots[0];
  const [w, setW] = useState(bot?.widget);
  const [origins, setOrigins] = useState((bot?.widget.origins ?? []).join('\n'));
  const [sendKey, setSendKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vercel, setVercel] = useState<boolean | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);
  useEffect(() => {
    setW(bot?.widget);
    setOrigins((bot?.widget.origins ?? []).join('\n'));
    setKeyMissing(false);
  }, [bot?.id]);
  useEffect(() => {
    void api()
      .vercel.status()
      .then((s) => setVercel(s.connected))
      .catch(() => setVercel(false));
  }, []);
  if (!bot || !w) return <p className="dim small">{ta('widgetNoBots')}</p>;
  const input = (): BotInput => ({
    name: bot.name,
    icon: bot.icon,
    description: bot.description,
    instructions: bot.instructions,
    knowledge: bot.knowledge,
    model: bot.model,
    mode: bot.mode,
    docs: bot.docs,
    greeting: bot.greeting,
    widget: {
      title: w.title,
      color: w.color,
      position: w.position,
      perMinute: w.perMinute,
      origins: origins.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
    },
  });
  const saveSettings = async (quiet = false) => {
    const s = await act(() => api().automations.updateBot(bot.id, input()));
    if (s) {
      setState({ automations: s });
      if (!quiet) toast(ta('wSaved'));
    }
    return Boolean(s);
  };
  const snippet = bot.widget.vercelUrl ? `<script src="${bot.widget.vercelUrl}/widget.js" defer></script>` : '';
  return (
    <>
      <p className="dim small">{ta('widgetIntro')}</p>
      <label className="auto-field">
        <span>{ta('widgetBot')}</span>
        <select value={bot.id} onChange={(e) => setBotId(e.target.value)}>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.icon} {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="auto-field">
        <span>{ta('wTitle')}</span>
        <input value={w.title} maxLength={60} onChange={(e) => setW({ ...w, title: e.target.value })} />
      </label>
      <div className="auto-inline">
        <label className="auto-inline">
          <span className="small">{ta('wColor')}</span>
          <input type="color" value={w.color} onChange={(e) => setW({ ...w, color: e.target.value })} />
        </label>
        <select value={w.position} aria-label={ta('wPosition')} onChange={(e) => setW({ ...w, position: e.target.value as 'left' | 'right' })}>
          <option value="right">{ta('wRight')}</option>
          <option value="left">{ta('wLeft')}</option>
        </select>
      </div>
      <label className="auto-field">
        <span>{ta('wOrigins')}</span>
        <textarea rows={2} value={origins} placeholder={ta('wOriginsPh')} onChange={(e) => setOrigins(e.target.value)} />
      </label>
      <label className="auto-field">
        <span>{ta('wPerMinute')}</span>
        <input
          type="number"
          min={1}
          max={60}
          value={w.perMinute}
          onChange={(e) => setW({ ...w, perMinute: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })}
        />
      </label>
      <div className="auto-actions">
        <button onClick={() => void saveSettings()}>{ta('wSave')}</button>
        <button
          onClick={async () => {
            if (!(await saveSettings(true))) return;
            const r = await act(() => api().automations.exportWidget(bot.id));
            if (r) toast(ta('wExported', { dir: r.dir }));
          }}
        >
          <Icon name="folder" size={12} /> {ta('wExport')}
        </button>
      </div>
      <div className="auto-publish">
        <label className="auto-radio">
          <input type="checkbox" checked={sendKey} onChange={(e) => setSendKey(e.target.checked)} /> {ta('wSendKey')}
        </label>
        <div className="small dim">{ta('wSendKeyHint')}</div>
        <button
          className="primary auto-wide"
          disabled={busy || vercel === false}
          onClick={async () => {
            if (!(await saveSettings(true))) return;
            setBusy(true);
            const r = await act(() => api().automations.publishWidget(bot.id, sendKey));
            setBusy(false);
            if (!r) return;
            setState({ automations: r.status });
            setKeyMissing(!r.keySet);
            toast(ta('wPublished', { url: r.url }));
          }}
        >
          <Icon name="vercel" size={14} /> {busy ? ta('wPublishing') : ta('wPublish')}
        </button>
        {vercel === false && <div className="small dim">{ta('wNoVercel')}</div>}
      </div>
      {snippet && (
        <div className="auto-snippet">
          <div className="small">{ta('wSnippet')}</div>
          <code>{snippet}</code>
          <div className="auto-actions">
            <button className="link small" onClick={() => void navigator.clipboard.writeText(snippet).then(() => toast(ta('copied')))}>
              <Icon name="copy" size={12} /> {ta('copy')}
            </button>
            <button className="link small" onClick={(e) => openLink(bot.widget.vercelUrl!, e)}>
              <Icon name="external" size={12} /> {ta('wTest')}
            </button>
          </div>
          {keyMissing && <div className="small auto-error">{ta('wKeyMissing')}</div>}
        </div>
      )}
      <p className="dim small auto-note">{ta('wModelNote', { model: bot.model ?? ta('modelAppDefault') })}</p>
      {bot.docs.length > 0 && <p className="dim small auto-note">{ta('wDocsNote')}</p>}
      <p className="dim small auto-note"><Icon name="warning" size={14} /> <span>{ta('wCost')}</span></p>
    </>
  );
}
