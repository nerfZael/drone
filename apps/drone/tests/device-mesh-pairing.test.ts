import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createDeviceMeshService } from '../src/hub/device-mesh';

type TestHub = {
  url: string;
  ingressUrl: string;
  token: string;
  close(): Promise<void>;
};

const hubs: TestHub[] = [];

async function startHub(): Promise<TestHub> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-mesh-test-'));
  const token = `token-${crypto.randomUUID()}`;
  let url = '';
  const service = await createDeviceMeshService({
    rootDir,
    apiToken: token,
    localHubBaseUrl: () => url,
  });
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!(await service.handleHttp(request, response, requestUrl))) {
      response.statusCode = 404;
      response.end();
    }
  });
  server.on('upgrade', (request, socket, head) => {
    if (!service.handleUpgrade(request, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test Hub did not bind');
  url = `http://127.0.0.1:${address.port}`;
  await service.start();
  const ingress = await adminJson({ url, token }, '/api/device-mesh/ingress');
  const ingressUrl = `http://127.0.0.1:${ingress.status.port}`;
  await adminJson({ url, token }, '/api/device-mesh/ingress', {
    method: 'PUT',
    body: JSON.stringify({ port: ingress.status.port, publicEndpoint: ingressUrl }),
  });
  const hub: TestHub = {
    url,
    ingressUrl,
    token,
    async close() {
      await service.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
  hubs.push(hub);
  return hub;
}

async function adminJson(
  hub: Pick<TestHub, 'url' | 'token'>,
  pathname: string,
  init?: RequestInit,
): Promise<any> {
  const response = await fetch(`${hub.url}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${hub.token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `request failed (${response.status})`);
  return body;
}

async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('condition timed out');
}

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
});

describe('desktop device pairing', () => {
  test('keeps the administration API off the public mesh listener', async () => {
    const hub = await startHub();
    const health = await fetch(`${hub.ingressUrl}/api/device-mesh/health`);
    expect(health.status).toBe(200);

    const administration = await fetch(`${hub.ingressUrl}/api/device-mesh`, {
      headers: { authorization: `Bearer ${hub.token}` },
    });
    expect(administration.status).toBe(404);
  });

  test('joins through a one-time code and keeps grants destination-local', async () => {
    const inviter = await startHub();
    const joining = await startHub();
    const invitation = await adminJson(inviter, '/api/device-mesh/invitations', {
      method: 'POST',
      body: JSON.stringify({ publicEndpoint: inviter.url }),
    });
    expect(invitation.payload.endpoint).toBe(inviter.ingressUrl);
    const join = await adminJson(joining, '/api/device-mesh/joins', {
      method: 'POST',
      body: JSON.stringify({ payload: JSON.stringify(invitation.payload) }),
    });
    const pending = await waitFor(async () => {
      const status = await adminJson(inviter, '/api/device-mesh');
      return status.pending[0] ?? null;
    });
    await adminJson(inviter, `/api/device-mesh/pending/${pending.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        administrator: true,
        grants: [{ capability: 'drone-control', version: 1, operations: ['drones.list'] }],
      }),
    });
    await waitFor(async () => {
      const status = await adminJson(joining, `/api/device-mesh/joins/${join.joinId}`);
      return status.status === 'approved' ? status : null;
    });
    const inviterStatus = await adminJson(inviter, '/api/device-mesh');
    const joiningStatus = await adminJson(joining, '/api/device-mesh');
    expect(inviterStatus.devices).toHaveLength(2);
    expect(joiningStatus.devices).toHaveLength(2);
    expect(
      inviterStatus.devices.find((device: any) => device.id === pending.device.id).grants[0]
        .operations,
    ).toEqual(['drones.list']);
    expect(
      joiningStatus.devices.find((device: any) => device.id === pending.device.id).grants,
    ).toEqual([]);
  });
});
