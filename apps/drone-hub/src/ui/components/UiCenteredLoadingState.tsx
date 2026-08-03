import * as React from 'react';

export type UiCenteredLoadingStateProps = {
  message: React.ReactNode;
  description?: React.ReactNode;
};

export function UiCenteredLoadingState({
  message,
  description,
}: UiCenteredLoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-full w-full flex-1 items-center justify-center px-6 py-10"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative h-11 w-11" aria-hidden="true">
          <div className="absolute inset-0 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-inset-faint)]" />
          <svg
            className="absolute inset-0 h-11 w-11 animate-spin"
            viewBox="0 0 44 44"
            fill="none"
          >
            <path
              d="M22 3a19 19 0 0 1 16.45 9.5"
              stroke="var(--accent)"
              strokeWidth="2.25"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-[1.0625rem] rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent-muted)]" />
        </div>
        <div className="dh-type-status !text-[.875rem] font-medium leading-5 !text-[var(--fg-secondary)]">
          {message}
        </div>
        {description ? (
          <div className="-mt-3 max-w-[44ch] dh-type-supporting !text-[var(--muted)]">
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}
