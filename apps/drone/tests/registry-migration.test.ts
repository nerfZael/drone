import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { loadRegistry } from '../src/host/registry';

async function withTempHomes<T>(fn: (ctx: { tempRoot: string; homeDir: string; xdgDataHome: string }) => Promise<T>): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-registry-migration-'));
  const homeDir = path.join(tempRoot, 'home');
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(xdgDataHome, { recursive: true });

  const prevHome = process.env.HOME;
  const prevXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = homeDir;
  process.env.XDG_DATA_HOME = xdgDataHome;

  try {
    return await fn({ tempRoot, homeDir, xdgDataHome });
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('registry migration fallback', () => {
  test('restores legacy populated registry when preferred registry is empty', async () => {
    await withTempHomes(async ({ homeDir, xdgDataHome }) => {
      const legacyDir = path.join(homeDir, '.drone');
      const preferredDir = path.join(xdgDataHome, 'drone');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.mkdirSync(preferredDir, { recursive: true });

      const legacyRegistry = {
        version: 2,
        drones: {
          'drone-1': {
            id: 'drone-1',
            name: 'alpha',
            containerName: 'drone-1',
            containerPort: 7777,
            token: 'token',
            repoPath: '/tmp/repo',
            createdAt: '2026-03-03T00:00:00.000Z',
          },
        },
        pending: {},
      };
      fs.writeFileSync(path.join(legacyDir, 'registry.json'), JSON.stringify(legacyRegistry, null, 2), 'utf8');
      fs.writeFileSync(path.join(preferredDir, 'registry.json'), JSON.stringify({ version: 2, drones: {}, pending: {} }, null, 2), 'utf8');

      const loaded = await loadRegistry();
      expect(Object.keys(loaded.drones)).toHaveLength(1);
      expect(loaded.drones['drone-1']?.name).toBe('alpha');

      const migrated = JSON.parse(fs.readFileSync(path.join(preferredDir, 'registry.json'), 'utf8'));
      expect(Object.keys(migrated?.drones ?? {})).toHaveLength(1);
      expect(migrated?.drones?.['drone-1']?.name).toBe('alpha');
    });
  });

  test('migrates legacy v1 registry into v2 and writes preferred file', async () => {
    await withTempHomes(async ({ homeDir, xdgDataHome }) => {
      const legacyDir = path.join(homeDir, '.drone');
      const preferredDir = path.join(xdgDataHome, 'drone');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.mkdirSync(preferredDir, { recursive: true });

      const v1Registry = {
        version: 1,
        drones: {
          alpha: {
            name: 'alpha',
            containerPort: 7777,
            token: 'token',
            repoPath: '/tmp/repo',
            createdAt: '2026-03-03T00:00:00.000Z',
          },
        },
      };
      fs.writeFileSync(path.join(legacyDir, 'registry.json'), JSON.stringify(v1Registry, null, 2), 'utf8');

      const loaded = await loadRegistry();
      expect(loaded.version).toBe(2);
      expect(Object.keys(loaded.drones)).toHaveLength(1);
      const first = Object.values(loaded.drones)[0] as any;
      expect(String(first?.name ?? '')).toBe('alpha');
      expect(String(first?.id ?? '')).not.toHaveLength(0);

      const migrated = JSON.parse(fs.readFileSync(path.join(preferredDir, 'registry.json'), 'utf8'));
      expect(migrated?.version).toBe(2);
      expect(Object.keys(migrated?.drones ?? {})).toHaveLength(1);
    });
  });
});
