import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { promptEnqueue } from '../../src/host/api';

test('daemon prompt requests honor a caller abort signal', async () => {
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer((_request, _response) => {
    markRequestStarted();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected a TCP address');

  try {
    const controller = new AbortController();
    const enqueue = promptEnqueue(
      { baseUrl: `http://127.0.0.1:${address.port}`, token: 'test-token' },
      { id: 'prompt-a', cmd: 'bash', args: ['-lc', 'true'] },
      { signal: controller.signal },
    );
    await requestStarted;
    controller.abort(new Error('test shutdown'));
    await assert.rejects(enqueue, /test shutdown/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
