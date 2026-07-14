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
  test('requires a device grant for the exact workspace and operation', async () => {
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
      deviceGrants: [
        {
          deviceId: 'device_vps',
          rootId: 'main-project',
          read: true,
          write: true,
          execute: true,
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
    const listed: any = await capability.invoke(
      'workspaces.list',
      {},
      { sourceDevice, requestId: 'request_workspaces' },
    );
    expect(listed.workspaces).toEqual([
      {
        id: 'main-project',
        name: 'Main project',
        read: true,
        write: true,
        execute: true,
      },
    ]);
    const result: any = await capability.invoke(
      'files.read',
      { workspaceId: 'main-project', path: 'hello.txt' },
      { sourceDevice, requestId: 'request_1' },
    );
    expect(result.text).toContain('hello mesh');
    const listing: any = await capability.invoke(
      'files.list',
      { workspaceId: 'main-project', path: '.' },
      { sourceDevice, requestId: 'request_list' },
    );
    expect(listing.details.entries[0].path).toBe('hello.txt');
    await expect(
      capability.invoke(
        'files.write',
        {
          workspaceId: 'main-project',
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
          workspaceId: 'main-project',
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
        { workspaceId: 'another-project', path: 'hello.txt' },
        { sourceDevice, requestId: 'request_2' },
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_POLICY_DENIED' });
    await expect(
      capability.invoke(
        'files.read',
        { workspaceId: 'main-project', path: '../outside.txt' },
        { sourceDevice, requestId: 'request_3' },
      ),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
    const command: any = await capability.invoke(
      'commands.run',
      { workspaceId: 'main-project', command: 'pwd' },
      { sourceDevice, requestId: 'request_command' },
    );
    expect(command.text.trim()).toBe(await fs.realpath(workspace));
    expect(command.details).toEqual({
      jobId: expect.any(String),
      workspaceId: 'main-project',
      status: 'completed',
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      timeoutAt: expect.any(String),
      exitCode: 0,
      signal: null,
      outputTruncated: false,
      cursor: expect.any(Number),
      chunks: expect.any(Array),
    });

    const started: any = await capability.invoke(
      'commands.start',
      {
        workspaceId: 'main-project',
        command: 'printf first; sleep 0.1; printf second',
        timeoutMs: 5_000,
      },
      { sourceDevice, requestId: 'request_command_start' },
    );
    let cursor = 0;
    let streamed = '';
    let output: any = started;
    do {
      output = await capability.invoke(
        'commands.output',
        {
          workspaceId: 'main-project',
          jobId: started.jobId,
          cursor,
          waitMs: 1_000,
        },
        { sourceDevice, requestId: `request_command_output_${cursor}` },
      );
      cursor = output.cursor;
      streamed += output.chunks.map((chunk: any) => chunk.text).join('');
    } while (output.status === 'running');
    expect(streamed).toBe('firstsecond');

    const cancellable: any = await capability.invoke(
      'commands.start',
      { workspaceId: 'main-project', command: 'sleep 30' },
      { sourceDevice, requestId: 'request_command_cancel_start' },
    );
    const cancelled: any = await capability.invoke(
      'commands.cancel',
      { workspaceId: 'main-project', jobId: cancellable.jobId },
      { sourceDevice, requestId: 'request_command_cancel' },
    );
    expect(cancelled.status).toBe('cancelled');
  });

  test('rejects ambiguous targets and empty workspace paths', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-workspace-validation-'));
    tempDirs.push(directory);
    const workspace = path.join(directory, 'workspace');
    await fs.mkdir(workspace);
    const policies = new CrossDeviceAssistantPolicyStore(path.join(directory, 'policy.json'));
    await expect(
      policies.replace({ roots: [{ id: 'missing', label: 'Missing', path: '' }] }),
    ).rejects.toMatchObject({ code: 'INVALID_POLICY' });
    await expect(
      policies.replace({
        roots: [{ id: 'main', label: 'Main', path: workspace }],
        homeTargets: [
          {
            threadId: 'thread_1',
            targetDeviceId: 'device_vps',
            rootId: 'remote',
            read: true,
          },
          {
            threadId: 'thread_1',
            targetDeviceId: 'device_vps',
            rootId: 'remote',
            read: true,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_POLICY' });
  });

  test('migrates legacy thread rules into device workspace grants', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-workspace-migration-'));
    tempDirs.push(directory);
    const workspace = path.join(directory, 'workspace');
    await fs.mkdir(workspace);
    const policyPath = path.join(directory, 'policy.json');
    await fs.writeFile(
      policyPath,
      JSON.stringify({
        version: 1,
        roots: [{ id: 'main-project', label: 'Main project', path: workspace }],
        homeTargets: [
          {
            threadId: 'thread_1',
            targetDeviceId: 'device_vps',
            rootId: 'main-project',
            read: true,
            write: false,
          },
          {
            threadId: 'thread_1',
            targetDeviceId: 'device_vps',
            rootId: 'main-project',
            read: false,
            write: true,
          },
        ],
        targetRules: [
          {
            assistantHomeDeviceId: 'device_phone',
            threadId: 'thread_1',
            rootId: 'main-project',
            read: true,
            write: false,
          },
          {
            assistantHomeDeviceId: 'device_phone',
            threadId: 'thread_2',
            rootId: 'main-project',
            read: true,
            write: true,
          },
        ],
      }),
    );
    const policy = await new CrossDeviceAssistantPolicyStore(policyPath).read();
    expect(policy.version).toBe(2);
    expect(policy.deviceGrants).toEqual([
      {
        deviceId: 'device_phone',
        rootId: 'main-project',
        read: true,
        write: true,
        execute: false,
      },
    ]);
    expect(policy.homeTargets).toEqual([
      {
        threadId: 'thread_1',
        targetDeviceId: 'device_vps',
        deviceName: 'device_vps',
        rootId: 'main-project',
        workspaceName: 'main-project',
        read: true,
        write: true,
        execute: false,
      },
    ]);
  });
});
