import React from 'react';
import {
  closeTerminalPaneSession,
  createTerminalPaneSession,
  createTerminalPaneSessionsState,
  ensureTerminalPaneSessionsInitialized,
  setActiveTerminalPaneSession,
  setTerminalPaneSessionName,
  type TerminalPaneSessionsState,
} from './terminal-tabs-state';

export type TerminalPaneKey = 'single' | 'top' | 'bottom';

function terminalPaneStateKey(droneIdRaw: string, paneKey: TerminalPaneKey): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return droneId ? `${droneId}\u0000${paneKey}` : '';
}

export function useTerminalPaneSessions() {
  const [terminalSessionsByPane, setTerminalSessionsByPane] =
    React.useState<Record<string, TerminalPaneSessionsState>>({});

  const ensureTerminalPaneSessions = React.useCallback((droneIdRaw: string, paneKey: TerminalPaneKey, cwd: string) => {
    const key = terminalPaneStateKey(droneIdRaw, paneKey);
    if (!key) return;
    setTerminalSessionsByPane((prev) => {
      const current = prev[key] ?? createTerminalPaneSessionsState();
      const next = ensureTerminalPaneSessionsInitialized(current, cwd);
      if (next === current) return prev;
      return { ...prev, [key]: next };
    });
  }, []);

  const createTerminalPaneTab = React.useCallback((droneIdRaw: string, paneKey: TerminalPaneKey, cwd: string) => {
    const key = terminalPaneStateKey(droneIdRaw, paneKey);
    if (!key) return;
    setTerminalSessionsByPane((prev) => {
      const current = prev[key] ?? createTerminalPaneSessionsState();
      return { ...prev, [key]: createTerminalPaneSession(current, cwd) };
    });
  }, []);

  const setActiveTerminalPaneTab = React.useCallback((droneIdRaw: string, paneKey: TerminalPaneKey, sessionId: string) => {
    const key = terminalPaneStateKey(droneIdRaw, paneKey);
    if (!key) return;
    setTerminalSessionsByPane((prev) => {
      const current = prev[key];
      if (!current) return prev;
      const next = setActiveTerminalPaneSession(current, sessionId);
      if (next === current) return prev;
      return { ...prev, [key]: next };
    });
  }, []);

  const setTerminalPaneTabSessionName = React.useCallback(
    (droneIdRaw: string, paneKey: TerminalPaneKey, sessionId: string, sessionName: string) => {
      const key = terminalPaneStateKey(droneIdRaw, paneKey);
      if (!key) return;
      setTerminalSessionsByPane((prev) => {
        const current = prev[key];
        if (!current) return prev;
        const next = setTerminalPaneSessionName(current, sessionId, sessionName);
        if (next === current) return prev;
        return { ...prev, [key]: next };
      });
    },
    [],
  );

  const closeTerminalPaneTab = React.useCallback((droneIdRaw: string, paneKey: TerminalPaneKey, sessionId: string) => {
    const key = terminalPaneStateKey(droneIdRaw, paneKey);
    if (!key) return;
    setTerminalSessionsByPane((prev) => {
      const current = prev[key];
      if (!current) return prev;
      const next = closeTerminalPaneSession(current, sessionId);
      if (next === current) return prev;
      return { ...prev, [key]: next };
    });
  }, []);

  return {
    terminalSessionsByPane,
    terminalPaneStateKey,
    ensureTerminalPaneSessions,
    createTerminalPaneTab,
    setActiveTerminalPaneTab,
    setTerminalPaneTabSessionName,
    closeTerminalPaneTab,
  };
}
