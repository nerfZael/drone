import { KeyedWorkQueue } from '../background/keyed-work-queue';

export class ChatReconciliationQueue {
  private readonly workQueue: KeyedWorkQueue<{ droneId: string; chatName: string }>;
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly deps: {
      normalizeDroneId: (value: string) => string;
      normalizeChatName: (value: string) => string;
      key: (droneId: string, chatName: string) => string;
      execute: (input: { droneId: string; chatName: string }) => Promise<void>;
      concurrency?: () => number;
    },
  ) {
    this.workQueue = new KeyedWorkQueue<{ droneId: string; chatName: string }>({
      key: (item) => this.deps.key(item.droneId, item.chatName),
      concurrency: () => this.concurrency(),
      run: async (item) => await this.deps.execute(item),
    });
  }

  private concurrency(): number {
    const configured = this.deps.concurrency?.() ?? 6;
    return Number.isFinite(configured) ? Math.max(1, Math.min(16, Math.floor(configured))) : 6;
  }

  start(): void {
    this.workQueue.start();
  }

  enqueue(droneIdRaw: string, chatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw) || 'default';
    if (!droneId) return;
    const key = this.deps.key(droneId, chatName);
    if (!key) return;
    this.workQueue.enqueue({ droneId, chatName });
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
    timer.unref?.();
    this.retryTimers.set(key, timer);
  }

  delete(droneIdRaw: string, chatNameRaw: string): void {
    const key = this.deps.key(droneIdRaw, chatNameRaw);
    if (!key) return;
    this.clearRetryByKey(key);
    this.workQueue.remove(key);
  }

  migrate(droneIdRaw: string, fromChatNameRaw: string, toChatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const fromChatName = this.deps.normalizeChatName(fromChatNameRaw);
    const toChatName = this.deps.normalizeChatName(toChatNameRaw);
    const fromKey = this.deps.key(droneId, fromChatName);
    const toKey = this.deps.key(droneId, toChatName);
    if (!fromKey || !toKey || fromKey === toKey) return;
    this.clearRetryByKey(fromKey);
    this.workQueue.move(fromKey, { droneId, chatName: toChatName });
  }

  clearRetries(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  async stop(): Promise<void> {
    this.clearRetries();
    await this.workQueue.stop();
  }
}
