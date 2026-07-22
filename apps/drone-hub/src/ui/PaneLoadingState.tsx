import React from 'react';

export function PaneLoadingState({ label }: { label: string }) {
  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center bg-[var(--panel-alt)] px-6 py-8"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="relative block h-8 w-8" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border-2 border-[var(--border-subtle)]" />
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--accent)] motion-reduce:animate-none" />
          <span className="absolute inset-[7px] rounded-full bg-[var(--accent-subtle)]" />
        </span>
        <span className="text-[var(--text-11)] font-[var(--weight-medium)] text-[var(--muted)]">
          {label}
        </span>
      </div>
    </div>
  );
}
