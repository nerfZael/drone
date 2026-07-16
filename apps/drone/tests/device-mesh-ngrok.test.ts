import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DeviceMeshIngress } from '../src/hub/device-mesh/device-mesh-ingress';
import { DeviceMeshNgrok } from '../src/hub/device-mesh/device-mesh-ngrok';

describe('device mesh ngrok control', () => {
  test('reuses a running local agent and removes only its own tunnel', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-mesh-ngrok-'));
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; url: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? 'GET').toUpperCase();
      requests.push({ method, url });
      if (method === 'GET') {
        return Response.json({ tunnels: [] });
      }
      if (method === 'POST' && url.startsWith('http://127.0.0.1:4040/')) {
        return Response.json({ name: 'drone-device-mesh-8791' }, { status: 201 });
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    try {
      const ngrok = new DeviceMeshNgrok(rootDir);
      const started = await ngrok.start(8791);
      expect(started.agentManaged).toBe(true);
      expect(started.pid).toBeUndefined();
      await ngrok.stop();
      expect(
        requests.some(
          (request) =>
            request.method === 'DELETE' &&
            request.url.endsWith('/api/tunnels/drone-device-mesh-8791'),
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test('recovers when persisted agent state points to a vanished inspector', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-mesh-ngrok-'));
    const originalFetch = globalThis.fetch;
    const requests: Array<{ method: string; url: string }> = [];
    await fs.writeFile(
      path.join(rootDir, 'ngrok.json'),
      JSON.stringify({
        version: 1,
        mode: 'agent',
        name: 'drone-device-mesh-8791',
        inspectorPort: 4040,
        port: 8791,
        startedAt: new Date().toISOString(),
        logPath: path.join(rootDir, 'ngrok.log'),
      }),
    );
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? 'GET').toUpperCase();
      requests.push({ method, url });
      if (method === 'POST' && url.startsWith('http://127.0.0.1:4040/')) {
        return Response.json({ name: 'drone-device-mesh-8791' }, { status: 201 });
      }
      throw new Error('inspector unavailable');
    }) as typeof fetch;

    try {
      const ngrok = new DeviceMeshNgrok(rootDir);
      const started = await ngrok.start(8791);
      expect(started.agentManaged).toBe(true);
      expect(started.alreadyRunning).toBe(false);
      expect(requests.some((request) => request.method === 'DELETE')).toBe(true);
      expect(requests.some((request) => request.method === 'POST')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test('withdraws a stale URL and restores a previously managed tunnel on startup', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-mesh-ingress-'));
    const originalFetch = globalThis.fetch;
    const announcements: Array<string | null> = [];
    let agentAvailable = false;
    const probe = net.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    const port = typeof address === 'object' && address ? address.port : 8791;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await Promise.all([
      fs.writeFile(
        path.join(rootDir, 'ingress.json'),
        JSON.stringify({
          version: 1,
          port,
          publicEndpoint: 'https://stale.example.test',
          endpointSource: 'ngrok',
          updatedAt: new Date().toISOString(),
        }),
      ),
      fs.writeFile(
        path.join(rootDir, 'ngrok.json'),
        JSON.stringify({
          version: 1,
          mode: 'agent',
          name: `drone-device-mesh-${port}`,
          inspectorPort: 4040,
          port,
          startedAt: new Date().toISOString(),
          logPath: path.join(rootDir, 'ngrok.log'),
        }),
      ),
    ]);
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.startsWith('http://127.0.0.1:4040/')) {
        agentAvailable = true;
        return Response.json({ name: `drone-device-mesh-${port}` }, { status: 201 });
      }
      if (method === 'GET' && agentAvailable) {
        return Response.json({
          tunnels: [
            {
              public_url: 'https://restored.example.test',
              config: { addr: `http://127.0.0.1:${port}` },
            },
          ],
        });
      }
      throw new Error('inspector unavailable');
    }) as typeof fetch;

    const ingress = new DeviceMeshIngress(
      rootDir,
      port,
      async () => false,
      () => false,
      async (endpoint) => {
        announcements.push(endpoint);
      },
    );
    try {
      await ingress.start();
      expect(ingress.status().publicEndpoint).toBe('https://restored.example.test');
      expect(ingress.status().endpointSource).toBe('ngrok');
      expect(announcements).toContain(null);
      expect(announcements).toContain('https://restored.example.test');
    } finally {
      await ingress.close();
      globalThis.fetch = originalFetch;
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
