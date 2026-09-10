import { beginTerminalOpen, markTerminalModuleReady } from './terminal-performance';
import React from 'react';
import { UiPaneState, UiPanel, UiPanelBody, UiPanelStatusStrip } from '../../ui/components';
import '@xterm/xterm/css/xterm.css';
import { formatDroneRuntimeError } from '../app/chat-startup-errors';
import { requestJson } from '../http';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';
import { DroneTerminalEmptyState } from './DroneTerminalEmptyState';
import { DroneTerminalTabsBar } from './DroneTerminalTabsBar';
import type { TerminalPaneSessionsState } from './terminal-tabs-state';
import { desktopThemeDefinition } from '../../theme';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import {
  acquireTerminalView,
  cachedTerminalConnection,
  evictTerminalView,
  invalidateDroneTerminals,
  terminalViewKey,
} from './terminal-view-cache';
import { terminalOpenRequests } from './terminal-open-request';
import type { TerminalConnectionState } from './terminal-connection';

markTerminalModuleReady();

export type DroneTerminalDockProps = {
  droneId: string;
  droneName: string;
  chatName: string;
  defaultCwd: string;
  paneKey: 'single' | 'top' | 'bottom';
  sessionsState: TerminalPaneSessionsState;
  onEnsureSessions: (droneId: string, paneKey: 'single' | 'top' | 'bottom', cwd: string) => void;
  onCreateSession: (droneId: string, paneKey: 'single' | 'top' | 'bottom', cwd: string) => void;
  onActivateSession: (
    droneId: string,
    paneKey: 'single' | 'top' | 'bottom',
    sessionId: string,
  ) => void;
  onResolveSessionName: (
    droneId: string,
    paneKey: 'single' | 'top' | 'bottom',
    sessionId: string,
    sessionName: string,
  ) => void;
  onCloseSession: (
    droneId: string,
    paneKey: 'single' | 'top' | 'bottom',
    sessionId: string,
  ) => void;
  disabled: boolean;
  hubPhase?: 'draft' | 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
};

