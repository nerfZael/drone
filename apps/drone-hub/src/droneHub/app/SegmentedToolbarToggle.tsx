import React from 'react';

type SegmentedToolbarToggleTone = 'accent' | 'green' | 'yellow';

type SegmentedToolbarToggleOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
  tone?: SegmentedToolbarToggleTone;
};

type SegmentedToolbarToggleProps<T extends string> = {
  label: string;
  hideLabel?: boolean;
  value: T;
  options: SegmentedToolbarToggleOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  tone?: SegmentedToolbarToggleTone;
  density?: 'default' | 'compact';
};

function activeToneClass(tone: SegmentedToolbarToggleTone, compact: boolean): string {
  if (tone === 'green') {
    return compact
      ? 'bg-[var(--green-subtle)] text-[var(--green)]'
      : 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)] shadow-[0_1px_3px_var(--shadow-color)]';
  }
  if (tone === 'yellow') {
    return compact
      ? 'bg-[var(--yellow-subtle)] text-[var(--yellow)]'
      : 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)] shadow-[0_1px_3px_var(--shadow-color)]';
  }
  return compact
    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
    : 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_1px_3px_var(--shadow-color)]';
}

export function SegmentedToolbarToggle<T extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  disabled = false,
  tone = 'accent',
  density = 'default',
}: SegmentedToolbarToggleProps<T>) {
  const compact = density === 'compact';
  return (
    <div className="flex min-w-0 items-center gap-3" role="group" aria-label={label}>
      {hideLabel ? null : (
        <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)]">
          {label}
        </span>
      )}
      <div
        className={`grid min-w-0 flex-1 grid-flow-col auto-cols-fr border border-[var(--border-subtle)] bg-[var(--surface-soft)] ${
          compact
            ? 'gap-0 overflow-hidden rounded-[var(--radius-medium)] p-0'
            : 'gap-1 rounded-[var(--radius-large)] p-1'
        }`}
      >
        {options.map((option, index) => {
          const active = value === option.value;
          const optionDisabled = disabled || option.disabled;
          const activeClass = activeToneClass(option.tone ?? tone, compact);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={optionDisabled}
              aria-pressed={active}
              className={`flex items-center justify-center font-[var(--weight-semibold)] transition-[background-color,border-color,color,box-shadow,transform] ${
                compact
                  ? `h-7 px-2.5 text-[var(--text-10)] ${
                      index > 0 ? 'border-l border-l-[var(--border-subtle)]' : ''
                    }`
                  : 'h-9 rounded-[calc(var(--radius-large)-0.25rem)] border px-3 text-[var(--text-11)]'
              } ${
                active
                  ? activeClass
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
