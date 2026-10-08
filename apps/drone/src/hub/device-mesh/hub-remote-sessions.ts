import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { HUB_REMOTE_CAPABILITY, isGranted, type HubRemoteSession } from '@drone/device-protocol';
import type { DeviceMeshHttpExtension } from './device-mesh-http';
import { deviceMeshJson } from './device-mesh-http-helpers';
import type { DeviceMeshStore } from './device-mesh-store';
import type { CapabilityHandler } from './device-mesh-types';
import type { LocalHubAccess } from './local-hub-request';
import {
  HUB_REMOTE_PORT_UNREACHABLE,
  HUB_REMOTE_SESSION_HEADER,
  HUB_REMOTE_SESSION_INVALID,
  REMOTE_DEVICE_HEADER,
  forwardableHeaders,
  portNumber,
  rejectUpgrade,
  upgradeRequestHead,
} from './hub-remote-http';

export const HUB_REMOTE_PREFIX = '/api/device-mesh/v2/hub/';
const IDLE_MS = 30 * 60_000;
const MAX_LIFETIME_MS = 12 * 60 * 60_000;
const MAX_SESSIONS_PER_SOURCE = 4;
const MAX_SESSIONS = 64;

type Session = {
  id: string;
  source: string;
  tokenHash: Buffer;
  createdAt: number;
  expiresAt: number;
  idleUntil: number;
  active: Set<{ destroy(): void }>;
  /** Refreshed on every admitted request, so a rename shows up without reconnecting. */
  sourceName?: string;
};

type Target =
  | { kind: 'api'; path: string }
  | { kind: 'port'; port: number; path: string };

/** Open streams keep a session alive; only an unused one idles out. */
function expired(session: Session, now: number): boolean {
  return session.expiresAt <= now || (session.active.size === 0 && session.idleUntil <= now);
}

