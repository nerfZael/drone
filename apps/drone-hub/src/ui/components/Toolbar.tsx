import * as React from 'react';
import { cn } from '../cn';
import { useSlidingIndicator } from '../use-sliding-indicator';
import { UiSpinner } from './Feedback';

export type UiToolbarControlTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export type UiToolbarControlSize = 'xsmall' | 'small';

/* Quiet chat-like chrome: no always-on boxes, no shared-edge stacks.
   Color and fill arrive on hover / activation only. */
const toneClassName: Record<UiToolbarControlTone, { idle: string; active: string }> = {
  neutral: {
    idle: 'border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
    active: 'border-transparent bg-[var(--surface-strong)] text-[var(--fg)]',
  },
  accent: {
    idle: 'border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]',
    active: 'border-transparent bg-[var(--accent-subtle)] text-[var(--accent)]',
  },
  success: {
    idle: 'border-transparent bg-transparent text-[var(--green)] hover:bg-[var(--green-subtle)]',
    active: 'border-transparent bg-[var(--green-subtle)] text-[var(--green)]',
  },
  warning: {
    idle: 'border-transparent bg-transparent text-[var(--yellow)] hover:bg-[var(--yellow-subtle)]',
    active: 'border-transparent bg-[var(--yellow-subtle)] text-[var(--yellow)]',
  },
  danger: {
    idle: 'border-transparent bg-transparent text-[var(--red)] hover:bg-[var(--red-subtle)]',
    active: 'border-transparent bg-[var(--red-subtle)] text-[var(--red)]',
  },
};

const sizeClassName: Record<UiToolbarControlSize, string> = {
  xsmall: 'h-6 min-w-6 rounded-[var(--radius-medium)] px-2 text-[length:var(--text-10)]',
  small: 'h-8 min-w-8 rounded-[var(--radius-medium)] px-2.5 text-[length:var(--text-11)]',
};

const iconSlotClassName: Record<UiToolbarControlSize, string> = {
  xsmall: 'h-3.5 w-3.5',
  small: 'h-4 w-4',
};

export type UiToolbarButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: UiToolbarControlTone;
  size?: UiToolbarControlSize;
  pressed?: boolean;
  active?: boolean;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
};

export const UiToolbarButton = React.forwardRef<HTMLButtonElement, UiToolbarButtonProps>(
  function UiToolbarButton(
    {
      tone = 'neutral',
      size = 'small',
      pressed,
      active = false,
      loading = false,
      leadingIcon,
      trailingIcon,
      disabled,
      className,
      children,
      type = 'button',
      style,
      ...props
    },
    ref,
  ) {
    const unavailable = disabled || loading;
    const visuallyActive = active || pressed === true;
    return (
      <button
        ref={ref}
        type={type}
        disabled={unavailable}
        aria-pressed={
          props['aria-pressed'] ?? (typeof pressed === 'boolean' ? pressed : undefined)
        }
        aria-busy={loading || undefined}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 border font-[var(--weight-semibold)] transition-[background-color,border-color,color,opacity] duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40',
          sizeClassName[size],
          visuallyActive ? toneClassName[tone].active : toneClassName[tone].idle,
          className,
        )}
        style={{ fontFamily: 'var(--display)', ...style }}
        {...props}
      >
        {loading ? <UiSpinner size="small" label={null} inheritColor /> : leadingIcon}
        {children != null ? <span className="min-w-0 truncate">{children}</span> : null}
        {trailingIcon}
      </button>
    );
  },
);

export type UiToolbarIconButtonProps = Omit<
  UiToolbarButtonProps,
  'children' | 'leadingIcon' | 'trailingIcon'
> & {
  label: string;
  icon: React.ReactNode;
};

export const UiToolbarIconButton = React.forwardRef<
  HTMLButtonElement,
  UiToolbarIconButtonProps
>(function UiToolbarIconButton({ label, icon, title, className, size = 'small', ...props }, ref) {
  return (
    <UiToolbarButton
      ref={ref}
      size={size}
      aria-label={label}
      title={title ?? label}
      className={cn('px-0', className)}
      {...props}
    >
      <span
        className={cn('flex items-center justify-center', iconSlotClassName[size])}
        aria-hidden="true"
      >
        {icon}
      </span>
    </UiToolbarButton>
  );
});

export type UiToolbarLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  tone?: UiToolbarControlTone;
  size?: UiToolbarControlSize;
  active?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
};

export const UiToolbarLink = React.forwardRef<HTMLAnchorElement, UiToolbarLinkProps>(
  function UiToolbarLink(
    {
      tone = 'neutral',
      size = 'small',
      active = false,
      leadingIcon,
      trailingIcon,
      className,
      children,
      style,
      ...props
    },
    ref,
  ) {
    return (
      <a
        ref={ref}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 border font-[var(--weight-semibold)] transition-[background-color,border-color,color,opacity] duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
          sizeClassName[size],
          active ? toneClassName[tone].active : toneClassName[tone].idle,
          className,
        )}
        style={{ fontFamily: 'var(--display)', ...style }}
        {...props}
      >
        {leadingIcon}
        {children != null ? <span className="min-w-0 truncate">{children}</span> : null}
        {trailingIcon}
      </a>
    );
  },
);

