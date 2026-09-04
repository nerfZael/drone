import type { ServerResponse } from 'node:http';

export type DroneRegistrySnapshot = {
  ok: true;
  drones: any[];
  groups?: any[];
  uiPreferences?: Record<string, unknown>;
  preferenceUpdatedAt?: string | null;
  preferenceVersion?: number | null;
};

export type DroneRegistryBroadcastTiming = {
  totalMs: number;
  droneCount: number;
  event: 'none' | 'snapshot' | 'delta' | 'stream-error';
  phases: Array<{ name: 'buildSnapshot' | 'format' | 'broadcast'; durationMs: number }>;
};

export type DroneRegistryEventSubscriber = (event: string, data: any) => void;

export class DroneRegistryBroadcaster {
  readonly clients = new Set<ServerResponse>();
  private readonly subscribers = new Set<DroneRegistryEventSubscriber>();

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
  private scheduledBroadcastSnapshot = false;
  private changeVersion = 0;
  private snapshotVersion = -1;

  constructor(
    private readonly deps: {
      buildSnapshot: () => Promise<DroneRegistrySnapshot>;
      onTiming?: (timing: DroneRegistryBroadcastTiming) => void;
      writeSseEvent: (response: ServerResponse, event: string, data: any) => void;
    },
  ) {}

  get snapshot(): DroneRegistrySnapshot | null {
    return this.lastSnapshot;
  }

  get freshSnapshot(): DroneRegistrySnapshot | null {
    return this.snapshotVersion === this.changeVersion ? this.lastSnapshot : null;
  }

  get hasConsumers(): boolean {
    return this.clients.size > 0 || this.subscribers.size > 0;
  }

  subscribe(subscriber: DroneRegistryEventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
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
        // One transport subscriber must not interrupt snapshot publication.
      }
    }
  }

  async refresh(opts?: { broadcastSnapshot?: boolean }): Promise<DroneRegistrySnapshot | null> {
    if (this.busy) {
      this.changeVersion += 1;
      this.refreshPending = true;
      this.pendingBroadcastSnapshot ||= opts?.broadcastSnapshot === true;
      return this.lastSnapshot;
    }
    this.busy = true;
    const refreshVersion = this.changeVersion;
    const startedAt = performance.now();
    const phases: DroneRegistryBroadcastTiming['phases'] = [];
    let droneCount = 0;
    let publishedEvent: DroneRegistryBroadcastTiming['event'] = 'none';
    try {
      let phaseStartedAt = performance.now();
      const snapshot = await this.deps.buildSnapshot();
      phases.push({ name: 'buildSnapshot', durationMs: performance.now() - phaseStartedAt });
      droneCount = snapshot.drones.length;
      // Publish every completed snapshot even when another refresh arrived while it was being
      // assembled. The pending refresh below will still follow with the newer state. Discarding
      // this snapshot can starve the stream indefinitely when writes arrive faster than snapshot
      // construction, leaving connected clients on an old busy/chat projection forever.
      phaseStartedAt = performance.now();
      const nextById = new Map(
        snapshot.drones
          .map((drone) => [String(drone?.id ?? '').trim(), JSON.stringify(drone)] as const)
          .filter(([id]) => Boolean(id)),
      );

      if (opts?.broadcastSnapshot || !this.lastSnapshot) {
        this.lastSnapshot = snapshot;
        this.snapshotVersion = refreshVersion;
        this.lastPreferenceVersion = snapshot.preferenceVersion;
        this.lastPreferencesSerialized = JSON.stringify(snapshot.uiPreferences ?? {});
        this.lastGroupsSerialized = JSON.stringify(snapshot.groups ?? []);
        this.lastById = nextById;
        phases.push({ name: 'format', durationMs: performance.now() - phaseStartedAt });
        phaseStartedAt = performance.now();
        this.broadcast('snapshot', snapshot);
        phases.push({ name: 'broadcast', durationMs: performance.now() - phaseStartedAt });
        publishedEvent = 'snapshot';
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
      this.snapshotVersion = refreshVersion;
      this.lastPreferenceVersion = snapshot.preferenceVersion;
      this.lastPreferencesSerialized = preferencesSerialized;
      this.lastGroupsSerialized = groupsSerialized;
      this.lastById = nextById;
      phases.push({ name: 'format', durationMs: performance.now() - phaseStartedAt });
      if (upserts.length > 0 || removedIds.length > 0 || preferencesChanged || groupsChanged) {
        phaseStartedAt = performance.now();
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
        phases.push({ name: 'broadcast', durationMs: performance.now() - phaseStartedAt });
        publishedEvent = 'delta';
      }
      return snapshot;
    } catch (error: any) {
      const phaseStartedAt = performance.now();
      this.broadcast('stream-error', { ok: false, error: error?.message ?? String(error) });
      phases.push({ name: 'broadcast', durationMs: performance.now() - phaseStartedAt });
      publishedEvent = 'stream-error';
      return null;
    } finally {
      try {
        this.deps.onTiming?.({
          totalMs: performance.now() - startedAt,
          droneCount,
          event: publishedEvent,
          phases,
        });
      } catch {
        // Diagnostics must not wedge future refreshes.
      }
      this.busy = false;
      if (this.refreshPending) {
        const broadcastSnapshot = this.pendingBroadcastSnapshot;
        this.refreshPending = false;
        this.pendingBroadcastSnapshot = false;
        // Writes can arrive continuously while a large fleet snapshot is being
        // assembled. Preserve the latest requested state, but yield briefly so
        // rebuilds cannot monopolize the Hub event loop.
        this.scheduleRefresh(150, false, broadcastSnapshot);
      }
    }
  }

  schedule(delayMs = 150, restart = false): void {
    this.changeVersion += 1;
    this.scheduleRefresh(delayMs, restart, false);
  }

  private scheduleRefresh(delayMs: number, restart: boolean, broadcastSnapshot: boolean): void {
    this.scheduledBroadcastSnapshot ||= broadcastSnapshot;
    if (!this.hasConsumers || (this.refreshTimeout && !restart)) return;
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    this.refreshTimeout = setTimeout(
      () => {
        this.refreshTimeout = null;
        const shouldBroadcastSnapshot = this.scheduledBroadcastSnapshot;
        this.scheduledBroadcastSnapshot = false;
        void this.refresh(shouldBroadcastSnapshot ? { broadcastSnapshot: true } : undefined);
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
    if (this.hasConsumers) return;
    this.stop();
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.refreshTimer = null;
    this.refreshTimeout = null;
    this.keepAliveTimer = null;
    this.refreshPending = false;
    this.pendingBroadcastSnapshot = false;
    this.scheduledBroadcastSnapshot = false;
    this.clients.clear();
    this.subscribers.clear();
  }
}
