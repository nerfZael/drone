import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export function openUsageDatabase(file: string): import('better-sqlite3').Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const require = createRequire(__filename);
  const Database = typeof (globalThis as any).Bun !== 'undefined'
    ? require('bun:sqlite').Database : require('better-sqlite3');
  const db = new Database(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  return db;
}
