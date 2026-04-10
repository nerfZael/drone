import { describe, expect, test } from 'bun:test';
import {
  closeTerminalPaneSession,
  createTerminalPaneSession,
  createTerminalPaneSessionsState,
  ensureTerminalPaneSessionsInitialized,
  setActiveTerminalPaneSession,
  setTerminalPaneSessionName,
} from '../src/droneHub/terminal/terminal-tabs-state';

describe('terminal pane session state', () => {
  test('initializes an empty pane with one terminal tab', () => {
    const state = ensureTerminalPaneSessionsInitialized(createTerminalPaneSessionsState(), '/work/repo');
    expect(state.initialized).toBe(true);
    expect(state.activeSessionId).toBe('terminal-1');
    expect(state.sessions).toEqual([
      {
        id: 'terminal-1',
        title: 'Terminal',
        cwd: '/work/repo',
        sessionName: null,
      },
    ]);
  });

  test('creates additional tabs and keeps the latest one active', () => {
    const initial = ensureTerminalPaneSessionsInitialized(createTerminalPaneSessionsState(), '/work/repo');
    const next = createTerminalPaneSession(initial, '/tmp');
    expect(next.activeSessionId).toBe('terminal-2');
    expect(next.sessions.map((session) => session.title)).toEqual(['Terminal', 'Terminal 2']);
    expect(next.sessions[1]?.cwd).toBe('/tmp');
  });

  test('stores resolved session names on the matching tab', () => {
    const initial = ensureTerminalPaneSessionsInitialized(createTerminalPaneSessionsState(), '/work/repo');
    const next = setTerminalPaneSessionName(initial, 'terminal-1', 'drone-hub-shell');
    expect(next.sessions[0]?.sessionName).toBe('drone-hub-shell');
  });

  test('activates a different tab without mutating the others', () => {
    const initial = createTerminalPaneSession(
      ensureTerminalPaneSessionsInitialized(createTerminalPaneSessionsState(), '/work/repo'),
      '/tmp',
    );
    const next = setActiveTerminalPaneSession(initial, 'terminal-1');
    expect(next.activeSessionId).toBe('terminal-1');
    expect(next.sessions).toHaveLength(2);
  });

  test('closing the active tab falls back to the previous remaining tab', () => {
    const initial = createTerminalPaneSession(
      ensureTerminalPaneSessionsInitialized(createTerminalPaneSessionsState(), '/work/repo'),
      '/tmp',
    );
    const next = closeTerminalPaneSession(initial, 'terminal-2');
    expect(next.activeSessionId).toBe('terminal-1');
    expect(next.sessions.map((session) => session.id)).toEqual(['terminal-1']);
  });

  test('closing the last tab leaves the pane initialized but empty', () => {
    const initial = ensureTerminalPaneSessionsInitialized(createTerminalPaneSessionsState(), '/work/repo');
    const next = closeTerminalPaneSession(initial, 'terminal-1');
    expect(next.initialized).toBe(true);
    expect(next.activeSessionId).toBeNull();
    expect(next.sessions).toEqual([]);
  });
});
