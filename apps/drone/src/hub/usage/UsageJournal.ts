import crypto from 'node:crypto';
import type { UsageObservation } from '@drone/assistant-chat';
import { droneRootPath } from '../../host/paths';
import { getUsageStore, type UsageExecution, type UsageStore } from './UsageStore';
import { openUsageDatabase } from './helpers/openUsageDatabase';

export type UsageDelivery = { execution: UsageExecution; observations: UsageObservation[]; replace: boolean };
export type ExternalUsageWatch = {
  droneId: string; promptId: string; chatId: string; chatName: string; repo?: string; model?: string;
};
export type PendingUsageWatch = ExternalUsageWatch & { key: string; attempts: number };

/** Independent of chat deletion and of the destination ledger's availability. */
export class UsageJournal {
  private readonly db: import('better-sqlite3').Database;

  constructor(file = droneRootPath('usage-delivery.sqlite')) {
    this.db = openUsageDatabase(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS external_watches (id TEXT PRIMARY KEY, payload TEXT NOT NULL,
        next_attempt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
      CREATE INDEX IF NOT EXISTS watches_due ON external_watches(next_attempt);`);
  }

  append(delivery: UsageDelivery, id: string = crypto.randomUUID()): void {
    const stamped = { ...delivery, execution: { ...delivery.execution,
      observedAt: delivery.execution.observedAt ?? new Date().toISOString() } };
    this.db.prepare('INSERT OR IGNORE INTO deliveries VALUES (?,?)').run(id, JSON.stringify(stamped));
  }

  drain(store: UsageStore = getUsageStore(), limit = 1000): number {
    let delivered = 0;
    for (const row of this.db.prepare('SELECT id,payload FROM deliveries ORDER BY rowid LIMIT ?').all(limit) as any[]) {
      const item: UsageDelivery = JSON.parse(row.payload);
      const chat = item.execution.chatId ? store.chat(item.execution.chatId) : {};
      store.record({ ...chat, ...item.execution }, item.observations, item.replace);
      // A crash between the two commits replays the same execution/observation identities.
      this.db.prepare('DELETE FROM deliveries WHERE id=?').run(row.id);
      delivered++;
    }
    return delivered;
  }

  watch(input: ExternalUsageWatch): void {
    if (!input.promptId || !input.chatId || !input.droneId) throw new Error('Usage watch requires prompt, drone and chat identities');
    this.db.prepare(`INSERT INTO external_watches (id,payload,next_attempt) VALUES (?,?,?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`)
      .run(watchKey(input), JSON.stringify(input), Date.now());
  }

  due(now = Date.now(), limit = 24): PendingUsageWatch[] {
    return (this.db.prepare('SELECT * FROM external_watches WHERE next_attempt<=? ORDER BY next_attempt,rowid LIMIT ?')
      .all(now, limit) as any[]).map((row) => ({ ...JSON.parse(row.payload), key: row.id, attempts: row.attempts }));
  }

  retry(watch: PendingUsageWatch, error?: unknown): void {
    const delay = error ? Math.min(300_000, 5000 * 2 ** Math.min(watch.attempts, 6)) : 10_000;
    this.db.prepare('UPDATE external_watches SET next_attempt=?,attempts=?,last_error=? WHERE id=?')
      .run(Date.now() + delay, error ? watch.attempts + 1 : 0,
        error ? String(error instanceof Error ? error.message : error).slice(0, 1000) : null, watch.key);
  }

  finish(input: ExternalUsageWatch): void {
    this.db.prepare('DELETE FROM external_watches WHERE id=?').run(watchKey(input));
  }

  /** The final snapshot and removal of its watch are committed together. */
  complete(input: ExternalUsageWatch, delivery: UsageDelivery): void {
    this.db.transaction(() => { this.append(delivery); this.finish(input); })();
  }

  pendingDeliveries(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get() as any).n;
  }

  close(): void { this.db.close(); }
}

let active: { file: string; journal: UsageJournal } | undefined;
export function getUsageJournal(): UsageJournal {
  const file = droneRootPath('usage-delivery.sqlite');
  if (active?.file !== file) { active?.journal.close(); active = { file, journal: new UsageJournal(file) }; }
  return active.journal;
}

function watchKey(input: ExternalUsageWatch): string { return JSON.stringify([input.droneId, input.promptId]); }
