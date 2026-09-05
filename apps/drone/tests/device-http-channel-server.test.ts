import http from 'node:http';
import { expect, test } from 'bun:test';
import {
  DEVICE_HTTP_PATH,
  DEVICE_HTTP_PROTOCOL,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { DeviceHttpChannelServer } from '../src/hub/device-mesh/device-http-channel-server';
import type { DeviceHttpChannel } from '../src/hub/device-mesh/device-http-channel';

test('result uploads require a pending request on the same session and are single-use', async () => {
  const channels: DeviceHttpChannel[] = [];
  let prepared = 0;
  const sessions = new DeviceHttpChannelServer(
    (channel) => {
      channels.push(channel);
    },
    async () => {
      prepared++;
      return { upload: 'scoped-ticket' };
    },
  );
  const server = http.createServer((request, response) => {
    void sessions.handle(request, response, new URL(request.url!, 'http://localhost'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const abort = new AbortController();
  try {
    const connect = () =>
      fetch(`${origin}${DEVICE_HTTP_PATH}`, {
        headers: { 'x-device-protocol': String(DEVICE_HTTP_PROTOCOL) },
        signal: abort.signal,
      });
    const first = await connect();
    const second = await connect();
    const prepare = (token: string) =>
      fetch(`${origin}${DEVICE_HTTP_PATH}/result-content`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceDeviceId: 'desktop',
          requestId: 'preview',
          size: 2,
          revision: 'sha256:test',
        }),
      });
    const firstToken = first.headers.get('x-device-session')!;
    const secondToken = second.headers.get('x-device-session')!;
    expect((await prepare('unknown')).status).toBe(401);
    expect((await prepare(firstToken)).status).toBe(403);
    channels[0].send(
      JSON.stringify({
        type: 'capability.request',
        capability: 'drone-control',
        operation: 'file.preview',
        sourceDeviceId: 'desktop',
        requestId: 'preview',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } as SignedCapabilityRequest),
    );
    expect((await prepare(secondToken)).status).toBe(403);
    const accepted = await prepare(firstToken);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ upload: 'scoped-ticket' });
    expect((await prepare(firstToken)).status).toBe(403);
    expect(prepared).toBe(1);
  } finally {
    abort.abort();
    sessions.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});
