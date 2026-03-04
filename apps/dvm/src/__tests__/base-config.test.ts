import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BaseConfigManager } from '../config/base';

describe('BaseConfigManager', () => {
  const originalXdgDataHome = process.env.XDG_DATA_HOME;
  const originalHome = process.env.HOME;
  let tempRoot = '';
  let tempHome = '';
  let tempXdgDataHome = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dvm-base-config-'));
    tempHome = path.join(tempRoot, 'home');
    tempXdgDataHome = path.join(tempRoot, 'xdg-data');
    process.env.HOME = tempHome;
    process.env.XDG_DATA_HOME = tempXdgDataHome;
    fs.mkdirSync(path.join(tempHome, '.dvm'), { recursive: true });
    fs.mkdirSync(path.join(tempXdgDataHome, 'dvm'), { recursive: true });
  });

  afterEach(() => {
    if (originalXdgDataHome == null) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
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
