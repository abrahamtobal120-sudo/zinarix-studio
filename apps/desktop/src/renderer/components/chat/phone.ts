import type { ChatContext, PhoneAction, PhoneSnapshot } from '../../../shared/api';
import { modeFrom, usesAgent, type ChatMode } from '../../../shared/agentModes';
import { errText } from '../../errText';
import { t } from '../../i18n';
import {
  api,
  chatTab,
  closeChat,
  focusedChat,
  getState,
  newChat,
  openFile,
  saveAgentMode,
  saveChatMode,
  selectChat,
  setState,
  toast,
  updateChat,
} from '../../store';
import { toolTitle } from './ToolCard';
import { handles } from './handles';
import type { ToolStep, Turn } from './types';

/** Turns the phone shows (the newest ones; long texts keep their end). */
export const PHONE_TURNS = 40;
export const PHONE_TEXT = 8000;
export function phoneTurns(turns: Turn[]): PhoneSnapshot['turns'] {
  return turns
    .filter((x) => !x.compacted)
    .slice(-PHONE_TURNS)
    .map((x) => {
      const text =
        x.parts
          ?.filter((p) => p.kind === 'text')
          .map((p) => p.text)
          .join('\n') || x.content;
      return {
        role: x.role,
        text: text.length > PHONE_TEXT ? '…' + text.slice(-PHONE_TEXT) : text,
        ...(x.error ? { error: x.error.slice(0, 2000) } : {}),
        ...(x.role === 'assistant' && x.model ? { model: x.model.slice(0, 300) } : {}),
        tools: (x.parts ?? [])
          .filter((p): p is ToolStep => p.kind === 'tool')
          .slice(-60)
          .map((p) => ({
            id: p.id,
            title: `${p.name} ${toolTitle(p)}`.trim().slice(0, 300),
            status: p.status,
          })),
      };
    });
}

let phoneTimer: ReturnType<typeof setTimeout> | undefined;
/** The phone works on this window (main says so; it can switch between windows). */
let phoneLinked = false;
export function setPhoneTarget(on: boolean): void {
  phoneLinked = on;
  if (on) pushToPhone();
}
/** Sends the phone what the controlled chat looks like now (a few times a second at most). */
export function pushToPhone(): void {
  if (!phoneLinked || phoneTimer) return;
  phoneTimer = setTimeout(() => {
    phoneTimer = undefined;
    const s = getState();
    if (!phoneLinked) return;
    const id = focusedChat();
    const h = handles.get(id);
    const tab = chatTab(id);
    const mode: ChatMode = tab ? modeFrom(tab.mode, tab.agent) : 'agent';
    const own = tab?.model ?? null;
    const shown =
      own ?? (usesAgent(mode) ? s.settings.roles.agent : undefined) ?? s.settings.defaultModel;
    void api()
      .phone.push({
        chats: s.chats.map((c, i) => ({
          id: c.id,
          title: (c.title || t('chatTabN', { n: i + 1 })).slice(0, 200),
          busy: c.busy,
          waiting: c.waiting,
        })),
        chatId: id,
        agent: tab?.agent ?? true,
        mode,
        model: own,
        shownModel: shown ?? null,
        queued: tab?.queued.length ?? 0,
        busy: h?.busy() ?? false,
        turns: h?.view() ?? [],
      })
      .catch(() => undefined);
  }, 250);
}

/** Does what the paired phone asked, in the chat the user is looking at. */
export function runPhoneAction(a: PhoneAction): void {
  const id = focusedChat();
  const h = handles.get(id);
  switch (a.kind) {
    case 'send':
      setState({ chatOpen: true });
      if (!h) newChat({ initial: { prompt: a.text, send: true } }, true);
      // Busy: it goes out when the current answer ends, like messages written meanwhile.
      else if (h.busy()) updateChat(id, { queued: [...(chatTab(id)?.queued ?? []), a.text] });
      else h.send(a.text);
      break;
    case 'decide':
      h?.decide(a.toolCallId, a.decision);
      break;
    case 'stop':
      h?.stop();
      break;
    case 'select':
      selectChat(a.chatId);
      break;
    case 'newChat':
      newChat({}, true);
      break;
    case 'agent':
      if (chatTab(id)) {
        updateChat(id, { agent: a.on });
        saveAgentMode(a.on);
      }
      break;
    case 'mode':
      if (chatTab(id)) {
        updateChat(id, { mode: a.mode });
        saveChatMode(a.mode);
      }
      break;
    case 'model':
      if (chatTab(id)) updateChat(id, { model: a.ref });
      break;
    case 'closeChat':
      if (getState().chats.some((c) => c.id === a.chatId)) {
        // The phone already asked "are you sure": no dialog on the computer.
        const busy = handles.get(a.chatId);
        if (busy?.busy()) busy.abort();
        if (getState().chatHistoryFor === a.chatId) setState({ chatHistoryFor: null });
        closeChat(a.chatId);
      }
      break;
    case 'clearQueue':
      if (chatTab(id)) updateChat(id, { queued: [] });
      break;
    case 'openFile':
      // From the phone's file browser: the file shows up in the editor of the computer.
      void openFile(a.path).catch((err: unknown) => toast(errText(err)));
      break;
  }
  pushToPhone();
}

/**
 * Sends a prompt from elsewhere (Ctrl+L, palette, security center…) to the chat the user is
 * looking at; if that chat is busy, a new chat takes it so nothing is interrupted.
 */
export function deliver(prompt: string, context: ChatContext[] | undefined, agent: boolean): void {
  setState({ chatOpen: true });
  const id = focusedChat();
  const h = handles.get(id);
  if (!h || h.busy()) {
    newChat(
      {
        ...(agent ? { agent: true } : {}),
        initial: { prompt, context, send: true },
      },
      true,
    );
    if (h?.busy()) toast(t('chatOpenedInNew'));
    return;
  }
  if (agent) h.setAgent(true);
  h.send(prompt, context, agent);
}

/** Sends a task to the chat in agent mode (used by the security center and similar). */
export function askAgent(prompt: string): void {
  deliver(prompt, undefined, true);
}

/** Puts a prompt in the chat (or just focuses the message box when it is empty). */
export function askInChat(prompt: string, context?: ChatContext[]): void {
  if (prompt) return deliver(prompt, context, false);
  setState({ chatOpen: true });
  setTimeout(() => handles.get(focusedChat())?.focus(), 50);
}
