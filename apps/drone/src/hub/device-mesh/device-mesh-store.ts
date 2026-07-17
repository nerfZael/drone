import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityGrant, MeshDevice } from '@drone/device-protocol';
import type { LocalDeviceIdentity } from './device-identity';
import type { DeviceMeshState } from './device-mesh-types';

function now(): string {
  return new Date().toISOString();
}

const TERMINAL_PAIRING_RETENTION_MS = 10 * 60_000;
const PENDING_PAIRING_RETENTION_MS = 60 * 60_000;
const EXPIRED_INVITATION_RETENTION_MS = 10 * 60_000;

export function migrateLegacyNativeChatGrants(
  grants: readonly CapabilityGrant[],
): CapabilityGrant[] {
  const legacy = grants.find(
    (grant) => grant.capability === 'assistant-threads' && grant.version === 1,
  );
  const operations = [
    ...(legacy?.operations.includes('approval.resolve') ? ['chat.approval.resolve'] : []),
    ...(legacy?.operations.includes('thread.message.delete') ? ['chat.message.delete'] : []),
  ];
  if (operations.length === 0) return grants.slice();

  const next = grants.map((grant) => ({ ...grant, operations: [...grant.operations] }));
  const droneControl = next.find(
    (grant) => grant.capability === 'drone-control' && grant.version === 1,
  );
  if (!droneControl) {
    next.push({ capability: 'drone-control', version: 1, operations });
    return next;
  }
  droneControl.operations = [...new Set([...droneControl.operations, ...operations])];
  return next;
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
      this.state.invitations ??= {};
      this.state.pending ??= {};
      for (const pending of Object.values(this.state.pending)) pending.resolvedAt ??= null;
      let grantsMigrated = false;
      for (const device of Object.values(this.state.devices)) {
        const grants = migrateLegacyNativeChatGrants(device.grants);
        if (JSON.stringify(grants) === JSON.stringify(device.grants)) continue;
        device.grants = grants;
        grantsMigrated = true;
      }
      if (this.state.selfDeviceId !== this.identity.id || !this.state.devices[this.identity.id]) {
        throw new Error(
          'device mesh identity does not match its state; restore the original identity or remove the device-mesh data directory',
        );
      }
      if (grantsMigrated) await this.persist();
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

  async prunePairingState(at = Date.now()): Promise<boolean> {
    const state = await this.read();
    let changed = false;
    for (const [id, pending] of Object.entries(state.pending)) {
      const invitation = state.invitations[pending.invitationId];
      const requestedAt = Date.parse(pending.requestedAt);
      const resolvedAt = Date.parse(
        pending.resolvedAt ?? pending.rejectedAt ?? pending.requestedAt,
      );
      const terminal = Boolean(pending.approval || pending.rejectedAt);
      const stale =
        !invitation ||
        (terminal
          ? !Number.isFinite(resolvedAt) || at - resolvedAt > TERMINAL_PAIRING_RETENTION_MS
          : !Number.isFinite(requestedAt) || at - requestedAt > PENDING_PAIRING_RETENTION_MS);
      if (!stale) continue;
      delete state.pending[id];
      changed = true;
    }
    const referencedInvitations = new Set(
      Object.values(state.pending).map((pending) => pending.invitationId),
    );
    for (const [id, invitation] of Object.entries(state.invitations)) {
      if (referencedInvitations.has(id)) continue;
      const expiresAt = Date.parse(invitation.expiresAt);
      if (Number.isFinite(expiresAt) && at - expiresAt <= EXPIRED_INVITATION_RETENTION_MS) continue;
      delete state.invitations[id];
      changed = true;
    }
    if (changed) await this.persist();
    return changed;
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
