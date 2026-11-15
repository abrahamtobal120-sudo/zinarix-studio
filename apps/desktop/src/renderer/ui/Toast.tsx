import { useSyncExternalStore } from 'react';

export type ToastKind = 'info' | 'ok' | 'error';

export type ToastItem = {
  id: number;
  text: string;
  kind: ToastKind;
  action?: { label: string; run: () => void };
};

/** At most this many on screen: a new one pushes the oldest out. */
export const MAX_TOASTS = 3;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(next: ToastItem[]): void {
  items = next;
  for (const l of listeners) l();
}

/** Removes one notice (its timer too). */
export function dismissToast(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (items.some((t) => t.id === id)) emit(items.filter((t) => t.id !== id));
}

/**
 * Queues a notice. Unlike the old single-text toast, a new one does not erase the one before.
 * Errors and notices with an action stay longer (6 s) than plain ones (4 s).
 */
export function pushToast(
  text: string,
  opts: { kind?: ToastKind; action?: ToastItem['action']; duration?: number } = {},
): number {
  const id = nextId++;
  const item: ToastItem = { id, text, kind: opts.kind ?? 'info', action: opts.action };
  const kept = [...items, item];
  for (const old of kept.slice(0, Math.max(0, kept.length - MAX_TOASTS))) {
    clearTimeout(timers.get(old.id));
    timers.delete(old.id);
  }
  emit(kept.slice(-MAX_TOASTS));
  const ms = opts.duration ?? (item.kind === 'error' || item.action ? 6000 : 4000);
  if (ms > 0 && Number.isFinite(ms)) timers.set(id, setTimeout(() => dismissToast(id), ms));
  return id;
}

/** Clears the queue (tests, or leaving a screen). */
export function clearToasts(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  emit([]);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  );
}

/**
 * The stack of notices, bottom right. Mount it once. Errors are announced at once (role="alert"),
 * the rest politely.
 */
export function ToastViewport({ closeLabel = 'Cerrar' }: { closeLabel?: string }) {
  const list = useToasts();
  return (
    <div className="ui-toasts" role="region" aria-label="Notificaciones">
      <div className="ui-toasts-polite" aria-live="polite">
        {list
          .filter((t) => t.kind !== 'error')
          .map((t) => (
            <Toast key={t.id} item={t} closeLabel={closeLabel} />
          ))}
      </div>
      <div className="ui-toasts-assertive" role="alert">
        {list
          .filter((t) => t.kind === 'error')
          .map((t) => (
            <Toast key={t.id} item={t} closeLabel={closeLabel} />
          ))}
      </div>
    </div>
  );
}

function Toast({ item, closeLabel }: { item: ToastItem; closeLabel: string }) {
  return (
    <div className={`ui-toast ui-toast-${item.kind}`} data-toast-id={item.id}>
      <span className="ui-toast-text">{item.text}</span>
      {item.action && (
        <button
          type="button"
          data-ui="button"
          className="ui-toast-action"
          onClick={() => {
            item.action!.run();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        data-ui="button"
        className="ui-toast-close"
        aria-label={closeLabel}
        onClick={() => dismissToast(item.id)}
      >
        ×
      </button>
    </div>
  );
}
