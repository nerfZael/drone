export interface PendingPromptPumpTarget {
  droneId: string;
  chatName: string;
}

export function nativeAssistantOwnsPromptDelivery(agentKind: string): boolean {
  return agentKind === 'native';
}

export function pendingPromptKeepsChatBusy(opts: {
  state: string;
  hasTurn: boolean;
  native: boolean;
}): boolean {
  const state = String(opts.state ?? '').trim();
  if (state === 'failed' || state === 'cancelled') return false;
  if (state === 'queued' || state === 'sending') return true;
  if (opts.native && state === 'sent') return false;
  return !opts.hasTurn;
}

export interface PendingPromptPumpDependencies {
  normalizeDroneId(raw: string): string;
  normalizeChatName(raw: string): string;
  concurrencyLimit(): number;
  defaultRetryDelayMs(): number;
  run(target: PendingPromptPumpTarget): Promise<void>;
}

export class PendingPromptPump {
  readonly #tasks = new Map<string, Promise<void>>();
  readonly #queue: PendingPromptPumpTarget[] = [];
  readonly #queued = new Set<string>();
  readonly #retryAfterActive = new Set<string>();
  readonly #retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #active = 0;
  #pumping = false;

  constructor(private readonly deps: PendingPromptPumpDependencies) {}

  enqueue(droneIdRaw: string, chatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    if (!droneId) return;
    const key = this.#key(droneId, chatName);
    this.#clearRetry(key);
    if (this.#tasks.has(key)) {
      // Preserve edge-trigger requests that arrive while a task is active.
      this.#retryAfterActive.add(key);
      return;
    }
    if (this.#queued.has(key)) return;
    this.#queued.add(key);
    this.#queue.push({ droneId, chatName });
    this.#pump();
  }

  scheduleRetry(droneIdRaw: string, chatNameRaw: string, delayMs?: number): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    if (!droneId) return;
    const key = this.#key(droneId, chatName);
    if (this.#retryTimers.has(key)) return;
    const requestedDelay = delayMs ?? this.deps.defaultRetryDelayMs();
    const ms = Number.isFinite(requestedDelay)
      ? Math.max(1_000, Math.floor(requestedDelay))
      : this.deps.defaultRetryDelayMs();
    const timer = setTimeout(() => {
      this.#retryTimers.delete(key);
      this.enqueue(droneId, chatName);
    }, ms);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.#retryTimers.set(key, timer);
  }

  delete(droneIdRaw: string, chatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    if (!droneId) return;
    const key = this.#key(droneId, chatName);
    this.#queued.delete(key);
    this.#retryAfterActive.delete(key);
    this.#clearRetry(key);
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const item = this.#queue[index];
      if (this.#key(item.droneId, item.chatName) === key) this.#queue.splice(index, 1);
    }
  }

  migrate(droneIdRaw: string, fromChatNameRaw: string, toChatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const fromChatName = this.deps.normalizeChatName(fromChatNameRaw);
    const toChatName = this.deps.normalizeChatName(toChatNameRaw);
    if (!droneId) return;
    const fromKey = this.#key(droneId, fromChatName);
    const toKey = this.#key(droneId, toChatName);
    if (fromKey === toKey) return;

    if (this.#queued.delete(fromKey)) this.#queued.add(toKey);
    if (this.#retryTimers.has(fromKey)) {
      this.#clearRetry(fromKey);
      this.scheduleRetry(droneId, toChatName);
    }
    for (const item of this.#queue) {
      if (this.#key(item.droneId, item.chatName) === fromKey) item.chatName = toChatName;
    }
  }

  async reset(): Promise<void> {
    this.#queue.length = 0;
    this.#queued.clear();
    this.#retryAfterActive.clear();
    for (const timer of this.#retryTimers.values()) clearTimeout(timer);
    this.#retryTimers.clear();
    await Promise.allSettled(Array.from(this.#tasks.values()).map((task) => task.catch(() => {})));
    this.#tasks.clear();
    this.#active = 0;
    this.#pumping = false;
  }

  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      const limit = this.deps.concurrencyLimit();
      while (this.#active < limit && this.#queue.length > 0) {
        const next = this.#queue.shift();
        if (!next) break;
        const droneId = this.deps.normalizeDroneId(next.droneId);
        const chatName = this.deps.normalizeChatName(next.chatName);
        if (!droneId) continue;
        const key = this.#key(droneId, chatName);
        this.#queued.delete(key);
        if (this.#tasks.has(key)) continue;

        this.#active += 1;
        const task = this.deps
          .run({ droneId, chatName })
          .catch(() => {
            // Best-effort scheduler; the delivery operation persists its own errors.
          })
          .finally(() => {
            this.#active -= 1;
            this.#tasks.delete(key);
            if (this.#retryAfterActive.delete(key)) this.enqueue(droneId, chatName);
            this.#pump();
          });
        this.#tasks.set(key, task);
        void task;
      }
    } finally {
      this.#pumping = false;
    }
  }

  #clearRetry(key: string): void {
    const timer = this.#retryTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.#retryTimers.delete(key);
  }

  #key(droneId: string, chatName: string): string {
    return `${droneId}:${chatName}`;
  }
}
