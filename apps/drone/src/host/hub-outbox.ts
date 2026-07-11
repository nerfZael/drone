import crypto from 'node:crypto';

import { applyHubDatabaseMigrations, requireHubDatabase } from './hub-database';
import type { HubDatabase, HubDatabaseConnection, HubDatabaseMigration } from './hub-database';

export type HubOutboxStatus = 'pending' | 'claimed' | 'delivered' | 'dead-letter';

export type HubOutboxEvent = {
  id: number;
  topic: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload: unknown;
  occurredAt: string;
  availableAt: string;
  status: HubOutboxStatus;
  attemptCount: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  deliveredAt?: string;
  deadLetteredAt?: string;
  lastError?: string;
  deduplicationKey?: string;
};

export type AppendHubOutboxEvent = {
  topic: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: unknown;
  occurredAt?: string;
  availableAt?: string;
  deduplicationKey?: string;
};

export const HUB_OUTBOX_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'transactional post-commit outbox',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE hub_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic TEXT NOT NULL,
          event_type TEXT NOT NULL,
          aggregate_type TEXT,
          aggregate_id TEXT,
          payload_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          available_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'claimed', 'delivered', 'dead-letter')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          lease_owner TEXT,
          lease_expires_at TEXT,
          delivered_at TEXT,
          dead_lettered_at TEXT,
          last_error TEXT,
          deduplication_key TEXT UNIQUE
        );

        CREATE INDEX idx_hub_outbox_dispatch
          ON hub_outbox (status, available_at, id);

        CREATE INDEX idx_hub_outbox_expired_lease
          ON hub_outbox (status, lease_expires_at, id);

        CREATE INDEX idx_hub_outbox_aggregate
          ON hub_outbox (aggregate_type, aggregate_id, id);
      `);
    },
  },
];

type HubOutboxRow = {
  id: number;
  topic: string;
  event_type: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload_json: string;
  occurred_at: string;
  available_at: string;
  status: HubOutboxStatus;
  attempt_count: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  last_error: string | null;
  deduplication_key: string | null;
};

function normalizedRequiredText(value: unknown, label: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} cannot be empty`);
  return text;
}

function normalizedOptionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function normalizedIso(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && Number.isFinite(Date.parse(text)) ? text : fallback;
}

function addMs(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + Math.max(0, Math.floor(milliseconds))).toISOString();
}

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function eventFromRow(row: HubOutboxRow | undefined): HubOutboxEvent | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    topic: row.topic,
    eventType: row.event_type,
    ...(row.aggregate_type ? { aggregateType: row.aggregate_type } : {}),
    ...(row.aggregate_id ? { aggregateId: row.aggregate_id } : {}),
    payload: parsePayload(row.payload_json),
    occurredAt: row.occurred_at,
    availableAt: row.available_at,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.delivered_at ? { deliveredAt: row.delivered_at } : {}),
    ...(row.dead_lettered_at ? { deadLetteredAt: row.dead_lettered_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.deduplication_key ? { deduplicationKey: row.deduplication_key } : {}),
  };
}

function rowById(connection: HubDatabaseConnection, id: number): HubOutboxEvent | null {
  return eventFromRow(
    connection.prepare('SELECT * FROM hub_outbox WHERE id = ?').get(id) as
      | HubOutboxRow
      | undefined,
  );
}

/**
 * Ensures the outbox table exists before a domain repository starts writing.
 * Domain repositories should call this once in their constructor, then call
 * `appendHubOutboxEvent` inside the same transaction as the state change.
 */
export function initializeHubOutbox(database: HubDatabase): void {
  database.read((connection) =>
    applyHubDatabaseMigrations(connection, HUB_OUTBOX_MIGRATIONS, 'outbox'),
  );
}

