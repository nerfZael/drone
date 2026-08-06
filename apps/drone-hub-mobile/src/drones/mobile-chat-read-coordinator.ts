type ActiveRead = {
  key: string;
  promise: Promise<void>;
  refreshQueued: boolean;
  task: () => Promise<void>;
};

export class MobileChatReadCoordinator {
  private readonly activeByKey = new Map<string, ActiveRead>();

  constructor(private readonly onActiveChange: () => void) {}

  request(key: string, task: () => Promise<void>): Promise<void> {
    const active = this.activeByKey.get(key);
    if (active) {
      active.refreshQueued = true;
      active.task = task;
      return active.promise;
    }
    return this.start(key, task);
  }

  isActive(key: string): boolean {
    return this.activeByKey.has(key);
  }

  reset(): void {
    if (this.activeByKey.size === 0) return;
    this.activeByKey.clear();
    this.onActiveChange();
  }

  private start(key: string, task: () => Promise<void>): Promise<void> {
    const entry: ActiveRead = {
      key,
      promise: Promise.resolve(),
      refreshQueued: false,
      task,
    };
    entry.promise = task();
    this.activeByKey.set(key, entry);
    this.onActiveChange();
    void entry.promise.then(
      () => this.finish(entry),
      () => this.finish(entry),
    );
    return entry.promise;
  }

  private finish(entry: ActiveRead): void {
    if (this.activeByKey.get(entry.key) !== entry) return;
    if (entry.refreshQueued) {
      void this.start(entry.key, entry.task).catch(() => undefined);
      return;
    }
    this.activeByKey.delete(entry.key);
    this.onActiveChange();
  }
}
