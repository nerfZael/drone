import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { droneRootPath } from '../../host/paths';

export type StoredMcpIdleSubscription = {
  id: string;
  status: 'active' | 'fired' | 'expired' | 'stopped';
  expiresAtMs: number;
  subscription: Record<string, unknown>;
  updatedAt: string;
};

type Statement = {
  run: (...params: any[]) => { changes?: number };
  all: (...params: any[]) => unknown[];
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

export class McpIdleSubscriptionStore {
  private readonly db: DatabaseLike;

  constructor(databasePath = droneRootPath('assistant-blip.sqlite')) {
    this.db = openDatabase(path.resolve(databasePath));
    this.db.pragma?.('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_mcp_idle_subscriptions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        subscription_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assistant_mcp_idle_subscriptions_status_expiry
        ON assistant_mcp_idle_subscriptions(status, expires_at_ms);
    `);
  }

  save(record: StoredMcpIdleSubscription): void {
    this.db.prepare(`
      INSERT INTO assistant_mcp_idle_subscriptions
        (id, status, expires_at_ms, subscription_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        expires_at_ms = excluded.expires_at_ms,
        subscription_json = excluded.subscription_json,
        updated_at = excluded.updated_at
    `).run(record.id, record.status, record.expiresAtMs, JSON.stringify(record.subscription), record.updatedAt);
  }

  list(): StoredMcpIdleSubscription[] {
    const rows = this.db.prepare(`
      SELECT id, status, expires_at_ms, subscription_json, updated_at
      FROM assistant_mcp_idle_subscriptions
      ORDER BY updated_at DESC
    `).all() as Array<{
      id: string;
      status: StoredMcpIdleSubscription['status'];
      expires_at_ms: number;
      subscription_json: string;
      updated_at: string;
    }>;
    return rows.flatMap((row) => {
      try {
        return [{
          id: row.id,
          status: row.status,
          expiresAtMs: Number(row.expires_at_ms),
          subscription: JSON.parse(row.subscription_json),
          updatedAt: row.updated_at,
        }];
      } catch {
        return [];
      }
    });
  }

  close(): void { this.db.close(); }
}
