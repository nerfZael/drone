import * as React from 'react';
import { cn } from '../cn';

export type UiFieldProps = {
  label: React.ReactNode;
  htmlFor?: string;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
};

export function UiField({ label, htmlFor, description, error, required, children, className }: UiFieldProps) {
  const messageId = React.useId();
  const message = error ?? description;
  const connectedChild = React.isValidElement<{
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'true' | 'false';
    'aria-required'?: boolean;
  }>(children)
    ? React.cloneElement(children, {
        'aria-describedby': message
          ? [children.props['aria-describedby'], messageId].filter(Boolean).join(' ')
          : children.props['aria-describedby'],
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-required': required || children.props['aria-required'] || undefined,
      })
    : children;

  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[length:var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.07em] text-[var(--muted)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        {label}
        {required ? <span className="ml-1 text-[var(--red)]" aria-hidden="true">*</span> : null}
      </label>
      {connectedChild}
      {error ? (
        <div id={messageId} role="alert" className="mt-1.5 text-[length:var(--text-10)] leading-relaxed text-[var(--red)]">{error}</div>
      ) : description ? (
        <div id={messageId} className="mt-1.5 text-[length:var(--text-10)] leading-relaxed text-[var(--muted-dim)]">{description}</div>
      ) : null}
    </div>
  );
}

const controlClassName =
  'w-full rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--fg)] placeholder:text-[var(--muted-dim)] transition-[background-color,border-color,box-shadow] hover:border-[var(--border)] focus:border-[var(--accent-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-border)] disabled:cursor-not-allowed disabled:opacity-40';

export type UiInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const UiInput = React.forwardRef<HTMLInputElement, UiInputProps>(function UiInput(
  { invalid = false, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        controlClassName,
        'h-[var(--control-height)] px-3 text-[length:var(--text-12)]',
        invalid && 'border-[var(--red-border)] focus:border-[var(--red)] focus:ring-[var(--red-border)]',
        className,
      )}
      {...props}
    />
  );
});

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.35" />
      <path d="m10.25 10.25 3 3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

export type UiSearchInputProps = Omit<UiInputProps, 'type'> & {
  onClear?: () => void;
  clearLabel?: string;
};

export const UiSearchInput = React.forwardRef<HTMLInputElement, UiSearchInputProps>(function UiSearchInput(
  { value, defaultValue, onClear, clearLabel = 'Clear search', className, ...props },
  ref,
) {
  const hasValue = String(value ?? defaultValue ?? '').length > 0;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-dim)]">
        <SearchIcon />
      </span>
      <UiInput
        ref={ref}
        type="search"
        value={value}
        defaultValue={defaultValue}
        className={cn('pl-9', onClear && hasValue && 'pr-9', className)}
        {...props}
      />
      {onClear && hasValue ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
});

export type UiTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const UiTextarea = React.forwardRef<HTMLTextAreaElement, UiTextareaProps>(function UiTextarea(
  { invalid = false, className, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        controlClassName,
        'resize-y px-3 py-2 text-[length:var(--text-12)] leading-relaxed',
        invalid && 'border-[var(--red-border)] focus:border-[var(--red)] focus:ring-[var(--red-border)]',
        className,
      )}
      {...props}
    />
  );
});

export type UiSwitchProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'onChange' | 'onClick' | 'role' | 'type'
> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
};

export function UiSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
  ...props
}: UiSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'group flex w-full items-start gap-3 rounded-[var(--radius-medium)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-[background-color,border-color]',
          checked
            ? 'border-[var(--accent)] bg-[var(--accent)]'
            : 'border-[var(--border)] bg-[var(--surface-inset-strong)] group-hover:border-[var(--muted-dim)]',
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            'h-3.5 w-3.5 rounded-full shadow-[0_1px_3px_var(--shadow-color)] transition-transform',
            checked ? 'translate-x-4 bg-[var(--accent-fg)]' : 'translate-x-0 bg-[var(--muted)]',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[length:var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">{label}</span>
        {description ? <span className="mt-0.5 block text-[length:var(--text-10)] leading-relaxed text-[var(--muted-dim)]">{description}</span> : null}
      </span>
    </button>
  );
}

export type UiCheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: React.ReactNode;
  description?: React.ReactNode;
};

export const UiCheckbox = React.forwardRef<HTMLInputElement, UiCheckboxProps>(function UiCheckbox(
  { label, description, className, ...props },
  ref,
) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5', props.disabled && 'cursor-not-allowed opacity-40', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer sr-only"
        {...props}
      />
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--border)] bg-[var(--surface-inset)] text-transparent transition-[background-color,border-color,color,box-shadow] peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:text-[var(--accent-fg)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus-ring)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--panel)]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
          <path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[length:var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">{label}</span>
        {description ? <span className="mt-0.5 block text-[length:var(--text-10)] leading-relaxed text-[var(--muted-dim)]">{description}</span> : null}
      </span>
    </label>
  );
});

export type UiSliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const UiSlider = React.forwardRef<HTMLInputElement, UiSliderProps>(function UiSlider(
  { className, disabled, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="range"
      disabled={disabled}
      className={cn(
        'h-5 w-full cursor-pointer appearance-none bg-transparent accent-[var(--accent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
        '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[var(--surface-strong)]',
        '[&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--accent-fg)] [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_1px_5px_var(--shadow-color)]',
        'focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-[var(--focus-ring)] focus-visible:[&::-webkit-slider-thumb]:ring-offset-2 focus-visible:[&::-webkit-slider-thumb]:ring-offset-[var(--panel)]',
        '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--surface-strong)]',
        '[&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-[var(--accent)]',
        '[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--accent-fg)] [&::-moz-range-thumb]:bg-[var(--accent)]',
        className,
      )}
      {...props}
    />
  );
});

export type UiFileInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const UiFileInput = React.forwardRef<HTMLInputElement, UiFileInputProps>(function UiFileInput(
  { className, disabled, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="file"
      disabled={disabled}
      className={cn(
        'block h-[var(--control-height)] w-full cursor-pointer rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[length:var(--text-11)] text-[var(--muted)] transition-[border-color,box-shadow] file:mr-3 file:h-full file:cursor-pointer file:border-0 file:border-r file:border-solid file:border-[var(--border-subtle)] file:bg-[var(--surface-softest)] file:px-3 file:text-[length:var(--text-10)] file:font-[var(--weight-semibold)] file:text-[var(--fg-secondary)] hover:border-[var(--border)] hover:file:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40 disabled:file:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
});
