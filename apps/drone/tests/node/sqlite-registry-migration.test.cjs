const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('registry migrates one time to SQLite, keeps a backup, and removes registry.json', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-node-sqlite-registry-'));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  const previousDroneDataDir = process.env.DRONE_DATA_DIR;
  fs.mkdirSync(droneDataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = droneDataDir;

  const { resetDroneRootDirForTests } = require('../../dist/host/paths');
  resetDroneRootDirForTests();

  t.after(() => {
    if (previousDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const registryPath = path.join(droneDataDir, 'registry.json');
  const originalRegistry = {
    version: 2,
    settings: {
      openai: { apiKey: 'old-key', updatedAt: '2026-06-07T00:00:00.000Z' },
    },
    skills: {
      skillA: { label: 'Skill A' },
    },
    playbooks: {
      pb1: {
        id: 'pb1',
        label: 'Playbook 1',
        agent: { kind: 'builtin', id: 'cursor' },
        messages: [{ id: 'm1', prompt: 'do it' }],
        createdAt: '2026-06-07T00:00:00.000Z',
      },
    },
    repos: {
      '/repo': { path: '/repo', addedAt: '2026-06-07T00:00:00.000Z' },
    },
    groups: {
      alpha: { name: 'alpha', createdAt: '2026-06-07T00:00:00.000Z' },
    },
    playbookRunQueue: {
      items: [
        {
          id: 'queue-1',
          playbookId: 'pb1',
          playbookLabel: 'Playbook 1',
          repoPath: '/repo',
          requestedCount: 1,
          launchedCount: 0,
          inFlightCount: 0,
          serializeFirstMessageGroup: false,
          pullHostBranchBeforeCreate: false,
          createdAt: '2026-06-07T00:00:00.000Z',
          updatedAt: '2026-06-07T00:00:00.000Z',
        },
      ],
    },
    pending: {
      pending1: {
        id: 'pending1',
        name: 'pending one',
        containerName: 'drone-pending1',
        repoPath: '/repo',
        containerPort: 7777,
        build: false,
        createdAt: '2026-06-07T00:00:00.000Z',
        phase: 'starting',
      },
    },
    archived: {
      archived1: {
        id: 'archived1',
        name: 'archived one',
        containerName: 'drone-archived1',
        containerPort: 7777,
        token: 'archived-token',
        repoPath: '/repo',
        createdAt: '2026-06-07T00:00:00.000Z',
        archivedAt: '2026-06-07T01:00:00.000Z',
        deleteAt: '2026-06-08T01:00:00.000Z',
        archiveRetention: '1d',
      },
    },
    drones: {
      drone1: {
        id: 'drone1',
        name: 'drone one',
        containerName: 'drone-drone1',
        hostPort: 5175,
        containerPort: 7777,
        token: 'token',
        repoPath: '/repo',
        group: 'alpha',
        createdAt: '2026-06-07T00:00:00.000Z',
        chats: {
          default: {
            createdAt: '2026-06-07T00:00:00.000Z',
            turns: [
              {
                id: 'turn-2',
                at: '2026-06-07T00:02:00.000Z',
                promptAt: '2026-06-07T00:02:00.000Z',
                prompt: 'second',
                ok: true,
                output: 'two',
              },
              {
                id: 'turn-1',
                at: '2026-06-07T00:01:00.000Z',
                promptAt: '2026-06-07T00:01:00.000Z',
                prompt: 'first',
                ok: true,
                output: 'one',
              },
            ],
          },
        },
      },
    },
  };
  fs.writeFileSync(registryPath, JSON.stringify(originalRegistry, null, 2), 'utf8');

  const { loadRegistry, updateRegistry } = require('../../dist/host/registry');
  const loaded = await loadRegistry();
  assert.equal(loaded.drones.drone1.name, 'drone one');

  const sqlitePath = path.join(droneDataDir, 'hub.sqlite');
  assert.equal(fs.existsSync(sqlitePath), true);

  const backups = fs.readdirSync(droneDataDir).filter((name) => /^registry\.backup-before-sqlite-.*\.json$/.test(name));
  assert.equal(backups.length, 1);
  const backup = JSON.parse(fs.readFileSync(path.join(droneDataDir, backups[0]), 'utf8'));
  assert.equal(backup.drones.drone1.name, 'drone one');
  assert.equal(fs.existsSync(registryPath), false);

  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_registry_state').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_drones').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_pending_drones').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_archived_drones').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_settings').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_repos').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_groups').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_playbooks').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_skills').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_playbook_run_queue_items').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hub_chats').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transcript_turns').get().count, 2);
    const prompts = db
      .prepare('SELECT prompt FROM transcript_turns WHERE drone_id = ? AND chat_name = ? ORDER BY ordinal ASC')
      .all('drone1', 'default')
      .map((row) => row.prompt);
    assert.deepEqual(prompts, ['first', 'second']);
  } finally {
    db.close();
  }

  fs.writeFileSync(
    registryPath,
    JSON.stringify({ version: 2, drones: { fileOnly: { id: 'fileOnly', name: 'file only' } }, pending: {} }, null, 2),
    'utf8',
  );
  const afterFileEdit = await loadRegistry();
  assert.equal(afterFileEdit.drones.drone1.name, 'drone one');
  assert.equal(afterFileEdit.drones.fileOnly, undefined);
  assert.equal(fs.existsSync(registryPath), false);

  await assert.rejects(() => updateRegistry((reg) => {
    reg.settings = reg.settings ?? {};
    reg.settings.openai = { apiKey: 'new-key', updatedAt: '2026-06-07T00:01:00.000Z' };
    reg.drones.drone2 = { id: 'drone2', name: 'drone two' };
  }), /cannot mutate canonical-owned state: drones, settings\.openai/);

  assert.equal(fs.existsSync(registryPath), false);
  const jsonRemovalBackups = fs.readdirSync(droneDataDir).filter((name) => /^registry\.backup-before-json-removal-.*\.json$/.test(name));
  assert.equal(jsonRemovalBackups.length, 1);
  const ignoredFileBackup = JSON.parse(fs.readFileSync(path.join(droneDataDir, jsonRemovalBackups[0]), 'utf8'));
  assert.equal(ignoredFileBackup.drones.fileOnly.name, 'file only');

  const dbAfter = new Database(sqlitePath, { readonly: true });
  try {
    assert.equal(dbAfter.prepare('SELECT COUNT(*) AS count FROM hub_drones').get().count, 1);
    assert.equal(dbAfter.prepare('SELECT COUNT(*) AS count FROM hub_canonical_drones').get().count, 1);
    const state = JSON.parse(dbAfter.prepare("SELECT registry_json FROM hub_registry_state WHERE id = 'current'").get().registry_json);
    assert.equal(state.settings.openai.apiKey, 'old-key');
    assert.equal(state.drones.drone2, undefined);
    const residual = JSON.parse(dbAfter.prepare("SELECT state_json FROM legacy_residual_state WHERE id = 'current'").get().state_json);
    assert.equal(residual.drones, undefined);
    assert.equal(residual.settings?.openai, undefined);
  } finally {
    dbAfter.close();
  }
});

