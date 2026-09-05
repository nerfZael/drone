import crypto from 'node:crypto';
import type http from 'node:http';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isGranted } from '@drone/device-protocol';
import { DeviceMeshStore } from './device-mesh-store';
import type { LocalHubAccess } from './local-hub-request';
import type { DeviceMeshHttpExtension } from './device-mesh-http';

type Download = {
  tokenHash: string;
  sourceDeviceId: string;
  path: string;
  expires: number;
  size: number;
};

/** Scoped downloads proxy only a server-selected local resource, with bounded stream buffers. */
export class DeviceHttpTransfers implements DeviceMeshHttpExtension {
  private readonly downloads = new Map<string, Download>();
  private readonly active = new Map<AbortController, string>();
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
          for (const [controller, source] of this.active) {
            const device = state.devices[source];
            if (
              !device ||
              device.revokedAt ||
              !isGranted(device.grants, 'drone-control', 1, 'file.preview')
            )
              controller.abort();
          }
        })
        .catch(() => {
          for (const controller of this.active.keys()) controller.abort();
        });
    });
  }

  prepare(
    sourceDeviceId: string,
    path: string,
    size: number,
  ): { url: string; token: string; size: number; expiresAt: string } {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Configure Tailscale access to transfer files');
    for (const [id, value] of this.downloads)
      if (value.expires <= Date.now()) this.downloads.delete(id);
    if (this.downloads.size >= 1_000) throw new Error('Too many active downloads');
    if (!path.startsWith('/api/drones/') || !path.includes('/fs/media?'))
      throw new Error('Unsupported download resource');
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + 5 * 60_000;
    this.downloads.set(id, {
      sourceDeviceId,
      path,
      size,
      expires,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    });
    return {
      url: `${endpoint}/api/device-mesh/v2/content/${id}`,
      token,
      size,
      expiresAt: new Date(expires).toISOString(),
    };
  }

  attachmentUrl(uploadId: string): string {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Configure Tailscale access to upload attachments');
    return `${endpoint}/api/device-mesh/attachments/${encodeURIComponent(uploadId)}`;
  }

  async handle(): Promise<boolean> {
    return false;
  }
  async handlePublic(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/device-mesh/v2/content/')) return false;
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'authorization, range, if-range');
    response.setHeader('access-control-expose-headers', 'content-length, content-range, etag');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return true;
    }
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return true;
    }
    const download = this.downloads.get(url.pathname.split('/').at(-1)!);
    const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    if (
      !download ||
      download.expires <= Date.now() ||
      !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(download.tokenHash))
    ) {
      response.writeHead(401).end();
      return true;
    }
    const state = await this.store.read();
    const device = state.devices[download.sourceDeviceId];
    if (
      !device ||
      device.revokedAt ||
      !isGranted(device.grants, 'drone-control', 1, 'file.preview')
    ) {
      response.writeHead(403).end();
      return true;
    }
    if (this.active.size >= 32) {
      response.writeHead(429).end();
      return true;
    }
    const controller = new AbortController();
    this.active.set(controller, download.sourceDeviceId);
    const abort = () => controller.abort();
    response.once('close', abort);
    const expiry = setTimeout(abort, Math.max(1, download.expires - Date.now()));
    expiry.unref?.();
    try {
      const base =
        typeof this.access.baseUrl === 'function' ? this.access.baseUrl() : this.access.baseUrl;
      const headers: Record<string, string> = { authorization: `Bearer ${this.access.apiToken}` };
      if (request.headers.range) headers.range = request.headers.range;
      if (request.headers['if-range']) headers['if-range'] = String(request.headers['if-range']);
      const upstream = await fetch(`${base}${download.path}`, {
        headers,
        signal: controller.signal,
        redirect: 'error',
      });
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        response.writeHead(upstream.status).end();
        return true;
      }
      const declared = upstream.headers.get('content-length');
      if (declared && Number(declared) > download.size) {
        await upstream.body.cancel();
        throw new Error('Download exceeds declared size');
      }
      for (const name of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified',
      ]) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      response.setHeader('cache-control', 'private, no-store');
      response.statusCode = upstream.status;
      let received = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length;
          done(
            received > download.size ? new Error('Download exceeds declared size') : null,
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
      clearTimeout(expiry);
      response.removeListener('close', abort);
      this.active.delete(controller);
    }
    return true;
  }
  close(): void {
    this.unsubscribe();
    for (const controller of this.active.keys()) controller.abort();
    this.active.clear();
    this.downloads.clear();
  }
}
