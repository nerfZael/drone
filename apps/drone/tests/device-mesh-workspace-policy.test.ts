import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { MeshDevice } from '@drone/device-protocol';
import { CrossDeviceAssistantPolicyStore } from '../src/hub/device-mesh/features/cross-device-assistant/policy-store';
import { createWorkspaceCapability } from '../src/hub/device-mesh/features/cross-device-assistant/workspace-capability';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('cross-device workspace policy', () => {
  test('requires an exact home, thread, root, and access match', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-workspace-policy-'));
    tempDirs.push(directory);
    const workspace = path.join(directory, 'workspace');
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, 'hello.txt'), 'hello mesh\n');
    const workspaceAlias = path.join(directory, 'workspace-alias');
    await fs.symlink(workspace, workspaceAlias, 'dir');
    const policies = new CrossDeviceAssistantPolicyStore(path.join(directory, 'policy.json'));
    await policies.replace({
      roots: [{ id: 'main-project', label: 'Main project', path: workspaceAlias }],
      homeTargets: [],
      targetRules: [
        {
          assistantHomeDeviceId: 'device_vps',
          threadId: 'thread_1',
          rootId: 'main-project',
          read: true,
          write: true,
        },
      ],
    });
    const capability = createWorkspaceCapability(policies);
    const sourceDevice = {
      id: 'device_vps',
      name: 'VPS',
      platform: 'server',
      publicKey: {},
      administrator: false,
      grants: [],
      endpoints: [],
      revokedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as MeshDevice;
    const actor = {
      assistantHomeDeviceId: sourceDevice.id,
      threadId: 'thread_1',
      rootId: 'main-project',
      read: true,
      write: true,
    };
    const result: any = await capability.invoke(
      'files.read',
      { actor, path: 'hello.txt' },
      { sourceDevice, requestId: 'request_1' },
    );
    expect(result.text).toContain('hello mesh');
    const listing: any = await capability.invoke(
      'files.list',
      { actor, path: '.' },
      { sourceDevice, requestId: 'request_list' },
    );
    expect(listing.details.entries[0].path).toBe('hello.txt');
    await expect(
      capability.invoke(
        'files.write',
        {
          actor,
          path: 'hello.txt',
          content: 'changed\n',
          mode: 'overwrite',
          baseHash: 'outdated-hash',
        },
        { sourceDevice, requestId: 'request_hash' },
      ),
    ).rejects.toMatchObject({ code: 'BASE_HASH_MISMATCH' });
    await fs.writeFile(path.join(workspace, 'empty.txt'), '');
    await expect(
      capability.invoke(
        'files.write',
        {
          actor,
          path: 'empty.txt',
          content: 'changed\n',
          mode: 'overwrite',
          baseHash: 'outdated-hash',
        },
        { sourceDevice, requestId: 'request_empty_hash' },
      ),
    ).rejects.toMatchObject({ code: 'BASE_HASH_MISMATCH' });
    await expect(
      capability.invoke(
        'files.read',
        { actor: { ...actor, threadId: 'thread_2' }, path: 'hello.txt' },
        { sourceDevice, requestId: 'request_2' },
      ),
    ).rejects.toMatchObject({ code: 'THREAD_POLICY_DENIED' });
    await expect(
      capability.invoke(
        'files.read',
        { actor, path: '../outside.txt' },
        { sourceDevice, requestId: 'request_3' },
      ),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
  });
});
