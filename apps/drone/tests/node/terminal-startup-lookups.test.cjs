const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const registry = require('../../dist/host/registry.js');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { resolveDroneOrRejectUpgrade } = require('../../dist/hub/terminal-websocket-upgrade.js');
const { patchCanonicalDroneLifecycle } = require('../../dist/hub/drone-lifecycle-service.js');
const {
  resolveCanonicalDroneEnvironmentConfig,
  upsertCanonicalNonRepoEnvironmentConfig,
} = require('../../dist/hub/environment-config.js');
const { updateCanonicalRepositoryEnvironment } = require('../../dist/hub/groups-repositories.js');

test('terminal startup resolves current lifecycle and environment without projecting the full registry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-startup-lookups-'));
  const previousDataDir = process.env.DRONE_DATA_DIR;
  const originalLoadRegistry = registry.loadRegistry;
  process.env.DRONE_DATA_DIR = root;
  resetDroneRootDirForTests();
  try {
    await registry.saveRegistry({
      version: 2,
      drones: {
        host: {
          id: 'host',
          name: 'host worker',
          runtime: 'host',
          hostPort: 1234,
          token: 'host-token',
        },
        container: {
          id: 'container',
          name: 'container worker',
          runtime: 'container',
          containerName: 'drone-container',
          hostPort: 5678,
          token: 'container-token',
          repoPath: '/tmp/repo',
          environment: {
            useRepoVars: true,
            disabledRepoKeys: ['EXCLUDED'],
            vars: { OVERRIDE: 'drone' },
          },
          chats: { default: { turns: [{ prompt: 'unrelated transcript' }] } },
        },
      },
      pending: {
        starting: {
          id: 'starting',
          name: 'starting worker',
          runtime: 'container',
          phase: 'starting',
        },
      },
      archived: {},
      repos: {
        '/tmp/repo': {
          path: '/tmp/repo',
          addedAt: '2026-09-10T00:00:00.000Z',
          environment: { vars: { INHERITED: 'repo', EXCLUDED: 'hidden', OVERRIDE: 'repo' } },
        },
      },
      settings: { nonRepoEnvironment: { vars: { SHARED: 'global' } } },
    });
    registry.loadRegistry = async () => {
      throw new Error('terminal startup must not project unrelated chat state');
    };
    const acceptedSocket = {
      write() {
        assert.fail('an active drone must not be rejected');
      },
      destroy() {
        assert.fail('an active drone must not be rejected');
      },
    };
    for (const [id, name, port] of [
      ['host', 'host worker', 1234],
      ['container', 'container worker', 5678],
    ]) {
      for (const ref of [id, name]) {
        const resolved = await resolveDroneOrRejectUpgrade(acceptedSocket, ref);
        assert.equal(resolved.id, id);
        assert.equal(resolved.drone.runtime, id);
        assert.equal(resolved.drone.hostPort, port);
        assert.equal(resolved.drone.token, `${id}-token`);
        assert.equal(Object.hasOwn(resolved.drone, 'chats'), false);
      }
    }
    for (const [ref, status] of [
      ['starting', '409 Conflict'],
      ['starting worker', '409 Conflict'],
      ['missing', '404 Not Found'],
    ]) {
      let response = '';
      let destroyed = false;
      const resolved = await resolveDroneOrRejectUpgrade(
        {
          write(value) {
            response += value;
          },
          destroy() {
            destroyed = true;
          },
        },
        ref,
      );
      assert.equal(resolved, null);
      assert.equal(response, `HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      assert.equal(destroyed, true);
    }
    const container = (await resolveDroneOrRejectUpgrade(acceptedSocket, 'container')).drone;
    assert.equal(container.containerName, 'drone-container');
    assert.deepEqual((await resolveCanonicalDroneEnvironmentConfig(container)).resolvedVars, {
      INHERITED: 'repo',
      OVERRIDE: 'drone',
    });
    assert.deepEqual(
      (await resolveCanonicalDroneEnvironmentConfig({ environment: { useRepoVars: true } }))
        .resolvedVars,
      {
        SHARED: 'global',
      },
    );
    assert.deepEqual(
      (
        await resolveCanonicalDroneEnvironmentConfig({
          ...container,
          environment: { useRepoVars: false, vars: { ONLY: 'local' } },
        })
      ).resolvedVars,
      { ONLY: 'local' },
    );

    // A subsequent attach/open must see edits immediately, without a stale cache.
    await patchCanonicalDroneLifecycle('real', 'container', (entry) => ({
      ...entry,
      hostPort: 6789,
      token: 'new-token',
    }));
    const updated = await resolveDroneOrRejectUpgrade(acceptedSocket, 'container');
    assert.equal(updated.drone.hostPort, 6789);
    assert.equal(updated.drone.token, 'new-token');
    await updateCanonicalRepositoryEnvironment('/tmp/repo', { vars: { INHERITED: 'updated' } });
    assert.deepEqual((await resolveCanonicalDroneEnvironmentConfig(container)).resolvedVars, {
      INHERITED: 'updated',
      OVERRIDE: 'drone',
    });
    await upsertCanonicalNonRepoEnvironmentConfig({
      vars: { SHARED: 'updated' },
      autoApplyToNewContainerDrones: false,
    });
    assert.deepEqual(
      (await resolveCanonicalDroneEnvironmentConfig({ environment: { useRepoVars: true } }))
        .resolvedVars,
      {
        SHARED: 'updated',
      },
    );
  } finally {
    registry.loadRegistry = originalLoadRegistry;
    await resetHubDatabaseForTests();
    if (previousDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
