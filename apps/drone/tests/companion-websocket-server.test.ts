import http from 'node:http';
import { expect, test } from 'bun:test';
import { WebSocket, type WebSocketServer } from 'ws';

import { createCompanionWebSocketServer } from '../src/hub/companion/companion-websocket-server';

function nextMessage(client: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      client.off('error', onError);
      resolve(JSON.parse(raw.toString()));
    };
    const onError = (error: Error) => {
      client.off('message', onMessage);
      reject(error);
    };
    client.once('message', onMessage);
    client.once('error', onError);
  });
}

async function closeTestServer(
  client: WebSocket,
  webSocketServer: WebSocketServer,
  httpServer: http.Server,
): Promise<void> {
  const clients = [client, ...webSocketServer.clients];
  const closed = clients.map(
    (connectedClient) =>
      new Promise<void>((resolve) => {
        if (connectedClient.readyState === WebSocket.CLOSED) resolve();
        else connectedClient.once('close', () => resolve());
      }),
  );
  for (const connectedClient of clients) connectedClient.terminate();
  await Promise.all(closed);
  await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
  httpServer.closeAllConnections();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('expected Companion socket state was not reached');
}

test('Companion socket cancels its active run when the browser disconnects', async () => {
  let finishRun!: (reply: string) => void;
  const runFinished = new Promise<string>((resolve) => {
    finishRun = resolve;
  });
  let cancelledRunId = '';
  let reportCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    reportCancelled = resolve;
  });
  const runtime = {
    run: async () => await runFinished,
    cancel: (runId: string) => {
      cancelledRunId = runId;
      reportCancelled();
    },
    deleteSession: async (runId: string) => {
      cancelledRunId = runId;
      reportCancelled();
    },
  };
  const webSocketServer = createCompanionWebSocketServer(runtime as any);
  const httpServer = http.createServer();
  httpServer.on('upgrade', (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client, request);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

  try {
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'start_run', runId: 'disconnect-test', prompt: 'Hello' }));
    await new Promise<void>((resolve, reject) => {
      client.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'status' || message.status !== 'working') return;
        client.close();
      });
      client.once('close', resolve);
      client.once('error', reject);
    });
    await cancelled;
    expect(cancelledRunId).toBe('disconnect-test');
  } finally {
    finishRun('');
    await closeTestServer(client, webSocketServer, httpServer);
  }
});

test('Companion socket rejects late browser tools from a cancelled run after restart', async () => {
  const runs: any[] = [];
  const completions: Array<(reply: string) => void> = [];
  const deletedSessions: string[] = [];
  const runtime = {
    run: (input: any) => {
      runs.push(input);
      return new Promise<string>((resolve) => completions.push(resolve));
    },
    cancel() {},
    async deleteSession(runId: string) {
      deletedSessions.push(runId);
    },
  };
  const webSocketServer = createCompanionWebSocketServer(runtime as any);
  const httpServer = http.createServer();
  httpServer.on('upgrade', (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client, request);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

  try {
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    const firstStarted = nextMessage(client);
    client.send(JSON.stringify({ type: 'start_run', runId: 'first-run', prompt: 'First' }));
    expect(await firstStarted).toMatchObject({
      type: 'status',
      runId: 'first-run',
      status: 'working',
    });
    client.send(JSON.stringify({ type: 'cancel_run', runId: 'first-run' }));
    await waitFor(() => deletedSessions.includes('first-run'));
    client.send(JSON.stringify({ type: 'start_run', runId: 'second-run', prompt: 'Second' }));
    await waitFor(() => runs.length === 2);

    await expect(runs[0].callBrowser('highlight_drones', { droneIds: ['drone-a'] })).rejects.toThrow(
      'Companion run is no longer active',
    );
  } finally {
    for (const complete of completions) complete('');
    await closeTestServer(client, webSocketServer, httpServer);
  }
});

test('Companion socket queues follow-ups on the same session', async () => {
  const runs: any[] = [];
  const completions: Array<(reply: string) => void> = [];
  const deletedSessions: string[] = [];
  const runtime = {
    run: (input: any) => {
      runs.push(input);
      return new Promise<string>((resolve) => completions.push(resolve));
    },
    cancel() {},
    async deleteSession(runId: string) {
      deletedSessions.push(runId);
    },
  };
  const webSocketServer = createCompanionWebSocketServer(runtime as any);
  const httpServer = http.createServer();
  httpServer.on('upgrade', (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client, request);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

  try {
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'start_run', runId: 'conversation', prompt: 'First' }));
    client.send(JSON.stringify({ type: 'start_run', runId: 'conversation', prompt: 'Second' }));
    await waitFor(() => runs.length === 1);
    expect(runs.map((run) => run.prompt)).toEqual(['First']);

    completions[0]!('First reply');
    await waitFor(() => runs.length === 2);
    expect(runs.map((run) => run.prompt)).toEqual(['First', 'Second']);
    expect(runs[1].runId).toBe(runs[0].runId);

    completions[1]!('Second reply');
    client.send(JSON.stringify({ type: 'cancel_run', runId: 'conversation' }));
    await waitFor(() => deletedSessions.includes('conversation'));
  } finally {
    for (const complete of completions) complete('');
    await closeTestServer(client, webSocketServer, httpServer);
  }
});
