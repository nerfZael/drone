import { getUsageStore } from './UsageStore';
import { getUsageJournal } from './UsageJournal';
import { nativeUsageDelivery } from './helpers/nativeUsageDelivery';

type Database = {
  exec(sql: string): unknown;
  prepare(sql: string): { run(...args: any[]): unknown; all(...args: any[]): unknown[]; get(...args: any[]): unknown };
};

/** Lives beside native events, survives chat deletion, and is not copied when a session forks. */
export class NativeUsageOutbox {
  private timer: ReturnType<typeof setInterval>;

  constructor(private readonly db: Database, private readonly durableSource = true) {
    getUsageStore();
    db.exec('CREATE TABLE IF NOT EXISTS usage_outbox (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, event_json TEXT NOT NULL)');
    this.timer = setInterval(() => this.drain(), 10_000);
    this.timer.unref();
  }

  append(sessionId: string, event: any): void {
    if (!['usage_observed', 'turn_started', 'session_finished'].includes(event.type)) return;
    const binding = this.db.prepare('SELECT thread_id FROM assistant_blip_thread_bindings WHERE session_id=?').get(sessionId) as any;
    if (!binding) return;
    if (!this.durableSource) {
      getUsageJournal().append(nativeUsageDelivery(binding.thread_id, event), `native:${event.eventId}`);
      return;
    }
    this.db.prepare('INSERT OR IGNORE INTO usage_outbox VALUES (?,?,?)').run(event.eventId, binding.thread_id, JSON.stringify(event));
  }

  drain(): void {
    try {
      const store = getUsageStore();
      const rows = this.db.prepare('SELECT * FROM usage_outbox ORDER BY rowid LIMIT 1000').all() as any[];
      for (const row of rows) {
        const event = JSON.parse(row.event_json);
        getUsageJournal().append(nativeUsageDelivery(row.thread_id, event), `native:${event.eventId}`);
        this.db.prepare('DELETE FROM usage_outbox WHERE id=?').run(row.id);
      }
      getUsageJournal().drain(store);
    } catch (error) {
      // Keep rows for retry. Tracking failures must not turn successful model calls into retries.
      console.warn('Native usage delivery pending:', error instanceof Error ? error.message : String(error));
    }
  }

  close(): void { clearInterval(this.timer); this.drain(); }
}
