import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from '../../host/hub-database';
import {
  changeRequestEventTypeForStatus,
  createChangeRequestDomainEvent,
  type ChangeRequestDomainEvent,
  type ChangeRequestDomainEventType,
  type PendingChangeRequestDomainEvent,
} from './change-request-events';
import type {
  ChangeRequestActor,
  ChangeRequestGithubMirrorRecord,
  ChangeRequestRecord,
  ChangeRequestStatus,
} from './change-request-types';

type ChangeRequestRow = {
  sequence: number;
  id: string;
  state_version: number;
  status: ChangeRequestStatus;
  drone_id: string;
  drone_name: string;
  chat_id: string | null;
  chat_name: string;
  repo_root: string;
  base_branch: string;
  base_sha: string;
  destination_branch: string;
  snapshot_ref: string | null;
  snapshot_sha: string | null;
  source_head_sha: string;
  revision: number;
  title: string;
  description: string;
  created_by_json: string;
  merged_by_json: string | null;
  merge_commit_sha: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  github_mirror_json: string | null;
};

export type ChangeRequestInsert = Omit<ChangeRequestRecord, 'number' | 'stateVersion'>;

export type ChangeRequestPatch = Partial<
  Pick<
    ChangeRequestRecord,
    | 'status'
    | 'destinationBranch'
    | 'snapshotRef'
    | 'snapshotSha'
    | 'sourceHeadSha'
    | 'revision'
    | 'title'
    | 'description'
    | 'mergedBy'
    | 'mergeCommitSha'
    | 'lastError'
    | 'updatedAt'
    | 'mergedAt'
    | 'closedAt'
    | 'githubMirror'
  >
>;

export interface ChangeRequestRepository {
  insert(input: ChangeRequestInsert): Promise<ChangeRequestRecord>;
  get(id: string): ChangeRequestRecord | null;
  getByNumber(number: number): ChangeRequestRecord | null;
  getByNumbers(numbers: number[]): Map<number, ChangeRequestRecord>;
  list(filters?: {
    droneId?: string;
    chatName?: string;
    status?: ChangeRequestStatus;
  }): ChangeRequestRecord[];
  update(id: string, patch: ChangeRequestPatch): Promise<ChangeRequestRecord>;
  emitEvent(
    id: string,
    eventType: Exclude<ChangeRequestDomainEventType, 'change_request.created'>,
    occurredAt: string,
  ): Promise<ChangeRequestRecord>;
  listPendingEvents(limit?: number): PendingChangeRequestDomainEvent[];
  markEventDispatched(eventId: string): Promise<void>;
  markEventFailed(eventId: string, error: string, attemptedAt: string): Promise<void>;
  setOutboxAvailableHandler(handler: (() => void) | null): void;
}