test('registry fails loudly when SQLite primary exists but cannot be opened', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-node-sqlite-registry-fail-'));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  const previousDroneDataDir = process.env.DRONE_DATA_DIR;
  fs.mkdirSync(droneDataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = droneDataDir;

  const { resetDroneRootDirForTests } = require('../../dist/host/paths');
  resetDroneRootDirForTests();

  t.after(() => {
    if (previousDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(droneDataDir, 'hub.sqlite'), 'not a sqlite database', 'utf8');
  fs.writeFileSync(
    path.join(droneDataDir, 'registry.json'),
    JSON.stringify(
      {
        version: 2,
        drones: {
          fallback: {
            id: 'fallback',
            name: 'fallback',
            containerName: 'drone-fallback',
            containerPort: 7777,
            token: 'token',
            repoPath: '/repo',
            createdAt: '2026-06-07T00:00:00.000Z',
          },
        },
        pending: {},
      },
      null,
      2,
    ),
    'utf8',
  );

  const { loadRegistry } = require('../../dist/host/registry');
  await assert.rejects(() => loadRegistry(), /hub SQLite registry exists but could not be opened/);
});

test('registry fails loudly when SQLite primary state is invalid', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-node-sqlite-registry-invalid-'));
  const droneDataDir = path.join(tempRoot, 'drone-data');
  const previousDroneDataDir = process.env.DRONE_DATA_DIR;
  fs.mkdirSync(droneDataDir, { recursive: true });
  process.env.DRONE_DATA_DIR = droneDataDir;

  const { resetDroneRootDirForTests } = require('../../dist/host/paths');
  resetDroneRootDirForTests();

  t.after(() => {
    if (previousDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(droneDataDir, 'registry.json'),
    JSON.stringify({ version: 2, drones: { migrated: { id: 'migrated', name: 'migrated' } }, pending: {} }, null, 2),
    'utf8',
  );

  const { loadRegistry } = require('../../dist/host/registry');
  await loadRegistry();

  const Database = require('better-sqlite3');
  const db = new Database(path.join(droneDataDir, 'hub.sqlite'));
  try {
    db.prepare("UPDATE hub_registry_state SET registry_json = ? WHERE id = 'current'").run('{"version":2,"drones":');
  } finally {
    db.close();
  }

  fs.writeFileSync(
    path.join(droneDataDir, 'registry.json'),
    JSON.stringify({ version: 2, drones: { fallback: { id: 'fallback', name: 'fallback' } }, pending: {} }, null, 2),
    'utf8',
  );

  await assert.rejects(() => loadRegistry(), /hub SQLite registry state is invalid/);
});
