import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from '../../host/hub-database';
import { initializeHubOutbox } from '../../host/hub-outbox';
import {
  changeRequestEventTypeForStatus,
  createChangeRequestDomainEvent,
  type ChangeRequestDomainEventType,
} from './change-request-events';
import { appendChangeRequestOutboxEvent } from './change-request-outbox';
import type {
  ChangeRequestActor,
  ChangeRequestGithubMirrorRecord,
  ChangeRequestRecord,
  ChangeRequestRevisionRecord,
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

type ChangeRequestRevisionRow = {
  request_id: string;
  revision: number;
  base_branch: string;
  base_sha: string;
  snapshot_ref: string;
  snapshot_sha: string;
  source_ref: string;
  source_head_sha: string;
  object_store_path: string | null;
  created_by_json: string;
  created_at: string;
};

type ChangeRequestPublicationRow = {
  request_id: string;
  provider: string;
  external_id: string;
  state: string;
  url: string;
  head_ref: string;
  head_sha: string;
  target_ref: string;
  auto_sync: number;
  branch_owned: number;
  synced_revision: number;
  synced_request_updated_at: string;
  merge_commit_sha: string | null;
  last_error: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type ChangeRequestMergeAttemptRow = {
  id: string;
  request_id: string;
  revision: number;
  destination_branch: string;
  expected_target_sha: string;
  merge_commit_sha: string;
  actor_json: string;
  status: 'prepared' | 'completed' | 'failed';
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangeRequestMergeAttempt = {
  id: string;
  requestId: string;
  revision: number;
  destinationBranch: string;
  expectedTargetSha: string;
  mergeCommitSha: string;
  actor: ChangeRequestActor;
  status: 'prepared' | 'completed' | 'failed';
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChangeRequestInsert = Omit<ChangeRequestRecord, 'number' | 'stateVersion'>;
export type ChangeRequestRevisionInsert = Omit<ChangeRequestRevisionRecord, 'requestId'>;

export type ChangeRequestPatch = Partial<
  Pick<
    ChangeRequestRecord,
    | 'status'
    | 'baseSha'
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

export type ChangeRequestUpdate =
  | ChangeRequestPatch
  | ((current: ChangeRequestRecord) => ChangeRequestPatch);

export interface ChangeRequestRepository {
  insert(
    input: ChangeRequestInsert,
    revision?: ChangeRequestRevisionInsert,
  ): Promise<ChangeRequestRecord>;
  get(id: string): ChangeRequestRecord | null;
  getByNumber(number: number): ChangeRequestRecord | null;
  getByNumbers(numbers: number[]): Map<number, ChangeRequestRecord>;
  list(filters?: {
    droneId?: string;
    chatName?: string;
    status?: ChangeRequestStatus;
  }): ChangeRequestRecord[];
  /** Atomically reads and updates a change request when given an updater function. */
  update(id: string, update: ChangeRequestUpdate): Promise<ChangeRequestRecord>;
  updateWithRevision(
    id: string,
    update: ChangeRequestUpdate,
    revision: ChangeRequestRevisionInsert,
  ): Promise<ChangeRequestRecord>;
  getRevision(id: string, revision: number): ChangeRequestRevisionRecord | null;
  listRevisions(id: string): ChangeRequestRevisionRecord[];
  insertMergeAttempt(attempt: ChangeRequestMergeAttempt): Promise<void>;
  completeMergeAttempt(
    id: string,
    status: 'completed' | 'failed',
    error: string | null,
    updatedAt: string,
  ): Promise<void>;
  listPreparedMergeAttempts(): ChangeRequestMergeAttempt[];
  emitEvent(
    id: string,
    eventType: Exclude<ChangeRequestDomainEventType, 'change_request.created'>,
    occurredAt: string,
  ): Promise<ChangeRequestRecord>;
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
  {
    version: 4,
    name: 'move change request events to shared outbox',
    migrate(connection) {
      const pending = connection
        .prepare(
          `SELECT id, request_number, state_version, event_type, occurred_at, request_json
           FROM change_request_event_outbox
           ORDER BY sequence`,
        )
        .all() as LegacyChangeRequestOutboxRow[];
      for (const row of pending) {
        appendChangeRequestOutboxEvent(connection, {
          id: row.id,
          requestNumber: row.request_number,
          stateVersion: row.state_version,
          eventType: row.event_type,
          occurredAt: row.occurred_at,
          request: JSON.parse(row.request_json) as ChangeRequestRecord,
        });
      }
      connection.exec('DROP TABLE change_request_event_outbox;');
    },
  },
  {
    version: 5,
    name: 'immutable change request revisions',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE change_request_revisions (
          request_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          base_branch TEXT NOT NULL,
          base_sha TEXT NOT NULL,
          snapshot_ref TEXT NOT NULL,
          snapshot_sha TEXT NOT NULL,
          source_ref TEXT NOT NULL,
          source_head_sha TEXT NOT NULL,
          object_store_path TEXT,
          created_by_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (request_id, revision),
          FOREIGN KEY (request_id) REFERENCES change_requests(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_change_request_revisions_request
          ON change_request_revisions (request_id, revision DESC);
      `);
      connection.exec(`
        INSERT INTO change_request_revisions (
          request_id, revision, base_branch, base_sha, snapshot_ref, snapshot_sha,
          source_ref, source_head_sha, object_store_path, created_by_json, created_at
        )
        SELECT id, revision, base_branch, base_sha, snapshot_ref, snapshot_sha,
          snapshot_ref, source_head_sha, NULL, created_by_json, updated_at
        FROM change_requests
        WHERE snapshot_ref IS NOT NULL AND snapshot_sha IS NOT NULL;
      `);
    },
  },
  {
    version: 6,
    name: 'provider neutral change request publications',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE change_request_publications (
          request_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          state TEXT NOT NULL,
          url TEXT NOT NULL,
          head_ref TEXT NOT NULL,
          head_sha TEXT NOT NULL,
          target_ref TEXT NOT NULL,
          auto_sync INTEGER NOT NULL CHECK (auto_sync IN (0, 1)),
          branch_owned INTEGER NOT NULL CHECK (branch_owned IN (0, 1)),
          synced_revision INTEGER NOT NULL CHECK (synced_revision >= 0),
          synced_request_updated_at TEXT NOT NULL,
          merge_commit_sha TEXT,
          last_error TEXT,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (request_id, provider),
          UNIQUE (provider, external_id),
          FOREIGN KEY (request_id) REFERENCES change_requests(id) ON DELETE CASCADE
        );
      `);
      const legacy = connection
        .prepare(
          `SELECT id, github_mirror_json FROM change_requests
           WHERE github_mirror_json IS NOT NULL`,
        )
        .all() as Array<{ id: string; github_mirror_json: string }>;
      for (const row of legacy) {
        const mirror = parseGithubMirror(row.github_mirror_json);
        if (mirror) upsertGithubPublication(connection, row.id, mirror);
      }
    },
  },
  {
    version: 7,
    name: 'recoverable direct merge attempts',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE change_request_merge_attempts (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          destination_branch TEXT NOT NULL,
          expected_target_sha TEXT NOT NULL,
          merge_commit_sha TEXT NOT NULL,
          actor_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('prepared', 'completed', 'failed')),
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (request_id) REFERENCES change_requests(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_change_request_merge_attempts_status
          ON change_request_merge_attempts (status, created_at);
      `);
    },
  },
];

type LegacyChangeRequestOutboxRow = {
  id: string;
  request_number: number;
  state_version: number;
  event_type: ChangeRequestDomainEventType;
  occurred_at: string;
  request_json: string;
};

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

function githubPublication(
  connection: HubDatabaseConnection,
  requestId: string,
): ChangeRequestGithubMirrorRecord | null {
  const row = connection
    .prepare(
      `SELECT * FROM change_request_publications
       WHERE request_id = ? AND provider = 'github'`,
    )
    .get(requestId) as ChangeRequestPublicationRow | undefined;
  if (!row) return null;
  let metadata: { owner?: unknown; repo?: unknown; pullNumber?: unknown } = {};
  try {
    metadata = JSON.parse(row.metadata_json) as typeof metadata;
  } catch {
    return null;
  }
  const pullNumber = Number(metadata.pullNumber ?? row.external_id);
  if (!metadata.owner || !metadata.repo || !Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    return null;
  }
  return {
    owner: String(metadata.owner),
    repo: String(metadata.repo),
    pullNumber,
    htmlUrl: row.url,
    headBranch: row.head_ref,
    headSha: row.head_sha,
    baseBranch: row.target_ref,
    state: row.state === 'merged' ? 'merged' : row.state === 'closed' ? 'closed' : 'open',
    autoUpdate: row.auto_sync === 1,
    branchOwnedByDroneHub: row.branch_owned === 1,
    syncedRevision: row.synced_revision,
    syncedNativeUpdatedAt: row.synced_request_updated_at,
    mergeCommitSha: row.merge_commit_sha,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function upsertGithubPublication(
  connection: HubDatabaseConnection,
  requestId: string,
  mirror: ChangeRequestGithubMirrorRecord,
): void {
  connection
    .prepare(
      `INSERT INTO change_request_publications (
        request_id, provider, external_id, state, url, head_ref, head_sha, target_ref,
        auto_sync, branch_owned, synced_revision, synced_request_updated_at,
        merge_commit_sha, last_error, metadata_json, created_at, updated_at
      ) VALUES (?, 'github', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (request_id, provider) DO UPDATE SET
        external_id = excluded.external_id,
        state = excluded.state,
        url = excluded.url,
        head_ref = excluded.head_ref,
        head_sha = excluded.head_sha,
        target_ref = excluded.target_ref,
        auto_sync = excluded.auto_sync,
        branch_owned = excluded.branch_owned,
        synced_revision = excluded.synced_revision,
        synced_request_updated_at = excluded.synced_request_updated_at,
        merge_commit_sha = excluded.merge_commit_sha,
        last_error = excluded.last_error,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`,
    )
    .run(
      requestId,
      `${mirror.owner}/${mirror.repo}#${mirror.pullNumber}`,
      mirror.state,
      mirror.htmlUrl,
      mirror.headBranch,
      mirror.headSha,
      mirror.baseBranch,
      mirror.autoUpdate ? 1 : 0,
      mirror.branchOwnedByDroneHub ? 1 : 0,
      mirror.syncedRevision,
      mirror.syncedNativeUpdatedAt,
      mirror.mergeCommitSha,
      mirror.lastError,
      JSON.stringify({
        owner: mirror.owner,
        repo: mirror.repo,
        pullNumber: mirror.pullNumber,
      }),
      mirror.createdAt,
      mirror.updatedAt,
    );
}

function record(
  row: ChangeRequestRow,
  githubMirror?: ChangeRequestGithubMirrorRecord | null,
): ChangeRequestRecord {
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
    githubMirror:
      githubMirror === undefined ? parseGithubMirror(row.github_mirror_json) : githubMirror,
  };
}

function recordFromConnection(
  connection: HubDatabaseConnection,
  row: ChangeRequestRow,
): ChangeRequestRecord {
  return record(row, githubPublication(connection, row.id));
}

function revisionRecord(row: ChangeRequestRevisionRow): ChangeRequestRevisionRecord {
  return {
    requestId: row.request_id,
    number: row.revision,
    baseBranch: row.base_branch,
    baseSha: row.base_sha,
    snapshotRef: row.snapshot_ref,
    snapshotSha: row.snapshot_sha,
    sourceRef: row.source_ref,
    sourceHeadSha: row.source_head_sha,
    objectStorePath: row.object_store_path,
    createdBy: parseActor(row.created_by_json) ?? {
      kind: 'system',
      id: null,
      label: 'Unknown actor',
    },
    createdAt: row.created_at,
  };
}

function mergeAttemptRecord(row: ChangeRequestMergeAttemptRow): ChangeRequestMergeAttempt {
  return {
    id: row.id,
    requestId: row.request_id,
    revision: row.revision,
    destinationBranch: row.destination_branch,
    expectedTargetSha: row.expected_target_sha,
    mergeCommitSha: row.merge_commit_sha,
    actor: parseActor(row.actor_json) ?? { kind: 'system', id: null, label: 'DroneHub' },
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertRevision(
  connection: HubDatabaseConnection,
  requestId: string,
  revision: ChangeRequestRevisionInsert,
): void {
  connection
    .prepare(
      `INSERT INTO change_request_revisions (
        request_id, revision, base_branch, base_sha, snapshot_ref, snapshot_sha,
        source_ref, source_head_sha, object_store_path, created_by_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      requestId,
      revision.number,
      revision.baseBranch,
      revision.baseSha,
      revision.snapshotRef,
      revision.snapshotSha,
      revision.sourceRef,
      revision.sourceHeadSha,
      revision.objectStorePath,
      JSON.stringify(revision.createdBy),
      revision.createdAt,
    );
}

function revisionFromCurrentRecord(input: ChangeRequestInsert): ChangeRequestRevisionInsert | null {
  if (!input.snapshotRef || !input.snapshotSha) return null;
  return {
    number: input.revision,
    baseBranch: input.baseBranch,
    baseSha: input.baseSha,
    snapshotRef: input.snapshotRef,
    snapshotSha: input.snapshotSha,
    sourceRef: input.snapshotRef,
    sourceHeadSha: input.sourceHeadSha,
    objectStorePath: null,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  };
}

export class SqliteChangeRequestRepository implements ChangeRequestRepository {
  constructor(private readonly database: HubDatabase) {
    initializeHubOutbox(database);
    database.read((connection) =>
      applyHubDatabaseMigrations(connection, CHANGE_REQUEST_MIGRATIONS, 'change-requests'),
    );
  }

  async insert(
    input: ChangeRequestInsert,
    revision: ChangeRequestRevisionInsert | undefined = revisionFromCurrentRecord(input) ??
      undefined,
  ): Promise<ChangeRequestRecord> {
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
          null,
        );
      if (input.githubMirror) upsertGithubPublication(connection, input.id, input.githubMirror);
      const row = connection
        .prepare('SELECT * FROM change_requests WHERE id = ?')
        .get(input.id) as ChangeRequestRow;
      const created = recordFromConnection(connection, row);
      if (revision) insertRevision(connection, created.id, revision);
      appendChangeRequestOutboxEvent(
        connection,
        createChangeRequestDomainEvent(created, 'change_request.created', input.createdAt),
      );
      return created;
    });
    return inserted;
  }

  get(id: string): ChangeRequestRecord | null {
    return this.database.read((connection) => {
      const row = connection.prepare('SELECT * FROM change_requests WHERE id = ?').get(id) as
        | ChangeRequestRow
        | undefined;
      return row ? recordFromConnection(connection, row) : null;
    });
  }

  getByNumber(number: number): ChangeRequestRecord | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare('SELECT * FROM change_requests WHERE sequence = ?')
        .get(number) as ChangeRequestRow | undefined;
      return row ? recordFromConnection(connection, row) : null;
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
      return new Map(rows.map((row) => [row.sequence, recordFromConnection(connection, row)]));
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
      ).map((row) => recordFromConnection(connection, row));
    });
  }

  getRevision(id: string, revision: number): ChangeRequestRevisionRecord | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare(
          `SELECT * FROM change_request_revisions
           WHERE request_id = ? AND revision = ?`,
        )
        .get(id, revision) as ChangeRequestRevisionRow | undefined;
      return row ? revisionRecord(row) : null;
    });
  }

  listRevisions(id: string): ChangeRequestRevisionRecord[] {
    return this.database.read((connection) =>
      (
        connection
          .prepare(
            `SELECT * FROM change_request_revisions
             WHERE request_id = ? ORDER BY revision DESC`,
          )
          .all(id) as ChangeRequestRevisionRow[]
      ).map(revisionRecord),
    );
  }

  async insertMergeAttempt(attempt: ChangeRequestMergeAttempt): Promise<void> {
    await this.database.writeTransaction('prepare change request merge', (connection) => {
      connection
        .prepare(
          `INSERT INTO change_request_merge_attempts (
          id, request_id, revision, destination_branch, expected_target_sha,
          merge_commit_sha, actor_json, status, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attempt.id,
          attempt.requestId,
          attempt.revision,
          attempt.destinationBranch,
          attempt.expectedTargetSha,
          attempt.mergeCommitSha,
          JSON.stringify(attempt.actor),
          attempt.status,
          attempt.error,
          attempt.createdAt,
          attempt.updatedAt,
        );
    });
  }

  async completeMergeAttempt(
    id: string,
    status: 'completed' | 'failed',
    error: string | null,
    updatedAt: string,
  ): Promise<void> {
    await this.database.writeTransaction('complete change request merge attempt', (connection) => {
      connection
        .prepare(
          `UPDATE change_request_merge_attempts
         SET status = ?, error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(status, error, updatedAt, id);
    });
  }

  listPreparedMergeAttempts(): ChangeRequestMergeAttempt[] {
    return this.database.read((connection) =>
      (
        connection
          .prepare(
            `SELECT * FROM change_request_merge_attempts
         WHERE status = 'prepared' ORDER BY created_at`,
          )
          .all() as ChangeRequestMergeAttemptRow[]
      ).map(mergeAttemptRecord),
    );
  }

  async update(id: string, update: ChangeRequestUpdate): Promise<ChangeRequestRecord> {
    return await this.updateInternal(id, update);
  }

  async updateWithRevision(
    id: string,
    update: ChangeRequestUpdate,
    revision: ChangeRequestRevisionInsert,
  ): Promise<ChangeRequestRecord> {
    return await this.updateInternal(id, update, revision);
  }

  private async updateInternal(
    id: string,
    update: ChangeRequestUpdate,
    revision?: ChangeRequestRevisionInsert,
  ): Promise<ChangeRequestRecord> {
    return await this.database.writeTransaction('update change request', (connection) => {
      const currentRow = connection
        .prepare('SELECT * FROM change_requests WHERE id = ?')
        .get(id) as ChangeRequestRow | undefined;
      if (!currentRow) throw new Error(`unknown change request: ${id}`);
      const current = recordFromConnection(connection, currentRow);
      const patch = typeof update === 'function' ? update(current) : update;
      const next = { ...current, ...patch };
      next.stateVersion += 1;
      connection
        .prepare(
          `
          UPDATE change_requests SET
            state_version = ?, status = ?, base_sha = ?, destination_branch = ?, snapshot_ref = ?, snapshot_sha = ?,
            source_head_sha = ?, revision = ?, title = ?, description = ?,
            merged_by_json = ?, merge_commit_sha = ?, last_error = ?, updated_at = ?,
            merged_at = ?, closed_at = ?, github_mirror_json = NULL
          WHERE id = ?
        `,
        )
        .run(
          next.stateVersion,
          next.status,
          next.baseSha,
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
          id,
        );
      if (Object.prototype.hasOwnProperty.call(patch, 'githubMirror')) {
        if (patch.githubMirror) upsertGithubPublication(connection, id, patch.githubMirror);
        else {
          connection
            .prepare(
              "DELETE FROM change_request_publications WHERE request_id = ? AND provider = 'github'",
            )
            .run(id);
        }
      }
      const row = connection
        .prepare('SELECT * FROM change_requests WHERE id = ?')
        .get(id) as ChangeRequestRow;
      const changed = recordFromConnection(connection, row);
      if (revision) {
        if (revision.number !== changed.revision) {
          throw new Error(
            `change request revision mismatch: expected ${changed.revision}, received ${revision.number}`,
          );
        }
        insertRevision(connection, id, revision);
      }
      const occurredAt =
        patch.updatedAt ?? patch.githubMirror?.updatedAt ?? new Date().toISOString();
      appendChangeRequestOutboxEvent(
        connection,
        createChangeRequestDomainEvent(
          changed,
          changeRequestEventTypeForStatus(changed.status),
          occurredAt,
        ),
      );
      return changed;
    });
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
        const next = recordFromConnection(connection, nextRow);
        appendChangeRequestOutboxEvent(
          connection,
          createChangeRequestDomainEvent(next, eventType, occurredAt),
        );
        return next;
      },
    );
    return request;
  }
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
