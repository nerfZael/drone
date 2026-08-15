import type http from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocket, type WebSocketServer } from 'ws';

import { isHubApiAuthorizedForWebSocket, rejectWebSocketUpgrade } from './hub-auth';
import { normalizeOrigin } from './hub-http';
import { isHubWebTerminalSessionName } from './terminal-open';
import type { TerminalWebSocketContext } from './terminal-websocket-server';

export function createTerminalWebSocketUpgradeHandler(opts: {
  apiToken: string;
  allowedOrigins: Set<string>;
  webSocketServer: WebSocketServer;
  companionWebSocketServer?: WebSocketServer;
  handleDeviceMeshUpgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  isSafeSessionName: (value: string) => boolean;
  parseSince: (value: string | null) => number | undefined;
  parseMaxBytes: (value: string | null) => number;
  resolveDrone: (socket: Duplex, droneRef: string) => Promise<{ id: string; drone: any } | null>;
  resolveHostPort: (containerName: string, containerPort: number) => Promise<number | null>;
}): (req: http.IncomingMessage, socket: Duplex, head: Buffer) => Promise<void> {
  return async (req, socket, head) => {
    try {
      if (opts.handleDeviceMeshUpgrade(req, socket, head)) return;
      const originRaw = typeof req.headers.origin === 'string' ? req.headers.origin : '';
      if (originRaw) {
        const origin = normalizeOrigin(originRaw);
        if (!origin || !opts.allowedOrigins.has(origin)) {
          rejectWebSocketUpgrade(socket, 403, 'Forbidden');
          return;
        }
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname === '/api/companion/stream') {
        if (!opts.companionWebSocketServer) {
          rejectWebSocketUpgrade(socket, 404, 'Not Found');
          return;
        }
        if (!isHubApiAuthorizedForWebSocket(req, url, opts.apiToken)) {
          rejectWebSocketUpgrade(socket, 401, 'Unauthorized');
          return;
        }
        opts.companionWebSocketServer.handleUpgrade(req, socket, head, (webSocket: WebSocket) => {
          opts.companionWebSocketServer!.emit('connection', webSocket, req);
        });
        return;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      const isTerminalStreamRoute =
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'stream';
      if (!isTerminalStreamRoute) {
        rejectWebSocketUpgrade(socket, 404, 'Not Found');
        return;
      }
      if (!isHubApiAuthorizedForWebSocket(req, url, opts.apiToken)) {
        rejectWebSocketUpgrade(socket, 401, 'Unauthorized');
        return;
      }

      const droneRef = decodeURIComponent(parts[2]);
      const sessionName = decodeURIComponent(parts[4]);
      if (!opts.isSafeSessionName(sessionName)) {
        rejectWebSocketUpgrade(socket, 400, 'Bad Request');
        return;
      }
      if (!isHubWebTerminalSessionName(sessionName)) {
        rejectWebSocketUpgrade(socket, 404, 'Not Found');
        return;
      }

      const resolved = await opts.resolveDrone(socket, droneRef);
      if (!resolved) return;
      const drone = resolved.drone;
      const token = typeof drone?.token === 'string' ? String(drone.token).trim() : '';
      const containerName =
        String(drone?.containerName ?? drone?.name ?? resolved.id).trim() || resolved.id;
      const hostPort =
        typeof drone?.hostPort === 'number' && Number.isFinite(drone.hostPort)
          ? drone.hostPort
          : await opts.resolveHostPort(containerName, Number(drone?.containerPort ?? 7777));
      if (!hostPort || !token) {
        rejectWebSocketUpgrade(socket, 503, 'Service Unavailable');
        return;
      }

      const context: TerminalWebSocketContext = {
        droneName: resolved.id,
        sessionName,
        client: { baseUrl: `http://127.0.0.1:${hostPort}`, token },
        since: opts.parseSince(url.searchParams.get('since')),
        maxBytes: opts.parseMaxBytes(url.searchParams.get('maxBytes')),
      };
      opts.webSocketServer.handleUpgrade(req, socket, head, (webSocket: WebSocket) => {
        opts.webSocketServer.emit('connection', webSocket, req, context);
      });
    } catch {
      rejectWebSocketUpgrade(socket, 500, 'Internal Server Error');
    }
  };
}
