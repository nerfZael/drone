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

function activeToneClass(tone: SegmentedToolbarToggleTone): string {
  if (tone === 'green') return 'bg-[var(--green-subtle)] text-[var(--green)]';
  if (tone === 'yellow') return 'bg-[var(--yellow-subtle)] text-[var(--yellow)]';
  return 'bg-[var(--accent-subtle)] text-[var(--accent)]';
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
        className={`grid min-w-0 flex-1 grid-flow-col auto-cols-fr gap-0.5 bg-[var(--surface-inset)] ${
          compact
            ? 'rounded-[var(--radius-medium)] p-0.5'
            : 'rounded-[var(--radius-large)] p-1'
        }`}
      >
        {options.map((option) => {
          const active = value === option.value;
          const optionDisabled = disabled || option.disabled;
          const activeClass = activeToneClass(option.tone ?? tone);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={optionDisabled}
              aria-pressed={active}
              className={`flex items-center justify-center border border-transparent font-[var(--weight-semibold)] transition-colors ${
                compact
                  ? 'h-7 rounded-[calc(var(--radius-medium)-1px)] px-2.5 text-[var(--text-10)]'
                  : 'h-9 rounded-[calc(var(--radius-large)-0.25rem)] px-3 text-[var(--text-11)]'
              } ${
                active
                  ? activeClass
                  : 'bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              } ${optionDisabled ? 'cursor-not-allowed opacity-40' : ''}`}
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
