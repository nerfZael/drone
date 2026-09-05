import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pairingClaimSigningText, type PairingClaim } from '@drone/device-protocol';
import { createDeviceMeshService } from '../src/hub/device-mesh';
import { loadOrCreateDeviceIdentity, signDeviceText } from '../src/hub/device-mesh/device-identity';

type TestHub = {
  rootDir: string;
  url: string;
  ingressUrl: string;
  token: string;
  service: Awaited<ReturnType<typeof createDeviceMeshService>>;
  close(): Promise<void>;
};

const hubs: TestHub[] = [];

async function startHub(fileEntries?: unknown[]): Promise<TestHub> {
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
      if (
        fileEntries &&
        requestUrl.pathname.endsWith('/fs/list') &&
        request.headers.authorization === `Bearer ${token}`
      ) {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ path: '/workspace', entries: fileEntries }));
        return;
      }
      response.statusCode = 404;
      response.end();
    }
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
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
    rootDir,
    url,
    ingressUrl,
    token,
    service,
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

async function pairHubs(
  inviter: TestHub,
  joining: TestHub,
  grants = [{ capability: 'drone-control', version: 1, operations: ['drones.list'] }],
  administrator = true,
): Promise<{ joiningDeviceId: string }> {
  const joiningBeforePair = await adminJson(joining, '/api/device-mesh');
  await adminJson(joining, `/api/device-mesh/devices/${joiningBeforePair.selfDeviceId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: `Joining Hub ${joiningBeforePair.selfDeviceId.slice(-6)}` }),
  });
  const invitation = await adminJson(inviter, '/api/device-mesh/invitations', {
    method: 'POST',
  });
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
    body: JSON.stringify({ administrator, grants }),
  });
  await waitFor(async () => {
    const status = await adminJson(joining, `/api/device-mesh/joins/${join.joinId}`);
    return status.status === 'approved' ? status : null;
  });
  return { joiningDeviceId: pending.device.id };
}

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
});

describe('desktop device pairing', () => {
  test('a phone without a listening server requests pairing and waits for desktop approval', async () => {
    const hub = await startHub();
    const before = await adminJson(hub, '/api/device-mesh');
    const identity = await loadOrCreateDeviceIdentity(path.join(hub.rootDir, 'test-phone'));
    const device = {
      id: identity.id,
      name: 'My phone',
      platform: 'android' as const,
      publicKey: identity.publicKey,
    };
    const claim = {
      token: crypto.randomBytes(32).toString('base64url'),
      claimSecret: crypto.randomBytes(32).toString('base64url'),
      inviterDeviceId: before.selfDeviceId,
      endpoint: hub.ingressUrl,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      device,
    };
    const response = await fetch(`${hub.ingressUrl}/api/device-mesh/pairing/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...claim,
        signature: signDeviceText(identity, pairingClaimSigningText(claim)),
      }),
    });
    expect(response.ok).toBe(true);
    const { pendingId } = await response.json();
    const pending = (await adminJson(hub, '/api/device-mesh')).pending.find(
      (entry: any) => entry.id === pendingId,
    );
    expect(pending.device.platform).toBe('android');
    expect((await hub.service.store.read()).devices[device.id]).toBeUndefined();
    const statusUrl = `${hub.ingressUrl}/api/device-mesh/invitations/${pendingId}/status?claimSecret=${claim.claimSecret}`;
    expect((await (await fetch(statusUrl)).json()).status).toBe('pending');
    await adminJson(hub, `/api/device-mesh/pending/${pendingId}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        administrator: false,
        grants: [{ capability: 'drone-control', version: 1, operations: ['drones.list'] }],
      }),
    });
    const approved = await (await fetch(statusUrl)).json();
    expect(approved.status).toBe('approved');
    expect(approved.approval.device.id).toBe(device.id);
    const stored = (await hub.service.store.read()).devices[device.id];
    expect(stored.endpoints).toEqual([]);
    expect(stored.administrator).toBe(false);
  });
  test('pairs discovered Hubs without invitation codes and transfers JSON beyond the old socket limit', async () => {
    const entries = Array.from({ length: 4000 }, (_, index) => ({
      name: `${index}-${'x'.repeat(160)}`,
      kind: 'file',
    }));
    const destination = await startHub(entries);
    const source = await startHub();
    const destinationState = await adminJson(destination, '/api/device-mesh');
    const sourceState = await adminJson(source, '/api/device-mesh');
    await adminJson(source, `/api/device-mesh/devices/${sourceState.selfDeviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Discovered source' }),
    });
    const join = await adminJson(source, '/api/device-mesh/joins-discovered', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: destination.ingressUrl,
        deviceId: destinationState.selfDeviceId,
      }),
    });
    const pending = await waitFor(
      async () => (await adminJson(destination, '/api/device-mesh')).pending[0] ?? null,
    );
    await adminJson(destination, `/api/device-mesh/pending/${pending.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        administrator: true,
        grants: [{ capability: 'drone-control', version: 1, operations: ['files.list'] }],
      }),
    });
    await waitFor(async () =>
      (await adminJson(source, `/api/device-mesh/joins/${join.joinId}`)).status === 'approved'
        ? true
        : null,
    );
    await waitFor(async () =>
      (await adminJson(source, '/api/device-mesh')).connectedDeviceIds.includes(
        destinationState.selfDeviceId,
      )
        ? true
        : null,
    );
    const result = await adminJson(source, '/api/device-mesh/drone-control', {
      method: 'POST',
      body: JSON.stringify({
        targetDeviceId: destinationState.selfDeviceId,
        operation: 'files.list',
        payload: { droneId: 'one', path: '/workspace' },
      }),
    });
    expect(result.result.entries).toEqual(entries);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(512 * 1024);
  });
  test('pushes authenticated mesh changes without polling', async () => {
    const hub = await startHub();
    const unauthorized = await fetch(`${hub.url}/api/device-mesh/events`);
    expect(unauthorized.status).toBe(401);
    const events = await fetch(`${hub.url}/api/device-mesh/events`, {
      headers: { authorization: `Bearer ${hub.token}` },
    });
    expect(events.status).toBe(200);
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    const reader = events.body?.getReader();
    if (!reader) throw new Error('event response did not include a stream');
    const decoder = new TextDecoder();
    const ready = await reader.read();
    expect(decoder.decode(ready.value)).toContain('event: ready');

    const status = await adminJson(hub, '/api/device-mesh');
    const change = reader.read();
    await adminJson(hub, `/api/device-mesh/devices/${status.selfDeviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Renamed desktop' }),
    });
    const pushed = await Promise.race([
      change,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('mesh change event timed out')), 2_000),
      ),
    ]);
    expect(decoder.decode(pushed.value)).toContain('event: change');
    await reader.cancel();
  });

  test('bridges authenticated capability events to desktop event clients', async () => {
    const remote = await startHub();
    const desktop = await startHub();
    await pairHubs(remote, desktop, [
      { capability: 'drone-control', version: 1, operations: ['drones.list', 'chat.read'] },
    ]);
    const desktopIdentity = await loadOrCreateDeviceIdentity(desktop.rootDir);
    await waitFor(async () =>
      (await adminJson(remote, '/api/device-mesh')).connectedDeviceIds.includes(desktopIdentity.id)
        ? true
        : null,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const events = await fetch(`${desktop.url}/api/device-mesh/events`, {
      headers: { authorization: `Bearer ${desktop.token}` },
      signal: controller.signal,
    });
    const reader = events.body!.getReader();
    try {
      await reader.read();
      await remote.service.broadcastDroneChatChange({
        droneId: 'drone-1',
        chatName: 'default',
        reason: 'runtime_tool_call_progress',
      });
      const decoder = new TextDecoder();
      let body = '';
      while (!body.includes('runtime_tool_call_progress')) {
        const next = await reader.read();
        if (next.done) throw new Error('Event subscription ended before delivery');
        body += decoder.decode(next.value);
      }
      expect(body).toContain('event: capability');
    } finally {
      clearTimeout(timeout);
      await reader.cancel();
      controller.abort();
    }
  }, 10000);

  test('keeps the administration API off the public mesh listener', async () => {
    const hub = await startHub();
    const health = await fetch(`${hub.ingressUrl}/api/device-mesh/health`);
    expect(health.status).toBe(200);

    const administration = await fetch(`${hub.ingressUrl}/api/device-mesh`, {
      headers: { authorization: `Bearer ${hub.token}` },
    });
    expect(administration.status).toBe(404);
    expect(
      (
        await fetch(`${hub.ingressUrl}/api/device-mesh/phones`, {
          headers: { authorization: `Bearer ${hub.token}` },
        })
      ).status,
    ).toBe(404);
    expect((await fetch(`${hub.url}/api/device-mesh/phones`)).status).toBe(401);
    expect(
      (await fetch(`${hub.url}/api/device-mesh/lan-discovery`, { method: 'POST' })).status,
    ).toBe(401);
    expect(
      (await fetch(`${hub.ingressUrl}/api/device-mesh/lan-discovery`, { method: 'POST' })).status,
    ).toBe(404);
  });

  test('joins through a one-time code and keeps grants destination-local', async () => {
    const inviter = await startHub();
    const joining = await startHub();
    const joiningBeforePair = await adminJson(joining, '/api/device-mesh');
    await adminJson(joining, `/api/device-mesh/devices/${joiningBeforePair.selfDeviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Joining Hub' }),
    });
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

  test('reports when a pairing invitation has been claimed', async () => {
    const inviter = await startHub();
    const joining = await startHub();
    const joiningStatus = await adminJson(joining, '/api/device-mesh');
    await adminJson(joining, `/api/device-mesh/devices/${joiningStatus.selfDeviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Invitation status joining Hub' }),
    });
    const invitation = await adminJson(inviter, '/api/device-mesh/invitations', {
      method: 'POST',
    });

    const publicStatus = await fetch(
      `${inviter.ingressUrl}/api/device-mesh/invitations/${encodeURIComponent(invitation.invitationId)}`,
      { headers: { authorization: `Bearer ${inviter.token}` } },
    );
    expect(publicStatus.status).toBe(404);

    expect(
      await adminJson(
        inviter,
        `/api/device-mesh/invitations/${encodeURIComponent(invitation.invitationId)}`,
      ),
    ).toMatchObject({
      invitationId: invitation.invitationId,
      endpoint: invitation.payload.endpoint,
      expiresAt: invitation.expiresAt,
      claimed: false,
    });

    const join = await adminJson(joining, '/api/device-mesh/joins', {
      method: 'POST',
      body: JSON.stringify({ payload: JSON.stringify(invitation.payload) }),
    });
    const claimed = await waitFor(async () => {
      const status = await adminJson(
        inviter,
        `/api/device-mesh/invitations/${encodeURIComponent(invitation.invitationId)}`,
      );
      return status.claimed ? status : null;
    });
    expect(claimed.claimed).toBe(true);

    const pending = await waitFor(async () => {
      const status = await adminJson(inviter, '/api/device-mesh');
      return status.pending[0] ?? null;
    });
    await adminJson(inviter, `/api/device-mesh/pending/${pending.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ administrator: false, grants: [] }),
    });
    await waitFor(async () => {
      const status = await adminJson(joining, `/api/device-mesh/joins/${join.joinId}`);
      return status.status === 'approved' ? status : null;
    });
  });

  test('recognizes a signed existing device and preserves its permissions without approval', async () => {
    const inviter = await startHub();
    const joining = await startHub();
    const { joiningDeviceId } = await pairHubs(inviter, joining);

    const invitation = await adminJson(inviter, '/api/device-mesh/invitations', {
      method: 'POST',
    });
    const recovery = await adminJson(joining, '/api/device-mesh/joins', {
      method: 'POST',
      body: JSON.stringify({ payload: JSON.stringify(invitation.payload) }),
    });
    await waitFor(async () => {
      const status = await adminJson(joining, `/api/device-mesh/joins/${recovery.joinId}`);
      return status.status === 'approved' ? status : null;
    });

    const status = await adminJson(inviter, '/api/device-mesh');
    expect(status.pending).toEqual([]);
    expect(status.devices.find((device: any) => device.id === joiningDeviceId)).toMatchObject({
      administrator: true,
      grants: [{ capability: 'drone-control', version: 1, operations: ['drones.list'] }],
    });
  });

  test('rejects a copied device identity without its private-key proof', async () => {
    const inviter = await startHub();
    const joining = await startHub();
    const { joiningDeviceId } = await pairHubs(inviter, joining);
    const invitation = await adminJson(inviter, '/api/device-mesh/invitations', {
      method: 'POST',
    });
    const status = await adminJson(inviter, '/api/device-mesh');
    const copiedDevice = status.devices.find((device: any) => device.id === joiningDeviceId);
    const attackerRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-mesh-attacker-'));
    try {
      const attacker = await loadOrCreateDeviceIdentity(attackerRoot);
      const unsigned: Omit<PairingClaim, 'signature'> = {
        token: invitation.payload.token,
        claimSecret: crypto.randomBytes(32).toString('base64url'),
        inviterDeviceId: invitation.payload.inviterDeviceId,
        endpoint: invitation.payload.endpoint,
        expiresAt: invitation.payload.expiresAt,
        device: copiedDevice,
      };
      const response = await fetch(`${inviter.ingressUrl}/api/device-mesh/invitations/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...unsigned,
          signature: signDeviceText(attacker, pairingClaimSigningText(unsigned)),
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'pairing identity proof is invalid' });
      expect((await adminJson(inviter, '/api/device-mesh')).pending).toEqual([]);
    } finally {
      await fs.rm(attackerRoot, { recursive: true, force: true });
    }
  });

  test('does not allow a revoked device to recover through a fresh invitation', async () => {
    const inviter = await startHub();
    const joining = await startHub();
    const { joiningDeviceId } = await pairHubs(inviter, joining);
    await adminJson(inviter, `/api/device-mesh/devices/${joiningDeviceId}`, {
      method: 'DELETE',
    });
    const invitation = await adminJson(inviter, '/api/device-mesh/invitations', {
      method: 'POST',
    });
    const recovery = await adminJson(joining, '/api/device-mesh/joins', {
      method: 'POST',
      body: JSON.stringify({ payload: JSON.stringify(invitation.payload) }),
    });
    const failed = await waitFor(async () => {
      const status = await adminJson(joining, `/api/device-mesh/joins/${recovery.joinId}`);
      return status.status === 'failed' ? status : null;
    });
    expect(failed.error).toContain('revoked');
    expect((await adminJson(inviter, '/api/device-mesh')).pending).toEqual([]);
  });

  test('does not consume an unrelated mesh invitation before discovering a network mismatch', async () => {
    const inviter = await startHub();
    const joining = await startHub();
    const unrelated = await startHub();
    await pairHubs(inviter, joining);
    const invitation = await adminJson(unrelated, '/api/device-mesh/invitations', {
      method: 'POST',
    });
    const recovery = await adminJson(joining, '/api/device-mesh/joins', {
      method: 'POST',
      body: JSON.stringify({ payload: JSON.stringify(invitation.payload) }),
    });
    const failed = await waitFor(async () => {
      const status = await adminJson(joining, `/api/device-mesh/joins/${recovery.joinId}`);
      return status.status === 'failed' ? status : null;
    });
    expect(failed.error).toContain('not from a device in the current mesh');
    expect((await adminJson(unrelated, '/api/device-mesh')).pending).toEqual([]);
  });

  test('defensively preserves grants when a legacy pending request targets an existing device', async () => {
    const inviter = await startHub();
    const joining = await startHub();
    const { joiningDeviceId } = await pairHubs(inviter, joining);
    const invitation = await adminJson(inviter, '/api/device-mesh/invitations', {
      method: 'POST',
    });
    const beforeRecovery = await adminJson(inviter, '/api/device-mesh');
    const existing = beforeRecovery.devices.find((device: any) => device.id === joiningDeviceId);
    const duplicateName = beforeRecovery.devices.find(
      (device: any) => device.id === beforeRecovery.selfDeviceId,
    ).name;
    const legacyClaim = await fetch(`${inviter.ingressUrl}/api/device-mesh/invitations/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: invitation.payload.token,
        claimSecret: crypto.randomBytes(32).toString('base64url'),
        device: { ...existing, name: duplicateName },
      }),
    });
    expect(legacyClaim.status).toBe(202);
    const { pendingId } = await legacyClaim.json();
    await adminJson(inviter, `/api/device-mesh/pending/${pendingId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ administrator: false, grants: [] }),
    });
    const status = await adminJson(inviter, '/api/device-mesh');
    expect(status.devices.find((device: any) => device.id === joiningDeviceId)).toMatchObject({
      name: existing.name,
      administrator: true,
      grants: [{ capability: 'drone-control', version: 1, operations: ['drones.list'] }],
    });
  });

  test('rejects a pending request with a missing invitation without adding its device', async () => {
    const hub = await startHub();
    const unknownRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-mesh-unknown-'));
    try {
      const unknown = await loadOrCreateDeviceIdentity(unknownRoot);
      const pendingId = crypto.randomUUID();
      await hub.service.store.update((state) => {
        state.pending[pendingId] = {
          id: pendingId,
          invitationId: 'missing-invitation',
          claimSecretHash: 'missing-invitation-secret',
          device: unknown,
          requestedAt: new Date().toISOString(),
          approval: null,
          rejectedAt: null,
          resolvedAt: null,
        };
      });
      const response = await fetch(`${hub.url}/api/device-mesh/pending/${pendingId}/approve`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${hub.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ administrator: true, grants: [] }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'pairing invitation not found' });
      expect(
        (await adminJson(hub, '/api/device-mesh')).devices.some(
          (candidate: any) => candidate.id === unknown.id,
        ),
      ).toBe(false);
    } finally {
      await fs.rm(unknownRoot, { recursive: true, force: true });
    }
  });

  test('prunes expired invitations and stale pairing requests while retaining active ones', async () => {
    const hub = await startHub();
    const state = await hub.service.store.read();
    const self = state.devices[state.selfDeviceId];
    const now = Date.now();
    await hub.service.store.update((current) => {
      for (const [id, ageMs, terminal] of [
        ['stale-terminal', 20 * 60_000, true],
        ['stale-pending', 2 * 60 * 60_000, false],
        ['active-pending', 5 * 60_000, false],
      ] as const) {
        current.invitations[id] = {
          id,
          tokenHash: `${id}-token`,
          endpoint: hub.ingressUrl,
          createdAt: new Date(now - ageMs).toISOString(),
          expiresAt: new Date(now - ageMs + 60_000).toISOString(),
          claimedAt: new Date(now - ageMs).toISOString(),
        };
        current.pending[id] = {
          id,
          invitationId: id,
          claimSecretHash: `${id}-secret`,
          device: self,
          requestedAt: new Date(now - ageMs).toISOString(),
          approval: terminal
            ? {
                networkId: current.networkId,
                device: self,
                devices: [self],
                capabilities: [],
                endpoint: hub.ingressUrl,
              }
            : null,
          rejectedAt: null,
          resolvedAt: terminal ? new Date(now - ageMs).toISOString() : null,
        };
      }
      current.pending['orphan-pending'] = {
        id: 'orphan-pending',
        invitationId: 'missing-invitation',
        claimSecretHash: 'orphan-secret',
        device: self,
        requestedAt: new Date(now).toISOString(),
        approval: null,
        rejectedAt: null,
        resolvedAt: null,
      };
    });

    expect(await hub.service.store.prunePairingState(now)).toBe(true);
    const pruned = await hub.service.store.read();
    expect(Object.keys(pruned.pending)).toContain('active-pending');
    expect(Object.keys(pruned.pending)).not.toContain('stale-terminal');
    expect(Object.keys(pruned.pending)).not.toContain('stale-pending');
    expect(Object.keys(pruned.pending)).not.toContain('orphan-pending');
    expect(Object.keys(pruned.invitations)).toContain('active-pending');
    expect(Object.keys(pruned.invitations)).not.toContain('stale-terminal');
    expect(Object.keys(pruned.invitations)).not.toContain('stale-pending');
  });
});
