import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

type DirectoryEventsSocket = {
  send: (data: string) => void;
  close: () => void;
  onopen: ((event: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onclose: ((event: any) => void) | null;
};

export type DirectoryEventsRuntime = {
  openSocket: (droneId: string) => DirectoryEventsSocket;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: any) => void;
};

const browserRuntime: DirectoryEventsRuntime = {
  openSocket: (droneId) =>
    new WebSocket(buildDirectApiWebSocketUrl(`/api/drones/${encodeURIComponent(droneId)}/fs/directory-events`)),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

/**
 * Follows the folders an explorer shows. The Hub reports `changed` with the
 * folder whose entries changed. `onResync` means changes may have gone unseen
 * (this connection, or the Hub's link to a container, was down), so every
 * folder should be read again. `setDirectories` swaps the watched folders on
 * the open socket, so expanding a folder leaves no moment unwatched.
 *
 * A socket rather than an event stream: the app already holds several
 * long-lived HTTP connections, and browsers allow six per origin.
 */
export function subscribeDirectoryEvents(
  droneId: string,
  initialDirectories: readonly string[],
  callbacks: { onChanged: (directory: string) => void; onResync: () => void },
  runtime: DirectoryEventsRuntime = browserRuntime,
): { setDirectories: (directories: readonly string[]) => void; close: () => void } {
  let directories = [...initialDirectories];
  let socket: DirectoryEventsSocket | null = null;
  let open = false;
  let closed = false;
  let connections = 0;
  let retryMs = RETRY_MIN_MS;
  let retryTimer: unknown = null;

  const connect = () => {
    if (closed) return;
    const startedAt = Date.now();
    let current: DirectoryEventsSocket;
    try {
      current = runtime.openSocket(droneId);
    } catch {
      scheduleReconnect(startedAt);
      return;
    }
    socket = current;
    current.onopen = () => {
      if (socket !== current) return;
      open = true;
      connections += 1;
      current.send(JSON.stringify({ paths: directories }));
      if (connections > 1) callbacks.onResync();
    };
    current.onmessage = (event: { data: unknown }) => {
      if (socket !== current) return;
      let message: { type?: unknown; path?: unknown } | null = null;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message?.type === 'changed' && typeof message.path === 'string') callbacks.onChanged(message.path);
      else if (message?.type === 'resync') callbacks.onResync();
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      open = false;
      scheduleReconnect(startedAt);
    };
  };
  const scheduleReconnect = (startedAt: number) => {
    if (closed || retryTimer != null) return;
    // A connection that stayed up for a while is a fresh failure, not a persistent one.
    retryMs = Date.now() - startedAt > RETRY_MAX_MS ? RETRY_MIN_MS : Math.min(RETRY_MAX_MS, retryMs * 2);
    retryTimer = runtime.setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryMs);
  };
  connect();

  return {
    setDirectories(next) {
      directories = [...next];
      if (open) socket?.send(JSON.stringify({ paths: directories }));
    },
    close() {
      closed = true;
      if (retryTimer != null) runtime.clearTimeout(retryTimer);
      const current = socket;
      socket = null;
      current?.close();
    },
  };
}

/**
 * Runs `refresh` for a folder right away, then at most once more per
 * `intervalMs` while changes keep coming, so a build adding files for a minute
 * re-reads the folder about once a second rather than on every event.
 */
export function createDirectoryRefreshThrottle(
  refresh: (directory: string) => void,
  intervalMs: number,
  timers: { setTimeout: (run: () => void, ms: number) => unknown; clearTimeout: (timer: any) => void } = globalThis,
): { request: (directory: string) => void; cancel: () => void } {
  const waiting = new Map<string, { timer: unknown; again: boolean }>();
  const run = (directory: string) => {
    refresh(directory);
    const entry = {
      again: false,
      timer: timers.setTimeout(() => {
        waiting.delete(directory);
        if (entry.again) run(directory);
      }, intervalMs),
    };
    waiting.set(directory, entry);
  };
  return {
    request(directory) {
      const entry = waiting.get(directory);
      if (entry) entry.again = true;
      else run(directory);
    },
    cancel() {
      for (const entry of waiting.values()) timers.clearTimeout(entry.timer);
      waiting.clear();
    },
  };
}
