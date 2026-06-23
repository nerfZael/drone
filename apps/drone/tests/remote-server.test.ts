import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { resetDroneRootDirCache } from '../src/host/paths';
import { RemoteAuthStore } from '../src/hub/remote-auth';
import { routeAllowed, sanitizeDroneSummary, shouldServeRemoteHtmlFallback } from '../src/hub/remote-server';

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
