import { useSyncExternalStore } from 'react';

/** Options of an in-app confirmation (see `confirmDialog`). */
export interface ConfirmOptions {
  /** A destructive action: the confirm button is red. */
  danger?: boolean;
  /** Text of the confirm button (default: "Accept" in the UI language). */
  okLabel?: string;
  /** Text of the cancel button (default: "Cancel" in the UI language). */
  cancelLabel?: string;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
  message: string;
  resolve: (ok: boolean) => void;
}

// Questions waiting for an answer, shown one at a time (the first one).
let queue: ConfirmRequest[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/**
 * Asks the user to confirm, in the app's own dialog (window.confirm shows its buttons in the
 * language of the system, not of the app). Resolves true when confirmed; Esc or Cancel → false.
 */
export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...opts, id: ++seq, message, resolve }];
    emit();
  });
}

/** Answers the question shown (the first in line). */
export function answerConfirm(id: number, ok: boolean): void {
  const req = queue.find((q) => q.id === id);
  if (!req) return;
  queue = queue.filter((q) => q.id !== id);
  emit();
  req.resolve(ok);
}

/** The question to show now (null = none). */
export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue[0] ?? null,
  );
}
