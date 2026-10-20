import crypto from 'node:crypto';
import type http from 'node:http';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isGranted } from '@drone/device-protocol';
import { DeviceMeshStore } from './device-mesh-store';
import type { LocalHubAccess } from './local-hub-request';
import type { DeviceMeshHttpExtension } from './device-mesh-http';
import { htmlPreviewFramedPath, htmlPreviewResponsePolicy } from '../html-preview-sessions';

type Session = {
  sourceDeviceId: string;
  encodedDrone: string;
  /** The previewed page; HTML files in its folder load in frames inside it. */
  htmlPath: string | null;
  lastUsedAt: number;
};

const ROUTE = '/api/device-mesh/v2/html-preview/';
const IDLE_MS = 30 * 60_000;
const MAX_SESSIONS = 256;
const MAX_SESSIONS_PER_DEVICE = 16;
const MAX_ACTIVE = 8;
const MAX_WAITING = 256;
export const HTML_PREVIEW_MEDIA_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Lets a phone's rendered HTML preview load the page's local images and video
 * the way a browser does: by URL, decoded and cached by the WebView itself. An
 * <img> cannot send headers, so the token is in the path. A session serves one
 * drone's media files, through the Hub's image/video route, and HTML files in the
 * previewed page's folder to frames inside it, sandboxed. It lasts only while the
 * device keeps its file preview grant.
 */
