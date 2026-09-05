import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import type http from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { DeviceMeshHttpExtension } from './device-mesh-http';
import { DeviceMeshStore } from './device-mesh-store';

type Ticket = {
  source: string;
  method: 'GET' | 'PUT';
  size: number;
  tokenHash: string;
  expires: number;
  revision?: string;
  sha256?: string;
  completed?(): void;
  resolve(): Promise<string>;
  authorized(): Promise<boolean>;
};

export class WorkspaceHttpTransfers implements DeviceMeshHttpExtension {
  private readonly tickets = new Map<string, Ticket>();
  private readonly active = new Set<AbortController>();
  private readonly writing = new Set<string>();
  constructor(
    private readonly store: DeviceMeshStore,
    private readonly endpoint: () => string | null,
  ) {}
  issue(input: Omit<Ticket, 'tokenHash' | 'expires'>) {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Configure Tailscale access for workspace transfers');
    for (const [id, ticket] of this.tickets)
      if (ticket.expires <= Date.now()) this.tickets.delete(id);
    if (this.tickets.size >= 1024) throw new Error('Too many workspace transfers');
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + 30 * 60_000;
    this.tickets.set(id, {
      ...input,
      expires,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    });
    return {
      url: `${endpoint}/api/device-mesh/v2/workspace-content/${id}`,
      token,
      size: input.size,
      expiresAt: new Date(expires).toISOString(),
    };
  }
  async handle(): Promise<boolean> {
    return false;
  }
  async handlePublic(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/device-mesh/v2/workspace-content/')) return false;
    const ticket = this.tickets.get(url.pathname.split('/').at(-1)!);
    const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    if (
      !ticket ||
      ticket.expires <= Date.now() ||
      request.method !== ticket.method ||
      !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(ticket.tokenHash))
    ) {
      response.writeHead(401).end();
      return true;
    }
    const authorized = async () => {
      const device = (await this.store.read()).devices[ticket.source];
      return Boolean(device && !device.revokedAt && (await ticket.authorized()));
    };
    if (!(await authorized())) {
      response.writeHead(403).end();
      return true;
    }
    if (this.active.size >= 16) {
      response.writeHead(429).end();
      return true;
    }
    const controller = new AbortController();
    this.active.add(controller);
    const abort = () => controller.abort();
    response.once('close', abort);
    const check = setInterval(() => {
      void authorized()
        .then((allowed) => {
          if (!allowed || ticket.expires <= Date.now()) abort();
        })
        .catch(abort);
    }, 1_000);
    check.unref?.();
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let writePath: string | undefined;
    try {
      const file = await ticket.resolve();
      if (ticket.method === 'PUT') {
        if (this.writing.has(file)) {
          response.writeHead(409).end();
          return true;
        }
        this.writing.add(file);
        writePath = file;
      }
      handle = await fs.open(
        file,
        (ticket.method === 'GET' ? constants.O_RDONLY : constants.O_RDWR) | constants.O_NOFOLLOW,
      );
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Workspace transfer target is not a file');
      if (ticket.method === 'GET') {
        const etag = `"${info.size}-${info.mtimeMs}-${info.ino}"`;
        if (info.size !== ticket.size || (ticket.revision && ticket.revision !== etag)) {
          response.writeHead(412).end();
          return true;
        }
        const range = request.headers.range;
        let start = 0;
        let partial = false;
        if (range) {
          const match = /^bytes=(\d+)-$/.exec(range);
          if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) >= info.size) {
            response.writeHead(416, { 'content-range': `bytes */${info.size}` }).end();
            return true;
          }
          if (!request.headers['if-range'] || request.headers['if-range'] === etag) {
            start = Number(match[1]);
            partial = true;
          }
        }
        response.writeHead(partial ? 206 : 200, {
          'content-type': 'application/octet-stream',
          'content-length': info.size - start,
          'accept-ranges': 'bytes',
          etag,
          ...(partial ? { 'content-range': `bytes ${start}-${info.size - 1}/${info.size}` } : {}),
        });
        await pipeline(handle.createReadStream({ start, autoClose: false }), response, {
          signal: controller.signal,
        });
      } else {
        const offset = Number(request.headers['x-upload-offset'] ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || info.size !== offset) {
          response.writeHead(409).end();
          return true;
        }
        let written = 0;
        if (ticket.sha256 && offset !== 0) {
          response.writeHead(409).end();
          return true;
        }
        const digest = ticket.sha256 ? crypto.createHash('sha256') : null;
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            written += chunk.length;
            digest?.update(chunk);
            done(
              offset + written > ticket.size ? new Error('Upload exceeds declared size') : null,
              chunk,
            );
          },
        });
        await pipeline(
          request,
          limit,
          handle.createWriteStream({ start: offset, autoClose: false }),
          { signal: controller.signal },
        );
        await handle.sync();
        if (ticket.sha256 && (written !== ticket.size || digest!.digest('hex') !== ticket.sha256))
          throw new Error('Upload checksum mismatch');
        if (offset + written === ticket.size) ticket.completed?.();
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ offset: offset + written }));
      }
    } catch {
      if (!response.headersSent) response.writeHead(400).end();
      else response.destroy();
    } finally {
      clearInterval(check);
      response.removeListener('close', abort);
      this.active.delete(controller);
      await handle?.close().catch(() => undefined);
      if (writePath) this.writing.delete(writePath);
    }
    return true;
  }
  close(): void {
    for (const controller of this.active) controller.abort();
    this.active.clear();
    this.tickets.clear();
  }
}
