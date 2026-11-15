import type { RefObject } from 'react';
import type { AgentKitView } from '../../shared/api';
import { t } from '../i18n';
import { menuArrows } from './ChatSendMenu';
import { Icon, type IconName } from './Icon';

export type KitKind = 'agent' | 'skill' | 'command';

/**
 * Fase 4: what the project (and ~/.zinarix) adds to the agent, in one menu next to the
 * rules chip. Click = open the file; a command or skill can also be typed into the chat.
 */
export function AgentKitMenu({
  kit,
  menuRef,
  canEdit,
  onOpen,
  onInsert,
  onCreate,
}: {
  kit: AgentKitView;
  menuRef: RefObject<HTMLDivElement | null>;
  /** false = the chat works on another folder: files cannot be opened or created here. */
  canEdit: boolean;
  onOpen: (path: string) => void;
  /** Puts "/name " in the text box. */
  onInsert: (name: string) => void;
  onCreate: (kind: KitKind) => void;
}) {
  const row = (
    key: string,
    icon: IconName,
    label: string,
    why: string,
    title: string,
    onClick: (() => void) | undefined,
  ) => (
    <button key={key} role="menuitem" title={title} disabled={!onClick} onClick={onClick}>
      <Icon name={icon} size={13} />
      <span className="rules-path">{label}</span>
      <span className="rules-why">{why}</span>
    </button>
  );
  const open = (path: string) => (canEdit ? () => onOpen(path) : undefined);
  const empty =
    !kit.agents.length && !kit.skills.length && !kit.commands.length && !kit.hooks.length;
  return (
    <div
      ref={menuRef}
      className="term-menu rules-menu kit-menu"
      role="menu"
      aria-label={t('kitPanel')}
      onKeyDown={menuArrows}
    >
      <div className="term-menu-title">{t('kitPanel')}</div>
      {empty && <div className="rules-empty">{t('kitEmpty')}</div>}
      {kit.agents.length > 0 && <div className="term-menu-head">{t('kitAgents')}</div>}
      {kit.agents.map((a) =>
        row(
          `a:${a.name}`,
          'users',
          a.name,
          [a.model, a.tools?.join(', ') ?? t('kitAllTools')].filter(Boolean).join(' · '),
          a.description || a.path,
          open(a.path),
        ),
      )}
      {kit.skills.length > 0 && <div className="term-menu-head">{t('kitSkills')}</div>}
      {kit.skills.map((k) =>
        row(`s:${k.name}`, 'books', `/${k.name}`, k.description, `${k.description}\n${k.dir}`, () =>
          onInsert(k.name),
        ),
      )}
      {kit.commands.length > 0 && <div className="term-menu-head">{t('kitCommands')}</div>}
      {kit.commands.map((c) =>
        row(
          `c:${c.name}`,
          'prompt',
          `/${c.name}`,
          c.argumentHint ? `${c.argumentHint} · ${c.description}` : c.description,
          `${c.description}\n${c.path}`,
          () => onInsert(c.name),
        ),
      )}
      {kit.hooks.length > 0 && (
        <div className="term-menu-head">
          {t('kitHooks')} · {kit.hooksTrusted ? t('kitHooksTrusted') : t('kitHooksAsk')}
        </div>
      )}
      {kit.hooks.map((h, i) =>
        row(
          `h:${i}`,
          'bolt',
          `${h.event}${h.matcher ? ` [${h.matcher}]` : ''}`,
          h.command,
          `${h.command}\n${h.source}`,
          open(h.source),
        ),
      )}
      {canEdit && (
        <div className="rules-actions">
          <button role="menuitem" onClick={() => onCreate('agent')}>
            <Icon name="plus" size={13} /> {t('kitNewAgent')}
          </button>
          <button role="menuitem" onClick={() => onCreate('skill')}>
            <Icon name="plus" size={13} /> {t('kitNewSkill')}
          </button>
          <button role="menuitem" onClick={() => onCreate('command')}>
            <Icon name="plus" size={13} /> {t('kitNewCommand')}
          </button>
        </div>
      )}
    </div>
  );
}
