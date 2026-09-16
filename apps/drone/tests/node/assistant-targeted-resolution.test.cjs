const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const registry = require('../../dist/host/registry.js');
const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { upsertCanonicalDroneLifecycle } = require('../../dist/hub/drone-lifecycle-service.js');
const { HubAssistantService } = require('../../dist/hub/assistant.js');
const { createAssistantFilesystemService } = require('../../dist/hub/assistant-filesystem-service.js');

test('assistant authorization and file reads resolve canonical targets without hydrating chat history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-targeted-'));
  const originalDir = process.env.DRONE_DATA_DIR;
  const originalLoad = registry.loadRegistry;
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  resetDroneRootDirForTests();
  try {
    await upsertCanonicalDroneLifecycle('real', 'worker-id', {
      id: 'worker-id', name: 'worker', runtime: 'host', cwd: root,
    });
    await upsertCanonicalDroneLifecycle('pending', 'pending-id', {
      id: 'pending-id', name: 'starting worker', runtime: 'container',
    });
    registry.loadRegistry = async () => { throw new Error('full registry must not be read'); };
    const scope = { allowedDroneIdSet: () => new Set(['worker-id']) };
    const authorize = (ref) => HubAssistantService.prototype.requireDroneInScope.call(scope, ref, 'read', 'thread');
    assert.equal(await authorize('worker'), 'worker-id');
    assert.equal(await authorize('worker-id'), 'worker-id');
    await assert.rejects(authorize('starting worker'), /scope does not include/);
    await assert.rejects(authorize('missing'), /unknown drone/);
    await assert.rejects(authorize(''), /missing drone id/);
    scope.allowedDroneIdSet = () => new Set();
    await assert.rejects(authorize('worker'), /scope does not include/);

    const file = path.join(root, 'sample.txt');
    fs.writeFileSync(file, 'first\nsecond\n');
    const service = createAssistantFilesystemService({
      nonRepoHomeCwd: root, droneRuntime: d => d.runtime,
      defaultDroneHomeCwd: () => root, normalizeDroneCwdForRuntime: (_, cwd) => cwd,
      hostMimeType: async () => 'text/plain',
    });
    const result = await service.assistantReadDroneFile({ droneId: 'worker', path: file, startLine: 2, endLine: 2 });
    assert.equal(result.droneId, 'worker-id');
    assert.match(result.content, /second/);
    assert.doesNotMatch(result.content, /first/);
    await assert.rejects(service.assistantReadDroneFile({ droneId: 'starting worker', path: file }), /still starting/);
    await assert.rejects(service.assistantReadDroneFile({ droneId: 'missing', path: file }), /unknown drone/);
  } finally {
    registry.loadRegistry = originalLoad;
    await resetHubDatabaseForTests();
    if (originalDir === undefined) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = originalDir;
    resetDroneRootDirForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
