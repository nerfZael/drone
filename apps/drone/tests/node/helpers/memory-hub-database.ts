import BetterSqlite3 from 'better-sqlite3';

import type { HubDatabase, HubDatabaseConnection } from '../../../src/host/hub-database';

export function memoryHubDatabase(): { database: HubDatabase; close: () => void } {
  const connection = new BetterSqlite3(':memory:') as HubDatabaseConnection;
  connection.pragma('foreign_keys = ON');
  const database: HubDatabase = {
    path: ':memory:',
    openedAt: new Date().toISOString(),
    read(operation) {
      return operation(connection);
    },
    async writeTransaction(_label, operation) {
      return connection.transaction(() => operation(connection)).immediate();
    },
    diagnostics() {
      return {
        available: true,
        path: ':memory:',
        failureKind: null,
        unavailableReason: null,
        openedAt: this.openedAt,
        schemaVersion: null,
        appliedMigrationCount: null,
        journalMode: 'memory',
        synchronous: 2,
        busyTimeoutMs: 0,
        foreignKeys: true,
        queuedWrites: 0,
        activeWrite: null,
      };
    },
  };
  return { database, close: () => connection.close() };
}
