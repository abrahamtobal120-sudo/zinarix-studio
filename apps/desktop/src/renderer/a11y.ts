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

/**
 * Keyboard handling for one tab of a role="tablist" with a roving tabindex (the selected tab
 * has tabIndex 0, the others -1): ←/→/Home/End move the focus between tabs, Enter or Space
 * activate the focused one, and Delete or Ctrl+W close it when `close` is given.
 */
export function tabKeyDown(
  e: KeyboardEvent<HTMLElement>,
  activate: () => void,
  close?: () => void,
): void {
  // Keys pressed on a control inside the tab (its close button) belong to that control.
  if (e.target !== e.currentTarget) return;
  const tabs = [
    ...(e.currentTarget
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
  ];
  const i = tabs.indexOf(e.currentTarget);
  const move = (j: number) => tabs[(j + tabs.length) % tabs.length]?.focus();
  if (e.key === 'ArrowRight') move(i + 1);
  else if (e.key === 'ArrowLeft') move(i - 1);
  else if (e.key === 'Home') move(0);
  else if (e.key === 'End') move(tabs.length - 1);
  else if (e.key === 'Enter' || e.key === ' ') activate();
  else if (
    close &&
    (e.key === 'Delete' || (e.key.toLowerCase() === 'w' && (e.ctrlKey || e.metaKey)))
  ) {
    // The focus goes to a neighbour, so the keyboard user is not dropped to <body>.
    (tabs[i + 1] ?? tabs[i - 1])?.focus();
    close();
  } else return;
  e.preventDefault();
  e.stopPropagation();
}
