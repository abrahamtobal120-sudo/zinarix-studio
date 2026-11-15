import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { t } from '../i18n';
import { Icon } from './Icon';
import './chat-a11y.css';

const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * Closes a popup menu with Esc (focus goes back to its button), a click outside it, or when the
 * keyboard focus leaves it. `inside` are the elements that count as "the menu" (menu + button).
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  inside: RefObject<HTMLElement | null>[],
  button: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const within = (n: EventTarget | null) =>
      n instanceof Node && inside.some((r) => r.current?.contains(n));
    const onDown = (e: MouseEvent) => {
      if (!within(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only when the focus is in the menu or nowhere in particular (Esc in the box stops the chat).
      const a = document.activeElement;
      if (a && a !== document.body && !within(a)) return;
      e.preventDefault();
      e.stopPropagation();
      close();
      button.current?.focus();
    };
    const onFocus = (e: FocusEvent) => {
      if (!within(e.target)) close();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
    };
    // `inside` / `button` are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);
}

/** ↑ / ↓ / Home / End between the items of a role="menu" element. */
export function menuArrows(e: ReactKeyboardEvent<HTMLElement>): void {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (e.key === 'ArrowDown') next = (i + 1) % items.length;
  else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next < 0) return;
  e.preventDefault();
  items[next]!.focus();
}

/**
 * The send button of the chat box. One primary button (Enter: send, or "send now" alongside
 * the running answer while busy) plus a small menu with the other ways to send:
 * now, queue (only while busy) and in parallel (a new chat, Ctrl+Enter).
 */
export function SendButton({
  busy,
  hasInput,
  onSend,
  onQueue,
  onParallel,
}: {
  busy: boolean;
  hasInput: boolean;
  onSend: () => void;
  onQueue: () => void;
  onParallel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [wrap], more);
  // Nothing to send: the menu has no use.
  useEffect(() => {
    if (!hasInput) setOpen(false);
  }, [hasInput]);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const mainLabel = busy ? t('chatAlongside') : t('send');
  const mainIcon = busy ? 'sendNow' : 'send';
  const parallelKeys = `${isMac ? '⌘' : 'Ctrl'}+Enter`;

  return (
    <span className="send-split" ref={wrap}>
      <button
        className="primary send-btn"
        disabled={!hasInput}
        title={busy ? t('chatAlongsideHint') : `${t('send')} (Enter)`}
        aria-label={mainLabel}
        onClick={onSend}
      >
        <Icon name={mainIcon} size={16} />
      </button>
      {hasInput && (
        <button
          ref={more}
          className="primary send-btn send-more"
          title={t('chatSendOptions')}
          aria-label={t('chatSendOptions')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <Icon name="chevronDown" size={12} />
        </button>
      )}
      {open && (
        <div
          ref={menu}
          className="send-menu"
          role="menu"
          aria-label={t('chatSendOptions')}
          onKeyDown={(e) => {
            if (e.key === 'Tab') setOpen(false);
            else menuArrows(e);
          }}
        >
          <button
            role="menuitem"
            title={busy ? t('chatAlongsideHint') : undefined}
            onClick={() => pick(onSend)}
          >
            <Icon name={mainIcon} size={13} /> <span>{mainLabel}</span>
            <kbd>Enter</kbd>
          </button>
          {busy && (
            <button role="menuitem" title={t('chatQueueHint')} onClick={() => pick(onQueue)}>
              <Icon name="clock" size={13} /> <span>{t('chatQueue')}</span>
            </button>
          )}
          <button role="menuitem" title={t('chatParallelHint')} onClick={() => pick(onParallel)}>
            <Icon name="parallel" size={13} /> <span>{t('chatParallel')}</span>
            <kbd>{parallelKeys}</kbd>
          </button>
        </div>
      )}
    </span>
  );
}
