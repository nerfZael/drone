jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'child_process';

import { DvmApi } from '../api';
import { DockerClient } from '../docker/client';

function createMockProcess(): any {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  return proc;
}

describe('copyToContainer path handling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (spawn as jest.Mock).mockReset();
  });

  test('docker client preserves trailing dot when copying a directory', async () => {
    const mockedSpawn = spawn as jest.Mock;
    const proc = createMockProcess();
    mockedSpawn.mockReturnValue(proc);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ isDirectory: () => true } as fs.Stats);

    const client = new DockerClient();
    jest.spyOn(client, 'getContainer').mockResolvedValue({} as any);

    const copy = client.copyToContainer('demo', '/tmp/source-dir', '/work/target');
    setImmediate(() => proc.emit('exit', 0));
    await copy;

    expect(mockedSpawn).toHaveBeenCalledWith(
      'docker',
      ['cp', `${path.resolve('/tmp/source-dir')}${path.sep}.`, 'demo:/work/target'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  test('docker client skips fleet discovery for a caller-verified container', async () => {
    const mockedSpawn = spawn as jest.Mock;
    const proc = createMockProcess();
    mockedSpawn.mockReturnValue(proc);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ isDirectory: () => false } as fs.Stats);

    const client = new DockerClient();
    const getContainer = jest.spyOn(client, 'getContainer');

    const copy = client.copyToContainer('demo', '/tmp/auth.json', '/root/.codex/auth.json', {
      containerAlreadyReady: true,
    });
    setImmediate(() => proc.emit('exit', 0));
    await copy;

    expect(getContainer).not.toHaveBeenCalled();
    expect(mockedSpawn).toHaveBeenCalledWith(
      'docker',
      ['cp', '/tmp/auth.json', 'demo:/root/.codex/auth.json'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  test('api creates only the parent directory when copying a file', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dvm-copy-to-container-'));
    const srcFile = path.join(tempRoot, 'skill.json');
    fs.writeFileSync(srcFile, '{}\n', 'utf8');

    const execCommand = jest.fn(async () => '');
    const copyToContainer = jest.fn(async () => {});
    const api = new DvmApi({
      manager: {
        docker: {
          execCommand,
          copyToContainer,
        },
      } as any,
      baseConfig: {} as any,
    });

    try {
      await api.copyToContainer('demo', srcFile, '/dvm-data/home/.agents/skills/.drone-managed-skills.json');
      expect(execCommand).toHaveBeenNthCalledWith(1, 'demo', ['bash', '-lc', 'true']);
      expect(execCommand).toHaveBeenNthCalledWith(2, 'demo', [
        'bash',
        '-lc',
        'mkdir -p "/dvm-data/home/.agents/skills"',
      ]);
      expect(copyToContainer).toHaveBeenCalledWith(
        'demo',
        path.resolve(srcFile),
        '/dvm-data/home/.agents/skills/.drone-managed-skills.json',
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('api can copy directly when the caller already prepared a running container target', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dvm-copy-prepared-target-'));
    const srcFile = path.join(tempRoot, 'auth.json');
    fs.writeFileSync(srcFile, '{}\n', 'utf8');

    const execCommand = jest.fn(async () => '');
    const copyToContainer = jest.fn(async () => {});
    const api = new DvmApi({
      manager: { docker: { execCommand, copyToContainer } } as any,
      baseConfig: {} as any,
    });

    try {
      await api.copyToContainer('demo', srcFile, '/root/.codex/auth.json', {
        containerAlreadyReady: true,
        targetAlreadyPrepared: true,
      });

      expect(execCommand).not.toHaveBeenCalled();
      expect(copyToContainer).toHaveBeenCalledWith(
        'demo',
        path.resolve(srcFile),
        '/root/.codex/auth.json',
        { containerAlreadyReady: true },
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
