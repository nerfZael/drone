import path from 'node:path';

import { type RawData, type WebSocket, WebSocketServer } from 'ws';

import { DirectoryWatchSet, MAX_WATCHED_DIRECTORIES } from '../daemon-file-events';
import type { DroneClient } from '../host/api';
import { watchRepository } from '../repo-watch';
import { subscribeDaemonDirectoryEvents, subscribeDaemonRepoEvents } from './daemon-file-events';
import type { FileRevisionEvent } from './file-revision-watch';

/** Editor tabs with a live view: the active tab plus tabs in their own windows. */
const MAX_WATCHED_FILES = 64;

export type WorkspaceEventsSocketContext = { id: string; drone: any };

export type WorkspaceEventsSocketDependencies = {
  droneRuntime: (drone: any) => string;
  normalizeFsPathForRuntime: (drone: any, rawPath: string, options: { fallbackToHome: boolean }) => string;
  resolveDaemonClient: (drone: any) => Promise<DroneClient | null>;
  watchFileRevision: (
    input: { drone: any; droneId: string; droneName: string; targetPath: string },
    publish: (event: FileRevisionEvent, data: Record<string, unknown>) => void,
  ) => () => void;
  /** The folder git status is read from for this drone, or null when it has no repository. */
  resolveRepoPath: (drone: any) => Promise<string | null>;
  /** Runs before the app hears of a change, so its next read does not get a cached scan. */
  onRepoChanged: (context: WorkspaceEventsSocketContext, repoPath: string) => void;
};

/**
 * One socket per workspace open in the app, shared by its explorer and editor.
 * The app sends `{ directories, files, repo }` with the folders the explorer
 * shows, the files with a live editor view, and whether a changes panel is
 * open, again whenever any of them changes. The Hub answers with
 *   `{ type: 'directory-changed', path }` when a folder gains or loses an entry,
 *   `{ type: 'file', event, path, revision, ... }` per open file (see file-revision-watch),
 *   `{ type: 'resync' }` when folders may have changed unseen,
 *   `{ type: 'repo-changed' }` when git status may have changed,
 *   `{ type: 'repo-watch', live }` with whether git status is being watched;
 *     until it is, the app keeps checking on its own.
 * Paths in answers are spelled the way the app spelled them.
 *
 * A socket rather than event streams: the app already holds several
 * long-lived HTTP connections, and browsers allow six per origin.
 */
export function createWorkspaceEventsWebSocketServer(
  deps: WorkspaceEventsSocketDependencies,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  wss.on('connection', (socket: WebSocket, _request: unknown, context: WorkspaceEventsSocketContext) => {
    const drone = context.drone;
    const droneName = String(drone?.name ?? context.id).trim() || context.id;
    const hostRuntime = deps.droneRuntime(drone) === 'host';
    const normalize = (raw: string): string => {
      const normalized = deps.normalizeFsPathForRuntime(drone, raw, { fallbackToHome: false });
      return normalized && hostRuntime ? path.resolve(normalized) : normalized;
    };
    const send = (message: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    let requestedByDirectory = new Map<string, string>();
    const onDirectoryChange = (watched: string) => {
      const requested = requestedByDirectory.get(watched);
      if (requested !== undefined) send({ type: 'directory-changed', path: requested });
    };
    const hostDirectories = hostRuntime ? new DirectoryWatchSet(onDirectoryChange) : null;
    // A container's folders are watched by its own daemon.
    let daemonDirectories: ReturnType<typeof subscribeDaemonDirectoryEvents> | null = null;
    const setDirectories = (rawPaths: unknown) => {
      requestedByDirectory = new Map();
      for (const raw of Array.isArray(rawPaths) ? rawPaths : []) {
        if (typeof raw !== 'string' || requestedByDirectory.size >= MAX_WATCHED_DIRECTORIES) continue;
        const watched = normalize(raw);
        if (watched) requestedByDirectory.set(watched, raw);
      }
      const directories = [...requestedByDirectory.keys()];
      if (hostDirectories) hostDirectories.set(directories);
      else if (daemonDirectories) daemonDirectories.setDirectories(directories);
      else if (directories.length > 0) {
        daemonDirectories = subscribeDaemonDirectoryEvents(
          { resolveClient: () => deps.resolveDaemonClient(drone) },
          directories,
          onDirectoryChange,
          () => send({ type: 'resync' }),
        );
      }
    };

    const fileWatches = new Map<string, () => void>();
    const setFiles = (rawPaths: unknown) => {
      const wanted = new Set<string>();
      for (const raw of Array.isArray(rawPaths) ? rawPaths : []) {
        if (typeof raw === 'string' && raw && wanted.size < MAX_WATCHED_FILES) wanted.add(raw);
      }
      for (const [requested, stop] of fileWatches) {
        if (wanted.has(requested)) continue;
        stop();
        fileWatches.delete(requested);
      }
      for (const requested of wanted) {
        if (fileWatches.has(requested)) continue;
        const targetPath = normalize(requested);
        if (!targetPath || targetPath === '/') continue;
        fileWatches.set(
          requested,
          deps.watchFileRevision({ drone, droneId: context.id, droneName, targetPath }, (event, data) =>
            send({ ...data, type: 'file', event, path: requested }),
          ),
        );
      }
    };

    let stopRepoWatch: (() => void) | null = null;
    let repoWanted = false;
    const setRepo = (wanted: boolean) => {
      if (wanted === repoWanted) return;
      repoWanted = wanted;
      if (!wanted) {
        stopRepoWatch?.();
        stopRepoWatch = null;
        return;
      }
      void deps
        .resolveRepoPath(drone)
        .catch(() => null)
        .then((repoPath) => {
          if (!repoWanted || stopRepoWatch) return;
          if (!repoPath) {
            send({ type: 'repo-watch', live: false });
            return;
          }
          const listener = {
            onChange: () => {
              deps.onRepoChanged(context, repoPath);
              send({ type: 'repo-changed' });
            },
            onLive: (live: boolean) => send({ type: 'repo-watch', live }),
          };
          // A container's repository is watched by its own daemon.
          stopRepoWatch = hostRuntime
            ? watchRepository(repoPath, listener)
            : subscribeDaemonRepoEvents({ resolveClient: () => deps.resolveDaemonClient(drone) }, repoPath, listener);
        });
    };

    socket.on('message', (raw: RawData) => {
      let message: { directories?: unknown; files?: unknown; repo?: unknown } | null = null;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      setDirectories(message?.directories);
      setFiles(message?.files);
      setRepo(message?.repo === true);
    });
    const close = () => {
      setRepo(false);
      hostDirectories?.close();
      daemonDirectories?.close();
      daemonDirectories = null;
      for (const stop of fileWatches.values()) stop();
      fileWatches.clear();
    };
    socket.on('close', close);
    socket.on('error', close);
  });
  return wss;
}
