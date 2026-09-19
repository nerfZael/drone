import path from 'node:path';

import { type RawData, type WebSocket, WebSocketServer } from 'ws';

import { DirectoryWatchSet, MAX_WATCHED_DIRECTORIES } from '../daemon-file-events';
import type { DroneClient } from '../host/api';
import { subscribeDaemonDirectoryEvents } from './daemon-file-events';

export type DirectoryEventsSocketContext = { drone: any };

export type DirectoryEventsSocketDependencies = {
  droneRuntime: (drone: any) => string;
  normalizeFsPathForRuntime: (drone: any, rawPath: string, options: { fallbackToHome: boolean }) => string;
  resolveDaemonClient: (drone: any) => Promise<DroneClient | null>;
};

/**
 * One socket per open explorer. The explorer sends `{ paths }` with the
 * folders it shows, again whenever that changes; the Hub answers with
 * `{ type: 'changed', path }` when a folder gains or loses an entry, and
 * `{ type: 'resync' }` when any of them may have changed unseen.
 *
 * A socket rather than an event stream: the app already holds several
 * long-lived HTTP connections, and browsers allow six per origin.
 */
export function createDirectoryEventsWebSocketServer(
  deps: DirectoryEventsSocketDependencies,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  wss.on('connection', (socket: WebSocket, _request: unknown, context: DirectoryEventsSocketContext) => {
    const drone = context.drone;
    const hostRuntime = deps.droneRuntime(drone) === 'host';
    // Events name folders the way the explorer did, whatever form the runtime needs.
    let requestedByWatched = new Map<string, string>();
    const watchedDirectories = (rawPaths: unknown): string[] => {
      requestedByWatched = new Map();
      for (const raw of Array.isArray(rawPaths) ? rawPaths : []) {
        if (typeof raw !== 'string' || requestedByWatched.size >= MAX_WATCHED_DIRECTORIES) continue;
        const normalized = deps.normalizeFsPathForRuntime(drone, raw, { fallbackToHome: false });
        if (!normalized) continue;
        requestedByWatched.set(hostRuntime ? path.resolve(normalized) : normalized, raw);
      }
      return [...requestedByWatched.keys()];
    };
    const send = (message: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const onChange = (watched: string) => {
      const requested = requestedByWatched.get(watched);
      if (requested !== undefined) send({ type: 'changed', path: requested });
    };

    const hostWatches = hostRuntime ? new DirectoryWatchSet(onChange) : null;
    // A container's folders are watched by its own daemon.
    let daemonEvents: ReturnType<typeof subscribeDaemonDirectoryEvents> | null = null;
    socket.on('message', (raw: RawData) => {
      let paths: unknown;
      try {
        paths = JSON.parse(raw.toString())?.paths;
      } catch {
        return;
      }
      const directories = watchedDirectories(paths);
      if (hostWatches) hostWatches.set(directories);
      else if (daemonEvents) daemonEvents.setDirectories(directories);
      else {
        daemonEvents = subscribeDaemonDirectoryEvents(
          { resolveClient: () => deps.resolveDaemonClient(drone) },
          directories,
          onChange,
          () => send({ type: 'resync' }),
        );
      }
    });
    const close = () => {
      hostWatches?.close();
      daemonEvents?.close();
      daemonEvents = null;
    };
    socket.on('close', close);
    socket.on('error', close);
  });
  return wss;
}
