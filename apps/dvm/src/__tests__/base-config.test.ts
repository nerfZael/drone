import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetDvmRootDirForTests } from '../hostPaths';
import { BaseConfigManager } from '../config/base';

describe('BaseConfigManager', () => {
  const originalXdgDataHome = process.env.XDG_DATA_HOME;
  const originalHome = process.env.HOME;
  const originalDvmDataDir = process.env.DVM_DATA_DIR;
  let tempRoot = '';
  let tempHome = '';
  let tempXdgDataHome = '';
  let tempDvmDataDir = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dvm-base-config-'));
    tempHome = path.join(tempRoot, 'home');
    tempXdgDataHome = path.join(tempRoot, 'xdg-data');
    tempDvmDataDir = path.join(tempRoot, 'data', 'dvm');
    process.env.HOME = tempHome;
    process.env.XDG_DATA_HOME = tempXdgDataHome;
    process.env.DVM_DATA_DIR = tempDvmDataDir;
    fs.mkdirSync(path.join(tempHome, '.dvm'), { recursive: true });
    fs.mkdirSync(path.join(tempXdgDataHome, 'dvm'), { recursive: true });
    fs.mkdirSync(tempDvmDataDir, { recursive: true });
    resetDvmRootDirForTests();
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
    if (originalDvmDataDir == null) {
      delete process.env.DVM_DATA_DIR;
    } else {
      process.env.DVM_DATA_DIR = originalDvmDataDir;
    }
    resetDvmRootDirForTests();
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
