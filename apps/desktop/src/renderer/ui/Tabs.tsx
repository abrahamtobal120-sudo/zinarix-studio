import { Tabs as R } from 'radix-ui';
import type { ReactNode } from 'react';

export type TabItem = { value: string; label: ReactNode; content: ReactNode; disabled?: boolean };

/** Tabs on Radix: arrow keys, Home/End and roving focus come with it. */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  className,
}: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}) {
  return (
    <R.Root
      className={className ? `ui-tabs ${className}` : 'ui-tabs'}
      value={value}
      defaultValue={value === undefined ? (defaultValue ?? items[0]?.value) : undefined}
      onValueChange={onValueChange}
    >
      <R.List className="ui-tabs-list" aria-label={label}>
        {items.map((it) => (
          <R.Trigger
            key={it.value}
            value={it.value}
            disabled={it.disabled}
            className="ui-tabs-trigger"
            data-ui="tab"
          >
            {it.label}
          </R.Trigger>
        ))}
      </R.List>
      {items.map((it) => (
        <R.Content key={it.value} value={it.value} className="ui-tabs-content">
          {it.content}
        </R.Content>
      ))}
    </R.Root>
  );
}
