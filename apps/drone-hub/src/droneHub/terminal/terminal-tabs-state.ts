export type TerminalPaneSession = {
  id: string;
  title: string;
  cwd: string;
  sessionName: string | null;
};

export type TerminalPaneSessionsState = {
  initialized: boolean;
  nextOrdinal: number;
  activeSessionId: string | null;
  sessions: TerminalPaneSession[];
};

function normalizeTerminalCwd(raw: string): string {
  return String(raw ?? '').trim() || '/';
}

function buildTerminalSessionId(ordinal: number): string {
  return `terminal-${ordinal}`;
}

function buildTerminalSessionTitle(ordinal: number): string {
  return ordinal <= 1 ? 'Terminal' : `Terminal ${ordinal}`;
}

export function createTerminalPaneSessionsState(): TerminalPaneSessionsState {
  return {
    initialized: false,
    nextOrdinal: 1,
    activeSessionId: null,
    sessions: [],
  };
}

export function ensureTerminalPaneSessionsInitialized(
  state: TerminalPaneSessionsState | null | undefined,
  cwd: string,
): TerminalPaneSessionsState {
  const current = state ?? createTerminalPaneSessionsState();
  if (current.initialized) return current;
  return createTerminalPaneSession(current, cwd);
}

export function createTerminalPaneSession(
  state: TerminalPaneSessionsState | null | undefined,
  cwd: string,
): TerminalPaneSessionsState {
  const current = state ?? createTerminalPaneSessionsState();
  const ordinal = Math.max(1, Number.isFinite(current.nextOrdinal) ? Math.floor(current.nextOrdinal) : 1);
  const session: TerminalPaneSession = {
    id: buildTerminalSessionId(ordinal),
    title: buildTerminalSessionTitle(ordinal),
    cwd: normalizeTerminalCwd(cwd),
    sessionName: null,
  };
  return {
    initialized: true,
    nextOrdinal: ordinal + 1,
    activeSessionId: session.id,
    sessions: [...current.sessions, session],
  };
}

export function setActiveTerminalPaneSession(
  state: TerminalPaneSessionsState | null | undefined,
  sessionIdRaw: string,
): TerminalPaneSessionsState {
  const current = state ?? createTerminalPaneSessionsState();
  const sessionId = String(sessionIdRaw ?? '').trim();
  if (!sessionId) return current;
  if (!current.sessions.some((session) => session.id === sessionId)) return current;
  if (current.activeSessionId === sessionId) return current;
  return {
    ...current,
    activeSessionId: sessionId,
  };
}

export function setTerminalPaneSessionName(
  state: TerminalPaneSessionsState | null | undefined,
  sessionIdRaw: string,
  sessionNameRaw: string,
): TerminalPaneSessionsState {
  const current = state ?? createTerminalPaneSessionsState();
  const sessionId = String(sessionIdRaw ?? '').trim();
  const sessionName = String(sessionNameRaw ?? '').trim();
  if (!sessionId || !sessionName) return current;

  let changed = false;
  const sessions = current.sessions.map((session) => {
    if (session.id !== sessionId || session.sessionName === sessionName) return session;
    changed = true;
    return { ...session, sessionName };
  });
  if (!changed) return current;
  return {
    ...current,
    sessions,
  };
}

export function closeTerminalPaneSession(
  state: TerminalPaneSessionsState | null | undefined,
  sessionIdRaw: string,
): TerminalPaneSessionsState {
  const current = state ?? createTerminalPaneSessionsState();
  const sessionId = String(sessionIdRaw ?? '').trim();
  if (!sessionId || !current.sessions.some((session) => session.id === sessionId)) return current;

  const sessions = current.sessions.filter((session) => session.id !== sessionId);
  if (sessions.length === current.sessions.length) return current;

  const activeSessionId =
    current.activeSessionId === sessionId
      ? sessions[sessions.length - 1]?.id ?? null
      : current.activeSessionId;

  return {
    ...current,
    activeSessionId,
    sessions,
  };
}
