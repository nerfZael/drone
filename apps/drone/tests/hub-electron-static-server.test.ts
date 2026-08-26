import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const {
  resolveDesktopStaticUiDir,
  resolveHubApiTokenPath,
}: {
  resolveDesktopStaticUiDir(baseDir: string, explicitPath?: string): string | null;
  resolveHubApiTokenPath(payload: any): string | null;
} = require('../desktop/hub-electron-static-server.cjs');

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const cleanupPath of cleanupPaths.splice(0)) rmSync(cleanupPath, { recursive: true, force: true });
});

describe('Drone Hub Electron static UI server', () => {
  test('resolves packaged assets and the running Hub token beside hub.log', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'drone-hub-static-'));
    cleanupPaths.push(root);
    const staticDir = path.join(root, 'ui');
    mkdirSync(staticDir);
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Hub</title>');

    expect(resolveDesktopStaticUiDir(root, staticDir)).toBe(staticDir);
    expect(resolveHubApiTokenPath({ state: { logPath: '/data/profile/drone/hub.log' } })).toBe(
      '/data/profile/drone/hub.token',
    );
  });

});
