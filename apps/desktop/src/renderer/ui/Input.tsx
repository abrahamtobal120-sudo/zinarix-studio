import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Marks the value as wrong (red border, aria-invalid). */
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      data-ui="input"
      className={className ? `ui-input ${className}` : 'ui-input'}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      data-ui="input"
      className={className ? `ui-input ui-textarea ${className}` : 'ui-input ui-textarea'}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

/**
 * Label + control + help + error, wired with htmlFor and aria-describedby. The control gets its
 * props from a function: `<Field label="Nombre">{(p) => <Input {...p} />}</Field>`.
 */
export function Field({
  label,
  help,
  error,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  children: (props: { id: string; 'aria-describedby'?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, invalid: !!error })}
      {help && (
        <div className="ui-field-help" id={helpId}>
          {help}
        </div>
      )}
      {error && (
        <div className="ui-field-error" id={errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
