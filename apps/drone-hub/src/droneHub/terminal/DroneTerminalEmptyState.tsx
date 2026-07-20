import React from 'react';

export function DroneTerminalEmptyState({
  onCreateSession,
}: {
  onCreateSession: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center text-center px-6">
      <div className="max-w-[320px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] backdrop-blur px-4 py-3">
        <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          Terminal
        </div>
        <div className="mt-1 text-[12px] text-[var(--muted)]">No terminal tabs are open in this pane.</div>
        <button
          type="button"
          onClick={onCreateSession}
          className="mt-3 inline-flex items-center justify-center h-8 px-3 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[10px] font-semibold tracking-wide uppercase text-[var(--accent)] hover:brightness-110 transition-colors"
          style={{ fontFamily: 'var(--display)' }}
        >
          New terminal
        </button>
      </div>
    </div>
  );
}
