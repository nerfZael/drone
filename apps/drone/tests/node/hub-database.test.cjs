const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');
const Database = require('better-sqlite3');

const {
  applyHubDatabaseMigrations,
  getHubDatabaseDiagnostics,
  requireHubDatabase,
  resetHubDatabaseForTests,
} = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const tempRoots = [];

function tempDroneDataDir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `drone-hub-database-${label}-`));
  tempRoots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function useDroneDataDir(dataDir) {
  process.env.DRONE_DATA_DIR = dataDir;
  resetDroneRootDirForTests();
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('hub database foundation', () => {
  test('applies versioned migrations idempotently and reports configured pragmas', async () => {
    useDroneDataDir(tempDroneDataDir('migrations'));
    const database = requireHubDatabase();

    database.read((connection) => applyHubDatabaseMigrations(connection));
    database.read((connection) => applyHubDatabaseMigrations(connection));

    const migrations = database.read((connection) =>
      connection
        .prepare('SELECT scope, version, name FROM hub_schema_migrations ORDER BY scope, version')
        .all(),
    );
    assert.deepEqual(migrations, [{ scope: 'core', version: 1, name: 'hub database foundation' }]);

    const diagnostics = getHubDatabaseDiagnostics();
    assert.deepEqual(
      {
        available: diagnostics.available,
        failureKind: diagnostics.failureKind,
        schemaVersion: diagnostics.schemaVersion,
        appliedMigrationCount: diagnostics.appliedMigrationCount,
        journalMode: diagnostics.journalMode,
        synchronous: diagnostics.synchronous,
        busyTimeoutMs: diagnostics.busyTimeoutMs,
        foreignKeys: diagnostics.foreignKeys,
      },
      {
        available: true,
        failureKind: null,
        schemaVersion: 1,
        appliedMigrationCount: 1,
        journalMode: 'wal',
        synchronous: 1,
        busyTimeoutMs: 10_000,
        foreignKeys: true,
      },
    );

    await resetHubDatabaseForTests();
    const reopened = requireHubDatabase();
    assert.deepEqual(
      reopened.read((connection) =>
        connection.prepare('SELECT COUNT(*) AS count FROM hub_schema_migrations').get(),
      ),
      { count: 1 },
    );
  });

  test('tracks domain migration versions independently', () => {
    const connection = new Database(':memory:');
    try {
      applyHubDatabaseMigrations(
        connection,
        [
          {
            version: 1,
            name: 'create prompt probe',
            migrate(db) {
              db.exec('CREATE TABLE prompt_probe (value TEXT NOT NULL)');
            },
          },
        ],
        'prompts',
      );
      applyHubDatabaseMigrations(
        connection,
        [
          {
            version: 1,
            name: 'create assistant probe',
            migrate(db) {
              db.exec('CREATE TABLE assistant_probe (value TEXT NOT NULL)');
            },
          },
        ],
        'assistant',
      );

      assert.deepEqual(
        connection
          .prepare('SELECT scope, version FROM hub_schema_migrations ORDER BY scope, version')
          .all(),
        [
          { scope: 'assistant', version: 1 },
          { scope: 'prompts', version: 1 },
        ],
      );
    } finally {
      connection.close();
    }
  });

  test('accepts an explicitly declared legacy name without rerunning the migration', () => {
    const connection = new Database(':memory:');
    try {
      let migrationRuns = 0;
      applyHubDatabaseMigrations(
        connection,
        [
          {
            version: 1,
            name: 'old migration name',
            migrate(db) {
              db.exec('CREATE TABLE legacy_name_probe (value TEXT NOT NULL)');
            },
          },
        ],
        'legacy-name-probe',
      );

      applyHubDatabaseMigrations(
        connection,
        [
          {
            version: 1,
            name: 'canonical migration name',
            legacyNames: ['old migration name'],
            migrate() {
              migrationRuns += 1;
            },
          },
        ],
        'legacy-name-probe',
      );

      assert.equal(migrationRuns, 0);
      assert.deepEqual(
        connection
          .prepare(
            "SELECT name FROM hub_schema_migrations WHERE scope = 'legacy-name-probe' AND version = 1",
          )
          .get(),
        { name: 'old migration name' },
      );
    } finally {
      connection.close();
    }
  });

  test('still rejects an undeclared migration rename', () => {
    const connection = new Database(':memory:');
    try {
      applyHubDatabaseMigrations(
        connection,
        [{ version: 1, name: 'original name', migrate() {} }],
        'rename-probe',
      );
      assert.throws(
        () =>
          applyHubDatabaseMigrations(
            connection,
            [{ version: 1, name: 'unexpected name', migrate() {} }],
            'rename-probe',
          ),
        /was applied as "original name", not "unexpected name"/,
      );
    } finally {
      connection.close();
    }
  });

  test('rolls back the complete migration batch when a migration fails', () => {
    const connection = new Database(':memory:');
    try {
      assert.throws(
        () =>
          applyHubDatabaseMigrations(connection, [
            {
              version: 1,
              name: 'create migration probe',
              migrate(db) {
                db.exec('CREATE TABLE migration_probe (value TEXT NOT NULL)');
              },
            },
            {
              version: 2,
              name: 'fail migration batch',
              migrate() {
                throw new Error('intentional migration failure');
              },
            },
          ]),
        /intentional migration failure/,
      );
      assert.deepEqual(
        connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('hub_schema_migrations', 'migration_probe')",
          )
          .all(),
        [],
      );
    } finally {
      connection.close();
    }
  });

  test('starts queued write transactions in FIFO order', async () => {
    useDroneDataDir(tempDroneDataDir('fifo'));
    const database = requireHubDatabase();
    await database.writeTransaction('create queue probe', (connection) => {
      connection.exec(
        'CREATE TABLE queue_probe (ordinal INTEGER NOT NULL PRIMARY KEY, label TEXT NOT NULL)',
      );
    });

    const executionOrder = [];
    const writes = ['first', 'second', 'third'].map((label, index) =>
      database.writeTransaction(label, (connection) => {
        executionOrder.push(label);
        connection
          .prepare('INSERT INTO queue_probe (ordinal, label) VALUES (?, ?)')
          .run(index, label);
        return label;
      }),
    );

    assert.equal(database.diagnostics().queuedWrites, 3);
    assert.deepEqual(await Promise.all(writes), ['first', 'second', 'third']);
    assert.deepEqual(executionOrder, ['first', 'second', 'third']);
    assert.deepEqual(
      database.read((connection) =>
        connection.prepare('SELECT label FROM queue_probe ORDER BY ordinal').all(),
      ),
      [{ label: 'first' }, { label: 'second' }, { label: 'third' }],
    );
  });

  test('rolls back a failed callback and continues processing later writes', async () => {
    useDroneDataDir(tempDroneDataDir('rollback'));
    const database = requireHubDatabase();
    await database.writeTransaction('create rollback probe', (connection) => {
      connection.exec('CREATE TABLE rollback_probe (value TEXT NOT NULL)');
    });

    await assert.rejects(
      database.writeTransaction('failing write', (connection) => {
        connection.prepare('INSERT INTO rollback_probe (value) VALUES (?)').run('rolled back');
        throw new Error('intentional failure');
      }),
      /intentional failure/,
    );

    await database.writeTransaction('write after failure', (connection) => {
      connection.prepare('INSERT INTO rollback_probe (value) VALUES (?)').run('committed');
    });
    assert.deepEqual(
      database.read((connection) => connection.prepare('SELECT value FROM rollback_probe').all()),
      [{ value: 'committed' }],
    );
  });

  test('switches cached connections when DRONE_DATA_DIR changes', async () => {
    const firstDir = tempDroneDataDir('data-dir-a');
    const secondDir = tempDroneDataDir('data-dir-b');
    useDroneDataDir(firstDir);
    const first = requireHubDatabase();
    await first.writeTransaction('write first database', (connection) => {
      connection.exec('CREATE TABLE data_dir_probe (value TEXT NOT NULL)');
      connection.prepare('INSERT INTO data_dir_probe (value) VALUES (?)').run('first');
    });

    useDroneDataDir(secondDir);
    const second = requireHubDatabase();
    assert.notEqual(second, first);
    assert.equal(second.path, path.join(secondDir, 'hub.sqlite'));
    assert.deepEqual(
      second.read((connection) =>
        connection
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'data_dir_probe'",
          )
          .get(),
      ),
      { count: 0 },
    );
    await assert.rejects(
      first.writeTransaction('stale connection write', () => undefined),
      /closing/,
    );

    await second.writeTransaction('write second database', (connection) => {
      connection.exec('CREATE TABLE data_dir_probe (value TEXT NOT NULL)');
      connection.prepare('INSERT INTO data_dir_probe (value) VALUES (?)').run('second');
    });
    assert.deepEqual(
      second.read((connection) => connection.prepare('SELECT value FROM data_dir_probe').all()),
      [{ value: 'second' }],
    );
  });

  test('distinguishes open failures from configuration failures', async () => {
    const openFailureDir = tempDroneDataDir('open-failure');
    fs.mkdirSync(path.join(openFailureDir, 'hub.sqlite'));
    useDroneDataDir(openFailureDir);
    const openFailure = getHubDatabaseDiagnostics();
    assert.deepEqual(
      {
        available: openFailure.available,
        failureKind: openFailure.failureKind,
      },
      { available: false, failureKind: 'open' },
    );

    await resetHubDatabaseForTests();
    const configurationFailureDir = tempDroneDataDir('configuration-failure');
    fs.writeFileSync(path.join(configurationFailureDir, 'hub.sqlite'), 'not a sqlite database');
    useDroneDataDir(configurationFailureDir);
    const configurationFailure = getHubDatabaseDiagnostics();
    assert.deepEqual(
      {
        available: configurationFailure.available,
        failureKind: configurationFailure.failureKind,
      },
      { available: false, failureKind: 'configuration' },
    );
  });
});
