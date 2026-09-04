import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFilesystemRuntime } from '../src/hub/filesystem-runtime';
import { bashQuote, normalizeContainerPath } from '../src/hub/hub-format';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function mutationRuntime() {
  const unused = () => {
    throw new Error('Unexpected filesystem runtime dependency call.');
  };
  return createFilesystemRuntime({
    NON_REPO_HOME_CWD: '/tmp/drone-home',
    bashQuote,
    defaultDroneHomeCwd: () => '/work/repo',
    droneRepoPathInContainer: unused,
    droneRuntime: () => 'container',
    dvmCopyToContainer: unused,
    dvmExec: unused,
    extensionLower: (filePath: string) => path.posix.extname(filePath).slice(1).toLowerCase(),
    isLikelyImagePath: () => false,
    isLikelyVideoPath: () => false,
    isRepoAttachedDrone: () => false,
    json: unused,
    looksLikeMissingContainerError: () => false,
    normalizeContainerPath,
    normalizeDroneCwdForRuntime: (_drone: unknown, value: unknown) => String(value ?? '/work/repo'),
    readJsonBody: unused,
    resolveEffectiveFilesystemSettings: unused,
    runHostCommand: unused,
    sortFsEntries: unused,
    withLockedDroneContainer: unused,
    withReadonlyDroneContainer: unused,
  });
}

describe('container filesystem mutation preflight', () => {
  test('a missing later item leaves earlier delete, move, and copy sources untouched', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'drone-container-mutation-'));
    temporaryRoots.push(root);
    const destination = path.join(root, 'destination');
    const existing = path.join(root, 'existing.txt');
    const missing = path.join(root, 'missing.txt');
    mkdirSync(destination);
    writeFileSync(existing, 'keep me');
    const runtime = mutationRuntime();

    for (const body of [
      { action: 'delete' as const, paths: [existing, missing] },
      { action: 'move' as const, paths: [existing, missing], targetDir: destination },
      { action: 'copy' as const, paths: [existing, missing], targetDir: destination },
    ]) {
      const { script } = runtime.containerFsMutationScript(body.action, body, {});
      expect(() => execFileSync('bash', ['-lc', script], { stdio: 'pipe' })).toThrow();
      expect(existsSync(existing)).toBe(true);
      expect(existsSync(path.join(destination, 'existing.txt'))).toBe(false);
    }
  });
});
