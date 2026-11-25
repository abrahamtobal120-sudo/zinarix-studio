import { memo, useEffect, useRef, useState } from 'react';
import type { PlanState } from '../../../shared/agentModes';
import { t } from '../../i18n';
import { setState } from '../../store';
import { Icon } from '../Icon';
import { ProviderLogo } from '../ProviderLogo';
import { Markdown } from '../Markdown';
import { PlanBar } from '../AgentPlan';
import { ToolCard } from './ToolCard';
import { EDIT_TOOLS, contextLabel, stepsOf, type Turn, type TurnActions } from './types';

/**
 * The model's reasoning: open (and following the end) while it thinks, collapsible after,
 * rendered as Markdown, with a button to see all of it without the height limit.
 */
export const ReasoningBlock = memo(function ReasoningBlock({
  text,
  live,
}: {
  text: string;
  live: boolean;
}) {
  const [open, setOpen] = useState(live);
  const [full, setFull] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);
  useEffect(() => {
    const el = body.current;
    if (el && live && stick.current) el.scrollTop = el.scrollHeight;
  }, [text, live, open]);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <details
      className={`turn-reasoning ${live ? 'live' : ''}`}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <Icon name="thinking" size={13} /> {live ? t('thinkingLive') : t('thinking')}
        <span className="turn-reasoning-count">
          · {words} {t('reasoningWords')}
        </span>
      </summary>
      <div
        ref={body}
        className={`turn-reasoning-body ${full ? 'full' : ''}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        <Markdown text={text} streaming={live} />
      </div>
      <button type="button" className="turn-reasoning-more" onClick={() => setFull((f) => !f)}>
        {full ? t('reasoningLess') : t('reasoningMore')}
      </button>
    </details>
  );
});

/** Errors that a missing, wrong or expired API key causes (provider texts vary a lot). */
export const AUTH_ERROR =
  /\b40[13]\b|api[\s_-]?key|\bkeys?\b|clave|llave|unauthori[sz]ed|authenticat|autentica|credential|credencial|forbidden|permission denied/i;
/** Errors of a model that cannot call tools (agent mode then needs another model). */
export const TOOLS_ERROR = /tool|function|herramienta/i;
/** No model chosen yet (err.no_model): offer the picker and the providers. */
export const NO_MODEL_ERROR = /no hay un modelo elegido|no model selected/i;

/** "Compactar chat": the summary that replaces the compacted messages. */
export const CompactCard = memo(function CompactCard({
  turn,
  shown,
  onToggle,
}: {
  turn: Turn;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="turn compact-card">
      <details>
        <summary>
          <Icon name="minimize" size={13} /> {t('chatCompactCard', { n: turn.summaryOf ?? 0 })}
        </summary>
        <div className="compact-card-body">
          <Markdown text={turn.content} streaming={false} />
        </div>
      </details>
      <button type="button" className="compact-card-toggle" onClick={onToggle}>
        {shown ? t('chatCompactHide') : t('chatCompactShow')}
      </button>
    </div>
  );
});

/**
 * One message of the chat. Memoized: while an answer streams only that message re-renders
 * (the others keep their props), so long conversations do not re-parse all their Markdown
 * for every token.
 */
export const TurnView = memo(function TurnView({
  turn,
  live,
  last,
  canEdit,
  idle,
  planState,
  defaultModel,
  agentMode,
  actions,
}: {
  turn: Turn;
  /** Fase 3: the state of the plan this answer proposed (null = none to show). */
  planState?: PlanState;
  live: boolean;
  last: boolean;
  canEdit: boolean;
  /** Nothing runs in this chat: rewind and review are possible. */
  idle: boolean;
  defaultModel: string | null;
  agentMode: boolean;
  actions: TurnActions;
}) {
  return (
    <div className={`turn ${turn.role}`}>
      {turn.role === 'user' ? (
        <>
          <div className="turn-user">{turn.content}</div>
          {turn.images && turn.images.length > 0 && (
            <div className="turn-images">
              {turn.images.map((src, k) => (
                <img key={k} src={src} alt="" />
              ))}
            </div>
          )}
          {(canEdit || (idle && turn.rid)) && (
            <div className="turn-actions user">
              {canEdit && (
                <button title={t('chatEdit')} onClick={actions.editLast}>
                  <Icon name="edit" size={13} /> {t('chatEdit')}
                </button>
              )}
              {idle && turn.rid && (
                <button title={t('rewindHereTitle')} onClick={() => actions.rewind(turn)}>
                  <Icon name="undo" size={13} /> {t('rewindHere')}
                </button>
              )}
            </div>
          )}
          {turn.context && turn.context.length > 0 && (
            <div className="turn-context">
              {turn.context.map((c) => (
                <span key={c} className="turn-context-item">
                  <Icon name={c.startsWith('terminal:') ? 'terminal' : 'paperclip'} size={11} />
                  {contextLabel(c)}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="turn-model">
            {(turn.model ?? defaultModel) && (
              <ProviderLogo id={(turn.model ?? defaultModel ?? '').split('/')[0]!} size={16} />
            )}
            {turn.model ?? defaultModel ?? ''}
          </div>
          {turn.notices?.map((n, j) => (
            <div key={j} className="turn-notice">
              <Icon name="warning" size={13} /> {n}
            </div>
          ))}
          {turn.reasoning && (
            <ReasoningBlock
              text={turn.reasoning}
              live={live && !turn.parts?.some((p) => p.kind === 'text' && p.text)}
            />
          )}
          {(turn.parts ?? []).map((p, j) =>
            p.kind === 'text' ? (
              <Markdown
                key={j}
                text={p.text}
                streaming={live && j === (turn.parts?.length ?? 0) - 1}
              />
            ) : (
              <ToolCard
                key={p.id}
                step={p}
                rid={turn.rid}
                onDecide={actions.decide}
                onAnswer={actions.answer}
              />
            ),
          )}
          {live && !turn.content && !turn.parts?.length && !turn.error && (
            <div className="typing">
              <span />
              <span />
              <span />
            </div>
          )}
          {turn.error && (
            <div className="turn-error" role="alert">
              <Icon name="warning" size={14} /> {turn.error}
              {NO_MODEL_ERROR.test(turn.error) && (
                <button onClick={() => setState({ modal: { kind: 'models' } })}>
                  {t('pickModel')}
                </button>
              )}
              {(AUTH_ERROR.test(turn.error) || NO_MODEL_ERROR.test(turn.error)) && (
                <button onClick={() => setState({ modal: { kind: 'providers' } })}>
                  {t('providers')}
                </button>
              )}
              {TOOLS_ERROR.test(turn.error) && agentMode && (
                <button onClick={actions.agentOff}>{t('agentOff')}</button>
              )}
            </div>
          )}
          {!live && planState && (planState !== 'open' || idle) && (
            <PlanBar
              state={planState === 'open' ? undefined : planState}
              onApprove={() => actions.approvePlan(turn)}
              onApproveAuto={() => actions.approvePlan(turn, 'auto')}
              onEdit={() => actions.editPlan(turn)}
              onReject={() => actions.rejectPlan(turn)}
            />
          )}
          {turn.meta && <div className="turn-meta">{turn.meta}</div>}
          {!live && (turn.content || turn.error) && (
            <div className="turn-actions">
              {turn.content && (
                <button title={t('copy')} onClick={() => actions.copy(turn)}>
                  <Icon name="copy" size={13} />
                  <span className="turn-action-label">{t('copy')}</span>
                </button>
              )}
              {turn.content && (
                <button title={t('chatQuote')} onClick={() => actions.quote(turn)}>
                  <Icon name="quote" size={13} />
                  <span className="turn-action-label">{t('chatQuote')}</span>
                </button>
              )}
              {turn.content && (
                <button title={t('chatHandoffTitle')} onClick={() => actions.handoff(turn)}>
                  <Icon name="handoff" size={13} />
                  <span className="turn-action-label">{t('chatHandoff')}</span>
                </button>
              )}
              {idle && turn.rid && stepsOf(turn, EDIT_TOOLS) > 0 && (
                <button title={t('reviewChangesTitle')} onClick={() => actions.review(turn)}>
                  <Icon name="edit" size={13} />
                  <span className="turn-action-label">{t('reviewChanges')}</span>
                </button>
              )}
              {last && (
                <button title={t('chatRegenerate')} onClick={actions.regenerate}>
                  <Icon name="refresh" size={13} />
                  <span className="turn-action-label">{t('chatRegenerate')}</span>
                </button>
              )}
              {last && turn.content && !turn.error && (
                <button title={t('chatContinue')} onClick={actions.continueLast}>
                  <Icon name="continue" size={13} />
                  <span className="turn-action-label">{t('chatContinue')}</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});
