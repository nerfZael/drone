import crypto from 'node:crypto';
import type http from 'node:http';
import {
  DEVICE_HTTP_MAX_JSON_BYTES,
  DEVICE_HTTP_PATH,
  DEVICE_HTTP_PROTOCOL,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { DeviceHttpChannel } from './device-http-channel';

/** Owns HTTP session admission, authentication, and event-stream lifetime. */
export class DeviceHttpChannelServer {
  private readonly sessions = new Map<string, DeviceHttpChannel>();
  constructor(
    private readonly connected: (channel: DeviceHttpChannel, request: http.IncomingMessage) => void,
    private readonly prepareResult?: (
      request: SignedCapabilityRequest,
      size: number,
      revision: string,
    ) => Promise<unknown>,
  ) {}

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname === '/api/device-mesh/ws') {
      response.writeHead(426).end('Update DroneHub to use the HTTP/SSE device protocol');
      return true;
    }
    const resultPreparation = url.pathname === `${DEVICE_HTTP_PATH}/result-content`;
    if (url.pathname !== DEVICE_HTTP_PATH && !resultPreparation) return false;
    if (resultPreparation && request.method !== 'POST') {
      response.writeHead(405).end();
      return true;
    }
    if (request.method === 'GET') {
      request.socket.setTimeout(0);
      if (request.headers['x-device-protocol'] !== String(DEVICE_HTTP_PROTOCOL)) {
        response.writeHead(426).end();
        return true;
      }
      if (this.sessions.size >= 100) {
        response.writeHead(503).end();
        return true;
      }
      const token = crypto.randomBytes(32).toString('base64url');
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'x-device-session': token,
        'x-accel-buffering': 'no',
      });
      response.flushHeaders();
      const channel = new DeviceHttpChannel(response);
      this.sessions.set(token, channel);
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
      heartbeat.unref?.();
      channel.once('close', () => {
        clearInterval(heartbeat);
        this.sessions.delete(token);
      });
      response.once('close', () => channel.close());
      this.connected(channel, request);
      return true;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return true;
    }
    const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    const channel = this.sessions.get(token);
    if (!channel) {
      response.writeHead(401).end();
      return true;
    }
    try {
      const parts: Buffer[] = [];
      let bytes = 0;
      for await (const part of request) {
        bytes += part.length;
        if (bytes > (resultPreparation ? 1024 : DEVICE_HTTP_MAX_JSON_BYTES)) {
          response.writeHead(413).end();
          return true;
        }
        parts.push(Buffer.from(part));
      }
      if (resultPreparation) {
        const payload = JSON.parse(Buffer.concat(parts).toString('utf8'));
        const pending = channel.takeResultRequest(
          String(payload.requestId),
          String(payload.sourceDeviceId),
        );
        if (!pending || !this.prepareResult) {
          response.writeHead(403).end();
          return true;
        }
        const result = await this.prepareResult(pending, payload.size, payload.revision);
        response
          .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify(result));
        return true;
      }
      const acceptsGzip = String(request.headers['accept-encoding'] ?? '')
        .split(',')
        .some((part) => /^\s*gzip\s*(?:;\s*q=(?!0(?:\.0*)?\s*$)[\d.]+)?\s*$/.test(part));
      channel.receive(Buffer.concat(parts).toString('utf8'), response, acceptsGzip);
    } catch {
      if (!response.headersSent) response.writeHead(400).end();
    }
    return true;
  }

  close(): void {
    for (const channel of this.sessions.values()) channel.close();
    this.sessions.clear();
  }
}