/** Appends an event using the caller's transaction and connection. */
export function appendHubOutboxEvent(
  connection: HubDatabaseConnection,
  input: AppendHubOutboxEvent,
): HubOutboxEvent {
  const now = new Date().toISOString();
  const occurredAt = normalizedIso(input.occurredAt, now);
  const availableAt = normalizedIso(input.availableAt, occurredAt);
  const topic = normalizedRequiredText(input.topic, 'Outbox topic');
  const eventType = normalizedRequiredText(input.eventType, 'Outbox event type');
  const aggregateType = normalizedOptionalText(input.aggregateType);
  const aggregateId = normalizedOptionalText(input.aggregateId);
  const deduplicationKey = normalizedOptionalText(input.deduplicationKey);
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(input.payload ?? null);
  } catch (error) {
    throw new TypeError(`Outbox payload must be JSON serializable: ${String(error)}`);
  }
  if (payloadJson === undefined) payloadJson = 'null';

  const info = connection
    .prepare(
      `
        INSERT OR IGNORE INTO hub_outbox (
          topic, event_type, aggregate_type, aggregate_id, payload_json,
          occurred_at, available_at, status, attempt_count,
          lease_owner, lease_expires_at, delivered_at, dead_lettered_at,
          last_error, deduplication_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, NULL, ?)
      `,
    )
    .run(
      topic,
      eventType,
      aggregateType,
      aggregateId,
      payloadJson,
      occurredAt,
      availableAt,
      deduplicationKey,
    );

  const row = deduplicationKey
    ? (connection
        .prepare('SELECT * FROM hub_outbox WHERE deduplication_key = ?')
        .get(deduplicationKey) as HubOutboxRow | undefined)
    : (connection
        .prepare('SELECT * FROM hub_outbox WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as HubOutboxRow | undefined);
  const event = eventFromRow(row);
  if (!event) throw new Error('Failed to append Hub outbox event');
  return event;
}

export class HubOutboxRepository {
  constructor(private readonly database: HubDatabase = requireHubDatabase()) {
    initializeHubOutbox(database);
  }

  async enqueue(input: AppendHubOutboxEvent): Promise<HubOutboxEvent> {
    return await this.database.writeTransaction('enqueue outbox event', (connection) =>
      appendHubOutboxEvent(connection, input),
    );
  }

  get(id: number): HubOutboxEvent | null {
    return this.database.read((connection) => rowById(connection, id));
  }

  list(opts?: { status?: HubOutboxStatus; limit?: number }): HubOutboxEvent[] {
    const limit = Math.max(1, Math.min(1_000, Math.floor(opts?.limit ?? 100)));
    return this.database.read((connection) => {
      const rows = opts?.status
        ? (connection
            .prepare('SELECT * FROM hub_outbox WHERE status = ? ORDER BY id LIMIT ?')
            .all(opts.status, limit) as HubOutboxRow[])
        : (connection
            .prepare('SELECT * FROM hub_outbox ORDER BY id LIMIT ?')
            .all(limit) as HubOutboxRow[]);
      return rows
        .map((row) => eventFromRow(row))
        .filter((event): event is HubOutboxEvent => Boolean(event));
    });
  }

  async claim(opts: {
    leaseOwner: string;
    limit?: number;
    leaseMs?: number;
    now?: string;
    topics?: string[];
  }): Promise<HubOutboxEvent[]> {
    const leaseOwner = normalizedRequiredText(opts.leaseOwner, 'Outbox lease owner');
    const now = normalizedIso(opts.now, new Date().toISOString());
    const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 25)));
    const leaseExpiresAt = addMs(now, opts.leaseMs ?? 30_000);
    const topics = [...new Set((opts.topics ?? []).map((topic) => topic.trim()).filter(Boolean))];

    return await this.database.writeTransaction('claim outbox events', (connection) => {
      const topicClause = topics.length > 0 ? `AND topic IN (${topics.map(() => '?').join(', ')})` : '';
      const candidates = connection
        .prepare(
          `
            SELECT id
            FROM hub_outbox
            WHERE available_at <= ?
              AND (
                status = 'pending'
                OR (status = 'claimed' AND lease_expires_at <= ?)
              )
              ${topicClause}
            ORDER BY id
            LIMIT ?
          `,
        )
        .all(now, now, ...topics, limit) as Array<{ id: number }>;
      if (candidates.length === 0) return [];

      const claim = connection.prepare(`
        UPDATE hub_outbox
        SET status = 'claimed',
            attempt_count = attempt_count + 1,
            lease_owner = ?,
            lease_expires_at = ?
        WHERE id = ?
          AND (
            status = 'pending'
            OR (status = 'claimed' AND lease_expires_at <= ?)
          )
      `);
      const claimed: HubOutboxEvent[] = [];
      for (const candidate of candidates) {
        const info = claim.run(leaseOwner, leaseExpiresAt, candidate.id, now);
        if (Number(info.changes ?? 0) !== 1) continue;
        const event = rowById(connection, candidate.id);
        if (event) claimed.push(event);
      }
      return claimed;
    });
  }

  async acknowledge(opts: {
    id: number;
    leaseOwner: string;
    deliveredAt?: string;
  }): Promise<boolean> {
    const deliveredAt = normalizedIso(opts.deliveredAt, new Date().toISOString());
    const leaseOwner = normalizedRequiredText(opts.leaseOwner, 'Outbox lease owner');
    return await this.database.writeTransaction('acknowledge outbox event', (connection) => {
      const info = connection
        .prepare(
          `
            UPDATE hub_outbox
            SET status = 'delivered', delivered_at = ?, lease_owner = NULL,
                lease_expires_at = NULL, last_error = NULL
            WHERE id = ? AND status = 'claimed' AND lease_owner = ?
          `,
        )
        .run(deliveredAt, opts.id, leaseOwner);
      return Number(info.changes ?? 0) === 1;
    });
  }

  async fail(opts: {
    id: number;
    leaseOwner: string;
    error: unknown;
    now?: string;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  }): Promise<'retry' | 'dead-letter' | 'not-claimed'> {
    const leaseOwner = normalizedRequiredText(opts.leaseOwner, 'Outbox lease owner');
    const now = normalizedIso(opts.now, new Date().toISOString());
    const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? 10));
    const baseDelayMs = Math.max(0, Math.floor(opts.baseDelayMs ?? 1_000));
    const maxDelayMs = Math.max(baseDelayMs, Math.floor(opts.maxDelayMs ?? 5 * 60_000));
    const message = String(opts.error instanceof Error ? opts.error.message : opts.error).slice(0, 4_000);

    return await this.database.writeTransaction('fail outbox event', (connection) => {
      const current = connection
        .prepare(
          `SELECT attempt_count FROM hub_outbox
           WHERE id = ? AND status = 'claimed' AND lease_owner = ?`,
        )
        .get(opts.id, leaseOwner) as { attempt_count: number } | undefined;
      if (!current) return 'not-claimed';
      if (Number(current.attempt_count) >= maxAttempts) {
        connection
          .prepare(
            `
              UPDATE hub_outbox
              SET status = 'dead-letter', dead_lettered_at = ?, last_error = ?,
                  lease_owner = NULL, lease_expires_at = NULL
              WHERE id = ? AND status = 'claimed' AND lease_owner = ?
            `,
          )
          .run(now, message, opts.id, leaseOwner);
        return 'dead-letter';
      }

      const exponent = Math.max(0, Number(current.attempt_count) - 1);
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
      connection
        .prepare(
          `
            UPDATE hub_outbox
            SET status = 'pending', available_at = ?, last_error = ?,
                lease_owner = NULL, lease_expires_at = NULL
            WHERE id = ? AND status = 'claimed' AND lease_owner = ?
          `,
        )
        .run(addMs(now, delayMs), message, opts.id, leaseOwner);
      return 'retry';
    });
  }
}

