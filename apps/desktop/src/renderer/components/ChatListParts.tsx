import { useState, type ReactNode } from 'react';
import type { ConversationView } from '../../shared/api';
import { confirmDialog } from '../confirm';
import { errText } from '../errText';
import { t } from '../i18n';
import { api, toast } from '../store';
import { Icon } from './Icon';
import './chat-list.css';

/**
 * Pieces of the side chat list (Chat.tsx): compact one-line rows like ChatGPT's sidebar, a
 * limited number per section with "Ver más", and the saved chats grouped by date.
 */

/** Rows shown per section before "Ver más". */
export const CHAT_LIST_LIMIT = 8;

/** Date group of a saved chat: today, yesterday, last 7 days, last 30 days, older. */
export function chatBucket(ts: number): string {
  const day = 86_400_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (ts >= today) return t('histToday');
  if (ts >= today - day) return t('histYesterday');
  if (ts >= today - 6 * day) return t('histWeek');
  if (ts >= today - 29 * day) return t('chatLast30');
  return t('chatOlder');
}

function MoreToggle({
  all,
  hidden,
  onToggle,
}: {
  all: boolean;
  hidden: number;
  onToggle: () => void;
}) {
  return (
    <button className="chat-list-more" aria-expanded={all} onClick={onToggle}>
      <Icon name="chevronDown" size={11} />
      {all ? t('chatShowLess') : t('chatShowMore', { n: hidden })}
    </button>
  );
}

/**
 * The first `limit` items with a "Ver más" toggle for the rest. Items for which `keep` is true
 * (the chat in view) always show, even past the limit.
 */
export function LimitedList<T>({
  items,
  limit = CHAT_LIST_LIMIT,
  keep,
  children,
}: {
  items: T[];
  limit?: number;
  keep?: (item: T) => boolean;
  children: (item: T) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown =
    all || items.length <= limit ? items : items.filter((x, i) => i < limit || keep?.(x));
  const hidden = items.length - shown.length;
  return (
    <>
      {shown.map((x) => children(x))}
      {(hidden > 0 || (all && items.length > limit)) && (
        <MoreToggle all={all} hidden={hidden} onToggle={() => setAll(!all)} />
      )}
    </>
  );
}

/** Saved chats, newest first, under date headers (Hoy, Ayer, Últimos 7 días...). */
export function RecentChats({
  items,
  limit = CHAT_LIST_LIMIT,
  children,
}: {
  items: ConversationView[];
  limit?: number;
  children: (conv: ConversationView) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  const shown = all ? sorted : sorted.slice(0, limit);
  const groups: [string, ConversationView[]][] = [];
  for (const v of shown) {
    const b = chatBucket(v.updatedAt);
    const g = groups.find((x) => x[0] === b);
    if (g) g[1].push(v);
    else groups.push([b, [v]]);
  }
  return (
    <>
      {groups.map(([label, vs]) => (
        <div key={label} className="chat-list-bucket" role="group" aria-label={label}>
          <div className="chat-list-sub">{label}</div>
          {vs.map((v) => children(v))}
        </div>
      ))}
      {sorted.length > limit && (
        <MoreToggle all={all} hidden={sorted.length - shown.length} onToggle={() => setAll(!all)} />
      )}
    </>
  );
}

/** Hover button of a saved row: deletes the conversation (asks first, like the history). */
export function DeleteSavedChat({
  conv,
  onDeleted,
}: {
  conv: ConversationView;
  onDeleted: (id: string) => void;
}) {
  return (
    <button
      className="chat-list-del"
      title={t('histDelete')}
      aria-label={`${t('histDelete')}: ${conv.title}`}
      onClick={(e) => {
        e.stopPropagation();
        void (async () => {
          if (
            !(await confirmDialog(t('histDeleteConfirm', { title: conv.title }), { danger: true }))
          )
            return;
          try {
            await api().ai.deleteConversation(conv.id);
            onDeleted(conv.id);
          } catch (err) {
            toast(errText(err));
          }
        })();
      }}
    >
      <Icon name="trash" size={12} />
    </button>
  );
}
