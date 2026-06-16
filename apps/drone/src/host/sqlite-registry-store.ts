import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { droneRootPath } from './paths';

type DatabaseConstructor = typeof import('better-sqlite3');
type DatabaseInstance = import('better-sqlite3').Database;

type RegistryStateRow = {
  registry_json: string;
};

let cached:
  | {
      dbPath: string;
      db: DatabaseInstance;
      store: SqliteRegistryStore;
    }
  | null = null;

let unavailableReason: string | null = null;

function loadDatabaseConstructor(): DatabaseConstructor | null {
  try {
    // Keep this dynamic so Bun can keep using registry.json when the native
    // better-sqlite3 binding was built for Node's ABI.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('better-sqlite3') as DatabaseConstructor;
  } catch (error: any) {
    unavailableReason = error?.message ?? String(error);
    return null;
  }
}

export function hubSqlitePath(): string {
  return droneRootPath('hub.sqlite');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function sourceHash(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('base64url');
}

function parseIsoMs(raw: unknown): number {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return 0;
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeRecord(raw: unknown): Record<string, any> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
}

function normalizeTurn(raw: any): any {
  const at = String(raw?.at ?? new Date().toISOString());
  const id = typeof raw?.id === 'string' && raw.id.trim() ? String(raw.id).trim() : undefined;
  const promptAt = typeof raw?.promptAt === 'string' && raw.promptAt.trim() ? String(raw.promptAt).trim() : undefined;
  const completedAt = typeof raw?.completedAt === 'string' && raw.completedAt.trim() ? String(raw.completedAt).trim() : undefined;
  const error = raw?.ok ? undefined : String(raw?.error ?? 'failed');
  return {
    at,
    ...(id ? { id } : {}),
    prompt: String(raw?.prompt ?? ''),
    ok: Boolean(raw?.ok),
    output: raw?.ok ? String(raw?.output ?? '') : '',
    ...(error ? { error } : {}),
    ...(promptAt ? { promptAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(Array.isArray(raw?.attachments) ? { attachments: raw.attachments } : {}),
    ...(raw?.automation && typeof raw.automation === 'object' ? { automation: raw.automation } : {}),
    ...(raw?.inheritedFromClone === true ? { inheritedFromClone: true } : {}),
    ...(raw?.agentMessageAutoContinue && typeof raw.agentMessageAutoContinue === 'object'
      ? { agentMessageAutoContinue: raw.agentMessageAutoContinue }
      : {}),
    ...(raw?.agentSuggestion && typeof raw.agentSuggestion === 'object' ? { agentSuggestion: raw.agentSuggestion } : {}),
    ...(raw?.dockerSnapshot && typeof raw.dockerSnapshot === 'object' ? { dockerSnapshot: raw.dockerSnapshot } : {}),
  };
}

function sortTranscriptTurns(turnsRaw: unknown): any[] {
  const rawList = Array.isArray(turnsRaw) ? turnsRaw : [];
  return rawList
    .map((t, idx) => ({ t: normalizeTurn(t), idx }))
    .sort((a, b) => {
      const aa = parseIsoMs(a.t.promptAt ?? a.t.at);
      const bb = parseIsoMs(b.t.promptAt ?? b.t.at);
      if (aa !== bb) return aa - bb;
      return a.idx - b.idx;
    })
    .map((item) => item.t);
}

function metadataHashForTurn(turn: any, ordinal: number): string {
  return crypto
    .createHash('sha256')
    .update(`${ordinal}\n${turn.id ?? ''}\n${turn.at}\n${turn.promptAt ?? ''}\n${turn.completedAt ?? ''}\n${turn.prompt}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function turnKey(turn: any, ordinal: number): string {
  return turn.id ? `id:${turn.id}` : `ordinal:${ordinal}:${metadataHashForTurn(turn, ordinal)}`;
}

function runtimeKind(entry: any): string {
  const kind = String(entry?.runtime?.kind ?? entry?.runtime ?? 'container').trim();
  return kind || 'container';
}

class SqliteRegistryStore {
  private replaceRegistryTx: (registry: any, sourcePath: string | null, migratedAt: string | null, updatedAt: string) => void;

  constructor(private readonly db: DatabaseInstance) {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hub_registry_state (
        id TEXT NOT NULL PRIMARY KEY CHECK (id = 'current'),
        schema_version INTEGER NOT NULL,
        registry_version INTEGER NOT NULL,
        source_hash TEXT NOT NULL,
        source_path TEXT,
        migrated_at TEXT,
        updated_at TEXT NOT NULL,
        registry_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hub_registry_migrations (
        id TEXT NOT NULL PRIMARY KEY,
        source_path TEXT,
        backup_path TEXT,
        source_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hub_settings (
        key TEXT NOT NULL PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS hub_repos (
        repo_key TEXT NOT NULL PRIMARY KEY,
        repo_path TEXT NOT NULL,
        added_at TEXT,
        repo_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hub_groups (
        group_key TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        group_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hub_playbooks (
        playbook_id TEXT NOT NULL PRIMARY KEY,
        label TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        playbook_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hub_skills (
        skill_id TEXT NOT NULL PRIMARY KEY,
        skill_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hub_playbook_run_queue_items (
        item_id TEXT NOT NULL PRIMARY KEY,
        playbook_id TEXT,
        repo_path TEXT,
        created_at TEXT,
        updated_at TEXT,
        item_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hub_drones (
        drone_id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL,
        container_name TEXT,
        runtime_kind TEXT NOT NULL,
        group_name TEXT,
        kind TEXT,
        visibility TEXT,
        host_port INTEGER,
        container_port INTEGER,
        repo_path TEXT,
        created_at TEXT,
        drone_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hub_drones_name ON hub_drones (name);

      CREATE TABLE IF NOT EXISTS hub_pending_drones (
        drone_id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL,
        container_name TEXT,
        runtime_kind TEXT NOT NULL,
        group_name TEXT,
        phase TEXT,
        repo_path TEXT,
        created_at TEXT,
        updated_at TEXT,
        pending_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hub_pending_drones_name ON hub_pending_drones (name);

      CREATE TABLE IF NOT EXISTS hub_archived_drones (
        drone_id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL,
        container_name TEXT,
        runtime_kind TEXT NOT NULL,
        group_name TEXT,
        archived_at TEXT,
        delete_at TEXT,
        archive_retention TEXT,
        archived_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hub_archived_drones_name ON hub_archived_drones (name);

      CREATE TABLE IF NOT EXISTS hub_chats (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        source_hash TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL,
        created_at TEXT,
        chat_json TEXT NOT NULL,
        PRIMARY KEY (drone_id, chat_name)
      );

      CREATE INDEX IF NOT EXISTS idx_hub_chats_drone_name
        ON hub_chats (drone_id, chat_name);

      CREATE TABLE IF NOT EXISTS transcript_chats (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        transcript_version INTEGER NOT NULL DEFAULT 0,
        source_hash TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL,
        PRIMARY KEY (drone_id, chat_name)
      );

      CREATE TABLE IF NOT EXISTS transcript_turns (
        drone_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        turn_key TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        at TEXT NOT NULL,
        prompt_at TEXT,
        completed_at TEXT,
        prompt TEXT NOT NULL,
        ok INTEGER NOT NULL,
        output TEXT NOT NULL,
        error TEXT,
        inherited_from_clone INTEGER NOT NULL DEFAULT 0,
        turn_json TEXT NOT NULL,
        PRIMARY KEY (drone_id, chat_name, turn_key)
      );

      CREATE INDEX IF NOT EXISTS idx_transcript_turns_chat_ordinal
        ON transcript_turns (drone_id, chat_name, ordinal);
    `);

    const upsertState = this.db.prepare(`
      INSERT INTO hub_registry_state (
        id,
        schema_version,
        registry_version,
        source_hash,
        source_path,
        migrated_at,
        updated_at,
        registry_json
      )
      VALUES ('current', 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        schema_version = excluded.schema_version,
        registry_version = excluded.registry_version,
        source_hash = excluded.source_hash,
        source_path = COALESCE(hub_registry_state.source_path, excluded.source_path),
        migrated_at = COALESCE(hub_registry_state.migrated_at, excluded.migrated_at),
        updated_at = excluded.updated_at,
        registry_json = excluded.registry_json
    `);
    const deleteSettings = this.db.prepare('DELETE FROM hub_settings');
    const insertSetting = this.db.prepare('INSERT INTO hub_settings (key, value_json, updated_at) VALUES (?, ?, ?)');
    const deleteRepos = this.db.prepare('DELETE FROM hub_repos');
    const insertRepo = this.db.prepare('INSERT INTO hub_repos (repo_key, repo_path, added_at, repo_json) VALUES (?, ?, ?, ?)');
    const deleteGroups = this.db.prepare('DELETE FROM hub_groups');
    const insertGroup = this.db.prepare('INSERT INTO hub_groups (group_key, name, created_at, updated_at, group_json) VALUES (?, ?, ?, ?, ?)');
    const deletePlaybooks = this.db.prepare('DELETE FROM hub_playbooks');
    const insertPlaybook = this.db.prepare(
      'INSERT INTO hub_playbooks (playbook_id, label, created_at, updated_at, playbook_json) VALUES (?, ?, ?, ?, ?)',
    );
    const deleteSkills = this.db.prepare('DELETE FROM hub_skills');
    const insertSkill = this.db.prepare('INSERT INTO hub_skills (skill_id, skill_json) VALUES (?, ?)');
    const deleteQueueItems = this.db.prepare('DELETE FROM hub_playbook_run_queue_items');
    const insertQueueItem = this.db.prepare(
      'INSERT INTO hub_playbook_run_queue_items (item_id, playbook_id, repo_path, created_at, updated_at, item_json) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const deleteDrones = this.db.prepare('DELETE FROM hub_drones');
    const insertDrone = this.db.prepare(`
      INSERT INTO hub_drones (
        drone_id,
        name,
        container_name,
        runtime_kind,
        group_name,
        kind,
        visibility,
        host_port,
        container_port,
        repo_path,
        created_at,
        drone_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deletePending = this.db.prepare('DELETE FROM hub_pending_drones');
    const insertPending = this.db.prepare(`
      INSERT INTO hub_pending_drones (
        drone_id,
        name,
        container_name,
        runtime_kind,
        group_name,
        phase,
        repo_path,
        created_at,
        updated_at,
        pending_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteArchived = this.db.prepare('DELETE FROM hub_archived_drones');
    const insertArchived = this.db.prepare(`
      INSERT INTO hub_archived_drones (
        drone_id,
        name,
        container_name,
        runtime_kind,
        group_name,
        archived_at,
        delete_at,
        archive_retention,
        archived_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteChats = this.db.prepare('DELETE FROM hub_chats');
    const insertChat = this.db.prepare(`
      INSERT INTO hub_chats (drone_id, chat_name, source_hash, imported_at, created_at, chat_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const upsertTranscriptChat = this.db.prepare(`
      INSERT INTO transcript_chats (drone_id, chat_name, transcript_version, source_hash, imported_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(drone_id, chat_name) DO UPDATE SET
        transcript_version = CASE
          WHEN transcript_chats.source_hash = excluded.source_hash THEN transcript_chats.transcript_version
          ELSE transcript_chats.transcript_version + 1
        END,
        source_hash = excluded.source_hash,
        imported_at = excluded.imported_at
    `);
    const deleteTranscriptTurns = this.db.prepare('DELETE FROM transcript_turns');
    const insertTranscriptTurn = this.db.prepare(`
      INSERT INTO transcript_turns (
        drone_id,
        chat_name,
        turn_key,
        ordinal,
        at,
        prompt_at,
        completed_at,
        prompt,
        ok,
        output,
        error,
        inherited_from_clone,
        turn_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.replaceRegistryTx = this.db.transaction((registry: any, sourcePath: string | null, migratedAt: string | null, updatedAt: string) => {
      const registryJson = stableJson(registry);
      upsertState.run(Number(registry?.version ?? 2), sourceHash(registry), sourcePath, migratedAt, updatedAt, registryJson);

      deleteSettings.run();
      for (const [key, value] of Object.entries(normalizeRecord(registry?.settings))) {
        insertSetting.run(key, stableJson(value), typeof (value as any)?.updatedAt === 'string' ? (value as any).updatedAt : null);
      }

      deleteRepos.run();
      for (const [key, value] of Object.entries(normalizeRecord(registry?.repos))) {
        insertRepo.run(key, String((value as any)?.path ?? ''), typeof (value as any)?.addedAt === 'string' ? (value as any).addedAt : null, stableJson(value));
      }

      deleteGroups.run();
      for (const [key, value] of Object.entries(normalizeRecord(registry?.groups))) {
        insertGroup.run(
          key,
          String((value as any)?.name ?? key),
          typeof (value as any)?.createdAt === 'string' ? (value as any).createdAt : null,
          typeof (value as any)?.updatedAt === 'string' ? (value as any).updatedAt : null,
          stableJson(value),
        );
      }

      deletePlaybooks.run();
      for (const [key, value] of Object.entries(normalizeRecord(registry?.playbooks))) {
        const id = String((value as any)?.id ?? key);
        insertPlaybook.run(
          id,
          String((value as any)?.label ?? id),
          typeof (value as any)?.createdAt === 'string' ? (value as any).createdAt : null,
          typeof (value as any)?.updatedAt === 'string' ? (value as any).updatedAt : null,
          stableJson(value),
        );
      }

      deleteSkills.run();
      for (const [key, value] of Object.entries(normalizeRecord(registry?.skills))) {
        insertSkill.run(key, stableJson(value));
      }

      deleteQueueItems.run();
      const queueItems = Array.isArray(registry?.playbookRunQueue?.items) ? registry.playbookRunQueue.items : [];
      for (const value of queueItems) {
        const id = String((value as any)?.id ?? '').trim();
        if (!id) continue;
        insertQueueItem.run(
          id,
          typeof (value as any)?.playbookId === 'string' ? (value as any).playbookId : null,
          typeof (value as any)?.repoPath === 'string' ? (value as any).repoPath : null,
          typeof (value as any)?.createdAt === 'string' ? (value as any).createdAt : null,
          typeof (value as any)?.updatedAt === 'string' ? (value as any).updatedAt : null,
          stableJson(value),
        );
      }

      deleteDrones.run();
      for (const [key, value] of Object.entries(normalizeRecord(registry?.drones))) {
        const id = String((value as any)?.id ?? key);
        insertDrone.run(
          id,
          String((value as any)?.name ?? id),
          typeof (value as any)?.containerName === 'string' ? (value as any).containerName : null,
          runtimeKind(value),
          typeof (value as any)?.group === 'string' ? (value as any).group : null,
          typeof (value as any)?.kind === 'string' ? (value as any).kind : null,
          typeof (value as any)?.visibility === 'string' ? (value as any).visibility : null,
          Number.isFinite(Number((value as any)?.hostPort)) ? Number((value as any).hostPort) : null,
          Number.isFinite(Number((value as any)?.containerPort)) ? Number((value as any).containerPort) : null,
          typeof (value as any)?.repoPath === 'string' ? (value as any).repoPath : null,
          typeof (value as any)?.createdAt === 'string' ? (value as any).createdAt : null,
          stableJson(value),
        );
      }

      deletePending.run();
      for (const [key, value] of Object.entries(normalizeRecord(registry?.pending))) {
        const id = String((value as any)?.id ?? key);
        insertPending.run(
          id,
          String((value as any)?.name ?? id),
          typeof (value as any)?.containerName === 'string' ? (value as any).containerName : null,
          runtimeKind(value),
          typeof (value as any)?.group === 'string' ? (value as any).group : null,
          typeof (value as any)?.phase === 'string' ? (value as any).phase : null,
          typeof (value as any)?.repoPath === 'string' ? (value as any).repoPath : null,
          typeof (value as any)?.createdAt === 'string' ? (value as any).createdAt : null,
          typeof (value as any)?.updatedAt === 'string' ? (value as any).updatedAt : null,
          stableJson(value),
        );
      }

      deleteArchived.run();
      for (const [key, value] of Object.entries(normalizeRecord(registry?.archived))) {
        const id = String((value as any)?.id ?? key);
        insertArchived.run(
          id,
          String((value as any)?.name ?? id),
          typeof (value as any)?.containerName === 'string' ? (value as any).containerName : null,
          runtimeKind(value),
          typeof (value as any)?.group === 'string' ? (value as any).group : null,
          typeof (value as any)?.archivedAt === 'string' ? (value as any).archivedAt : null,
          typeof (value as any)?.deleteAt === 'string' ? (value as any).deleteAt : null,
          typeof (value as any)?.archiveRetention === 'string' ? (value as any).archiveRetention : null,
          stableJson(value),
        );
      }

      deleteChats.run();
      deleteTranscriptTurns.run();
      const importedAt = updatedAt;
      for (const [droneKey, drone] of Object.entries(normalizeRecord(registry?.drones))) {
        const droneId = String((drone as any)?.id ?? droneKey);
        for (const [chatName, chatEntry] of Object.entries(normalizeRecord((drone as any)?.chats))) {
          insertChat.run(
            droneId,
            chatName,
            sourceHash(chatEntry),
            importedAt,
            typeof (chatEntry as any)?.createdAt === 'string' ? (chatEntry as any).createdAt : null,
            stableJson(chatEntry),
          );
          const turns = sortTranscriptTurns((chatEntry as any)?.turns);
          upsertTranscriptChat.run(droneId, chatName, sourceHash((chatEntry as any)?.turns), importedAt);
          turns.forEach((turn, index) => {
            const ordinal = index + 1;
            insertTranscriptTurn.run(
              droneId,
              chatName,
              turnKey(turn, ordinal),
              ordinal,
              turn.at,
              turn.promptAt ?? null,
              turn.completedAt ?? null,
              turn.prompt,
              turn.ok ? 1 : 0,
              turn.output,
              turn.error ?? null,
              turn.inheritedFromClone === true ? 1 : 0,
              stableJson(turn),
            );
          });
        }
      }
    }) as any;
  }

  readRegistryJson(): string | null {
    const row = this.db.prepare("SELECT registry_json FROM hub_registry_state WHERE id = 'current'").get() as RegistryStateRow | undefined;
    return typeof row?.registry_json === 'string' ? row.registry_json : null;
  }

  writeRegistry(registry: any, opts?: { sourcePath?: string | null; migratedAt?: string | null }): void {
    this.replaceRegistryTx(registry, opts?.sourcePath ?? null, opts?.migratedAt ?? null, new Date().toISOString());
  }

  recordMigration(opts: { sourcePath: string | null; backupPath: string | null; registry: unknown; createdAt?: string }): void {
    const createdAt = opts.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO hub_registry_migrations (id, source_path, backup_path, source_hash, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(crypto.randomUUID(), opts.sourcePath, opts.backupPath, sourceHash(opts.registry), createdAt);
  }
}

export function getSqliteRegistryStoreUnavailableReason(): string | null {
  return unavailableReason;
}

export function getSqliteRegistryStore(): SqliteRegistryStore | null {
  const Database = loadDatabaseConstructor();
  if (!Database) return null;
  const dbPath = hubSqlitePath();
  if (cached?.dbPath === dbPath) return cached.store;
  if (cached) {
    try {
      cached.db.close();
    } catch {
      // ignore stale close errors
    }
    cached = null;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  try {
    const db = new Database(dbPath);
    const store = new SqliteRegistryStore(db);
    cached = { dbPath, db, store };
    unavailableReason = null;
    return store;
  } catch (error: any) {
    unavailableReason = error?.message ?? String(error);
    return null;
  }
}

export function readRegistryJsonFromSqlite(): string | null | undefined {
  const store = getSqliteRegistryStore();
  if (!store) return undefined;
  return store.readRegistryJson();
}

export function readRegistryJsonFromSqlitePath(dbPath: string): string | null | undefined {
  const Database = loadDatabaseConstructor();
  if (!Database) return undefined;
  if (!fs.existsSync(dbPath)) return null;
  let db: DatabaseInstance | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT registry_json FROM hub_registry_state WHERE id = 'current'").get() as RegistryStateRow | undefined;
    return typeof row?.registry_json === 'string' ? row.registry_json : null;
  } catch (error: any) {
    unavailableReason = error?.message ?? String(error);
    return undefined;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export function writeRegistryToSqlite(registry: unknown, opts?: { sourcePath?: string | null; migratedAt?: string | null }): boolean {
  const store = getSqliteRegistryStore();
  if (!store) return false;
  store.writeRegistry(registry, opts);
  return true;
}

export function recordSqliteRegistryMigration(opts: {
  sourcePath: string | null;
  backupPath: string | null;
  registry: unknown;
  createdAt?: string;
}): boolean {
  const store = getSqliteRegistryStore();
  if (!store) return false;
  store.recordMigration(opts);
  return true;
}
