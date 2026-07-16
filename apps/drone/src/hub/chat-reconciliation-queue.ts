export class ChatReconciliationQueue {
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly queue: Array<{ droneId: string; chatName: string }> = [];
  private readonly queued = new Set<string>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private active = 0;
  private pumping = false;

  constructor(
    private readonly deps: {
      normalizeDroneId: (value: string) => string;
      normalizeChatName: (value: string) => string;
      key: (droneId: string, chatName: string) => string;
      execute: (input: { droneId: string; chatName: string }) => Promise<void>;
      concurrency?: () => number;
    },
  ) {}

  private concurrency(): number {
    const configured = this.deps.concurrency?.() ?? 6;
    return Number.isFinite(configured) ? Math.max(1, Math.min(16, Math.floor(configured))) : 6;
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.active < this.concurrency() && this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) break;
        const key = this.deps.key(next.droneId, next.chatName);
        this.queued.delete(key);
        if (!key || this.tasks.has(key)) continue;
        this.active += 1;
        const task = this.deps
          .execute(next)
          .catch(() => {
            // Reconciliation is best-effort and will be retried by later events or polling.
          })
          .finally(() => {
            this.active -= 1;
            this.tasks.delete(key);
            this.pump();
          });
        this.tasks.set(key, task);
        void task;
      }
    } finally {
      this.pumping = false;
    }
  }

  enqueue(droneIdRaw: string, chatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw) || 'default';
    if (!droneId) return;
    const key = this.deps.key(droneId, chatName);
    if (!key || this.tasks.has(key) || this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push({ droneId, chatName });
    this.pump();
  }

  clearRetryByKey(key: string): void {
    const timer = this.retryTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.retryTimers.delete(key);
  }

  scheduleRetry(droneIdRaw: string, chatNameRaw: string, delayMs = 2_000): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    const key = this.deps.key(droneId, chatName);
    if (!droneId || !chatName || !key || this.retryTimers.has(key)) return;
    const timer = setTimeout(
      () => {
        this.retryTimers.delete(key);
        this.enqueue(droneId, chatName);
      },
      Math.max(250, Math.floor(delayMs || 0)),
    );
    this.retryTimers.set(key, timer);
  }

  delete(droneIdRaw: string, chatNameRaw: string): void {
    const key = this.deps.key(droneIdRaw, chatNameRaw);
    if (!key) return;
    this.clearRetryByKey(key);
    this.queued.delete(key);
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const item = this.queue[index];
      if (this.deps.key(item.droneId, item.chatName) === key) this.queue.splice(index, 1);
    }
  }

  migrate(droneIdRaw: string, fromChatNameRaw: string, toChatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const fromChatName = this.deps.normalizeChatName(fromChatNameRaw);
    const toChatName = this.deps.normalizeChatName(toChatNameRaw);
    const fromKey = this.deps.key(droneId, fromChatName);
    const toKey = this.deps.key(droneId, toChatName);
    if (!fromKey || !toKey || fromKey === toKey) return;
    this.clearRetryByKey(fromKey);
    if (this.queued.delete(fromKey)) this.queued.add(toKey);
    for (const item of this.queue) {
      if (this.deps.key(item.droneId, item.chatName) === fromKey) item.chatName = toChatName;
    }
  }

  clearRetries(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }
}
