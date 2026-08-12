import { describe, expect, test } from 'bun:test';

import { createManagedDroneStateSyncService } from '../src/hub/managed-drone-state-sync';

function createSerialLock() {
  let tail = Promise.resolve();
  return async function withDroneOpLock<T>(_key: string, run: () => Promise<T>): Promise<T> {
    const result = tail.then(run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return await result;
  };
}

describe('managed drone state sync service', () => {
  test('serializes projection reads with writes and caches the daemon capability', async () => {
    let sourceContent = 'old';
    let readCount = 0;
    let releaseFirstRead!: () => void;
    let markFirstReadStarted!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve;
    });
    const firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const appliedContents: string[] = [];
    const timingSnapshots: any[] = [];
    let healthCalls = 0;

    const service = createManagedDroneStateSyncService({
      normalizeDroneIdentity: (value) => String(value ?? '').trim(),
      droneRuntime: () => 'container',
      syncHostManagedFiles: async () => {},
      listSkills: async () => {
        readCount += 1;
        const content = sourceContent;
        if (readCount === 1) {
          markFirstReadStarted();
          await firstReadGate;
        }
        return [{ content }];
      },
      mcpServersForProjection: async () => [],
      resolveAgentsFile: async () => null,
      buildSkillTargets: () => [
        { rootPath: '/dvm-data/home/.agents/skills', agent: 'codex' },
      ],
      renderSkillPackages: (skills) => [
        {
          slug: 'example',
          files: [{ path: 'SKILL.md', content: String(skills[0]?.content ?? '') }],
        },
      ],
      buildMcpTargets: () => [],
      renderMcpProjection: () => ({
        format: 'json',
        managedNames: [],
        rootKey: 'mcpServers',
        entries: {},
      }),
      withDroneOpLock: createSerialLock(),
      daemonClientForDrone: () => ({ baseUrl: 'http://127.0.0.1:1', token: 'token' }),
      daemonHealth: async () => {
        healthCalls += 1;
        return { capabilities: ['managed-state-v1'] };
      },
      managedDroneSync: async (_client, payload) => {
        appliedContents.push(payload.skillTargets[0]?.packages[0]?.files[0]?.content ?? '');
        return { durationMs: 3.4, phases: { persistState: 1.2 } };
      },
      upgradeDaemon: async () => {
        throw new Error('upgrade should not run');
      },
      waitForDaemonReady: async () => {},
      onTiming: (timing) => timingSnapshots.push(timing),
    });
    const droneEntry = {
      hostPort: 1234,
      token: 'token',
      containerName: 'drone-test',
      containerPort: 7777,
    };

    const first = service.syncManagedFilesForDrone({ droneId: 'test', droneEntry });
    await firstReadStarted;
    sourceContent = 'new';
    const second = service.syncManagedFilesForDrone({ droneId: 'test', droneEntry });
    releaseFirstRead();
    await Promise.all([first, second]);

    expect(appliedContents).toEqual(['old', 'new']);
    expect(healthCalls).toBe(1);
    expect(timingSnapshots).toHaveLength(2);
    expect(timingSnapshots[0]).toMatchObject({
      droneId: 'test',
      runtime: 'container',
      containerName: 'drone-test',
      outcome: 'completed',
      durationMs: expect.any(Number),
      daemonApplyDurationMs: 3.4,
      daemonPhases: { persistState: 1.2 },
      phases: {
        droneLockWait: expect.any(Number),
        loadProjectionInputs: expect.any(Number),
        buildPayload: expect.any(Number),
        resolveDaemonClient: expect.any(Number),
        probeDaemonCapability: expect.any(Number),
        applyManagedStateRequest: expect.any(Number),
      },
    });
    expect(timingSnapshots[1]?.phases).not.toHaveProperty('probeDaemonCapability');
  });

  test('upgrades and verifies a daemon that lacks the managed-state capability', async () => {
    let healthCalls = 0;
    let upgradeCalls = 0;
    let readyCalls = 0;
    let syncCalls = 0;
    const service = createManagedDroneStateSyncService({
      normalizeDroneIdentity: (value) => String(value ?? '').trim(),
      droneRuntime: () => 'container',
      syncHostManagedFiles: async () => {},
      listSkills: async () => [],
      mcpServersForProjection: async () => [],
      resolveAgentsFile: async () => null,
      buildSkillTargets: () => [],
      renderSkillPackages: () => [],
      buildMcpTargets: () => [],
      renderMcpProjection: () => ({
        format: 'json',
        managedNames: [],
        rootKey: 'mcpServers',
        entries: {},
      }),
      withDroneOpLock: createSerialLock(),
      daemonClientForDrone: () => ({ baseUrl: 'http://127.0.0.1:1', token: 'token' }),
      daemonHealth: async () => {
        healthCalls += 1;
        return {
          capabilities: healthCalls === 1 ? ['workspace-v1'] : ['workspace-v1', 'managed-state-v1'],
        };
      },
      managedDroneSync: async () => {
        syncCalls += 1;
      },
      upgradeDaemon: async () => {
        upgradeCalls += 1;
      },
      waitForDaemonReady: async () => {
        readyCalls += 1;
      },
    });

    await service.syncManagedFilesForDrone({
      droneId: 'test',
      droneEntry: {
        hostPort: 1234,
        token: 'token',
        containerName: 'drone-test',
        containerPort: 7777,
      },
    });

    expect({ healthCalls, upgradeCalls, readyCalls, syncCalls }).toEqual({
      healthCalls: 2,
      upgradeCalls: 1,
      readyCalls: 1,
      syncCalls: 1,
    });
  });
});
