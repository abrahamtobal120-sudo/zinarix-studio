import type { ReactNode } from 'react';

/** An icon, a title, a line of text and one action, centered in the free space. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      {icon && (
        <div className="ui-empty-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="ui-empty-title">{title}</div>
      {children && <div className="ui-empty-text">{children}</div>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}
