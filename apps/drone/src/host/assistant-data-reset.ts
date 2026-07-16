import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { droneRootPath } from './paths';

type DatabaseLike = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => { get: (...params: any[]) => unknown };
  transaction?: (operation: () => void) => (() => void) & { immediate?: () => void };
  close: () => void;
};

const requireForAssistantReset = createRequire(__filename);

function openDatabase(databasePath: string): DatabaseLike {
  if (typeof (globalThis as any).Bun !== 'undefined') {
    const BunDatabase = requireForAssistantReset('bun:sqlite').Database;
    return new BunDatabase(databasePath, { create: false }) as DatabaseLike;
  }
  const NodeDatabase = requireForAssistantReset('better-sqlite3');
  return new NodeDatabase(databasePath, { fileMustExist: true }) as DatabaseLike;
}

function tableExists(database: DatabaseLike, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function clearAssistantBlipDatabase(databasePath: string): void {
  const database = openDatabase(databasePath);
  try {
    const clear = () => {
      if (tableExists(database, 'assistant_blip_thread_bindings')) {
        database.exec('DELETE FROM assistant_blip_thread_bindings');
      }
      if (tableExists(database, 'assistant_blip_entries')) {
        database.exec('DELETE FROM assistant_blip_entries');
      }
      if (tableExists(database, 'assistant_blip_sessions')) {
        database.exec('DELETE FROM assistant_blip_sessions');
      }
      if (tableExists(database, 'assistant_hub_state')) {
        database.exec('DELETE FROM assistant_hub_state');
      }
    };
    const transaction = database.transaction?.(clear);
    if (transaction?.immediate) transaction.immediate();
    else if (transaction) transaction();
    else clear();
  } finally {
    database.close();
  }
}

export async function removeLegacyAssistantStateFiles(): Promise<void> {
  const rootDir = droneRootPath();
  const names = await fs.readdir(rootDir).catch((error: any) => {
    if (String(error?.code ?? '') === 'ENOENT') return [];
    throw error;
  });
  await Promise.all(
    names
      .filter(
        (name) =>
          name === 'assistant.json' ||
          (name.startsWith('assistant.json.migrated-') && name.endsWith('.bak')),
      )
      .map((name) => fs.rm(path.join(rootDir, name), { force: true })),
  );
}

/** Removes only disposable Drone Hub assistant conversations and artifacts. */
export async function resetExternalAssistantData(): Promise<void> {
  const blipDatabasePath = droneRootPath('assistant-blip.sqlite');
  const databaseExists = await fs
    .access(blipDatabasePath)
    .then(() => true)
    .catch(() => false);
  if (databaseExists) clearAssistantBlipDatabase(blipDatabasePath);

  await Promise.all([
    fs.rm(droneRootPath('assistant-artifacts'), { recursive: true, force: true }),
    removeLegacyAssistantStateFiles(),
  ]);
}
