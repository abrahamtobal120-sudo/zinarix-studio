import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMode, Question, Todo } from '../../shared/agentModes';
import { CHAT_MODES, parseTodos, todoProgress } from '../../shared/agentModes';
import { t } from '../i18n';
import type { Key } from '../i18n';
import { Icon, type IconName } from './Icon';
import { ModalShell } from './ModalShell';
import { useDismiss, menuArrows } from './ChatSendMenu';
import './agent-plan.css';

/**
 * Fase 3 — the chat's mode (ask / plan / agent / auto-approve), the agent's live task list,
 * its multiple-choice questions and the approve / edit / reject bar of a plan.
 */

const MODE_TEXT: Record<ChatMode, { label: Key; hint: Key; icon: IconName }> = {
  ask: { label: 'modeAsk', hint: 'modeAskHint', icon: 'message' },
  plan: { label: 'modePlan', hint: 'modePlanHint', icon: 'eye' },
  agent: { label: 'modeAgent', hint: 'modeAgentHint', icon: 'agent' },
  auto: { label: 'modeAuto', hint: 'modeAutoHint', icon: 'bolt' },
  full: { label: 'modeFull', hint: 'modeFullHint', icon: 'unlock' },
};

export const modeLabel = (m: ChatMode): string => t(MODE_TEXT[m].label);
export const modeHint = (m: ChatMode): string => t(MODE_TEXT[m].hint);

/** The mode pill next to the message box: a menu with the five modes (Shift+Tab cycles the
 * first four; full access is only chosen here). */
