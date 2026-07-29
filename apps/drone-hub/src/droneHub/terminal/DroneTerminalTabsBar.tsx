import React from 'react';
import {
  UiPanelToolbar,
  UiToolbarButton,
  UiToolbarGroup,
  UiToolbarIconButton,
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
      className="gap-2 bg-[var(--surface-softest)] py-1.5"
    >
      <div className="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto pr-1">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          const busy = closingSessionId === session.id;
          return (
            <UiToolbarGroup
              key={session.id}
              label={`${session.title} terminal tab`}
              className="min-w-0"
            >
              <UiToolbarButton
                pressed={active}
                tone="accent"
                onClick={() => onActivateSession(session.id)}
                disabled={busy}
                className="min-w-0 max-w-[180px]"
                title={session.sessionName ? `${session.title} (${session.sessionName})` : `${session.title} (${session.cwd})`}
              >
                {session.title}
              </UiToolbarButton>
              <UiToolbarIconButton
                label={busy ? `Closing ${session.title}` : `Close ${session.title}`}
                icon={
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4 4 12" />
                  </svg>
                }
                onClick={() => onCloseSession(session.id)}
                disabled={busy}
                size="xsmall"
                title={busy ? 'Closing terminal…' : 'Kill terminal session and close tab'}
              />
            </UiToolbarGroup>
          );
        })}
        {sessions.length === 0 ? (
          <div className="px-2 py-1 text-[var(--text-10)] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            No terminals
          </div>
        ) : null}
      </div>
      <UiToolbarButton
        onClick={onCreateSession}
        disabled={disabled}
        tone="accent"
        leadingIcon={<span className="text-[var(--text-12)] leading-none">+</span>}
        title="Open a new terminal tab"
      >
        New
      </UiToolbarButton>
    </UiPanelToolbar>
  );
}
