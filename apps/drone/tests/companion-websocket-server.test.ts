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
    expect(cancelledRunId).toStartWith('websocket:');
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
    await waitFor(() => deletedSessions.includes(runs[0].runId));
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

test('Companion socket steers follow-ups on the running session and correlates the final reply', async () => {
  const runs: any[] = [];
  const steered: string[] = [];
  const messages: any[] = [];
  const completions: Array<(reply: string) => void> = [];
  const deletedSessions: string[] = [];
  const runtime = {
    run: (input: any) => {
      runs.push(input);
      return new Promise<string>((resolve) => completions.push(resolve));
    },
    steer: (_runId: string, prompt: string) => { steered.push(prompt); return true; },
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
    client.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    client.send(
      JSON.stringify({
        type: 'start_run',
        runId: 'conversation',
        messageId: 'message-1',
        prompt: 'First',
        telemetry: { version: 1, transcriptionMs: 125 },
      }),
    );
    client.send(
      JSON.stringify({
        type: 'start_run',
        runId: 'conversation',
        messageId: 'message-2',
        prompt: 'Second',
      }),
    );
    await waitFor(() => runs.length === 1);
    expect(runs.map((run) => run.prompt)).toEqual(['First']);
    expect(runs[0]).toMatchObject({
      messageId: 'message-1',
      transport: 'websocket',
      clientTelemetry: { version: 1, transcriptionMs: 125 },
    });
    expect(runs[0].queueWaitMs).toBeGreaterThanOrEqual(0);

    await waitFor(() => steered.length === 1);
    expect(steered).toEqual(['Second']);
    expect(runs).toHaveLength(1);
    completions[0]!('Answer after steering');
    await waitFor(() => messages.some((message) => message.status === 'completed'));
    expect(messages.filter((message) => message.type === 'reply')).toEqual([{
      runId: 'conversation', type: 'reply', messageId: 'message-2', reply: 'Answer after steering',
    }]);
    client.send(JSON.stringify({ type: 'cancel_run', runId: 'conversation' }));
    await waitFor(() => deletedSessions.includes(runs[0].runId));
  } finally {
    for (const complete of completions) complete('');
    await closeTestServer(client, webSocketServer, httpServer);
  }
});

test('Companion socket queues an applied proposal result and runs a result-aware continuation', async () => {
  const events: any[] = [];
  let finishInitial!: (reply: string) => void;
  const initial = new Promise<string>((resolve) => { finishInitial = resolve; });
  const resumed: any[] = [];
  const order: string[] = [];
  const steered: string[] = [];
  let runCount = 0;
  const runtime = {
    run: async (input: any) => {
      order.push(`run:${input.prompt}`);
      runCount += 1;
      return runCount === 1 ? await initial : 'Handled after the proposal result.';
    },
    resumeWithProposalResult: async (input: any) => {
      order.push('proposal-result');
      resumed.push(input);
      return input.result.execution.ok ? 'The proposal was applied.' : 'The proposal failed.';
    },
    steer: (_runId: string, prompt: string) => { steered.push(prompt); return true; },
    async deleteSession() {},
  };
  const server = createCompanionWebSocketServer(runtime as any);
  const httpServer = http.createServer();
  httpServer.on('upgrade', (request, socket, head) => {
    server.handleUpgrade(request, socket, head, (client) => server.emit('connection', client, request));
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
    client.on('message', (raw) => events.push(JSON.parse(raw.toString())));
    client.send(JSON.stringify({
      type: 'start_run', runId: 'proposal-run', messageId: 'proposal-draft', prompt: 'Rename it',
    }));
    await waitFor(() => events.some((event) => event.status === 'working'));
    const result = {
      applied: true,
      autoApproved: false,
      proposal: {
        version: 1,
        title: 'Rename chat',
        operations: [{ id: 'rename', type: 'rename_chat', droneId: 'd1', chatName: 'old', newName: 'new' }],
      },
      execution: {
        ok: true,
        operations: [{ id: 'rename', type: 'rename_chat', status: 'completed' }],
      },
    };
    const proposalResultMessage = JSON.stringify({
      type: 'proposal_result', runId: 'proposal-run', messageId: 'proposal-applied', result,
    });
    client.send(proposalResultMessage);
    client.send(proposalResultMessage);
    client.send(JSON.stringify({
      type: 'start_run', runId: 'proposal-run', messageId: 'later-prompt', prompt: 'What next?',
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resumed).toHaveLength(0);

    finishInitial('Ready to apply.');
    await waitFor(() => resumed.length === 1);
    expect(resumed[0].result).toEqual(result);
    await waitFor(() => events.some(
      (event) => event.messageId === 'proposal-applied' && event.status === 'completed',
    ));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'reply', messageId: 'proposal-applied', reply: 'The proposal was applied.',
    }));
    expect(resumed).toHaveLength(1);
    await waitFor(() => events.some(
      (event) => event.messageId === 'later-prompt' && event.status === 'completed',
    ));
    expect(order).toEqual(['run:Rename it', 'proposal-result', 'run:What next?']);
    expect(steered).toEqual([]);
  } finally {
    finishInitial('');
    await closeTestServer(client, server, httpServer);
  }
});

test('desktop subscriptions resume idle sessions and isolate clients that reuse a run ID', async () => {
  const deliveries = new Map<string, (input: any) => Promise<void>>();
  const deleted: string[] = [];
  const runtime = {
    connectSubscriptions: (id: string, deliver: (input: any) => Promise<void>) => {
      expect(deliveries.has(id)).toBe(false);
      deliveries.set(id, deliver);
    },
    run: async (input: any) => `Reply to ${input.prompt}`,
    steer: () => false,
    deleteSession: async (id: string) => { deliveries.delete(id); deleted.push(id); },
  };
  const server = createCompanionWebSocketServer(runtime as any);
  const httpServer = http.createServer();
  httpServer.on('upgrade', (request, socket, head) => {
    server.handleUpgrade(request, socket, head, (client) => server.emit('connection', client, request));
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  const clients = [new WebSocket(`ws://127.0.0.1:${address.port}`), new WebSocket(`ws://127.0.0.1:${address.port}`)];
  const messages: any[][] = [[], []];
  try {
    await Promise.all(clients.map((client) => new Promise<void>((resolve) => client.once('open', resolve))));
    clients.forEach((client, index) => {
      client.on('message', (raw) => messages[index].push(JSON.parse(raw.toString())));
      client.send(JSON.stringify({ type: 'start_run', runId: 'same-client-id', messageId: 'user', prompt: 'watch' }));
    });
    await waitFor(() => messages.every((events) => events.some((event) => event.status === 'completed')));
    expect(deliveries.size).toBe(2);
    const [id, deliver] = [...deliveries.entries()][0];
    await deliver({ prompt: 'event', messageId: 'event', deliveryMode: 'queue' });
    await waitFor(() => messages.flat().some((event) => event.messageId === 'event' && event.status === 'completed'));
    expect(messages.flat().filter((event) => event.type === 'subscription')).toHaveLength(1);
    expect(messages.flat().filter((event) => event.reply === 'Reply to event')).toHaveLength(1);
    clients.forEach((client) => client.close());
    await waitFor(() => deleted.length === 2);
    expect(deleted).toContain(id);
    await expect(deliver({ prompt: 'late', messageId: 'late', deliveryMode: 'asap' })).rejects.toThrow('disconnected');
  } finally {
    clients[1].terminate();
    await closeTestServer(clients[0], server, httpServer);
  }
});
