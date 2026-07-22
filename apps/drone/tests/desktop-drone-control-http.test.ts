import { describe, expect, test } from 'bun:test';
import http from 'node:http';
import { DesktopDroneControlHttp } from '../src/hub/device-mesh/desktop-drone-control-http';

async function withExtensionServer(
  extension: DesktopDroneControlHttp,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    void extension.handle(request, response, url).then((handled) => {
      if (!handled) response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server address missing');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('desktop drone-control HTTP bridge', () => {
  test('sends a bounded drone-control operation to an active remote device', async () => {
    const requests: unknown[][] = [];
    const router = {
      request: async (...args: unknown[]) => {
        requests.push(args);
        return { drones: [{ id: 'remote-drone' }] };
      },
    };
    const store = {
      read: async () => ({
        selfDeviceId: 'desktop-local',
        devices: {
          'desktop-local': { id: 'desktop-local', revokedAt: null },
          'desktop-remote': { id: 'desktop-remote', revokedAt: null },
        },
      }),
    };
    const extension = new DesktopDroneControlHttp(router as any, store as any);

    await withExtensionServer(extension, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/device-mesh/drone-control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetDeviceId: 'desktop-remote',
          operation: 'drones.list',
          payload: { includeCreateOptions: false },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        result: { drones: [{ id: 'remote-drone' }] },
      });
    });

    expect(requests).toEqual([
      [
        'desktop-remote',
        'drone-control',
        'drones.list',
        { includeCreateOptions: false },
      ],
    ]);
  });

  test('does not expose arbitrary capability operations', async () => {
    const router = { request: async () => ({}) };
    const store = { read: async () => ({ selfDeviceId: 'local', devices: {} }) };
    const extension = new DesktopDroneControlHttp(router as any, store as any);

    await withExtensionServer(extension, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/device-mesh/drone-control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetDeviceId: 'remote',
          operation: 'workspace.files.read',
          payload: {},
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: 'unsupported drone-control operation: workspace.files.read',
      });
    });
  });
});
