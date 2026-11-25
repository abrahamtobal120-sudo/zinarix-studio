import type { ReactNode, RefObject } from 'react';
import type { ActiveRulesView, AgentKitView, ChatContext } from '../../../shared/api';
import { QUEUE_RETRY_DELAYS } from '../../../shared/chatQueue';
import { t } from '../../i18n';
import { setState } from '../../store';
import { Icon } from '../Icon';
import { fileIcon } from '../icons';
import { OfflineGames } from '../OfflineGames';
import { menuArrows } from '../ChatSendMenu';
import { ps } from '../PhasesPanel';
import { tv } from '../video/strings';
import type { TerminalSession } from '../Terminal';
import { contextLabel } from './types';
import {
  REASONING_KEY,
  ruleReason,
  shortcutOf,
  type PendingImage,
  type ReasoningLevel,
  type Suggest,
} from './helpers';

/**
 * The pieces of the chat that only draw: the empty state, the menus of the message box,
 * the "/" and "@" list, the queue and the pending attachments. The state lives in
 * ChatSession (Chat.tsx); these get it through props.
 */

type MenuRef = RefObject<HTMLDivElement | null>;

/** What an empty chat shows: connect a provider, offline games, the bot intro or the hints. */
export function ChatEmpty({
  noProviders,
  online,
  bot,
  agentMode,
}: {
  noProviders: boolean;
  online: boolean;
  bot: { icon: string; name: string; description?: string; greeting?: string } | undefined;
  agentMode: boolean;
}) {
  return (
    <div className="chat-empty">
      {noProviders ? (
        <>
          <img className="chat-logo" src="./logo.svg" alt="" />
          <p>{t('noProviders')}</p>
          <button className="primary" onClick={() => setState({ modal: { kind: 'providers' } })}>
            {t('connectProvider')}
          </button>
          <OfflineGames offline={!online} />
        </>
      ) : !online ? (
        <OfflineGames offline />
      ) : bot ? (
        <div className="chat-hints chat-bot-intro">
          <p className="chat-bot-name">
            <span aria-hidden="true">{bot.icon}</span> <strong>{bot.name}</strong>
          </p>
          {bot.description && <p className="dim">{bot.description}</p>}
          {bot.greeting && <p className="chat-bot-greeting">{bot.greeting}</p>}
        </div>
      ) : (
        <div className="dim chat-hints">
          <p className="chat-mode-hint" title={agentMode ? t('agentHint') : undefined}>
            {agentMode ? t('agentHintShort') : t('chatHint')}
          </p>
          <div className="chat-keys" title={t('chatTips')}>
            <span>
              <kbd>/</kbd> {t('chatKeyCommands')}
            </span>
            <span>
              <kbd>@</kbd> {t('chatKeyMention')}
            </span>
            <span>
              <kbd>{shortcutOf('ai.askSelection')}</kbd> {t('includeFile')}
            </span>
            <span>
              <kbd>{shortcutOf('ai.edit')}</kbd> {t('aiEdit')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The reasoning-effort select (in the "+" menu and, once set, as a pill). */
export function ReasoningSelect({
  value,
  onChange,
}: {
  value: ReasoningLevel | '';
  onChange: (v: ReasoningLevel | '') => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value as ReasoningLevel | '';
        onChange(v);
        if (v) localStorage.setItem(REASONING_KEY, v);
        else localStorage.removeItem(REASONING_KEY);
      }}
    >
      <option value="">{t('reasoningAuto')}</option>
      <option value="low">{t('reasoningLow')}</option>
      <option value="medium">{t('reasoningMedium')}</option>
      <option value="high">{t('reasoningHigh')}</option>
    </select>
  );
}

/** Images waiting to be sent with the next message. */
export function PendingImages({
  images,
  onRemove,
}: {
  images: PendingImage[];
  onRemove: (index: number) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="chat-images">
      {images.map((im, k) => (
        <span key={k} className="chat-image" title={im.name}>
          <img src={`data:${im.mediaType};base64,${im.data}`} alt={im.name} />
          <button
            aria-label={t('removeAttachment')}
            title={t('removeAttachment')}
            onClick={() => onRemove(k)}
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Files and terminal output attached to the next message (shared by every chat). */
export function PendingAttachments({ attachments }: { attachments: ChatContext[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="chat-attachments">
      {attachments.map((c) => (
        <span key={c.source} className="chat-attachment" title={c.content.slice(-600)}>
          <Icon name={c.source.startsWith('terminal:') ? 'terminal' : 'paperclip'} size={12} />{' '}
          {contextLabel(c.source)}
          <button
            aria-label={t('removeAttachment')}
            title={t('removeAttachment')}
            onClick={() =>
              setState((st) => ({
                chatAttachments: st.chatAttachments.filter((x) => x.source !== c.source),
              }))
            }
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** The rules in use for this chat and the ones that can be added with "@name". */
export function RulesMenu({
  view,
  menuRef,
  readOnly,
  onOpen,
  onMention,
  onEdit,
  onInit,
}: {
  view: ActiveRulesView;
  menuRef: MenuRef;
  /** The chat works in its own folder: the rule files are not opened in the editor. */
  readOnly: boolean;
  onOpen: (path: string) => void;
  onMention: (name: string) => void;
  onEdit: () => void;
  onInit: () => void;
}) {
  return (
    <div
      ref={menuRef}
      className="term-menu rules-menu"
      role="menu"
      aria-label={t('rulesPanel')}
      onKeyDown={menuArrows}
    >
      <div className="term-menu-title">
        {t('rulesPanel')} · {t('rulesTokens', { tokens: view.tokens.toLocaleString() })}
      </div>
      {view.active.length === 0 && <div className="rules-empty">{t('rulesNone')}</div>}
      {view.active.map((r) => (
        <button
          key={r.path}
          role="menuitem"
          title={r.description || r.path}
          disabled={readOnly}
          onClick={() => onOpen(r.path)}
        >
          <Icon name="scroll" size={13} />
          <span className="rules-path">{r.path}</span>
          <span className="rules-why">
            {ruleReason(r.reason)}
            {view.truncated.includes(r.path) ? ` · ${t('rulesCut')}` : ''} ·{' '}
            {t('rulesTokens', { tokens: r.tokens.toLocaleString() })}
          </span>
        </button>
      ))}
      {view.available.length > 0 && (
        <>
          <div className="term-menu-head">{t('rulesAvailable')}</div>
          {view.available.map((r) => (
            <button
              key={r.path}
              role="menuitem"
              title={r.description || r.path}
              onClick={() => onMention(r.name)}
            >
              <Icon name="plus" size={13} />
              <span className="rules-path">@{r.name}</span>
              <span className="rules-why">
                {r.applies === 'glob' ? r.globs.join(', ') : r.description || r.path}
              </span>
            </button>
          ))}
        </>
      )}
      <div className="rules-actions">
        <button role="menuitem" onClick={onEdit}>
          <Icon name="edit" size={13} /> {t('rulesEdit')}
        </button>
        <button role="menuitem" onClick={onInit}>
          <Icon name="filePlus" size={13} /> /init
        </button>
      </div>
    </div>
  );
}

/** The "+" menu of the message box: attach, options, panels and the terminals. */
export function AddMenu({
  menuRef,
  terminals,
  reasoning,
  agentMode,
  computerOn,
  includeFile,
  tasks,
  showTasks,
  kit,
  showKit,
  rules,
  onClose,
  onAttachFile,
  onPhases,
  onAttachImage,
  onStudio,
  onReasoning,
  onToggleComputer,
  onToggleIncludeFile,
  onTasks,
  onKit,
  onRules,
  onOpenTerminal,
  onTerminal,
}: {
  menuRef: MenuRef;
  terminals: TerminalSession[];
  reasoning: ReasoningLevel | '';
  agentMode: boolean;
  computerOn: boolean;
  includeFile: boolean;
  tasks: { active: number; waiting: number };
  showTasks: boolean;
  kit: AgentKitView | null;
  showKit: boolean;
  rules: ActiveRulesView | null;
  /** Closes the menu; every action but the two toggles that stay open calls it first. */
  onClose: () => void;
  onAttachFile: () => void;
  onPhases: () => void;
  onAttachImage: () => void;
  onStudio: () => void;
  onReasoning: (v: ReasoningLevel | '') => void;
  onToggleComputer: () => void;
  onToggleIncludeFile: () => void;
  onTasks: () => void;
  onKit: () => void;
  onRules: () => void;
  onOpenTerminal: () => void;
  onTerminal: (id: number, what: 'session' | 'selection') => void;
}) {
  const item = (
    icon: Parameters<typeof Icon>[0]['name'],
    label: string,
    run: () => void,
    extra?: { title?: string; hint?: ReactNode },
  ) => (
    <button
      role="menuitem"
      className="add-menu-item"
      title={extra?.title}
      onClick={() => {
        onClose();
        run();
      }}
    >
      <Icon name={icon} size={14} />
      <span className="add-menu-label">{label}</span>
      {extra?.hint}
    </button>
  );
  return (
    <div
      ref={menuRef}
      className="term-menu add-menu"
      role="menu"
      aria-label={t('chatAddMenu')}
      onKeyDown={menuArrows}
    >
      {(
        [
          ['paperclip', t('chatAttach'), onAttachFile],
          ['layers', ps().menu, onPhases],
          ['image', t('chatAttachImage'), onAttachImage],
          ['film', tv('openStudioHint'), onStudio],
        ] as const
      ).map(([icon, text, run]) => {
        // "Label (hint)" / "Label · hint": the hint goes right, dimmed.
        const [label, hint] = text.split(/ \(| · /);
        return (
          <button
            key={icon}
            role="menuitem"
            className="add-menu-item"
            onClick={() => {
              onClose();
              run();
            }}
          >
            <Icon name={icon} size={14} />
            <span className="add-menu-label">{label}</span>
            {hint && <span className="add-menu-hint">{hint.replace(/\)$/, '')}</span>}
          </button>
        );
      })}
      <div className="term-menu-head">{t('chatOptions')}</div>
      <label className="add-menu-item add-menu-row" title={t('reasoningTitle')}>
        <Icon name="thinking" size={14} />
        <ReasoningSelect value={reasoning} onChange={onReasoning} />
      </label>
      {agentMode && (
        <button
          role="menuitemcheckbox"
          aria-checked={computerOn}
          className="add-menu-item"
          title={t('computerPillTitle')}
          onClick={() => {
            onClose();
            onToggleComputer();
          }}
        >
          <Icon name="monitor" size={14} />
          <span className="add-menu-label">{t('computerMenu')}</span>
          {computerOn && <Icon name="check" size={13} className="add-menu-check" />}
        </button>
      )}
      <button
        role="menuitemcheckbox"
        aria-checked={includeFile}
        className="add-menu-item"
        onClick={onToggleIncludeFile}
      >
        <Icon name="file" size={14} />
        <span className="add-menu-label">{t('includeFile')}</span>
        {includeFile && <Icon name="check" size={13} className="add-menu-check" />}
      </button>
      {showTasks &&
        item('layers', t('tasksPanel'), onTasks, {
          title: t('tasksChip', tasks),
          hint: tasks.active > 0 && <span className="add-menu-hint">{tasks.active}</span>,
        })}
      {kit &&
        showKit &&
        item('package', t('kitPanel'), onKit, {
          title: t('kitChip', {
            agents: kit.agents.length,
            skills: kit.skills.length,
            commands: kit.commands.length,
            hooks: kit.hooks.length,
          }),
          hint: kit.agents.length + kit.skills.length > 0 && (
            <span className="add-menu-hint">{kit.agents.length + kit.skills.length}</span>
          ),
        })}
      {rules?.enabled &&
        rules.active.length + rules.available.length > 0 &&
        item('scroll', t('rulesPanel'), onRules, {
          title: t('rulesActive', {
            n: rules.active.length,
            tokens: rules.tokens.toLocaleString(),
          }),
          hint: rules.active.length > 0 && (
            <span className="add-menu-hint">{rules.active.length}</span>
          ),
        })}
      <div className="term-menu-head">{t('terminal')}</div>
      {terminals.length === 0 ? (
        <button
          role="menuitem"
          onClick={() => {
            onOpenTerminal();
            onClose();
          }}
        >
          <Icon name="plus" size={13} /> {t('termOpenNew')}
        </button>
      ) : (
        terminals.flatMap((term) => [
          <button
            key={`${term.id}:s`}
            role="menuitem"
            onClick={() => {
              onTerminal(term.id, 'session');
              onClose();
            }}
          >
            <Icon name="terminal" size={13} /> {t('termSession', { n: term.n })}
          </button>,
          term.hasSelection && (
            <button
              key={`${term.id}:sel`}
              role="menuitem"
              onClick={() => {
                onTerminal(term.id, 'selection');
                onClose();
              }}
            >
              <Icon name="scissors" size={13} /> {t('termSelection', { n: term.n })}
            </button>
          ),
        ])
      )}
    </div>
  );
}

/** The "/" commands and "@" mentions list over the message box. */
export function SuggestList({
  suggest,
  onPick,
}: {
  suggest: Suggest;
  onPick: (index: number) => void;
}) {
  return (
    <div className="chat-suggest" role="listbox">
      <div className="term-menu-title">
        {suggest.kind === 'slash' ? t('slashTitle') : t('mentionTitle')}
      </div>
      {suggest.items.map((it, i) => (
        <div
          key={it.id}
          role="option"
          aria-selected={i === suggest.index}
          className={`chat-suggest-item ${i === suggest.index ? 'active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
        >
          <span className="chat-suggest-label">
            {suggest.kind === 'file' && !it.special ? fileIcon(it.id) : null}
            {it.label}
          </span>
          {it.hint && <span className="chat-suggest-hint">{it.hint}</span>}
        </div>
      ))}
    </div>
  );
}

/** Messages waiting for the current answer to end, and the countdown of an automatic retry. */
export function QueuePanel({
  queued,
  retry,
  busy,
  onCancelRetry,
  onSend,
  onEdit,
  onRemove,
}: {
  queued: string[];
  retry: { at: number; n: number } | null;
  busy: boolean;
  onCancelRetry: () => void;
  onSend: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  if (queued.length === 0 && !retry) return null;
  return (
    <div className="chat-queue" aria-label={t('chatQueued')}>
      <div className="chat-queue-title">
        <Icon name="clock" size={12} />{' '}
        <span className="chat-queue-status">
          {retry
            ? t('chatQueueRetry', {
                s: Math.max(1, Math.round((retry.at - Date.now()) / 1000)),
                n: retry.n,
                max: QUEUE_RETRY_DELAYS.length,
              })
            : busy
              ? t('chatQueuedNext', { n: queued.length })
              : t('chatQueuedPaused')}
        </span>
        {retry && (
          <button
            title={t('chatQueueRetryCancel')}
            aria-label={t('chatQueueRetryCancel')}
            onClick={onCancelRetry}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      <div className="chat-queue-list">
        {queued.map((q, i) => (
          <div key={i} className="chat-queue-item" title={q}>
            <span className="chat-queue-text">{q}</span>
            {!busy && i === 0 && (
              <button title={t('send')} aria-label={t('send')} onClick={onSend}>
                <Icon name="send" size={12} />
              </button>
            )}
            <button
              title={t('chatQueueEdit')}
              aria-label={t('chatQueueEdit')}
              onClick={() => onEdit(i)}
            >
              <Icon name="edit" size={12} />
            </button>
            <button
              title={t('chatQueueRemove')}
              aria-label={t('chatQueueRemove')}
              onClick={() => onRemove(i)}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
