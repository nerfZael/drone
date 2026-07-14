import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MeshDevice } from '@drone/device-protocol';
import type { LocalDeviceIdentity } from './device-identity';
import type { DeviceMeshState } from './device-mesh-types';

function now(): string {
  return new Date().toISOString();
}

export class DeviceMeshStore {
  private state: DeviceMeshState | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly statePath: string,
    private readonly identity: LocalDeviceIdentity,
  ) {}

  async read(): Promise<DeviceMeshState> {
    if (this.state) return this.state;
    try {
      this.state = JSON.parse(await fs.readFile(this.statePath, 'utf8')) as DeviceMeshState;
      this.state.routes ??= {};
      if (this.state.selfDeviceId !== this.identity.id || !this.state.devices[this.identity.id]) {
        throw new Error(
          'device mesh identity does not match its state; restore the original identity or remove the device-mesh data directory',
        );
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const at = now();
      const self: MeshDevice = {
        id: this.identity.id,
        name: this.identity.name,
        platform: this.identity.platform,
        publicKey: this.identity.publicKey,
        administrator: true,
        grants: [],
        endpoints: [],
        revokedAt: null,
        addedAt: at,
        updatedAt: at,
      };
      this.state = {
        version: 1,
        networkId: `network_${crypto.randomBytes(18).toString('base64url')}`,
        selfDeviceId: self.id,
        devices: { [self.id]: self },
        invitations: {},
        pending: {},
        routes: {},
      };
      await this.persist();
    }
    return this.state;
  }

  async update<T>(change: (state: DeviceMeshState) => T | Promise<T>): Promise<T> {
    const state = await this.read();
    const result = await change(state);
    await this.persist();
    return result;
  }

  async upsertDiscoveredDevice(device: MeshDevice): Promise<boolean> {
    return await this.update((state) => {
      const current = state.devices[device.id];
      if (
        current?.revokedAt ||
        (current && Date.parse(current.updatedAt) >= Date.parse(device.updatedAt))
      )
        return false;
      const signedRoute = state.routes[device.id];
      state.devices[device.id] = current
        ? {
            ...device,
            grants: current.grants,
            endpoints: signedRoute ? current.endpoints : device.endpoints,
          }
        : { ...device, grants: [] };
      return true;
    });
  }

  private async persist(): Promise<void> {
    const state = this.state;
    if (!state) return;
    this.writes = this.writes.then(async () => {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      const tempPath = `${this.statePath}.${process.pid}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tempPath, this.statePath);
    });
    await this.writes;
  }
}
