import { routeAnnouncementSigningText, type SignedRouteAnnouncement } from '@drone/device-protocol';
import { signDeviceText, type LocalDeviceIdentity, verifyDeviceText } from './device-identity';
import { DeviceMeshStore } from './device-mesh-store';

const ROUTE_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const ROUTE_CLOCK_SKEW_MS = 30_000;

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, '');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('public endpoint must use HTTPS');
  }
  return endpoint;
}

export class DeviceRouteManager {
  constructor(
    private readonly identity: LocalDeviceIdentity,
    private readonly store: DeviceMeshStore,
  ) {}

  async announce(endpoint: string | null): Promise<SignedRouteAnnouncement> {
    const route = await this.store.update((state) => {
      const previous = state.routes[state.selfDeviceId];
      const announcedAt = new Date();
      const unsigned: Omit<SignedRouteAnnouncement, 'signature'> = {
        type: 'mesh.route',
        version: 1,
        deviceId: state.selfDeviceId,
        sequence: (previous?.sequence ?? 0) + 1,
        endpoint: endpoint ? normalizeEndpoint(endpoint) : null,
        announcedAt: announcedAt.toISOString(),
        expiresAt: new Date(announcedAt.getTime() + ROUTE_LIFETIME_MS).toISOString(),
      };
      const signed = {
        ...unsigned,
        signature: signDeviceText(this.identity, routeAnnouncementSigningText(unsigned)),
      };
      state.routes[state.selfDeviceId] = signed;
      state.devices[state.selfDeviceId].endpoints = signed.endpoint ? [signed.endpoint] : [];
      state.devices[state.selfDeviceId].updatedAt = signed.announcedAt;
      return signed;
    });
    return route;
  }

  async accept(value: unknown): Promise<boolean> {
    if (!value || typeof value !== 'object') return false;
    const input = value as Record<string, unknown>;
    const state = await this.store.read();
    const deviceId = String(input.deviceId ?? '');
    const device = state.devices[deviceId];
    if (!device || device.revokedAt || input.type !== 'mesh.route' || input.version !== 1)
      return false;
    const endpoint =
      input.endpoint === null ? null : normalizeEndpoint(String(input.endpoint ?? ''));
    const unsigned: Omit<SignedRouteAnnouncement, 'signature'> = {
      type: 'mesh.route',
      version: 1,
      deviceId,
      sequence: Number(input.sequence),
      endpoint,
      announcedAt: String(input.announcedAt ?? ''),
      expiresAt: String(input.expiresAt ?? ''),
    };
    const announcedAt = Date.parse(unsigned.announcedAt);
    const expiresAt = Date.parse(unsigned.expiresAt);
    if (
      !Number.isSafeInteger(unsigned.sequence) ||
      unsigned.sequence < 1 ||
      !Number.isFinite(announcedAt) ||
      !Number.isFinite(expiresAt) ||
      announcedAt > Date.now() + ROUTE_CLOCK_SKEW_MS ||
      expiresAt <= Date.now() ||
      expiresAt <= announcedAt ||
      expiresAt - announcedAt > ROUTE_LIFETIME_MS ||
      !verifyDeviceText(
        device.publicKey,
        routeAnnouncementSigningText(unsigned),
        String(input.signature ?? ''),
      )
    )
      return false;
    const current = state.routes[deviceId];
    if (current && current.sequence >= unsigned.sequence) return false;
    await this.store.update((next) => {
      const latest = next.routes[deviceId];
      if (latest && latest.sequence >= unsigned.sequence) return;
      next.routes[deviceId] = { ...unsigned, signature: String(input.signature) };
      next.devices[deviceId].endpoints = endpoint ? [endpoint] : [];
      next.devices[deviceId].updatedAt = unsigned.announcedAt;
    });
    return true;
  }

  async list(): Promise<SignedRouteAnnouncement[]> {
    const state = await this.store.read();
    return Object.values(state.routes);
  }
}
