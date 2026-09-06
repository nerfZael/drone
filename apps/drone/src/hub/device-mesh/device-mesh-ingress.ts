import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import { deviceMeshJson } from './device-mesh-http';
import { DeviceMeshTailscale, type TailscaleStatus } from './device-mesh-tailscale';

export const DEFAULT_DEVICE_MESH_INGRESS_PORT = 8791;

export type DeviceMeshEndpointSource = 'manual' | 'tailscale' | null;

type DeviceMeshIngressConfig = {
  version: 1;
  port: number;
  publicEndpoint: string | null;
  endpointSource: DeviceMeshEndpointSource;
  updatedAt: string;
};

export type DeviceMeshIngressStatus = {
  host: '127.0.0.1';
  port: number;
  running: boolean;
  publicEndpoint: string | null;
  endpointSource: DeviceMeshEndpointSource;
  error: string | null;
  tailscale: TailscaleStatus;
};

type Listener = {
  server: http.Server;
  sockets: Set<Socket>;
  port: number;
};

type PublicHttpHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean>;

function normalizePort(value: unknown, allowZero = false): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < (allowZero ? 0 : 1) || port > 65535) {
    throw new Error('mesh ingress port must be between 1 and 65535');
  }
  return port;
}

function normalizeEndpoint(value: unknown): string | null {
  const input = String(value ?? '').trim();
  if (!input) return null;
  const endpoint = new URL(input);
  const loopbackHttp =
    endpoint.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('public mesh endpoint must use HTTPS');
  }
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname && endpoint.pathname !== '/')
  ) {
    throw new Error('public mesh endpoint must be an origin without credentials or a path');
  }
  endpoint.hash = '';
  endpoint.search = '';
  return endpoint.toString().replace(/\/+$/, '');
}

async function closeListener(listener: Listener | null): Promise<void> {
  if (!listener) return;
  for (const socket of listener.sockets) socket.destroy();
  await new Promise<void>((resolve) => listener.server.close(() => resolve()));
}

export class DeviceMeshIngress {
  private readonly configPath: string;
  private readonly tailscale = new DeviceMeshTailscale();
  private listener: Listener | null = null;
  private config: DeviceMeshIngressConfig;
  private error: string | null = null;
  private tailscaleStatus: TailscaleStatus = {
    connected: false,
    dnsName: '',
    peers: [],
    error: null,
  };
  private lastAnnouncement = 0;

