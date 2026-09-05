type ActiveRead = {
  key: string;
  controller: AbortController;
  promise: Promise<void>;
  refreshQueued: boolean;
  task: (signal: AbortSignal) => Promise<void>;
};

export class MobileChatReadCoordinator {
  private readonly activeByKey = new Map<string, ActiveRead>();

  constructor(private readonly onActiveChange: () => void) {}

  request(key: string, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
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

  cancelExcept(key: string): void {
    for (const [activeKey, entry] of this.activeByKey) {
      if (activeKey === key) continue;
      this.activeByKey.delete(activeKey);
      entry.controller.abort();
    }
    this.onActiveChange();
  }

  reset(): void {
    this.cancelExcept('');
  }

  private start(key: string, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const entry: ActiveRead = {
      key,
      controller: new AbortController(),
      promise: Promise.resolve(),
      refreshQueued: false,
      task,
    };
    this.activeByKey.set(key, entry);
    try {
      entry.promise = task(entry.controller.signal);
    } catch (error) {
      entry.promise = Promise.reject(error);
    }
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
