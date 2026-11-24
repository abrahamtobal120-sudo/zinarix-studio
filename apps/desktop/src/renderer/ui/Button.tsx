import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  /** Defaults to "button", so a Button inside a <form> never submits by accident. */
  type?: 'button' | 'submit' | 'reset';
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks (aria-busy). */
  loading?: boolean;
  /** Icon or other node before the label. */
  start?: ReactNode;
};

function cls(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    start,
    className,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-ui="button"
      className={cls(
        'ui-btn',
        `ui-btn-${variant}`,
        `ui-btn-${size}`,
        loading && 'is-loading',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : start}
      {children !== undefined && children !== null && (
        <span className="ui-btn-label">{children}</span>
      )}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonProps, 'children' | 'start' | 'aria-label'> & {
  /** Required: it is the accessible name and the tooltip. */
  label: string;
  icon: ReactNode;
  /** Extra text for the tooltip, such as the shortcut. */
  hint?: ReactNode;
};

/** A square button with only an icon. `label` is mandatory (the compiler enforces it). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, hint, variant = 'ghost', className, ...rest },
  ref,
) {
  return (
    <Tooltip
      content={
        hint ? (
          <>
            {label} {hint}
          </>
        ) : (
          label
        )
      }
    >
      <Button
        ref={ref}
        variant={variant}
        aria-label={label}
        className={cls('ui-icon-btn', className)}
        start={icon}
        {...rest}
      />
    </Tooltip>
  );
});
