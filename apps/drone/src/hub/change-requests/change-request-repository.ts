import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  type HubDatabase,
  type HubDatabaseMigration,
} from '../../host/hub-database';
import type {
  ChangeRequestActor,
  ChangeRequestGithubMirrorRecord,
  ChangeRequestRecord,
  ChangeRequestStatus,
} from './change-request-types';

type ChangeRequestRow = {
  sequence: number;
  id: string;
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

export type ChangeRequestInsert = Omit<ChangeRequestRecord, 'number'>;

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
  list(filters?: {
    droneId?: string;
    chatName?: string;
    status?: ChangeRequestStatus;
  }): ChangeRequestRecord[];
  update(id: string, patch: ChangeRequestPatch): Promise<ChangeRequestRecord>;
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
  constructor(private readonly database: HubDatabase) {
    database.read((connection) =>
      applyHubDatabaseMigrations(connection, CHANGE_REQUEST_MIGRATIONS, 'change-requests'),
    );
  }

  async insert(input: ChangeRequestInsert): Promise<ChangeRequestRecord> {
    return await this.database.writeTransaction('insert change request', (connection) => {
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
      return record(row);
    });
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
    return await this.database.writeTransaction('update change request', (connection) => {
      const current = connection.prepare('SELECT * FROM change_requests WHERE id = ?').get(id) as
        | ChangeRequestRow
        | undefined;
      if (!current) throw new Error(`unknown change request: ${id}`);
      const next = { ...record(current), ...patch };
      connection
        .prepare(
          `
          UPDATE change_requests SET
            status = ?, destination_branch = ?, snapshot_ref = ?, snapshot_sha = ?,
            source_head_sha = ?, revision = ?, title = ?, description = ?,
            merged_by_json = ?, merge_commit_sha = ?, last_error = ?, updated_at = ?,
            merged_at = ?, closed_at = ?, github_mirror_json = ?
          WHERE id = ?
        `,
        )
        .run(
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
      return record(row);
    });
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
