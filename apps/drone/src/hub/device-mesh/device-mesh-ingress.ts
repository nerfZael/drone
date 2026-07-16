import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { deviceMeshJson } from './device-mesh-http';
import {
  detectDeviceMeshNgrokUrl,
  DeviceMeshNgrok,
  type NgrokDetection,
} from './device-mesh-ngrok';

export const DEFAULT_DEVICE_MESH_INGRESS_PORT = 8791;

export type DeviceMeshEndpointSource = 'manual' | 'ngrok' | null;

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
  ngrok: NgrokDetection;
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

type UpgradeHandler = (request: http.IncomingMessage, socket: Duplex, head: Buffer) => boolean;

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
  private readonly ngrok: DeviceMeshNgrok;
  private listener: Listener | null = null;
  private config: DeviceMeshIngressConfig;
  private error: string | null = null;
  private ngrokDetection: NgrokDetection = { url: null, error: null };
  private ngrokTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    rootDir: string,
    defaultPort: number,
    private readonly handlePublicHttp: PublicHttpHandler,
    private readonly handleUpgrade: UpgradeHandler,
    private readonly announceEndpoint: (endpoint: string | null) => Promise<void>,
  ) {
    this.configPath = path.join(rootDir, 'ingress.json');
    this.ngrok = new DeviceMeshNgrok(rootDir);
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
      if (this.config.endpointSource === 'ngrok') {
        this.ngrokDetection = await detectDeviceMeshNgrokUrl(this.listener.port);
        if (this.ngrokDetection.url) await this.applyNgrokEndpoint(this.ngrokDetection.url);
        else await this.recoverManagedNgrok();
      }
      this.error = null;
      await this.announceEndpoint(this.config.publicEndpoint);
    } catch (error: any) {
      this.error = error?.message ?? String(error);
      await this.announceEndpoint(null);
    }
    this.refreshNgrokMonitor();
  }

  status(): DeviceMeshIngressStatus {
    return {
      host: '127.0.0.1',
      port: this.listener?.port ?? this.config.port,
      running: this.listener !== null,
      publicEndpoint: this.config.publicEndpoint,
      endpointSource: this.config.endpointSource,
      error: this.error,
      ngrok: this.ngrokDetection,
    };
  }

  async update(input: {
    port?: unknown;
    publicEndpoint?: unknown;
  }): Promise<DeviceMeshIngressStatus> {
    const stopManagedNgrok = this.config.endpointSource === 'ngrok';
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
    this.ngrokDetection = { url: null, error: null };
    this.refreshNgrokMonitor();
    await this.announceEndpoint(publicEndpoint);
    if (stopManagedNgrok) {
      await this.ngrok.stop().catch((error: any) => {
        this.error = `could not stop the previous ngrok tunnel: ${error?.message ?? String(error)}`;
      });
    }
    return this.status();
  }

  async detectAndUseNgrok(): Promise<DeviceMeshIngressStatus> {
    if (!this.listener) throw new Error('mesh ingress is not running');
    const detection = await detectDeviceMeshNgrokUrl(this.listener.port);
    this.ngrokDetection = detection;
    if (!detection.url)
      throw new Error(detection.error ?? 'no ngrok tunnel was found for this port');
    await this.applyNgrokEndpoint(detection.url);
    return this.status();
  }

  async startNgrok(): Promise<{
    status: DeviceMeshIngressStatus;
    process: Awaited<ReturnType<DeviceMeshNgrok['start']>>;
  }> {
    if (!this.listener) throw new Error('mesh ingress is not running');
    const process = await this.ngrok.start(this.listener.port);
    this.config.publicEndpoint = null;
    this.config.endpointSource = 'ngrok';
    this.config.updatedAt = new Date().toISOString();
    await this.writeConfig();
    await this.announceEndpoint(null);
    this.refreshNgrokMonitor();
    await this.waitForManagedNgrokEndpoint();
    return { status: this.status(), process };
  }

  async close(): Promise<void> {
    if (this.ngrokTimer) clearInterval(this.ngrokTimer);
    this.ngrokTimer = null;
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
      if (!this.handleUpgrade(request, socket, head)) socket.destroy();
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

  private async applyNgrokEndpoint(endpoint: string): Promise<void> {
    this.config.publicEndpoint = normalizeEndpoint(endpoint);
    this.config.endpointSource = 'ngrok';
    this.config.updatedAt = new Date().toISOString();
    await this.writeConfig();
    await this.announceEndpoint(this.config.publicEndpoint);
    this.refreshNgrokMonitor();
  }

  private refreshNgrokMonitor(): void {
    if (this.ngrokTimer) clearInterval(this.ngrokTimer);
    this.ngrokTimer = null;
    if (this.config.endpointSource !== 'ngrok' || !this.listener) return;
    this.ngrokTimer = setInterval(() => {
      void this.refreshNgrokEndpoint().catch((error: any) => {
        this.ngrokDetection = {
          url: null,
          error: error?.message ?? String(error),
        };
      });
    }, 10_000);
    this.ngrokTimer.unref?.();
  }

  private async refreshNgrokEndpoint(): Promise<void> {
    if (!this.listener || this.config.endpointSource !== 'ngrok') return;
    const detection = await detectDeviceMeshNgrokUrl(this.listener.port);
    this.ngrokDetection = detection;
    if (detection.url && detection.url !== this.config.publicEndpoint) {
      await this.applyNgrokEndpoint(detection.url);
      return;
    }
    if (!detection.url) await this.recoverManagedNgrok();
  }

  private async recoverManagedNgrok(): Promise<void> {
    if (!this.listener || this.config.endpointSource !== 'ngrok') return;
    if (this.config.publicEndpoint) {
      this.config.publicEndpoint = null;
      this.config.updatedAt = new Date().toISOString();
      await this.writeConfig();
      await this.announceEndpoint(null);
    }
    try {
      await this.ngrok.start(this.listener.port);
    } catch (error: any) {
      this.ngrokDetection = {
        url: null,
        error: `could not start ngrok: ${error?.message ?? String(error)}`,
      };
      return;
    }
    await this.waitForManagedNgrokEndpoint();
  }

  private async waitForManagedNgrokEndpoint(): Promise<void> {
    if (!this.listener || this.config.endpointSource !== 'ngrok') return;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      const detection = await detectDeviceMeshNgrokUrl(this.listener.port);
      this.ngrokDetection = detection;
      if (!detection.url) continue;
      await this.applyNgrokEndpoint(detection.url);
      return;
    }
    if (!this.ngrokDetection.error) {
      this.ngrokDetection = {
        url: null,
        error: 'ngrok started, but no tunnel URL appeared. Check the mesh ngrok log.',
      };
    }
  }

  private async readConfig(): Promise<DeviceMeshIngressConfig> {
    try {
      const input = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as any;
      if (input?.version !== 1) return this.config;
      const port = normalizePort(input.port);
      const publicEndpoint = normalizeEndpoint(input.publicEndpoint);
      const endpointSource: DeviceMeshEndpointSource =
        input.endpointSource === 'ngrok' ? 'ngrok' : publicEndpoint ? 'manual' : null;
      return {
        version: 1,
        port,
        publicEndpoint,
        endpointSource,
        updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
      };
    } catch {
      return this.config;
    }
  }

  private async writeConfig(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.configPath);
  }
}
