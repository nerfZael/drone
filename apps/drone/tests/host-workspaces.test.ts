import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { updateRegistry } from '../src/host/registry';
import { createAssistantFilesystemService } from '../src/hub/assistant-filesystem-service';
import { hostDroneWorkspacePath } from '../src/host/runtime';
import {
  buildHostWorkspaces,
  hostWorkspaceId,
  hostWorkspaceRoot,
  listHostWorkspaces,
} from '../src/hub/assistant/host-workspaces';
import { withTempDroneDataDir } from './test-helpers';

test('registered repositories support host file operations without a drone and reject paths outside the workspace', async () => {
  await withTempDroneDataDir('host-workspace-files-', async (dataDir) => {
    const root = path.join(dataDir, 'project');
    const outside = path.join(dataDir, 'outside');
    await fs.mkdir(root);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not selected');
    await fs.symlink(outside, path.join(root, 'linked'));
    await updateRegistry((registry) => {
      registry.repos = { [root]: { path: root, addedAt: new Date().toISOString() } };
    });
    const workspaces = await listHostWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({
      id: hostWorkspaceId(root),
      repository: true,
      path: root,
    });
    const files = createAssistantFilesystemService({
      nonRepoHomeCwd: '/',
      droneRuntime: (drone) => drone.runtime,
      defaultDroneHomeCwd: hostWorkspaceRoot,
      normalizeDroneCwdForRuntime: (drone, raw) =>
        path.resolve(hostWorkspaceRoot(drone), String(raw || '.')),
      hostMimeType: async () => 'text/plain',
      listHostFsDirectory: async () => {
        throw new Error('unused');
      },
      isRepoAttachedDrone: (drone) => Boolean(drone.repoPath),
      droneRepoPathInContainer: () => {
        throw new Error('unexpected container');
      },
      withReadonlyDroneContainer: async () => {
        throw new Error('unexpected container');
      },
      withLockedDroneContainer: async () => {
        throw new Error('unexpected container');
      },
    });
    const droneId = workspaces[0].id;
    await files.assistantWriteDroneFile({ droneId, path: 'hello.txt', content: 'hello' });
    expect((await files.assistantReadDroneFile({ droneId, path: 'hello.txt' })).content).toBe(
      'hello',
    );
    await files.assistantBatchDroneFiles({
      droneId,
      operations: [
        { type: 'move', fromPath: 'hello.txt', toPath: 'renamed.txt' },
        { type: 'write', path: 'next.txt', content: 'next' },
      ],
    });
    expect(await fs.readFile(path.join(root, 'renamed.txt'), 'utf8')).toBe('hello');
    const chunk = await files.assistantReadDroneFileChunk({
      droneId,
      path: 'next.txt',
      offset: 1,
      length: 2,
    });
    expect(Buffer.from(chunk.dataBase64, 'base64').toString()).toBe('ex');
    for (const target of [
      path.join(outside, 'secret.txt'),
      '../outside/secret.txt',
      'linked/secret.txt',
      'linked/new/nested.txt',
    ]) {
      await expect(files.assistantReadDroneFile({ droneId, path: target })).rejects.toThrow(
        'selected workspace',
      );
      await expect(
        files.assistantWriteDroneFile({ droneId, path: target, content: 'denied' }),
      ).rejects.toThrow('selected workspace');
    }
    expect(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('not selected');
    await expect(
      files.assistantReadDroneFile({ droneId: hostWorkspaceId(outside), path: 'secret.txt' }),
    ).rejects.toThrow();
  });
});

test('names a host drone private workspace after the drone and keeps shared folders by path', () => {
  const privateRoot = hostDroneWorkspacePath('drone-a');
  const workspaces = buildHostWorkspaces(
    [
      { id: 'drone-a', name: 'Falcon', runtime: 'host', cwd: privateRoot },
      { id: 'drone-b', name: 'Hawk', runtime: 'host', cwd: '/work/shared' },
      { id: 'drone-c', name: 'Kite', runtime: 'host', cwd: '/work/shared' },
    ],
    [],
  );
  expect(
    workspaces.find((workspace) => workspace.path === path.resolve(privateRoot)),
  ).toMatchObject({ name: 'Falcon', droneName: 'Falcon', repository: false });
  const shared = workspaces.find((workspace) => workspace.path === path.resolve('/work/shared'));
  expect(shared).toMatchObject({ name: 'shared' });
  expect(shared?.droneName).toBeUndefined();
  expect(workspaces).toHaveLength(2);
});
