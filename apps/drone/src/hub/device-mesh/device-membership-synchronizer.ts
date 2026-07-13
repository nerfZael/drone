import { canonicalJson } from '@drone/device-protocol';
import {
  deviceIdForPublicKey,
  signDeviceText,
  type LocalDeviceIdentity,
  verifyDeviceText,
} from './device-identity';
import { DeviceMeshStore } from './device-mesh-store';

export class DeviceMembershipSynchronizer {
  constructor(
    private readonly identity: LocalDeviceIdentity,
    private readonly store: DeviceMeshStore,
  ) {}

  async membershipEvent(): Promise<unknown> {
    const state = await this.store.read();
    const unsigned = {
      type: 'mesh.membership',
      version: 1,
      issuerDeviceId: state.selfDeviceId,
      issuedAt: new Date().toISOString(),
      devices: Object.values(state.devices).map((device) => ({ ...device, grants: [] })),
    };
    return {
      ...unsigned,
      signature: signDeviceText(this.identity, `drone-membership-v1\n${canonicalJson(unsigned)}`),
    };
  }

  async revocationEvent(deviceId: string): Promise<unknown> {
    const state = await this.store.read();
    const unsigned = {
      type: 'mesh.revocation',
      version: 1,
      issuerDeviceId: state.selfDeviceId,
      issuedAt: new Date().toISOString(),
      deviceId,
    };
    return {
      ...unsigned,
      signature: signDeviceText(this.identity, `drone-revocation-v1\n${canonicalJson(unsigned)}`),
    };
  }

  async acceptMembership(event: any): Promise<boolean> {
    const state = await this.store.read();
    const issuer = state.devices[String(event?.issuerDeviceId ?? '')];
    if (!issuer || issuer.revokedAt || !Array.isArray(event?.devices)) return false;
    const { signature, ...unsigned } = event;
    if (
      !verifyDeviceText(
        issuer.publicKey,
        `drone-membership-v1\n${canonicalJson(unsigned)}`,
        String(signature ?? ''),
      )
    )
      return false;
    let changed = false;
    for (const raw of event.devices.slice(0, 200)) {
      if (!issuer.administrator && raw?.id !== issuer.id) continue;
      const publicKey = raw?.publicKey as JsonWebKey;
      if (!publicKey || deviceIdForPublicKey(publicKey) !== raw?.id) continue;
      changed =
        (await this.store.upsertDiscoveredDevice({
          id: raw.id,
          name: String(raw.name ?? raw.id).slice(0, 80),
          platform: ['desktop', 'server', 'android'].includes(raw.platform)
            ? raw.platform
            : 'unknown',
          publicKey,
          administrator: raw.administrator === true,
          grants: [],
          endpoints: Array.isArray(raw.endpoints) ? raw.endpoints.map(String).slice(0, 4) : [],
          revokedAt: null,
          addedAt: String(raw.addedAt ?? new Date().toISOString()),
          updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
        })) || changed;
    }
    return changed;
  }

  async acceptRevocation(event: any): Promise<string | null> {
    const state = await this.store.read();
    const issuer = state.devices[String(event?.issuerDeviceId ?? '')];
    if (!issuer?.administrator || issuer.revokedAt || event?.issuerDeviceId !== issuer.id)
      return null;
    const { signature, ...unsigned } = event;
    if (
      !verifyDeviceText(
        issuer.publicKey,
        `drone-revocation-v1\n${canonicalJson(unsigned)}`,
        String(signature ?? ''),
      )
    )
      return null;
    const deviceId = String(event.deviceId ?? '');
    if (!deviceId || deviceId === state.selfDeviceId || state.devices[deviceId]?.revokedAt)
      return null;
    await this.store.update((current) => {
      const device = current.devices[deviceId];
      if (!device) return;
      device.revokedAt = new Date().toISOString();
      device.grants = [];
      device.updatedAt = device.revokedAt;
    });
    return deviceId;
  }
}
