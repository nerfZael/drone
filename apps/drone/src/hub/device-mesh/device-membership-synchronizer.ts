import { canonicalJson } from '@drone/device-protocol';
import {
  deviceIdForPublicKey,
  signDeviceText,
  type LocalDeviceIdentity,
  verifyDeviceText,
} from './device-identity';
import { DeviceMeshStore } from './device-mesh-store';

function safeEndpoint(value: unknown): string | null {
  try {
    const endpoint = String(value ?? '')
      .trim()
      .replace(/\/+$/, '');
    const url = new URL(endpoint);
    const loopbackHttp =
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopbackHttp) return null;
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== '/')
    )
      return null;
    return endpoint;
  } catch {
    return null;
  }
}

function safeUpdatedAt(value: unknown): string | null {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) && parsed <= Date.now() + 30_000
    ? new Date(parsed).toISOString()
    : null;
}

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
      const updatedAt = safeUpdatedAt(raw.updatedAt);
      if (!updatedAt) continue;
      const current = state.devices[raw.id];
      changed =
        (await this.store.upsertDiscoveredDevice({
          id: raw.id,
          name: String(raw.name ?? raw.id).slice(0, 80),
          platform: ['desktop', 'server', 'android'].includes(raw.platform)
            ? raw.platform
            : 'unknown',
          publicKey,
          administrator: issuer.administrator
            ? raw.administrator === true
            : current?.administrator === true,
          grants: [],
          endpoints: Array.isArray(raw.endpoints)
            ? raw.endpoints
                .map(safeEndpoint)
                .filter((item: string | null): item is string => Boolean(item))
                .slice(0, 4)
            : [],
          revokedAt: null,
          addedAt: String(raw.addedAt ?? new Date().toISOString()),
          updatedAt,
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
