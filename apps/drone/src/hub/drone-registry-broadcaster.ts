import type { ServerResponse } from 'node:http';

export type DroneRegistrySnapshot = {
  ok: true;
  drones: any[];
  groups?: any[];
  uiPreferences?: Record<string, unknown>;
  preferenceUpdatedAt?: string | null;
  preferenceVersion?: number | null;
};

export class DroneRegistryBroadcaster {
  readonly clients = new Set<ServerResponse>();

  private lastById = new Map<string, string>();
  private lastSnapshot: DroneRegistrySnapshot | null = null;
  private lastPreferenceVersion: number | null | undefined;
  private lastPreferencesSerialized: string | undefined;
  private lastGroupsSerialized: string | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private refreshPending = false;
  private pendingBroadcastSnapshot = false;

  constructor(
    private readonly deps: {
      buildSnapshot: () => Promise<DroneRegistrySnapshot>;
      writeSseEvent: (response: ServerResponse, event: string, data: any) => void;
    },
  ) {}

  get snapshot(): DroneRegistrySnapshot | null {
    return this.lastSnapshot;
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

  async refresh(opts?: { broadcastSnapshot?: boolean }): Promise<DroneRegistrySnapshot | null> {
    if (this.busy) {
      this.refreshPending = true;
      this.pendingBroadcastSnapshot ||= opts?.broadcastSnapshot === true;
      return this.lastSnapshot;
    }
    this.busy = true;
    try {
      const snapshot = await this.deps.buildSnapshot();
      // A refresh requested while this snapshot was being assembled means the underlying state
      // may already be newer. Publishing both would make clients briefly render the stale state
      // before the guaranteed follow-up refresh. Leave the current baseline untouched and let
      // that follow-up publish the coherent snapshot instead.
      if (this.refreshPending) return snapshot;
      const nextById = new Map(
        snapshot.drones
          .map((drone) => [String(drone?.id ?? '').trim(), JSON.stringify(drone)] as const)
          .filter(([id]) => Boolean(id)),
      );

      if (opts?.broadcastSnapshot || !this.lastSnapshot) {
        this.lastSnapshot = snapshot;
        this.lastPreferenceVersion = snapshot.preferenceVersion;
        this.lastPreferencesSerialized = JSON.stringify(snapshot.uiPreferences ?? {});
        this.lastGroupsSerialized = JSON.stringify(snapshot.groups ?? []);
        this.lastById = nextById;
        this.broadcast('snapshot', snapshot);
        return snapshot;
      }

      const upserts: any[] = [];
      const removedIds: string[] = [];
      for (const drone of snapshot.drones) {
        const id = String(drone?.id ?? '').trim();
        const serialized = id ? nextById.get(id) : null;
        if (serialized && this.lastById.get(id) !== serialized) upserts.push(drone);
      }
      for (const id of this.lastById.keys()) {
        if (!nextById.has(id)) removedIds.push(id);
      }

      const preferencesSerialized = JSON.stringify(snapshot.uiPreferences ?? {});
      const preferencesChanged =
        snapshot.preferenceVersion !== this.lastPreferenceVersion ||
        preferencesSerialized !== this.lastPreferencesSerialized;
      const groupsSerialized = JSON.stringify(snapshot.groups ?? []);
      const groupsChanged = groupsSerialized !== this.lastGroupsSerialized;
      this.lastSnapshot = snapshot;
      this.lastPreferenceVersion = snapshot.preferenceVersion;
      this.lastPreferencesSerialized = preferencesSerialized;
      this.lastGroupsSerialized = groupsSerialized;
      this.lastById = nextById;
      if (upserts.length > 0 || removedIds.length > 0 || preferencesChanged || groupsChanged) {
        this.broadcast('delta', {
          ok: true,
          upserts,
          removedIds,
          order: snapshot.drones.map((drone) => String(drone?.id ?? '').trim()).filter(Boolean),
          ...(snapshot.groups ? { groups: snapshot.groups } : {}),
          ...(snapshot.uiPreferences ? { uiPreferences: snapshot.uiPreferences } : {}),
          preferenceUpdatedAt: snapshot.preferenceUpdatedAt ?? null,
          preferenceVersion: snapshot.preferenceVersion ?? null,
        });
      }
      return snapshot;
    } catch (error: any) {
      this.broadcast('stream-error', { ok: false, error: error?.message ?? String(error) });
      return null;
    } finally {
      this.busy = false;
      if (this.refreshPending) {
        const broadcastSnapshot = this.pendingBroadcastSnapshot;
        this.refreshPending = false;
        this.pendingBroadcastSnapshot = false;
        void this.refresh(broadcastSnapshot ? { broadcastSnapshot: true } : undefined);
      }
    }
  }

  schedule(delayMs = 150, restart = false): void {
    if (this.clients.size === 0 || (this.refreshTimeout && !restart)) return;
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
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
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => void this.refresh(), 15_000);
      this.refreshTimer.unref?.();
    }
    if (!this.keepAliveTimer) {
      this.keepAliveTimer = setInterval(() => {
        for (const client of Array.from(this.clients)) {
          if (client.destroyed || client.writableEnded) this.clients.delete(client);
          else client.write(': keepalive\n\n');
        }
        this.stopIfIdle();
      }, 25_000);
      this.keepAliveTimer.unref?.();
    }
  }

  stopIfIdle(): void {
    if (this.clients.size > 0) return;
    this.stop();
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.refreshTimer = null;
    this.refreshTimeout = null;
    this.keepAliveTimer = null;
    this.busy = false;
    this.refreshPending = false;
    this.pendingBroadcastSnapshot = false;
    this.clients.clear();
  }
}
