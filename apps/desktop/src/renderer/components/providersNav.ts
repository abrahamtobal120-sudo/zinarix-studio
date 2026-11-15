import { setState } from '../store';

export type ProvidersKind = 'all' | 'connected' | 'cli' | 'api' | 'local';

// One-shot options for the next Providers modal (the modal state only carries `focus`).
let pending: { kind?: ProvidersKind; onClose?: () => void } = {};

/**
 * Opens Providers already filtered by kind; `onClose` runs when it is closed (the onboarding
 * uses it to come back to its step).
 */
export function openProviders(opts: { kind?: ProvidersKind; onClose?: () => void } = {}): void {
  pending = opts;
  setState({ modal: { kind: 'providers' } });
}

/** Options for the Providers modal that is opening (read while it renders the first time). */
export function peekProvidersOptions(): { kind?: ProvidersKind; onClose?: () => void } {
  return pending;
}

/** Called once the Providers modal has mounted: the options do not leak into the next one. */
export function clearProvidersOptions(): void {
  pending = {};
}
