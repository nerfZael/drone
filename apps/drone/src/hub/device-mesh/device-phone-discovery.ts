import crypto from 'node:crypto';
import { isPrivatePairingIPv4 } from './device-lan-discovery';
import type http from 'node:http';
import {
  PHONE_PAIRING_PORT,
  PHONE_PAIRING_PATH,
  phonePairingSigningText,
  phonePairingCodeText,
  phonePairingCode,
  validPhonePairingWindow,
  readBoundedHttpText,
  type PhonePairingPresence,
  type PhonePairingOffer,
} from '@drone/device-protocol';
import { DeviceMeshIngress } from './device-mesh-ingress';
import { DeviceMeshStore } from './device-mesh-store';
import {
  deviceIdForPublicKey,
  signDeviceText,
  verifyDeviceText,
  type LocalDeviceIdentity,
} from './device-identity';
import {
  deviceMeshJson,
  readDeviceMeshBody,
  type DeviceMeshHttpExtension,
} from './device-mesh-http';

export function isTailscalePairingIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  return (
    /^\d+\.\d+\.\d+\.\d+$/.test(ip) &&
    parts.join('.') === ip &&
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    parts[0] === 100 &&
    parts[1] >= 64 &&
    parts[1] <= 127
  );
}

export function verifyPhonePresence(input: any): PhonePairingPresence {
  const { signature, ...presence } = input;
  if (
    presence.type !== 'dronehub.phone.presence' ||
    presence.version !== 1 ||
    !/^[a-zA-Z0-9_-]{20,128}$/.test(presence.session) ||
    !validPhonePairingWindow(presence.expiresAt) ||
    typeof presence.device?.name !== 'string' ||
    presence.device.name.length > 80 ||
    deviceIdForPublicKey(presence.device.publicKey) !== presence.device.id ||
    !verifyDeviceText(presence.device.publicKey, phonePairingSigningText(presence), signature)
  )
    throw new Error('Invalid phone discovery proof');
  return presence;
}

/** Local-admin-only discovery. Offers target recently verified Tailscale or advertised LAN peers. */
export class DevicePhoneDiscovery implements DeviceMeshHttpExtension {
  private readonly phones = new Map<
    string,
    { presence: PhonePairingPresence; address: string; offer?: PhonePairingOffer }
  >();
  private readonly scans = new Map<boolean, Promise<unknown[]>>();
  constructor(
    private readonly ingress: DeviceMeshIngress,
    private readonly store: DeviceMeshStore,
    private readonly identity: LocalDeviceIdentity,
    private readonly fetcher: typeof fetch = fetch,
    private readonly lanPeers: () => { name: string; ips: string[] }[] = () => [],
  ) {}

  async scan(lanOnly = false): Promise<unknown[]> {
    const existing = this.scans.get(lanOnly);
    if (existing) return existing;
    const scanning = this.discover(lanOnly);
    this.scans.set(lanOnly, scanning);
    try {
      return await scanning;
    } finally {
      this.scans.delete(lanOnly);
    }
  }

