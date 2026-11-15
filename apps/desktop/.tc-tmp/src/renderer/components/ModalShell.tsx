import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Focusable elements inside `root`, in DOM order, skipping hidden ones. */
export function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[inert]'),
  );
}

// Open shells, innermost last: only the top one answers Esc and traps Tab.
const stack: object[] = [];

/**
 * Accessible modal wrapper (role="dialog", aria-modal). It keeps the markup of the existing
 * modals: `.modal-backdrop` > `<div className={className}>`.
 * - Remembers the focused element when it opens and gives the focus back when it closes.
 * - Focuses the first control (unless a child already took the focus with autoFocus).
 * - Tab / Shift+Tab stay inside the dialog.
 * - Esc calls `onClose`, wherever the focus is (also on <body>).
 * - A click on the backdrop calls `onBackdrop` (default `onClose`; `null` = does nothing).
 */
export function ModalShell({
  onClose,
  onBackdrop,
  className,
  backdropClassName,
  labelledBy,
  label,
  describedBy,
  style,
  children,
}: {
  onClose: () => void;
  onBackdrop?: (() => void) | null;
  className?: string;
  backdropClassName?: string;
  /** id of the element that names the dialog (its title). */
  labelledBy?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
  describedBy?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Read during the first render, before any autoFocus child moves the focus.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    const me = {};
    stack.push(me);
    const root = box.current;
    if (root && !root.contains(document.activeElement)) {
      (focusables(root)[0] ?? root).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me || e.defaultPrevented) return;
      // The confirmation dialog on top handles its own keys.
      if (document.querySelector('.confirm-dialog')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab' || !box.current) return;
      const items = focusables(box.current);
      if (!items.length) {
        e.preventDefault();
        box.current.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && box.current.contains(active);
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === box.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      // Back to where the user was (if it is still there).
      if (before && before.isConnected && before !== document.body) before.focus();
    };
  }, [before]);

  const backdrop = onBackdrop === undefined ? onClose : onBackdrop;
  return (
    <div
      className={backdropClassName ? `modal-backdrop ${backdropClassName}` : 'modal-backdrop'}
      onMouseDown={() => backdrop?.()}
    >
      <div
        ref={box}
        className={className}
        style={{ outline: 'none', ...style }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        tabIndex={-1}
        onMouseDown={(e: MouseEvent) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
