import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import {
  createDroneRuntime,
  DroneRuntimeContainerExistsError,
  type DroneRuntimeCreationDeps,
} from '../src/hub/drone-runtime-creation-service';

describe('drone runtime creation service', () => {
  test('creates a container in-process and copies only the daemon runtime payload', async () => {
    const createdContainers: any[] = [];
    const copiedFiles: Array<{ source: string; destination: string }> = [];
    const persistedEntries: any[] = [];
    const startedSessions: any[] = [];
    const healthChecks: any[] = [];
    const phaseTimings: string[] = [];

    const deps: Partial<DroneRuntimeCreationDeps> = {
      assertRuntimeReady: async () => {},
      assertContainerRuntimeReady: async () => {},
      allocateHostPorts: async () => [41_000, 41_001, 41_002, 41_003, 41_004, 41_005, 41_006],
      createContainer: async (containerName, options) => {
        createdContainers.push({ containerName, options });
      },
      getContainerPorts: async () => [{ hostPort: 41_000, containerPort: 7777 }],
      execContainer: async () => ({ code: 0, stdout: '', stderr: '' }),
      copyToContainer: async (_containerName, source, destination) => {
        copiedFiles.push({ source, destination });
      },
      sessionStart: async (...args) => {
        startedSessions.push(args);
      },
      waitForHealth: async (hostPort, token) => {
        healthChecks.push({ hostPort, token });
      },
      loadRegistry: async () => ({ version: 1, drones: {}, pending: {} }) as any,
      persistRealDroneEntry: async (droneId, entry) => {
        persistedEntries.push({ droneId, entry });
      },
    };

    const result = await createDroneRuntime(
      {
        name: 'Runtime service test',
        runtime: 'container',
        repoPath: '/repo',
        containerPort: 7777,
        droneId: '11111111-2222-4333-8444-555555555555',
        persistVolume: false,
        onPhaseTiming: (phase) => phaseTimings.push(phase),
      },
      deps,
    );

    expect(result).toMatchObject({
      ok: true,
      id: '11111111-2222-4333-8444-555555555555',
      runtime: 'container',
      name: 'Runtime service test',
      containerName: 'drone-11111111-2222-4333-8444-555555555555',
      hostPort: 41_000,
      containerPort: 7777,
    });
    expect(createdContainers).toHaveLength(1);
    expect(createdContainers[0].options.persist).toBe(false);
    expect(copiedFiles).toHaveLength(1);
    expect(path.basename(copiedFiles[0].source)).toBe('container-runtime');
    expect(copiedFiles[0].destination).toBe('/dvm-data/drone/dist');
    expect(startedSessions).toHaveLength(1);
    expect(healthChecks).toHaveLength(1);
    expect(healthChecks[0]).toMatchObject({ hostPort: 41_000 });
    expect(persistedEntries).toHaveLength(1);
    expect(persistedEntries[0]).toMatchObject({
      droneId: '11111111-2222-4333-8444-555555555555',
      entry: {
        runtime: 'container',
        repoPath: '/repo',
        persistVolume: false,
      },
    });
    expect(phaseTimings).toEqual([
      'validateArtifacts',
      'allocatePorts',
      'createContainer',
      'resolveHostPort',
      'ensureCwd',
      'writeToken',
      'copyDaemonRuntime',
      'removeRetiredClis',
      'installBlipCli',
      'startDaemon',
      'waitForDaemon',
      'ensureGroup',
      'persistLifecycle',
    ]);
  });

  test('removes a newly created container when initialization fails', async () => {
    const removedContainers: string[] = [];
    const deps: Partial<DroneRuntimeCreationDeps> = {
      assertRuntimeReady: async () => {},
      assertContainerRuntimeReady: async () => {},
      allocateHostPorts: async () => [42_000, 42_001, 42_002, 42_003, 42_004, 42_005, 42_006],
      createContainer: async () => {},
      getContainerPorts: async () => [{ hostPort: 42_000, containerPort: 7777 }],
      execContainer: async () => ({ code: 0, stdout: '', stderr: '' }),
      copyToContainer: async () => {},
      sessionStart: async () => {},
      waitForHealth: async () => {
        throw new Error('daemon failed to start');
      },
      removeContainer: async (containerName) => {
        removedContainers.push(containerName);
      },
    };

    await expect(
      createDroneRuntime(
        {
          name: 'Cleanup test',
          runtime: 'container',
          repoPath: '',
          containerPort: 7777,
          droneId: '22222222-2222-4222-8222-222222222222',
        },
        deps,
      ),
    ).rejects.toThrow('daemon failed to start');
    expect(removedContainers).toEqual(['drone-22222222-2222-4222-8222-222222222222']);
  });

  test('does not let a timing observer change creation behavior', async () => {
    const deps: Partial<DroneRuntimeCreationDeps> = {
      assertRuntimeReady: async () => {},
      assertContainerRuntimeReady: async () => {},
      allocateHostPorts: async () => [43_000, 43_001, 43_002, 43_003, 43_004, 43_005, 43_006],
      createContainer: async () => {},
      getContainerPorts: async () => [{ hostPort: 43_000, containerPort: 7777 }],
      execContainer: async () => ({ code: 0, stdout: '', stderr: '' }),
      copyToContainer: async () => {},
      sessionStart: async () => {},
      waitForHealth: async () => {},
      loadRegistry: async () => ({ version: 1, drones: {}, pending: {} }) as any,
      persistRealDroneEntry: async () => {},
    };

    const result = await createDroneRuntime(
      {
        name: 'Timing observer test',
        runtime: 'container',
        repoPath: '',
        containerPort: 7777,
        droneId: '33333333-3333-4333-8333-333333333333',
        onPhaseTiming: () => {
          throw new Error('observer failed');
        },
      },
      deps,
    );
    expect(result.ok).toBe(true);
  });

  test('distinguishes an existing destination container from other already-exists errors', async () => {
    const removedContainers: string[] = [];
    const deps: Partial<DroneRuntimeCreationDeps> = {
      assertRuntimeReady: async () => {},
      assertContainerRuntimeReady: async () => {},
      allocateHostPorts: async () => [44_000, 44_001, 44_002, 44_003, 44_004, 44_005, 44_006],
      createContainer: async () => {
        throw new Error('Container drone-existing already exists');
      },
      removeContainer: async (containerName) => {
        removedContainers.push(containerName);
      },
    };

    const creation = createDroneRuntime(
      {
        name: 'Existing destination',
        runtime: 'container',
        repoPath: '',
        containerPort: 7777,
        droneId: '44444444-4444-4444-8444-444444444444',
      },
      deps,
    );
    await expect(creation).rejects.toBeInstanceOf(DroneRuntimeContainerExistsError);
    expect(removedContainers).toEqual([]);
  });

  test('cleans up a created container instead of importing it after a display-name collision', async () => {
    const removedContainers: string[] = [];
    const deps: Partial<DroneRuntimeCreationDeps> = {
      assertRuntimeReady: async () => {},
      assertContainerRuntimeReady: async () => {},
      allocateHostPorts: async () => [45_000, 45_001, 45_002, 45_003, 45_004, 45_005, 45_006],
      createContainer: async () => {},
      getContainerPorts: async () => [{ hostPort: 45_000, containerPort: 7777 }],
      execContainer: async () => ({ code: 0, stdout: '', stderr: '' }),
      copyToContainer: async () => {},
      sessionStart: async () => {},
      waitForHealth: async () => {},
      loadRegistry: async () =>
        ({
          version: 1,
          pending: {},
          drones: { other: { id: 'other', name: 'Duplicate name' } },
        }) as any,
      removeContainer: async (containerName) => {
        removedContainers.push(containerName);
      },
    };

    const error = await createDroneRuntime(
      {
        name: 'Duplicate name',
        runtime: 'container',
        repoPath: '',
        containerPort: 7777,
        droneId: '55555555-5555-4555-8555-555555555555',
      },
      deps,
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DroneRuntimeContainerExistsError);
    expect(error.message).toBe('drone already exists: Duplicate name');
    expect(removedContainers).toEqual(['drone-55555555-5555-4555-8555-555555555555']);
  });

  test('stops a host daemon when cwd setup fails after launch', async () => {
    const stoppedPids: number[] = [];
    const deps: Partial<DroneRuntimeCreationDeps> = {
      assertRuntimeReady: async () => {},
      allocateHostPort: async () => 46_000,
      hostCommandExists: async () => true,
      launchHostDaemon: async () => 46_123,
      stopHostDaemon: async (pid) => {
        stoppedPids.push(pid);
      },
    };

    const creation = createDroneRuntime(
      {
        name: 'Host cleanup',
        runtime: 'host',
        repoPath: '/path/that/does/not/exist/drone-host-cleanup',
        containerPort: 7777,
        droneId: '66666666-6666-4666-8666-666666666666',
      },
      deps,
    );
    await expect(creation).rejects.toThrow('cwd does not exist');
    expect(stoppedPids).toEqual([46_123]);
  });
});
