import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SignedCapabilityRequest } from '@drone/device-protocol';
import type { DeviceMeshStore } from './device-mesh-store';
import { WorkspaceHttpTransfers } from './workspace-http-transfers';

/** Broker for phone-produced previews; only a pending authenticated reverse request can allocate one. */
export class DeviceResultUploads {
  private readonly entries = new Map<string, number>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly root: string,
    private readonly store: DeviceMeshStore,
    private readonly transfers: WorkspaceHttpTransfers,
  ) {
    this.timer = setInterval(() => {
      void this.prune().catch(() => undefined);
    }, 60_000);
    this.timer.unref?.();
  }
  private async prune() {
    for (const [file, expires] of this.entries)
      if (expires <= Date.now()) {
        await fs.rm(file, { force: true });
        this.entries.delete(file);
      }
  }
  async prepare(request: SignedCapabilityRequest, size: number, revision: string) {
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > 32 * 1024 * 1024 ||
      !/^sha256:[a-f0-9]{64}$/.test(revision)
    )
      throw new Error('Invalid phone preview metadata');
    if (this.entries.size >= 8) throw new Error('Phone preview transfers are busy');
    const expires = Date.now() + 5 * 60_000;
    const file = path.join(this.root, `preview-${crypto.randomUUID()}`);
    this.entries.set(file, expires);
    let ready = false;
    const active = async () => {
      const state = await this.store.read();
      return (
        Date.now() < expires &&
        [request.sourceDeviceId, request.targetDeviceId].every(
          (id) => state.devices[id] && !state.devices[id].revokedAt,
        )
      );
    };
    try {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      const handle = await fs.open(file, 'wx', 0o600);
      await handle.close();
      return {
        upload: this.transfers.issue({
          source: request.targetDeviceId,
          method: 'PUT',
          size,
          resolve: async () => file,
          authorized: active,
          sha256: revision.slice(7),
          completed: () => {
            ready = true;
          },
        }),
        download: this.transfers.issue({
          source: request.sourceDeviceId,
          method: 'GET',
          size,
          resolve: async () => file,
          authorized: async () => ready && (await active()),
        }),
      };
    } catch (error) {
      this.entries.delete(file);
      await fs.rm(file, { force: true });
      throw error;
    }
  }
  close(): void {
    clearInterval(this.timer); /* Retain any in-flight disk copies across shutdown. */
  }
}
