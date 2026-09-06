import crypto from 'node:crypto';
import type http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, createWebSocketStream } from 'ws';
import {
  isGranted,
  type DroneBrowserSession,
  type DroneBrowserTargets,
} from '@drone/device-protocol';
import type { DeviceMeshStore } from './device-mesh-store';
import { localHubRequest, type LocalHubAccess } from './local-hub-request';

const SESSION_MS = 30 * 60_000;
const PREFIX = '/api/device-mesh/v2/browser/';
type Session = {
  id: string;
  source: string;
  droneId: string;
  port: number;
  hostPort: number;
  tokenHash: Buffer;
  expires: number;
  sockets: Set<Duplex>;
  pending: number;
};

function portNumber(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Choose a port between 1 and 65535');
  return port;
}

/** Only the owning device can mint a session. Each tunnel is pinned to one local port. */
export class DeviceBrowserSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly pendingOpens = new Map<string, AbortController>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  private readonly unsubscribe: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private checking = false;
  private closed = false;

  constructor(
    private readonly access: LocalHubAccess,
    private readonly store: DeviceMeshStore,
    private readonly endpoint: () => string | null,
    private readonly ingressPort: () => number,
  ) {
    this.unsubscribe = store.subscribe(() => {
      void this.checkSessions(false);
    });
    this.timer = setInterval(() => {
      void this.checkSessions(true);
    }, 15_000);
    this.timer.unref?.();
  }

  private async authorized(source: string, operation = 'browser.open'): Promise<void> {
    const device = (await this.store.read()).devices[source];
    if (
      this.closed ||
      !device ||
      device.revokedAt ||
      !isGranted(device.grants, 'drone-control', 1, operation)
    )
      throw new Error('Browser access is not permitted for this device');
  }

  private async targets(droneId: string, signal?: AbortSignal) {
    const result = await localHubRequest(
      this.access,
      `/api/drones/${encodeURIComponent(droneId)}/ports`,
      {
        signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]),
      },
    );
    if (result.runtime !== 'host' && result.runtime !== 'container')
      throw new Error('Hub browser targets are unavailable');
    const ports = (Array.isArray(result.ports) ? result.ports : []).map((p: any) => ({
      port: portNumber(p.containerPort),
      hostPort: portNumber(p.hostPort),
    }));
    return { runtime: result.runtime as 'host' | 'container', ports };
  }

  private async resolve(droneId: string, port: number, signal?: AbortSignal): Promise<number> {
    const targets = await this.targets(droneId, signal);
    const hostPort =
      targets.runtime === 'host'
        ? port
        : targets.ports.find((p: { port: number }) => p.port === port)?.hostPort;
    if (!hostPort) throw new Error('This container port is not mapped. Refresh the browser ports.');
    // A browser grant must never become access to the Hub's authenticated control API.
    const hubPort = Number(new URL(this.access.baseUrl()).port || 80);
    if (hostPort === hubPort || hostPort === this.ingressPort())
      throw new Error('The Hub control port cannot be opened in Browser');
    return hostPort;
  }

  async invoke(
    operation: string,
    payload: Record<string, any>,
    source: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    signal?.throwIfAborted();
    if (operation !== 'browser.open') return this.perform(operation, payload, source, signal);
    // Record order before awaiting authorization or Docker, which can complete out of order.
    this.pendingOpens.get(source)?.abort();
    const pending = new AbortController();
    this.pendingOpens.set(source, pending);
    try {
      return await this.perform(
        operation,
        payload,
        source,
        AbortSignal.any([pending.signal, ...(signal ? [signal] : [])]),
      );
    } finally {
      if (this.pendingOpens.get(source) === pending) this.pendingOpens.delete(source);
    }
  }

  private async perform(
    operation: string,
    payload: Record<string, any>,
    source: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    await this.authorized(source, operation);
    signal?.throwIfAborted();
    const droneId = String(payload.droneId ?? '').trim();
    if (!droneId) throw new Error('A drone is required');
    if (operation === 'browser.close') {
      const session = this.sessions.get(String(payload.sessionId));
      if (session?.source === source && session.droneId === droneId) this.remove(session);
      return { ok: true };
    }
    if (operation === 'browser.targets') {
      const targets = await this.targets(droneId, signal);
      signal?.throwIfAborted();
      return {
        droneId,
        runtime: targets.runtime,
        ports: targets.ports.map((p: { port: number }) => ({ port: p.port })),
        manualPort: targets.runtime === 'host',
      } satisfies DroneBrowserTargets;
    }
    if (operation !== 'browser.open') throw new Error('Unknown browser operation');
    const endpoint = this.endpoint();
    if (!endpoint || new URL(endpoint).protocol !== 'https:')
      throw new Error('Enable Tailscale HTTPS access on this Hub to open Browser');
    const port = portNumber(payload.port);
    const hostPort = await this.resolve(droneId, port, signal);
    await this.authorized(source);
    signal?.throwIfAborted();
    for (const session of this.sessions.values()) {
      if (session.source === source || session.expires <= Date.now()) this.remove(session);
    }
    if (this.sessions.size >= 16) throw new Error('Too many active browser sessions');
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + SESSION_MS;
    this.sessions.set(id, {
      id,
      source,
      droneId,
      port,
      hostPort,
      tokenHash: this.hash(token),
      expires,
      sockets: new Set(),
      pending: 0,
    });
    return {
      sessionId: id,
      url: `${endpoint.replace(/^https:/, 'wss:')}${PREFIX}${id}`,
      token,
      expiresAt: new Date(expires).toISOString(),
      upstreamAuthority: `127.0.0.1:${hostPort}`,
    } satisfies DroneBrowserSession;
  }

  async upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on('error', () => socket.destroy());
    const deadline = setTimeout(() => socket.destroy(), 10_000);
    deadline.unref?.();
    let session: Session | undefined;
    let reserved = false;
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (
        request.method !== 'GET' ||
        url.search ||
        !url.pathname.startsWith(PREFIX) ||
        request.headers.origin
      )
        throw new Error('Invalid tunnel');
      session = this.sessions.get(url.pathname.slice(PREFIX.length));
      const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
      if (
        !session ||
        session.expires <= Date.now() ||
        !crypto.timingSafeEqual(this.hash(token), session.tokenHash)
      )
        throw new Error('Expired tunnel');
      if (session.sockets.size + session.pending >= 32)
        throw new Error('Too many browser connections');
      session.pending++;
      reserved = true;
      await this.authorized(session.source);
      if ((await this.resolve(session.droneId, session.port)) !== session.hostPort) {
        this.remove(session);
        throw new Error('Port mapping changed');
      }
      await this.authorized(session.source);
      if (
        this.sessions.get(session.id) !== session ||
        session.expires <= Date.now() ||
        socket.destroyed
      )
        throw new Error('Session closed');
      const current = session;
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        ws.on('message', (_data, binary) => {
          if (!binary) ws.terminate();
        });
        const stream = createWebSocketStream(ws, { highWaterMark: 64 * 1024 });
        const upstream = net.connect({ host: '127.0.0.1', port: current.hostPort });
        current.sockets.add(stream);
        const expiry = setTimeout(
          () => stream.destroy(),
          Math.max(1, current.expires - Date.now()),
        );
        expiry.unref?.();
        const connectTimeout = setTimeout(
          () => upstream.destroy(new Error('Service unavailable')),
          8000,
        );
        connectTimeout.unref?.();
        upstream.once('connect', () => clearTimeout(connectTimeout));
        stream.on('error', () => upstream.destroy());
        upstream.on('error', () => stream.destroy());
        stream.once('close', () => {
          clearTimeout(expiry);
          clearTimeout(connectTimeout);
          current.sockets.delete(stream);
          upstream.destroy();
        });
        upstream.once('close', () => {
          if (!upstream.readableEnded) stream.destroy();
        });
        stream.pipe(upstream).pipe(stream);
      });
    } catch {
      if (!socket.destroyed)
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () =>
          socket.destroy(),
        );
    } finally {
      clearTimeout(deadline);
      if (session && reserved) session.pending--;
    }
  }

  private hash(value: string) {
    return crypto.createHash('sha256').update(value).digest();
  }
  private remove(session: Session) {
    this.sessions.delete(session.id);
    for (const socket of session.sockets) socket.destroy();
  }
  private async checkSessions(checkTargets: boolean) {
    if (checkTargets && this.checking) return;
    if (checkTargets) this.checking = true;
    try {
      for (const session of this.sessions.values()) {
        try {
          if (session.expires <= Date.now()) throw new Error('Expired');
          await this.authorized(session.source);
          if (
            checkTargets &&
            (await this.resolve(session.droneId, session.port)) !== session.hostPort
          )
            throw new Error('Target changed');
        } catch {
          this.remove(session);
        }
      }
    } finally {
      if (checkTargets) this.checking = false;
    }
  }
  close() {
    this.closed = true;
    for (const pending of this.pendingOpens.values()) pending.abort();
    this.pendingOpens.clear();
    this.unsubscribe();
    clearInterval(this.timer);
    for (const session of this.sessions.values()) this.remove(session);
    this.wss.close();
  }
}
