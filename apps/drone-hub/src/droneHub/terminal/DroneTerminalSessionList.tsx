import React from 'react';
import type { TerminalPaneSession } from './terminal-tabs-state';

function TerminalGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 4 4 4-4 4" />
      <path d="M9 12h4" />
    </svg>
  );
}

/**
 * Terminal sessions as a list beside the terminal rather than a tab strip above it: a
 * terminal can spare width far more easily than rows. It keeps one width however many
 * sessions there are, so opening a second terminal never reflows the first. New terminals
 * are opened from the dock header.
 */
export function DroneTerminalSessionList({
  sessions,
  activeSessionId,
  closingSessionId,
  onActivateSession,
  onCloseSession,
}: {
  sessions: TerminalPaneSession[];
  activeSessionId: string | null;
  closingSessionId: string | null;
  onActivateSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}) {
  return (
    <div
      data-terminal-session-list=""
      className="flex w-40 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--panel-alt)]"
    >
      <div
        role="tablist"
        aria-label="Terminal sessions"
        aria-orientation="vertical"
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          const busy = closingSessionId === session.id;
          return (
            <div
              key={session.id}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                event.stopPropagation();
                onCloseSession(session.id);
              }}
              className={`group/terminal-session relative flex h-6 items-center transition-colors ${
                active
                  ? 'bg-[var(--sidebar-row-selected-bg)] text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)]'
                  : 'text-[var(--explorer-row-fg,var(--fg-secondary))] hover:bg-[var(--surface-strong)] hover:text-[var(--fg-secondary)]'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onActivateSession(session.id)}
                disabled={busy}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-1 text-left text-compact focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)] disabled:opacity-60"
                title={
                  session.sessionName
                    ? `${session.title} (${session.sessionName})`
                    : `${session.title} (${session.cwd})`
                }
              >
                <span className="inline-flex shrink-0 text-[var(--muted)]">
                  <TerminalGlyph />
                </span>
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
              </button>
              <button
                type="button"
                aria-label={busy ? `Closing ${session.title}` : `Close ${session.title}`}
                onClick={() => onCloseSession(session.id)}
                disabled={busy}
                className="pointer-events-none mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-small)] text-[var(--muted)] opacity-0 transition-[background-color,color,opacity] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] group-hover/terminal-session:pointer-events-auto group-hover/terminal-session:opacity-100 group-focus-within/terminal-session:pointer-events-auto group-focus-within/terminal-session:opacity-100"
                title={busy ? 'Closing terminal…' : 'Kill terminal session and close it'}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4 4 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
