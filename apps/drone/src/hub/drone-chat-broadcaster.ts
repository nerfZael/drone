import type { ServerResponse } from 'node:http';

type ChatRef = { droneId: string; chatName: string };

export class DroneChatBroadcaster {
  readonly clients = new Set<ServerResponse>();
  readonly lastByKey = new Map<string, string>();

  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private readonly deps: {
      loadModel: () => Promise<any>;
      normalizeDroneId: (value: string) => string;
      normalizeChatName: (value: string) => string;
      nowIso: () => string;
      writeSseEvent: (response: ServerResponse, event: string, data: any) => void;
    },
  ) {}

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
          }
        : null,
      pendingPrompts: pendingPrompts.map((item: any) => ({
        id: String(item?.id ?? ''),
        state: String(item?.state ?? ''),
        error: String(item?.error ?? ''),
        agentPlan: item?.agentPlan ?? null,
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
  }

  private broadcast(event: string, data: any): void {
    for (const client of Array.from(this.clients)) {
      if (client.destroyed || client.writableEnded) {
        this.clients.delete(client);
      } else {
        this.deps.writeSseEvent(client, event, data);
      }
    }
  }

  async refresh(opts?: { broadcastSnapshot?: boolean }): Promise<void> {
    if (this.clients.size === 0 || this.busy) return;
    this.busy = true;
    try {
      const next = await this.buildSnapshot();
      if (opts?.broadcastSnapshot || this.lastByKey.size === 0) {
        this.replaceSnapshot(next);
        this.broadcast('snapshot', {
          ok: true,
          chats: Array.from(next.keys())
            .map((key) => this.parseKey(key))
            .filter(Boolean),
          at: this.deps.nowIso(),
        });
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
      this.broadcast('stream-error', { ok: false, error: error?.message ?? String(error) });
    } finally {
      this.busy = false;
    }
  }

  schedule(delayMs = 100): void {
    if (this.clients.size === 0 || this.refreshTimeout) return;
    this.refreshTimeout = setTimeout(
      () => {
        this.refreshTimeout = null;
        void this.refresh();
      },
      Math.max(0, delayMs),
    );
    this.refreshTimeout.unref?.();
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
    if (this.clients.size > 0) return;
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.refreshTimeout = null;
    this.keepAliveTimer = null;
    this.busy = false;
  }
}
