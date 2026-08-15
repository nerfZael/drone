import http from 'node:http';
import { expect, test } from 'bun:test';
import { WebSocket } from 'ws';

import { createCompanionWebSocketServer } from '../src/hub/companion/companion-websocket-server';

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
    client.terminate();
    for (const connectedClient of webSocketServer.clients) connectedClient.terminate();
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
