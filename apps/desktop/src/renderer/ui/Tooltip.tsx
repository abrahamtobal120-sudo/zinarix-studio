import { Tooltip as R } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { portalContainer } from './portal';

const DELAY = 500;
const SKIP = 300;

/**
 * Mount once near the root of the app: 500 ms before the first tooltip, then none while the
 * pointer moves from one control to the next.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <R.Provider delayDuration={DELAY} skipDelayDuration={SKIP}>
      {children}
    </R.Provider>
  );
}

/**
 * Tooltip on Radix. The child must take a ref (a DOM element or a forwardRef component). Works
 * without a TooltipProvider above it too, so primitives can use it anywhere.
 */
export function Tooltip({
  content,
  side = 'top',
  children,
}: {
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}) {
  if (content === null || content === undefined || content === '') return children;
  return (
    <R.Provider delayDuration={DELAY} skipDelayDuration={SKIP}>
      <R.Root>
        <R.Trigger asChild>{children}</R.Trigger>
        <R.Portal container={portalContainer()}>
          <R.Content className="ui-tooltip" side={side} sideOffset={6} collisionPadding={8}>
            {content}
          </R.Content>
        </R.Portal>
      </R.Root>
    </R.Provider>
  );
}
