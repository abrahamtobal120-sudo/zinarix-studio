import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type { ConversationView } from '../../../shared/api';
import { pressable } from '../../a11y';
import { errText } from '../../errText';
import { t } from '../../i18n';
import {
  api,
  chatFolder,
  forgetProject,
  newChat,
  newChatInFolder,
  rememberProject,
  selectChat,
  toast,
  updateChat,
  useStore,
  type ChatTab,
} from '../../store';
import { Icon } from '../Icon';
import { ProviderLogo } from '../ProviderLogo';
import { when } from '../ChatHistory';
import { DeleteSavedChat, LimitedList, RecentChats } from '../ChatListParts';
import { requestCloseChat } from './handles';

export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** What a chat is doing, as a small icon (tabs and the side list). */
export function ChatStatus({ c }: { c: ChatTab }) {
  return (
    <span className="chat-tab-status">
      {c.waiting ? (
        <Icon name="pause" size={11} />
      ) : c.busy ? (
        <span className="chat-tab-spin" />
      ) : c.unread ? (
        <span className="chat-tab-dot" />
      ) : c.model ? (
        <ProviderLogo id={c.model.split('/')[0]!} size={12} />
      ) : (
        <Icon name="message" size={12} />
      )}
    </span>
  );
}

export function chatStatusText(c: ChatTab): string {
  return c.waiting ? t('chatWaiting') : c.busy ? t('chatRunning') : c.unread ? t('chatDoneBg') : '';
}

export const OPEN_KEY = 'zs.chatProjectsOpen';

export function savedOpen(): Record<string, boolean> {
  try {
    return (JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>) ?? {};
  } catch {
    return {};
  }
}

/** A chat being dragged between projects of the side list: an open one or a saved one. */
export interface ChatDrag {
  chat?: string;
  conv?: string;
  from: string | undefined;
}

export const CHAT_DRAG = 'application/x-zinarix-chat';

export function startChatDrag(e: DragEvent, drag: ChatDrag): void {
  e.dataTransfer.setData(CHAT_DRAG, JSON.stringify(drag));
  e.dataTransfer.effectAllowed = 'move';
}

export function readChatDrag(e: DragEvent): ChatDrag | null {
  try {
    return JSON.parse(e.dataTransfer.getData(CHAT_DRAG)) as ChatDrag;
  } catch {
    return null;
  }
}

