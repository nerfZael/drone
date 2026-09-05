import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { Bonjour } from 'bonjour-service';
import type Service from 'bonjour-service/dist/lib/service';
import type Browser from 'bonjour-service/dist/lib/browser';
import {
  deviceMeshJson,
  readDeviceMeshBody,
  type DeviceMeshHttpExtension,
} from './device-mesh-http';

function createNetwork(onError: (error: Error) => void): InstanceType<typeof Bonjour> {
  const network = new Bonjour(undefined, onError);
  // bonjour-service 1.4.0 forwards response errors, but not multicast socket errors.
  // Attach before the asynchronous bind completes so a denied UDP port cannot crash the Hub.
  const mdns = (network as unknown as { server: { mdns: EventEmitter } }).server.mdns;
  mdns.on('error', onError);
  return network;
}

export function isPrivatePairingIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  return (
    p.length === 4 &&
    p.join('.') === ip &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (p[0] === 10 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254))
  );
}

/** Only public bootstrap hints. Local-admin UI leases bound multicast activity to Pairing. */
export class DeviceLanDiscovery implements DeviceMeshHttpExtension {
  private bonjour: InstanceType<typeof Bonjour> | null = null;
  private browser: Browser | null = null;
  private service: Service | null = null;
  private endpoint = '';
  private error = '';
  private retryAfter = 0;
  private readonly leases = new Map<string, number>();
  private readonly phones = new Map<string, { name: string; ips: string[] }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly identity: { id: string; name: string },
    private readonly getEndpoint: () => string | null,
    private readonly createBonjour: (
      onError: (error: Error) => void,
    ) => InstanceType<typeof Bonjour> = createNetwork,
  ) {}

  phonePeers() {
    return [...this.phones.values()];
  }

  private stopNetwork() {
    const old = this.bonjour;
    this.bonjour = null;
    this.browser?.stop();
    this.browser = null;
    this.service = null;
    this.endpoint = '';
    this.phones.clear();
    if (old) {
      let destroyed = false;
      const destroy = () => {
        if (!destroyed) {
          destroyed = true;
          old.destroy();
        }
      };
      const timeout = setTimeout(destroy, 1000);
      timeout.unref?.();
      old.unpublishAll(() => {
        clearTimeout(timeout);
        destroy();
      });
    }
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.leases.clear();
    this.stopNetwork();
  }

  renew(lease: string, enabled: boolean) {
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(lease)) throw new Error('Invalid discovery lease');
    const now = Date.now();
    for (const [key, expiry] of this.leases) if (expiry <= now) this.leases.delete(key);
    if (enabled) {
      if (!this.leases.has(lease) && this.leases.size >= 16)
        throw new Error('Too many discovery windows');
      this.leases.set(lease, now + 45000);
    } else this.leases.delete(lease);
    this.update();
    if (this.leases.size && !this.timer) {
      this.timer = setInterval(() => {
        for (const [key, expiry] of this.leases) if (expiry <= Date.now()) this.leases.delete(key);
        this.update();
      }, 1000);
      this.timer.unref?.();
    }
    return { active: !!this.service?.published, error: this.error };
  }

  private update() {
    if (!this.leases.size) {
      this.close();
      return;
    }
    if (Date.now() < this.retryAfter) return;
    const endpoint = this.getEndpoint();
    if (endpoint === this.endpoint && this.bonjour) {
      if (this.service && !this.service.activated) {
        this.error = 'Nearby advertisement stopped. Retrying shortly.';
        this.retryAfter = Date.now() + 15000;
        this.stopNetwork();
      }
      return;
    }
    this.stopNetwork();
    this.error = '';
    try {
      if (!endpoint) throw new Error('Enable Tailscale HTTPS access to advertise this Hub nearby.');
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.origin !== endpoint || endpoint.length > 240)
        throw new Error('Nearby discovery needs a valid HTTPS Hub origin.');
      const network = this.createBonjour((error) => {
        if (this.bonjour !== network) return;
        this.error = `Local-network discovery unavailable: ${error.message}`;
        this.retryAfter = Date.now() + 15000;
        this.stopNetwork();
      });
      this.bonjour = network;
      this.endpoint = endpoint;
      const browser = network.find({ type: 'dronehub', protocol: 'tcp' });
      this.browser = browser;
      browser.on('up', (service: Service) => {
        if (
          this.bonjour !== network ||
          service.txt?.kind !== 'phone' ||
          service.txt?.v !== '1' ||
          service.port !== 8792
        )
          return;
        const ips = (service.addresses ?? []).filter(isPrivatePairingIPv4).slice(0, 4);
        if (ips.length && this.phones.size < 100)
          this.phones.set(service.fqdn, { name: service.name.slice(0, 80), ips });
      });
      browser.on('down', (service: Service) => {
        if (this.bonjour === network) this.phones.delete(service.fqdn);
      });
      this.service = network.publish({
        // A fresh instance name avoids stale-cache conflicts after a quick Stop/Start.
        name: `DroneHub-${this.identity.id.slice(0, 16)}-${randomBytes(4).toString('hex')}`,
        type: 'dronehub',
        protocol: 'tcp',
        port: Number(url.port || 443),
        txt: {
          v: '1',
          kind: 'hub',
          id: this.identity.id,
          name: this.identity.name.slice(0, 60),
          endpoint,
        },
      });
      this.service.on('error', (error: Error) => {
        if (this.bonjour !== network) return;
        this.error = `Local-network discovery unavailable: ${error.message}`;
        this.retryAfter = Date.now() + 15000;
        this.stopNetwork();
      });
    } catch (error: any) {
      this.error = error?.message ?? String(error);
      this.retryAfter = Date.now() + 15000;
      this.stopNetwork();
    }
  }

  async handle(request: http.IncomingMessage, response: http.ServerResponse, url: URL) {
    if (url.pathname !== '/api/device-mesh/lan-discovery') return false;
    if (request.method !== 'POST') deviceMeshJson(response, 405, { error: 'Method not allowed' });
    else {
      const body = await readDeviceMeshBody(request);
      if (typeof body.enabled !== 'boolean') throw new Error('Expected discovery enabled flag');
      deviceMeshJson(response, 200, this.renew(String(body.lease), body.enabled));
    }
    return true;
  }
}
