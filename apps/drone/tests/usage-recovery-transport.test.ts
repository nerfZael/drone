import { expect, test } from 'bun:test';
import http from 'node:http';
import type net from 'node:net';
import { promptGet } from '../src/host/api';

test('usage polling sends no GET body and honors cancellation during shutdown', async () => {
  const arrived = Promise.withResolvers<http.IncomingMessage>();
  const sockets = new Set<net.Socket>();
  const server = http.createServer((request) => arrived.resolve(request));
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  const controller = new AbortController();
  try {
    const pending = promptGet({ baseUrl: `http://127.0.0.1:${address.port}`, token: 'test' }, 'prompt', { signal: controller.signal, timeoutMs: 2000 });
    const request = await arrived.promise;
    expect(request.method).toBe('GET');
    expect(request.headers['content-length']).toBeUndefined();
    controller.abort(new Error('usage recovery stopped'));
    await expect(pending).rejects.toThrow('usage recovery stopped');
  } finally {
    controller.abort();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
