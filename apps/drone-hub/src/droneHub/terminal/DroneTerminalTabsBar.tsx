import React from 'react';
import type { TerminalPaneSession } from './terminal-tabs-state';

export function DroneTerminalTabsBar({
  sessions,
  activeSessionId,
  closingSessionId,
  disabled,
  onActivateSession,
  onCloseSession,
  onCreateSession,
}: {
  sessions: TerminalPaneSession[];
  activeSessionId: string | null;
  closingSessionId: string | null;
  disabled: boolean;
  onActivateSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCreateSession: () => void;
}) {
  return (
    <div className="px-2 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)] flex items-center gap-2">
      <div className="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto pr-1">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          const busy = closingSessionId === session.id;
          return (
            <div
              key={session.id}
              className={`group flex items-center min-w-0 rounded border transition-colors ${
                active
                  ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)]'
              }`}
            >
              <button
                type="button"
                onClick={() => onActivateSession(session.id)}
                disabled={busy}
                className={`min-w-0 max-w-[180px] px-2 py-1 text-[10px] font-semibold tracking-wide uppercase truncate ${
                  busy ? 'opacity-50 cursor-wait' : active ? '' : 'hover:text-[var(--muted)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title={session.sessionName ? `${session.title} (${session.sessionName})` : `${session.title} (${session.cwd})`}
              >
                {session.title}
              </button>
              <button
                type="button"
                onClick={() => onCloseSession(session.id)}
                disabled={busy}
                className={`mr-1 inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
                  busy
                    ? 'cursor-wait text-[var(--muted-dim)] opacity-50'
                    : active
                      ? 'text-[var(--accent)] hover:bg-[var(--surface-strong)]'
                      : 'text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]'
                }`}
                title={busy ? 'Closing terminal…' : 'Kill terminal session and close tab'}
                aria-label={busy ? `Closing ${session.title}` : `Close ${session.title}`}
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4 4 12" />
                </svg>
              </button>
            </div>
          );
        })}
        {sessions.length === 0 ? (
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            No terminals
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onCreateSession}
        disabled={disabled}
        className="inline-flex items-center gap-1 h-7 px-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ fontFamily: 'var(--display)' }}
        title="Open a new terminal tab"
      >
        <span className="text-[12px] leading-none">+</span>
        <span>New</span>
      </button>
    </div>
  );
}
