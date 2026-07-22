import React from 'react';

type SegmentedToolbarToggleOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
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
      <div className="grid min-w-0 flex-1 grid-flow-col auto-cols-fr gap-5">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={disabled}
              aria-pressed={active}
              className={`flex h-10 items-center justify-center gap-2 border-b-2 px-1 text-[var(--text-11)] font-[var(--weight-semibold)] transition-colors ${
                active
                  ? 'border-[var(--accent)] text-[var(--fg)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg-secondary)]'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              title={option.title}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${active ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'}`}
              />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
