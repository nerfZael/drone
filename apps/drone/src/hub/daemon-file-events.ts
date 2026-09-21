import type { DroneClient } from '../host/api';

// The daemon sends a keepalive every 15s; three missed ones mean the stream is dead.
const IDLE_TIMEOUT_MS = 45_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export type DaemonFileEventsDependencies = {
  resolveClient: () => Promise<DroneClient | null>;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

function sleepUntilAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    timer.unref?.();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

/**
 * Keeps one daemon event stream open for as long as the caller wants it,
 * reconnecting with growing pauses. `request` is asked again on every
 * connection, so a reconnect asks for what is wanted now.
 */
function followDaemonEvents(
  deps: DaemonFileEventsDependencies,
  request: () => { path: string; method: 'GET' | 'POST'; body?: unknown },
  onEvent: (event: string, data: any, client: DroneClient) => void,
  onDisconnected?: () => void,
): () => void {
  const abort = new AbortController();
  const sleep = deps.sleep ?? sleepUntilAborted;
  const send = deps.fetch ?? fetch;

  const readStream = async (client: DroneClient): Promise<void> => {
    const { path, method, body } = request();
    const response = await send(new URL(path, client.baseUrl).toString(), {
      method,
      headers: {
        authorization: `Bearer ${client.token}`,
        accept: 'text/event-stream',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: abort.signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`daemon event stream failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!abort.signal.aborted) {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const result = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => {
          idleTimer = setTimeout(() => resolve(null), IDLE_TIMEOUT_MS);
          idleTimer.unref?.();
        }),
      ]).finally(() => {
        if (idleTimer) clearTimeout(idleTimer);
      });
      if (result === null) {
        await reader.cancel().catch(() => {});
        throw new Error('daemon event stream idle timeout');
      }
      if (result.done) return;
      buffer += decoder.decode(result.value, { stream: true });
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const event = /^event:\s*(\S+)\s*$/m.exec(frame)?.[1];
        const rawData = /^data:\s*(.*)$/m.exec(frame)?.[1];
        if (event) {
          let data: any = null;
          try {
            data = rawData ? JSON.parse(rawData) : null;
          } catch {
            data = null;
          }
          onEvent(event, data, client);
        }
        separator = buffer.indexOf('\n\n');
      }
    }
  };

  void (async () => {
    let retryMs = RETRY_MIN_MS;
    while (!abort.signal.aborted) {
      const startedAt = Date.now();
      try {
        const client = await deps.resolveClient();
        if (!client) throw new Error('daemon unavailable');
        await readStream(client);
      } catch {
        // Retried below; the caller's periodic check covers the gap.
      }
      if (abort.signal.aborted) return;
      onDisconnected?.();
      // A stream that stayed up for a while is a fresh failure, not a persistent one.
      retryMs = Date.now() - startedAt > RETRY_MAX_MS ? RETRY_MIN_MS : Math.min(RETRY_MAX_MS, retryMs * 2);
      await sleep(retryMs, abort.signal);
    }
  })();

  return () => abort.abort();
}

/**
 * Follows a container file through its drone's daemon and calls `onChange`
 * whenever the file may have changed: on every daemon `changed` event, and on
 * every (re)connection, since changes made while disconnected were not seen.
 */
export function subscribeDaemonFileEvents(
  deps: DaemonFileEventsDependencies,
  filePath: string,
  onChange: () => void,
): () => void {
  const path = `/v1/workspace/file-events?path=${encodeURIComponent(filePath)}`;
  return followDaemonEvents(deps, () => ({ path, method: 'GET' }), (event) => {
    if (event === 'ready' || event === 'changed') onChange();
  });
}

/**
 * Follows the directories an explorer shows in a container. `onChange` names
 * the directory whose entries changed; `onReconnected` means nothing was
 * watched for a while, so any of them may have. `setDirectories` replaces the
 * watched directories on the open stream, without a gap.
 */
export function subscribeDaemonDirectoryEvents(
  deps: DaemonFileEventsDependencies,
  initialDirectories: readonly string[],
  onChange: (directory: string) => void,
  onReconnected: () => void,
): { setDirectories: (directories: readonly string[]) => void; close: () => void } {
  let directories = [...initialDirectories];
  let requestedDirectories = directories;
  let open: { client: DroneClient; streamId: string } | null = null;
  let connections = 0;
  const send = deps.fetch ?? fetch;

  // One at a time, so a quick expand then collapse cannot arrive in the wrong order.
  let pushes: Promise<void> = Promise.resolve();
  const pushDirectories = (target: { client: DroneClient; streamId: string }, sent: readonly string[]) => {
    const url = new URL('/v1/workspace/directory-events', target.client.baseUrl);
    url.searchParams.set('stream', target.streamId);
    pushes = pushes.then(async () => {
      try {
        const response = await send(url.toString(), {
          method: 'PUT',
          headers: { authorization: `Bearer ${target.client.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ paths: sent }),
        });
        await response.body?.cancel().catch(() => {});
      } catch {
        // The stream is going away; its reconnection asks for the current directories.
      }
    });
  };

  const close = followDaemonEvents(
    deps,
    () => {
      open = null;
      requestedDirectories = directories;
      return { path: '/v1/workspace/directory-events', method: 'POST', body: { paths: directories } };
    },
    (event, data, client) => {
      if (event === 'ready' && typeof data?.streamId === 'string') {
        open = { client, streamId: data.streamId };
        connections += 1;
        if (connections > 1) onReconnected();
        // The explorer moved on while the stream was being opened.
        if (requestedDirectories !== directories) pushDirectories(open, directories);
      } else if (event === 'changed' && typeof data?.path === 'string') {
        onChange(data.path);
      }
    },
  );

  return {
    setDirectories(next) {
      directories = [...next];
      if (open) pushDirectories(open, directories);
    },
    close,
  };
}

/**
 * Follows a container repository's git status through its drone's daemon.
 * `onChange` means git status may have changed, which includes every
 * reconnection, since nothing was seen while disconnected. `onLive(false)`
 * means changes can go unseen for now: the daemon could not place its watches,
 * is too old to have them, or cannot be reached.
 */
export function subscribeDaemonRepoEvents(
  deps: DaemonFileEventsDependencies,
  repoPath: string,
  listener: { onChange: () => void; onLive: (live: boolean) => void },
): () => void {
  const path = `/v1/workspace/repo-events?path=${encodeURIComponent(repoPath)}`;
  let connections = 0;
  return followDaemonEvents(
    deps,
    () => ({ path, method: 'GET' }),
    (event, data) => {
      if (event === 'ready') {
        connections += 1;
        if (connections > 1) listener.onChange();
      } else if (event === 'changed') listener.onChange();
      else if (event === 'live') listener.onLive(data?.live === true);
    },
    () => listener.onLive(false),
  );
}
