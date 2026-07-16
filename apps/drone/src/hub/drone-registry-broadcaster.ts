import type { ServerResponse } from 'node:http';

export type DroneRegistrySnapshot = { ok: true; drones: any[] };

export class DroneRegistryBroadcaster {
  readonly clients = new Set<ServerResponse>();

  private lastById = new Map<string, string>();
  private lastSnapshot: DroneRegistrySnapshot | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

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
    if (this.busy) return this.lastSnapshot;
    this.busy = true;
    try {
      const snapshot = await this.deps.buildSnapshot();
      const nextById = new Map(
        snapshot.drones
          .map((drone) => [String(drone?.id ?? '').trim(), JSON.stringify(drone)] as const)
          .filter(([id]) => Boolean(id)),
      );

      if (opts?.broadcastSnapshot || !this.lastSnapshot) {
        this.lastSnapshot = snapshot;
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

      this.lastSnapshot = snapshot;
      this.lastById = nextById;
      if (upserts.length > 0 || removedIds.length > 0) {
        this.broadcast('delta', {
          ok: true,
          upserts,
          removedIds,
          order: snapshot.drones.map((drone) => String(drone?.id ?? '').trim()).filter(Boolean),
        });
      }
      return snapshot;
    } catch (error: any) {
      this.broadcast('stream-error', { ok: false, error: error?.message ?? String(error) });
      return null;
    } finally {
      this.busy = false;
    }
  }

  schedule(delayMs = 150): void {
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
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.refreshTimer = null;
    this.refreshTimeout = null;
    this.keepAliveTimer = null;
    this.busy = false;
  }
}
