const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { afterEach, test } = require('node:test');

const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { createRegistryBackup } = require('../../dist/host/registry-backups.js');
const {
  buildHubStateProjection,
  compactRegistryChatActivity,
} = require('../../dist/host/hub-state-projection.js');
const { getHubSettingsRepository } = require('../../dist/host/hub-settings-repository.js');
const { getCatalogStore } = require('../../dist/host/catalog-store.js');
const { getDroneLifecycleRepository } = require('../../dist/host/drone-lifecycle-repository.js');
const { getPromptQueueRepository } = require('../../dist/host/prompt-queue-repository.js');
const { CanonicalRegistryMutationError } = require('../../dist/host/legacy-residual-state.js');
const { loadRegistry, saveRegistry, updateRegistry } = require('../../dist/host/registry.js');
const { readRegistryJsonFromSqlite } = require('../../dist/host/sqlite-registry-store.js');
const {
  deleteActiveChatFromStore,
  readChatFromStore,
  upsertTranscriptTurnInStore,
} = require('../../dist/hub/transcript-store.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const roots = [];
const execFileAsync = promisify(execFile);

function useRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-projection-${label}-`));
  roots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  resetDroneRootDirForTests();
  return process.env.DRONE_DATA_DIR;
}

function seedRegistry() {
  return {
    version: 2,
    settings: {
      filesystem: { uploadMaxBytes: 123, updatedAt: '2026-01-01T00:00:00.000Z' },
      openai: { apiKey: 'stale-key', updatedAt: '2026-01-01T00:00:00.000Z' },
      agentMessageAutoContinue: { prompt: 'continue', enabledByDefault: true },
      agentSuggestion: { enabledByDefault: true },
      syncSets: { items: [] },
    },
    skills: {
      skill: {
        id: 'skill', slug: 'skill', name: 'Skill', description: 'legacy skill',
        markdownBody: '', files: [], createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
    mcpServers: {}, mcpTokens: {}, playbooks: {}, repos: {},
    groups: { stale: { name: 'stale', createdAt: '2026-01-01T00:00:00.000Z' } },
    pending: {}, archived: {},
    drones: {
      alpha: {
        id: 'alpha', name: 'Legacy Alpha', containerName: 'legacy-alpha', runtime: 'container',
        token: 'token', containerPort: 7777, createdAt: '2026-01-01T00:00:00.000Z',
        chats: {
          default: {
            createdAt: '2026-01-01T00:00:00.000Z',
            agentMessageAutoContinueEnabled: true,
            agentSuggestionEnabled: true,
            agentCopilotHandledSourceMessageIds: ['alpha:turn-1'],
            turns: [{
              id: 'legacy-follow-up-turn',
              at: '2026-01-01T00:00:00.000Z',
              prompt: 'continue',
              ok: true,
              output: 'done',
              activity: {
                version: 1,
                source: 'codex',
                updatedAt: '2026-01-01T00:00:30.000Z',
                messages: [{ id: 'activity-1', role: 'assistant', content: 'transient detail' }],
              },
              agentMessageAutoContinue: { status: 'classified' },
              agentSuggestion: { usedDirectAt: '2026-01-01T00:01:00.000Z' },
            }],
          },
          review: {
            createdAt: '2026-01-01T00:00:00.000Z',
            turns: [],
            pendingPrompts: [{ id: 'review-prompt', at: '2026-01-01T00:01:00.000Z', prompt: 'review this', state: 'queued' }],
          },
        },
        archivedChats: {
          review: {
            createdAt: '2026-01-01T00:00:00.000Z',
            turns: [{ id: 'archived-turn', at: '2026-01-01T00:01:00.000Z', prompt: 'review', ok: true, output: 'done' }],
            archivedAt: '2026-01-02T00:00:00.000Z',
            deleteAt: '2026-01-03T00:00:00.000Z',
            archiveRetention: '1d',
          },
        },
      },
    },
  };
}

async function seedCanonicalActivityTurn() {
  await upsertTranscriptTurnInStore({
    droneId: 'alpha',
    chatName: 'default',
    turn: {
      id: 'activity-turn',
      at: '2026-01-01T00:02:00.000Z',
      prompt: 'activity',
      ok: true,
      output: 'done',
      activity: {
        version: 1,
        source: 'codex',
        updatedAt: '2026-01-01T00:02:30.000Z',
        messages: [{ id: 'activity-2', role: 'assistant', content: 'transient detail' }],
      },
    },
  });
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('projection backfills once, then canonical columns and tombstones win', async () => {
  useRoot('precedence');
  await saveRegistry(seedRegistry());

  const first = await buildHubStateProjection();
  assert.equal(first.skills.skill.description, 'legacy skill');
  assert.equal(Object.values(first.groups).find((group) => group.name === 'stale')?.name, 'stale');
  assert.ok(first.drones.alpha.chats.default);
  assert.equal(first.drones.alpha.chats.review.pendingPrompts[0].id, 'review-prompt');
  assert.equal(first.drones.alpha.archivedChats.review.turns[0].id, 'archived-turn');
  assert.equal(first.settings.agentMessageAutoContinue, undefined);
  assert.equal(first.settings.agentSuggestion, undefined);
  assert.equal(first.drones.alpha.chats.default.agentMessageAutoContinueEnabled, undefined);
  assert.equal(first.drones.alpha.chats.default.agentSuggestionEnabled, undefined);
  assert.equal(first.drones.alpha.chats.default.agentCopilotHandledSourceMessageIds, undefined);
  assert.equal(first.drones.alpha.chats.default.turns[0].agentMessageAutoContinue, undefined);
  assert.equal(first.drones.alpha.chats.default.turns[0].agentSuggestion, undefined);

  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.upsert('real', 'alpha', {
    ...first.drones.alpha,
    name: 'Canonical Alpha',
    containerName: 'canonical-alpha',
    runtime: 'host',
    phase: 'ready',
  });
  const catalog = await getCatalogStore();
  await catalog.deleteGroup('', 'stale');
  const settings = await getHubSettingsRepository();
  await settings.put('filesystem', null);
  await settings.put('api-key.openai', null);

  const projected = await buildHubStateProjection();
  assert.equal(projected.drones.alpha.name, 'Canonical Alpha');
  assert.equal(projected.drones.alpha.containerName, 'canonical-alpha');
  assert.equal(projected.drones.alpha.runtime, 'host');
  assert.equal(projected.drones.alpha.phase, 'ready');
  assert.equal(Object.values(projected.groups).some((group) => group.name === 'stale'), false);
  assert.equal(projected.settings.filesystem, undefined);
  assert.equal(projected.settings.openai, undefined);
  assert.equal(projected.settings.canonical, undefined);

  await deleteActiveChatFromStore({ droneId: 'alpha', chatName: 'review' });
  const afterChatDelete = await buildHubStateProjection();
  assert.equal(afterChatDelete.drones.alpha.chats.review, undefined);
  assert.equal(getPromptQueueRepository().get({ droneId: 'alpha', chatName: 'review', promptId: 'review-prompt' }), null);
});

test('canonical writes and residual concurrency do not rewrite registry_json', async () => {
  useRoot('no-rewrite');
  await saveRegistry(seedRegistry());
  await loadRegistry();
  const before = readRegistryJsonFromSqlite();

  const catalog = await getCatalogStore();
  await catalog.putGroup({
    id: 'grp_canonical',
    repoPath: '',
    name: 'canonical',
    label: 'canonical',
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await Promise.all(Array.from({ length: 40 }, () => updateRegistry((registry) => {
    registry.settings ??= {};
    registry.settings.residualCounter = Number(registry.settings.residualCounter ?? 0) + 1;
  })));

  assert.equal(readRegistryJsonFromSqlite(), before);
  assert.equal((await loadRegistry()).settings.residualCounter, 40);
  const Database = require('better-sqlite3');
  const db = new Database(path.join(process.env.DRONE_DATA_DIR, 'hub.sqlite'), { readonly: true });
  try {
    const residualJson = db.prepare(
      "SELECT state_json FROM legacy_residual_state WHERE id='current'",
    ).get().state_json;
    const residual = JSON.parse(residualJson);
    assert.equal(residual.drones, undefined);
    assert.equal(residual.pending, undefined);
    assert.equal(residual.archived, undefined);
    assert.equal(residual.skills, undefined);
    assert.equal(residual.playbookRunQueue, undefined);
    assert.equal(residual.settings.residualCounter, 40);
    assert.equal(residualJson.includes('chats'), false);
    assert.ok(Buffer.byteLength(residualJson) < 1_000);
  } finally {
    db.close();
  }
});

test('manual backup exports canonical projection state', async () => {
  const dataDir = useRoot('backup');
  await saveRegistry(seedRegistry());
  await buildHubStateProjection();
  await seedCanonicalActivityTurn();
  const lifecycle = await getDroneLifecycleRepository();
  await lifecycle.patch('real', 'alpha', (entry) => ({ ...entry, name: 'Backup Canonical Alpha' }));
  const settings = await getHubSettingsRepository();
  await settings.put('api-key.openai', { apiKey: 'canonical-key' });

  const manifest = await createRegistryBackup('manual', { force: true });
  assert.ok(manifest);
  const exportPath = path.isAbsolute(manifest.paths.registryJson)
    ? manifest.paths.registryJson
    : path.join(dataDir, manifest.paths.registryJson);
  const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  assert.equal(exported.drones.alpha.name, 'Backup Canonical Alpha');
  assert.equal(exported.settings.openai.apiKey, 'canonical-key');
  assert.deepEqual(exported.drones.alpha.chats.default.turns[1].activity, {
    updatedAt: '2026-01-01T00:02:30.000Z',
  });
});

test('scheduled-backup projection compacts transient chat activity', async () => {
  useRoot('compact-backup');
  await saveRegistry(seedRegistry());
  await buildHubStateProjection();
  await seedCanonicalActivityTurn();

  const projected = await buildHubStateProjection(undefined, { compactChatActivity: true });

  assert.deepEqual(projected.drones.alpha.chats.default.turns[1].activity, {
    updatedAt: '2026-01-01T00:02:30.000Z',
  });
});

test('compact first-run projection imports full-fidelity legacy activity before exporting', async () => {
  useRoot('compact-first-run');
  const legacy = seedRegistry();

  const projected = await buildHubStateProjection(legacy, { compactChatActivity: true });
  const stored = readChatFromStore({ droneId: 'alpha', chatName: 'default' }).chat;
  const projectedLegacyTurn = projected.drones.alpha.chats.default.turns
    .find((turn) => turn.id === 'legacy-follow-up-turn');
  const storedLegacyTurn = stored.turns.find((turn) => turn.id === 'legacy-follow-up-turn');

  assert.deepEqual(projectedLegacyTurn.activity, {
    updatedAt: '2026-01-01T00:00:30.000Z',
  });
  assert.equal(storedLegacyTurn.activity.messages[0].content, 'transient detail');
});

test('registry activity compaction covers every lifecycle and chat bucket without mutating its input', () => {
  const activity = {
    updatedAt: '2026-01-01T00:02:30.000Z',
    messages: [{ id: 'large-transient-message' }],
  };
  const registry = {
    version: 2,
    drones: {
      real: {
        chats: { default: { turns: [{ id: 'real-turn', activity }] } },
        archivedChats: { old: { pendingPrompts: [{ id: 'real-prompt', activity }] } },
      },
    },
    pending: {
      pending: { chats: { default: { pendingPrompts: [{ id: 'pending-prompt', activity }] } } },
    },
    archived: {
      archived: { chats: { default: { turns: [{ id: 'archived-turn', activity }] } } },
    },
  };

  const compacted = compactRegistryChatActivity(registry);

  assert.deepEqual(compacted.drones.real.chats.default.turns[0].activity, {
    updatedAt: activity.updatedAt,
  });
  assert.deepEqual(compacted.drones.real.archivedChats.old.pendingPrompts[0].activity, {
    updatedAt: activity.updatedAt,
  });
  assert.deepEqual(compacted.pending.pending.chats.default.pendingPrompts[0].activity, {
    updatedAt: activity.updatedAt,
  });
  assert.deepEqual(compacted.archived.archived.chats.default.turns[0].activity, {
    updatedAt: activity.updatedAt,
  });
  assert.equal(registry.drones.real.chats.default.turns[0].activity.messages.length, 1);
});

test('Node updateRegistry rejects canonical-owned mutations without changing canonical state', async () => {
  useRoot('ownership-guard');
  await saveRegistry(seedRegistry());
  const before = await loadRegistry();

  await assert.rejects(
    updateRegistry((registry) => {
      registry.drones.alpha.name = 'forbidden';
      registry.settings.openai = { apiKey: 'forbidden' };
    }),
    (error) => {
      assert.ok(error instanceof CanonicalRegistryMutationError);
      assert.ok(error.paths.includes('drones'));
      assert.ok(error.paths.includes('settings.openai'));
      return true;
    },
  );

  const after = await loadRegistry();
  assert.equal(after.drones.alpha.name, before.drones.alpha.name);
  assert.equal(after.settings.openai.apiKey, before.settings.openai.apiKey);
});

test('independent Node processes preserve distinct canonical lifecycle creates', async () => {
  useRoot('cross-process');
  await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {} });
  const lifecycleModule = path.join(__dirname, '../../dist/host/drone-lifecycle-repository.js');
  const script = `
    const { getDroneLifecycleRepository } = require(process.argv[1]);
    const id = process.argv[2];
    getDroneLifecycleRepository().then((repository) => repository.commitUpsert('real', id, {
        id, name: id, containerName: 'drone-' + id, runtime: 'container',
        token: id, containerPort: 7777, createdAt: '2026-01-01T00:00:00.000Z'
      }, { topic: 'drone.lifecycle.changes', eventType: 'test.created' }))
      .then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
  `;
  await Promise.all([
    execFileAsync(process.execPath, ['-e', script, lifecycleModule, 'process-a'], { env: process.env }),
    execFileAsync(process.execPath, ['-e', script, lifecycleModule, 'process-b'], { env: process.env }),
  ]);
  const projected = await loadRegistry();
  assert.equal(projected.drones['process-a'].name, 'process-a');
  assert.equal(projected.drones['process-b'].name, 'process-b');
});

test('independent Node processes enforce canonical active display-name uniqueness', async () => {
  useRoot('cross-process-name');
  await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {} });
  const lifecycleModule = path.join(__dirname, '../../dist/host/drone-lifecycle-repository.js');
  const script = `
    const { getDroneLifecycleRepository } = require(process.argv[1]);
    const id = process.argv[2];
    getDroneLifecycleRepository().then((repository) => repository.commitUpsert('real', id, {
        id, name: 'shared-name', containerName: 'drone-' + id, runtime: 'container',
        token: id, containerPort: 7777, createdAt: '2026-01-01T00:00:00.000Z'
      }, { topic: 'drone.lifecycle.changes', eventType: 'test.created' }))
      .then(() => process.exit(0), (error) => { console.error(error.message); process.exit(2); });
  `;
  const attempts = await Promise.allSettled([
    execFileAsync(process.execPath, ['-e', script, lifecycleModule, 'same-a'], { env: process.env }),
    execFileAsync(process.execPath, ['-e', script, lifecycleModule, 'same-b'], { env: process.env }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
  const projected = await loadRegistry();
  assert.equal(Object.values(projected.drones).filter((drone) => drone.name === 'shared-name').length, 1);
});
