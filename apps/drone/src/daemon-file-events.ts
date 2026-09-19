import crypto from 'node:crypto';
import { statSync, watch, type FSWatcher } from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

const CHANGE_SETTLE_MS = 40;
const KEEPALIVE_MS = 15_000;
// Only while the directory is missing or cannot be watched.
const REARM_MS = 1_000;
/** An explorer shows far fewer folders than this; the cap keeps one stream from using up the kernel's watches. */
export const MAX_WATCHED_DIRECTORIES = 256;

/**
 * Watches one directory and calls `onChange` for the events `accepts` lets
 * through. One save or build step produces several raw events, so they are
 * reported once after they settle.
 *
 * A watch dies silently when its directory is removed, even if the directory
 * comes straight back (a branch switch does this). Events that can mean this,
 * and every settled change, therefore check that the directory is still the
 * one being watched, and the watch is set up again when it is not, or when it
 * could not be set up to begin with.
 */
function watchDirectory(
  directory: string,
  accepts: (eventType: string, changedName: string | null) => boolean,
  onChange: () => void,
): () => void {
  let stopped = false;
  let watcher: FSWatcher | null = null;
  let watchedInode: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let rearmTimer: ReturnType<typeof setTimeout> | null = null;

  const report = () => {
    if (stopped || settleTimer) return;
    settleTimer = setTimeout(() => {
      settleTimer = null;
      onChange();
      // Removing a directory deletes its files first, and not every runtime
      // reports the directory's own removal, so look again once things settle.
      if (watcher && directoryInode() !== watchedInode) {
        disarm();
        arm(true);
      }
    }, CHANGE_SETTLE_MS);
  };
  const directoryInode = (): number | null => {
    try {
      return statSync(directory).ino;
    } catch {
      return null;
    }
  };
  const disarm = () => {
    watcher?.close();
    watcher = null;
  };
  const rearmLater = () => {
    if (stopped || rearmTimer) return;
    rearmTimer = setTimeout(() => {
      rearmTimer = null;
      arm(true);
    }, REARM_MS);
    rearmTimer.unref?.();
  };
  const arm = (afterGap: boolean) => {
    if (stopped) return;
    try {
      const next = watch(directory, { persistent: false }, (eventType, changedName) => {
        if (watcher !== next) return;
        // Removing or replacing the directory shows up as a rename; plain writes
        // are far more frequent and cannot mean that, so they skip the check.
        if (eventType === 'rename' && directoryInode() !== watchedInode) {
          disarm();
          report();
          arm(true);
          return;
        }
        if (accepts(eventType, changedName == null ? null : String(changedName))) report();
      });
      next.on('error', () => {
        if (watcher !== next) return;
        disarm();
        rearmLater();
      });
      watchedInode = directoryInode();
      // Some runtimes accept a watch on a missing directory and then never report anything.
      if (watchedInode === null) {
        next.close();
        rearmLater();
        return;
      }
      watcher = next;
      // Nothing was watching during the gap, so things may have changed in it.
      if (afterGap) report();
    } catch {
      rearmLater();
    }
  };
  arm(false);
  return () => {
    stopped = true;
    if (settleTimer) clearTimeout(settleTimer);
    if (rearmTimer) clearTimeout(rearmTimer);
    disarm();
  };
}

/**
 * Calls `onChange` when the file is written, replaced, created or removed.
 * The watch is on the parent directory: editors and agents save by writing a
 * temporary file and renaming it over the target, which a watch on the file
 * itself stops seeing after the first save.
 */
export function watchFileChanges(filePath: string, onChange: () => void): () => void {
  const fileName = path.basename(filePath);
  return watchDirectory(
    path.dirname(filePath),
    (_eventType, changedName) => changedName == null || changedName === fileName,
    onChange,
  );
}

/**
 * Calls `onChange` when an entry is added to, removed from or renamed in the
 * directory. Writes into existing files are left out: they do not change what
 * an explorer lists, and a build makes thousands of them.
 */
export function watchDirectoryEntries(directory: string, onChange: () => void): () => void {
  return watchDirectory(directory, (eventType) => eventType === 'rename', onChange);
}

/** The directories one explorer shows; they come and go as folders are expanded and collapsed. */
export class DirectoryWatchSet {
  private readonly watches = new Map<string, () => void>();

  constructor(private readonly onChange: (directory: string) => void) {}

  set(directories: readonly string[]): void {
    const wanted = new Set(directories.slice(0, MAX_WATCHED_DIRECTORIES));
    for (const [directory, stop] of this.watches) {
      if (wanted.has(directory)) continue;
      stop();
      this.watches.delete(directory);
    }
    for (const directory of wanted) {
      if (this.watches.has(directory)) continue;
      this.watches.set(directory, watchDirectoryEntries(directory, () => this.onChange(directory)));
    }
  }

  close(): void {
    for (const stop of this.watches.values()) stop();
    this.watches.clear();
  }
}

function openEventStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  onClose: () => void,
): (event: string, data: unknown) => void {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    onClose();
    if (!res.writableEnded) res.end();
  };
  const write = (frame: string) => {
    if (closed) return;
    try {
      res.write(frame);
    } catch {
      close();
    }
  };
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  req.socket.setTimeout(0);
  res.flushHeaders?.();
  const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
  keepalive.unref?.();
  req.on('close', close);
  res.on('close', close);
  return (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * GET /v1/workspace/file-events?path= as server-sent events: `ready` once the
 * watch is in place, then `changed` per settled change. The events carry no
 * file state; the Hub reads the file itself, so a missed or duplicate event
 * can never leave it with wrong contents.
 */
export function streamFileEvents(input: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  filePath: string;
}): void {
  let stopWatching: () => void = () => undefined;
  const send = openEventStream(input.req, input.res, () => stopWatching());
  stopWatching = watchFileChanges(input.filePath, () => send('changed', {}));
  send('ready', {});
}

const directoryStreams = new Map<string, DirectoryWatchSet>();

/**
 * POST /v1/workspace/directory-events as server-sent events: `ready` with the
 * stream's id, then `changed` with the directory whose entries changed. The
 * id lets the watched directories be replaced while the stream stays open,
 * so expanding a folder never leaves a moment with nothing watching.
 */
export function streamDirectoryEvents(input: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  directories: readonly string[];
}): void {
  const streamId = crypto.randomUUID();
  const watches = new DirectoryWatchSet((directory) => send('changed', { path: directory }));
  const send = openEventStream(input.req, input.res, () => {
    directoryStreams.delete(streamId);
    watches.close();
  });
  directoryStreams.set(streamId, watches);
  watches.set(input.directories);
  send('ready', { streamId });
}

/** False when the stream is gone; its owner then opens a new one. */
export function setStreamedDirectories(streamId: string, directories: readonly string[]): boolean {
  const watches = directoryStreams.get(streamId);
  if (!watches) return false;
  watches.set(directories);
  return true;
}
