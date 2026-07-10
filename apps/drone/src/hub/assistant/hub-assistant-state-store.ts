import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { droneRootPath } from '../../host/paths';

type Statement = {
  run: (...params: any[]) => { changes?: number };
  get: (...params: any[]) => unknown;
};

type DatabaseLike = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => Statement;
  pragma?: (sql: string) => unknown;
  close: () => void;
};

function openDatabase(databasePath: string): DatabaseLike {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const runtimeRequire = createRequire(__filename);
  if (typeof (globalThis as any).Bun !== 'undefined') {
    const BunDatabase = runtimeRequire('bun:sqlite').Database;
    return new BunDatabase(databasePath, { create: true }) as DatabaseLike;
  }
  const NodeDatabase = runtimeRequire('better-sqlite3');
  return new NodeDatabase(databasePath) as DatabaseLike;
}

/** Stores Hub-only assistant settings and thread metadata. Blip transcripts use normalized tables in the same database. */
export class HubAssistantStateStore {
  private readonly db: DatabaseLike;

  constructor(databasePath = droneRootPath('assistant-blip.sqlite')) {
    this.db = openDatabase(path.resolve(databasePath));
    this.db.pragma?.('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_hub_state (
        state_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  read<T extends object>(): T | null {
    const row = this.db.prepare('SELECT state_json FROM assistant_hub_state WHERE state_key = ?').get('primary') as { state_json?: string } | undefined;
    if (!row?.state_json) return null;
    try {
      const parsed = JSON.parse(row.state_json);
      return parsed && typeof parsed === 'object' ? parsed as T : null;
    } catch {
      return null;
    }
  }

  write(state: object): void {
    this.db.prepare(`
      INSERT INTO assistant_hub_state (state_key, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run('primary', JSON.stringify(state), new Date().toISOString());
  }

  clear(): void {
    this.db.prepare('DELETE FROM assistant_hub_state WHERE state_key = ?').run('primary');
  }

  close(): void { this.db.close(); }
}
