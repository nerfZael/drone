import { applyHubDatabaseMigrations, getHubDatabase } from './hub-database';
import type { HubDatabase, HubDatabaseConnection, HubDatabaseMigration } from './hub-database';

export type PromptQueueState = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

export type PromptQueueItem = {
  id: string;
  at: string;
  prompt: string;
  model?: string;
  messageId?: string;
  cwd?: string | null;
  attachments?: unknown;
  automation?: unknown;
  blockedByAutomation?: boolean;
  state: PromptQueueState;
  error?: string;
  observability?: unknown;
  blipClones?: unknown;
  updatedAt?: string;
};

export type PromptQueueRecord = PromptQueueItem & {
  sequence: number;
  idempotencyKey: string;
  attemptCount: number;
  nextAttemptAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastError?: string;
};

export const PROMPT_QUEUE_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'canonical durable prompt queue',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE prompts (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
          prompt TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at TEXT NOT NULL,
          lease_owner TEXT,
          lease_expires_at TEXT,
          last_error TEXT,
          UNIQUE (drone_id, chat_name, prompt_id),
          UNIQUE (drone_id, chat_name, idempotency_key)
        );

        CREATE INDEX idx_prompts_chat_sequence
          ON prompts (drone_id, chat_name, sequence);

        CREATE INDEX idx_prompts_claimable
          ON prompts (state, next_attempt_at, drone_id, chat_name, sequence);

        CREATE INDEX idx_prompts_expired_lease
          ON prompts (state, lease_expires_at);
      `);

      // `chat_prompts` predates the canonical queue. Copy it once when present;
      // later registry imports use INSERT OR IGNORE and can never regress rows.
      const legacyTable = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_prompts'")
        .get();
      if (legacyTable) {
        connection.exec(`
          INSERT OR IGNORE INTO prompts (
            drone_id,
            chat_name,
            prompt_id,
            idempotency_key,
            created_at,
            updated_at,
            state,
            prompt,
            payload_json,
            attempt_count,
            next_attempt_at,
            lease_owner,
            lease_expires_at,
            last_error
          )
          SELECT
            drone_id,
            chat_name,
            prompt_id,
            prompt_id,
            created_at,
            updated_at,
            CASE state
              WHEN 'queued' THEN 'queued'
              WHEN 'sending' THEN 'sending'
              WHEN 'sent' THEN 'sent'
              WHEN 'failed' THEN 'failed'
              ELSE 'failed'
            END,
            prompt,
            prompt_json,
            0,
            created_at,
            NULL,
            NULL,
            error
          FROM chat_prompts;
        `);
      }
    },
  },
];

type PromptRow = {
  sequence: number;
  prompt_id: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  state: PromptQueueState;
  prompt: string;
  payload_json: string;
  attempt_count: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
};

function normalizeIso(raw: unknown, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function normalizeState(raw: unknown): PromptQueueState {
  return raw === 'queued' ||
    raw === 'sending' ||
    raw === 'sent' ||
    raw === 'failed' ||
    raw === 'cancelled'
    ? raw
    : 'failed';
}

function normalizeItem(raw: PromptQueueItem, now: string): PromptQueueItem {
  const id = String(raw?.id ?? '').trim();
  const prompt = String(raw?.prompt ?? '');
  if (!id) throw new Error('Prompt id cannot be empty');
  if (!prompt.trim()) throw new Error('Prompt text cannot be empty');
  const at = normalizeIso(raw.at, now);
  return {
    ...raw,
    id,
    at,
    prompt,
    state: normalizeState(raw.state),
    updatedAt: normalizeIso(raw.updatedAt, at),
  };
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function recordFromRow(row: PromptRow | undefined): PromptQueueRecord | null {
  if (!row) return null;
  const payload = parsePayload(row.payload_json);
  return {
    ...(payload as PromptQueueItem),
    id: row.prompt_id,
    at: row.created_at,
    prompt: row.prompt,
    state: row.state,
    updatedAt: row.updated_at,
    ...(row.last_error ? { error: row.last_error } : { error: undefined }),
    sequence: Number(row.sequence),
    idempotencyKey: row.idempotency_key,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at,
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + Math.max(0, Math.floor(ms))).toISOString();
}

function rowForPrompt(
  connection: HubDatabaseConnection,
  droneId: string,
  chatName: string,
  promptId: string,
): PromptQueueRecord | null {
  const row = connection
    .prepare('SELECT * FROM prompts WHERE drone_id = ? AND chat_name = ? AND prompt_id = ?')
    .get(droneId, chatName, promptId) as PromptRow | undefined;
  return recordFromRow(row);
}

export class PromptQueueRepository {
  constructor(private readonly database: HubDatabase) {
    // Migrations are synchronous and idempotent. Keeping them in their own
    // scope lets this vertical slice evolve independently from the DB core.
    this.database.read((connection) =>
      applyHubDatabaseMigrations(connection, PROMPT_QUEUE_MIGRATIONS, 'prompts'),
    );
  }

  async enqueue(opts: {
    droneId: string;
    chatName: string;
    prompt: PromptQueueItem;
    idempotencyKey?: string;
    now?: string;
  }): Promise<{ inserted: boolean; prompt: PromptQueueRecord }> {
    const now = normalizeIso(opts.now, new Date().toISOString());
    const prompt = normalizeItem(opts.prompt, now);
    const idempotencyKey = String(opts.idempotencyKey ?? prompt.id).trim();
    if (!idempotencyKey) throw new Error('Prompt idempotency key cannot be empty');
    return await this.database.writeTransaction('enqueue prompt', (connection) => {
      const info = connection
        .prepare(
          `
            INSERT OR IGNORE INTO prompts (
              drone_id, chat_name, prompt_id, idempotency_key,
              created_at, updated_at, state, prompt, payload_json,
              attempt_count, next_attempt_at, lease_owner, lease_expires_at, last_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?)
          `,
        )
        .run(
          opts.droneId,
          opts.chatName,
          prompt.id,
          idempotencyKey,
          prompt.at,
          prompt.updatedAt ?? prompt.at,
          prompt.state,
          prompt.prompt,
          JSON.stringify(prompt),
          prompt.at,
          prompt.error ?? null,
        );
      const stored = connection
        .prepare(
          `
            SELECT * FROM prompts
            WHERE drone_id = ? AND chat_name = ?
              AND (prompt_id = ? OR idempotency_key = ?)
            ORDER BY sequence
            LIMIT 1
          `,
        )
        .get(opts.droneId, opts.chatName, prompt.id, idempotencyKey) as PromptRow | undefined;
      const record = recordFromRow(stored);
      if (!record) throw new Error(`Failed to persist prompt ${prompt.id}`);
      return { inserted: Number(info.changes ?? 0) === 1, prompt: record };
    });
  }

  async backfillLegacy(opts: {
    droneId: string;
    chatName: string;
    prompts: PromptQueueItem[];
  }): Promise<number> {
    const normalized: PromptQueueItem[] = [];
    for (const raw of opts.prompts ?? []) {
      try {
        normalized.push(normalizeItem(raw, new Date().toISOString()));
      } catch {
        // A malformed compatibility row should not block valid rows.
      }
    }
    if (normalized.length === 0) return 0;
    return await this.database.writeTransaction('backfill legacy prompts', (connection) => {
      const insert = connection.prepare(`
        INSERT OR IGNORE INTO prompts (
          drone_id, chat_name, prompt_id, idempotency_key,
          created_at, updated_at, state, prompt, payload_json,
          attempt_count, next_attempt_at, lease_owner, lease_expires_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?)
      `);
      let inserted = 0;
      for (const prompt of normalized) {
        const info = insert.run(
          opts.droneId,
          opts.chatName,
          prompt.id,
          prompt.id,
          prompt.at,
          prompt.updatedAt ?? prompt.at,
          prompt.state,
          prompt.prompt,
          JSON.stringify(prompt),
          prompt.at,
          prompt.error ?? null,
        );
        inserted += Number(info.changes ?? 0);
      }
      return inserted;
    });
  }

  list(opts: { droneId: string; chatName: string; limit?: number }): PromptQueueRecord[] {
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 60)));
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `
            SELECT * FROM (
              SELECT * FROM prompts
              WHERE drone_id = ? AND chat_name = ? AND state != 'cancelled'
              ORDER BY sequence DESC
              LIMIT ?
            ) ORDER BY sequence ASC
          `,
        )
        .all(opts.droneId, opts.chatName, limit) as PromptRow[];
      return rows
        .map((row) => recordFromRow(row))
        .filter((row): row is PromptQueueRecord => Boolean(row));
    });
  }

  get(opts: { droneId: string; chatName: string; promptId: string }): PromptQueueRecord | null {
    return this.database.read((connection) =>
      rowForPrompt(connection, opts.droneId, opts.chatName, opts.promptId),
    );
  }

  listQueuedChats(opts?: { now?: string }): Array<{ droneId: string; chatName: string }> {
    const now = normalizeIso(opts?.now, new Date().toISOString());
    return this.database.read((connection) =>
      (
        connection
          .prepare(
            `SELECT drone_id, chat_name
             FROM prompts
             WHERE state = 'queued' AND next_attempt_at <= ?
             GROUP BY drone_id, chat_name
             ORDER BY MIN(sequence)`,
          )
          .all(now) as Array<{ drone_id: string; chat_name: string }>
      ).map((row) => ({ droneId: row.drone_id, chatName: row.chat_name })),
    );
  }

  async claim(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    leaseOwner: string;
    leaseMs?: number;
    now?: string;
  }): Promise<PromptQueueRecord | null> {
    const now = normalizeIso(opts.now, new Date().toISOString());
    const leaseOwner = String(opts.leaseOwner ?? '').trim();
    if (!leaseOwner) throw new Error('Prompt lease owner cannot be empty');
    const leaseExpiresAt = addMs(now, Math.max(1_000, opts.leaseMs ?? 180_000));
    return await this.database.writeTransaction('claim prompt', (connection) => {
      // This single conditional UPDATE is both the FIFO check and the claim.
      // No daemon or other external work occurs in this transaction.
      const claimed = connection
        .prepare(
          `
            UPDATE prompts
            SET state = 'sending',
                attempt_count = attempt_count + 1,
                updated_at = ?,
                lease_owner = ?,
                lease_expires_at = ?,
                last_error = NULL
            WHERE drone_id = ? AND chat_name = ? AND prompt_id = ?
              AND state = 'queued'
              AND next_attempt_at <= ?
              AND NOT EXISTS (
                SELECT 1 FROM prompts AS prior
                WHERE prior.drone_id = prompts.drone_id
                  AND prior.chat_name = prompts.chat_name
                  AND prior.sequence < prompts.sequence
                  AND prior.state IN ('queued', 'sending')
              )
            RETURNING *
          `,
        )
        .get(now, leaseOwner, leaseExpiresAt, opts.droneId, opts.chatName, opts.promptId, now) as
        | PromptRow
        | undefined;
      return recordFromRow(claimed);
    });
  }

  async update(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    patch: Partial<
      Pick<PromptQueueItem, 'state' | 'error' | 'observability' | 'blipClones' | 'updatedAt'>
    >;
    now?: string;
  }): Promise<boolean> {
    const now = normalizeIso(opts.patch.updatedAt ?? opts.now, new Date().toISOString());
    return await this.database.writeTransaction('update prompt', (connection) => {
      const current = rowForPrompt(connection, opts.droneId, opts.chatName, opts.promptId);
      if (!current) return false;
      const nextState = opts.patch.state ? normalizeState(opts.patch.state) : current.state;
      const next: PromptQueueItem = {
        ...current,
        ...opts.patch,
        state: nextState,
        updatedAt: now,
      };
      const terminal = nextState === 'sent' || nextState === 'failed';
      const queued = nextState === 'queued';
      const error = opts.patch.error === undefined ? current.lastError : opts.patch.error;
      const info = connection
        .prepare(
          `
            UPDATE prompts
            SET state = ?, updated_at = ?, payload_json = ?, last_error = ?,
                next_attempt_at = CASE WHEN ? THEN ? ELSE next_attempt_at END,
                lease_owner = CASE WHEN ? OR ? THEN NULL ELSE lease_owner END,
                lease_expires_at = CASE WHEN ? OR ? THEN NULL ELSE lease_expires_at END
            WHERE drone_id = ? AND chat_name = ? AND prompt_id = ?
          `,
        )
        .run(
          nextState,
          now,
          JSON.stringify(next),
          error ?? null,
          queued ? 1 : 0,
          now,
          terminal ? 1 : 0,
          queued ? 1 : 0,
          terminal ? 1 : 0,
          queued ? 1 : 0,
          opts.droneId,
          opts.chatName,
          opts.promptId,
        );
      return Number(info.changes ?? 0) === 1;
    });
  }

  async scheduleRetry(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    error: string;
    leaseOwner?: string;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    now?: string;
  }): Promise<{ disposition: 'retry' | 'terminal' | 'not-claimed'; nextAttemptAt?: string }> {
    const now = normalizeIso(opts.now, new Date().toISOString());
    const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? 5));
    const baseDelayMs = Math.max(1, Math.floor(opts.baseDelayMs ?? 2_000));
    const maxDelayMs = Math.max(baseDelayMs, Math.floor(opts.maxDelayMs ?? 60_000));
    return await this.database.writeTransaction('schedule prompt retry', (connection) => {
      const current = rowForPrompt(connection, opts.droneId, opts.chatName, opts.promptId);
      if (
        !current ||
        current.state !== 'sending' ||
        (opts.leaseOwner && current.leaseOwner !== opts.leaseOwner)
      ) {
        return { disposition: 'not-claimed' as const };
      }
      if (current.attemptCount >= maxAttempts) {
        connection
          .prepare(
            `
            UPDATE prompts
            SET state = 'failed', updated_at = ?, last_error = ?,
                lease_owner = NULL, lease_expires_at = NULL,
                payload_json = json_set(payload_json, '$.state', 'failed', '$.error', ?, '$.updatedAt', ?)
            WHERE drone_id = ? AND chat_name = ? AND prompt_id = ? AND state = 'sending'
          `,
          )
          .run(now, opts.error, opts.error, now, opts.droneId, opts.chatName, opts.promptId);
        return { disposition: 'terminal' as const };
      }
      const exponent = Math.max(0, current.attemptCount - 1);
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
      const nextAttemptAt = addMs(now, delayMs);
      connection
        .prepare(
          `
          UPDATE prompts
          SET state = 'queued', updated_at = ?, next_attempt_at = ?, last_error = ?,
              lease_owner = NULL, lease_expires_at = NULL,
              payload_json = json_set(payload_json, '$.state', 'queued', '$.error', ?, '$.updatedAt', ?)
          WHERE drone_id = ? AND chat_name = ? AND prompt_id = ? AND state = 'sending'
        `,
        )
        .run(
          now,
          nextAttemptAt,
          opts.error,
          opts.error,
          now,
          opts.droneId,
          opts.chatName,
          opts.promptId,
        );
      return { disposition: 'retry' as const, nextAttemptAt };
    });
  }

  async recoverExpiredLeases(opts?: { now?: string; error?: string }): Promise<number> {
    const now = normalizeIso(opts?.now, new Date().toISOString());
    const error = String(opts?.error ?? 'Prompt delivery lease expired; retrying.');
    return await this.database.writeTransaction('recover expired prompt leases', (connection) => {
      const info = connection
        .prepare(
          `
          UPDATE prompts
          SET state = 'queued', updated_at = ?, next_attempt_at = ?, last_error = ?,
              lease_owner = NULL, lease_expires_at = NULL,
              payload_json = json_set(payload_json, '$.state', 'queued', '$.error', ?, '$.updatedAt', ?)
          WHERE state = 'sending'
            AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        `,
        )
        .run(now, now, error, error, now, now);
      return Number(info.changes ?? 0);
    });
  }

  async cancelQueued(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): Promise<{ cancelled: boolean; state: PromptQueueState | null }> {
    return await this.database.writeTransaction('cancel queued prompt', (connection) => {
      const current = rowForPrompt(connection, opts.droneId, opts.chatName, opts.promptId);
      if (!current) return { cancelled: false, state: null };
      if (current.state !== 'queued') return { cancelled: false, state: current.state };
      const cancelledAt = new Date().toISOString();
      const info = connection
        .prepare(
          `UPDATE prompts
           SET state = 'cancelled', updated_at = ?, lease_owner = NULL,
               lease_expires_at = NULL,
               payload_json = json_set(payload_json, '$.state', 'cancelled', '$.updatedAt', ?)
           WHERE drone_id = ? AND chat_name = ? AND prompt_id = ? AND state = 'queued'`,
        )
        .run(cancelledAt, cancelledAt, opts.droneId, opts.chatName, opts.promptId);
      return {
        cancelled: Number(info.changes ?? 0) === 1,
        state: 'queued' as const,
      };
    });
  }
}

let cachedRepository: { database: HubDatabase; repository: PromptQueueRepository } | null = null;

/** Returns null only when the native SQLite binding is unavailable (notably Bun ABI tests). */
export function getPromptQueueRepository(): PromptQueueRepository | null {
  const database = getHubDatabase();
  if (!database) return null;
  if (cachedRepository?.database === database) return cachedRepository.repository;
  const repository = new PromptQueueRepository(database);
  cachedRepository = { database, repository };
  return repository;
}

export function resetPromptQueueRepositoryForTests(): void {
  cachedRepository = null;
}
