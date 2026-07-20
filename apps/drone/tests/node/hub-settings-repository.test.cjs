const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const { getHubDatabase, resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const {
  getHubSettingsRepository,
  HubSettingVersionConflictError,
  resetHubSettingsRepositoryForTests,
} = require('../../dist/host/hub-settings-repository.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { readRegistryJsonFromSqlite } = require('../../dist/host/sqlite-registry-store.js');
const { saveRegistry, updateRegistry } = require('../../dist/host/registry.js');
const {
  resolveUiPreferencesSettingsResponse,
  clearStoredProviderApiKey,
  resolveDeleteActionSettingsResponse,
  resolveEffectiveProviderApiKeySettings,
  upsertStoredDeleteActionSettings,
  upsertStoredProviderApiKey,
  UiPreferencesSettingsConflictError,
  UiPreferencesSettingsValidationError,
  upsertStoredUiPreferencesSettings,
} = require('../../dist/hub/hub-settings.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const tempRoots = [];

function useTempDroneDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-hub-settings-${label}-`));
  tempRoots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
  return dataDir;
}

function useDroneDataDir(dataDir) {
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  resetHubSettingsRepositoryForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  if (originalOpenAiApiKey == null) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('HubSettingsRepository', () => {
  test('removes retired follow-up settings during migration', async () => {
    useTempDroneDataDir('retired-followup-settings');
    const database = getHubDatabase();
    await database.writeTransaction('seed legacy canonical settings', (connection) => {
      connection.exec(`
        CREATE TABLE hub_canonical_settings (
          setting_key TEXT NOT NULL PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT,
          version INTEGER NOT NULL CHECK (version > 0)
        );
      `);
      connection.prepare(`
        INSERT INTO hub_schema_migrations (scope, version, name, applied_at)
        VALUES ('settings', 1, 'canonical hub settings', ?)
      `).run(new Date().toISOString());
      const insert = connection.prepare(`
        INSERT INTO hub_canonical_settings (setting_key, value_json, updated_at, version)
        VALUES (?, '{}', NULL, 1)
      `);
      insert.run('agent-message-auto-continue');
      insert.run('agent-suggestion');
      insert.run('remaining-setting');
    });

    const repository = await getHubSettingsRepository();
    assert.equal(repository.get('agent-message-auto-continue'), null);
    assert.equal(repository.get('agent-suggestion'), null);
    assert.deepEqual(repository.get('remaining-setting').value, {});
  });

  test('performs concurrent read-modify-write updates without losing either change', async () => {
    useTempDroneDataDir('concurrent-update');
    const repository = await getHubSettingsRepository();
    await repository.put('concurrency-probe', { left: 0, right: 0 });

    await Promise.all([
      repository.update('concurrency-probe', (current) => ({
        ...current.value,
        left: current.value.left + 1,
      })),
      repository.update('concurrency-probe', (current) => ({
        ...current.value,
        right: current.value.right + 1,
      })),
    ]);

    assert.deepEqual(repository.get('concurrency-probe'), {
      key: 'concurrency-probe',
      value: { left: 1, right: 1 },
      updatedAt: repository.get('concurrency-probe').updatedAt,
      version: 3,
    });
  });

  test('enforces compare-and-swap versions and returns the winning row on conflict', async () => {
    useTempDroneDataDir('version-conflict');
    const repository = await getHubSettingsRepository();
    const created = await repository.put(
      'cas-probe',
      { value: 'first' },
      { expectedVersion: null },
    );
    const updated = await repository.put(
      'cas-probe',
      { value: 'second' },
      { expectedVersion: created.version },
    );

    assert.equal(updated.version, 2);
    assert.notEqual(updated.updatedAt, created.updatedAt);
    await assert.rejects(
      repository.put('cas-probe', { value: 'stale' }, { expectedVersion: created.version }),
      (error) => {
        assert.ok(error instanceof HubSettingVersionConflictError);
        assert.equal(error.expectedVersion, 1);
        assert.deepEqual(error.current.value, { value: 'second' });
        assert.equal(error.current.version, 2);
        return true;
      },
    );
  });

  test('rolls back a failed atomic setting transform', async () => {
    useTempDroneDataDir('rollback');
    const repository = await getHubSettingsRepository();
    await repository.put('rollback-probe', { value: 'before' });

    await assert.rejects(
      repository.update('rollback-probe', () => {
        throw new Error('intentional settings failure');
      }),
      /intentional settings failure/,
    );
    assert.deepEqual(repository.get('rollback-probe').value, { value: 'before' });
    assert.equal(repository.get('rollback-probe').version, 1);
  });
});

describe('remaining canonical Hub settings', () => {
  test('imports a legacy secret once, gives canonical state precedence, and tombstones clears', async () => {
    useTempDroneDataDir('secret-migration');
    delete process.env.OPENAI_API_KEY;
    await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {}, settings: {
      openai: {
        apiKey: 'legacy-openai-key',
        updatedAt: '2026-01-02T03:04:05.000Z',
      },
    } });

    const migrated = await resolveEffectiveProviderApiKeySettings('openai');
    assert.equal(migrated.apiKey, 'legacy-openai-key');
    assert.equal(migrated.updatedAt, '2026-01-02T03:04:05.000Z');
    const repository = await getHubSettingsRepository();
    assert.equal(repository.get('api-key.openai').version, 1);

    await assert.rejects(
      updateRegistry((registry) => {
        registry.settings.openai = {
          apiKey: 'newer-legacy-value-must-not-win',
          updatedAt: '2027-01-02T03:04:05.000Z',
        };
      }),
      /cannot mutate canonical-owned state: settings\.openai/,
    );
    assert.equal((await resolveEffectiveProviderApiKeySettings('openai')).apiKey, 'legacy-openai-key');
    assert.equal(repository.get('api-key.openai').version, 1);

    await clearStoredProviderApiKey('openai');
    assert.equal((await resolveEffectiveProviderApiKeySettings('openai')).apiKey, null);
    assert.equal(repository.get('api-key.openai').value, null);
    assert.equal(repository.get('api-key.openai').version, 2);

    await resetHubDatabaseForTests();
    resetHubSettingsRepositoryForTests();
    assert.equal((await resolveEffectiveProviderApiKeySettings('openai')).apiKey, null);
    assert.equal((await getHubSettingsRepository()).get('api-key.openai').version, 2);
  });

  test('preserves partial-update API behavior while importing legacy composite values', async () => {
    useTempDroneDataDir('delete-action-api');
    await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {}, settings: {
      deleteAction: {
        mode: 'archive',
        archiveRetention: '1w',
        archiveRuntimePolicy: 'keep-running',
        updatedAt: '2026-02-03T04:05:06.000Z',
      },
    } });

    await upsertStoredDeleteActionSettings({ archiveRuntimePolicy: 'stop' });
    const response = await resolveDeleteActionSettingsResponse();
    assert.deepEqual(
      {
        mode: response.deleteAction.mode,
        archiveRetention: response.deleteAction.archiveRetention,
        archiveRuntimePolicy: response.deleteAction.archiveRuntimePolicy,
      },
      { mode: 'archive', archiveRetention: '1w', archiveRuntimePolicy: 'stop' },
    );
    assert.equal((await getHubSettingsRepository()).get('delete-action').version, 2);
  });

  test('switches repository state with DRONE_DATA_DIR', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-hub-settings-switch-'));
    tempRoots.push(root);
    const firstDir = path.join(root, 'first');
    const secondDir = path.join(root, 'second');
    fs.mkdirSync(firstDir, { recursive: true });
    fs.mkdirSync(secondDir, { recursive: true });
    delete process.env.OPENAI_API_KEY;

    useDroneDataDir(firstDir);
    await upsertStoredProviderApiKey('openai', 'first-key');
    useDroneDataDir(secondDir);
    await upsertStoredProviderApiKey('openai', 'second-key');
    assert.equal((await resolveEffectiveProviderApiKeySettings('openai')).apiKey, 'second-key');
    useDroneDataDir(firstDir);
    assert.equal((await resolveEffectiveProviderApiKeySettings('openai')).apiKey, 'first-key');
  });
});

describe('canonical UI preferences settings', () => {
  test('preserves the existing default response before anything is stored', async () => {
    useTempDroneDataDir('defaults');
    const resolved = await resolveUiPreferencesSettingsResponse();

    assert.equal(resolved.updatedAt, null);
    assert.equal(resolved.version, null);
    assert.equal(resolved.uiPreferences.sidebarGroupingMode, 'groups');
    assert.deepEqual(resolved.uiPreferences.sidebarGroupOrder, []);
    assert.equal(resolved.uiPreferences.autoDelete, false);
    assert.equal(resolved.uiPreferences.spawnAgentKey, 'builtin:cursor');
    assert.equal(resolved.uiPreferences.spawnModel, '');
    assert.equal(resolved.uiPreferences.repoBranchSource, 'host');
    assert.equal(resolved.uiPreferences.repoCreateRemoteBranch, '');
    assert.equal(resolved.uiPreferences.pullHostBranchBeforeCreate, true);
  });

  test('backfills legacy UI preferences once and gives canonical data precedence afterward', async () => {
    useTempDroneDataDir('legacy-backfill');
    await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {}, settings: {
      uiPreferences: {
        autoDelete: true,
        spawnAgentKey: 'builtin:codex',
        updatedAt: '2026-01-02T03:04:05.000Z',
      },
    } });

    const backfilled = await resolveUiPreferencesSettingsResponse();
    assert.equal(backfilled.uiPreferences.autoDelete, true);
    assert.equal(backfilled.uiPreferences.spawnAgentKey, 'builtin:codex');
    assert.equal(backfilled.updatedAt, '2026-01-02T03:04:05.000Z');
    assert.equal(backfilled.version, 1);

    await assert.rejects(
      updateRegistry((registry) => {
        registry.settings.uiPreferences = {
          autoDelete: false,
          spawnAgentKey: 'builtin:cursor',
          updatedAt: '2027-01-02T03:04:05.000Z',
        };
      }),
      /cannot mutate canonical-owned state: settings\.uiPreferences/,
    );

    const canonical = await resolveUiPreferencesSettingsResponse();
    assert.equal(canonical.uiPreferences.autoDelete, true);
    assert.equal(canonical.uiPreferences.spawnAgentKey, 'builtin:codex');
    assert.equal(canonical.updatedAt, '2026-01-02T03:04:05.000Z');
    assert.equal(canonical.version, 1);
  });

  test('round-trips sanitized preferences without rewriting the legacy registry snapshot', async () => {
    useTempDroneDataDir('round-trip');
    await saveRegistry({ version: 2, drones: {}, pending: {}, archived: {}, settings: {
      nonRepoEnvironment: {
        vars: { PRESERVE: 'registry snapshot' },
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    } });
    const registryBefore = readRegistryJsonFromSqlite();

    await upsertStoredUiPreferencesSettings({
      sidebarGroupingMode: 'repos',
      sidebarGroupOrder: ['alpha', 'beta', 'alpha', '', '  '],
      sidebarDroneOrderByGroup: { alpha: ['drone-a', 'drone-b', 'drone-a'], '': ['ignored'] },
      sidebarChatOrderByDrone: { 'drone-a': ['default', 'review', 'default'] },
      hiddenSidebarGroups: ['archive', 'archive', ''],
      autoDelete: true,
      spawnAgentKey: 'builtin:codex',
      spawnModel: 'gpt-5.5',
      repoBranchSource: 'remote',
      repoCreateRemoteBranch: 'origin/feature/voice',
      pullHostBranchBeforeCreate: false,
    });

    const resolved = await resolveUiPreferencesSettingsResponse();
    assert.equal(resolved.version, 1);
    assert.equal(resolved.uiPreferences.sidebarGroupingMode, 'repos');
    assert.deepEqual(resolved.uiPreferences.sidebarGroupOrder, ['alpha', 'beta']);
    assert.deepEqual(resolved.uiPreferences.sidebarDroneOrderByGroup, {
      alpha: ['drone-a', 'drone-b'],
    });
    assert.deepEqual(resolved.uiPreferences.sidebarChatOrderByDrone, {
      'drone-a': ['default', 'review'],
    });
    assert.deepEqual(resolved.uiPreferences.hiddenSidebarGroups, ['archive']);
    assert.equal(resolved.uiPreferences.autoDelete, true);
    assert.equal(resolved.uiPreferences.spawnAgentKey, 'builtin:codex');
    assert.equal(resolved.uiPreferences.spawnModel, 'gpt-5.5');
    assert.equal(resolved.uiPreferences.repoBranchSource, 'remote');
    assert.equal(resolved.uiPreferences.repoCreateRemoteBranch, 'origin/feature/voice');
    assert.equal(resolved.uiPreferences.pullHostBranchBeforeCreate, false);
    assert.equal(readRegistryJsonFromSqlite(), registryBefore);
  });

  test('offers additive version-based conflict handling while preserving unconditional writes', async () => {
    useTempDroneDataDir('ui-conflict');
    await upsertStoredUiPreferencesSettings({ autoDelete: false });
    const first = await resolveUiPreferencesSettingsResponse();
    await upsertStoredUiPreferencesSettings({ autoDelete: true }, first.version);
    const second = await resolveUiPreferencesSettingsResponse();
    assert.equal(second.version, 2);
    assert.equal(second.uiPreferences.autoDelete, true);

    await assert.rejects(
      upsertStoredUiPreferencesSettings({ autoDelete: false }, first.version),
      (error) => {
        assert.ok(error instanceof UiPreferencesSettingsConflictError);
        assert.equal(error.version, 2);
        assert.equal(error.uiPreferences.autoDelete, true);
        return true;
      },
    );

    await upsertStoredUiPreferencesSettings({ autoDelete: false });
    const unconditional = await resolveUiPreferencesSettingsResponse();
    assert.equal(unconditional.version, 3);
    assert.equal(unconditional.uiPreferences.autoDelete, false);

    await assert.rejects(
      upsertStoredUiPreferencesSettings({ autoDelete: true }, 0),
      UiPreferencesSettingsValidationError,
    );
  });
});
