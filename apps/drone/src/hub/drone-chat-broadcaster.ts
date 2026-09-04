import type { ServerResponse } from 'node:http';

type ChatRef = { droneId: string; chatName: string };
export type DroneChatEventSubscriber = (event: string, data: any) => void;

export class DroneChatBroadcaster {
  readonly clients = new Set<ServerResponse>();
  readonly lastByKey = new Map<string, string>();
  private readonly subscribers = new Set<DroneChatEventSubscriber>();

  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingChanges = new Map<string, ChatRef>();
  private fullRefreshPending = false;
  private pendingBroadcastSnapshot = false;
  private busy = false;
  private snapshotInitialized = false;

  constructor(
    private readonly deps: {
      loadModel: () => Promise<any>;
      normalizeDroneId: (value: string) => string;
      normalizeChatName: (value: string) => string;
      nowIso: () => string;
      writeSseEvent: (response: ServerResponse, event: string, data: any) => void;
    },
  ) {}

  get hasConsumers(): boolean {
    return this.clients.size > 0 || this.subscribers.size > 0;
  }

  get snapshot(): { ok: true; chats: ChatRef[]; at: string } | null {
    if (!this.snapshotInitialized) return null;
    return {
      ok: true,
      chats: Array.from(this.lastByKey.keys())
        .map((key) => this.parseKey(key))
        .filter((chat): chat is ChatRef => Boolean(chat)),
      at: this.deps.nowIso(),
    };
  }

