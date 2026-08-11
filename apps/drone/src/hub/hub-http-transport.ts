import http from 'node:http';
import type { Socket } from 'node:net';

import type { WebSocket, WebSocketServer } from 'ws';

type ContainerMcpTransportOptions = {
  host: string;
  port: number;
  requestedUrl: string;
  requestListener: http.RequestListener;
};

type HubHttpTransportOptions = {
  host: string;
  port: number;
  requestListener: http.RequestListener;
  upgradeListener: (...args: any[]) => void;
  webSocketServer: WebSocketServer;
  containerMcp?: ContainerMcpTransportOptions;
};

export type HubHttpTransport = {
  host: string;
  port: number;
  containerMcp: { host: string; port: number; url: string } | null;
  stopAccepting: () => void;
  close: () => Promise<void>;
};

export async function startHubHttpTransport(
  options: HubHttpTransportOptions,
): Promise<HubHttpTransport> {
  const mainSockets = new Set<Socket>();
  const containerMcpSockets = new Set<Socket>();
  const server = http.createServer(options.requestListener);
  trackConnections(server, mainSockets);
  server.on('upgrade', options.upgradeListener);

  let containerMcpServer: http.Server | null = null;
  let closePromise: Promise<void> | null = null;
  let acceptingStopped = false;

  const stopAccepting = (): void => {
    if (acceptingStopped) return;
    acceptingStopped = true;
    beginServerClose(server);
    if (containerMcpServer) beginServerClose(containerMcpServer);
  };

  const close = async (): Promise<void> => {
    if (!closePromise) {
      closePromise = closeTransport({
        server,
        sockets: mainSockets,
        webSocketServer: options.webSocketServer,
        containerMcpServer,
        containerMcpSockets,
      });
    }
    await closePromise;
  };

  try {
    await listen(server, options.port, options.host);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;

    let containerMcp: HubHttpTransport['containerMcp'] = null;
    const containerOptions = options.containerMcp;
    if (containerOptions?.host && containerOptions.port > 0) {
      containerMcpServer = http.createServer(containerOptions.requestListener);
      trackConnections(containerMcpServer, containerMcpSockets);
      await listen(containerMcpServer, containerOptions.port, containerOptions.host);
      const containerAddress = containerMcpServer.address();
      const containerPort =
        typeof containerAddress === 'object' && containerAddress
          ? containerAddress.port
          : containerOptions.port;
      containerMcp = {
        host: containerOptions.host,
        port: containerPort,
        url: containerOptions.requestedUrl || `http://host.docker.internal:${containerPort}/mcp`,
      };
    }

    return { host: options.host, port, containerMcp, stopAccepting, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function beginServerClose(server: http.Server): void {
  if (!server.listening) return;
  try {
    server.close();
  } catch {
    // Full socket cleanup happens in close().
  }
}

function trackConnections(server: http.Server, sockets: Set<Socket>): void {
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
}

async function listen(server: http.Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function closeTransport(options: {
  server: http.Server;
  sockets: Set<Socket>;
  webSocketServer: WebSocketServer;
  containerMcpServer: http.Server | null;
  containerMcpSockets: Set<Socket>;
}): Promise<void> {
  const serverClose = closeServer(options.server);
  const containerMcpServerClose = options.containerMcpServer
    ? closeServer(options.containerMcpServer)
    : Promise.resolve();

  try {
    options.webSocketServer.clients.forEach((client: WebSocket) => {
      try {
        client.close();
      } catch {
        // Best effort during shutdown.
      }
      try {
        client.terminate();
      } catch {
        // Best effort during shutdown.
      }
    });
  } catch {
    // Best effort during shutdown.
  }
  await waitWithTimeout(closeWebSocketServer(options.webSocketServer), 1_000);

  closeIdleConnections(options.server);
  if (options.containerMcpServer) closeIdleConnections(options.containerMcpServer);
  destroySockets(options.sockets);
  destroySockets(options.containerMcpSockets);

  await waitWithTimeout(serverClose, 3_000);
  await waitWithTimeout(containerMcpServerClose, 3_000);
}

function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function closeIdleConnections(server: http.Server): void {
  try {
    (server as any).closeIdleConnections?.();
  } catch {
    // Best effort during shutdown.
  }
}

function destroySockets(sockets: Set<Socket>): void {
  for (const socket of sockets) {
    try {
      socket.destroy();
    } catch {
      // Best effort during shutdown.
    }
  }
}

async function waitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  await Promise.race([
    promise,
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.max(1, Math.floor(timeoutMs)));
      (timer as any).unref?.();
    }),
  ]);
}
