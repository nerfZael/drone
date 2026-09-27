const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, mock, test } = require('node:test');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const registry = require('../../dist/host/registry.js');
const { getLegacyResidualStateRepository } = require('../../dist/host/legacy-residual-state.js');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository.js');
const { resolveCanonicalDroneOrPendingForReadRef } = require('../../dist/hub/drone-lifecycle-service.js');
const { LocalCheckoutService } = require('../../dist/hub/local-checkout-service.js');
const { readLocalCheckoutState, writeLocalCheckoutState } = require('../../dist/hub/local-checkout-store.js');

const originalDataDir = process.env.DRONE_DATA_DIR;
const roots = [];
const emptyRegistry = { version: 2, drones: {}, pending: {} };
const inactive = { autoUpdates: 'off', session: null, updatedAt: null };
const session = {
  droneId: 'alpha', droneName: 'Alpha', repoRoot: '/repo', returnRef: 'main',
  returnSha: '1'.repeat(40), returnDetached: false, snapshotSha: '2'.repeat(40),
  snapshotKind: 'commit', sourceHeadSha: '2'.repeat(40), sourceTreeSha: 'a'.repeat(40),
  sourceDirtyFileCount: 0, activatedAt: '2026-09-26T20:00:00Z', updatedAt: '2026-09-26T20:00:00Z',
};

function useRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-checkout-store-'));
  roots.push(root);
  process.env.DRONE_DATA_DIR = root;
  resetDroneRootDirForTests();
}

afterEach(async () => {
  mock.restoreAll();
  await resetHubDatabaseForTests();
  if (originalDataDir === undefined) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function forbidFleetHydration() {
  for (const method of ['loadRegistry', 'loadRegistryCompatibilityBase', 'loadRegistryRawSnapshot', 'updateRegistry']) {
    mock.method(registry, method, () => { throw new Error(`Checkout must not call ${method}`); });
  }
}

test('migrates an existing checkout once and never revives stale legacy settings', async () => {
  useRoot();
  const active = { autoUpdates: 'commits', session, updatedAt: session.updatedAt };
  const seed = mock.method(registry, 'loadRegistryRawSnapshot', async () => ({
    ...emptyRegistry, settings: { localCheckout: active, unrelated: { keep: true } },
  }));
  assert.deepEqual(await readLocalCheckoutState(), active);
  await writeLocalCheckoutState(inactive);
  assert.deepEqual(await readLocalCheckoutState(), inactive);
  assert.equal(seed.mock.callCount(), 1);
  assert.deepEqual(getLegacyResidualStateRepository().read().settings.unrelated, { keep: true });
});

test('first write seeds legacy residual settings and concurrent writes preserve unrelated state', async () => {
  useRoot();
  mock.method(registry, 'loadRegistryRawSnapshot', async () => ({
    ...emptyRegistry, settings: { unrelated: { keep: true } },
  }));
  await writeLocalCheckoutState({ autoUpdates: 'commits', session, updatedAt: session.updatedAt });
  forbidFleetHydration();
  const repository = getLegacyResidualStateRepository();
  await Promise.all([
    writeLocalCheckoutState(inactive),
    repository.update(emptyRegistry, (state) => { state.settings.unrelated.concurrent = true; }),
  ]);
  assert.deepEqual(await readLocalCheckoutState(), inactive);
  assert.deepEqual(repository.read().settings.unrelated, { keep: true, concurrent: true });
});

test('commits-only activation, repeated updates, mode changes and return never hydrate fleet histories', async () => {
  useRoot();
  const repository = getLegacyResidualStateRepository();
  await repository.seedIfAbsent({ ...emptyRegistry, settings: { localCheckout: inactive } });
  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.backfillLegacyInsertOnly({
    ...emptyRegistry,
    drones: { alpha: {
      id: 'alpha', name: 'Alpha', runtime: 'container', containerName: 'alpha',
      repoPath: '/repo', repo: { dest: '/work/repo' },
    } },
    pending: { starting: { id: 'starting', name: 'Starting', phase: 'creating' } },
  });
  // Fail deterministically if the checkout ever loads/clones the fleet. This
  // guards against history-size-dependent OOM without exhausting the test host.
  forbidFleetHydration();
  let head = session.returnSha;
  let sourceHead = session.sourceHeadSha;
  const service = new LocalCheckoutService({
    readState: readLocalCheckoutState,
    writeState: writeLocalCheckoutState,
    resolveDroneRef: resolveCanonicalDroneOrPendingForReadRef,
    droneRuntime: (drone) => drone.runtime,
    droneRootPath: () => { throw new Error('Snapshot already exists locally'); },
    gitTopLevel: async (repo) => repo,
    gitIsClean: async () => true,
    gitResolveCommitSha: async (_repo, sha) => sha,
    updateHostRef: async () => {},
    importBundleHeadToHostRef: async () => { throw new Error('Unexpected import'); },
    dvmRepoExport: async () => { throw new Error('Unexpected export'); },
    dvmExec: async () => ({ code: 0, stderr: '', stdout:
      `DRONE_LOCAL_SNAPSHOT\t${sourceHead}\t${session.sourceTreeSha}\t${sourceHead}\t0\t${session.returnSha}\n` }),
    runHostCommand: async (_command, args) => {
      const gitArgs = args.slice(2);
      let stdout = '';
      if (gitArgs[0] === 'rev-parse' && gitArgs[1] === 'HEAD') stdout = head;
      else if (gitArgs[0] === 'symbolic-ref') stdout = 'main';
      else if (gitArgs[0] === 'checkout') head = gitArgs.at(-1) === 'main' ? session.returnSha : gitArgs.at(-1);
      return { code: 0, stdout, stderr: '' };
    },
    nowIso: () => new Date().toISOString(),
  });

  await assert.rejects(service.useLocally('missing'), { code: 'drone_not_found' });
  await assert.rejects(service.useLocally('starting'), { code: 'drone_not_found' });
  const active = await service.useLocally('Alpha', { autoUpdates: 'commits' });
  assert.equal(active.autoUpdates, 'commits');
  assert.equal(active.session.droneId, 'alpha');
  sourceHead = '3'.repeat(40);
  assert.equal((await service.update()).changed, true);
  for (let i = 0; i < 20; i++) assert.equal((await service.update()).changed, false);
  assert.equal((await service.getView()).session.snapshotSha, sourceHead);
  assert.equal((await service.setAutoUpdates('all')).autoUpdates, 'all');
  assert.equal((await service.setAutoUpdates('commits')).autoUpdates, 'commits');
  assert.equal((await service.returnToOriginal()).session, null);
  assert.equal(head, session.returnSha);
  assert.equal((await readLocalCheckoutState()).autoUpdates, 'off');
});
