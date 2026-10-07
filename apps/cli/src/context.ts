import { OmniCore } from '@omni/core';
import { t } from '@omni/shared';
import { readHidden } from './io.js';

let core: OmniCore | undefined;

/** Lazily opens the shared core (config, catalog, vault, DB) once per process. */
export function omni(): OmniCore {
  core ??= OmniCore.open({ askPassword: () => readHidden(t('vault.password')) });
  return core;
}

export function closeOmni(): void {
  core?.close();
  core = undefined;
}

/** AbortSignal wired to Ctrl+C: first press cancels the stream cleanly. */
export function interruptSignal(): AbortSignal {
  const ctrl = new AbortController();
  const onSig = () => {
    if (ctrl.signal.aborted) process.exit(130);
    ctrl.abort();
  };
  process.on('SIGINT', onSig);
  return ctrl.signal;
}