export function UiToolbarGroup({
  label,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex shrink-0 items-center gap-0.5', className)}
      {...props}
    />
  );
}

export function UiToolbarDivider({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={cn('mx-1 h-4 w-px shrink-0 bg-[var(--border-subtle)]', className)}
      {...props}
    />
  );
}

export type UiToolbarInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  controlSize?: UiToolbarControlSize;
  invalid?: boolean;
};

export const UiToolbarInput = React.forwardRef<HTMLInputElement, UiToolbarInputProps>(
  function UiToolbarInput(
    { controlSize = 'small', invalid = false, className, ...props },
    ref,
  ) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'min-w-0 rounded-[var(--radius-medium)] border border-transparent bg-[var(--surface-inset)] px-2.5 font-mono text-[var(--fg-secondary)] transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-[var(--muted-dim)] hover:bg-[var(--surface-inset-strong)] focus:border-[var(--accent-muted)] focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-subtle)] read-only:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40',
          controlSize === 'xsmall'
            ? 'h-6 text-[length:var(--text-10)]'
            : 'h-8 text-[length:var(--text-11)]',
          invalid &&
            'border-[var(--red-border)] focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-subtle)]',
          className,
        )}
        {...props}
      />
    );
  },
);

export type UiToolbarSegmentOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  tone?: UiToolbarControlTone;
};

export type UiToolbarSegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<UiToolbarSegmentOption<T>>;
  onValueChange: (value: T) => void;
  size?: UiToolbarControlSize;
  disabled?: boolean;
  className?: string;
};

export function UiToolbarSegmentedControl<T extends string>({
  label,
  value,
  options,
  onValueChange,
  size = 'small',
  disabled = false,
  className,
}: UiToolbarSegmentedControlProps<T>) {
  const optionRefs = React.useRef(new Map<T, HTMLButtonElement>());
  const enabledOptions = options.filter((option) => !(disabled || option.disabled));
  const selectedOptionEnabled = enabledOptions.some((option) => option.value === value);
  const tabStopValue = selectedOptionEnabled ? value : enabledOptions[0]?.value;

  const moveSelection = (currentValue: T, key: string) => {
    if (enabledOptions.length === 0) return;
    const currentIndex = enabledOptions.findIndex((option) => option.value === currentValue);
    let nextIndex = currentIndex;
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      nextIndex = (currentIndex + 1 + enabledOptions.length) % enabledOptions.length;
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      nextIndex =
        currentIndex < 0
          ? enabledOptions.length - 1
          : (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
    } else if (key === 'Home') {
      nextIndex = 0;
    } else if (key === 'End') {
      nextIndex = enabledOptions.length - 1;
    } else {
      return;
    }
    const nextValue = enabledOptions[nextIndex].value;
    onValueChange(nextValue);
    window.requestAnimationFrame(() => optionRefs.current.get(nextValue)?.focus());
  };

  const { containerRef, indicator } = useSlidingIndicator(value, optionRefs);

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        'relative inline-flex shrink-0 items-center gap-0.5 rounded-[var(--radius-medium)] bg-[var(--surface-inset)] p-0.5',
        className,
      )}
    >
      {indicator ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-[calc(var(--radius-medium)-1px)] bg-[var(--accent-subtle)] transition-[left,width] duration-200 ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none"
          style={{ left: indicator.left, width: indicator.width }}
        />
      ) : null}
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              if (element) optionRefs.current.set(option.value, element);
              else optionRefs.current.delete(option.value);
            }}
            type="button"
            disabled={disabled || option.disabled}
            role="radio"
            aria-checked={selected}
            tabIndex={option.value === tabStopValue ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                  event.key,
                )
              ) {
                return;
              }
              event.preventDefault();
              moveSelection(option.value, event.key);
            }}
            className={cn(
              'relative z-[1] inline-flex shrink-0 items-center justify-center gap-1 rounded-[calc(var(--radius-medium)-1px)] font-[var(--weight-semibold)] transition-colors duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40',
              size === 'xsmall'
                ? 'h-6 px-2.5 text-[length:var(--text-10)]'
                : 'h-7 px-3 text-[length:var(--text-11)]',
              selected
                ? 'text-[var(--accent)]'
                : 'text-[var(--muted)] enabled:hover:text-[var(--fg-secondary)]',
              // Static fallback fill until the sliding indicator mounts.
              selected && !indicator && 'bg-[var(--accent-subtle)]',
            )}
            style={{ fontFamily: 'var(--display)' }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