function hash(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

/** `api/...` reaches the Hub API; `port/<n>/...` reaches a loopback service such as a drone preview. */
function parseTarget(rest: string): Target | null {
  if (rest === 'api' || rest.startsWith('api/') || rest.startsWith('api?')) {
    return { kind: 'api', path: `/${rest}` };
  }
  const match = /^port\/(\d{1,5})(\/[^?#]*)?(\?.*)?$/.exec(rest);
  if (!match) return null;
  const port = portNumber(match[1]);
  if (!port) return null;
  return { kind: 'port', port, path: `${match[2] || '/'}${match[3] ?? ''}` };
}

/**
 * Target side of full remote Hub use. A paired device holding the `hub-remote` grant
 * opens a session over the signed mesh, then sends ordinary HTTP and WebSocket
 * requests to this Hub's ingress. Each request is re-authorized and forwarded to the
 * local API with this Hub's own token, which never leaves the machine.
 */
export class HubRemoteSessions implements DeviceMeshHttpExtension {
  private readonly sessions = new Map<string, Session>();
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly access: LocalHubAccess,
    private readonly store: DeviceMeshStore,
    private readonly endpoint: () => string | null,
  ) {
    this.unsubscribe = store.subscribe(() => {
      void this.recheckSessions();
    });
  }

  capability(): CapabilityHandler {
    return {
      descriptor: HUB_REMOTE_CAPABILITY,
      invoke: async (operation, _payload, context) => {
        if (operation !== 'hub.connect') throw new Error('Unknown Hub remote operation');
        return this.open(context.sourceDevice.id);
      },
      revokeDevice: (deviceId) => this.closeSource(deviceId),
      accessChanged: () => this.recheckSessions(),
      close: () => this.close(),
    };
  }

  private async granted(source: string): Promise<boolean> {
    return (await this.grantedDevice(source)) !== null;
  }

  private async grantedDevice(source: string): Promise<{ name: string } | null> {
    if (this.closed) return null;
    const state = await this.store.read();
    const device = state.devices[source];
    return device &&
      !device.revokedAt &&
      source !== state.selfDeviceId &&
      isGranted(device.grants, HUB_REMOTE_CAPABILITY.id, 1, 'hub.connect')
      ? device
      : null;
  }

  private async open(source: string): Promise<HubRemoteSession> {
    if (!(await this.granted(source))) throw new Error('Full Hub access is not permitted for this device');
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Enable Tailscale HTTPS access on this Hub to use it remotely');
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (expired(session, now)) this.remove(session);
    }
    const own = [...this.sessions.values()]
      .filter((session) => session.source === source)
      .sort((left, right) => left.createdAt - right.createdAt);
    while (own.length >= MAX_SESSIONS_PER_SOURCE) this.remove(own.shift()!);
    if (this.sessions.size >= MAX_SESSIONS) throw new Error('Too many remote Hub sessions');
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const session: Session = {
      id,
      source,
      tokenHash: hash(token),
      createdAt: now,
      expiresAt: now + MAX_LIFETIME_MS,
      idleUntil: now + IDLE_MS,
      active: new Set(),
    };
    this.sessions.set(id, session);
    return {
      sessionId: id,
      baseUrl: `${endpoint}${HUB_REMOTE_PREFIX}${id}/`,
      token,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  /** Resolves the session and target of a tunnel request, or explains why it is refused. */
  private async admit(
    request: http.IncomingMessage,
  ): Promise<{ session: Session; target: Target } | { status: number; error: string; invalid?: boolean }> {
    const raw = String(request.url ?? '/');
    if (!raw.startsWith(HUB_REMOTE_PREFIX)) return { status: 404, error: 'not found' };
    const remainder = raw.slice(HUB_REMOTE_PREFIX.length);
    const slash = remainder.indexOf('/');
    const id = slash < 0 ? remainder : remainder.slice(0, slash);
    const session = this.sessions.get(id);
    const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    const now = Date.now();
    if (
      !session ||
      expired(session, now) ||
      !crypto.timingSafeEqual(hash(token), session.tokenHash)
    ) {
      if (session && expired(session, now)) this.remove(session);
      return { status: 401, error: 'Remote Hub session expired', invalid: true };
    }
    const device = await this.grantedDevice(session.source);
    if (!device) {
      this.remove(session);
      return { status: 401, error: 'Full Hub access was revoked', invalid: true };
    }
    session.sourceName = device.name;
    if (this.sessions.get(session.id) !== session) {
      return { status: 401, error: 'Remote Hub session expired', invalid: true };
    }
    const target = slash < 0 ? null : parseTarget(remainder.slice(slash + 1));
    if (!target) return { status: 404, error: 'not found' };
    session.idleUntil = now + IDLE_MS;
    return { session, target };
  }

  private upstreamAddress(target: Target): { host: string; port: number; hostHeader: string } {
    if (target.kind === 'port') {
      return { host: '127.0.0.1', port: target.port, hostHeader: `localhost:${target.port}` };
    }
    const api = new URL(this.access.baseUrl());
    const port = Number(api.port || 80);
    return { host: api.hostname.replace(/^\[|\]$/g, ''), port, hostHeader: api.host };
  }

  private upstreamHeaders(request: http.IncomingMessage, session: Session, target: Target, hostHeader: string) {
    // Browser credentials of the viewer's origin mean nothing to the API; preview services
    // keep their cookies and origin, which the viewer already rewrote to their own address.
    const headers = forwardableHeaders(
      request.headers,
      target.kind === 'api'
        ? ['host', 'authorization', 'cookie', 'origin', 'referer', REMOTE_DEVICE_HEADER]
        : ['host', 'authorization'],
    );
    headers.host = hostHeader;
    if (target.kind === 'api') {
      headers.authorization = `Bearer ${this.access.apiToken}`;
      // Labels work done for the viewer, such as the speech clips it records here.
      if (session.sourceName) headers[REMOTE_DEVICE_HEADER] = encodeURIComponent(session.sourceName);
    }
    return headers;
  }

  async handle(): Promise<boolean> {
    return false;
  }

  async handlePublic(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith(HUB_REMOTE_PREFIX)) return false;
    const admitted = await this.admit(request);
    if ('status' in admitted) {
      if (admitted.invalid) response.setHeader(HUB_REMOTE_SESSION_HEADER, HUB_REMOTE_SESSION_INVALID);
      deviceMeshJson(response, admitted.status, { ok: false, error: admitted.error });
      return true;
    }
    const { session, target } = admitted;
    const address = this.upstreamAddress(target);
    const method = String(request.method ?? 'GET').toUpperCase();
    await new Promise<void>((resolve) => {
      const upstream = http.request({
        host: address.host,
        port: address.port,
        method,
        path: target.path,
        headers: this.upstreamHeaders(request, session, target, address.hostHeader),
      });
      const entry = {
        destroy: () => {
          upstream.destroy();
          response.destroy();
        },
      };
      session.active.add(entry);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        session.active.delete(entry);
        session.idleUntil = Date.now() + IDLE_MS;
        resolve();
      };
      response.once('close', () => {
        if (!response.writableFinished) upstream.destroy();
        finish();
      });
      upstream.once('response', (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          forwardableHeaders(upstreamResponse.headers),
        );
        // Event streams must reach the viewer as each event is written.
        response.flushHeaders();
        upstreamResponse.pipe(response);
        upstreamResponse.once('error', () => response.destroy());
      });
      upstream.once('error', (error) => {
        if (!response.headersSent) {
          if (target.kind === 'port') response.setHeader(HUB_REMOTE_SESSION_HEADER, HUB_REMOTE_PORT_UNREACHABLE);
          deviceMeshJson(response, 502, {
            ok: false,
            error:
              target.kind === 'port'
                ? `Nothing is answering on port ${target.port}`
                : `Hub API is unavailable: ${error.message}`,
          });
        } else response.destroy();
        finish();
      });
      if (method === 'GET' || method === 'HEAD') upstream.end();
      else request.pipe(upstream);
    });
    return true;
  }

  async upgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on('error', () => socket.destroy());
    const admitted = await this.admit(request);
    if ('status' in admitted) {
      rejectUpgrade(socket, admitted.status, admitted.status === 401 ? 'Unauthorized' : 'Not Found');
      return;
    }
    const { session, target } = admitted;
    const address = this.upstreamAddress(target);
    const headers = this.upstreamHeaders(request, session, target, address.hostHeader);
    headers.connection = 'Upgrade';
    headers.upgrade = String(request.headers.upgrade ?? 'websocket');
    const upstream = net.connect({ host: address.host, port: address.port });
    const entry = {
      destroy: () => {
        upstream.destroy();
        socket.destroy();
      },
    };
    session.active.add(entry);
    const release = () => {
      if (session.active.delete(entry)) session.idleUntil = Date.now() + IDLE_MS;
    };
    upstream.once('connect', () => {
      upstream.write(upgradeRequestHead(String(request.method ?? 'GET'), target.path, headers));
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    upstream.once('close', () => {
      release();
      socket.destroy();
    });
    socket.once('close', () => {
      release();
      upstream.destroy();
    });
  }

  private remove(session: Session): void {
    this.sessions.delete(session.id);
    for (const entry of [...session.active]) entry.destroy();
    session.active.clear();
  }

  private closeSource(source: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.source === source) this.remove(session);
    }
  }

  private async recheckSessions(): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      try {
        if (!(await this.granted(session.source))) this.remove(session);
      } catch {
        this.remove(session);
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    for (const session of [...this.sessions.values()]) this.remove(session);
  }
}
