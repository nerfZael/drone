import * as React from 'react';
import { cn } from '../cn';

const selectBaseClassName =
  'dh-field-control w-full appearance-none rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] bg-[linear-gradient(45deg,transparent_50%,var(--muted-dim)_50%),linear-gradient(135deg,var(--muted-dim)_50%,transparent_50%)] bg-[position:calc(100%-13px)_50%,calc(100%-9px)_50%] bg-[size:4px_4px,4px_4px] bg-no-repeat px-3 pr-8 text-[var(--field-fg)] shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--shadow-color)_50%,transparent)] transition-[background-color,border-color,box-shadow] duration-150 hover:border-[var(--border)] disabled:cursor-not-allowed disabled:opacity-40';

export type UiSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  size?: 'small' | 'medium';
};

export const UiSelect = React.forwardRef<HTMLSelectElement, UiSelectProps>(function UiSelect(
  { invalid = false, size = 'medium', className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        selectBaseClassName,
        size === 'small' ? 'h-7 dh-type-control-compact' : 'h-[var(--control-height)] dh-type-control',
        invalid && 'border-[var(--red-border)]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export type UiChoiceOption<T extends string> = {
  value: T;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
  disabled?: boolean;
};

export type UiChoiceGroupProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<UiChoiceOption<T>>;
  onValueChange: (value: T) => void;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
  className?: string;
};

export function UiChoiceGroup<T extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  columns = 1,
  className,
}: UiChoiceGroupProps<T>) {
  const optionRefs = React.useRef(new Map<T, HTMLButtonElement>());
  const moveSelection = (currentValue: T, key: string) => {
    const enabledOptions = options.filter((option) => !(disabled || option.disabled));
    if (enabledOptions.length === 0) return;
    const currentIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === currentValue));
    let nextIndex = currentIndex;
    if (key === 'ArrowRight' || key === 'ArrowDown') nextIndex = (currentIndex + 1) % enabledOptions.length;
    else if (key === 'ArrowLeft' || key === 'ArrowUp') nextIndex = (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
    else if (key === 'Home') nextIndex = 0;
    else if (key === 'End') nextIndex = enabledOptions.length - 1;
    else return;
    const nextValue = enabledOptions[nextIndex].value;
    onValueChange(nextValue);
    window.requestAnimationFrame(() => optionRefs.current.get(nextValue)?.focus());
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'grid gap-2',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = disabled || option.disabled;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={optionDisabled}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              moveSelection(option.value, event.key);
            }}
            ref={(element) => {
              if (element) optionRefs.current.set(option.value, element);
              else optionRefs.current.delete(option.value);
            }}
            className={cn(
              'flex min-w-0 items-start gap-3 rounded-[var(--radius-large)] border p-3 text-left transition-[background-color,border-color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] disabled:cursor-not-allowed disabled:opacity-40 enabled:active:translate-y-px',
              selected
                ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] shadow-[var(--edge-highlight),0_1px_6px_var(--shadow-color)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:border-[var(--border)] hover:bg-[var(--surface-soft)]',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
                selected ? 'border-[var(--accent)]' : 'border-[var(--border)]',
              )}
              aria-hidden="true"
            >
              {selected ? (
                <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)] [animation:check-pop_.16s_cubic-bezier(.2,.9,.25,1)] motion-reduce:[animation:none]" />
              ) : null}
            </span>
            {option.icon ? <span className={cn('mt-0.5 shrink-0', selected ? 'text-[var(--accent)]' : 'text-[var(--muted)]')}>{option.icon}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="dh-type-control text-[var(--fg-secondary)]">{option.title}</span>
                {option.meta ? <span className="shrink-0 dh-type-menu-meta">{option.meta}</span> : null}
              </span>
              {option.description ? <span className="mt-0.5 block dh-type-supporting">{option.description}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
