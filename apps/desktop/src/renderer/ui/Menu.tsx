import { DropdownMenu as R } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { Kbd } from './Kbd';
import { portalContainer } from './portal';

export type MenuItem =
  | {
      label: ReactNode;
      onSelect: () => void;
      icon?: ReactNode;
      /** Shown on the right, drawn with Kbd ("Ctrl+S"). */
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
    }
  | { label: ReactNode; icon?: ReactNode; items: MenuItem[]; disabled?: boolean }
  | { separator: true }
  | { heading: ReactNode };

function Items({ items }: { items: MenuItem[] }) {
  return (
    <>
      {items.map((it, i) => {
        if ('separator' in it) return <R.Separator key={i} className="ui-menu-sep" />;
        if ('heading' in it)
          return (
            <R.Label key={i} className="ui-menu-heading">
              {it.heading}
            </R.Label>
          );
        if ('items' in it)
          return (
            <R.Sub key={i}>
              <R.SubTrigger className="ui-menu-item" disabled={it.disabled}>
                <span className="ui-menu-icon">{it.icon}</span>
                <span className="ui-menu-label">{it.label}</span>
                <span className="ui-menu-chevron" aria-hidden="true">
                  ›
                </span>
              </R.SubTrigger>
              <R.Portal container={portalContainer()}>
                <R.SubContent className="ui-menu" sideOffset={2} collisionPadding={8}>
                  <Items items={it.items} />
                </R.SubContent>
              </R.Portal>
            </R.Sub>
          );
        return (
          <R.Item
            key={i}
            className={it.danger ? 'ui-menu-item is-danger' : 'ui-menu-item'}
            disabled={it.disabled}
            onSelect={it.onSelect}
          >
            <span className="ui-menu-icon">{it.icon}</span>
            <span className="ui-menu-label">{it.label}</span>
            {it.shortcut && <Kbd keys={it.shortcut} className="ui-menu-kbd" />}
          </R.Item>
        );
      })}
    </>
  );
}

/**
 * Drop-down menu on Radix: arrow keys, Enter, Escape, type-ahead and submenus (right arrow).
 * Focus goes back to the trigger when it closes. The trigger must take a ref.
 */
export function Menu({
  trigger,
  items,
  align = 'start',
  side = 'bottom',
  label,
  open,
  onOpenChange,
}: {
  trigger: ReactElement;
  items: MenuItem[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Accessible name of the menu, when the trigger has no text. */
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <R.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <R.Trigger asChild>{trigger}</R.Trigger>
      <R.Portal container={portalContainer()}>
        <R.Content
          className="ui-menu"
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
        >
          <Items items={items} />
        </R.Content>
      </R.Portal>
    </R.Root>
  );
}
