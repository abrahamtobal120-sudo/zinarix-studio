import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { answerConfirm, useConfirmRequest } from '../confirm';
import { t } from '../i18n';

/**
 * The in-app confirmation dialog (see `confirmDialog`), rendered once at the app root.
 * Esc cancels, Enter confirms, Tab stays inside the dialog, and the focus goes back to where
 * it was once answered.
 */
export function ConfirmDialog() {
  const req = useConfirmRequest();
  const box = useRef<HTMLDivElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    const before = document.activeElement as HTMLElement | null;
    okBtn.current?.focus();
    return () => {
      // Back to where the user was (if it is still there).
      if (before && before.isConnected) before.focus();
    };
  }, [req]);

  if (!req) return null;
  const answer = (ok: boolean) => answerConfirm(req.id, ok);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The app's shortcuts do not run behind the dialog.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      answer(false);
      return;
    }
    // Enter confirms; on a focused button it presses that button (Cancel cancels).
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      answer(true);
      return;
    }
    if (e.key === 'Tab') {
      const items = Array.from(
        box.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
      );
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? i <= 0
          ? items.length - 1
          : i - 1
        : i === -1 || i === items.length - 1
          ? 0
          : i + 1;
      e.preventDefault();
      items[next]!.focus();
    }
  };

  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={() => answer(false)}>
      <div
        ref={box}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-describedby={`confirm-msg-${req.id}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div id={`confirm-msg-${req.id}`} className="confirm-message">
          {req.message}
        </div>
        <div className="confirm-actions">
          <button type="button" onClick={() => answer(false)}>
            {req.cancelLabel ?? t('cancel')}
          </button>
          <button
            type="button"
            ref={okBtn}
            className={req.danger ? 'danger' : 'primary'}
            onClick={() => answer(true)}
          >
            {req.okLabel ?? t('accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
