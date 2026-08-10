export type KeyedWorkQueueOptions<T> = {
  key: (item: T) => string;
  concurrency: () => number;
  run: (item: T) => Promise<void>;
  onError?: (error: unknown, item: T) => Promise<void> | void;
};

export type KeyedWorkEnqueueResult = 'queued' | 'active' | 'duplicate' | 'stopped';

type QueuedItem<T> = {
  key: string;
  item: T;
};

export class KeyedWorkQueue<T> {
  private readonly active = new Map<string, Promise<void>>();
  private readonly queue: QueuedItem<T>[] = [];
  private readonly queuedKeys = new Set<string>();
  private readonly rerunAfterActive = new Map<string, T>();
  private pumpScheduled = false;
  private stopped = false;

  constructor(private readonly options: KeyedWorkQueueOptions<T>) {}

  get activeCount(): number {
    return this.active.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  start(): void {
    this.stopped = false;
    this.schedulePump();
  }

  enqueue(item: T, options?: { rerunIfActive?: boolean }): KeyedWorkEnqueueResult {
    if (this.stopped) return 'stopped';
    const key = this.options.key(item);
    if (!key) return 'duplicate';
    if (this.active.has(key)) {
      if (options?.rerunIfActive) this.rerunAfterActive.set(key, item);
      return 'active';
    }
    if (this.queuedKeys.has(key)) return 'duplicate';
    this.queuedKeys.add(key);
    this.queue.push({ key, item });
    this.schedulePump();
    return 'queued';
  }

  remove(key: string): boolean {
    if (!key) return false;
    this.rerunAfterActive.delete(key);
    const index = this.queue.findIndex((entry) => entry.key === key);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    this.queuedKeys.delete(key);
    return true;
  }

  move(fromKey: string, item: T): boolean {
    if (!fromKey) return false;
    const index = this.queue.findIndex((entry) => entry.key === fromKey);
    if (index < 0) return false;
    const toKey = this.options.key(item);
    this.queue.splice(index, 1);
    this.queuedKeys.delete(fromKey);
    if (!toKey || this.queuedKeys.has(toKey) || this.active.has(toKey)) return true;
    this.queue.splice(index, 0, { key: toKey, item });
    this.queuedKeys.add(toKey);
    return true;
  }

  async reset(): Promise<void> {
    this.stopped = true;
    this.clearPending();
    await Promise.allSettled(this.active.values());
    this.stopped = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearPending();
    await Promise.allSettled(this.active.values());
  }

  private clearPending(): void {
    this.queue.length = 0;
    this.queuedKeys.clear();
    this.rerunAfterActive.clear();
    this.pumpScheduled = false;
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.stopped) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.stopped) return;
    const configured = this.options.concurrency();
    const concurrency = Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : 1;
    while (this.active.size < concurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this.queuedKeys.delete(next.key);
      if (this.active.has(next.key)) continue;

      const task = Promise.resolve()
        .then(() => this.options.run(next.item))
        .catch(async (error) => {
          try {
            await this.options.onError?.(error, next.item);
          } catch {
            // Domain error handling is best-effort; the queue must continue.
          }
        })
        .finally(() => {
          this.active.delete(next.key);
          const rerun = this.rerunAfterActive.get(next.key);
          this.rerunAfterActive.delete(next.key);
          if (rerun && !this.stopped) this.enqueue(rerun);
          this.schedulePump();
        });
      this.active.set(next.key, task);
      void task;
    }
  }
}