export function DroneTerminalDock(props: DroneTerminalDockProps) {
  const {
    droneId,
    defaultCwd,
    paneKey,
    sessionsState,
    disabled,
    hubPhase,
    hubMessage,
    onEnsureSessions,
    onCreateSession,
    onActivateSession,
    onCloseSession,
  } = props;
  const themeId = useDroneHubUiStore((state) => state.themeId);
  const host = React.useRef<HTMLDivElement | null>(null);
  const view = React.useRef<ReturnType<typeof acquireTerminalView> | null>(null);
  const latest = React.useRef(props);
  latest.current = props;
  const activeSession = sessionsState.sessions.find(
    (session) => session.id === sessionsState.activeSessionId,
  );
  const activeId = activeSession?.id ?? '';
  const cwd = String(activeSession?.cwd ?? defaultCwd).trim();
  const key = terminalViewKey(droneId, paneKey, activeId);
  const [connectionState, setConnectionState] = React.useState<{
    key: string;
    value: TerminalConnectionState;
  } | null>(null);
  const [closeError, setCloseError] = React.useState<string | null>(null);
  const [closingSessionId, setClosingSessionId] = React.useState<string | null>(null);
  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000terminal`,
    timeoutMs: 18_000,
  });

  React.useEffect(() => {
    if (droneId && !disabled && !sessionsState.initialized)
      onEnsureSessions(droneId, paneKey, String(defaultCwd).trim());
  }, [droneId, disabled, sessionsState.initialized, defaultCwd, paneKey, onEnsureSessions]);

  React.useLayoutEffect(() => {
    if (disabled) {
      invalidateDroneTerminals(droneId);
      return;
    }
    if (!activeId || !host.current) return;
    const current = latest.current;
    const session = current.sessionsState.sessions.find((entry) => entry.id === activeId)!;
    const sessionName =
      session.sessionName ||
      (activeId === 'terminal-1' ? 'drone-hub-shell' : `drone-hub-shell-${crypto.randomUUID()}`);
    const acquired = acquireTerminalView(
      key,
      host.current,
      { droneId, cwd, sessionName },
      desktopThemeDefinition(themeId).terminal,
    );
    view.current = acquired;
    const unsubscribe = acquired.connection.subscribe((state) => {
      setConnectionState({ key, value: state });
      if (state.sessionName)
        latest.current.onResolveSessionName(droneId, paneKey, activeId, state.sessionName);
    });
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        acquired.fit.fit();
      });
    });
    observer.observe(host.current);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      acquired.release();
      view.current = null;
    };
    // Session-name resolution, chat changes and renames are metadata updates;
    // they must not restart a terminal or clear input queued during its open.
  }, [key, droneId, paneKey, activeId, cwd, disabled]);

  React.useEffect(() => {
    if (view.current)
      view.current.terminal.options.theme = desktopThemeDefinition(themeId).terminal;
  }, [themeId]);

  const close = async (sessionId: string) => {
    if (closingSessionId) return;
    const session = sessionsState.sessions.find((entry) => entry.id === sessionId);
    if (!session) return;
    const closingKey = terminalViewKey(droneId, paneKey, sessionId);
    setClosingSessionId(sessionId);
    try {
      const connection = cachedTerminalConnection(closingKey);
      if (connection) await connection.closeSession();
      else if (session.sessionName) {
        await requestJson(
          `/api/drones/${encodeURIComponent(droneId)}/terminal/${encodeURIComponent(session.sessionName)}`,
          { method: 'DELETE' },
        );
        terminalOpenRequests.invalidate({
          droneId,
          cwd: session.cwd,
          sessionName: session.sessionName,
        });
      }
      evictTerminalView(closingKey);
      onCloseSession(droneId, paneKey, sessionId);
      setCloseError(null);
    } catch (error: any) {
      if (Number(error?.status) === 404) {
        evictTerminalView(closingKey);
        onCloseSession(droneId, paneKey, sessionId);
      } else setCloseError(formatDroneRuntimeError(error));
    } finally {
      setClosingSessionId(null);
    }
  };

  const state = connectionState?.key === key ? connectionState.value : null;
  const error = closeError || state?.error;
  return (
    <UiPanel flush surface="alternate" className="relative h-full w-full">
      {error && (
        <UiPanelStatusStrip tone="danger">
          {error}{' '}
          <button className="ml-2 underline" onClick={() => view.current?.connection.retry()}>
            Reconnect
          </button>
        </UiPanelStatusStrip>
      )}
      <DroneTerminalTabsBar
        sessions={sessionsState.sessions}
        activeSessionId={activeSession?.id ?? null}
        closingSessionId={closingSessionId}
        disabled={disabled}
        onActivateSession={(id) => {
          setCloseError(null);
          beginTerminalOpen();
          onActivateSession(droneId, paneKey, id);
        }}
        onCloseSession={(id) => {
          void close(id);
        }}
        onCreateSession={() => {
          setCloseError(null);
          beginTerminalOpen();
          onCreateSession(droneId, paneKey, String(defaultCwd).trim());
        }}
      />
      <UiPanelBody className="relative bg-[var(--bg)] pt-1 pl-1">
        {!disabled && sessionsState.initialized && sessionsState.sessions.length === 0 && (
          <DroneTerminalEmptyState
            onCreateSession={() => onCreateSession(droneId, paneKey, String(defaultCwd).trim())}
          />
        )}
        {disabled && (
          <UiPaneState
            kind={startup.timedOut ? 'warning' : 'loading'}
            title={provisioningLabel(hubPhase)}
            description={String(hubMessage ?? '').trim() || 'Connecting terminal…'}
            className="absolute inset-0 z-10 bg-[var(--surface-inset-strong)]/80 backdrop-blur"
          />
        )}
        {!disabled && activeId && (!state || state.connecting) && !error && (
          <div
            className="absolute right-3 top-1 text-xs text-[var(--muted)] pointer-events-none"
            role="status"
          >
            Connecting terminal…
          </div>
        )}
        <div
          ref={host}
          className="w-full h-full min-h-0 overflow-hidden"
          onClick={() => view.current?.terminal.focus()}
        />
      </UiPanelBody>
    </UiPanel>
  );
}
