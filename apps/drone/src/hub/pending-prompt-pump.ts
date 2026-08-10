import { KeyedWorkQueue } from '../background/keyed-work-queue';

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
  countsAsAgentRun?: boolean;
}): boolean {
  if (opts.countsAsAgentRun === false) return false;
  const state = String(opts.state ?? '').trim();
  if (state === 'failed' || state === 'cancelled') return false;
  // A queued prompt is waiting for delivery; the agent is not working on it
  // yet. Keep it visible in the queue without promoting the chat/drone to the
  // busy state.
  if (state === 'queued') return false;
  if (state === 'sending') return true;
  if (opts.native && state === 'sent') return false;
  return !opts.hasTurn;
}

export interface PendingPromptPumpDependencies {
  normalizeDroneId(raw: string): string;
  normalizeChatName(raw: string): string;
  concurrencyLimit(): number;
  defaultRetryDelayMs(): number;
  run(target: PendingPromptPumpTarget, signal: AbortSignal): Promise<void>;
}

type PendingPromptRetryTimer = {
  dueAt: number;
  timer: ReturnType<typeof setTimeout>;
};

export class PendingPromptPump {
  readonly #workQueue: KeyedWorkQueue<PendingPromptPumpTarget>;
  readonly #retryTimers = new Map<string, PendingPromptRetryTimer[]>();
  #abortController = new AbortController();

  constructor(private readonly deps: PendingPromptPumpDependencies) {
    this.#workQueue = new KeyedWorkQueue({
      key: (target) => this.#key(target.droneId, target.chatName),
      concurrency: () => this.deps.concurrencyLimit(),
      run: async (target) => await this.deps.run(target, this.#abortController.signal),
    });
  }

  start(): void {
    if (this.#abortController.signal.aborted) this.#abortController = new AbortController();
    this.#workQueue.start();
  }

  enqueue(droneIdRaw: string, chatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    if (!droneId) return;
    this.#workQueue.enqueue(
      { droneId, chatName },
      // Preserve edge-trigger requests that arrive while a task is active.
      { rerunIfActive: true },
    );
  }

  scheduleRetry(droneIdRaw: string, chatNameRaw: string, delayMs?: number): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    if (!droneId) return;
    const key = this.#key(droneId, chatName);
    const requestedDelay = delayMs ?? this.deps.defaultRetryDelayMs();
    const ms = Number.isFinite(requestedDelay)
      ? Math.max(1_000, Math.floor(requestedDelay))
      : this.deps.defaultRetryDelayMs();
    const dueAt = Date.now() + ms;
    const existing = this.#retryTimers.get(key) ?? [];
    // Coalesce equivalent wakeups while retaining independently scheduled
    // later retries for other prompts in the same chat.
    if (existing.some((entry) => Math.abs(entry.dueAt - dueAt) <= 50)) return;
    let entry: PendingPromptRetryTimer;
    const timer = setTimeout(() => {
      const current = this.#retryTimers.get(key) ?? [];
      const remaining = current.filter((candidate) => candidate !== entry);
      if (remaining.length > 0) this.#retryTimers.set(key, remaining);
      else this.#retryTimers.delete(key);
      this.enqueue(droneId, chatName);
    }, ms);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    entry = { dueAt, timer };
    this.#retryTimers.set(key, [...existing, entry]);
  }

  delete(droneIdRaw: string, chatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    if (!droneId) return;
    const key = this.#key(droneId, chatName);
    this.#workQueue.remove(key);
    this.#clearRetry(key);
  }

  migrate(droneIdRaw: string, fromChatNameRaw: string, toChatNameRaw: string): void {
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const fromChatName = this.deps.normalizeChatName(fromChatNameRaw);
    const toChatName = this.deps.normalizeChatName(toChatNameRaw);
    if (!droneId) return;
    const fromKey = this.#key(droneId, fromChatName);
    const toKey = this.#key(droneId, toChatName);
    if (fromKey === toKey) return;

    this.#workQueue.move(fromKey, { droneId, chatName: toChatName });
    const retryDeadlines = (this.#retryTimers.get(fromKey) ?? []).map((entry) => entry.dueAt);
    if (retryDeadlines.length > 0) {
      this.#clearRetry(fromKey);
      for (const dueAt of retryDeadlines) {
        this.scheduleRetry(droneId, toChatName, Math.max(1_000, dueAt - Date.now()));
      }
    }
  }

  async reset(): Promise<void> {
    for (const entries of this.#retryTimers.values()) {
      for (const entry of entries) clearTimeout(entry.timer);
    }
    this.#retryTimers.clear();
    await this.#workQueue.reset();
    if (this.#abortController.signal.aborted) this.#abortController = new AbortController();
  }

  async stop(): Promise<void> {
    for (const entries of this.#retryTimers.values()) {
      for (const entry of entries) clearTimeout(entry.timer);
    }
    this.#retryTimers.clear();
    this.#abortController.abort(new Error('DroneHub is shutting down'));
    await this.#workQueue.stop();
  }

  #clearRetry(key: string): void {
    const entries = this.#retryTimers.get(key);
    if (!entries) return;
    for (const entry of entries) clearTimeout(entry.timer);
    this.#retryTimers.delete(key);
  }

  #key(droneId: string, chatName: string): string {
    return `${droneId}:${chatName}`;
  }
}
