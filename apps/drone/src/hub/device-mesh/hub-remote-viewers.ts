import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { HUB_REMOTE_CAPABILITY, type HubRemoteSession } from '@drone/device-protocol';
import type { DeviceMeshHttpExtension } from './device-mesh-http';
import { deviceMeshJson, readDeviceMeshBody } from './device-mesh-http-helpers';
import type { DeviceMeshStore } from './device-mesh-store';
import {
  HUB_REMOTE_PORT_UNREACHABLE,
  HUB_REMOTE_SESSION_HEADER,
  HUB_REMOTE_SESSION_INVALID,
  forwardableHeaders,
  portNumber,
  rawResponseHead,
  rejectUpgrade,
  upgradeRequestHead,
} from './hub-remote-http';

export const HUB_REMOTE_OPEN_PATH = '/api/device-mesh/remote-hub/open';
const SESSION_REQUEST_TIMEOUT_MS = 15_000;
const SESSION_REFRESH_MARGIN_MS = 5 * 60_000;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const RUNTIME_CONFIG_SCRIPT = /<script>globalThis\.__DRONE_HUB_RUNTIME_CONFIG__=(.*?);<\/script>/s;

type MeshRequest = (
  targetDeviceId: string,
  capability: string,
  operation: string,
  payload: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;

export type HubRemoteRuntime = {
  deviceId: string;
  deviceName: string;
  homeDeviceId: string;
  homeOrigin: string;
};

type Route = { kind: 'ui' } | { kind: 'preview'; port: number };

type SavedViewer = { port: number; homeOrigin: string | null };

export class HubRemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Only the viewer's own UI server may be proxied: a loopback HTTP origin. */
export function loopbackHttpOrigin(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'http:') return null;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function serializeRuntimeConfig(config: unknown): string {
  return JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Replaces the home UI server's runtime configuration with the remote one, keeping its desktop flag. */
export function rewriteRuntimeConfig(
  html: string,
  config: { directApiBase: string; remoteHub: HubRemoteRuntime },
): string {
  let desktop = false;
  const stripped = html.replace(RUNTIME_CONFIG_SCRIPT, (_script, json: string) => {
    try {
      desktop = JSON.parse(json)?.desktop === true;
    } catch {
      desktop = false;
    }
    return '';
  });
  const script = `<script>globalThis.__DRONE_HUB_RUNTIME_CONFIG__=${serializeRuntimeConfig({
    ...config,
    ...(desktop ? { desktop: true } : {}),
  })};</script>`;
  return /<head(?:\s[^>]*)?>/i.test(stripped)
    ? stripped.replace(/<head(?:\s[^>]*)?>/i, (headTag) => `${headTag}${script}`)
    : `${script}${stripped}`;
}

/** `p<port>.localhost:<viewer>` addresses a preview service; plain loopback addresses the UI. */
export function viewerRoute(hostHeader: unknown, viewerPort: number): Route | null {
  const host = String(hostHeader ?? '').trim().toLowerCase();
  if (host === `127.0.0.1:${viewerPort}` || host === `localhost:${viewerPort}`) return { kind: 'ui' };
  const match = /^p(\d{1,5})\.localhost:(\d{1,5})$/.exec(host);
  if (!match || Number(match[2]) !== viewerPort) return null;
  const port = portNumber(match[1]);
  return port ? { kind: 'preview', port } : null;
}

/**
 * The request target with dot segments resolved, as the next server will read it, so
 * routing here and upstream agree. Only origin-form targets are accepted.
 */
function requestPath(rawUrl: unknown): { pathname: string; path: string } | null {
  const raw = String(rawUrl ?? '/');
  if (!raw.startsWith('/')) return null;
  try {
    const url = new URL(`http://viewer${raw}`);
    return { pathname: url.pathname, path: `${url.pathname}${url.search}` };
  } catch {
    return null;
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function previewOrigin(port: number, viewerPort: number): string {
  return `http://p${port}.localhost:${viewerPort}`;
}

/** Location and cookie values a preview service wrote for itself, readdressed to the viewer. */
function rewritePreviewResponseHeaders(
  headers: Record<string, string | string[]>,
  port: number,
  viewerPort: number,
): Record<string, string | string[]> {
  const origin = previewOrigin(port, viewerPort);
  const location = headers.location;
  if (typeof location === 'string') {
    headers.location = location.replace(
      new RegExp(`^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}(?=/|$|\\?|#)`, 'i'),
      origin,
    );
  }
  const cookies = headers['set-cookie'];
  if (cookies) {
    // Host-only cookies stay with this preview origin; a Domain attribute would not match it.
    headers['set-cookie'] = (Array.isArray(cookies) ? cookies : [cookies]).map((cookie) =>
      cookie.replace(/;\s*domain=[^;]*/gi, ''),
    );
  }
  return headers;
}

/** Origin and Referer as the preview service would see them when visited on its own machine. */
function rewritePreviewRequestHeaders(
  headers: Record<string, string | string[]>,
  port: number,
  viewerPort: number,
): void {
  const origin = previewOrigin(port, viewerPort);
  const local = `http://localhost:${port}`;
  for (const name of ['origin', 'referer']) {
    const value = headers[name];
    if (typeof value === 'string' && (value === origin || value.startsWith(`${origin}/`))) {
      headers[name] = `${local}${value.slice(origin.length)}`;
    }
  }
}

function sessionResult(value: unknown): HubRemoteSession {
  const result = value as Partial<HubRemoteSession> | null;
  const baseUrl = String(result?.baseUrl ?? '');
  const token = String(result?.token ?? '');
  const expiresAt = String(result?.expiresAt ?? '');
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new HubRemoteError('The device returned an invalid remote session', 502, 'INVALID_SESSION');
  }
  const loopbackHttp =
    parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !loopbackHttp) || !baseUrl.endsWith('/') || !token) {
    throw new HubRemoteError('The device returned an invalid remote session', 502, 'INVALID_SESSION');
  }
  return {
    sessionId: String(result?.sessionId ?? ''),
    baseUrl,
    token,
    expiresAt: Number.isFinite(Date.parse(expiresAt))
      ? expiresAt
      : new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

function remoteError(error: any, deviceName: string): HubRemoteError {
  if (error instanceof HubRemoteError) return error;
  const code = String(error?.code ?? '');
  if (code === 'PERMISSION_DENIED') {
    return new HubRemoteError(
      `${deviceName} has not granted this device full Hub access. On ${deviceName}, open Settings → Devices and allow hub-remote › hub.connect for this device.`,
      403,
      'HUB_REMOTE_NOT_GRANTED',
    );
  }
  if (code === 'UNSUPPORTED_OPERATION') {
    return new HubRemoteError(
      `${deviceName} is running a Drone Hub version without full remote access. Update it, then try again.`,
      409,
      'HUB_REMOTE_UNSUPPORTED',
    );
  }
  return new HubRemoteError(
    String(error?.message ?? error ?? `${deviceName} is unavailable`),
    502,
    code || 'HUB_REMOTE_UNAVAILABLE',
  );
}

/**
 * One loopback origin per remote Hub. It serves this machine's UI, with every API,
 * event-stream, WebSocket and preview request forwarded to the remote Hub's ingress.
 * The origin's port is kept across restarts so the remote Hub's local UI state persists.
 */
class HubRemoteViewer {
  private server: http.Server | null = null;
  private readonly sockets = new Set<Duplex>();
  private session: HubRemoteSession | null = null;
  private sessionRequest: Promise<HubRemoteSession> | null = null;
  private readonly agents = {
    http: new http.Agent({ keepAlive: true, maxSockets: 64 }),
    https: new https.Agent({ keepAlive: true, maxSockets: 64 }),
  };
  private runtime: HubRemoteRuntime;
  port = 0;

  constructor(
    readonly deviceId: string,
    runtime: HubRemoteRuntime,
    private readonly request: MeshRequest,
  ) {
    this.runtime = runtime;
  }

  get pageOrigin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private get apiOrigin(): string {
    return `http://localhost:${this.port}`;
  }

  update(runtime: HubRemoteRuntime): void {
    this.runtime = runtime;
  }

  async listen(preferredPort: number): Promise<number> {
    if (this.server) return this.port;
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        if (!response.headersSent) {
          const failure = error instanceof HubRemoteError ? error : remoteError(error, this.runtime.deviceName);
          deviceMeshJson(response, failure.status, { ok: false, error: failure.message, code: failure.code });
        } else response.destroy();
      });
    });
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    server.on('upgrade', (request, socket, head) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      void this.handleUpgrade(request, socket, head).catch(() => socket.destroy());
    });
    const bind = (port: number) =>
      new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        server.once('error', failed);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', failed);
          resolve();
        });
      });
    try {
      await bind(preferredPort);
    } catch (error: any) {
      if (!preferredPort || error?.code !== 'EADDRINUSE') throw error;
      await bind(0);
    }
    const address = server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
    this.server = server;
    return this.port;
  }

  /**
   * A usable session, opened over the signed mesh when none is held or it is about to expire.
   * Concurrent callers share one request, so a rejected session is replaced only once.
   */
  async ensureSession(): Promise<HubRemoteSession> {
    if (this.session && Date.parse(this.session.expiresAt) - Date.now() > SESSION_REFRESH_MARGIN_MS) {
      return this.session;
    }
    this.sessionRequest ??= (async () => {
      try {
        const result = sessionResult(
          await this.request(
            this.deviceId,
            HUB_REMOTE_CAPABILITY.id,
            'hub.connect',
            {},
            AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
          ).catch((error) => {
            throw remoteError(error, this.runtime.deviceName);
          }),
        );
        this.session = result;
        return result;
      } finally {
        this.sessionRequest = null;
      }
    })();
    return this.sessionRequest;
  }

  private invalidate(session: HubRemoteSession): void {
    if (this.session === session) this.session = null;
  }

  private agentFor(url: URL): http.Agent {
    return url.protocol === 'https:' ? this.agents.https : this.agents.http;
  }

  /**
   * API requests come from this page, from its own direct-API origin, or from local tools
   * without browser metadata. Browsers omit Origin on cross-site subresource GETs, so
   * those are recognised by Sec-Fetch-Site instead.
   */
  private allowedOrigin(request: http.IncomingMessage): boolean {
    const origin = String(request.headers.origin ?? '').trim();
    if (origin) return origin === this.pageOrigin || origin === this.apiOrigin;
    const site = String(request.headers['sec-fetch-site'] ?? '').trim().toLowerCase();
    return !site || site === 'same-origin' || site === 'none';
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const route = viewerRoute(request.headers.host, this.port);
    if (!route) {
      deviceMeshJson(response, 421, { ok: false, error: 'unknown remote Hub address' });
      return;
    }
    const target = requestPath(request.url);
    if (!target) {
      deviceMeshJson(response, 400, { ok: false, error: 'invalid request target' });
      return;
    }
    if (route.kind === 'preview') {
      await this.forward(request, response, `port/${route.port}${target.path}`, route);
      return;
    }
    if (isApiPath(target.pathname)) {
      if (!this.allowedOrigin(request)) {
        deviceMeshJson(response, 403, { ok: false, error: 'origin not allowed' });
        return;
      }
      this.applyCors(request, response);
      if (String(request.method ?? 'GET').toUpperCase() === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }
      await this.forward(request, response, target.path.slice(1), route);
      return;
    }
    await this.serveUi(request, response, target.path);
  }

  private applyCors(request: http.IncomingMessage, response: http.ServerResponse): void {
    const origin = String(request.headers.origin ?? '').trim();
    if (!origin) return;
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('timing-allow-origin', origin);
    response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    const requested = String(request.headers['access-control-request-headers'] ?? '').trim();
    response.setHeader(
      'access-control-allow-headers',
      requested || 'content-type, authorization, if-none-match',
    );
    response.setHeader('access-control-expose-headers', 'etag,mcp-session-id,server-timing');
    response.setHeader('access-control-max-age', '600');
    response.setHeader('vary', 'origin');
  }

  private async forward(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    tail: string,
    route: Route,
  ): Promise<void> {
    const method = String(request.method ?? 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    // A request without a body can be replayed once after the remote Hub restarts.
    for (let attempt = 0; ; attempt++) {
      // A rejected session was invalidated below, so this opens or reuses its replacement.
      const session = await this.ensureSession();
      const target = new URL(tail, session.baseUrl);
      const headers = forwardableHeaders(request.headers, ['host', 'authorization']);
      if (route.kind === 'preview') rewritePreviewRequestHeaders(headers, route.port, this.port);
      else for (const name of ['origin', 'referer', 'cookie']) delete headers[name];
      headers.authorization = `Bearer ${session.token}`;
      const outcome = await new Promise<'done' | 'retry'>((resolve, reject) => {
        const upstream = (target.protocol === 'https:' ? https : http).request(target, {
          method,
          headers,
          agent: this.agentFor(target),
        });
        let settled = false;
        const settle = (value: 'done' | 'retry') => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        response.once('close', () => {
          if (!response.writableFinished) upstream.destroy();
          settle('done');
        });
        upstream.once('response', (upstreamResponse) => {
          if (
            upstreamResponse.statusCode === 401 &&
            upstreamResponse.headers[HUB_REMOTE_SESSION_HEADER] === HUB_REMOTE_SESSION_INVALID
          ) {
            this.invalidate(session);
            if (!hasBody && attempt === 0) {
              upstreamResponse.resume();
              settle('retry');
              return;
            }
          }
          if (
            route.kind === 'preview' &&
            upstreamResponse.headers[HUB_REMOTE_SESSION_HEADER] === HUB_REMOTE_PORT_UNREACHABLE
          ) {
            // A closed port fails the connection, as it would on the remote machine, so
            // reachability probes and the preview see it as down rather than as a page.
            upstreamResponse.resume();
            request.socket.destroy();
            settle('done');
            return;
          }
          let responseHeaders = forwardableHeaders(upstreamResponse.headers);
          if (route.kind === 'preview') {
            responseHeaders = rewritePreviewResponseHeaders(responseHeaders, route.port, this.port);
          } else {
            // CORS belongs to this origin, which set its own headers already.
            for (const name of Object.keys(responseHeaders)) {
              if (name.startsWith('access-control-') || name === 'vary') delete responseHeaders[name];
            }
          }
          for (const [name, value] of Object.entries(responseHeaders)) response.setHeader(name, value);
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage);
          response.flushHeaders();
          upstreamResponse.pipe(response);
          upstreamResponse.once('error', () => response.destroy());
          upstreamResponse.once('end', () => settle('done'));
        });
        upstream.once('error', (error) => {
          if (settled) return;
          if (!response.headersSent) {
            settled = true;
            reject(remoteError(error, this.runtime.deviceName));
            return;
          }
          response.destroy();
          settle('done');
        });
        if (hasBody) request.pipe(upstream);
        else upstream.end();
      });
      if (outcome === 'done') return;
    }
  }

  private async serveUi(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    rawPath: string,
  ): Promise<void> {
    const method = String(request.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      deviceMeshJson(response, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    const home = new URL(this.runtime.homeOrigin);
    const headers = forwardableHeaders(request.headers, [
      'host',
      'authorization',
      'cookie',
      'origin',
      'referer',
      'accept-encoding',
    ]);
    headers.host = home.host;
    // Pages are rewritten, so ask for them uncompressed.
    headers['accept-encoding'] = 'identity';
    await new Promise<void>((resolve, reject) => {
      const upstream = http.request(
        { host: home.hostname.replace(/^\[|\]$/g, ''), port: Number(home.port || 80), method, path: rawPath, headers },
        (upstreamResponse) => {
          const responseHeaders = forwardableHeaders(upstreamResponse.headers);
          const html = /^text\/html\b/i.test(String(upstreamResponse.headers['content-type'] ?? ''));
          if (!html || method === 'HEAD') {
            response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
            upstreamResponse.pipe(response);
            upstreamResponse.once('end', resolve);
            upstreamResponse.once('error', reject);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          upstreamResponse.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_HTML_BYTES) {
              upstreamResponse.destroy(new Error('The Drone Hub page is too large'));
              return;
            }
            chunks.push(chunk);
          });
          upstreamResponse.once('error', reject);
          upstreamResponse.once('end', () => {
            const body = Buffer.from(
              rewriteRuntimeConfig(Buffer.concat(chunks).toString('utf8'), {
                directApiBase: this.apiOrigin,
                remoteHub: this.runtime,
              }),
            );
            delete responseHeaders['content-length'];
            delete responseHeaders.etag;
            delete responseHeaders['last-modified'];
            responseHeaders['content-length'] = String(body.length);
            responseHeaders['cache-control'] = 'no-store';
            response.writeHead(upstreamResponse.statusCode ?? 200, responseHeaders);
            response.end(body);
            resolve();
          });
        },
      );
      upstream.once('error', () =>
        reject(
          new HubRemoteError(
            'This device’s Drone Hub window is closed. Reopen Drone Hub, then switch devices again.',
            503,
            'HUB_REMOTE_HOME_UNAVAILABLE',
          ),
        ),
      );
      response.once('close', () => upstream.destroy());
      upstream.end();
    });
  }

  private async handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on('error', () => socket.destroy());
    const route = viewerRoute(request.headers.host, this.port);
    if (!route) {
      rejectUpgrade(socket, 421, 'Misdirected Request');
      return;
    }
    const requested = requestPath(request.url);
    if (!requested) {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    const rawPath = requested.path;
    if (route.kind === 'ui' && !isApiPath(requested.pathname)) {
      this.upgradeHome(request, socket, head, rawPath);
      return;
    }
    if (route.kind === 'ui' && !this.allowedOrigin(request)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const tail = route.kind === 'preview' ? `port/${route.port}${rawPath}` : rawPath.slice(1);
    let session: HubRemoteSession;
    try {
      session = await this.ensureSession();
    } catch {
      rejectUpgrade(socket, 502, 'Bad Gateway');
      return;
    }
    const target = new URL(tail, session.baseUrl);
    const headers = forwardableHeaders(request.headers, ['host', 'authorization']);
    if (route.kind === 'preview') rewritePreviewRequestHeaders(headers, route.port, this.port);
    else for (const name of ['origin', 'referer', 'cookie']) delete headers[name];
    headers.authorization = `Bearer ${session.token}`;
    headers.connection = 'Upgrade';
    headers.upgrade = String(request.headers.upgrade ?? 'websocket');
    const upstream = (target.protocol === 'https:' ? https : http).request(target, {
      method: String(request.method ?? 'GET'),
      headers,
    });
    upstream.once('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      if (socket.destroyed) {
        upstreamSocket.destroy();
        return;
      }
      socket.write(rawResponseHead(upstreamResponse));
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.on('error', () => socket.destroy());
      upstreamSocket.once('close', () => socket.destroy());
      socket.once('close', () => upstreamSocket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstream.once('response', (upstreamResponse) => {
      if (
        upstreamResponse.statusCode === 401 &&
        upstreamResponse.headers[HUB_REMOTE_SESSION_HEADER] === HUB_REMOTE_SESSION_INVALID
      )
        this.invalidate(session);
      upstreamResponse.resume();
      rejectUpgrade(socket, upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage || 'Bad Gateway');
    });
    upstream.once('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.end();
  }

  /** Development servers keep their live-reload socket on the page's own origin. */
  private upgradeHome(request: http.IncomingMessage, socket: Duplex, head: Buffer, rawPath: string): void {
    const home = new URL(this.runtime.homeOrigin);
    const headers = forwardableHeaders(request.headers, ['host', 'authorization', 'cookie']);
    headers.host = home.host;
    if (headers.origin) headers.origin = home.origin;
    headers.connection = 'Upgrade';
    headers.upgrade = String(request.headers.upgrade ?? 'websocket');
    const upstream = net.connect({ host: home.hostname.replace(/^\[|\]$/g, ''), port: Number(home.port || 80) });
    upstream.once('connect', () => {
      upstream.write(upgradeRequestHead(String(request.method ?? 'GET'), rawPath, headers));
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    upstream.once('close', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.session = null;
    for (const socket of this.sockets) socket.destroy();
    this.agents.http.destroy();
    this.agents.https.destroy();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Local-admin entry point for opening another desktop Hub in full. The UI asks for a
 * viewer, then navigates to the returned loopback origin.
 */
export class HubRemoteViewers implements DeviceMeshHttpExtension {
  private readonly viewers = new Map<string, HubRemoteViewer>();
  private readonly starting = new Map<string, Promise<HubRemoteViewer>>();
  private readonly portsPath: string;
  private saving: Promise<void> = Promise.resolve();
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    rootDir: string,
    private readonly store: DeviceMeshStore,
    private readonly request: MeshRequest,
  ) {
    this.portsPath = path.join(rootDir, 'remote-hub-ports.json');
    this.unsubscribe = store.subscribe(() => {
      void this.closeInactiveDevices();
    });
  }

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname !== HUB_REMOTE_OPEN_PATH) return false;
    if (String(request.method ?? 'GET').toUpperCase() !== 'POST') {
      deviceMeshJson(response, 405, { ok: false, error: 'method not allowed' });
      return true;
    }
    const body = await readDeviceMeshBody(request);
    try {
      const url = await this.open(String(body.targetDeviceId ?? '').trim(), body.homeOrigin);
      deviceMeshJson(response, 200, { ok: true, url });
    } catch (error: any) {
      const failure = error instanceof HubRemoteError ? error : remoteError(error, 'The device');
      deviceMeshJson(response, failure.status, { ok: false, error: failure.message, code: failure.code });
    }
    return true;
  }

  async open(targetDeviceId: string, homeOriginInput: unknown): Promise<string> {
    if (this.closed) throw new HubRemoteError('Drone Hub is shutting down', 503, 'HUB_REMOTE_CLOSED');
    const homeOrigin = loopbackHttpOrigin(homeOriginInput);
    if (!homeOrigin) throw new HubRemoteError('homeOrigin must be a loopback HTTP origin', 400, 'INVALID_REQUEST');
    const state = await this.store.read();
    const target = state.devices[targetDeviceId];
    if (!targetDeviceId || !target || target.revokedAt) {
      throw new HubRemoteError('That device is not paired with this Hub', 404, 'DEVICE_NOT_FOUND');
    }
    if (targetDeviceId === state.selfDeviceId) {
      throw new HubRemoteError('This Hub is already local', 400, 'INVALID_REQUEST');
    }
    const runtime: HubRemoteRuntime = {
      deviceId: target.id,
      deviceName: target.name,
      homeDeviceId: state.selfDeviceId,
      homeOrigin,
    };
    const viewer = await this.viewer(targetDeviceId, runtime);
    viewer.update(runtime);
    await this.save(targetDeviceId, { port: viewer.port, homeOrigin });
    await viewer.ensureSession();
    return `${viewer.pageOrigin}/`;
  }

  /**
   * Reopens the viewers used before this Hub restarted, on their saved origins, so open
   * remote Hub pages reconnect instead of losing their server.
   */
  async restore(): Promise<void> {
    const saved = await this.readSaved();
    const state = await this.store.read();
    await Promise.all(
      Object.entries(saved).map(async ([deviceId, entry]) => {
        const device = state.devices[deviceId];
        if (!device || device.revokedAt || deviceId === state.selfDeviceId || !entry.homeOrigin) return;
        await this.viewer(deviceId, {
          deviceId,
          deviceName: device.name,
          homeDeviceId: state.selfDeviceId,
          homeOrigin: entry.homeOrigin,
        }).catch(() => undefined);
      }),
    );
  }

  private async viewer(deviceId: string, runtime: HubRemoteRuntime): Promise<HubRemoteViewer> {
    const existing = this.viewers.get(deviceId);
    if (existing) return existing;
    const pending = this.starting.get(deviceId);
    if (pending) return pending;
    const start = (async () => {
      const viewer = new HubRemoteViewer(deviceId, runtime, this.request);
      const saved = await this.readSaved();
      const port = await viewer.listen(saved[deviceId]?.port ?? 0);
      if (this.closed) {
        await viewer.close();
        throw new HubRemoteError('Drone Hub is shutting down', 503, 'HUB_REMOTE_CLOSED');
      }
      this.viewers.set(deviceId, viewer);
      await this.save(deviceId, { port, homeOrigin: runtime.homeOrigin });
      return viewer;
    })().finally(() => this.starting.delete(deviceId));
    this.starting.set(deviceId, start);
    return start;
  }

  private async readSaved(): Promise<Record<string, SavedViewer>> {
    try {
      const raw = JSON.parse(await fs.readFile(this.portsPath, 'utf8'));
      const saved: Record<string, SavedViewer> = {};
      for (const [deviceId, value] of Object.entries(raw ?? {})) {
        const port = portNumber((value as any)?.port);
        if (port) saved[deviceId] = { port, homeOrigin: loopbackHttpOrigin((value as any)?.homeOrigin) };
      }
      return saved;
    } catch {
      return {};
    }
  }

  private async save(deviceId: string, entry: SavedViewer): Promise<void> {
    // Serialized so concurrent viewers cannot overwrite each other's entries.
    this.saving = this.saving.then(async () => {
      const saved = await this.readSaved();
      const current = saved[deviceId];
      if (current?.port === entry.port && current.homeOrigin === entry.homeOrigin) return;
      await this.writeSaved({ ...saved, [deviceId]: entry });
    }).catch(() => undefined);
    await this.saving;
  }

  private async writeSaved(ports: Record<string, SavedViewer>): Promise<void> {
    await fs.mkdir(path.dirname(this.portsPath), { recursive: true });
    const temporary = `${this.portsPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(ports, null, 2), { mode: 0o600 });
    await fs.rename(temporary, this.portsPath);
  }

  private async closeInactiveDevices(): Promise<void> {
    const state = await this.store.read().catch(() => null);
    for (const [deviceId, viewer] of [...this.viewers]) {
      const device = state?.devices[deviceId];
      if (!device || device.revokedAt) {
        this.viewers.delete(deviceId);
        await viewer.close();
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    const viewers = [...this.viewers.values()];
    this.viewers.clear();
    await Promise.all(viewers.map((viewer) => viewer.close()));
  }
}