/** One project of the side list: its open chats and, when unfolded, its saved ones. */
export function ChatProject({
  folder,
  items,
  focusedId,
  open,
  onToggle,
  moved,
  onMove,
}: {
  folder: string | undefined;
  items: { c: ChatTab; n: number }[];
  focusedId: string;
  open: boolean;
  onToggle: () => void;
  /** Bumped when a chat moves between projects, so the saved list reloads. */
  moved: number;
  onMove: (drag: ChatDrag, to: string) => void;
}) {
  const chats = useStore((s) => s.chats);
  const activeChat = useStore((s) => s.activeChat);
  const split = useStore((s) => s.chatSplit);
  const windowRoot = useStore((s) => s.workspace?.root);
  const [saved, setSaved] = useState<ConversationView[] | null>(null);
  const [dropHere, setDropHere] = useState(false);
  const own = folder && folder !== windowRoot ? folder : undefined;
  // Reloaded when a chat of the project ends (its conversation was just saved).
  const running = items.filter((x) => x.c.busy).length;
  useEffect(() => {
    if (!open || !folder) return;
    void api()
      .ai.projectConversations(folder)
      .then(setSaved)
      .catch(() => setSaved([]));
  }, [open, folder, running, items.length, moved]);

  const busy = items.some((x) => x.c.busy);
  const waiting = items.some((x) => x.c.waiting);
  const unread = items.some((x) => x.c.unread);
  const past = (saved ?? []).filter((v) => !chats.some((c) => c.conversationId === v.id));

  // A chat of another project dropped here moves to this folder.
  const dropProps = folder
    ? {
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes(CHAT_DRAG)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropHere(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHere(false);
        },
        onDrop: (e: DragEvent) => {
          setDropHere(false);
          const drag = readChatDrag(e);
          if (!drag) return;
          e.preventDefault();
          if (drag.from !== folder) onMove(drag, folder);
        },
      }
    : {};

  return (
    <div
      className={`chat-list-group ${open ? 'open' : ''} ${dropHere ? 'drop' : ''}`}
      {...dropProps}
    >
      <div
        className={`chat-list-folder ${items.some((x) => x.c.id === focusedId) ? 'has-focus' : ''}`}
        title={folder ?? t('chatNoFolder')}
      >
        {/* The row's own button (fold / unfold); its actions are siblings, not nested in it. */}
        <button className="chat-list-folder-main" aria-expanded={open} onClick={onToggle}>
          <Icon name={open ? 'chevronDown' : 'chevron'} size={11} />
          <Icon name="folder" size={13} />
          <span>{folder ? folderName(folder) : t('chatNoFolder')}</span>
          {!open && (waiting || busy || unread) && (
            <span className="chat-tab-status">
              {waiting ? (
                <Icon name="pause" size={11} />
              ) : busy ? (
                <span className="chat-tab-spin" />
              ) : (
                <span className="chat-tab-dot" />
              )}
            </span>
          )}
          {items.length > 0 && <em className="chat-list-count">{items.length}</em>}
        </button>
        <button
          aria-label={t('chatNewHere')}
          title={t('chatNewHere')}
          onClick={(e) => {
            e.stopPropagation();
            // "No folder" with a folder open in the window: a chat that stays without one.
            newChat(folder ? { folder: own } : windowRoot ? { noFolder: true } : {});
          }}
        >
          <Icon name="plus" size={12} />
        </button>
        {!items.length && folder && folder !== windowRoot && (
          <button
            title={t('chatProjectHide')}
            aria-label={t('chatProjectHide')}
            onClick={(e) => {
              e.stopPropagation();
              forgetProject(folder);
            }}
          >
            <Icon name="x" size={11} />
          </button>
        )}
      </div>
      {open && (
        <>
          {items.length > 0 && past.length > 0 && (
            <div className="chat-list-sub">{t('chatOpenNow')}</div>
          )}
          <LimitedList
            items={items}
            keep={({ c }) => c.id === focusedId || c.id === activeChat || c.id === split}
          >
            {({ c, n }) => {
              const label = c.title || t('chatTabN', { n });
              const status = chatStatusText(c);
              const shown = c.id === activeChat || c.id === split;
              const modelName = c.model ? c.model.split('/').pop() : t('chatNoModel');
              return (
                <div
                  key={c.id}
                  className={`chat-list-item ${shown ? 'on' : ''} ${c.id === focusedId ? 'focus' : ''} ${c.waiting ? 'waiting' : ''}`}
                  title={`${label}\n${status ? `${status} · ` : ''}${modelName}`}
                  draggable={Boolean(folder)}
                  onDragStart={(e) => startChatDrag(e, { chat: c.id, from: folder })}
                  // Mouse: the whole row. Keyboard: the name is the button (the row holds the
                  // close button, and a button cannot hold another).
                  onClick={() => selectChat(c.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1) void requestCloseChat(c.id);
                  }}
                >
                  {(c.busy || c.waiting || c.unread) && (
                    <span className="chat-list-state">
                      <ChatStatus c={c} />
                    </span>
                  )}
                  <span
                    className="chat-list-main"
                    role="button"
                    tabIndex={0}
                    aria-current={shown ? 'true' : undefined}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectChat(c.id);
                      } else if (e.key === 'Delete' && chats.length > 1) {
                        e.preventDefault();
                        void requestCloseChat(c.id);
                      }
                    }}
                  >
                    <span className="chat-tab-label">{label}</span>
                  </span>
                  {c.queued.length > 0 && (
                    <em className="chat-list-count" title={t('chatQueued')}>
                      +{c.queued.length}
                    </em>
                  )}
                  {chats.length > 1 && (
                    <button
                      className="chat-tab-x"
                      aria-label={t('chatCloseTab')}
                      title={t('chatCloseTab')}
                      onClick={(e) => {
                        e.stopPropagation();
                        void requestCloseChat(c.id);
                      }}
                    >
                      <Icon name="x" size={11} />
                    </button>
                  )}
                </div>
              );
            }}
          </LimitedList>
          {/* Saved chats under date headers (Hoy, Ayer, Últimos 7 días...). */}
          <RecentChats items={past}>
            {(v) => (
              <div
                key={v.id}
                className="chat-list-item past"
                title={`${v.title}\n${new Date(v.updatedAt).toLocaleString()} · ${t('histMessages', { n: v.messageCount })}${v.model ? ` · ${v.model.split('/').pop()}` : ''}\n${t('chatDragHint')}`}
                draggable
                onDragStart={(e) => startChatDrag(e, { conv: v.id, from: folder })}
                {...pressable(() =>
                  newChat({ conversationId: v.id, title: v.title.slice(0, 60), folder: own }),
                )}
              >
                <span className="chat-list-main">
                  <span className="chat-tab-label">{v.title}</span>
                </span>
                <span className="chat-list-when">{when(v.updatedAt)}</span>
                <DeleteSavedChat
                  conv={v}
                  onDeleted={(id) => setSaved((s) => (s ? s.filter((x) => x.id !== id) : s))}
                />
              </div>
            )}
          </RecentChats>
          {!items.length && saved !== null && !past.length && (
            <div className="chat-list-empty">{t('chatProjectEmpty')}</div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The open chats beside the conversation, as projects: one per folder. A click on a project
 * shows its chats (the open ones and the saved ones) and a click on a chat opens it.
 */
export function ChatList({ focusedId }: { focusedId: string }) {
  const chats = useStore((s) => s.chats);
  const windowRoot = useStore((s) => s.workspace?.root);
  const known = useStore((s) => s.chatProjects);
  const [openMap, setOpenMap] = useState(savedOpen);
  const [moved, setMoved] = useState(0);
  const groups: { folder: string | undefined; items: { c: ChatTab; n: number }[] }[] = [];
  const group = (folder: string | undefined) => {
    let g = groups.find((x) => x.folder === folder);
    if (!g) groups.push((g = { folder, items: [] }));
    return g;
  };
  chats.forEach((c, i) => group(chatFolder(c)).items.push({ c, n: i + 1 }));
  if (windowRoot) group(windowRoot);
  for (const f of known) group(f);
  const focusedFolder = chatFolder(chats.find((c) => c.id === focusedId));
  // Unfolded by the user, or (until they choose) the project of the chat they are in.
  const isOpen = (f: string | undefined) => openMap[f ?? ''] ?? f === focusedFolder;
  const toggle = (f: string | undefined) => {
    const next = { ...openMap, [f ?? '']: !isOpen(f) };
    setOpenMap(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: projects just unfold as before next time
    }
  };
  const move = async (drag: ChatDrag, to: string) => {
    const tab = drag.chat ? chats.find((c) => c.id === drag.chat) : undefined;
    if (tab?.busy || tab?.waiting) {
      toast(t('chatMoveBusy'));
      return;
    }
    // The project it leaves stays in the list, even with no chat open there.
    if (drag.from !== windowRoot) rememberProject(drag.from);
    try {
      const conv = tab ? tab.conversationId : drag.conv;
      if (conv) await api().ai.moveConversation(conv, to);
    } catch (err) {
      toast(errText(err));
      return;
    }
    if (tab)
      updateChat(tab.id, { folder: to === windowRoot ? undefined : to, noFolder: undefined });
    if (!isOpen(to)) toggle(to);
    setMoved((n) => n + 1);
    toast(t('chatMoved', { folder: folderName(to) }));
  };
  return (
    <nav className="chat-list" aria-label={t('chatListTitle')}>
      <button className="chat-list-top-new" onClick={() => newChat()}>
        <Icon name="edit" size={14} /> {t('chatNewShort')}
      </button>
      <div className="chat-list-head">{t('chatProjects')}</div>
      <div className="chat-list-scroll">
        {groups.map((g) => (
          <ChatProject
            key={g.folder ?? ''}
            folder={g.folder}
            items={g.items}
            focusedId={focusedId}
            open={isOpen(g.folder)}
            onToggle={() => toggle(g.folder)}
            moved={moved}
            onMove={(drag, to) => void move(drag, to)}
          />
        ))}
      </div>
      <button className="chat-list-new" onClick={() => void newChatInFolder()}>
        <Icon name="folderPlus" size={13} /> {t('chatNewInFolder')}
      </button>
    </nav>
  );
}
