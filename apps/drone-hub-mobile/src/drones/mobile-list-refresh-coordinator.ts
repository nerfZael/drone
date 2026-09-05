type RefreshTask = (quiet: boolean, signal: AbortSignal) => Promise<void>;
type QueuedRefresh = {
  quiet: boolean;
  task: RefreshTask;
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
};
type ActiveRefresh = { controller: AbortController; next?: QueuedRefresh };

/** One active read and one merged follow-up per device. Callers await their requested refresh. */
export class MobileListRefreshCoordinator {
  private readonly active = new Map<string, ActiveRefresh>();

  request(key: string, quiet: boolean, task: RefreshTask): Promise<void> {
    const active = this.active.get(key);
    if (!active) return this.start(key, quiet, task);
    if (active.next) {
      active.next.quiet &&= quiet;
      active.next.task = task;
    } else {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      active.next = { quiet, task, promise, resolve, reject };
    }
    return active.next.promise;
  }

  reset(): void {
    for (const entry of this.active.values()) {
      entry.next?.resolve();
      entry.controller.abort();
    }
    this.active.clear();
  }

  private async start(key: string, quiet: boolean, task: RefreshTask): Promise<void> {
    const entry: ActiveRefresh = { controller: new AbortController() };
    this.active.set(key, entry);
    try {
      await task(quiet, entry.controller.signal);
    } finally {
      if (this.active.get(key) === entry) {
        this.active.delete(key);
        const next = entry.next;
        if (next) void this.start(key, next.quiet, next.task).then(next.resolve, next.reject);
      }
    }
  }
}