const CHANGE_REQUEST_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'native change requests',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE change_requests (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('open', 'merged', 'closed')),
          drone_id TEXT NOT NULL,
          drone_name TEXT NOT NULL,
          chat_id TEXT,
          chat_name TEXT NOT NULL,
          repo_root TEXT NOT NULL,
          base_branch TEXT NOT NULL,
          base_sha TEXT NOT NULL,
          destination_branch TEXT NOT NULL,
          snapshot_ref TEXT,
          snapshot_sha TEXT,
          source_head_sha TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          created_by_json TEXT NOT NULL,
          merged_by_json TEXT,
          merge_commit_sha TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          merged_at TEXT,
          closed_at TEXT
        );

        CREATE INDEX idx_change_requests_drone_chat
          ON change_requests (drone_id, chat_name, status, updated_at DESC);
        CREATE INDEX idx_change_requests_status_updated
          ON change_requests (status, updated_at DESC);
      `);
    },
  },
  {
    version: 2,
    name: 'github pull request mirrors',
    migrate(connection) {
      connection.exec('ALTER TABLE change_requests ADD COLUMN github_mirror_json TEXT;');
    },
  },
  {
    version: 3,
    name: 'change request state versions and event outbox',
    migrate(connection) {
      connection.exec(`
        ALTER TABLE change_requests
          ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version > 0);

        CREATE TABLE change_request_event_outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          request_number INTEGER NOT NULL,
          state_version INTEGER NOT NULL CHECK (state_version > 0),
          event_type TEXT NOT NULL CHECK (event_type IN (
            'change_request.created',
            'change_request.updated',
            'change_request.merged',
            'change_request.closed'
          )),
          occurred_at TEXT NOT NULL,
          request_json TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          last_error TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (request_number)
        );

        CREATE INDEX idx_change_request_event_outbox_pending
          ON change_request_event_outbox (sequence);
      `);
    },
  },
];

function parseActor(raw: string | null): ChangeRequestActor | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as ChangeRequestActor;
  return {
    kind: parsed.kind === 'chat' || parsed.kind === 'system' ? parsed.kind : 'user',
    id: typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : null,
    label: String(parsed.label ?? '').trim() || 'Unknown actor',
  };
}

function parseGithubMirror(raw: string | null): ChangeRequestGithubMirrorRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ChangeRequestGithubMirrorRecord>;
    const pullNumber = Math.floor(Number(value.pullNumber));
    if (!value.owner || !value.repo || !Number.isFinite(pullNumber) || pullNumber <= 0) return null;
    return {
      owner: String(value.owner),
      repo: String(value.repo),
      pullNumber,
      htmlUrl: String(value.htmlUrl ?? ''),
      headBranch: String(value.headBranch ?? ''),
      headSha: String(value.headSha ?? ''),
      baseBranch: String(value.baseBranch ?? ''),
      state: value.state === 'merged' ? 'merged' : value.state === 'closed' ? 'closed' : 'open',
      autoUpdate: value.autoUpdate !== false,
      branchOwnedByDroneHub: value.branchOwnedByDroneHub === true,
      syncedRevision: Math.max(0, Math.floor(Number(value.syncedRevision) || 0)),
      syncedNativeUpdatedAt: String(value.syncedNativeUpdatedAt ?? ''),
      mergeCommitSha: value.mergeCommitSha ? String(value.mergeCommitSha) : null,
      lastError: value.lastError ? String(value.lastError) : null,
      createdAt: String(value.createdAt ?? ''),
      updatedAt: String(value.updatedAt ?? ''),
    };
  } catch {
    return null;
  }
}

function record(row: ChangeRequestRow): ChangeRequestRecord {
  return {
    id: row.id,
    number: row.sequence,
    stateVersion: row.state_version,
    status: row.status,
    droneId: row.drone_id,
    droneName: row.drone_name,
    chatId: row.chat_id,
    chatName: row.chat_name,
    repoRoot: row.repo_root,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
    destinationBranch: row.destination_branch,
    snapshotRef: row.snapshot_ref,
    snapshotSha: row.snapshot_sha,
    sourceHeadSha: row.source_head_sha,
    revision: row.revision,
    title: row.title,
    description: row.description,
    createdBy: parseActor(row.created_by_json) ?? {
      kind: 'system',
      id: null,
      label: 'Unknown actor',
    },
    mergedBy: parseActor(row.merged_by_json),
    mergeCommitSha: row.merge_commit_sha,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mergedAt: row.merged_at,
    closedAt: row.closed_at,
    githubMirror: parseGithubMirror(row.github_mirror_json),
  };
}

export class SqliteChangeRequestRepository implements ChangeRequestRepository {
  private outboxAvailableHandler: (() => void) | null = null;

  constructor(private readonly database: HubDatabase) {
    database.read((connection) =>
      applyHubDatabaseMigrations(connection, CHANGE_REQUEST_MIGRATIONS, 'change-requests'),
    );
  }

  async insert(input: ChangeRequestInsert): Promise<ChangeRequestRecord> {
    const inserted = await this.database.writeTransaction('insert change request', (connection) => {
      connection
        .prepare(
          `
          INSERT INTO change_requests (
            id, status, drone_id, drone_name, chat_id, chat_name, repo_root,
            base_branch, base_sha, destination_branch, snapshot_ref, snapshot_sha,
            source_head_sha, revision, title, description, created_by_json,
            merged_by_json, merge_commit_sha, last_error, created_at, updated_at,
            merged_at, closed_at, github_mirror_json
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `,
        )
        .run(
          input.id,
          input.status,
          input.droneId,
          input.droneName,
          input.chatId,
          input.chatName,
          input.repoRoot,
          input.baseBranch,
          input.baseSha,
          input.destinationBranch,
          input.snapshotRef,
          input.snapshotSha,
          input.sourceHeadSha,
          input.revision,
          input.title,
          input.description,
          JSON.stringify(input.createdBy),
          input.mergedBy ? JSON.stringify(input.mergedBy) : null,
          input.mergeCommitSha,
          input.lastError,
          input.createdAt,
          input.updatedAt,
          input.mergedAt,
          input.closedAt,
          input.githubMirror ? JSON.stringify(input.githubMirror) : null,
        );
      const row = connection
        .prepare('SELECT * FROM change_requests WHERE id = ?')
        .get(input.id) as ChangeRequestRow;
      const created = record(row);
      insertOutboxEvent(
        connection,
        createChangeRequestDomainEvent(created, 'change_request.created', input.createdAt),
      );
      return created;
    });
    this.outboxAvailableHandler?.();
    return inserted;
  }

  get(id: string): ChangeRequestRecord | null {
    return this.database.read((connection) => {
      const row = connection.prepare('SELECT * FROM change_requests WHERE id = ?').get(id) as
        | ChangeRequestRow
        | undefined;
      return row ? record(row) : null;
    });
  }

  getByNumber(number: number): ChangeRequestRecord | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare('SELECT * FROM change_requests WHERE sequence = ?')
        .get(number) as ChangeRequestRow | undefined;
      return row ? record(row) : null;
    });
  }

  getByNumbers(numbersRaw: number[]): Map<number, ChangeRequestRecord> {
    const numbers = [
      ...new Set(numbersRaw.filter((number) => Number.isSafeInteger(number) && number > 0)),
    ];
    if (numbers.length === 0) return new Map();
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `SELECT * FROM change_requests
           WHERE sequence IN (${numbers.map(() => '?').join(', ')})`,
        )
        .all(...numbers) as ChangeRequestRow[];
      return new Map(rows.map((row) => [row.sequence, record(row)]));
    });
  }

  list(
    filters: {
      droneId?: string;
      chatName?: string;
      status?: ChangeRequestStatus;
    } = {},
  ): ChangeRequestRecord[] {
    return this.database.read((connection) => {
      const clauses: string[] = [];
      const values: string[] = [];
      if (filters.droneId) {
        clauses.push('drone_id = ?');
        values.push(filters.droneId);
      }
      if (filters.chatName) {
        clauses.push('chat_name = ?');
        values.push(filters.chatName);
      }
      if (filters.status) {
        clauses.push('status = ?');
        values.push(filters.status);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      return (
        connection
          .prepare(`SELECT * FROM change_requests ${where} ORDER BY updated_at DESC, sequence DESC`)
          .all(...values) as ChangeRequestRow[]
      ).map(record);
    });
  }

  async update(id: string, patch: ChangeRequestPatch): Promise<ChangeRequestRecord> {
    const updated = await this.database.writeTransaction('update change request', (connection) => {
      const current = connection.prepare('SELECT * FROM change_requests WHERE id = ?').get(id) as
        | ChangeRequestRow
        | undefined;
      if (!current) throw new Error(`unknown change request: ${id}`);
      const next = { ...record(current), ...patch };
      next.stateVersion += 1;
      connection
        .prepare(
          `
          UPDATE change_requests SET
            state_version = ?, status = ?, destination_branch = ?, snapshot_ref = ?, snapshot_sha = ?,
            source_head_sha = ?, revision = ?, title = ?, description = ?,
            merged_by_json = ?, merge_commit_sha = ?, last_error = ?, updated_at = ?,
            merged_at = ?, closed_at = ?, github_mirror_json = ?
          WHERE id = ?
        `,
        )
        .run(
          next.stateVersion,
          next.status,
          next.destinationBranch,
          next.snapshotRef,
          next.snapshotSha,
          next.sourceHeadSha,
          next.revision,
          next.title,
          next.description,
          next.mergedBy ? JSON.stringify(next.mergedBy) : null,
          next.mergeCommitSha,
          next.lastError,
          next.updatedAt,
          next.mergedAt,
          next.closedAt,
          next.githubMirror ? JSON.stringify(next.githubMirror) : null,
          id,
        );
      const row = connection
        .prepare('SELECT * FROM change_requests WHERE id = ?')
        .get(id) as ChangeRequestRow;
      const changed = record(row);
      const occurredAt =
        patch.updatedAt ?? patch.githubMirror?.updatedAt ?? new Date().toISOString();
      insertOutboxEvent(
        connection,
        createChangeRequestDomainEvent(
          changed,
          changeRequestEventTypeForStatus(changed.status),
          occurredAt,
        ),
      );
      return changed;
    });
    this.outboxAvailableHandler?.();
    return updated;
  }

  async emitEvent(
    id: string,
    eventType: Exclude<ChangeRequestDomainEventType, 'change_request.created'>,
    occurredAt: string,
  ): Promise<ChangeRequestRecord> {
    const request = await this.database.writeTransaction(
      'emit change request event',
      (connection) => {
        const current = connection.prepare('SELECT * FROM change_requests WHERE id = ?').get(id) as
          | ChangeRequestRow
          | undefined;
        if (!current) throw new Error(`unknown change request: ${id}`);
        connection
          .prepare('UPDATE change_requests SET state_version = state_version + 1 WHERE id = ?')
          .run(id);
        const nextRow = connection
          .prepare('SELECT * FROM change_requests WHERE id = ?')
          .get(id) as ChangeRequestRow;
        const next = record(nextRow);
        insertOutboxEvent(connection, createChangeRequestDomainEvent(next, eventType, occurredAt));
        return next;
      },
    );
    this.outboxAvailableHandler?.();
    return request;
  }

  listPendingEvents(limit = 100): PendingChangeRequestDomainEvent[] {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `SELECT id, request_number, state_version, event_type, occurred_at,
             request_json, attempt_count
           FROM change_request_event_outbox
           ORDER BY sequence
           LIMIT ?`,
        )
        .all(boundedLimit) as ChangeRequestOutboxRow[];
      return rows.map(pendingEventFromRow);
    });
  }

  async markEventDispatched(eventId: string): Promise<void> {
    await this.database.writeTransaction('complete change request event', (connection) => {
      connection.prepare('DELETE FROM change_request_event_outbox WHERE id = ?').run(eventId);
    });
  }

  async markEventFailed(eventId: string, error: string, attemptedAt: string): Promise<void> {
    await this.database.writeTransaction('fail change request event', (connection) => {
      connection
        .prepare(
          `UPDATE change_request_event_outbox
           SET attempt_count = attempt_count + 1, last_error = ?
           WHERE id = ?`,
        )
        .run(`${attemptedAt}: ${error}`.slice(0, 2_000), eventId);
    });
  }

  setOutboxAvailableHandler(handler: (() => void) | null): void {
    this.outboxAvailableHandler = handler;
  }
}

type ChangeRequestOutboxRow = {
  id: string;
  request_number: number;
  state_version: number;
  event_type: ChangeRequestDomainEventType;
  occurred_at: string;
  request_json: string;
  attempt_count: number;
};

function insertOutboxEvent(
  connection: HubDatabaseConnection,
  event: ChangeRequestDomainEvent,
): void {
  connection
    .prepare(
      `INSERT INTO change_request_event_outbox (
        id, request_number, state_version, event_type, occurred_at,
        request_json, attempt_count, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
      ON CONFLICT (request_number) DO UPDATE SET
        id = excluded.id,
        state_version = excluded.state_version,
        event_type = excluded.event_type,
        occurred_at = excluded.occurred_at,
        request_json = excluded.request_json,
        attempt_count = 0,
        last_error = NULL,
        created_at = excluded.created_at`,
    )
    .run(
      event.id,
      event.requestNumber,
      event.stateVersion,
      event.eventType,
      event.occurredAt,
      JSON.stringify(event.request),
      event.occurredAt,
    );
}

function pendingEventFromRow(row: ChangeRequestOutboxRow): PendingChangeRequestDomainEvent {
  const request = JSON.parse(row.request_json) as ChangeRequestRecord;
  return {
    id: row.id,
    requestNumber: row.request_number,
    stateVersion: row.state_version,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    request,
    attemptCount: row.attempt_count,
  };
}

let cached: { path: string; repository: SqliteChangeRequestRepository } | null = null;

export function getChangeRequestRepository(): ChangeRequestRepository {
  const database = getHubDatabase();
  if (!database) throw new Error('Hub database is unavailable');
  if (cached?.path === database.path) return cached.repository;
  const repository = new SqliteChangeRequestRepository(database);
  cached = { path: database.path, repository };
  return repository;
}
