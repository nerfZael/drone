import React from 'react';
import {
  UiPanelToolbar,
  UiToolbarButton,
  UiToolbarGroup,
} from '../../ui/components';
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
    <UiPanelToolbar
      aria-label="Terminal sessions"
      className="!min-h-7 !items-end !gap-1 !overflow-hidden bg-[var(--surface-softest)] !px-1.5 !pb-0 !pt-1"
    >
      <div className="min-w-0 flex-1 flex items-end gap-0.5 overflow-x-auto pr-0.5">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          const busy = closingSessionId === session.id;
          return (
            <UiToolbarGroup
              key={session.id}
              label={`${session.title} terminal tab`}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                event.stopPropagation();
                onCloseSession(session.id);
              }}
              className={`group/terminal-tab min-w-0 gap-0 overflow-hidden rounded-t-md transition-colors ${
                active
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              }`}
            >
              <UiToolbarButton
                role="tab"
                aria-selected={active}
                size="xsmall"
                onClick={() => onActivateSession(session.id)}
                disabled={busy}
                className="min-w-0 max-w-[160px] rounded-none !bg-transparent px-2 !text-current"
                title={session.sessionName ? `${session.title} (${session.sessionName})` : `${session.title} (${session.cwd})`}
              >
                {session.title}
              </UiToolbarButton>
              <button
                type="button"
                aria-label={busy ? `Closing ${session.title}` : `Close ${session.title}`}
                onClick={() => onCloseSession(session.id)}
                disabled={busy}
                className={`pointer-events-none inline-flex h-6 w-4 shrink-0 items-center justify-center rounded-none opacity-0 transition-[background-color,color,opacity] group-hover/terminal-tab:pointer-events-auto group-hover/terminal-tab:opacity-70 group-focus-within/terminal-tab:pointer-events-auto group-focus-within/terminal-tab:opacity-70 hover:!opacity-100 focus-visible:!opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? 'text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
                    : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]'
                }`}
                title={busy ? 'Closing terminal…' : 'Kill terminal session and close tab'}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 4l8 8M12 4 4 12" />
                </svg>
              </button>
            </UiToolbarGroup>
          );
        })}
        {sessions.length === 0 ? (
          <div className="px-2 py-1 text-[var(--text-10)] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            No terminals
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Open a new terminal tab"
          onClick={onCreateSession}
          disabled={disabled}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-small)] text-[var(--accent)] transition-colors hover:bg-[var(--accent-subtle)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Open a new terminal tab"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>
    </UiPanelToolbar>
  );
}
