import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
// Switching tabs drops one file and adds another; the connection should outlive that.
const IDLE_CLOSE_MS = 1_000;

type WorkspaceEventsSocket = {
  send: (data: string) => void;
  close: () => void;
  onopen: ((event: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onclose: ((event: any) => void) | null;
};

export type WorkspaceEventsRuntime = {
  openSocket: (droneId: string) => WorkspaceEventsSocket;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: any) => void;
};

const browserRuntime: WorkspaceEventsRuntime = {
  openSocket: (droneId) =>
    new WebSocket(buildDirectApiWebSocketUrl(`/api/drones/${encodeURIComponent(droneId)}/fs/events`)),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

/** What the Hub says about an open file; `snapshot` also arrives whenever a watch (re)starts. */
export type WorkspaceFileEvent = {
  event: 'snapshot' | 'changed' | 'deleted' | 'stream-error';
  path: string;
  revision?: string;
  size?: number;
  mtimeMs?: number | null;
};

type DirectorySubscriber = {
  directories: readonly string[];
  onChanged: (directory: string) => void;
  onResync: () => void;
};
type FileSubscriber = { path: string; onEvent: (event: WorkspaceFileEvent) => void };
type RepoSubscriber = { onChanged: () => void; onLive: (live: boolean) => void };

/**
 * The one connection a workspace's explorer, editor and changes panel share
 * with the Hub. It tells the Hub which folders are shown, which files have a
 * live view and whether git status is on screen, again whenever any of that
 * changes, and hands the Hub's answers to whoever asked.
 * It opens with the first subscriber and closes with the last.
 *
 * A socket rather than event streams: the app already holds several
 * long-lived HTTP connections, and browsers allow six per origin.
 */
class WorkspaceEventsChannel {
  private readonly directorySubscribers = new Set<DirectorySubscriber>();
  private readonly fileSubscribers = new Set<FileSubscriber>();
  private readonly repoSubscribers = new Set<RepoSubscriber>();
  private repoLive = false;
  private socket: WorkspaceEventsSocket | null = null;
  private open = false;
  private connections = 0;
  private retryMs = RETRY_MIN_MS;
  private retryTimer: unknown = null;
  private sendScheduled = false;
  private idleTimer: unknown = null;
  private lastSent = '';

  constructor(
    private readonly droneId: string,
    private readonly runtime: WorkspaceEventsRuntime,
    private readonly onIdle: () => void,
  ) {}

  addDirectories(subscriber: DirectorySubscriber): void {
    this.directorySubscribers.add(subscriber);
    this.changed();
  }
  addFile(subscriber: FileSubscriber): void {
    this.fileSubscribers.add(subscriber);
    this.changed();
  }
  addRepo(subscriber: RepoSubscriber): void {
    this.repoSubscribers.add(subscriber);
    // A second panel on a repository already being watched learns so at once.
    if (this.repoLive) subscriber.onLive(true);
    this.changed();
  }
  private subscriberCount(): number {
    return this.directorySubscribers.size + this.fileSubscribers.size + this.repoSubscribers.size;
  }
  private setRepoLive(live: boolean): void {
    if (this.repoLive === live) return;
    this.repoLive = live;
    for (const subscriber of [...this.repoSubscribers]) subscriber.onLive(live);
  }
  remove(subscriber: DirectorySubscriber | FileSubscriber | RepoSubscriber): void {
    this.directorySubscribers.delete(subscriber as DirectorySubscriber);
    this.fileSubscribers.delete(subscriber as FileSubscriber);
    this.repoSubscribers.delete(subscriber as RepoSubscriber);
    if (this.subscriberCount() > 0) {
      this.changed();
      return;
    }
    if (this.idleTimer != null) return;
    this.idleTimer = this.runtime.setTimeout(() => {
      this.idleTimer = null;
      if (this.subscriberCount() > 0) return;
      if (this.retryTimer != null) this.runtime.clearTimeout(this.retryTimer);
      this.retryTimer = null;
      const current = this.socket;
      this.socket = null;
      this.open = false;
      current?.close();
      this.onIdle();
    }, IDLE_CLOSE_MS);
  }

  /** Several subscribers usually change in one render; they are sent together. */
  changed(): void {
    if (!this.socket && this.retryTimer == null) this.connect();
    if (this.sendScheduled) return;
    this.sendScheduled = true;
    queueMicrotask(() => {
      this.sendScheduled = false;
      this.sendWanted();
    });
  }

  private sendWanted(): void {
    if (!this.open || !this.socket) return;
    const directories = [...new Set([...this.directorySubscribers].flatMap((subscriber) => subscriber.directories))];
    const files = [...new Set([...this.fileSubscribers].map((subscriber) => subscriber.path))];
    // Left out unless wanted, which an older Hub reads the same way.
    const message = JSON.stringify({ directories, files, ...(this.repoSubscribers.size > 0 ? { repo: true } : {}) });
    if (message === this.lastSent) return;
    this.lastSent = message;
    // The Hub stops watching once no panel asks, and says nothing more about it.
    if (this.repoSubscribers.size === 0) this.repoLive = false;
    this.socket.send(message);
  }

  private connect(): void {
    const startedAt = Date.now();
    let current: WorkspaceEventsSocket;
    try {
      current = this.runtime.openSocket(this.droneId);
    } catch {
      this.reconnectLater(startedAt);
      return;
    }
    this.socket = current;
    current.onopen = () => {
      if (this.socket !== current) return;
      this.open = true;
      this.connections += 1;
      this.lastSent = '';
      this.sendWanted();
      // Files announce themselves with a fresh snapshot; folders have to be read again.
      if (this.connections > 1) for (const subscriber of [...this.directorySubscribers]) subscriber.onResync();
      // Git status changes while disconnected went unseen as well.
      if (this.connections > 1) for (const subscriber of [...this.repoSubscribers]) subscriber.onChanged();
    };
    current.onmessage = (event: { data: unknown }) => {
      if (this.socket !== current) return;
      let message: (Partial<WorkspaceFileEvent> & { type?: unknown }) | null = null;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const path = message?.path;
      if (message?.type === 'directory-changed' && typeof path === 'string') {
        for (const subscriber of [...this.directorySubscribers]) {
          if (subscriber.directories.includes(path)) subscriber.onChanged(path);
        }
      } else if (message?.type === 'resync') {
        for (const subscriber of [...this.directorySubscribers]) subscriber.onResync();
      } else if (message?.type === 'repo-changed') {
        for (const subscriber of [...this.repoSubscribers]) subscriber.onChanged();
      } else if (message?.type === 'repo-watch') {
        this.setRepoLive((message as { live?: unknown }).live === true);
      } else if (message?.type === 'file' && typeof path === 'string' && typeof message.event === 'string') {
        for (const subscriber of [...this.fileSubscribers]) {
          if (subscriber.path === path) subscriber.onEvent(message as WorkspaceFileEvent);
        }
      }
    };
    current.onclose = () => {
      if (this.socket !== current) return;
      this.socket = null;
      this.open = false;
      this.setRepoLive(false);
      this.reconnectLater(startedAt);
    };
  }

  private reconnectLater(startedAt: number): void {
    if (this.retryTimer != null) return;
    // A connection that stayed up for a while is a fresh failure, not a persistent one.
    this.retryMs = Date.now() - startedAt > RETRY_MAX_MS ? RETRY_MIN_MS : Math.min(RETRY_MAX_MS, this.retryMs * 2);
    this.retryTimer = this.runtime.setTimeout(() => {
      this.retryTimer = null;
      if (this.subscriberCount() > 0) this.connect();
    }, this.retryMs);
  }
}

const channelsByRuntime = new WeakMap<WorkspaceEventsRuntime, Map<string, WorkspaceEventsChannel>>();

function workspaceEventsChannel(droneId: string, runtime: WorkspaceEventsRuntime): WorkspaceEventsChannel {
  let channels = channelsByRuntime.get(runtime);
  if (!channels) channelsByRuntime.set(runtime, (channels = new Map()));
  let channel = channels.get(droneId);
  if (!channel) {
    const owner = channels;
    channel = new WorkspaceEventsChannel(droneId, runtime, () => owner.delete(droneId));
    channels.set(droneId, channel);
  }
  return channel;
}

/**
 * Follows the folders an explorer shows. `onChanged` names the folder whose
 * entries changed. `onResync` means changes may have gone unseen (the
 * connection, or the Hub's link to a container, was down), so every folder
 * should be read again. `setDirectories` swaps the folders on the open
 * connection, so expanding a folder leaves no moment unwatched.
 */
export function subscribeDirectoryEvents(
  droneId: string,
  initialDirectories: readonly string[],
  callbacks: { onChanged: (directory: string) => void; onResync: () => void },
  runtime: WorkspaceEventsRuntime = browserRuntime,
): { setDirectories: (directories: readonly string[]) => void; close: () => void } {
  const channel = workspaceEventsChannel(droneId, runtime);
  const subscriber: DirectorySubscriber = { directories: [...initialDirectories], ...callbacks };
  channel.addDirectories(subscriber);
  return {
    setDirectories(next) {
      subscriber.directories = [...next];
      channel.changed();
    },
    close: () => channel.remove(subscriber),
  };
}

/**
 * Follows one open file. The Hub answers with a `snapshot` of its revision
 * when the watch starts and after every reconnection, so a tab always learns
 * whether it missed a change, then `changed` or `deleted` as they happen.
 */
export function subscribeFileEvents(
  droneId: string,
  path: string,
  onEvent: (event: WorkspaceFileEvent) => void,
  runtime: WorkspaceEventsRuntime = browserRuntime,
): () => void {
  const channel = workspaceEventsChannel(droneId, runtime);
  const subscriber: FileSubscriber = { path, onEvent };
  channel.addFile(subscriber);
  return () => channel.remove(subscriber);
}

/**
 * Follows a drone's git status for a changes panel. `onChanged` means it may
 * have changed and should be read again, which includes every reconnection.
 * `onLive(true)` means the Hub is watching the repository, so the panel only
 * needs to check on its own now and then; until then, and again after
 * `onLive(false)`, nothing tells it about changes. An older Hub never answers,
 * which leaves the panel checking as it always has.
 */
export function subscribeRepoEvents(
  droneId: string,
  callbacks: { onChanged: () => void; onLive: (live: boolean) => void },
  runtime: WorkspaceEventsRuntime = browserRuntime,
): () => void {
  const channel = workspaceEventsChannel(droneId, runtime);
  const subscriber: RepoSubscriber = { ...callbacks };
  channel.addRepo(subscriber);
  return () => channel.remove(subscriber);
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
