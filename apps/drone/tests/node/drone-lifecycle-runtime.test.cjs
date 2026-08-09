const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createDroneLifecycleRuntime } = require('../../dist/hub/drone-lifecycle-runtime.js');

function runtime(overrides = {}) {
  return createDroneLifecycleRuntime({
    cleanupQuarantineWorktree: async () => {},
    collectDockerSnapshotImageRefsFromDroneEntry: () => [],
    deleteCanonicalDroneLifecycle: async () => null,
    dequeueProvisioning: () => {},
    droneRuntime: (entry) => entry.runtime,
    dvmContainerExists: async () => false,
    dvmRemove: async () => {},
    fleetDescendantIdsForActor: () => [],
    gitTopLevel: async () => '',
    loadRegistry: async () => ({ drones: {}, pending: {} }),
    looksLikeMissingContainerError: () => false,
    normalizeDroneIdentity: (value) => String(value ?? '').trim(),
    permanentlyDeleteCanonicalDrone: async () => ({ removedLifecycle: true }),
    quarantineWorktreePath: () => '',
    removeDockerSnapshotImagesBestEffort: async () => {},
    revokeMcpAccessTokensForDrone: async () => {},
    sleepMs: async () => {},
    stopAllDroneChatActivity: async () => {},
    ...overrides,
  });
}

test('archived cleanup continues when its already-stopped daemon is unreachable', async () => {
  const lifecycle = runtime({
    stopAllDroneChatActivity: async () => {
      throw new Error('fetch failed');
    },
  });

  const result = await lifecycle.removeDroneRuntimeArtifacts({
    droneId: 'archived-a',
    droneEntry: { id: 'archived-a', runtime: 'host' },
    keepVolume: false,
    updateLiveRegistry: false,
  });

  assert.deepEqual(result, { containerGone: true, removeErr: null });
});

test('active deletion still reports chat shutdown failures', async () => {
  const lifecycle = runtime({
    stopAllDroneChatActivity: async () => {
      throw new Error('fetch failed');
    },
  });

  await assert.rejects(
    lifecycle.removeDroneRuntimeArtifacts({
      droneId: 'active-a',
      droneEntry: { id: 'active-a', runtime: 'host' },
      keepVolume: false,
      updateLiveRegistry: true,
    }),
    /fetch failed/,
  );
});
