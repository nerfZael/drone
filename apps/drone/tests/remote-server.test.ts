import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { resetDroneRootDirCache } from '../src/host/paths';
import { updateRegistry } from '../src/host/registry';
import { RemoteAuthStore } from '../src/hub/remote-auth';
import {
  createRemoteDroneRegistrySseTransform,
  resolveContainerDroneForRemoteRequest,
  routeAllowed,
  sanitizeRemoteDroneRegistryEvent,
  sanitizeDroneSummary,
  sanitizeRemoteDroneSummaries,
  shouldServeRemoteHtmlFallback,
} from '../src/hub/remote-server';
import { withTempDroneDataDir } from './test-helpers';

describe('remote Hub server', () => {
  test('preserves repo metadata for remote sidebar grouping', () => {
    const summary = sanitizeDroneSummary({
      id: 'drone-a',
      name: 'Drone A',
      runtime: 'container',
      repoAttached: true,
      repoPath: '/work/repos/example',
      repoBranch: 'feature/remote',
      statusOk: true,
    });

    expect(summary.repoAttached).toBe(true);
    expect(summary.repoPath).toBe('/work/repos/example');
    expect(summary.repoBranch).toBe('feature/remote');
  });

  test('includes host runtime drones in the sanitized remote sidebar list', () => {
    const summaries = sanitizeRemoteDroneSummaries([
      { id: 'container-a', name: 'Container A', runtime: 'container', statusOk: true },
      { id: 'host-a', name: 'Host A', runtime: 'host', statusOk: true },
    ]);

    expect(summaries.map((summary) => [summary.id, summary.runtime])).toEqual([
      ['container-a', 'container'],
      ['host-a', 'host'],
    ]);
  });

  test('preserves fleet parent relationships without exposing assignment lists', () => {
    const summary = sanitizeDroneSummary({
      id: 'child-a',
      name: 'Child A',
      runtime: 'container',
      fleetParentId: 'parent-a',
      fleetAssignedIds: ['assigned-a'],
      statusOk: true,
    });

    expect(summary.fleetParentId).toBe('parent-a');
    expect(summary.fleetAssignedIds).toEqual([]);
  });

  test('sanitizes registry SSE snapshots and deltas', () => {
    expect(
      sanitizeRemoteDroneRegistryEvent('snapshot', {
        ok: true,
        drones: [{ id: 'child-a', name: 'Child A', runtime: 'host', fleetParentId: 'parent-a' }],
      }),
    ).toMatchObject({
      ok: true,
      drones: [{ id: 'child-a', runtime: 'host', fleetParentId: 'parent-a' }],
    });
    expect(
      sanitizeRemoteDroneRegistryEvent('delta', {
        ok: true,
        upserts: [{ id: 'child-b', name: 'Child B', runtime: 'container', fleetParentId: 'parent-a' }],
        removedIds: ['old-child'],
        order: ['parent-a', 'child-b'],
        privateField: 'not forwarded',
      }),
    ).toMatchObject({
      ok: true,
      upserts: [{ id: 'child-b', fleetParentId: 'parent-a' }],
      removedIds: ['old-child'],
      order: ['parent-a', 'child-b'],
    });
    expect(routeAllowed('GET', '/api/drones/events')).toBe(true);
  });

  test('sanitizes fragmented registry SSE stream chunks', async () => {
    const upstreamSnapshot = JSON.stringify({
      ok: true,
      drones: [
        {
          id: 'child-a',
          name: 'Child A',
          runtime: 'container',
          fleetParentId: 'parent-a',
          token: 'must-not-leak',
        },
      ],
    });
    let output = '';
    const stream = Readable.from([
      'event: connected\ndata: {"ok":true,"at":"now"}\n\n',
      `event: snapshot\ndata: ${upstreamSnapshot.slice(0, 35)}`,
      `${upstreamSnapshot.slice(35)}\n\n: keepalive\n\n`,
    ]).pipe(createRemoteDroneRegistrySseTransform());
    for await (const chunk of stream) output += String(chunk);

    expect(output).toContain('event: connected');
    expect(output).toContain('event: snapshot');
    expect(output).toContain('"fleetParentId":"parent-a"');
    expect(output).toContain(': keepalive');
    expect(output).not.toContain('must-not-leak');
    expect(output).not.toContain('token');
  });

  test('preserves repo seed metadata for remote create defaults', () => {
    const summary = sanitizeDroneSummary({
      id: 'drone-a',
      name: 'Drone A',
      runtime: 'container',
      repoAttached: true,
      repoPath: '/work/repos/example',
      repoSeedSource: 'remote',
      repoSeedRemoteBranch: 'origin/feature/remote',
      statusOk: true,
    });

    expect(summary.repoSeedSource).toBe('remote');
    expect(summary.repoSeedRemoteBranch).toBe('origin/feature/remote');
  });

  test('does not serve remote html for missing hashed assets', () => {
    expect(shouldServeRemoteHtmlFallback('/')).toBe(true);
    expect(shouldServeRemoteHtmlFallback('/remote.html')).toBe(true);
    expect(shouldServeRemoteHtmlFallback('/drone/some/client/route')).toBe(true);
    expect(shouldServeRemoteHtmlFallback('/assets/remote-old.js')).toBe(false);
    expect(shouldServeRemoteHtmlFallback('/assets/styles-old.css')).toBe(false);
    expect(shouldServeRemoteHtmlFallback('/icons/missing.png')).toBe(false);
  });

  test('allows remote create auto-rename name suggestions', () => {
    expect(routeAllowed('POST', '/api/drones/name-from-message')).toBe(true);
  });

  test('allows remote chat voice transcriptions', () => {
    expect(routeAllowed('POST', '/api/audio/transcriptions')).toBe(true);
  });

  test('allows remote chat state reads', () => {
    expect(routeAllowed('GET', '/api/drones/drone-a/chats/default/state')).toBe(true);
  });

  test('allows selected-chat model discovery', () => {
    expect(routeAllowed('GET', '/api/drones/drone-a/chats/default/models')).toBe(true);
  });

  test('allows remote whiteboard routes', () => {
    expect(routeAllowed('GET', '/api/whiteboards')).toBe(true);
    expect(routeAllowed('POST', '/api/whiteboards')).toBe(true);
    expect(routeAllowed('GET', '/api/whiteboards/main')).toBe(true);
    expect(routeAllowed('GET', '/api/whiteboards/main/image')).toBe(true);
    expect(routeAllowed('PATCH', '/api/whiteboards/main')).toBe(true);
    expect(routeAllowed('DELETE', '/api/whiteboards/diagram-a')).toBe(true);
    expect(routeAllowed('GET', '/api/whiteboards/events')).toBe(true);
    expect(routeAllowed('GET', '/api/whiteboards/events/image')).toBe(false);
  });

  test('validates remote per-drone access from the registry without requiring the full drone list', async () => {
    await withTempDroneDataDir('drone-remote-validation-test-', async () => {
      const now = new Date().toISOString();
      await updateRegistry((reg: any) => {
        reg.drones = {
          container: {
            id: 'container-id',
            name: 'container',
            runtime: 'container',
            containerName: 'drone-container',
            containerPort: 7777,
            token: 'token-container',
            repoPath: '',
            createdAt: now,
            chats: {},
          },
          host: {
            id: 'host-id',
            name: 'host',
            runtime: 'host',
            containerName: 'host-drone',
            containerPort: 7777,
            token: 'token-host',
            repoPath: '',
            createdAt: now,
            chats: {},
          },
        };
        reg.pending = {
          pendingContainer: {
            id: 'pending-container-id',
            name: 'pending container',
            runtime: 'container',
            repoPath: '',
            containerPort: 7777,
            build: false,
            createdAt: now,
            phase: 'starting',
          },
          pendingHost: {
            id: 'pending-host-id',
            name: 'pending host',
            runtime: 'host',
            repoPath: '',
            containerPort: 7777,
            build: false,
            createdAt: now,
            phase: 'starting',
          },
        };
      });

      const opts = { hubBaseUrl: 'http://remote-validation-test.local' };
      expect(await resolveContainerDroneForRemoteRequest(opts, 'container-id')).toMatchObject({ id: 'container-id' });
      expect(await resolveContainerDroneForRemoteRequest(opts, 'pending-container-id')).toMatchObject({ id: 'pending-container-id' });
      expect(await resolveContainerDroneForRemoteRequest(opts, 'container')).toBeNull();
      expect(await resolveContainerDroneForRemoteRequest(opts, 'host-id')).toBeNull();
      expect(await resolveContainerDroneForRemoteRequest(opts, 'pending-host-id')).toBeNull();
      expect(await resolveContainerDroneForRemoteRequest(opts, 'missing-id')).toBeNull();
    });
  });

  test('marks consumed pairing tokens inactive', () => {
    const previousDataDir = process.env.DRONE_DATA_DIR;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-remote-auth-test-'));
    process.env.DRONE_DATA_DIR = dataDir;
    resetDroneRootDirCache();
    try {
      const auth = new RemoteAuthStore();
      const nowMs = Date.UTC(2026, 0, 1);
      const pairing = auth.createPairing(nowMs);

      expect(auth.pairingStatus(pairing.token, nowMs + 1_000)).toEqual({
        active: true,
        expiresAtMs: pairing.expiresAtMs,
      });

      const req = { headers: { 'user-agent': 'test browser' } } as IncomingMessage;
      const res = { setHeader() {} } as unknown as ServerResponse;
      const session = auth.consumePairing(pairing.token, req, res, nowMs + 2_000);

      expect(session?.id).toBeTruthy();
      expect(auth.pairingStatus(pairing.token, nowMs + 3_000)).toEqual({
        active: false,
        expiresAtMs: null,
      });
    } finally {
      if (previousDataDir === undefined) delete process.env.DRONE_DATA_DIR;
      else process.env.DRONE_DATA_DIR = previousDataDir;
      resetDroneRootDirCache();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
