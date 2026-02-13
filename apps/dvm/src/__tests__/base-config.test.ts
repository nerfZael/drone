import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BaseConfigManager } from '../config/base';

describe('BaseConfigManager', () => {
  const originalXdgDataHome = process.env.XDG_DATA_HOME;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dvm-base-config-'));
    process.env.XDG_DATA_HOME = tempRoot;
    fs.mkdirSync(path.join(tempRoot, 'dvm'), { recursive: true });
  });

  afterEach(() => {
    if (originalXdgDataHome == null) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('persists, reads, and resets the selected base container', async () => {
    const manager = new BaseConfigManager();

    expect(await manager.getBase()).toBeNull();
    expect(await manager.hasBase()).toBe(false);

    await manager.setBase('drone-base', 'ubuntu:latest');

    expect(await manager.getBase()).toEqual({
      containerName: 'drone-base',
      image: 'ubuntu:latest',
    });
    expect(await manager.hasBase()).toBe(true);

    await manager.resetBase();

    expect(await manager.getBase()).toBeNull();
    expect(await manager.hasBase()).toBe(false);
  });
});