export type HubOutboxHandler = (event: HubOutboxEvent) => void | Promise<void>;

export class HubOutboxDispatcher {
  readonly leaseOwner: string;

  constructor(
    private readonly repository: HubOutboxRepository,
    private readonly handler: HubOutboxHandler,
    leaseOwner?: string,
  ) {
    this.leaseOwner = leaseOwner?.trim() || `hub-outbox-${process.pid}-${crypto.randomUUID()}`;
  }

  /** Claims durably, performs effects outside SQLite, then acknowledges. */
  async drainOnce(opts?: {
    limit?: number;
    leaseMs?: number;
    now?: string;
    topics?: string[];
    maxAttempts?: number;
  }): Promise<{ claimed: number; delivered: number; failed: number; deadLettered: number }> {
    const events = await this.repository.claim({
      leaseOwner: this.leaseOwner,
      limit: opts?.limit,
      leaseMs: opts?.leaseMs,
      now: opts?.now,
      topics: opts?.topics,
    });
    let delivered = 0;
    let failed = 0;
    let deadLettered = 0;
    for (const event of events) {
      try {
        await this.handler(event);
        if (await this.repository.acknowledge({ id: event.id, leaseOwner: this.leaseOwner })) {
          delivered += 1;
        }
      } catch (error) {
        failed += 1;
        const disposition = await this.repository.fail({
          id: event.id,
          leaseOwner: this.leaseOwner,
          error,
          now: opts?.now,
          maxAttempts: opts?.maxAttempts,
        });
        if (disposition === 'dead-letter') deadLettered += 1;
      }
    }
    return { claimed: events.length, delivered, failed, deadLettered };
  }
}

export type HubOutboxDispatchLoopOptions = {
  intervalMs?: number;
  batchSize?: number;
  leaseMs?: number;
  topics?: string[];
  maxAttempts?: number;
  onError?: (error: unknown) => void;
};

/**
 * Bounded startup/interval pump for the durable outbox.
 *
 * A timeout is scheduled only after the current batch finishes, so slow
 * projection or SSE effects cannot overlap. `stop()` waits for an in-flight
 * batch and is safe to call repeatedly.
 */
export class HubOutboxDispatchLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<unknown> | null = null;
  private stopped = true;
  private readonly intervalMs: number;
  private readonly drainOptions: {
    limit: number;
    leaseMs: number;
    topics?: string[];
    maxAttempts: number;
  };

  constructor(
    private readonly dispatcher: HubOutboxDispatcher,
    private readonly options: HubOutboxDispatchLoopOptions = {},
  ) {
    this.intervalMs = Math.max(25, Math.floor(options.intervalMs ?? 500));
    this.drainOptions = {
      limit: Math.max(1, Math.min(100, Math.floor(options.batchSize ?? 25))),
      leaseMs: Math.max(1_000, Math.floor(options.leaseMs ?? 30_000)),
      ...(options.topics?.length ? { topics: options.topics } : {}),
      maxAttempts: Math.max(1, Math.floor(options.maxAttempts ?? 10)),
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.drainNow();
  }

  async drainNow(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    const operation = this.dispatcher.drainOnce(this.drainOptions)
      .catch((error) => this.options.onError?.(error))
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
        this.schedule();
      });
    this.inFlight = operation;
    await operation;
  }

  private schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drainNow();
    }, this.intervalMs);
    (this.timer as any).unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.inFlight?.catch(() => {});
  }
}