  subscribe(subscriber: DroneChatEventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private key(droneIdRaw: string, chatNameRaw: string): string {
    return `${this.deps.normalizeDroneId(droneIdRaw)}\u0000${this.deps.normalizeChatName(chatNameRaw)}`;
  }

  private parseKey(key: string): ChatRef | null {
    const [droneIdRaw, chatNameRaw] = String(key ?? '').split('\u0000');
    const droneId = this.deps.normalizeDroneId(droneIdRaw);
    const chatName = this.deps.normalizeChatName(chatNameRaw);
    return droneId && chatName ? { droneId, chatName } : null;
  }

  private fingerprint(chatEntry: any): string {
    const turns = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    const pendingPrompts = Array.isArray(chatEntry?.pendingPrompts) ? chatEntry.pendingPrompts : [];
    return JSON.stringify({
      turnCount: turns.length,
      lastTurn: lastTurn
        ? {
            id: String(lastTurn?.id ?? ''),
            at: String(lastTurn?.at ?? ''),
            completedAt: String(lastTurn?.completedAt ?? ''),
            ok: lastTurn?.ok === true,
            outputLength: String(lastTurn?.output ?? '').length,
            outputTail: String(lastTurn?.output ?? '').slice(-256),
            agentPlan: lastTurn?.agentPlan ?? null,
            activityUpdatedAt: String(
              lastTurn?.activity?.updatedAt ?? lastTurn?.activitySummary?.updatedAt ?? '',
            ),
          }
        : null,
      pendingPrompts: pendingPrompts.map((item: any) => ({
        id: String(item?.id ?? ''),
        state: String(item?.state ?? ''),
        error: String(item?.error ?? ''),
        agentPlan: item?.agentPlan ?? null,
        activityUpdatedAt: String(item?.activity?.updatedAt ?? ''),
        updatedAt: String(item?.updatedAt ?? ''),
      })),
    });
  }

  private async buildSnapshot(): Promise<Map<string, string>> {
    const model = await this.deps.loadModel();
    const next = new Map<string, string>();
    for (const [droneIdRaw, drone] of Object.entries(model?.drones ?? {}) as Array<[string, any]>) {
      const droneId = this.deps.normalizeDroneId(droneIdRaw || drone?.id);
      if (!droneId) continue;
      for (const [chatNameRaw, chatEntry] of Object.entries(drone?.chats ?? {}) as Array<
        [string, any]
      >) {
        const chatName = this.deps.normalizeChatName(chatNameRaw);
        if (chatName) next.set(this.key(droneId, chatName), this.fingerprint(chatEntry));
      }
    }
    return next;
  }

  private replaceSnapshot(next: Map<string, string>): void {
    this.lastByKey.clear();
    for (const [key, fingerprint] of next) this.lastByKey.set(key, fingerprint);
    this.snapshotInitialized = true;
  }

  private broadcast(event: string, data: any): void {
    for (const client of Array.from(this.clients)) {
      if (client.destroyed || client.writableEnded) {
        this.clients.delete(client);
      } else {
        this.deps.writeSseEvent(client, event, data);
      }
    }
    for (const subscriber of Array.from(this.subscribers)) {
      try {
        subscriber(event, data);
      } catch {
        // One transport subscriber must not interrupt chat invalidations.
      }
    }
  }

  private ensureRefreshScheduled(delayMs: number): void {
    // A timer that fires while a snapshot is being built cannot do useful
    // work. Leave the request pending and let refresh() schedule it after the
    // in-flight build releases the broadcaster.
    if (!this.hasConsumers || this.refreshTimeout || this.busy) return;
    this.refreshTimeout = setTimeout(
      () => {
        this.refreshTimeout = null;
        void this.refresh();
      },
      Math.max(0, delayMs),
    );
    this.refreshTimeout.unref?.();
  }

  async refresh(opts?: { broadcastSnapshot?: boolean }): Promise<void> {
    if (!this.hasConsumers) return;
    if (this.busy) {
      this.fullRefreshPending = true;
      this.pendingBroadcastSnapshot ||= opts?.broadcastSnapshot === true;
      return;
    }
    this.busy = true;
    const claimedChanges = new Map(this.pendingChanges);
    const claimedFullRefresh = this.fullRefreshPending;
    const broadcastSnapshot =
      opts?.broadcastSnapshot === true || this.pendingBroadcastSnapshot;
    this.pendingChanges.clear();
    this.fullRefreshPending = false;
    this.pendingBroadcastSnapshot = false;
    try {
      if (
        !broadcastSnapshot &&
        !claimedFullRefresh &&
        (this.snapshotInitialized || this.lastByKey.size > 0) &&
        claimedChanges.size > 0
      ) {
        const chats = Array.from(claimedChanges.values());
        this.broadcast('chat_delta', { ok: true, chats, removed: [], at: this.deps.nowIso() });
        return;
      }
      const next = await this.buildSnapshot();
      if (broadcastSnapshot || (!this.snapshotInitialized && this.lastByKey.size === 0)) {
        this.replaceSnapshot(next);
        this.broadcast('snapshot', this.snapshot);
        return;
      }

      const chats: ChatRef[] = [];
      const removed: ChatRef[] = [];
      for (const [key, fingerprint] of next) {
        if (this.lastByKey.get(key) === fingerprint) continue;
        const parsed = this.parseKey(key);
        if (parsed) chats.push(parsed);
      }
      for (const key of this.lastByKey.keys()) {
        if (next.has(key)) continue;
        const parsed = this.parseKey(key);
        if (parsed) removed.push(parsed);
      }
      this.replaceSnapshot(next);
      if (chats.length > 0 || removed.length > 0) {
        this.broadcast('chat_delta', {
          ok: true,
          chats,
          removed,
          at: this.deps.nowIso(),
        });
      }
    } catch (error: any) {
      if (claimedFullRefresh || broadcastSnapshot) this.fullRefreshPending = true;
      if (broadcastSnapshot) this.pendingBroadcastSnapshot = true;
      for (const [key, change] of claimedChanges) {
        if (!this.pendingChanges.has(key)) this.pendingChanges.set(key, change);
      }
      this.broadcast('stream-error', { ok: false, error: error?.message ?? String(error) });
    } finally {
      this.busy = false;
      if (this.fullRefreshPending || this.pendingChanges.size > 0) {
        this.ensureRefreshScheduled(0);
      }
    }
  }

  schedule(delayMs = 100, change?: ChatRef): void {
    if (change) {
      const droneId = this.deps.normalizeDroneId(change.droneId);
      const chatName = this.deps.normalizeChatName(change.chatName);
      if (droneId && chatName) this.pendingChanges.set(this.key(droneId, chatName), { droneId, chatName });
    } else {
      this.fullRefreshPending = true;
    }
    this.ensureRefreshScheduled(delayMs);
  }

  start(): void {
    if (this.keepAliveTimer) return;
    this.keepAliveTimer = setInterval(() => {
      for (const client of Array.from(this.clients)) {
        if (client.destroyed || client.writableEnded) this.clients.delete(client);
        else client.write(': keepalive\n\n');
      }
      this.stopIfIdle();
    }, 25_000);
    this.keepAliveTimer.unref?.();
  }

  stopIfIdle(): void {
    if (this.hasConsumers) return;
    this.stop();
  }

  stop(): void {
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.refreshTimeout = null;
    this.keepAliveTimer = null;
    this.pendingChanges.clear();
    this.fullRefreshPending = false;
    this.pendingBroadcastSnapshot = false;
    this.snapshotInitialized = false;
    this.clients.clear();
    this.subscribers.clear();
  }
}
