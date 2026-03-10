import React from 'react';

type SegmentedToolbarToggleOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
};

type SegmentedToolbarToggleProps<T extends string> = {
  label: string;
  value: T;
  options: SegmentedToolbarToggleOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function SegmentedToolbarToggle<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedToolbarToggleProps<T>) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
        {label}
      </span>
      <div className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] p-0.5">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={disabled}
              className={`h-[28px] px-2 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                active
                  ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                  : 'bg-transparent border-transparent text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)]'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              style={{ fontFamily: 'var(--display)' }}
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
