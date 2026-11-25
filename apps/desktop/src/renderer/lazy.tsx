import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';

/**
 * C2: load a panel or viewer only the first time it is shown, so its code (and what it pulls in:
 * three.js, the notebook, the paint tools...) stays out of the bundle the app starts with.
 *
 * `load` must return the module; `name` picks the named export. The wrapper brings its own
 * Suspense, so call sites keep rendering it like any other component. A chunk that fails to load
 * throws into the nearest ErrorBoundary, which already offers "Retry".
 */
export function lazyNamed<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
  fallback: ReactNode = null,
): M[K] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Inner = lazy(async () => ({ default: (await load())[name] as ComponentType<any> }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Wrapped = (props: any) => (
    <Suspense fallback={fallback}>
      <Inner {...props} />
    </Suspense>
  );
  Wrapped.displayName = `Lazy(${String(name)})`;
  return Wrapped as unknown as M[K];
}
