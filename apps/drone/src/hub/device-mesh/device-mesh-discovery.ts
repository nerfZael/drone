import crypto from 'node:crypto';
import type http from 'node:http';
import { canonicalJson, readBoundedHttpText } from '@drone/device-protocol';
import { DeviceMeshIngress } from './device-mesh-ingress';
import { verifyDeviceText, deviceIdForPublicKey } from './device-identity';
import { DeviceRouteManager } from './device-route-manager';
import { DeviceMeshStore } from './device-mesh-store';
import { validDnsName } from './device-mesh-tailscale';
import { deviceMeshJson, type DeviceMeshHttpExtension } from './device-mesh-http';

export class DeviceMeshDiscovery implements DeviceMeshHttpExtension {
  private active: Promise<unknown[]> | null = null;
  private cached: unknown[] = [];
  private refreshedAt = 0;
  constructor(
    private readonly ingress: DeviceMeshIngress,
    private readonly store: DeviceMeshStore,
    private readonly routes: DeviceRouteManager,
  ) {}

  async scan(): Promise<unknown[]> {
    if (this.active) return this.active;
    if (Date.now() - this.refreshedAt < 10_000) return this.cached;
    this.active = this.discover();
    try {
      this.cached = await this.active;
      this.refreshedAt = Date.now();
      return this.cached;
    } finally {
      this.active = null;
    }
  }

  private async discover(): Promise<unknown[]> {
    const status = await this.ingress.refreshTailscale();
    if (!status.connected) throw new Error(status.error ?? 'Tailscale is not connected');
    const peers = status.peers
      .filter((peer) => peer.online && validDnsName(peer.dnsName))
      .slice(0, 500);
    const found: unknown[] = [];
    const state = await this.store.read();
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, peers.length) }, async () => {
        while (cursor < peers.length) {
          const peer = peers[cursor++];
          for (const port of [8791, 443]) {
            const endpoint = `https://${peer.dnsName}${port === 443 ? '' : `:${port}`}`;
            const nonce = crypto.randomBytes(24).toString('base64url');
            try {
              const response = await fetch(`${endpoint}/.well-known/dronehub?nonce=${nonce}`, {
                redirect: 'error',
                signal: AbortSignal.timeout(3_000),
              });
              if (!response.ok) continue;
              const raw = await readBoundedHttpText(response, 16 * 1024);
              const { signature, ...descriptor } = JSON.parse(raw);
              const device = descriptor.device;
              if (
                descriptor.protocol !== 'dronehub-device-mesh' ||
                descriptor.protocolVersion !== 2 ||
                descriptor.nonce !== nonce ||
                descriptor.endpoint !== endpoint ||
                !device?.publicKey ||
                deviceIdForPublicKey(device.publicKey) !== device.id ||
                !verifyDeviceText(device.publicKey, canonicalJson(descriptor), String(signature))
              )
                continue;
              if (state.devices[device.id]?.revokedAt) break;
              if (state.devices[device.id] && descriptor.route)
                await this.routes.accept(descriptor.route);
              found.push({
                deviceId: device.id,
                name: device.name,
                platform: device.platform,
                endpoint,
                paired: Boolean(state.devices[device.id]),
                machineName: peer.name,
              });
              break;
            } catch {
              /* Unreachable and non-DroneHub peers are normal discovery results. */
            }
          }
        }
      }),
    );
    return found;
  }

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (request.method !== 'GET' || url.pathname !== '/api/device-mesh/discovery') return false;
    deviceMeshJson(response, 200, { ok: true, devices: await this.scan() });
    return true;
  }
}
