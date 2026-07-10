import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';

import { getHubDatabaseDiagnostics, resetHubDatabaseForTests } from '../src/host/hub-database';
import { resetDroneRootDirForTests } from '../src/host/paths';

test('hub database diagnostics and reset remain safe when the native binding is unavailable to Bun', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-database-bun-'));
  const previous = process.env.DRONE_DATA_DIR;
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  resetDroneRootDirForTests();

  try {
    const diagnostics = getHubDatabaseDiagnostics();
    expect(diagnostics.path).toBe(path.join(root, 'data', 'hub.sqlite'));
    if (!diagnostics.available) {
      expect(diagnostics.failureKind).toBe('native-binding');
      expect(diagnostics.unavailableReason).toBeTruthy();
      expect(fs.existsSync(path.join(root, 'data', 'hub.sqlite'))).toBe(false);
    }
    await resetHubDatabaseForTests();
    await resetHubDatabaseForTests();
  } finally {
    await resetHubDatabaseForTests();
    if (previous == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previous;
    resetDroneRootDirForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
