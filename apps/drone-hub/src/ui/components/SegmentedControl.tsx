import * as React from 'react';
import { cn } from '../cn';
import { useSlidingIndicator } from '../use-sliding-indicator';

export type UiSegmentedControlOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

export type UiSegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<UiSegmentedControlOption<T>>;
  onValueChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
};

export function UiSegmentedControl<T extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  className,
}: UiSegmentedControlProps<T>) {
  const optionRefs = React.useRef(new Map<T, HTMLButtonElement>());
  const { containerRef, indicator } = useSlidingIndicator(value, optionRefs);
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
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        'relative inline-grid min-w-0 grid-flow-col auto-cols-fr gap-1 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-1 shadow-[inset_0_1px_3px_color-mix(in_srgb,var(--shadow-color)_45%,transparent)]',
        className,
      )}
    >
      {indicator ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel-raised)] shadow-[var(--edge-highlight),0_1px_3px_var(--shadow-color)] transition-[left,width] duration-200 ease-[cubic-bezier(.2,.9,.25,1)] motion-reduce:transition-none"
          style={{ left: indicator.left, width: indicator.width }}
        />
      ) : null}
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
              'relative z-[1] h-7 min-w-[4.5rem] rounded-[var(--radius-medium)] px-2.5 text-[length:var(--text-10)] font-[var(--weight-semibold)] transition-colors duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'text-[var(--fg)]'
                : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
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
