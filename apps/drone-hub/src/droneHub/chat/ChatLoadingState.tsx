import React from 'react';

export function ChatLoadingState({ message = 'Loading conversation…' }: { message?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-full w-full flex-1 items-center justify-center px-6 py-10"
    >
      <div className="flex flex-col items-center gap-3.5 text-center">
        <div className="relative h-9 w-9" aria-hidden="true">
          <div className="absolute inset-0 rounded-full border border-[var(--border-subtle)] bg-[rgba(0,0,0,.08)]" />
          <svg
            className="absolute inset-0 h-9 w-9 animate-spin"
            viewBox="0 0 36 36"
            fill="none"
          >
            <path
              d="M18 2.5a15.5 15.5 0 0 1 13.42 7.75"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-[14px] rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent-muted)]" />
        </div>
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}
