import { useEffect, useRef, useState } from 'react';
import type { TaskView, TasksStatusView, TasksUsageView } from '../../shared/api';
import {
  clampParallel,
  fmtBytes,
  isIdle,
  MAX_PARALLEL,
  splitDiff,
  taskModel,
  USAGE_WARN_BYTES,
  type TaskApprovalView,
} from '../../shared/tasks';
import { sandboxComplete, sandboxConfines, type SandboxCaps } from '../../shared/sandbox';
import { confirmDialog } from '../confirm';
import { errText } from '../errText';
import { t, type Key } from '../i18n';
import { api, focusedChat, refreshModels, setState, toast, updatePrefs, useStore } from '../store';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';
import './tasks-panel.css';

/** Fase 5A: background tasks, each one in a git worktree of its own. */

/**
 * Fase 5B: what "Auto in the worktree" can run on its own on this machine. Commands run
 * without asking only inside a complete sandbox; a missing protection is shown, not faked.
 */
function SandboxLine({ caps }: { caps: SandboxCaps | undefined }) {
  if (!caps) return <p className="tasks-hint">{t('taskSandboxChecking')}</p>;
  const mark = (on: boolean) => (on ? '✓' : '✗');
  const on = caps.kind !== 'none';
  return (
    <p className="tasks-hint tasks-sandbox" role="note">
      {t('taskSandbox', {
        write: mark(on && caps.write),
        network: mark(on && caps.network),
        secrets: mark(on && caps.secrets),
      })}{' '}
      {sandboxComplete(caps)
        ? t('taskSandboxOn')
        : `${caps.reason ?? ''} ${t(sandboxConfines(caps) ? 'taskSandboxConfined' : 'taskSandboxOff')}`}
    </p>
  );
}

const ACTIVE = new Set(['queued', 'preparing', 'working', 'waiting']);

/** What "Nueva tarea en segundo plano" may bring: a prompt (an approved plan…) and a model. */
export interface NewTaskSeed {
  prompt?: string;
  model?: string;
}

/** Window event the focused chat listens to: it opens the Tasks panel on the new-task form. */
export const NEW_TASK_EVENT = 'zx-new-task';

/**
 * Opens the Tasks panel of the focused chat on the new-task form, optionally filled in
 * (command palette, an approved plan). The task is not created until the user confirms.
 */
export function openNewTask(seed: NewTaskSeed = {}): void {
  setState({ chatOpen: true });
  const chat = focusedChat();
  // The chat panel may be mounting: give it a moment to listen.
  setTimeout(
    () => window.dispatchEvent(new CustomEvent(NEW_TASK_EVENT, { detail: { ...seed, chat } })),
    50,
  );
}

