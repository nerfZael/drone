import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
});
