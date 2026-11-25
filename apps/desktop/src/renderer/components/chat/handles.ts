import type { ChatContext, PhoneSnapshot, ToolDecision } from '../../../shared/api';
import { confirmDialog } from '../../confirm';
import { t } from '../../i18n';
import { closeChat, getState, setState } from '../../store';

/** What other parts of the UI can ask of an open chat. */
export interface ChatHandle {
  send: (prompt: string, context?: ChatContext[], forceAgent?: boolean) => void;
  busy: () => boolean;
  abort: () => void;
  focus: () => void;
  setAgent: (on: boolean) => void;
  load: (conversationId: string) => void;
  reset: () => void;
  /** Stops like the Stop button (queued messages wait). */
  stop: () => void;
  decide: (toolCallId: string, d: ToolDecision) => void;
  /** The last turns, for the phone remote. */
  view: () => PhoneSnapshot['turns'];
}
export const handles = new Map<string, ChatHandle>();

/**
 * Closes the chat of a focused tab (Delete or Ctrl+W on it) and moves the keyboard focus to
 * the tab that is shown next, so the user does not lose their place.
 */
export async function closeChatFromTab(id: string): Promise<void> {
  await requestCloseChat(id);
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('.chat-tabs [role="tab"][tabindex="0"]')?.focus(),
  );
}

/** Chat of the tab with the keyboard focus (null when the focus is elsewhere). */
export function focusedChatTab(): string | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches('.chat-tabs [role="tab"]')
    ? (el.dataset.chat ?? null)
    : null;
}

/** Asks before closing a chat that is still working, then stops and closes it. */
export async function requestCloseChat(id: string): Promise<void> {
  const h = handles.get(id);
  if (h?.busy()) {
    if (!(await confirmDialog(t('chatCloseBusy'), { danger: true }))) return;
    // Closed meanwhile (another way, while the question was open).
    if (!getState().chats.some((c) => c.id === id)) return;
    // It may have finished meanwhile: nothing left to stop then.
    if (h.busy()) h.abort();
  }
  if (getState().chatHistoryFor === id) setState({ chatHistoryFor: null });
  closeChat(id);
}