/** Tasks that need the user (approval) or are running: the chip's badge. */
export function useTasks(): TasksStatusView | null {
  const [status, setStatus] = useState<TasksStatusView | null>(null);
  useEffect(() => {
    let live = true;
    void api()
      .tasks.status()
      .then((s) => live && setStatus(s))
      .catch(() => undefined);
    const off = api().on((ev) => {
      if (ev.type === 'tasks') setStatus(ev.status);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return status;
}

export function taskBadge(s: TasksStatusView | null): { active: number; waiting: number } {
  const open = (s?.tasks ?? []).filter((x) => !x.closed);
  return {
    active: open.filter((x) => ACTIVE.has(x.state)).length,
    waiting: open.filter((x) => x.state === 'waiting').length,
  };
}

const fmtTime = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return m ? `${m} min ${s}s` : `${s}s`;
};
const fmtUsd = (usd: number | null) => (usd === null ? '—' : `US$${usd.toFixed(usd < 1 ? 3 : 2)}`);

export function TasksPanel({
  status,
  model,
  seed,
  onClose,
  onOpenChat,
}: {
  status: TasksStatusView | null;
  /** The chat's model: the default for a new task. */
  model?: string;
  /** Fills in the new-task form (openNewTask). */
  seed?: NewTaskSeed | null;
  onClose: () => void;
  onOpenChat: (conversationId: string, folder: string) => void;
}) {
  const [prompt, setPrompt] = useState(seed?.prompt ?? '');
  const [chosenModel, setChosenModel] = useState(seed?.model ?? '');
  useEffect(() => {
    if (seed?.prompt) setPrompt(seed.prompt);
    if (seed?.model) setChosenModel(seed.model);
  }, [seed]);
  const models = useStore((s) => s.models);
  const parallel = useStore((s) => s.prefs.taskParallel);
  useEffect(() => {
    if (!models.length) void refreshModels().catch(() => undefined);
  }, [models.length]);
  const [details, setDetails] = useState<string | null>(null);
  const [base, setBase] = useState('');
  const [mode, setMode] = useState<'agent' | 'auto'>('agent');
  const [copyChanges, setCopyChanges] = useState(false);
  const [maxUsd, setMaxUsd] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [setupScript, setSetupScript] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    void api()
      .tasks.setupScript()
      .then(setSetupScript)
      .catch(() => setSetupScript(null));
  }, []);
  // Running tasks: the clock moves.
  useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, []);

  const tasks = (status?.tasks ?? []).slice().reverse();
  const allPending = tasks.flatMap((x) => x.pending.map((p) => ({ task: x, p })));
  const pending = allPending.filter(({ p }) => !p.question);
  const questions = allPending.filter(({ p }) => p.question);
  const idle = tasks.filter((x) => isIdle(x));

  // Disk taken by the worktrees (the main side caches it for a minute).
  const [usage, setUsage] = useState<TasksUsageView | null>(null);
  const openKey = tasks
    .filter((x) => !x.closed)
    .map((x) => `${x.id}:${x.state}`)
    .join();
  useEffect(() => {
    let live = true;
    void api()
      .tasks.usage()
      .then((u) => live && setUsage(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [openKey]);

  const freeSpace = async () => {
    if (!(await confirmDialog(t('taskFreeConfirm', { n: idle.length })))) return;
    await act(async () => {
      const n = await api().tasks.archiveIdle();
      toast(t('taskFreed', { n }));
      setUsage(await api().tasks.usage(true));
    });
  };

  // Y / N answer the first pending approval (when not typing).
  useEffect(() => {
    const first = pending[0];
    if (!first) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const k = e.key.toLowerCase();
      if (k !== 'y' && k !== 'n') return;
      e.preventDefault();
      void act(() => api().tasks.decide(first.task.id, first.p.id, k === 'y' ? 'approve' : 'deny'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast(errText(e));
    }
  };

  const create = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      await api().tasks.create({
        prompt,
        model: taskModel(chosenModel, model),
        mode,
        base: base.trim() || undefined,
        copyChanges,
        setup: setup && Boolean(setupScript),
        maxUsd: Number(maxUsd) > 0 ? Number(maxUsd) : undefined,
        maxMinutes: Number(maxMinutes) > 0 ? Math.round(Number(maxMinutes)) : undefined,
      });
      setPrompt('');
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const merge = async (x: TaskView) => {
    try {
      const r = await api().tasks.merge(x.id);
      if (r.ok) return toast(t('taskMerged', { branch: x.branch }));
      const files = r.files?.length ? `\n\n${r.files.join('\n')}` : '';
      if (
        /conflict/i.test(r.reason) &&
        (await confirmDialog(`${r.reason}\n\n${t('taskResolveAsk')}`))
      )
        return act(() => api().tasks.resolveWithAgent(x.id));
      toast(`${r.reason}${files}`);
    } catch (e) {
      toast(errText(e));
    }
  };

  const pr = async (x: TaskView) => {
    if (!(await confirmDialog(t('taskPrConfirm', { branch: x.branch })))) return;
    await act(async () => {
      const url = await api().tasks.openPr(x.id);
      toast(t('taskPrDone', { url }));
    });
  };

  const discard = async (x: TaskView) => {
    if (!(await confirmDialog(t('taskDiscardConfirm', { branch: x.branch }), { danger: true })))
      return;
    await act(() => api().tasks.discard(x.id));
  };

  const [follow, setFollow] = useState<{ id: string; text: string } | null>(null);
  const sendFollowUp = async () => {
    if (!follow?.text.trim()) return;
    const { id, text } = follow;
    setFollow(null);
    await act(() => api().tasks.resume(id, text));
  };

  return (
    <ModalShell onClose={onClose} className="tasks-panel" labelledBy="tasks-title">
      <header className="tasks-head">
        <Icon name="layers" size={15} />
        <h2 id="tasks-title">{t('tasksPanel')}</h2>
        <span className="tasks-sub">{t('tasksParallel', { n: status?.maxParallel ?? 3 })}</span>
        <label className="tasks-sub tasks-parallel" title={t('taskParallelHint')}>
          {t('taskParallelLabel')}{' '}
          <select
            value={clampParallel(parallel ?? status?.maxParallel)}
            onChange={(e) =>
              void updatePrefs({ taskParallel: clampParallel(Number(e.target.value)) })
            }
          >
            {Array.from({ length: MAX_PARALLEL }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        {usage && usage.total > 0 && (
          <span
            className={`tasks-sub ${usage.total > USAGE_WARN_BYTES ? 'warn' : ''}`}
            title={
              usage.total > USAGE_WARN_BYTES
                ? t('taskDiskWarn', { size: fmtBytes(usage.total) })
                : undefined
            }
          >
            {t('taskDisk', { size: `${usage.partial ? '≥ ' : ''}${fmtBytes(usage.total)}` })}
          </span>
        )}
        {idle.length > 0 && (
          <button
            className={usage && usage.total > USAGE_WARN_BYTES ? 'primary' : undefined}
            onClick={() => void freeSpace()}
          >
            {t('taskFree')}
          </button>
        )}
        {tasks.some((x) => x.closed) && (
          <button onClick={() => void act(() => api().tasks.clearClosed())}>
            {t('tasksClear')}
          </button>
        )}
        <button aria-label={t('close')} title={t('close')} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </header>

      <section className="tasks-new" aria-label={t('taskNew')}>
        <textarea
          value={prompt}
          placeholder={t('taskPromptPh')}
          rows={3}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void create();
            }
          }}
        />
        <div className="tasks-opts">
          <label>
            {t('taskBase')}
            <input value={base} placeholder="HEAD" onChange={(e) => setBase(e.target.value)} />
          </label>
          <label>
            {t('taskModel')}
            <input
              list="tasks-models"
              value={chosenModel}
              placeholder={model || t('taskModelPh')}
              onChange={(e) => setChosenModel(e.target.value)}
            />
            <datalist id="tasks-models">
              {models.map((m) => (
                <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`} />
              ))}
            </datalist>
          </label>
          <label>
            {t('taskMode')}
            <select value={mode} onChange={(e) => setMode(e.target.value as 'agent' | 'auto')}>
              <option value="agent">{t('modeAgent')}</option>
              <option value="auto">{t('modeAuto')}</option>
            </select>
          </label>
          <label>
            {t('taskMaxUsd')}
            <input
              inputMode="decimal"
              value={maxUsd}
              placeholder="—"
              onChange={(e) => setMaxUsd(e.target.value)}
            />
          </label>
          <label>
            {t('taskMaxMin')}
            <input
              inputMode="numeric"
              value={maxMinutes}
              placeholder="—"
              onChange={(e) => setMaxMinutes(e.target.value)}
            />
          </label>
        </div>
        {mode === 'auto' && <SandboxLine caps={status?.sandbox} />}
        <div className="tasks-opts">
          <label className="check" title={t('taskCopyHint')}>
            <input
              type="checkbox"
              checked={copyChanges}
              onChange={(e) => setCopyChanges(e.target.checked)}
            />
            {t('taskCopy')}
          </label>
          {setupScript !== null && (
            <label className="check" title={setupScript}>
              <input type="checkbox" checked={setup} onChange={(e) => setSetup(e.target.checked)} />
              {t('taskSetup')} <code>{setupScript.split('\n')[0]?.slice(0, 60)}</code>
            </label>
          )}
          <span className="spacer" />
          <button
            className="primary"
            disabled={!prompt.trim() || busy}
            onClick={() => void create()}
          >
            {t('taskCreate')}
          </button>
        </div>
        {setupScript === null && <p className="tasks-hint">{t('taskNoSetup')}</p>}
      </section>

      {questions.length > 0 && (
        <section className="tasks-approvals" aria-label={t('taskQuestions')}>
          <div className="tasks-section-title">{t('taskQuestions')}</div>
          {questions.map(({ task: x, p }) => (
            <TaskQuestion
              key={`${x.id}:${p.id}`}
              task={x}
              p={p}
              onAnswer={(a) => void act(() => api().tasks.answer(x.id, p.id, a))}
            />
          ))}
        </section>
      )}

      {pending.length > 0 && (
        <section className="tasks-approvals" aria-label={t('taskApprovals')}>
          <div className="tasks-section-title">
            {t('taskApprovals')} · <kbd>Y</kbd> / <kbd>N</kbd>
          </div>
          {pending.map(({ task: x, p }) => (
            <div key={`${x.id}:${p.id}`} className="tasks-approval">
              <span className="tasks-approval-task">{x.title}</span>
              <code>{p.name}</code>
              <span className="tasks-approval-detail" title={p.detail}>
                {p.detail}
              </span>
              <button
                className="primary"
                onClick={() => void act(() => api().tasks.decide(x.id, p.id, 'approve'))}
              >
                {t('approve')}
              </button>
              <button onClick={() => void act(() => api().tasks.decide(x.id, p.id, 'always'))}>
                {t('taskAlways')}
              </button>
              <button onClick={() => void act(() => api().tasks.decide(x.id, p.id, 'deny'))}>
                {t('reject')}
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="tasks-list" aria-label={t('tasksPanel')}>
        {tasks.length === 0 && <p className="tasks-empty">{t('tasksEmpty')}</p>}
        {tasks.map((x) => {
          const worked = x.workedMs + (x.startedAt ? Date.now() - x.startedAt : 0);
          const live = ACTIVE.has(x.state);
          return (
            <article key={x.id} className={`task-row state-${x.state} ${x.closed ? 'closed' : ''}`}>
              <div className="task-top">
                <span className={`task-state state-${x.state}`}>
                  {x.closed ? t(`taskClosed_${x.closed}` as Key) : t(`taskState_${x.state}` as Key)}
                </span>
                <span className="task-title" title={x.prompt}>
                  {x.title}
                </span>
              </div>
              <div className="task-meta">
                <span title={x.branch}>
                  <Icon name="branch" size={11} /> {x.branch}
                </span>
                {x.model && <span>{x.model}</span>}
                <span>{fmtUsd(x.usd)}</span>
                <span>{fmtTime(worked)}</span>
                {x.stats && (
                  <span>
                    {t('taskFiles', { n: x.stats.files })}{' '}
                    <span className="add">+{x.stats.added}</span>{' '}
                    <span className="del">−{x.stats.removed}</span>
                  </span>
                )}
                <span>PORT {x.port}</span>
                {usage?.byTask[x.id] !== undefined && <span>{fmtBytes(usage.byTask[x.id]!)}</span>}
              </div>
              {(x.error || x.last) && (
                <div className={`task-last ${x.error ? 'error' : ''}`}>{x.error ?? x.last}</div>
              )}
              {follow?.id === x.id && (
                <div className="task-follow">
                  <input
                    autoFocus
                    value={follow.text}
                    placeholder={t('taskFollowUp')}
                    aria-label={t('taskFollowUp')}
                    onChange={(e) => setFollow({ id: x.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void sendFollowUp();
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setFollow(null);
                      }
                    }}
                  />
                  <button className="primary" onClick={() => void sendFollowUp()}>
                    {t('taskSend')}
                  </button>
                </div>
              )}
              {!x.closed && (
                <div className="task-actions">
                  {x.conversationId && (
                    <button onClick={() => onOpenChat(x.conversationId!, x.path)}>
                      {t('taskOpenChat')}
                    </button>
                  )}
                  <button
                    aria-expanded={details === x.id}
                    onClick={() => setDetails((d) => (d === x.id ? null : x.id))}
                  >
                    {details === x.id ? t('taskDetailsHide') : t('taskDetails')}
                  </button>
                  <button onClick={() => void act(() => api().tasks.openFolder(x.id))}>
                    {t('taskOpenFolder')}
                  </button>
                  {(x.state === 'working' || x.state === 'waiting') && (
                    <button onClick={() => void act(() => api().tasks.pause(x.id))}>
                      {t('taskPause')}
                    </button>
                  )}
                  {(x.state === 'paused' || x.state === 'interrupted' || x.state === 'failed') && (
                    <button
                      className="primary"
                      onClick={() => void act(() => api().tasks.resume(x.id))}
                    >
                      {t('taskResume')}
                    </button>
                  )}
                  {live && (
                    <button onClick={() => void act(() => api().tasks.cancel(x.id))}>
                      {t('cancel')}
                    </button>
                  )}
                  {x.state === 'done' && (
                    <>
                      <button className="primary" onClick={() => void merge(x)}>
                        {t('taskMerge')}
                      </button>
                      <button onClick={() => void pr(x)}>{t('taskPr')}</button>
                      <button onClick={() => setFollow({ id: x.id, text: '' })}>
                        {t('taskFollowUpBtn')}
                      </button>
                    </>
                  )}
                  {!live && (
                    <button
                      title={t('taskKeepHint')}
                      onClick={() => void act(() => api().tasks.keep(x.id))}
                    >
                      {t('taskKeep')}
                    </button>
                  )}
                  {!live && (
                    <button className="danger" onClick={() => void discard(x)}>
                      {t('taskDiscard')}
                    </button>
                  )}
                </div>
              )}
              {details === x.id && <TaskDetail task={x} live={live} />}
              {x.closed === 'kept' && (
                <div className="task-actions">
                  <button onClick={() => void act(() => api().tasks.reopen(x.id))}>
                    {t('taskReopen')}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </ModalShell>
  );
}

/** An ask_user question of a background task: pick options, answer in words, or skip. */
const diffClass = (l: string) =>
  l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : undefined;

/** Opening a task: its terminal (commands and output) and its diff against the base commit. */
function TaskDetail({ task, live }: { task: TaskView; live: boolean }) {
  const [tab, setTab] = useState<'terminal' | 'diff'>('terminal');
  const [output, setOutput] = useState('');
  const [diff, setDiff] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let on = true;
    const load = () =>
      void api()
        .tasks.output(task.id)
        .then((o) => on && setOutput(o))
        .catch(() => undefined);
    load();
    // While the task works its terminal grows.
    const h = live ? setInterval(load, 1500) : undefined;
    return () => {
      on = false;
      if (h) clearInterval(h);
    };
  }, [task.id, live, n]);
  useEffect(() => {
    if (tab !== 'diff') return;
    let on = true;
    void api()
      .tasks.diff(task.id)
      .then((d) => on && setDiff(d))
      .catch((e: unknown) => on && setDiff(errText(e)));
    return () => {
      on = false;
    };
  }, [tab, task.id, task.state, n]);
  useEffect(() => {
    if (tab === 'terminal' && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [output, tab]);
  const files = diff ? splitDiff(diff) : [];
  return (
    <div className="task-detail">
      <div className="task-detail-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'terminal'} onClick={() => setTab('terminal')}>
          {t('taskTerminal')}
        </button>
        <button role="tab" aria-selected={tab === 'diff'} onClick={() => setTab('diff')}>
          {t('taskDiff')}
          {files.length > 0 && ` (${files.length})`}
        </button>
        <span className="spacer" />
        <button
          aria-label={t('taskRefresh')}
          title={t('taskRefresh')}
          onClick={() => setN((k) => k + 1)}
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>
      {tab === 'terminal' ? (
        <pre ref={pre} className="task-terminal" aria-label={t('taskTerminal')}>
          {output.trim() ? output : t('taskNoOutput')}
        </pre>
      ) : (
        <div className="task-diff" aria-label={t('taskDiff')}>
          {diff === null ? (
            <p className="tasks-hint">…</p>
          ) : !files.length ? (
            <p className="tasks-hint">{diff.trim() ? diff : t('taskNoDiff')}</p>
          ) : (
            files.map((f) => (
              <details key={f.path} open={files.length <= 5}>
                <summary>
                  <code>{f.path}</code> <span className="add">+{f.added}</span>{' '}
                  <span className="del">−{f.removed}</span>
                </summary>
                <pre>
                  {f.lines.map((l, i) => (
                    <span key={i} className={diffClass(l)}>
                      {l}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              </details>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TaskQuestion({
  task,
  p,
  onAnswer,
}: {
  task: TaskView;
  p: TaskApprovalView;
  onAnswer: (answer: string[] | null) => void;
}) {
  const q = p.question!;
  const [picked, setPicked] = useState<string[]>([]);
  const [own, setOwn] = useState('');
  const toggle = (o: string) =>
    setPicked((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
  return (
    <div className="tasks-question">
      <div className="tasks-question-head">
        <span className="tasks-approval-task">{task.title}</span>
        <span className="tasks-question-text">{q.question}</span>
      </div>
      <div className="tasks-question-options" role="group" aria-label={q.question}>
        {q.options.map((o) =>
          q.multiple ? (
            <label key={o} className="check">
              <input type="checkbox" checked={picked.includes(o)} onChange={() => toggle(o)} />
              {o}
            </label>
          ) : (
            <button key={o} onClick={() => onAnswer([o])}>
              {o}
            </button>
          ),
        )}
      </div>
      <div className="task-follow">
        <input
          value={own}
          placeholder={t('askOther')}
          aria-label={t('askOther')}
          onChange={(e) => setOwn(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && own.trim()) onAnswer([...picked, own.trim()]);
          }}
        />
        {(q.multiple || own.trim()) && (
          <button
            className="primary"
            disabled={!picked.length && !own.trim()}
            onClick={() => onAnswer([...picked, ...(own.trim() ? [own.trim()] : [])])}
          >
            {t('askSend')}
          </button>
        )}
        <button onClick={() => onAnswer(null)}>{t('askSkip')}</button>
      </div>
    </div>
  );
}