export function ModeMenu({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [menu, button], button);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }, [open]);
  const pick = (m: ChatMode) => {
    setOpen(false);
    onChange(m);
    button.current?.focus();
  };
  return (
    <div className="mode-menu-wrap">
      <button
        ref={button}
        type="button"
        className={`pill mode-pill mode-${mode}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('modeTitle', { mode: modeLabel(mode), hint: modeHint(mode) })}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={MODE_TEXT[mode].icon} size={13} />
        <span>{modeLabel(mode)}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      {open && (
        <div
          ref={menu}
          className="mode-menu"
          role="menu"
          aria-label={t('modeTitle', { mode: modeLabel(mode), hint: modeHint(mode) })}
          onKeyDown={menuArrows}
        >
          {CHAT_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitem"
              aria-current={m === mode}
              className={`mode-item mode-${m} ${m === mode ? 'on' : ''}`}
              onClick={() => pick(m)}
            >
              <Icon name={MODE_TEXT[m].icon} size={14} />
              <span className="mode-item-text">
                <b>{modeLabel(m)}</b>
                <span className="dim">{modeHint(m)}</span>
              </span>
              {m === mode && <Icon name="check" size={13} />}
            </button>
          ))}
          <div className="mode-menu-foot dim">
            <kbd>Shift</kbd>+<kbd>Tab</kbd>
          </div>
        </div>
      )}
    </div>
  );
}

/** The newest task list the agent wrote with todo_write in these messages (null = none). */
export function latestTodos(turns: readonly { parts?: readonly object[] }[]): Todo[] | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const parts = turns[i]!.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j] as { kind?: string; name?: string; status?: string; args?: unknown };
      if (p.kind !== 'tool' || p.name !== 'todo_write' || p.status === 'error') continue;
      const r = parseTodos((p.args as Record<string, unknown> | undefined)?.todos);
      if ('todos' in r) return r.todos;
    }
  }
  return null;
}

const TODO_ICON: Record<Todo['status'], IconName> = {
  pending: 'clock',
  in_progress: 'refresh',
  completed: 'check',
};

/** The agent's task list, above the message box while there is one. */
export function TaskList({ todos, live }: { todos: Todo[]; live: boolean }) {
  /** null = automatic: open while there is work left, folded once everything is done. */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const { done, total } = todoProgress(todos);
  const finished = total > 0 && done === total && !live;
  // A new list (the agent started over) goes back to automatic.
  const first = todos[0]?.content;
  useEffect(() => setChosen(null), [first, total]);
  if (!total) return null;
  const open = chosen ?? !finished;
  const setOpen = (f: (o: boolean) => boolean) => setChosen(f(open));
  return (
    <section
      className={`task-list ${open ? 'open' : ''} ${finished ? 'finished' : ''}`}
      aria-label={t('tasksTitle')}
    >
      <button
        type="button"
        className="task-list-head plain-btn"
        aria-expanded={open}
        title={open ? t('tasksHide') : t('tasksShow')}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="flag" size={13} />
        <b>{finished ? t('tasksDone') : t('tasksTitle')}</b>
        <span className="dim">{t('tasksProgress', { done, total })}</span>
        <span className="task-list-bar" aria-hidden="true">
          <span style={{ width: `${(done / total) * 100}%` }} />
        </span>
        <span className={`tool-chevron ${open ? 'open' : ''}`}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <ol className="task-list-items">
          {todos.map((x) => (
            <li key={x.content} className={`task ${x.status}`}>
              <Icon
                name={TODO_ICON[x.status]}
                size={12}
                className={x.status === 'in_progress' && live ? 'spin-slow' : undefined}
              />
              <span>{x.status === 'in_progress' && x.activeForm ? x.activeForm : x.content}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** ask_user: the options as buttons (or checkboxes), plus an answer in the user's words. */
export function QuestionCard({
  q,
  onAnswer,
}: {
  q: Question;
  onAnswer: (answer: string[] | null) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [own, setOwn] = useState('');
  const card = useRef<HTMLDivElement>(null);
  const keysId = useId();
  // Focus the first option so 1–n work at once, unless the user is in the middle of typing.
  useEffect(() => {
    const a = document.activeElement;
    const typing =
      (a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement) && a.value.trim() !== '';
    if (!typing)
      card.current?.querySelector<HTMLElement>('button.ask-option, .ask-option input')?.focus();
  }, []);
  const toggle = (o: string) =>
    setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  /** 1–n pick an option (toggle it when several can be picked); not while typing an answer. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement && el.type !== 'checkbox') return;
    if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    const o = q.options[Number(e.key) - 1];
    if (!o) return;
    e.preventDefault();
    if (q.multiple) toggle(o);
    else onAnswer([o]);
  };
  const send = (extra?: string) => {
    const all = [...picked, ...(extra ? [extra] : []), ...(own.trim() ? [own.trim()] : [])];
    if (all.length) onAnswer([...new Set(all)]);
  };
  return (
    <div
      ref={card}
      className="ask-card"
      role="group"
      aria-label={t('askTitle')}
      aria-describedby={keysId}
      onKeyDown={onKey}
    >
      <div className="ask-question">
        <Icon name="info" size={14} /> <b>{q.question}</b>
        <span id={keysId} className="dim ask-keys">
          {t('askKeys', { n: q.options.length })}
        </span>
      </div>
      <div className="ask-options">
        {q.options.map((o, i) =>
          q.multiple ? (
            <label key={o} className={`ask-option check ${picked.includes(o) ? 'on' : ''}`}>
              <input type="checkbox" checked={picked.includes(o)} onChange={() => toggle(o)} />
              <kbd>{i + 1}</kbd> <span>{o}</span>
            </label>
          ) : (
            <button key={o} type="button" className="ask-option" onClick={() => onAnswer([o])}>
              <kbd>{i + 1}</kbd> {o}
            </button>
          ),
        )}
      </div>
      <form
        className="ask-own"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={own}
          onChange={(e) => setOwn(e.target.value)}
          placeholder={t('askOther')}
          aria-label={t('askOther')}
          maxLength={2000}
        />
        <button type="submit" className="primary" disabled={!own.trim() && !picked.length}>
          {t('askSend')}
        </button>
        <button type="button" onClick={() => onAnswer(null)}>
          {t('askSkip')}
        </button>
      </form>
    </div>
  );
}

/** Under a plan the agent proposed: approve (and run), edit, or reject it. */
export function PlanBar({
  state,
  onApprove,
  onApproveAuto,
  onEdit,
  onReject,
}: {
  state?: 'approved' | 'rejected';
  onApprove: () => void;
  /** Approve and run in auto-approve mode (file edits need no approval). */
  onApproveAuto: () => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  if (state)
    return (
      <div className={`plan-bar done ${state}`} role="status">
        <Icon name={state === 'approved' ? 'check' : 'x'} size={13} />{' '}
        {state === 'approved' ? t('planApproved') : t('planRejected')}
      </div>
    );
  return (
    <div className="plan-bar" role="group" aria-label={t('modePlan')}>
      <button className="primary" title={t('planApproveTitle')} onClick={onApprove}>
        <Icon name="check" size={14} /> {t('planApprove')}
      </button>
      <button title={t('planApproveAutoTitle')} onClick={onApproveAuto}>
        <Icon name="bolt" size={14} /> {t('planApproveAuto')}
      </button>
      <button onClick={onEdit}>
        <Icon name="edit" size={14} /> {t('planEdit')}
      </button>
      <button className="danger" title={t('planRejectTitle')} onClick={onReject}>
        <Icon name="x" size={14} /> {t('planReject')}
      </button>
    </div>
  );
}

/** Edit the plan before running it. */
export function PlanEditor({
  plan,
  onRun,
  onClose,
}: {
  plan: string;
  onRun: (plan: string, run: 'agent' | 'auto') => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(plan);
  const ready = Boolean(text.trim());
  return (
    <ModalShell
      onClose={onClose}
      className="confirm-dialog plan-editor"
      labelledBy="plan-editor-title"
    >
      <b id="plan-editor-title">{t('planEditTitle')}</b>
      <p className="dim">{t('planEditHint')}</p>
      <textarea
        autoFocus
        value={text}
        spellCheck
        aria-labelledby="plan-editor-title"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready) onRun(text, 'agent');
        }}
      />
      <div className="confirm-actions">
        <button onClick={onClose}>{t('cancel')}</button>
        <button
          disabled={!ready}
          title={t('planApproveAutoTitle')}
          onClick={() => onRun(text, 'auto')}
        >
          <Icon name="bolt" size={14} /> {t('planRunAuto')}
        </button>
        <button className="primary" disabled={!ready} onClick={() => onRun(text, 'agent')}>
          <Icon name="check" size={14} /> {t('planRun')}
        </button>
      </div>
    </ModalShell>
  );
}
