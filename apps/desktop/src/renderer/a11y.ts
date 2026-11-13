import type { KeyboardEvent, SyntheticEvent } from 'react';

/**
 * Props that make a clickable non-button element (a row that also holds buttons of its own,
 * so it cannot be a <button>) usable from the keyboard: focusable, announced as a button,
 * and pressed with Enter or Space. Spread it in place of `onClick`.
 */
export function pressable<E extends HTMLElement = HTMLElement>(
  onPress: (e: SyntheticEvent<E>) => void,
): {
  role: 'button';
  tabIndex: 0;
  onClick: (e: SyntheticEvent<E>) => void;
  onKeyDown: (e: KeyboardEvent<E>) => void;
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e) => {
      // Keys pressed on a control inside the row (a button, an input) belong to that control.
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPress(e);
      }
    },
  };
}
