import { Dialog as R } from 'radix-ui';
import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { portalContainer } from './portal';

/**
 * Modal dialog on Radix with the same props and markup as ModalShell
 * (`.modal-backdrop` > `<div className>`), so moving a ModalShell to Dialog is a rename and the
 * existing CSS of each dialog keeps working.
 *
 * Like ModalShell it is open while mounted. Radix adds what ModalShell does by hand: focus moves
 * in, Tab stays inside, Esc closes and focus returns to the control that opened it. It also locks
 * the page scroll and hides the rest of the window from screen readers.
 *
 * ModalShell itself is not built on this yet: confirmDialog() draws its own box outside any
 * Radix layer, and a Radix modal under it would take its focus and its clicks. That swap waits
 * until confirmDialog uses Dialog too.
 */
export function Dialog({
  onClose,
  onBackdrop,
  className,
  backdropClassName,
  labelledBy,
  label,
  title,
  describedBy,
  style,
  children,
}: {
  onClose: () => void;
  /** Click on the backdrop. Default: onClose. `null`: does nothing. */
  onBackdrop?: (() => void) | null;
  className?: string;
  backdropClassName?: string;
  /** id of the element that names the dialog (its visible title). */
  labelledBy?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
  /** Visible title, drawn as an <h2> at the top. */
  title?: ReactNode;
  describedBy?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const backdrop = onBackdrop === undefined ? onClose : onBackdrop;
  const overlay = useRef<HTMLDivElement>(null);
  // Like ModalShell: read on the first render, before an autoFocus child takes the focus.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  return (
    <R.Root open onOpenChange={(open) => !open && onClose()}>
      <R.Portal container={portalContainer()}>
        <R.Overlay
          ref={overlay}
          className={backdropClassName ? `modal-backdrop ${backdropClassName}` : 'modal-backdrop'}
        >
          <R.Content
            className={className}
            style={{ outline: 'none', ...style }}
            // Only when given: an explicit undefined would drop the name Radix wires to the title.
            {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
            aria-describedby={describedBy}
            onEscapeKeyDown={(e) => {
              // The confirmation box on top answers Esc itself.
              if (document.querySelector('.confirm-dialog')) e.preventDefault();
            }}
            onPointerDownOutside={(e) => {
              e.preventDefault();
              // Only the backdrop itself: a click on a toast or another floating box is not one.
              if (e.detail.originalEvent.target === overlay.current) backdrop?.();
            }}
            onInteractOutside={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => {
              // Radix would focus its own Trigger; ModalShell's callers have none, so go back to
              // whatever had the focus before the dialog opened (if it is still there).
              e.preventDefault();
              if (before && before.isConnected && before !== document.body) before.focus();
            }}
          >
            {title ? (
              <R.Title className="ui-dialog-title">{title}</R.Title>
            ) : (
              <R.Title className="ui-sr-only">{label ?? ''}</R.Title>
            )}
            {children}
          </R.Content>
        </R.Overlay>
      </R.Portal>
    </R.Root>
  );
}

/** A button (or any element) that closes the dialog it is in. */
export const DialogClose = R.Close;
/** Text that describes the dialog; Radix wires it with aria-describedby. */
export const DialogDescription = R.Description;