  constructor(
    rootDir: string,
    defaultPort: number,
    private readonly handlePublicHttp: PublicHttpHandler,
    private readonly announceEndpoint: (endpoint: string | null) => Promise<void>,
    private readonly handleBrowserUpgrade?: (request: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => Promise<void>,
  ) {
    this.configPath = path.join(rootDir, 'ingress.json');
    this.config = {
      version: 1,
      port: normalizePort(defaultPort, true),
      publicEndpoint: null,
      endpointSource: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async start(): Promise<void> {
    this.config = await this.readConfig();
    try {
      this.listener = await this.createListener(this.config.port);
      if (this.config.port === 0) {
        this.config.port = this.listener.port;
        await this.writeConfig();
      }
      this.tailscaleStatus = await this.tailscale.status();
      this.error = null;
      await this.announceEndpoint(this.config.publicEndpoint);
      this.lastAnnouncement = Date.now();
    } catch (error: any) {
      this.error = error?.message ?? String(error);
      await this.announceEndpoint(null);
    }
  }

  status(): DeviceMeshIngressStatus {
    return {
      host: '127.0.0.1',
      port: this.listener?.port ?? this.config.port,
      running: this.listener !== null,
      publicEndpoint: this.config.publicEndpoint,
      endpointSource: this.config.endpointSource,
      error: this.error,
      tailscale: this.tailscaleStatus,
    };
  }

  async update(input: {
    port?: unknown;
    publicEndpoint?: unknown;
  }): Promise<DeviceMeshIngressStatus> {
    const port = normalizePort(input.port ?? this.config.port);
    const publicEndpoint = normalizeEndpoint(input.publicEndpoint);
    await this.ensureListener(port);
    this.config = {
      version: 1,
      port,
      publicEndpoint,
      endpointSource: publicEndpoint ? 'manual' : null,
      updatedAt: new Date().toISOString(),
    };
    await this.writeConfig();
    this.error = null;
    await this.announceEndpoint(publicEndpoint);
    return this.status();
  }

  async enableTailscale(): Promise<DeviceMeshIngressStatus> {
    if (!this.listener) throw new Error('Mesh ingress is not running');
    const endpoint = await this.tailscale.enable(this.listener.port);
    await this.update({ publicEndpoint: endpoint });
    this.config.endpointSource = 'tailscale';
    await this.writeConfig();
    this.tailscaleStatus = await this.tailscale.status();
    return this.status();
  }

  async refreshTailscale(): Promise<TailscaleStatus> {
    this.tailscaleStatus = await this.tailscale.status();
    if (
      this.config.endpointSource === 'tailscale' &&
      this.listener &&
      this.tailscaleStatus.connected
    ) {
      const previous = this.config.publicEndpoint ? new URL(this.config.publicEndpoint) : null;
      if (!previous || previous.hostname !== this.tailscaleStatus.dnsName) {
        const endpoint = await this.tailscale.enable(
          this.listener.port,
          Number(previous?.port || 8791),
        );
        this.config = {
          ...this.config,
          publicEndpoint: endpoint,
          updatedAt: new Date().toISOString(),
        };
        await this.writeConfig();
        await this.announceEndpoint(endpoint);
        this.lastAnnouncement = Date.now();
      }
    }
    if (Date.now() - this.lastAnnouncement > 24 * 60 * 60_000) {
      await this.announceEndpoint(this.config.publicEndpoint);
      this.lastAnnouncement = Date.now();
    }
    return this.tailscaleStatus;
  }

  async close(): Promise<void> {
    const listener = this.listener;
    this.listener = null;
    await closeListener(listener);
  }

  private async ensureListener(port: number): Promise<void> {
    if (this.listener?.port === port) return;
    const replacement = await this.createListener(port);
    const previous = this.listener;
    this.listener = replacement;
    await closeListener(previous);
  }

  private async createListener(port: number): Promise<Listener> {
    const sockets = new Set<Socket>();
    const server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        if (request.method === 'GET' && url.pathname === '/api/device-mesh/health') {
          deviceMeshJson(response, 200, { ok: true });
          return;
        }
        if (await this.handlePublicHttp(request, response, url)) return;
        deviceMeshJson(response, 404, { ok: false, error: 'not found' });
      } catch (error: any) {
        deviceMeshJson(response, 400, { ok: false, error: error?.message ?? String(error) });
      }
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.on('upgrade', (request, socket, head) => {
      if (this.handleBrowserUpgrade && request.url?.startsWith('/api/device-mesh/v2/browser/')) {
        void this.handleBrowserUpgrade(request, socket, head).catch(() => socket.destroy());
      } else socket.destroy();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });
    } catch (error) {
      for (const socket of sockets) socket.destroy();
      try {
        server.close();
      } catch {
        // The listener may have failed before Node marked the server as running.
      }
      throw error;
    }
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    return { server, sockets, port: actualPort };
  }

  private async readConfig(): Promise<DeviceMeshIngressConfig> {
    try {
      const input = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as any;
      if (input?.version !== 1) throw new Error('Unsupported mesh ingress configuration');
      const port = normalizePort(input.port);
      // Old tunnel addresses are route hints, not identities or user content.
      const publicEndpoint =
        input.endpointSource === 'ngrok' ? null : normalizeEndpoint(input.publicEndpoint);
      const endpointSource: DeviceMeshEndpointSource =
        input.endpointSource === 'tailscale' ? 'tailscale' : publicEndpoint ? 'manual' : null;
      return {
        version: 1,
        port,
        publicEndpoint,
        endpointSource,
        updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return this.config;
      throw error;
    }
  }

  private async writeConfig(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    // Preserve the original persisted configuration before the first update.
    await fs.copyFile(this.configPath, `${this.configPath}.pre-http-v2`, 1).catch((error: any) => {
      if (!['ENOENT', 'EEXIST'].includes(error?.code)) throw error;
    });
    const temporaryPath = `${this.configPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.configPath);
  }
}