  private async discover(lanOnly: boolean): Promise<unknown[]> {
    const status = lanOnly
      ? { connected: true, peers: [], error: undefined }
      : await this.ingress.refreshTailscale();
    const local = this.lanPeers()
      .slice(0, 100)
      .map((peer) => ({ ...peer, ips: peer.ips.filter(isPrivatePairingIPv4) }));
    if (!status.connected && !local.length)
      throw new Error(status.error ?? 'Connect Tailscale first');
    const peers = [
      ...local,
      ...status.peers
        .filter((peer) => peer.online)
        .slice(0, 500)
        .map((peer) => ({ ...peer, ips: peer.ips.filter(isTailscalePairingIPv4) })),
    ];
    const found: unknown[] = [];
    for (const [id, phone] of this.phones)
      if (!validPhonePairingWindow(phone.presence.expiresAt)) this.phones.delete(id);
    const foundIds = new Set<string>();
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, peers.length) }, async () => {
        while (cursor < peers.length) {
          const peer = peers[cursor++];
          const ip = peer.ips[0];
          if (!ip) continue;
          const address = `http://${ip}:${PHONE_PAIRING_PORT}`;
          try {
            const response = await this.fetcher(`${address}${PHONE_PAIRING_PATH}`, {
              redirect: 'error',
              signal: AbortSignal.timeout(1000),
            });
            if (!response.ok) {
              await response.body?.cancel();
              continue;
            }
            const presence = verifyPhonePresence(
              JSON.parse(await readBoundedHttpText(response, 8192)),
            );
            if ((await this.store.read()).devices[presence.device.id]?.revokedAt) continue;
            if (foundIds.has(presence.device.id)) continue;
            const old = this.phones.get(presence.device.id);
            if (
              old &&
              old.presence.session !== presence.session &&
              Date.parse(old.presence.expiresAt) > Date.parse(presence.expiresAt)
            )
              continue;
            foundIds.add(presence.device.id);
            // Keep the same object while an offer is awaiting its authorization read.
            // Replacing it would lose the cached code on a concurrent rescan.
            this.phones.set(
              presence.device.id,
              old?.presence.session === presence.session
                ? Object.assign(old, { presence, address })
                : { presence, address },
            );
            found.push({
              deviceId: presence.device.id,
              name: presence.device.name,
              machineName: peer.name,
              expiresAt: presence.expiresAt,
            });
          } catch {
            /* Offline peers and closed pairing windows are normal. */
          }
        }
      }),
    );
    return found;
  }

  async offer(deviceId: string) {
    const phone = this.phones.get(deviceId);
    if (!phone || !validPhonePairingWindow(phone.presence.expiresAt))
      throw new Error('Phone discovery expired. Make the phone discoverable and scan again.');
    const endpoint = this.ingress.status().publicEndpoint;
    if (!endpoint || !endpoint.startsWith('https://'))
      throw new Error('Enable this Hub’s Tailscale HTTPS access before pairing a phone.');
    const state = await this.store.read();
    if (!state.devices[this.identity.id]?.administrator)
      throw new Error('This Hub cannot enroll devices');
    if (state.devices[deviceId]?.revokedAt) throw new Error('This phone has been revoked');
    const self = state.devices[this.identity.id];
    const offer: PhonePairingOffer = phone.offer ?? {
      type: 'dronehub.phone.offer',
      version: 1,
      session: phone.presence.session,
      phoneDeviceId: deviceId,
      hub: { id: self.id, name: self.name, platform: self.platform, publicKey: self.publicKey },
      endpoint,
      nonce: crypto.randomBytes(24).toString('base64url'),
      expiresAt: phone.presence.expiresAt,
    };
    // Retrying a lost response must display the same code already shown on the phone.
    phone.offer = offer;
    const response = await this.fetcher(`${phone.address}/offer`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...offer,
        signature: signDeviceText(this.identity, phonePairingSigningText(offer)),
      }),
    });
    await response.body?.cancel();
    if (!response.ok)
      throw new Error(
        'Phone did not accept the pairing offer. Reopen Add device → Nearby and retry.',
      );
    return {
      code: phonePairingCode(
        crypto.createHash('sha256').update(phonePairingCodeText(offer)).digest('hex'),
      ),
      phoneName: phone.presence.device.name,
      expiresAt: offer.expiresAt,
    };
  }

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname !== '/api/device-mesh/phones') return false;
    if (request.method === 'GET')
      deviceMeshJson(response, 200, {
        ok: true,
        phones: await this.scan(url.searchParams.get('network') === 'lan'),
      });
    else if (request.method === 'POST') {
      const body = await readDeviceMeshBody(request);
      deviceMeshJson(response, 200, { ok: true, ...(await this.offer(String(body.deviceId))) });
    } else deviceMeshJson(response, 405, { ok: false, error: 'Method not allowed' });
    return true;
  }
}
