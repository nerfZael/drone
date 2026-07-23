import React from 'react';

type SegmentedToolbarToggleOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
};

type SegmentedToolbarToggleProps<T extends string> = {
  label: string;
  hideLabel?: boolean;
  value: T;
  options: SegmentedToolbarToggleOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function SegmentedToolbarToggle<T extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedToolbarToggleProps<T>) {
  return (
    <div className="flex min-w-0 items-center gap-3" role="group" aria-label={label}>
      {hideLabel ? null : (
        <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)]">
          {label}
        </span>
      )}
      <div className="grid min-w-0 flex-1 grid-flow-col auto-cols-fr gap-1 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-soft)] p-1">
        {options.map((option) => {
          const active = value === option.value;
          const optionDisabled = disabled || option.disabled;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={optionDisabled}
              aria-pressed={active}
              className={`flex h-9 items-center justify-center rounded-[calc(var(--radius-large)-0.25rem)] border px-3 text-[var(--text-11)] font-[var(--weight-semibold)] transition-[background-color,border-color,color,box-shadow,transform] ${
                active
                  ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_1px_3px_var(--shadow-color)]'
                  : 'border-transparent bg-transparent text-[var(--muted)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-soft)] hover:text-[var(--fg-secondary)]'
              } ${optionDisabled ? 'cursor-not-allowed opacity-40' : 'active:translate-y-px'}`}
              title={option.title}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