export class DeviceHtmlPreviewSessions implements DeviceMeshHttpExtension {
  private readonly sessions = new Map<string, Session>();
  private readonly active = new Map<AbortController, string>();
  private readonly waiting: Array<(proceed: boolean) => void> = [];
  // Slots handed to a queued request before it starts, so newcomers cannot take them.
  private handedOff = 0;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly access: LocalHubAccess,
    private readonly store: DeviceMeshStore,
    private readonly endpoint: () => string | null,
  ) {
    this.unsubscribe = store.subscribe(() => {
      void store
        .read()
        .then((state) => {
          for (const [id, session] of this.sessions)
            if (!allowed(state.devices[session.sourceDeviceId])) this.sessions.delete(id);
          for (const [controller, source] of this.active)
            if (!allowed(state.devices[source])) controller.abort();
        })
        .catch(() => {
          for (const controller of this.active.keys()) controller.abort();
        });
    });
  }

  /** Returns the URL prefix the page's relative media URLs resolve under. */
  create(sourceDeviceId: string, droneId: string, htmlPath?: string): { mediaBase: string } {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Configure Tailscale access to preview HTML media');
    this.prune();
    // Map order is least recently used first.
    const own = [...this.sessions].filter(([, session]) => session.sourceDeviceId === sourceDeviceId);
    if (own.length >= MAX_SESSIONS_PER_DEVICE) this.sessions.delete(own[0][0]);
    while (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(hash(token), {
      sourceDeviceId,
      encodedDrone: encodeURIComponent(droneId),
      htmlPath: htmlPath?.startsWith('/') ? path.posix.normalize(htmlPath) : null,
      lastUsedAt: Date.now(),
    });
    return { mediaBase: `${endpoint}${ROUTE}${token}/` };
  }

  async handle(): Promise<boolean> {
    return false;
  }

  async handlePublic(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith(ROUTE)) return false;
    // Applies even to an image the WebView is navigated to: it gets no origin and runs nothing.
    response.setHeader('content-security-policy', "default-src 'none'; sandbox");
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('cache-control', 'private, no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return true;
    }
    const [token, ...segments] = url.pathname.slice(ROUTE.length).split('/');
    this.prune();
    const id = hash(token ?? '');
    const session = this.sessions.get(id);
    let filePath: string;
    try {
      filePath = `/${segments.filter(Boolean).map(decodeURIComponent).join('/')}`;
    } catch {
      response.writeHead(400).end();
      return true;
    }
    if (!session || filePath === '/') {
      response.writeHead(session ? 400 : 401).end();
      return true;
    }
    if (!allowed((await this.store.read()).devices[session.sourceDeviceId])) {
      this.sessions.delete(id);
      response.writeHead(403).end();
      return true;
    }
    session.lastUsedAt = Date.now();
    this.sessions.delete(id);
    this.sessions.set(id, session);

    // A page can reference many images at once; they wait their turn rather than fail.
    if (this.active.size + this.handedOff >= MAX_ACTIVE) {
      if (this.waiting.length >= MAX_WAITING) {
        response.writeHead(429).end();
        return true;
      }
      const closed = await new Promise<boolean>((resolve) => {
        const ready = (proceed: boolean) => {
          response.removeListener('close', gone);
          if (!proceed) response.writeHead(503).end();
          resolve(!proceed);
        };
        const gone = () => {
          const index = this.waiting.indexOf(ready);
          if (index >= 0) this.waiting.splice(index, 1);
          resolve(true);
        };
        this.waiting.push(ready);
        response.once('close', gone);
      });
      if (closed) return true;
      this.handedOff -= 1;
    }
    const controller = new AbortController();
    this.active.set(controller, session.sourceDeviceId);
    const abort = () => controller.abort();
    response.once('close', abort);
    const framedPath = session.htmlPath ? htmlPreviewFramedPath(session.htmlPath, filePath) : null;
    let framedSession: string | null = null;
    const base =
      typeof this.access.baseUrl === 'function' ? this.access.baseUrl() : this.access.baseUrl;
    const headers: Record<string, string> = { authorization: `Bearer ${this.access.apiToken}` };
    try {
      let upstream: Response;
      if (framedPath && session.htmlPath) {
        // The Hub's preview route for the previewed page serves the framed one, keeping
        // it inside the page's folder after links resolve. This session sets its policy.
        const policy = framedPagePolicy(`${this.endpoint() ?? url.origin}${ROUTE}${token}/`);
        response.setHeader('content-security-policy', htmlPreviewResponsePolicy(policy));
        const created = await fetch(`${base}/api/drones/${session.encodedDrone}/fs/html-preview`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ path: session.htmlPath, contentSecurityPolicy: policy, documentPrefix: '' }),
          signal: controller.signal,
          redirect: 'error',
        });
        const page = (await created.json().catch(() => null)) as { ok?: boolean; url?: unknown } | null;
        if (!created.ok || !page?.ok || typeof page.url !== 'string' || !page.url.startsWith('/api/drones/')) {
          response.writeHead(created.ok ? 502 : created.status).end();
          return true;
        }
        framedSession = page.url.split('/').slice(0, 7).join('/');
        const encodedPath = framedPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
        upstream = await fetch(`${base}${framedSession}${encodedPath}`, { method: request.method, headers, signal: controller.signal, redirect: 'error' });
      } else {
        if (request.headers.range) headers.range = request.headers.range;
        if (request.headers['if-range']) headers['if-range'] = String(request.headers['if-range']);
        upstream = await fetch(
          `${base}/api/drones/${session.encodedDrone}/fs/media?path=${encodeURIComponent(filePath)}&maxBytes=${HTML_PREVIEW_MEDIA_MAX_BYTES}`,
          { method: request.method, headers, signal: controller.signal, redirect: 'error' },
        );
      }
      const type = String(upstream.headers.get('content-type') ?? '').toLowerCase();
      const served = framedPath ? type.startsWith('text/html') : type.startsWith('image/') || type.startsWith('video/');
      if (!upstream.ok || !served) {
        await upstream.body?.cancel();
        // A video player recovers from an unsatisfiable range using the size it reports.
        const contentRange = upstream.headers.get('content-range');
        if (upstream.status === 416 && contentRange) response.setHeader('content-range', contentRange);
        response.writeHead(upstream.ok ? 415 : upstream.status).end();
        return true;
      }
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      response.statusCode = upstream.status;
      if (request.method === 'HEAD' || !upstream.body) {
        await upstream.body?.cancel();
        response.end();
        return true;
      }
      let received = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length;
          done(
            received > HTML_PREVIEW_MEDIA_MAX_BYTES ? new Error('Media exceeds the preview limit') : null,
            chunk,
          );
        },
      });
      await pipeline(Readable.fromWeb(upstream.body as any), limit, response, {
        signal: controller.signal,
      });
    } catch {
      if (!response.headersSent) response.writeHead(502).end();
      else response.destroy();
    } finally {
      if (framedSession) void fetch(`${base}${framedSession}`, { method: 'DELETE', headers }).catch(() => {});
      response.removeListener('close', abort);
      this.active.delete(controller);
      const next = this.waiting.shift();
      if (next) {
        this.handedOff += 1;
        next(true);
      }
    }
    return true;
  }

  close(): void {
    this.unsubscribe();
    for (const controller of this.active.keys()) controller.abort();
    this.active.clear();
    this.sessions.clear();
    for (const ready of this.waiting.splice(0)) ready(false);
  }

  private prune(): void {
    const cutoff = Date.now() - IDLE_MS;
    for (const [id, session] of this.sessions)
      if (session.lastUsedAt <= cutoff) this.sessions.delete(id);
  }
}

/** A framed page runs scripts and loads this session's files, and nothing else. */
function framedPagePolicy(sessionBase: string): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' data: blob:",
    "style-src 'unsafe-inline'",
    `img-src data: blob: ${sessionBase}`,
    'font-src data:',
    `media-src data: blob: ${sessionBase}`,
    `frame-src ${sessionBase}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function allowed(device: { revokedAt?: unknown; grants?: unknown } | undefined): boolean {
  return Boolean(
    device && !device.revokedAt && isGranted(device.grants as any, 'drone-control', 1, 'file.preview'),
  );
}
