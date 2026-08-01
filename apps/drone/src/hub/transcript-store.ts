import crypto from 'node:crypto';

import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  requireHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from '../host/hub-database';
import { appendHubOutboxEvent, initializeHubOutbox } from '../host/hub-outbox';
import { getPromptQueueRepository } from '../host/prompt-queue-repository';
import { normalizeSilentCompletion } from '../host/silent-completion';
import type { AgentRunFileChanges } from '@blip/protocol';
import type { AgentPlan, AgentRunActivity } from '@drone/assistant-chat';
import { normalizeAgentRunActivity } from './builtin-agent-activity';
import type { AgentRunFileChangesBaseline } from './run-file-changes';

export type StoredTranscriptTurn = {
  at: string;
  id?: string;
  prompt: string;
  ok: boolean;
  output: string;
  silentCompletion?: boolean;
  error?: string;
  promptAt?: string;
  startedAt?: string;
  completedAt?: string;
  model?: string;
  reasoning?: string;
  activity?: AgentRunActivity;
  attachments?: unknown;
  inheritedFromClone?: boolean;
  dockerSnapshot?: unknown;
  agentPlan?: AgentPlan;
  fileChanges?: AgentRunFileChanges;
};

export type StoredPendingPrompt = {
  id: string;
  at: string;
  prompt: string;
  model?: string;
  messageId?: string;
  cwd?: string | null;
  attachments?: unknown;
  state: string;
  error?: string;
  observability?: unknown;
  blipClones?: unknown;
  activity?: AgentRunActivity;
  agentPlan?: AgentPlan;
  fileChangesBaseline?: AgentRunFileChangesBaseline;
  fileChanges?: AgentRunFileChanges;
  startedAt?: string;
  updatedAt?: string;
};

export type TranscriptImportResult = { available: boolean; transcriptVersion: number; sourceHash: string };
export type TranscriptStoreReadResult = {
  available: boolean;
  count: number;
  transcriptVersion: number;
  sourceHash: string;
  turns: Array<{ index: number; turn: StoredTranscriptTurn }>;
};
export type ChatReadVersion = {
  available: boolean;
  chat: Record<string, unknown> | null;
  chatSourceHash: string;
  turnCount: number;
  transcriptVersion: number;
  transcriptSourceHash: string;
  pendingVersion: string;
};
export type ChatReadRows = {
  available: boolean;
  turns: Array<{ index: number; turn: StoredTranscriptTurn }>;
  pending: StoredPendingPrompt[];
  pendingTurns: StoredTranscriptTurn[];
};
export type ChatStoreImportResult = { available: boolean; sourceHash: string };
export type ChatStoreReadResult = { available: boolean; chat: any | null; sourceHash: string };
export type ChatStoreListResult = { available: boolean; chats: string[] };
export type ChatReadState = {
  droneId: string;
  chatName: string;
  latestAgentTurnId: string | null;
  latestAgentRevision: number;
  readThroughRevision: number;
  unread: boolean;
  updatedAt: string | null;
};
export type CreateChatStoreResult = { available: boolean; chat: any; chats: string[] };
export type UpdateChatStoreResult = { available: boolean; chat: any; chats: string[] };
export type DeleteActiveChatStoreResult = { available: boolean; deletedChat: any; chats: string[] };
export type ArchivedChatRecord = {
  droneId: string;
  chatName: string;
  chat: any;
  archivedAt: string;
  deleteAt: string;
  archiveRetention: string;
};
export type ArchivedChatStoreListResult = { available: boolean; archivedChats: ArchivedChatRecord[] };
export type ArchiveChatStoreResult = {
  available: boolean;
  archived: boolean;
  archivedChat: ArchivedChatRecord | null;
  chats: string[];
};
export type RestoreArchivedChatStoreResult = {
  available: boolean;
  restored: boolean;
  chatName: string;
  renamed: boolean;
  chat: any | null;
  chats: string[];
};
export type DeleteArchivedChatStoreResult = {
  available: boolean;
  deleted: boolean;
  archivedChat: ArchivedChatRecord | null;
};
export type ChatMetadataPatch = {
  set?: Record<string, unknown>;
  setIfMissing?: Record<string, unknown>;
  unset?: string[];
};
export type ChatMetadataPatchResult = {
  available: boolean;
  changed: boolean;
  metadata: Record<string, unknown> | null;
};
export type TranscriptTurnUpdateResult = {
  available: boolean;
  changed: boolean;
  turn: StoredTranscriptTurn | null;
};
export type TranscriptRollbackResult = {
  available: boolean;
  changed: boolean;
  removedTurns: StoredTranscriptTurn[];
  turn: StoredTranscriptTurn | null;
};
export type PermanentDroneChatCleanupResult = {
  available: boolean;
  removedLifecycle: boolean;
  alreadyDeleted: boolean;
  activeChatsDeleted: number;
  turnsDeleted: number;
  archivedChatsDeleted: number;
  chatTombstonesDeleted: number;
  archivedChatTombstonesDeleted: number;
  promptsDeleted: number;
};

export const CHAT_STORE_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'canonical chats and transcript turns',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE canonical_chats (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          created_at TEXT,
          updated_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          transcript_version INTEGER NOT NULL DEFAULT 0 CHECK (transcript_version >= 0),
          turns_source_hash TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (drone_id, chat_name)
        );

        CREATE INDEX idx_canonical_chats_drone_name
          ON canonical_chats (drone_id, chat_name);

        CREATE TABLE canonical_chat_turns (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          at TEXT NOT NULL,
          prompt_at TEXT,
          completed_at TEXT,
          turn_json TEXT NOT NULL,
          PRIMARY KEY (drone_id, chat_name, turn_id),
          FOREIGN KEY (drone_id, chat_name)
            REFERENCES canonical_chats(drone_id, chat_name)
            ON UPDATE CASCADE ON DELETE CASCADE
        );

        CREATE INDEX idx_canonical_chat_turns_order
          ON canonical_chat_turns (drone_id, chat_name, prompt_at, at, completed_at, ordinal);

        CREATE TABLE canonical_chat_tombstones (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          reason TEXT NOT NULL CHECK (reason IN ('deleted', 'renamed')),
          replacement_chat_name TEXT,
          deleted_at TEXT NOT NULL,
          PRIMARY KEY (drone_id, chat_name)
        );
      `);

      const oldChats = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hub_chats'")
        .get();
      if (oldChats) {
        connection.exec(`
          INSERT OR IGNORE INTO canonical_chats (
            drone_id, chat_name, created_at, updated_at, metadata_json,
            source_hash, transcript_version, turns_source_hash
          )
          SELECT drone_id, chat_name, created_at, imported_at, chat_json,
                 source_hash, 0, ''
          FROM hub_chats;
        `);
      }

      const oldTurns = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_turns'")
        .get();
      if (oldTurns) {
        connection.exec(`
          INSERT OR IGNORE INTO canonical_chat_turns (
            drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
          )
          SELECT t.drone_id, t.chat_name, t.prompt_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY t.drone_id, t.chat_name
                   ORDER BY COALESCE(t.prompt_at, t.at), t.completed_at, t.prompt_id
                 ) - 1,
                 t.at, t.prompt_at, t.completed_at, t.turn_json
          FROM chat_turns t
          INNER JOIN canonical_chats c
            ON c.drone_id = t.drone_id AND c.chat_name = t.chat_name;
        `);
      }

      const oldTranscriptTurns = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transcript_turns'")
        .get();
      if (oldTranscriptTurns) {
        connection.exec(`
          INSERT OR IGNORE INTO canonical_chat_turns (
            drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
          )
          SELECT t.drone_id, t.chat_name,
                 COALESCE(NULLIF(json_extract(t.turn_json, '$.id'), ''), t.turn_key),
                 t.ordinal,
                 t.at, t.prompt_at, t.completed_at, t.turn_json
          FROM transcript_turns t
          INNER JOIN canonical_chats c
            ON c.drone_id = t.drone_id AND c.chat_name = t.chat_name;
        `);
      }
    },
  },
  {
    version: 2,
    name: 'canonical archived chats',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE canonical_archived_chats (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          archived_at TEXT NOT NULL,
          delete_at TEXT NOT NULL,
          archive_retention TEXT NOT NULL,
          chat_json TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          PRIMARY KEY (drone_id, chat_name)
        );

        CREATE INDEX idx_canonical_archived_chats_expiry
          ON canonical_archived_chats (delete_at, drone_id, chat_name);

        CREATE TABLE canonical_archived_chat_tombstones (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          reason TEXT NOT NULL CHECK (reason IN ('restored', 'deleted')),
          deleted_at TEXT NOT NULL,
          PRIMARY KEY (drone_id, chat_name)
        );
      `);
    },
  },
  {
    version: 3,
    name: 'permanently deleted drone chat tombstones',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS canonical_drone_chat_tombstones (
          drone_id TEXT NOT NULL PRIMARY KEY,
          deleted_at TEXT NOT NULL,
          reason TEXT NOT NULL CHECK (reason = 'drone-deleted')
        );
      `);
    },
  },
  {
    version: 4,
    name: 'shared chat read cursors',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE canonical_chat_read_state (
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          latest_agent_turn_id TEXT,
          latest_agent_completed_at TEXT,
          latest_agent_ordinal INTEGER,
          latest_agent_revision INTEGER NOT NULL DEFAULT 0 CHECK (latest_agent_revision >= 0),
          read_through_revision INTEGER NOT NULL DEFAULT 0 CHECK (read_through_revision >= 0),
          updated_at TEXT,
          updated_by_device_id TEXT,
          PRIMARY KEY (drone_id, chat_name),
          FOREIGN KEY (drone_id, chat_name)
            REFERENCES canonical_chats(drone_id, chat_name)
            ON UPDATE CASCADE ON DELETE CASCADE
        );

        INSERT INTO canonical_chat_read_state (
          drone_id, chat_name, latest_agent_turn_id, latest_agent_completed_at,
          latest_agent_ordinal, latest_agent_revision, read_through_revision, updated_at
        )
        SELECT c.drone_id, c.chat_name, latest.turn_id, latest.completed_at,
               latest.ordinal,
               CASE WHEN latest.turn_id IS NULL THEN 0 ELSE 1 END,
               CASE WHEN latest.turn_id IS NULL THEN 0 ELSE 1 END,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM canonical_chats c
        LEFT JOIN (
          SELECT drone_id, chat_name, turn_id, completed_at, ordinal
          FROM (
            SELECT drone_id, chat_name, turn_id, completed_at, ordinal,
                   ROW_NUMBER() OVER (
                     PARTITION BY drone_id, chat_name
                     ORDER BY ordinal DESC, completed_at DESC, turn_id DESC
                   ) AS row_number
            FROM canonical_chat_turns
            WHERE completed_at IS NOT NULL
              AND (
                TRIM(COALESCE(json_extract(turn_json, '$.output'), '')) != '' OR
                TRIM(COALESCE(json_extract(turn_json, '$.error'), '')) != ''
              )
          ) ranked
          WHERE row_number = 1
        ) latest
          ON latest.drone_id = c.drone_id AND latest.chat_name = c.chat_name;
      `);
    },
  },
  {
    version: 5,
    name: 'stable chat identities',
    migrate(connection) {
      const rows = connection
        .prepare('SELECT drone_id, chat_name, metadata_json FROM canonical_chats')
        .all() as Array<{ drone_id: string; chat_name: string; metadata_json: string }>;
      const update = connection.prepare(
        'UPDATE canonical_chats SET metadata_json = ?, updated_at = ? WHERE drone_id = ? AND chat_name = ?',
      );
      for (const row of rows) {
        const current = parseJson(row.metadata_json);
        const metadata = current && typeof current === 'object' && !Array.isArray(current)
          ? { ...current }
          : {};
        if (typeof metadata.id === 'string' && metadata.id.trim()) continue;
        metadata.id = crypto.randomUUID();
        update.run(
          stableJson(metadata),
          new Date().toISOString(),
          row.drone_id,
          row.chat_name,
        );
      }
    },
  },
  {
    version: 6,
    name: 'remove retired chat automation state',
    migrate(connection) {
      const chatRows = connection
        .prepare('SELECT drone_id, chat_name, metadata_json FROM canonical_chats')
        .all() as Array<{ drone_id: string; chat_name: string; metadata_json: string }>;
      const updateChat = connection.prepare(
        'UPDATE canonical_chats SET metadata_json = ? WHERE drone_id = ? AND chat_name = ?',
      );
      for (const row of chatRows) {
        const normalized = metadata(parseJson(row.metadata_json));
        const serialized = stableJson(normalized);
        if (serialized === row.metadata_json) continue;
        updateChat.run(serialized, row.drone_id, row.chat_name);
      }

      const changedTranscripts = new Map<string, { droneId: string; chatName: string }>();
      const turnRows = connection
        .prepare('SELECT drone_id, chat_name, turn_id, turn_json FROM canonical_chat_turns')
        .all() as Array<{ drone_id: string; chat_name: string; turn_id: string; turn_json: string }>;
      const updateTurn = connection.prepare(
        'UPDATE canonical_chat_turns SET turn_json = ? WHERE drone_id = ? AND chat_name = ? AND turn_id = ?',
      );
      for (const row of turnRows) {
        const serialized = stableJson(normalizeTurn(parseJson(row.turn_json)));
        if (serialized === row.turn_json) continue;
        updateTurn.run(serialized, row.drone_id, row.chat_name, row.turn_id);
        changedTranscripts.set(`${row.drone_id}\u0000${row.chat_name}`, {
          droneId: row.drone_id,
          chatName: row.chat_name,
        });
      }
      for (const { droneId, chatName } of changedTranscripts.values()) {
        refreshTranscriptMetadata(connection, droneId, chatName);
      }

      const archivedRows = connection
        .prepare('SELECT drone_id, chat_name, chat_json FROM canonical_archived_chats')
        .all() as Array<{ drone_id: string; chat_name: string; chat_json: string }>;
      const updateArchived = connection.prepare(
        'UPDATE canonical_archived_chats SET chat_json = ?, source_hash = ? WHERE drone_id = ? AND chat_name = ?',
      );
      for (const row of archivedRows) {
        const normalized = normalizeStoredChatEntry(parseJson(row.chat_json));
        const serialized = stableJson(normalized);
        if (serialized === row.chat_json) continue;
        updateArchived.run(
          serialized,
          chatEntrySourceHash(normalized),
          row.drone_id,
          row.chat_name,
        );
      }
    },
  },
  {
    version: 7,
    name: 'remove retired agent copilot state',
    migrate(connection) {
      const chatRows = connection
        .prepare('SELECT drone_id, chat_name, metadata_json FROM canonical_chats')
        .all() as Array<{ drone_id: string; chat_name: string; metadata_json: string }>;
      const updateChat = connection.prepare(
        'UPDATE canonical_chats SET metadata_json = ? WHERE drone_id = ? AND chat_name = ?',
      );
      for (const row of chatRows) {
        const normalized = metadata(parseJson(row.metadata_json));
        const serialized = stableJson(normalized);
        if (serialized === row.metadata_json) continue;
        updateChat.run(serialized, row.drone_id, row.chat_name);
      }

      const archivedRows = connection
        .prepare('SELECT drone_id, chat_name, chat_json FROM canonical_archived_chats')
        .all() as Array<{ drone_id: string; chat_name: string; chat_json: string }>;
      const updateArchived = connection.prepare(
        'UPDATE canonical_archived_chats SET chat_json = ?, source_hash = ? WHERE drone_id = ? AND chat_name = ?',
      );
      for (const row of archivedRows) {
        const normalized = normalizeStoredChatEntry(parseJson(row.chat_json));
        const serialized = stableJson(normalized);
        if (serialized === row.chat_json) continue;
        updateArchived.run(
          serialized,
          chatEntrySourceHash(normalized),
          row.drone_id,
          row.chat_name,
        );
      }
    },
  },
];

type ChatRow = {
  chat_name: string;
  metadata_json: string;
  source_hash: string;
  transcript_version: number;
  turns_source_hash: string;
};
type TurnRow = { turn_json: string };
type LatestAgentTurnRow = {
  turn_id: string;
  completed_at: string;
  ordinal: number;
};
type ChatReadStateRow = {
  drone_id: string;
  chat_name: string;
  latest_agent_turn_id: string | null;
  latest_agent_completed_at: string | null;
  latest_agent_ordinal: number | null;
  latest_agent_revision: number;
  read_through_revision: number;
  updated_at: string | null;
};
type ArchivedChatRow = {
  drone_id: string;
  chat_name: string;
  archived_at: string;
  delete_at: string;
  archive_retention: string;
  chat_json: string;
  source_hash: string;
};

const memoryChats = new Map<string, { metadata: any; sourceHash: string; version: number }>();
const memoryTurns = new Map<string, Map<string, StoredTranscriptTurn>>();
const memoryPrompts = new Map<string, Map<string, StoredPendingPrompt>>();
const memoryReadStates = new Map<
  string,
  ChatReadState & { latestAgentCompletedAt: string | null; latestAgentOrdinal: number | null }
>();
const memoryCancelledPrompts = new Set<string>();
const memoryChatTombstones = new Set<string>();
const memoryArchivedChats = new Map<string, ArchivedChatRecord>();
const memoryArchivedChatTombstones = new Set<string>();
const memoryDroneChatTombstones = new Set<string>();
let cachedRepository: { database: HubDatabase; repository: ChatTranscriptRepository } | null = null;
let unavailableReason: string | null = null;

function key(droneId: string, chatName: string): string {
  return `${droneId}\u0000${chatName}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseIsoMs(raw: unknown): number {
  const ms = Date.parse(typeof raw === 'string' ? raw : '');
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeTurn(raw: any): StoredTranscriptTurn {
  const at = String(raw?.at ?? new Date().toISOString());
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
  const activity = normalizeAgentRunActivity(raw?.activity);
  const { output, silentCompletion } = normalizeSilentCompletion(
    Boolean(raw?.ok),
    raw?.output,
    raw?.silentCompletion === true,
  );
  return {
    at,
    ...(id ? { id } : {}),
    prompt: String(raw?.prompt ?? ''),
    ok: Boolean(raw?.ok),
    output,
    ...(silentCompletion ? { silentCompletion: true } : {}),
    ...(!raw?.ok ? { error: String(raw?.error ?? 'failed') } : {}),
    ...(typeof raw?.promptAt === 'string' && raw.promptAt.trim() ? { promptAt: raw.promptAt.trim() } : {}),
    ...(typeof raw?.startedAt === 'string' && raw.startedAt.trim()
      ? { startedAt: raw.startedAt.trim() }
      : {}),
    ...(typeof raw?.completedAt === 'string' && raw.completedAt.trim() ? { completedAt: raw.completedAt.trim() } : {}),
    ...(typeof raw?.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(typeof raw?.reasoning === 'string' && raw.reasoning.trim() ? { reasoning: raw.reasoning.trim() } : {}),
    ...(activity ? { activity } : {}),
    ...(Array.isArray(raw?.attachments) ? { attachments: raw.attachments } : {}),
    ...(raw?.inheritedFromClone === true ? { inheritedFromClone: true } : {}),
    ...(raw?.dockerSnapshot && typeof raw.dockerSnapshot === 'object' ? { dockerSnapshot: raw.dockerSnapshot } : {}),
    ...(raw?.agentPlan && typeof raw.agentPlan === 'object' ? { agentPlan: raw.agentPlan } : {}),
    ...(raw?.fileChanges && typeof raw.fileChanges === 'object' ? { fileChanges: raw.fileChanges } : {}),
  };
}

function stripRetiredChatMetadata(raw: unknown): Record<string, any> {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, any>) }
    : {};
  delete value.agentMessageAutoContinueEnabled;
  delete value.agentMessageAutoContinueEnabledAt;
  delete value.agentSuggestionEnabled;
  delete value.agentSuggestionEnabledAt;
  delete value.agentCopilotHandledSourceMessageIds;
  return value;
}

function stripRetiredPendingPromptMetadata(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const value = { ...(raw as Record<string, any>) };
  delete value.automation;
  delete value.blockedByAutomation;
  return value;
}

function normalizeStoredChatEntry(raw: unknown): Record<string, any> {
  const value = stripRetiredChatMetadata(raw);
  if (Array.isArray(value.turns)) value.turns = value.turns.map(normalizeTurn);
  if (Array.isArray(value.pendingPrompts)) {
    value.pendingPrompts = value.pendingPrompts.map(stripRetiredPendingPromptMetadata);
  }
  return value;
}

function sortedTurns(turns: Iterable<StoredTranscriptTurn>): StoredTranscriptTurn[] {
  return [...turns]
    .map((turn, ordinal) => ({ turn: normalizeTurn(turn), ordinal }))
    .sort((a, b) => {
      const delta = parseIsoMs(a.turn.promptAt ?? a.turn.at) - parseIsoMs(b.turn.promptAt ?? b.turn.at);
      if (delta !== 0) return delta;
      const completedDelta = parseIsoMs(a.turn.completedAt) - parseIsoMs(b.turn.completedAt);
      return completedDelta || a.ordinal - b.ordinal;
    })
    .map((item) => item.turn);
}

function turnId(turn: StoredTranscriptTurn): string {
  if (turn.id) return turn.id;
  return `legacy:${crypto.createHash('sha256').update(stableJson(turn)).digest('hex').slice(0, 32)}`;
}

function metadata(chatEntry: any): any {
  const value = stripRetiredChatMetadata(chatEntry);
  delete value.turns;
  delete value.pendingPrompts;
  return value;
}

function metadataWithStableId(chatEntry: any, current?: any): any {
  const value = metadata(chatEntry);
  const suppliedId = typeof value.id === 'string' ? value.id.trim() : '';
  const currentId = typeof current?.id === 'string' ? current.id.trim() : '';
  return { ...value, id: suppliedId || currentId || crypto.randomUUID() };
}

function archivedChatValue(raw: unknown): {
  chat: any;
  archivedAt: string;
  deleteAt: string;
  archiveRetention: string;
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = normalizeStoredChatEntry(raw);
  const archivedAtRaw = String(value.archivedAt ?? '').trim();
  const archivedAt = Number.isFinite(Date.parse(archivedAtRaw)) ? archivedAtRaw : new Date().toISOString();
  const archiveRetentionRaw = String(value.archiveRetention ?? '').trim();
  const archiveRetention = ['1h', '8h', '1d', '1w'].includes(archiveRetentionRaw) ? archiveRetentionRaw : '1d';
  const retentionMs = archiveRetention === '1h'
    ? 60 * 60 * 1000
    : archiveRetention === '8h'
      ? 8 * 60 * 60 * 1000
      : archiveRetention === '1w'
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
  const deleteAtRaw = String(value.deleteAt ?? '').trim();
  const deleteAt = Number.isFinite(Date.parse(deleteAtRaw))
    ? deleteAtRaw
    : new Date(Date.parse(archivedAt) + retentionMs).toISOString();
  delete value.archivedAt;
  delete value.deleteAt;
  delete value.archiveRetention;
  return { chat: value, archivedAt, deleteAt, archiveRetention };
}

function archivedChatRecord(row: ArchivedChatRow | undefined): ArchivedChatRecord | null {
  if (!row) return null;
  return {
    droneId: row.drone_id,
    chatName: row.chat_name,
    chat: normalizeStoredChatEntry(parseJson(row.chat_json)),
    archivedAt: row.archived_at,
    deleteAt: row.delete_at,
    archiveRetention: row.archive_retention,
  };
}

function safeMetadataField(raw: unknown): string | null {
  const field = String(raw ?? '').trim();
  if (!field || field === 'turns' || field === 'pendingPrompts' || field === '__proto__' || field === 'constructor' || field === 'prototype') {
    return null;
  }
  return field;
}

function applyMetadataPatch(currentRaw: unknown, patch?: ChatMetadataPatch): { metadata: Record<string, unknown>; changed: boolean; fields: string[] } {
  const current = stripRetiredChatMetadata(currentRaw);
  const fields = new Set<string>();
  for (const [rawField, value] of Object.entries(patch?.setIfMissing ?? {})) {
    const field = safeMetadataField(rawField);
    if (!field || (typeof current[field] === 'string' ? String(current[field]).trim() : current[field] != null)) continue;
    current[field] = value;
    fields.add(field);
  }
  for (const [rawField, value] of Object.entries(patch?.set ?? {})) {
    const field = safeMetadataField(rawField);
    if (!field || stableJson(current[field]) === stableJson(value)) continue;
    current[field] = value;
    fields.add(field);
  }
  for (const rawField of patch?.unset ?? []) {
    const field = safeMetadataField(rawField);
    if (!field || !Object.prototype.hasOwnProperty.call(current, field)) continue;
    delete current[field];
    fields.add(field);
  }
  return { metadata: current, changed: fields.size > 0, fields: [...fields].sort() };
}

function turnsWithLegacySubmissionTimes(chatEntry: any): StoredTranscriptTurn[] {
  const submittedAtById = new Map<string, string>();
  for (const prompt of Array.isArray(chatEntry?.pendingPrompts) ? chatEntry.pendingPrompts : []) {
    const id = String(prompt?.id ?? '').trim();
    const at = String(prompt?.at ?? '').trim();
    if (id && at) submittedAtById.set(id, at);
  }
  return (Array.isArray(chatEntry?.turns) ? chatEntry.turns : []).map((raw: any) => {
    const turn = normalizeTurn(raw);
    const submittedAt = turn.id ? submittedAtById.get(turn.id) : null;
    return submittedAt ? { ...turn, at: submittedAt, promptAt: submittedAt } : turn;
  });
}

export function transcriptTurnsSourceHash(turnsRaw: unknown): string {
  return crypto
    .createHash('sha256')
    .update(stableJson(Array.isArray(turnsRaw) ? turnsRaw : []))
    .digest('base64url');
}

export function chatEntrySourceHash(chatEntryRaw: unknown): string {
  return crypto.createHash('sha256').update(stableJson(chatEntryRaw)).digest('base64url');
}

function refreshTranscriptMetadata(connection: HubDatabaseConnection, droneId: string, chatName: string): TranscriptImportResult {
  const rows = connection
    .prepare(`SELECT turn_json FROM canonical_chat_turns
              WHERE drone_id = ? AND chat_name = ?
              ORDER BY COALESCE(prompt_at, at), completed_at, ordinal, turn_id`)
    .all(droneId, chatName) as TurnRow[];
  const sourceHash = transcriptTurnsSourceHash(rows.map((row) => normalizeTurn(parseJson(row.turn_json))));
  const current = connection
    .prepare(`SELECT transcript_version, turns_source_hash FROM canonical_chats
              WHERE drone_id = ? AND chat_name = ?`)
    .get(droneId, chatName) as { transcript_version: number; turns_source_hash: string } | undefined;
  if (!current) return { available: true, transcriptVersion: 0, sourceHash };
  const version = current.turns_source_hash === sourceHash
    ? Number(current.transcript_version)
    : Number(current.transcript_version) + 1;
  connection
    .prepare(`UPDATE canonical_chats SET transcript_version = ?, turns_source_hash = ?, updated_at = ?
              WHERE drone_id = ? AND chat_name = ?`)
    .run(version, sourceHash, new Date().toISOString(), droneId, chatName);
  refreshChatReadActivity(connection, droneId, chatName);
  return { available: true, transcriptVersion: version, sourceHash };
}

function latestCompletedAgentTurn(
  connection: HubDatabaseConnection,
  droneId: string,
  chatName: string,
): LatestAgentTurnRow | null {
  return (
    (connection
      .prepare(`SELECT turn_id, completed_at, ordinal
        FROM canonical_chat_turns
        WHERE drone_id = ? AND chat_name = ? AND completed_at IS NOT NULL
          AND (
            TRIM(COALESCE(json_extract(turn_json, '$.output'), '')) != '' OR
            TRIM(COALESCE(json_extract(turn_json, '$.error'), '')) != ''
          )
        ORDER BY ordinal DESC, completed_at DESC, turn_id DESC
        LIMIT 1`)
      .get(droneId, chatName) as LatestAgentTurnRow | undefined) ?? null
  );
}

function readStateRow(
  connection: HubDatabaseConnection,
  droneId: string,
  chatName: string,
): ChatReadStateRow | null {
  return (
    (connection
      .prepare(`SELECT drone_id, chat_name, latest_agent_turn_id,
        latest_agent_completed_at, latest_agent_ordinal, latest_agent_revision,
        read_through_revision, updated_at
        FROM canonical_chat_read_state
        WHERE drone_id = ? AND chat_name = ?`)
      .get(droneId, chatName) as ChatReadStateRow | undefined) ?? null
  );
}

function chatReadStateFromRow(
  droneId: string,
  chatName: string,
  row: ChatReadStateRow | null,
): ChatReadState {
  const latestAgentRevision = Math.max(0, Number(row?.latest_agent_revision ?? 0));
  const readThroughRevision = Math.max(0, Number(row?.read_through_revision ?? 0));
  return {
    droneId,
    chatName,
    latestAgentTurnId: row?.latest_agent_turn_id ?? null,
    latestAgentRevision,
    readThroughRevision,
    unread: latestAgentRevision > readThroughRevision,
    updatedAt: row?.updated_at ?? null,
  };
}

function isNewerAgentActivity(
  latest: { ordinal: number; completedAt: string } | null,
  current: { ordinal: number | null; completedAt: string | null },
): boolean {
  if (!latest) return false;
  if (current.ordinal == null) return true;
  if (latest.ordinal !== current.ordinal) return latest.ordinal > current.ordinal;
  const latestCompletedMs = Date.parse(latest.completedAt);
  const currentCompletedMs = Date.parse(current.completedAt ?? '');
  if (Number.isFinite(latestCompletedMs) && Number.isFinite(currentCompletedMs)) {
    return latestCompletedMs > currentCompletedMs;
  }
  return true;
}

function refreshChatReadActivity(
  connection: HubDatabaseConnection,
  droneId: string,
  chatName: string,
): ChatReadStateRow {
  const latest = latestCompletedAgentTurn(connection, droneId, chatName);
  const current = readStateRow(connection, droneId, chatName);
  const now = new Date().toISOString();
  if (!current) {
    const latestRevision = latest ? 1 : 0;
    connection
      .prepare(`INSERT INTO canonical_chat_read_state (
        drone_id, chat_name, latest_agent_turn_id, latest_agent_completed_at,
        latest_agent_ordinal, latest_agent_revision, read_through_revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(
        droneId,
        chatName,
        latest?.turn_id ?? null,
        latest?.completed_at ?? null,
        latest?.ordinal ?? null,
        latestRevision,
        now,
      );
    return readStateRow(connection, droneId, chatName)!;
  }
  const sameActivity =
    (latest?.turn_id ?? null) === current.latest_agent_turn_id &&
    (latest?.completed_at ?? null) === current.latest_agent_completed_at &&
    (latest?.ordinal ?? null) === current.latest_agent_ordinal;
  if (sameActivity) return current;

  const isNewer = isNewerAgentActivity(
    latest ? { ordinal: latest.ordinal, completedAt: latest.completed_at } : null,
    {
      ordinal: current.latest_agent_ordinal,
      completedAt: current.latest_agent_completed_at,
    },
  );
  const nextRevision = isNewer
    ? Math.max(0, Number(current.latest_agent_revision)) + 1
    : Math.max(0, Number(current.latest_agent_revision));
  const nextReadThrough = isNewer
    ? Math.max(0, Number(current.read_through_revision))
    : nextRevision;
  connection
    .prepare(`UPDATE canonical_chat_read_state
      SET latest_agent_turn_id = ?, latest_agent_completed_at = ?, latest_agent_ordinal = ?,
          latest_agent_revision = ?, read_through_revision = ?, updated_at = ?
      WHERE drone_id = ? AND chat_name = ?`)
    .run(
      latest?.turn_id ?? null,
      latest?.completed_at ?? null,
      latest?.ordinal ?? null,
      nextRevision,
      nextReadThrough,
      now,
      droneId,
      chatName,
    );
  return readStateRow(connection, droneId, chatName)!;
}

function markCurrentReadForBootstrap(
  connection: HubDatabaseConnection,
  droneId: string,
  chatName: string,
): void {
  refreshChatReadActivity(connection, droneId, chatName);
  connection
    .prepare(`UPDATE canonical_chat_read_state
      SET read_through_revision = latest_agent_revision, updated_at = ?
      WHERE drone_id = ? AND chat_name = ?`)
    .run(new Date().toISOString(), droneId, chatName);
}

function appendChatEvent(
  connection: HubDatabaseConnection,
  eventType: string,
  droneId: string,
  chatName: string,
  payload: unknown,
): void {
  appendHubOutboxEvent(connection, {
    topic: 'chat.changes',
    eventType,
    aggregateType: 'chat',
    aggregateId: key(droneId, chatName),
    payload: { droneId, chatName, ...(payload && typeof payload === 'object' ? payload : {}) },
  });
}

export class ChatTranscriptRepository {
  constructor(private readonly database: HubDatabase) {
    database.read((connection) => applyHubDatabaseMigrations(connection, CHAT_STORE_MIGRATIONS, 'chats'));
    initializeHubOutbox(database);
  }

  readState(opts: { droneId: string; chatName: string }): ChatReadState {
    return this.database.read((connection) =>
      chatReadStateFromRow(
        opts.droneId,
        opts.chatName,
        readStateRow(connection, opts.droneId, opts.chatName),
      ),
    );
  }

  listReadStates(opts: { droneId: string }): Record<string, ChatReadState> {
    return this.listReadStatesForDrones({ droneIds: [opts.droneId] }).get(opts.droneId) ?? {};
  }

  listReadStatesForDrones(opts: {
    droneIds: string[];
  }): Map<string, Record<string, ChatReadState>> {
    const droneIds = [...new Set(opts.droneIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
    if (droneIds.length === 0) return new Map();
    return this.database.read((connection) => {
      const result = new Map<string, Record<string, ChatReadState>>(
        droneIds.map((droneId) => [droneId, {}]),
      );
      for (let offset = 0; offset < droneIds.length; offset += 400) {
        const batch = droneIds.slice(offset, offset + 400);
        const rows = connection
          .prepare(`SELECT drone_id, chat_name, latest_agent_turn_id,
            latest_agent_completed_at, latest_agent_ordinal, latest_agent_revision,
            read_through_revision, updated_at
            FROM canonical_chat_read_state
            WHERE drone_id IN (${batch.map(() => '?').join(', ')})
            ORDER BY drone_id, chat_name`)
          .all(...batch) as ChatReadStateRow[];
        for (const row of rows) {
          result.get(row.drone_id)![row.chat_name] = chatReadStateFromRow(
            row.drone_id,
            row.chat_name,
            row,
          );
        }
      }
      return result;
    });
  }

  async markRead(opts: {
    droneId: string;
    chatName: string;
    latestAgentTurnId?: string | null;
    latestAgentRevision?: number;
    updatedByDeviceId?: string | null;
  }): Promise<ChatReadState> {
    return await this.database.writeTransaction('mark canonical chat read', (connection) => {
      const row = refreshChatReadActivity(connection, opts.droneId, opts.chatName);
      const expectedTurnId =
        opts.latestAgentTurnId === undefined
          ? row.latest_agent_turn_id
          : opts.latestAgentTurnId;
      if (expectedTurnId !== row.latest_agent_turn_id) {
        return chatReadStateFromRow(opts.droneId, opts.chatName, row);
      }
      const latestRevision = Math.max(0, Number(row.latest_agent_revision));
      if (
        opts.latestAgentRevision !== undefined &&
        opts.latestAgentRevision !== latestRevision
      ) {
        return chatReadStateFromRow(opts.droneId, opts.chatName, row);
      }
      const changed = Number(row.read_through_revision) !== latestRevision;
      if (changed) {
        const now = new Date().toISOString();
        connection
          .prepare(`UPDATE canonical_chat_read_state
            SET read_through_revision = ?, updated_at = ?, updated_by_device_id = ?
            WHERE drone_id = ? AND chat_name = ?`)
          .run(
            latestRevision,
            now,
            String(opts.updatedByDeviceId ?? '').trim() || null,
            opts.droneId,
            opts.chatName,
          );
        appendChatEvent(connection, 'chat.read-state.changed', opts.droneId, opts.chatName, {
          unread: false,
          latestAgentTurnId: row.latest_agent_turn_id,
          latestAgentRevision: latestRevision,
          updatedByDeviceId: String(opts.updatedByDeviceId ?? '').trim() || null,
        });
      }
      return chatReadStateFromRow(
        opts.droneId,
        opts.chatName,
        changed ? readStateRow(connection, opts.droneId, opts.chatName) : row,
      );
    });
  }

  async markUnread(opts: {
    droneId: string;
    chatName: string;
    updatedByDeviceId?: string | null;
  }): Promise<ChatReadState> {
    return await this.database.writeTransaction('mark canonical chat unread', (connection) => {
      const row = refreshChatReadActivity(connection, opts.droneId, opts.chatName);
      const latestRevision = Math.max(0, Number(row.latest_agent_revision));
      const readThroughRevision = Math.max(0, Number(row.read_through_revision));
      const changed = latestRevision > 0 && readThroughRevision >= latestRevision;
      const nextReadThrough = changed ? latestRevision - 1 : readThroughRevision;
      if (changed) {
        const now = new Date().toISOString();
        connection
          .prepare(`UPDATE canonical_chat_read_state
            SET read_through_revision = ?, updated_at = ?, updated_by_device_id = ?
            WHERE drone_id = ? AND chat_name = ?`)
          .run(
            nextReadThrough,
            now,
            String(opts.updatedByDeviceId ?? '').trim() || null,
            opts.droneId,
            opts.chatName,
          );
        appendChatEvent(connection, 'chat.read-state.changed', opts.droneId, opts.chatName, {
          unread: true,
          latestAgentTurnId: row.latest_agent_turn_id,
          latestAgentRevision: latestRevision,
          updatedByDeviceId: String(opts.updatedByDeviceId ?? '').trim() || null,
        });
      }
      return chatReadStateFromRow(
        opts.droneId,
        opts.chatName,
        changed ? readStateRow(connection, opts.droneId, opts.chatName) : row,
      );
    });
  }

  async backfillDroneChats(opts: { droneId: string; chats: unknown }): Promise<ChatStoreListResult> {
    const chats = opts.chats && typeof opts.chats === 'object' && !Array.isArray(opts.chats)
      ? (opts.chats as Record<string, any>)
      : {};
    return await this.database.writeTransaction('backfill legacy drone chats', (connection) => {
      for (const [chatName, entry] of Object.entries(chats)) this.insertMissingChat(connection, opts.droneId, chatName, entry);
      return this.listChatsWithConnection(connection, opts.droneId);
    });
  }

  async backfillChat(opts: { droneId: string; chatName: string; chatEntry: unknown; sourceHash?: string }): Promise<ChatStoreImportResult> {
    return await this.database.writeTransaction('backfill legacy chat', (connection) => {
      this.insertMissingChat(connection, opts.droneId, opts.chatName, opts.chatEntry, opts.sourceHash);
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      return { available: true, sourceHash: row?.source_hash ?? '' };
    });
  }

  async createChat(opts: {
    droneId: string;
    chatName: string;
    copyFromChatName?: string;
    implicitDefaultEntry?: unknown;
    createEntry: (source: any | null) => unknown;
  }): Promise<CreateChatStoreResult> {
    return await this.database.writeTransaction('create canonical chat', (connection) => {
      if (this.chatRow(connection, opts.droneId, opts.chatName)) throw new Error(`chat already exists: ${opts.chatName}`);
      let source: any | null = null;
      if (opts.copyFromChatName) {
        source = this.projectChatWithConnection(connection, opts.droneId, opts.copyFromChatName);
        if (!source && opts.copyFromChatName === 'default' && this.listChatsWithConnection(connection, opts.droneId).chats.length === 0) {
          this.writeChatWithConnection(connection, opts.droneId, 'default', opts.implicitDefaultEntry ?? {});
          source = this.projectChatWithConnection(connection, opts.droneId, 'default');
        }
        if (!source) throw new Error(`unknown chat: ${opts.copyFromChatName}`);
      }
      const entry = opts.createEntry(source);
      this.writeChatWithConnection(connection, opts.droneId, opts.chatName, entry);
      if (opts.copyFromChatName) {
        markCurrentReadForBootstrap(connection, opts.droneId, opts.chatName);
      }
      appendChatEvent(connection, 'chat.created', opts.droneId, opts.chatName, {
        ...(opts.copyFromChatName ? { copiedFromChatName: opts.copyFromChatName } : {}),
      });
      return {
        available: true,
        chat: this.projectChatWithConnection(connection, opts.droneId, opts.chatName),
        chats: this.listChatsWithConnection(connection, opts.droneId).chats,
      };
    });
  }

  async updateChat(opts: {
    droneId: string;
    chatName: string;
    update: (chat: any) => unknown;
  }): Promise<UpdateChatStoreResult> {
    return await this.database.writeTransaction('update canonical chat', (connection) => {
      const current = this.projectChatWithConnection(connection, opts.droneId, opts.chatName);
      if (!current) throw new Error(`unknown chat: ${opts.chatName}`);
      const next = opts.update(current);
      this.writeChatWithConnection(connection, opts.droneId, opts.chatName, next);
      appendChatEvent(connection, 'chat.updated', opts.droneId, opts.chatName, {});
      return {
        available: true,
        chat: this.projectChatWithConnection(connection, opts.droneId, opts.chatName),
        chats: this.listChatsWithConnection(connection, opts.droneId).chats,
      };
    });
  }

  async deleteActiveChat(opts: {
    droneId: string;
    chatName: string;
    fallbackChat?: { chatName: string; chatEntry: unknown };
  }): Promise<DeleteActiveChatStoreResult> {
    return await this.database.writeTransaction('delete active canonical chat', (connection) => {
      if (opts.chatName === 'default') throw new Error('cannot delete default chat');
      const current = this.projectChatWithConnection(connection, opts.droneId, opts.chatName);
      if (!current) throw new Error(`unknown chat: ${opts.chatName}`);
      connection.prepare('DELETE FROM canonical_chats WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.chatName);
      connection.prepare(`INSERT OR REPLACE INTO canonical_chat_tombstones (
        drone_id, chat_name, reason, replacement_chat_name, deleted_at
      ) VALUES (?, ?, 'deleted', NULL, ?)`).run(opts.droneId, opts.chatName, new Date().toISOString());
      if (this.listChatsWithConnection(connection, opts.droneId).chats.length === 0 && opts.fallbackChat) {
        this.writeChatWithConnection(connection, opts.droneId, opts.fallbackChat.chatName, opts.fallbackChat.chatEntry);
      }
      appendChatEvent(connection, 'chat.deleted', opts.droneId, opts.chatName, {});
      return {
        available: true,
        deletedChat: current,
        chats: this.listChatsWithConnection(connection, opts.droneId).chats,
      };
    });
  }

  async backfillArchivedChats(opts: { droneId: string; archivedChats: unknown }): Promise<ArchivedChatStoreListResult> {
    const archivedChats = opts.archivedChats && typeof opts.archivedChats === 'object' && !Array.isArray(opts.archivedChats)
      ? opts.archivedChats as Record<string, unknown>
      : {};
    return await this.database.writeTransaction('backfill legacy archived chats', (connection) => {
      if (this.droneChatTombstoned(connection, opts.droneId)) {
        return this.listArchivedChatsWithConnection(connection, opts.droneId);
      }
      for (const [chatName, raw] of Object.entries(archivedChats)) {
        const value = archivedChatValue(raw);
        if (!value) continue;
        const tombstone = connection.prepare(`SELECT 1 FROM canonical_archived_chat_tombstones
          WHERE drone_id = ? AND chat_name = ?`).get(opts.droneId, chatName);
        if (tombstone) continue;
        connection.prepare(`INSERT OR IGNORE INTO canonical_archived_chats (
          drone_id, chat_name, archived_at, delete_at, archive_retention, chat_json, source_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          opts.droneId,
          chatName,
          value.archivedAt,
          value.deleteAt,
          value.archiveRetention,
          stableJson(value.chat),
          chatEntrySourceHash(value.chat),
        );
      }
      return this.listArchivedChatsWithConnection(connection, opts.droneId);
    });
  }

  async archiveChat(opts: {
    droneId: string;
    chatName: string;
    archivedAt: string;
    deleteAt: string;
    archiveRetention: string;
    fallbackChat?: { chatName: string; chatEntry: unknown };
  }): Promise<ArchiveChatStoreResult> {
    return await this.database.writeTransaction('archive canonical chat', (connection) => {
      const chat = this.projectChatWithConnection(connection, opts.droneId, opts.chatName);
      if (!chat) {
        return { available: true, archived: false, archivedChat: null, chats: this.listChatsWithConnection(connection, opts.droneId).chats };
      }
      const record: ArchivedChatRecord = {
        droneId: opts.droneId,
        chatName: opts.chatName,
        chat,
        archivedAt: opts.archivedAt,
        deleteAt: opts.deleteAt,
        archiveRetention: opts.archiveRetention,
      };
      connection.prepare(`INSERT INTO canonical_archived_chats (
        drone_id, chat_name, archived_at, delete_at, archive_retention, chat_json, source_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name) DO UPDATE SET
        archived_at = excluded.archived_at,
        delete_at = excluded.delete_at,
        archive_retention = excluded.archive_retention,
        chat_json = excluded.chat_json,
        source_hash = excluded.source_hash`).run(
          opts.droneId,
          opts.chatName,
          opts.archivedAt,
          opts.deleteAt,
          opts.archiveRetention,
          stableJson(chat),
          chatEntrySourceHash(chat),
        );
      connection.prepare('DELETE FROM canonical_archived_chat_tombstones WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.chatName);
      connection.prepare('DELETE FROM canonical_chats WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.chatName);
      connection.prepare(`INSERT OR REPLACE INTO canonical_chat_tombstones (
        drone_id, chat_name, reason, replacement_chat_name, deleted_at
      ) VALUES (?, ?, 'deleted', NULL, ?)`).run(opts.droneId, opts.chatName, opts.archivedAt);
      if (this.listChatsWithConnection(connection, opts.droneId).chats.length === 0 && opts.fallbackChat) {
        this.writeChatWithConnection(connection, opts.droneId, opts.fallbackChat.chatName, opts.fallbackChat.chatEntry);
      }
      appendChatEvent(connection, 'chat.archived', opts.droneId, opts.chatName, {
        archivedAt: opts.archivedAt,
        deleteAt: opts.deleteAt,
        archiveRetention: opts.archiveRetention,
      });
      return {
        available: true,
        archived: true,
        archivedChat: record,
        chats: this.listChatsWithConnection(connection, opts.droneId).chats,
      };
    });
  }

  async restoreArchivedChat(opts: {
    droneId: string;
    archivedChatName: string;
    maxChatNameLength?: number;
  }): Promise<RestoreArchivedChatStoreResult> {
    return await this.database.writeTransaction('restore canonical archived chat', (connection) => {
      const archived = this.archivedChatRow(connection, opts.droneId, opts.archivedChatName);
      const record = archivedChatRecord(archived ?? undefined);
      if (!record) {
        return {
          available: true,
          restored: false,
          chatName: opts.archivedChatName,
          renamed: false,
          chat: null,
          chats: this.listChatsWithConnection(connection, opts.droneId).chats,
        };
      }
      const chatName = this.allocateRestoredChatNameWithConnection(
        connection,
        opts.droneId,
        opts.archivedChatName,
        opts.maxChatNameLength ?? 64,
      );
      this.writeChatWithConnection(connection, opts.droneId, chatName, record.chat);
      markCurrentReadForBootstrap(connection, opts.droneId, chatName);
      connection.prepare('DELETE FROM canonical_archived_chats WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.archivedChatName);
      connection.prepare(`INSERT OR REPLACE INTO canonical_archived_chat_tombstones (
        drone_id, chat_name, reason, deleted_at
      ) VALUES (?, ?, 'restored', ?)`).run(opts.droneId, opts.archivedChatName, new Date().toISOString());
      appendChatEvent(connection, 'chat.restored', opts.droneId, chatName, {
        archivedChatName: opts.archivedChatName,
      });
      return {
        available: true,
        restored: true,
        chatName,
        renamed: chatName !== opts.archivedChatName,
        chat: record.chat,
        chats: this.listChatsWithConnection(connection, opts.droneId).chats,
      };
    });
  }

  async deleteArchivedChat(opts: { droneId: string; archivedChatName: string }): Promise<DeleteArchivedChatStoreResult> {
    return await this.database.writeTransaction('delete canonical archived chat', (connection) => {
      const record = archivedChatRecord(this.archivedChatRow(connection, opts.droneId, opts.archivedChatName) ?? undefined);
      if (!record) return { available: true, deleted: false, archivedChat: null };
      connection.prepare('DELETE FROM canonical_archived_chats WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.archivedChatName);
      connection.prepare(`INSERT OR REPLACE INTO canonical_archived_chat_tombstones (
        drone_id, chat_name, reason, deleted_at
      ) VALUES (?, ?, 'deleted', ?)`).run(opts.droneId, opts.archivedChatName, new Date().toISOString());
      appendChatEvent(connection, 'chat.archive.deleted', opts.droneId, opts.archivedChatName, {});
      return { available: true, deleted: true, archivedChat: record };
    });
  }

  listArchivedChats(opts: { droneId?: string } = {}): ArchivedChatStoreListResult {
    return this.database.read((connection) => this.listArchivedChatsWithConnection(connection, opts.droneId));
  }

  readArchivedChat(opts: { droneId: string; chatName: string }): ArchivedChatRecord | null {
    return this.database.read((connection) => archivedChatRecord(
      this.archivedChatRow(connection, opts.droneId, opts.chatName) ?? undefined,
    ));
  }

  async upsertChat(opts: { droneId: string; chatName: string; chatEntry: unknown }): Promise<ChatStoreImportResult> {
    return await this.database.writeTransaction('upsert canonical chat', (connection) => {
      if (this.droneChatTombstoned(connection, opts.droneId)) {
        throw new Error(`cannot write chat for permanently deleted drone: ${opts.droneId}`);
      }
      const now = new Date().toISOString();
      const rawValue = opts.chatEntry && typeof opts.chatEntry === 'object' ? opts.chatEntry : {};
      const current = this.chatRow(connection, opts.droneId, opts.chatName);
      const value = {
        ...rawValue,
        ...metadataWithStableId(
          rawValue,
          current ? parseJson(current.metadata_json) : undefined,
        ),
      };
      const sourceHash = chatEntrySourceHash(value);
      connection.prepare(`
        INSERT INTO canonical_chats (
          drone_id, chat_name, created_at, updated_at, metadata_json, source_hash,
          transcript_version, turns_source_hash
        ) VALUES (?, ?, ?, ?, ?, ?, 0, '')
        ON CONFLICT(drone_id, chat_name) DO UPDATE SET
          updated_at = excluded.updated_at,
          metadata_json = excluded.metadata_json,
          source_hash = excluded.source_hash
      `).run(
        opts.droneId,
        opts.chatName,
        typeof (value as any).createdAt === 'string' ? (value as any).createdAt : null,
        now,
        stableJson(metadata(value)),
        sourceHash,
      );
      connection.prepare('DELETE FROM canonical_chat_tombstones WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.chatName);
      this.reconcileTurns(connection, opts.droneId, opts.chatName, turnsWithLegacySubmissionTimes(value), false);
      appendChatEvent(connection, current ? 'chat.updated' : 'chat.created', opts.droneId, opts.chatName, {});
      return { available: true, sourceHash };
    });
  }

  async patchMetadata(opts: { droneId: string; chatName: string; patch: ChatMetadataPatch }): Promise<ChatMetadataPatchResult> {
    return await this.database.writeTransaction('patch canonical chat metadata', (connection) => {
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      if (!row) throw new Error(`unknown chat: ${opts.chatName}`);
      const result = this.patchMetadataWithConnection(connection, opts.droneId, opts.chatName, opts.patch);
      if (result.changed) {
        appendChatEvent(connection, 'chat.metadata.changed', opts.droneId, opts.chatName, { fields: result.fields });
      }
      return { available: true, changed: result.changed, metadata: result.metadata };
    });
  }

  async applyReconciliation(opts: {
    droneId: string;
    chatName: string;
    metadataPatch?: ChatMetadataPatch;
    turns?: StoredTranscriptTurn[];
  }): Promise<ChatStoreImportResult> {
    return await this.database.writeTransaction('apply canonical chat reconciliation', (connection) => {
      if (!this.chatRow(connection, opts.droneId, opts.chatName)) throw new Error(`unknown chat: ${opts.chatName}`);
      const metadataResult = this.patchMetadataWithConnection(connection, opts.droneId, opts.chatName, opts.metadataPatch ?? {});
      const changedTurnIds: string[] = [];
      for (const raw of opts.turns ?? []) {
        const turn = normalizeTurn(raw);
        const id = turnId(turn);
        if (this.upsertTurnWithConnection(connection, opts.droneId, opts.chatName, id, turn)) changedTurnIds.push(id);
      }
      const refreshed = changedTurnIds.length > 0
        ? refreshTranscriptMetadata(connection, opts.droneId, opts.chatName)
        : this.transcriptMetadata(connection, opts.droneId, opts.chatName);
      if (metadataResult.changed || changedTurnIds.length > 0) {
        appendChatEvent(connection, 'chat.reconciled', opts.droneId, opts.chatName, {
          metadataFields: metadataResult.fields,
          turnIds: changedTurnIds,
        });
      }
      return { available: true, sourceHash: refreshed.sourceHash };
    });
  }

  async renameChat(opts: { droneId: string; chatName: string; newChatName: string }): Promise<boolean> {
    return await this.database.writeTransaction('rename canonical chat', (connection) => {
      if (opts.chatName === 'default') throw new Error('cannot rename default chat');
      if (opts.chatName === opts.newChatName) {
        if (!this.chatRow(connection, opts.droneId, opts.chatName)) throw new Error(`unknown chat: ${opts.chatName}`);
        return false;
      }
      if (this.chatRow(connection, opts.droneId, opts.newChatName)) throw new Error(`chat already exists: ${opts.newChatName}`);
      const info = connection
        .prepare(`UPDATE canonical_chats SET chat_name = ?, updated_at = ? WHERE drone_id = ? AND chat_name = ?`)
        .run(opts.newChatName, new Date().toISOString(), opts.droneId, opts.chatName);
      if (Number(info.changes) === 1) {
        connection.prepare(`INSERT OR REPLACE INTO canonical_chat_tombstones (
          drone_id, chat_name, reason, replacement_chat_name, deleted_at
        ) VALUES (?, ?, 'renamed', ?, ?)`).run(
          opts.droneId,
          opts.chatName,
          opts.newChatName,
          new Date().toISOString(),
        );
        connection.prepare('DELETE FROM canonical_chat_tombstones WHERE drone_id = ? AND chat_name = ?')
          .run(opts.droneId, opts.newChatName);
        appendChatEvent(connection, 'chat.renamed', opts.droneId, opts.newChatName, { previousChatName: opts.chatName });
        return true;
      }
      throw new Error(`unknown chat: ${opts.chatName}`);
    });
  }

  async deleteChat(opts: { droneId: string; chatName: string }): Promise<boolean> {
    return await this.database.writeTransaction('delete canonical chat', (connection) => {
      const info = connection
        .prepare('DELETE FROM canonical_chats WHERE drone_id = ? AND chat_name = ?')
        .run(opts.droneId, opts.chatName);
      connection.prepare(`INSERT OR REPLACE INTO canonical_chat_tombstones (
        drone_id, chat_name, reason, replacement_chat_name, deleted_at
      ) VALUES (?, ?, 'deleted', NULL, ?)`).run(opts.droneId, opts.chatName, new Date().toISOString());
      if (Number(info.changes) === 1) {
        appendChatEvent(connection, 'chat.deleted', opts.droneId, opts.chatName, {});
      }
      return Number(info.changes) === 1;
    });
  }

  async commitPermanentDroneDeletion(opts: {
    droneId: string;
    lifecycleState: 'real' | 'archived';
  }): Promise<PermanentDroneChatCleanupResult> {
    const lifecycleTable = opts.lifecycleState === 'real' ? 'hub_canonical_drones' : 'hub_canonical_archived_drones';
    const otherLifecycleTables = opts.lifecycleState === 'real'
      ? ['hub_canonical_pending_drones', 'hub_canonical_archived_drones']
      : ['hub_canonical_drones', 'hub_canonical_pending_drones'];
    return await this.database.writeTransaction('permanently delete drone lifecycle and chats', (connection) => {
      const lifecycle = connection.prepare(`SELECT version FROM ${lifecycleTable} WHERE drone_id = ?`)
        .get(opts.droneId) as { version: number } | undefined;
      if (!lifecycle) {
        const conflictingState = otherLifecycleTables.some((table) =>
          Boolean(connection.prepare(`SELECT 1 FROM ${table} WHERE drone_id = ?`).get(opts.droneId)));
        if (conflictingState) {
          return {
            available: true,
            removedLifecycle: false,
            alreadyDeleted: false,
            activeChatsDeleted: 0,
            turnsDeleted: 0,
            archivedChatsDeleted: 0,
            chatTombstonesDeleted: 0,
            archivedChatTombstonesDeleted: 0,
            promptsDeleted: 0,
          };
        }
      }

      const count = (table: string): number => Number((connection.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE drone_id = ?`,
      ).get(opts.droneId) as { count: number }).count);
      const activeChatsDeleted = count('canonical_chats');
      const turnsDeleted = count('canonical_chat_turns');
      const archivedChatsDeleted = count('canonical_archived_chats');
      const chatTombstonesDeleted = count('canonical_chat_tombstones');
      const archivedChatTombstonesDeleted = count('canonical_archived_chat_tombstones');
      const promptsDeleted = count('prompts');
      const alreadyDeleted = Boolean(connection.prepare(`SELECT 1 FROM canonical_drone_chat_tombstones
        WHERE drone_id = ?`).get(opts.droneId));

      connection.prepare(`INSERT OR IGNORE INTO canonical_drone_chat_tombstones (
        drone_id, deleted_at, reason
      ) VALUES (?, ?, 'drone-deleted')`).run(opts.droneId, new Date().toISOString());
      if (lifecycle) {
        connection.prepare(`
          INSERT INTO hub_drone_lifecycle_tombstones (drone_id, prior_state, deleted_at, reason)
          VALUES (?, ?, ?, 'permanent-delete')
          ON CONFLICT(drone_id) DO UPDATE SET
            prior_state = excluded.prior_state,
            deleted_at = excluded.deleted_at,
            reason = excluded.reason
        `).run(opts.droneId, opts.lifecycleState, new Date().toISOString());
      }
      connection.prepare('DELETE FROM prompts WHERE drone_id = ?').run(opts.droneId);
      connection.prepare('DELETE FROM canonical_chats WHERE drone_id = ?').run(opts.droneId);
      connection.prepare('DELETE FROM canonical_archived_chats WHERE drone_id = ?').run(opts.droneId);
      connection.prepare('DELETE FROM canonical_chat_tombstones WHERE drone_id = ?').run(opts.droneId);
      connection.prepare('DELETE FROM canonical_archived_chat_tombstones WHERE drone_id = ?').run(opts.droneId);
      const lifecycleDelete = connection.prepare(`DELETE FROM ${lifecycleTable} WHERE drone_id = ?`).run(opts.droneId);
      const removedLifecycle = Number(lifecycleDelete.changes ?? 0) === 1;
      const changed = !alreadyDeleted || removedLifecycle || activeChatsDeleted > 0 || archivedChatsDeleted > 0 ||
        chatTombstonesDeleted > 0 || archivedChatTombstonesDeleted > 0 || promptsDeleted > 0;
      if (changed) {
        appendHubOutboxEvent(connection, {
          topic: 'chat.changes',
          eventType: 'drone.chats.deleted',
          aggregateType: 'drone',
          aggregateId: opts.droneId,
          payload: {
            droneId: opts.droneId,
            activeChatsDeleted,
            turnsDeleted,
            archivedChatsDeleted,
            chatTombstonesDeleted,
            archivedChatTombstonesDeleted,
            promptsDeleted,
          },
        });
      }
      if (removedLifecycle) {
        appendHubOutboxEvent(connection, {
          topic: 'drone.lifecycle.changes',
          eventType: 'drone.lifecycle.deleted',
          aggregateType: 'drone',
          aggregateId: opts.droneId,
          payload: { id: opts.droneId, priorState: opts.lifecycleState, version: Number(lifecycle?.version ?? 0) },
        });
      }
      return {
        available: true,
        removedLifecycle,
        alreadyDeleted,
        activeChatsDeleted,
        turnsDeleted,
        archivedChatsDeleted,
        chatTombstonesDeleted,
        archivedChatTombstonesDeleted,
        promptsDeleted,
      };
    });
  }

  async importTurns(opts: { droneId: string; chatName: string; turns: unknown }): Promise<TranscriptImportResult> {
    return await this.database.writeTransaction('backfill legacy transcript turns', (connection) => {
      if (!this.ensureChat(connection, opts.droneId, opts.chatName, false)) {
        return { available: true, transcriptVersion: 0, sourceHash: transcriptTurnsSourceHash([]) };
      }
      const importedTurnCount = this.reconcileTurns(connection, opts.droneId, opts.chatName, opts.turns, true, false);
      const refreshed = refreshTranscriptMetadata(connection, opts.droneId, opts.chatName);
      if (importedTurnCount > 0) {
        appendChatEvent(connection, 'chat.turns.imported', opts.droneId, opts.chatName, {
          source: 'legacy-import',
          importedTurnCount,
        });
      }
      return refreshed;
    });
  }

  async upsertTurn(opts: { droneId: string; chatName: string; turn: StoredTranscriptTurn }): Promise<ChatStoreImportResult> {
    return await this.database.writeTransaction('upsert canonical transcript turn', (connection) => {
      if (!this.ensureChat(connection, opts.droneId, opts.chatName, false)) {
        throw new Error(`cannot write turn for deleted chat: ${opts.chatName}`);
      }
      const turn = normalizeTurn(opts.turn);
      const id = turnId(turn);
      const changed = this.upsertTurnWithConnection(connection, opts.droneId, opts.chatName, id, turn);
      const refreshed = refreshTranscriptMetadata(connection, opts.droneId, opts.chatName);
      if (changed) appendChatEvent(connection, 'chat.turn.changed', opts.droneId, opts.chatName, { turnId: id });
      return { available: true, sourceHash: refreshed.sourceHash };
    });
  }

  async updateTurn(opts: {
    droneId: string;
    chatName: string;
    turnId: string;
    update: (turn: StoredTranscriptTurn) => StoredTranscriptTurn;
  }): Promise<TranscriptTurnUpdateResult> {
    return await this.database.writeTransaction('update canonical transcript turn', (connection) => {
      const row = connection.prepare(`SELECT turn_json FROM canonical_chat_turns
        WHERE drone_id = ? AND chat_name = ? AND turn_id = ?`).get(opts.droneId, opts.chatName, opts.turnId) as TurnRow | undefined;
      if (!row) return { available: true, changed: false, turn: null };
      const current = normalizeTurn(parseJson(row.turn_json));
      const next = normalizeTurn(opts.update(current));
      if (turnId(next) !== opts.turnId) throw new Error('targeted transcript update cannot change turn id');
      if (stableJson(current) === stableJson(next)) return { available: true, changed: false, turn: current };
      this.upsertTurnWithConnection(connection, opts.droneId, opts.chatName, opts.turnId, next);
      refreshTranscriptMetadata(connection, opts.droneId, opts.chatName);
      appendChatEvent(connection, 'chat.turn.changed', opts.droneId, opts.chatName, { turnId: opts.turnId, source: 'targeted-update' });
      return { available: true, changed: true, turn: next };
    });
  }

  async rollbackToTurn(opts: {
    droneId: string;
    chatName: string;
    turnId: string;
    update: (turn: StoredTranscriptTurn) => StoredTranscriptTurn;
  }): Promise<TranscriptRollbackResult> {
    return await this.database.writeTransaction('rollback canonical transcript turns', (connection) => {
      const rows = connection.prepare(`SELECT turn_id, turn_json FROM canonical_chat_turns
        WHERE drone_id = ? AND chat_name = ?
        ORDER BY COALESCE(prompt_at, at), completed_at, ordinal, turn_id`).all(opts.droneId, opts.chatName) as Array<TurnRow & { turn_id: string }>;
      const index = rows.findIndex((row) => row.turn_id === opts.turnId);
      if (index < 0) return { available: true, changed: false, removedTurns: [], turn: null };
      const current = normalizeTurn(parseJson(rows[index].turn_json));
      const next = normalizeTurn(opts.update(current));
      if (turnId(next) !== opts.turnId) throw new Error('transcript rollback cannot change turn id');
      const removedRows = rows.slice(index + 1);
      const remove = connection.prepare(`DELETE FROM canonical_chat_turns
        WHERE drone_id = ? AND chat_name = ? AND turn_id = ?`);
      for (const row of removedRows) remove.run(opts.droneId, opts.chatName, row.turn_id);
      const targetChanged = stableJson(current) !== stableJson(next);
      if (targetChanged) this.upsertTurnWithConnection(connection, opts.droneId, opts.chatName, opts.turnId, next);
      const changed = targetChanged || removedRows.length > 0;
      if (changed) {
        refreshTranscriptMetadata(connection, opts.droneId, opts.chatName);
        appendChatEvent(connection, 'chat.turns.rolled-back', opts.droneId, opts.chatName, {
          turnId: opts.turnId,
          removedTurnIds: removedRows.map((row) => row.turn_id),
        });
      }
      return {
        available: true,
        changed,
        removedTurns: removedRows.map((row) => normalizeTurn(parseJson(row.turn_json))),
        turn: next,
      };
    });
  }

  listChats(opts: { droneId: string }): ChatStoreListResult {
    return this.database.read((connection) => this.listChatsWithConnection(connection, opts.droneId));
  }

  readChat(opts: { droneId: string; chatName: string }): ChatStoreReadResult {
    return this.database.read((connection) => {
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      if (!row) return { available: true, chat: null, sourceHash: '' };
      const base = metadata(parseJson(row.metadata_json));
      return {
        available: true,
        chat: {
          ...(base && typeof base === 'object' ? base : {}),
          turns: this.projectTurns(connection, opts.droneId, opts.chatName),
          pendingPrompts: getPromptQueueRepository()?.list({ droneId: opts.droneId, chatName: opts.chatName, limit: 60 }) ?? [],
        },
        sourceHash: row.source_hash,
      };
    });
  }

  read(opts: { droneId: string; chatName: string; indexes: number[] }): TranscriptStoreReadResult {
    return this.database.read((connection) => {
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      const turns = this.projectTurns(connection, opts.droneId, opts.chatName);
      return {
        available: true,
        count: turns.length,
        transcriptVersion: Number(row?.transcript_version ?? 0),
        sourceHash: row?.turns_source_hash || transcriptTurnsSourceHash(turns),
        turns: opts.indexes
          .map((index) => turns[index] ? { index, turn: turns[index] } : null)
          .filter((item): item is { index: number; turn: StoredTranscriptTurn } => Boolean(item)),
      };
    });
  }

  readVersion(opts: { droneId: string; chatName: string; includePending: boolean }): ChatReadVersion {
    return this.database.read((connection) => {
      const row = this.chatRow(connection, opts.droneId, opts.chatName);
      if (!row) {
        return {
          available: true, chat: null, chatSourceHash: '', turnCount: 0,
          transcriptVersion: 0, transcriptSourceHash: '', pendingVersion: '',
        };
      }
      const countRow = connection.prepare(`SELECT COUNT(*) AS count FROM canonical_chat_turns
        WHERE drone_id = ? AND chat_name = ?`).get(opts.droneId, opts.chatName) as { count: number };
      const pendingVersion = opts.includePending ? this.pendingVersion(connection, opts.droneId, opts.chatName) : '';
      const parsed = metadata(parseJson(row.metadata_json));
      return {
        available: true,
        chat: parsed && typeof parsed === 'object' ? parsed : {},
        chatSourceHash: row.source_hash,
        turnCount: Number(countRow?.count ?? 0),
        transcriptVersion: Number(row.transcript_version ?? 0),
        transcriptSourceHash: row.turns_source_hash || transcriptTurnsSourceHash([]),
        pendingVersion,
      };
    });
  }

  readRows(opts: { droneId: string; chatName: string; indexes: number[]; includePending: boolean }): ChatReadRows {
    return this.database.read((connection) => {
      const indexes = [...new Set(opts.indexes.filter((value) => Number.isSafeInteger(value) && value >= 0))].sort((a, b) => a - b);
      let turns: Array<{ index: number; turn: StoredTranscriptTurn }> = [];
      if (indexes.length > 0) {
        for (let offset = 0; offset < indexes.length; offset += 400) {
          const batch = indexes.slice(offset, offset + 400);
          const placeholders = batch.map(() => '?').join(', ');
          const rows = connection.prepare(`WITH ordered AS (
            SELECT ROW_NUMBER() OVER (
              ORDER BY COALESCE(prompt_at, at), completed_at, ordinal, turn_id
            ) - 1 AS turn_index, turn_json
            FROM canonical_chat_turns WHERE drone_id = ? AND chat_name = ?
          ) SELECT turn_index, turn_json FROM ordered WHERE turn_index IN (${placeholders}) ORDER BY turn_index`)
            .all(opts.droneId, opts.chatName, ...batch) as Array<{ turn_index: number; turn_json: string }>;
          turns.push(...rows.map((row) => ({ index: Number(row.turn_index), turn: normalizeTurn(parseJson(row.turn_json)) })));
        }
      }
      const pending = opts.includePending ? this.projectPending(connection, opts.droneId, opts.chatName) : [];
      const pendingIds = pending.map((item) => String(item.id ?? '').trim()).filter(Boolean);
      const pendingTurns = pendingIds.length > 0
        ? (connection.prepare(`SELECT turn_json FROM canonical_chat_turns
            WHERE drone_id = ? AND chat_name = ? AND turn_id IN (${pendingIds.map(() => '?').join(', ')})`)
          .all(opts.droneId, opts.chatName, ...pendingIds) as TurnRow[])
          .map((row) => normalizeTurn(parseJson(row.turn_json)))
        : [];
      return {
        available: true,
        turns: turns.sort((a, b) => a.index - b.index),
        pending,
        pendingTurns,
      };
    });
  }

  async clearAllForTests(): Promise<void> {
    await this.database.writeTransaction('clear canonical chats for tests', (connection) => {
      connection.exec(`
        DELETE FROM canonical_chat_turns;
        DELETE FROM canonical_chats;
        DELETE FROM canonical_chat_tombstones;
        DELETE FROM canonical_archived_chats;
        DELETE FROM canonical_archived_chat_tombstones;
        DELETE FROM canonical_drone_chat_tombstones;
      `);
    });
  }

  private writeChatWithConnection(
    connection: HubDatabaseConnection,
    droneId: string,
    chatName: string,
    raw: unknown,
  ): void {
    if (this.droneChatTombstoned(connection, droneId)) {
      throw new Error(`cannot write chat for permanently deleted drone: ${droneId}`);
    }
    const rawValue = raw && typeof raw === 'object' ? raw : {};
    const current = this.chatRow(connection, droneId, chatName);
    const value = {
      ...rawValue,
      ...metadataWithStableId(rawValue, current ? parseJson(current.metadata_json) : undefined),
    };
    const now = new Date().toISOString();
    connection.prepare(`
      INSERT INTO canonical_chats (
        drone_id, chat_name, created_at, updated_at, metadata_json, source_hash,
        transcript_version, turns_source_hash
      ) VALUES (?, ?, ?, ?, ?, ?, 0, '')
      ON CONFLICT(drone_id, chat_name) DO UPDATE SET
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json,
        source_hash = excluded.source_hash
    `).run(
      droneId,
      chatName,
      typeof (value as any).createdAt === 'string' ? (value as any).createdAt : null,
      now,
      stableJson(metadata(value)),
      chatEntrySourceHash(value),
    );
    connection.prepare('DELETE FROM canonical_chat_tombstones WHERE drone_id = ? AND chat_name = ?')
      .run(droneId, chatName);
    connection.prepare('DELETE FROM canonical_chat_turns WHERE drone_id = ? AND chat_name = ?')
      .run(droneId, chatName);
    this.reconcileTurns(connection, droneId, chatName, turnsWithLegacySubmissionTimes(value), false, false);
  }

  private projectChatWithConnection(connection: HubDatabaseConnection, droneId: string, chatName: string): any | null {
    const row = this.chatRow(connection, droneId, chatName);
    if (!row) return null;
    const base = metadata(parseJson(row.metadata_json));
    let pendingPrompts: any[] = [];
    const hasPrompts = connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prompts'").get();
    if (hasPrompts) {
      const rows = connection.prepare(`SELECT prompt_id, created_at, updated_at, state, prompt, payload_json
        FROM prompts WHERE drone_id = ? AND chat_name = ? AND state != 'cancelled' ORDER BY sequence`).all(droneId, chatName) as any[];
      pendingPrompts = rows.map((promptRow) => ({
        ...(parseJson(promptRow.payload_json) ?? {}),
        id: promptRow.prompt_id,
        at: promptRow.created_at,
        prompt: promptRow.prompt,
        state: promptRow.state,
        updatedAt: promptRow.updated_at,
      }));
    }
    return {
      ...(base && typeof base === 'object' ? base : {}),
      turns: this.projectTurns(connection, droneId, chatName),
      pendingPrompts,
    };
  }

  private archivedChatRow(connection: HubDatabaseConnection, droneId: string, chatName: string): ArchivedChatRow | null {
    return (connection.prepare(`SELECT drone_id, chat_name, archived_at, delete_at,
      archive_retention, chat_json, source_hash FROM canonical_archived_chats
      WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName) as ArchivedChatRow | undefined) ?? null;
  }

  private listArchivedChatsWithConnection(
    connection: HubDatabaseConnection,
    droneId?: string,
  ): ArchivedChatStoreListResult {
    const rows = (droneId
      ? connection.prepare(`SELECT drone_id, chat_name, archived_at, delete_at,
          archive_retention, chat_json, source_hash FROM canonical_archived_chats
          WHERE drone_id = ? ORDER BY archived_at DESC, chat_name`).all(droneId)
      : connection.prepare(`SELECT drone_id, chat_name, archived_at, delete_at,
          archive_retention, chat_json, source_hash FROM canonical_archived_chats
          ORDER BY archived_at DESC, drone_id, chat_name`).all()) as ArchivedChatRow[];
    return {
      available: true,
      archivedChats: rows.map((row) => archivedChatRecord(row)).filter((row): row is ArchivedChatRecord => Boolean(row)),
    };
  }

  private allocateRestoredChatNameWithConnection(
    connection: HubDatabaseConnection,
    droneId: string,
    preferredRaw: unknown,
    maxLength: number,
  ): string {
    const preferred = String(preferredRaw ?? '').trim();
    const fallback = preferred || 'chat';
    if (!this.chatRow(connection, droneId, fallback)) return fallback;
    const maxBaseLength = Math.max(8, maxLength - 8);
    const base = fallback.length > maxBaseLength ? fallback.slice(0, maxBaseLength).trim() : fallback;
    for (let index = 2; index <= 999; index += 1) {
      const candidate = `${base} (${index})`;
      if (candidate.length <= maxLength && !this.chatRow(connection, droneId, candidate)) return candidate;
    }
    return fallback.slice(0, maxLength).trim() || 'chat';
  }

  private insertMissingChat(connection: HubDatabaseConnection, droneId: string, chatName: string, raw: unknown, sourceHash?: string): void {
    if (this.droneChatTombstoned(connection, droneId)) return;
    const tombstone = connection.prepare(`SELECT 1 FROM canonical_chat_tombstones
      WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName);
    if (tombstone) return;
    const rawValue = raw && typeof raw === 'object' ? raw : {};
    const value = { ...rawValue, ...metadataWithStableId(rawValue) };
    const now = new Date().toISOString();
    const info = connection.prepare(`
      INSERT OR IGNORE INTO canonical_chats (
        drone_id, chat_name, created_at, updated_at, metadata_json, source_hash,
        transcript_version, turns_source_hash
      ) VALUES (?, ?, ?, ?, ?, ?, 0, '')
    `).run(
      droneId,
      chatName,
      typeof (value as any).createdAt === 'string' ? (value as any).createdAt : null,
      now,
      stableJson(metadata(value)),
      sourceHash ?? chatEntrySourceHash(value),
    );
    const importedTurnCount = this.reconcileTurns(
      connection,
      droneId,
      chatName,
      turnsWithLegacySubmissionTimes(value),
      true,
      false,
    );
    if (Number(info.changes) === 1) {
      markCurrentReadForBootstrap(connection, droneId, chatName);
      appendChatEvent(connection, 'chat.imported', droneId, chatName, { source: 'legacy-import', importedTurnCount });
    } else if (importedTurnCount > 0) {
      appendChatEvent(connection, 'chat.turns.imported', droneId, chatName, { source: 'legacy-import', importedTurnCount });
    }
  }

  private reconcileTurns(
    connection: HubDatabaseConnection,
    droneId: string,
    chatName: string,
    raw: unknown,
    missingOnly: boolean,
    emitEvents = true,
  ): number {
    const turns = sortedTurns(Array.isArray(raw) ? raw.map(normalizeTurn) : []);
    let changed = 0;
    const insert = connection.prepare(`
      INSERT OR IGNORE INTO canonical_chat_turns (
        drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsert = connection.prepare(`
      INSERT INTO canonical_chat_turns (
        drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name, turn_id) DO UPDATE SET
        at = excluded.at, prompt_at = excluded.prompt_at,
        completed_at = excluded.completed_at, turn_json = excluded.turn_json
    `);
    for (const [ordinal, turn] of turns.entries()) {
      const id = turnId(turn);
      const info = (missingOnly ? insert : upsert).run(
        droneId, chatName, id, ordinal, turn.at, turn.promptAt ?? null,
        turn.completedAt ?? null, stableJson(turn),
      );
      changed += Number(info.changes);
      if (emitEvents && Number(info.changes) > 0) {
        appendChatEvent(connection, 'chat.turn.changed', droneId, chatName, {
          turnId: id,
          source: missingOnly ? 'legacy-import' : 'reconcile',
        });
      }
    }
    refreshTranscriptMetadata(connection, droneId, chatName);
    return changed;
  }

  private ensureChat(connection: HubDatabaseConnection, droneId: string, chatName: string, clearTombstone: boolean): boolean {
    if (this.droneChatTombstoned(connection, droneId)) return false;
    if (this.chatRow(connection, droneId, chatName)) return true;
    const tombstone = connection.prepare(`SELECT 1 FROM canonical_chat_tombstones
      WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName);
    if (tombstone && !clearTombstone) return false;
    if (clearTombstone) {
      connection.prepare('DELETE FROM canonical_chat_tombstones WHERE drone_id = ? AND chat_name = ?')
        .run(droneId, chatName);
    }
    const now = new Date().toISOString();
    connection.prepare(`INSERT INTO canonical_chats (
      drone_id, chat_name, created_at, updated_at, metadata_json, source_hash,
      transcript_version, turns_source_hash
    ) VALUES (?, ?, ?, ?, '{}', '', 0, '')`).run(droneId, chatName, now, now);
    appendChatEvent(connection, 'chat.created', droneId, chatName, { source: 'turn-reconciliation' });
    return true;
  }

  private droneChatTombstoned(connection: HubDatabaseConnection, droneId: string): boolean {
    return Boolean(connection.prepare(`SELECT 1 FROM canonical_drone_chat_tombstones
      WHERE drone_id = ?`).get(droneId));
  }

  private patchMetadataWithConnection(
    connection: HubDatabaseConnection,
    droneId: string,
    chatName: string,
    patch: ChatMetadataPatch,
  ): { metadata: Record<string, unknown>; changed: boolean; fields: string[] } {
    const row = this.chatRow(connection, droneId, chatName);
    if (!row) throw new Error(`unknown chat: ${chatName}`);
    const result = applyMetadataPatch(parseJson(row.metadata_json), patch);
    if (result.changed) {
      connection.prepare(`UPDATE canonical_chats
        SET metadata_json = ?, source_hash = ?, updated_at = ?
        WHERE drone_id = ? AND chat_name = ?`).run(
        stableJson(result.metadata),
        chatEntrySourceHash(result.metadata),
        new Date().toISOString(),
        droneId,
        chatName,
      );
    }
    return result;
  }

  private upsertTurnWithConnection(
    connection: HubDatabaseConnection,
    droneId: string,
    chatName: string,
    id: string,
    turn: StoredTranscriptTurn,
  ): boolean {
    const current = connection.prepare(`SELECT turn_json FROM canonical_chat_turns
      WHERE drone_id = ? AND chat_name = ? AND turn_id = ?`).get(droneId, chatName, id) as TurnRow | undefined;
    if (current && stableJson(normalizeTurn(parseJson(current.turn_json))) === stableJson(turn)) return false;
    const ordinal = this.nextOrdinal(connection, droneId, chatName);
    connection.prepare(`
      INSERT INTO canonical_chat_turns (
        drone_id, chat_name, turn_id, ordinal, at, prompt_at, completed_at, turn_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drone_id, chat_name, turn_id) DO UPDATE SET
        at = excluded.at, prompt_at = excluded.prompt_at,
        completed_at = excluded.completed_at, turn_json = excluded.turn_json
    `).run(droneId, chatName, id, ordinal, turn.at, turn.promptAt ?? null, turn.completedAt ?? null, stableJson(turn));
    return true;
  }

  private transcriptMetadata(connection: HubDatabaseConnection, droneId: string, chatName: string): TranscriptImportResult {
    const row = this.chatRow(connection, droneId, chatName);
    return {
      available: true,
      transcriptVersion: Number(row?.transcript_version ?? 0),
      sourceHash: row?.turns_source_hash || transcriptTurnsSourceHash([]),
    };
  }

  private nextOrdinal(connection: HubDatabaseConnection, droneId: string, chatName: string): number {
    const row = connection.prepare(`SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
      FROM canonical_chat_turns WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName) as { ordinal: number };
    return Number(row.ordinal);
  }

  private chatRow(connection: HubDatabaseConnection, droneId: string, chatName: string): ChatRow | null {
    return (connection.prepare(`SELECT chat_name, metadata_json, source_hash,
      transcript_version, turns_source_hash FROM canonical_chats
      WHERE drone_id = ? AND chat_name = ?`).get(droneId, chatName) as ChatRow | undefined) ?? null;
  }

  private promptRows(connection: HubDatabaseConnection, droneId: string, chatName: string): any[] {
    const hasPrompts = connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prompts'").get();
    if (!hasPrompts) return [];
    return connection.prepare(`SELECT prompt_id, created_at, updated_at, state, prompt, payload_json, last_error
      FROM prompts WHERE drone_id = ? AND chat_name = ? AND state != 'cancelled'
      ORDER BY sequence DESC LIMIT 60`).all(droneId, chatName).reverse() as any[];
  }

  private projectPending(connection: HubDatabaseConnection, droneId: string, chatName: string): StoredPendingPrompt[] {
    return this.promptRows(connection, droneId, chatName).map((row) => ({
      ...(parseJson(row.payload_json) ?? {}),
      id: row.prompt_id,
      at: row.created_at,
      prompt: row.prompt,
      state: row.state,
      updatedAt: row.updated_at,
      ...(row.last_error ? { error: row.last_error } : { error: undefined }),
    }));
  }

  private pendingVersion(connection: HubDatabaseConnection, droneId: string, chatName: string): string {
    return crypto.createHash('sha256').update(stableJson(this.promptRows(connection, droneId, chatName).map((row) => [
      row.prompt_id, row.updated_at, row.state, row.prompt, row.payload_json, row.last_error,
    ]))).digest('base64url');
  }

  private listChatsWithConnection(connection: HubDatabaseConnection, droneId: string): ChatStoreListResult {
    const rows = connection.prepare('SELECT chat_name FROM canonical_chats WHERE drone_id = ? ORDER BY chat_name').all(droneId) as Array<{ chat_name: string }>;
    return { available: true, chats: rows.map((row) => row.chat_name) };
  }

  private projectTurns(connection: HubDatabaseConnection, droneId: string, chatName: string): StoredTranscriptTurn[] {
    const rows = connection.prepare(`SELECT turn_json FROM canonical_chat_turns
      WHERE drone_id = ? AND chat_name = ?
      ORDER BY COALESCE(prompt_at, at), completed_at, ordinal, turn_id`).all(droneId, chatName) as TurnRow[];
    return rows.map((row) => normalizeTurn(parseJson(row.turn_json)));
  }
}

function repository(): ChatTranscriptRepository | null {
  let database = getHubDatabase();
  if (!database) {
    unavailableReason = 'Hub database is unavailable';
    if ((globalThis as any).Bun) return null;
    database = requireHubDatabase();
  }
  if (cachedRepository?.database === database) return cachedRepository.repository;
  const value = new ChatTranscriptRepository(database);
  cachedRepository = { database, repository: value };
  unavailableReason = null;
  return value;
}

function memoryTurnMap(droneId: string, chatName: string): Map<string, StoredTranscriptTurn> {
  const k = key(droneId, chatName);
  let value = memoryTurns.get(k);
  if (!value) memoryTurns.set(k, (value = new Map()));
  return value;
}

function refreshMemoryReadState(droneId: string, chatName: string): ChatReadState {
  const k = key(droneId, chatName);
  const completedTurns = sortedTurns(memoryTurnMap(droneId, chatName).values())
    .map((turn, ordinal) => ({ turn, ordinal }))
    .filter(
      ({ turn }) =>
        Boolean(turn.completedAt) && Boolean(String(turn.output ?? '').trim() || String(turn.error ?? '').trim()),
    );
  const latest = completedTurns.at(-1) ?? null;
  const latestTurnId = latest ? turnId(latest.turn) : null;
  const current = memoryReadStates.get(k);
  if (!current) {
    const latestAgentRevision = latest ? 1 : 0;
    const state = {
      droneId,
      chatName,
      latestAgentTurnId: latestTurnId,
      latestAgentRevision,
      readThroughRevision: 0,
      unread: latestAgentRevision > 0,
      updatedAt: new Date().toISOString(),
      latestAgentCompletedAt: latest?.turn.completedAt ?? null,
      latestAgentOrdinal: latest?.ordinal ?? null,
    };
    memoryReadStates.set(k, state);
    return state;
  }
  const latestCompletedAt = latest?.turn.completedAt ?? null;
  const sameActivity =
    current.latestAgentTurnId === latestTurnId &&
    current.latestAgentCompletedAt === latestCompletedAt &&
    current.latestAgentOrdinal === (latest?.ordinal ?? null);
  if (sameActivity) return current;
  const isNewer = isNewerAgentActivity(
    latest && latestCompletedAt
      ? { ordinal: latest.ordinal, completedAt: latestCompletedAt }
      : null,
    {
      ordinal: current.latestAgentOrdinal,
      completedAt: current.latestAgentCompletedAt,
    },
  );
  const latestAgentRevision = isNewer
    ? current.latestAgentRevision + 1
    : current.latestAgentRevision;
  const readThroughRevision = isNewer ? current.readThroughRevision : latestAgentRevision;
  const state = {
    ...current,
    latestAgentTurnId: latestTurnId,
    latestAgentRevision,
    readThroughRevision,
    unread: latestAgentRevision > readThroughRevision,
    updatedAt: new Date().toISOString(),
    latestAgentCompletedAt: latestCompletedAt,
    latestAgentOrdinal: latest?.ordinal ?? null,
  };
  memoryReadStates.set(k, state);
  return state;
}

function markMemoryCurrentRead(droneId: string, chatName: string): ChatReadState {
  const k = key(droneId, chatName);
  const current = refreshMemoryReadState(droneId, chatName);
  const next = {
    ...memoryReadStates.get(k)!,
    readThroughRevision: current.latestAgentRevision,
    unread: false,
    updatedAt: new Date().toISOString(),
  };
  memoryReadStates.set(k, next);
  return next;
}

function memoryPromptMap(droneId: string, chatName: string): Map<string, StoredPendingPrompt> {
  const k = key(droneId, chatName);
  let value = memoryPrompts.get(k);
  if (!value) memoryPrompts.set(k, (value = new Map()));
  return value;
}

function memoryReadChat(droneId: string, chatName: string): ChatStoreReadResult {
  const row = memoryChats.get(key(droneId, chatName));
  if (!row) return { available: true, chat: null, sourceHash: '' };
  return { available: true, chat: { ...row.metadata, turns: sortedTurns(memoryTurnMap(droneId, chatName).values()), pendingPrompts: [...memoryPromptMap(droneId, chatName).values()] }, sourceHash: row.sourceHash };
}

async function memoryBackfillChat(droneId: string, chatName: string, raw: unknown): Promise<ChatStoreImportResult> {
  const k = key(droneId, chatName);
  if (memoryDroneChatTombstones.has(droneId)) return { available: true, sourceHash: '' };
  const rawValue = raw && typeof raw === 'object' ? raw : {};
  const current = memoryChats.get(k)?.metadata;
  const value = { ...rawValue, ...metadataWithStableId(rawValue, current) };
  if (memoryChatTombstones.has(k)) return { available: true, sourceHash: '' };
  const inserted = !memoryChats.has(k);
  if (inserted) {
    memoryChats.set(k, { metadata: metadata(value), sourceHash: chatEntrySourceHash(value), version: 0 });
  }
  const turns = memoryTurnMap(droneId, chatName);
  for (const turn of sortedTurns(turnsWithLegacySubmissionTimes(value))) {
    const id = turnId(turn);
    if (!turns.has(id)) turns.set(id, turn);
  }
  const prompts = memoryPromptMap(droneId, chatName);
  for (const prompt of Array.isArray((value as any).pendingPrompts) ? (value as any).pendingPrompts : []) {
    const id = String(prompt?.id ?? '').trim();
    const cancelledKey = `${k}\u0000${id}`;
    if (id && !memoryCancelledPrompts.has(cancelledKey) && !prompts.has(id)) prompts.set(id, prompt);
  }
  if (inserted) {
    markMemoryCurrentRead(droneId, chatName);
  }
  return { available: true, sourceHash: memoryChats.get(k)?.sourceHash ?? '' };
}

async function memoryBackfillArchivedChats(droneId: string, raw: unknown): Promise<ArchivedChatStoreListResult> {
  if (memoryDroneChatTombstones.has(droneId)) return listArchivedChatsFromStore({ droneId });
  const archivedChats = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  for (const [chatName, entry] of Object.entries(archivedChats)) {
    const k = key(droneId, chatName);
    if (memoryArchivedChatTombstones.has(k) || memoryArchivedChats.has(k)) continue;
    const value = archivedChatValue(entry);
    if (!value) continue;
    memoryArchivedChats.set(k, {
      droneId,
      chatName,
      chat: value.chat,
      archivedAt: value.archivedAt,
      deleteAt: value.deleteAt,
      archiveRetention: value.archiveRetention,
    });
  }
  return listArchivedChatsFromStore({ droneId });
}

export function getTranscriptStoreUnavailableReason(): string | null { return unavailableReason; }
export function getTranscriptStore(): ChatTranscriptRepository | null { return repository(); }

export async function importDroneChatsFromRegistry(opts: { droneId: string; chats: unknown }): Promise<ChatStoreListResult> {
  const store = repository();
  if (store) return await store.backfillDroneChats(opts);
  const chats = opts.chats && typeof opts.chats === 'object' && !Array.isArray(opts.chats) ? opts.chats as Record<string, unknown> : {};
  for (const [chatName, chatEntry] of Object.entries(chats)) await memoryBackfillChat(opts.droneId, chatName, chatEntry);
  return listChatsFromStore({ droneId: opts.droneId });
}

export async function importChatFromRegistry(opts: { droneId: string; chatName: string; chatEntry: unknown; sourceHash?: string }): Promise<ChatStoreImportResult> {
  const store = repository();
  return store ? await store.backfillChat(opts) : await memoryBackfillChat(opts.droneId, opts.chatName, opts.chatEntry);
}

export async function createChatInStore(opts: {
  droneId: string;
  chatName: string;
  copyFromChatName?: string;
  implicitDefaultEntry?: unknown;
  createEntry: (source: any | null) => unknown;
}): Promise<CreateChatStoreResult> {
  const store = repository();
  if (store) return await store.createChat(opts);
  if (memoryReadChat(opts.droneId, opts.chatName).chat) throw new Error(`chat already exists: ${opts.chatName}`);
  let source: any | null = null;
  if (opts.copyFromChatName) {
    source = memoryReadChat(opts.droneId, opts.copyFromChatName).chat;
    if (!source && opts.copyFromChatName === 'default' && listChatsFromStore({ droneId: opts.droneId }).chats.length === 0) {
      await upsertChatInStore({ droneId: opts.droneId, chatName: 'default', chatEntry: opts.implicitDefaultEntry ?? {} });
      source = memoryReadChat(opts.droneId, 'default').chat;
    }
    if (!source) throw new Error(`unknown chat: ${opts.copyFromChatName}`);
  }
  await upsertChatInStore({ droneId: opts.droneId, chatName: opts.chatName, chatEntry: opts.createEntry(source) });
  if (opts.copyFromChatName) {
    markMemoryCurrentRead(opts.droneId, opts.chatName);
  }
  return {
    available: true,
    chat: memoryReadChat(opts.droneId, opts.chatName).chat,
    chats: listChatsFromStore({ droneId: opts.droneId }).chats,
  };
}

export async function updateChatInStore(opts: {
  droneId: string;
  chatName: string;
  update: (chat: any) => unknown;
}): Promise<UpdateChatStoreResult> {
  const store = repository();
  if (store) return await store.updateChat(opts);
  const current = memoryReadChat(opts.droneId, opts.chatName).chat;
  if (!current) throw new Error(`unknown chat: ${opts.chatName}`);
  await upsertChatInStore({ droneId: opts.droneId, chatName: opts.chatName, chatEntry: opts.update(current) });
  return {
    available: true,
    chat: memoryReadChat(opts.droneId, opts.chatName).chat,
    chats: listChatsFromStore({ droneId: opts.droneId }).chats,
  };
}

export async function deleteActiveChatFromStore(opts: {
  droneId: string;
  chatName: string;
  fallbackChat?: { chatName: string; chatEntry: unknown };
}): Promise<DeleteActiveChatStoreResult> {
  const store = repository();
  let result: DeleteActiveChatStoreResult;
  if (store) {
    result = await store.deleteActiveChat(opts);
  } else {
    if (opts.chatName === 'default') throw new Error('cannot delete default chat');
    const current = memoryReadChat(opts.droneId, opts.chatName).chat;
    if (!current) throw new Error(`unknown chat: ${opts.chatName}`);
    await deleteChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
    if (listChatsFromStore({ droneId: opts.droneId }).chats.length === 0 && opts.fallbackChat) {
      await upsertChatInStore({
        droneId: opts.droneId,
        chatName: opts.fallbackChat.chatName,
        chatEntry: opts.fallbackChat.chatEntry,
      });
    }
    result = {
      available: true,
      deletedChat: current,
      chats: listChatsFromStore({ droneId: opts.droneId }).chats,
    };
  }
  await getPromptQueueRepository()?.deleteChat({ droneId: opts.droneId, chatName: opts.chatName });
  return result;
}

export async function importArchivedChatsFromRegistry(opts: {
  droneId: string;
  archivedChats: unknown;
}): Promise<ArchivedChatStoreListResult> {
  const store = repository();
  return store
    ? await store.backfillArchivedChats(opts)
    : await memoryBackfillArchivedChats(opts.droneId, opts.archivedChats);
}

export async function archiveChatInStore(opts: {
  droneId: string;
  chatName: string;
  archivedAt: string;
  deleteAt: string;
  archiveRetention: string;
  fallbackChat?: { chatName: string; chatEntry: unknown };
}): Promise<ArchiveChatStoreResult> {
  const store = repository();
  if (store) return await store.archiveChat(opts);
  const read = memoryReadChat(opts.droneId, opts.chatName);
  if (!read.chat) {
    return { available: true, archived: false, archivedChat: null, chats: listChatsFromStore({ droneId: opts.droneId }).chats };
  }
  const record: ArchivedChatRecord = {
    droneId: opts.droneId,
    chatName: opts.chatName,
    chat: read.chat,
    archivedAt: opts.archivedAt,
    deleteAt: opts.deleteAt,
    archiveRetention: opts.archiveRetention,
  };
  const k = key(opts.droneId, opts.chatName);
  memoryArchivedChats.set(k, record);
  memoryArchivedChatTombstones.delete(k);
  await deleteChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
  if (listChatsFromStore({ droneId: opts.droneId }).chats.length === 0 && opts.fallbackChat) {
    await upsertChatInStore({
      droneId: opts.droneId,
      chatName: opts.fallbackChat.chatName,
      chatEntry: opts.fallbackChat.chatEntry,
    });
  }
  return {
    available: true,
    archived: true,
    archivedChat: record,
    chats: listChatsFromStore({ droneId: opts.droneId }).chats,
  };
}

export async function restoreArchivedChatInStore(opts: {
  droneId: string;
  archivedChatName: string;
  maxChatNameLength?: number;
}): Promise<RestoreArchivedChatStoreResult> {
  const store = repository();
  if (store) return await store.restoreArchivedChat(opts);
  const k = key(opts.droneId, opts.archivedChatName);
  const record = memoryArchivedChats.get(k) ?? null;
  if (!record) {
    return {
      available: true,
      restored: false,
      chatName: opts.archivedChatName,
      renamed: false,
      chat: null,
      chats: listChatsFromStore({ droneId: opts.droneId }).chats,
    };
  }
  const maxLength = opts.maxChatNameLength ?? 64;
  const activeNames = new Set(listChatsFromStore({ droneId: opts.droneId }).chats);
  const preferred = opts.archivedChatName || 'chat';
  let chatName = preferred;
  if (activeNames.has(chatName)) {
    const maxBaseLength = Math.max(8, maxLength - 8);
    const base = preferred.length > maxBaseLength ? preferred.slice(0, maxBaseLength).trim() : preferred;
    for (let index = 2; index <= 999; index += 1) {
      const candidate = `${base} (${index})`;
      if (candidate.length <= maxLength && !activeNames.has(candidate)) {
        chatName = candidate;
        break;
      }
    }
  }
  await upsertChatInStore({ droneId: opts.droneId, chatName, chatEntry: record.chat });
  markMemoryCurrentRead(opts.droneId, chatName);
  memoryArchivedChats.delete(k);
  memoryArchivedChatTombstones.add(k);
  return {
    available: true,
    restored: true,
    chatName,
    renamed: chatName !== opts.archivedChatName,
    chat: record.chat,
    chats: listChatsFromStore({ droneId: opts.droneId }).chats,
  };
}

export async function deleteArchivedChatFromStore(opts: {
  droneId: string;
  archivedChatName: string;
}): Promise<DeleteArchivedChatStoreResult> {
  const store = repository();
  if (store) return await store.deleteArchivedChat(opts);
  const k = key(opts.droneId, opts.archivedChatName);
  const archivedChat = memoryArchivedChats.get(k) ?? null;
  if (!archivedChat) return { available: true, deleted: false, archivedChat: null };
  memoryArchivedChats.delete(k);
  memoryArchivedChatTombstones.add(k);
  return { available: true, deleted: true, archivedChat };
}

export function listArchivedChatsFromStore(opts: { droneId?: string } = {}): ArchivedChatStoreListResult {
  const store = repository();
  if (store) return store.listArchivedChats(opts);
  return {
    available: true,
    archivedChats: [...memoryArchivedChats.values()]
      .filter((record) => !opts.droneId || record.droneId === opts.droneId)
      .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt) || left.chatName.localeCompare(right.chatName)),
  };
}

export function readArchivedChatFromStore(opts: { droneId: string; chatName: string }): ArchivedChatRecord | null {
  const store = repository();
  return store ? store.readArchivedChat(opts) : memoryArchivedChats.get(key(opts.droneId, opts.chatName)) ?? null;
}

export async function upsertChatInStore(opts: { droneId: string; chatName: string; chatEntry: unknown }): Promise<ChatStoreImportResult> {
  const store = repository();
  if (store) return await store.upsertChat(opts);
  if (memoryDroneChatTombstones.has(opts.droneId)) {
    throw new Error(`cannot write chat for permanently deleted drone: ${opts.droneId}`);
  }
  const k = key(opts.droneId, opts.chatName);
  const rawValue = opts.chatEntry && typeof opts.chatEntry === 'object' ? opts.chatEntry : {};
  const value = {
    ...rawValue,
    ...metadataWithStableId(rawValue, memoryChats.get(k)?.metadata),
  };
  memoryChatTombstones.delete(k);
  memoryChats.set(k, { metadata: metadata(value), sourceHash: chatEntrySourceHash(value), version: 0 });
  const turns = memoryTurnMap(opts.droneId, opts.chatName);
  turns.clear();
  for (const turn of sortedTurns(turnsWithLegacySubmissionTimes(value))) turns.set(turnId(turn), turn);
  const prompts = memoryPromptMap(opts.droneId, opts.chatName);
  prompts.clear();
  for (const prompt of Array.isArray((value as any).pendingPrompts) ? (value as any).pendingPrompts : []) {
    const id = String(prompt?.id ?? '').trim();
    if (id) prompts.set(id, prompt);
  }
  return { available: true, sourceHash: chatEntrySourceHash(value) };
}

export async function patchChatMetadataInStore(opts: {
  droneId: string;
  chatName: string;
  patch: ChatMetadataPatch;
}): Promise<ChatMetadataPatchResult> {
  const store = repository();
  if (store) return await store.patchMetadata(opts);
  const row = memoryChats.get(key(opts.droneId, opts.chatName));
  if (!row) throw new Error(`unknown chat: ${opts.chatName}`);
  const result = applyMetadataPatch(row.metadata, opts.patch);
  if (result.changed) {
    row.metadata = result.metadata;
    row.sourceHash = chatEntrySourceHash(result.metadata);
  }
  return { available: true, changed: result.changed, metadata: result.metadata };
}

export async function applyChatReconciliationInStore(opts: {
  droneId: string;
  chatName: string;
  metadataPatch?: ChatMetadataPatch;
  turns?: StoredTranscriptTurn[];
}): Promise<ChatStoreImportResult> {
  const store = repository();
  if (store) return await store.applyReconciliation(opts);
  const row = memoryChats.get(key(opts.droneId, opts.chatName));
  if (!row) throw new Error(`unknown chat: ${opts.chatName}`);
  const metadataResult = applyMetadataPatch(row.metadata, opts.metadataPatch);
  if (metadataResult.changed) {
    row.metadata = metadataResult.metadata;
    row.sourceHash = chatEntrySourceHash(metadataResult.metadata);
  }
  const turns = memoryTurnMap(opts.droneId, opts.chatName);
  for (const raw of opts.turns ?? []) {
    const turn = normalizeTurn(raw);
    turns.set(turnId(turn), turn);
  }
  return { available: true, sourceHash: transcriptTurnsSourceHash(sortedTurns(turns.values())) };
}

export async function renameChatInStore(opts: { droneId: string; chatName: string; newChatName: string }): Promise<boolean> {
  const store = repository();
  if (store) {
    const renamed = await store.renameChat(opts);
    if (renamed) await getPromptQueueRepository()?.renameChat(opts);
    return renamed;
  }
  if (opts.chatName === 'default') throw new Error('cannot rename default chat');
  if (opts.chatName === opts.newChatName) {
    if (!memoryReadChat(opts.droneId, opts.chatName).chat) throw new Error(`unknown chat: ${opts.chatName}`);
    return false;
  }
  const oldKey = key(opts.droneId, opts.chatName);
  const nextKey = key(opts.droneId, opts.newChatName);
  if (memoryChats.has(nextKey)) throw new Error(`chat already exists: ${opts.newChatName}`);
  const row = memoryChats.get(oldKey);
  if (!row) throw new Error(`unknown chat: ${opts.chatName}`);
  memoryChats.set(nextKey, row); memoryChats.delete(oldKey);
  const turns = memoryTurns.get(oldKey); if (turns) { memoryTurns.set(nextKey, turns); memoryTurns.delete(oldKey); }
  const prompts = memoryPrompts.get(oldKey); if (prompts) { memoryPrompts.set(nextKey, prompts); memoryPrompts.delete(oldKey); }
  const readState = memoryReadStates.get(oldKey);
  if (readState) {
    memoryReadStates.set(nextKey, { ...readState, chatName: opts.newChatName });
    memoryReadStates.delete(oldKey);
  }
  memoryChatTombstones.add(oldKey); memoryChatTombstones.delete(nextKey);
  return true;
}

export async function deleteChatFromStore(opts: { droneId: string; chatName: string }): Promise<boolean> {
  const store = repository();
  if (store) return await store.deleteChat(opts);
  memoryTurns.delete(key(opts.droneId, opts.chatName));
  memoryPrompts.delete(key(opts.droneId, opts.chatName));
  memoryReadStates.delete(key(opts.droneId, opts.chatName));
  const deleted = memoryChats.delete(key(opts.droneId, opts.chatName));
  memoryChatTombstones.add(key(opts.droneId, opts.chatName));
  return deleted;
}

export async function commitPermanentDroneDeletionInStore(opts: {
  droneId: string;
  lifecycleState: 'real' | 'archived';
}): Promise<PermanentDroneChatCleanupResult> {
  const store = repository();
  if (store) return await store.commitPermanentDroneDeletion(opts);
  const prefix = `${opts.droneId}\u0000`;
  const activeChatKeys = [...memoryChats.keys()].filter((item) => item.startsWith(prefix));
  const archivedChatKeys = [...memoryArchivedChats.keys()].filter((item) => item.startsWith(prefix));
  const chatTombstoneKeys = [...memoryChatTombstones].filter((item) => item.startsWith(prefix));
  const archivedTombstoneKeys = [...memoryArchivedChatTombstones].filter((item) => item.startsWith(prefix));
  const turnsDeleted = [...memoryTurns.entries()]
    .filter(([item]) => item.startsWith(prefix))
    .reduce((total, [, turns]) => total + turns.size, 0);
  const promptsDeleted = [...memoryPrompts.entries()]
    .filter(([item]) => item.startsWith(prefix))
    .reduce((total, [, prompts]) => total + prompts.size, 0);
  const alreadyDeleted = memoryDroneChatTombstones.has(opts.droneId);
  for (const item of activeChatKeys) memoryChats.delete(item);
  for (const item of [...memoryTurns.keys()].filter((keyValue) => keyValue.startsWith(prefix))) memoryTurns.delete(item);
  for (const item of [...memoryPrompts.keys()].filter((keyValue) => keyValue.startsWith(prefix))) memoryPrompts.delete(item);
  for (const item of [...memoryReadStates.keys()].filter((keyValue) => keyValue.startsWith(prefix))) memoryReadStates.delete(item);
  for (const item of archivedChatKeys) memoryArchivedChats.delete(item);
  for (const item of chatTombstoneKeys) memoryChatTombstones.delete(item);
  for (const item of archivedTombstoneKeys) memoryArchivedChatTombstones.delete(item);
  for (const item of [...memoryCancelledPrompts].filter((keyValue) => keyValue.startsWith(prefix))) memoryCancelledPrompts.delete(item);
  memoryDroneChatTombstones.add(opts.droneId);
  return {
    available: true,
    removedLifecycle: false,
    alreadyDeleted,
    activeChatsDeleted: activeChatKeys.length,
    turnsDeleted,
    archivedChatsDeleted: archivedChatKeys.length,
    chatTombstonesDeleted: chatTombstoneKeys.length,
    archivedChatTombstonesDeleted: archivedTombstoneKeys.length,
    promptsDeleted,
  };
}

export function listChatsFromStore(opts: { droneId: string }): ChatStoreListResult {
  const store = repository();
  if (store) return store.listChats(opts);
  const prefix = `${opts.droneId}\u0000`;
  return { available: true, chats: [...memoryChats.keys()].filter((item) => item.startsWith(prefix)).map((item) => item.slice(prefix.length)).sort() };
}

export function readChatReadStateFromStore(opts: {
  droneId: string;
  chatName: string;
}): ChatReadState {
  const store = repository();
  return store ? store.readState(opts) : refreshMemoryReadState(opts.droneId, opts.chatName);
}

export function listChatReadStatesFromStore(opts: {
  droneId: string;
}): Record<string, ChatReadState> {
  const store = repository();
  if (store) return store.listReadStates(opts);
  return Object.fromEntries(
    listChatsFromStore(opts).chats.map((chatName) => [
      chatName,
      refreshMemoryReadState(opts.droneId, chatName),
    ]),
  );
}

export function listChatReadStatesForDronesFromStore(opts: {
  droneIds: string[];
}): Map<string, Record<string, ChatReadState>> {
  const droneIds = [...new Set(opts.droneIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  const store = repository();
  if (store) return store.listReadStatesForDrones({ droneIds });
  return new Map(
    droneIds.map((droneId) => [
      droneId,
      listChatReadStatesFromStore({ droneId }),
    ]),
  );
}

export async function markChatReadInStore(opts: {
  droneId: string;
  chatName: string;
  latestAgentTurnId?: string | null;
  latestAgentRevision?: number;
  updatedByDeviceId?: string | null;
}): Promise<ChatReadState> {
  const store = repository();
  if (store) return await store.markRead(opts);
  const current = refreshMemoryReadState(opts.droneId, opts.chatName);
  const expected =
    opts.latestAgentTurnId === undefined ? current.latestAgentTurnId : opts.latestAgentTurnId;
  if (expected !== current.latestAgentTurnId) return current;
  if (
    opts.latestAgentRevision !== undefined &&
    opts.latestAgentRevision !== current.latestAgentRevision
  ) {
    return current;
  }
  return markMemoryCurrentRead(opts.droneId, opts.chatName);
}

export async function markChatUnreadInStore(opts: {
  droneId: string;
  chatName: string;
  updatedByDeviceId?: string | null;
}): Promise<ChatReadState> {
  const store = repository();
  if (store) return await store.markUnread(opts);
  const current = refreshMemoryReadState(opts.droneId, opts.chatName);
  if (current.unread || current.latestAgentRevision === 0) return current;
  const readThroughRevision = current.latestAgentRevision - 1;
  const next = {
    ...current,
    readThroughRevision,
    unread: current.latestAgentRevision > readThroughRevision,
    updatedAt: new Date().toISOString(),
  };
  memoryReadStates.set(key(opts.droneId, opts.chatName), {
    ...memoryReadStates.get(key(opts.droneId, opts.chatName))!,
    ...next,
  });
  return next;
}

export function readChatFromStore(opts: { droneId: string; chatName: string }): ChatStoreReadResult {
  const store = repository();
  return store ? store.readChat(opts) : memoryReadChat(opts.droneId, opts.chatName);
}

export function readChatVersionFromStore(opts: { droneId: string; chatName: string; includePending: boolean }): ChatReadVersion {
  const store = repository();
  if (store) return store.readVersion(opts);
  const read = memoryReadChat(opts.droneId, opts.chatName);
  const turns = Array.isArray(read.chat?.turns) ? read.chat.turns : [];
  const pending = opts.includePending && Array.isArray(read.chat?.pendingPrompts) ? read.chat.pendingPrompts : [];
  const chat = read.chat ? metadata(read.chat) : null;
  return {
    available: true,
    chat,
    chatSourceHash: read.sourceHash,
    turnCount: turns.length,
    transcriptVersion: turns.length,
    transcriptSourceHash: transcriptTurnsSourceHash(turns),
    pendingVersion: opts.includePending ? chatEntrySourceHash(pending) : '',
  };
}

export function readChatRowsFromStore(opts: {
  droneId: string;
  chatName: string;
  indexes: number[];
  includePending: boolean;
}): ChatReadRows {
  const store = repository();
  if (store) return store.readRows(opts);
  const read = memoryReadChat(opts.droneId, opts.chatName);
  const turns = Array.isArray(read.chat?.turns) ? read.chat.turns : [];
  return {
    available: true,
    turns: opts.indexes.flatMap((index) => turns[index] ? [{ index, turn: turns[index] }] : []),
    pending: opts.includePending && Array.isArray(read.chat?.pendingPrompts) ? read.chat.pendingPrompts : [],
    pendingTurns: turns,
  };
}

export async function importTranscriptTurnsFromRegistry(opts: { droneId: string; chatName: string; turns: unknown; sourceHash?: string }): Promise<TranscriptImportResult> {
  const store = repository();
  if (store) return await store.importTurns(opts);
  if (memoryDroneChatTombstones.has(opts.droneId)) {
    return { available: true, transcriptVersion: 0, sourceHash: transcriptTurnsSourceHash([]) };
  }
  await memoryBackfillChat(opts.droneId, opts.chatName, {});
  for (const turn of sortedTurns(Array.isArray(opts.turns) ? opts.turns : [])) if (!memoryTurnMap(opts.droneId, opts.chatName).has(turnId(turn))) memoryTurnMap(opts.droneId, opts.chatName).set(turnId(turn), turn);
  const turns = sortedTurns(memoryTurnMap(opts.droneId, opts.chatName).values());
  return { available: true, transcriptVersion: turns.length, sourceHash: transcriptTurnsSourceHash(turns) };
}

export function readTranscriptTurnsFromStore(opts: { droneId: string; chatName: string; indexes: number[] }): TranscriptStoreReadResult {
  const store = repository();
  if (store) return store.read(opts);
  const turns = sortedTurns(memoryTurnMap(opts.droneId, opts.chatName).values());
  return { available: true, count: turns.length, transcriptVersion: turns.length, sourceHash: transcriptTurnsSourceHash(turns), turns: opts.indexes.map((index) => turns[index] ? { index, turn: turns[index] } : null).filter((item): item is { index: number; turn: StoredTranscriptTurn } => Boolean(item)) };
}

export function countTranscriptTurnsFromStore(opts: { droneId: string; chatName: string }): { available: boolean; count: number; transcriptVersion: number; sourceHash: string } {
  const read = readTranscriptTurnsFromStore({ ...opts, indexes: [] });
  return { available: true, count: read.count, transcriptVersion: read.transcriptVersion, sourceHash: read.sourceHash };
}

export async function upsertTranscriptTurnInStore(opts: { droneId: string; chatName: string; turn: StoredTranscriptTurn }): Promise<ChatStoreImportResult> {
  const store = repository();
  if (store) return await store.upsertTurn(opts);
  if (memoryDroneChatTombstones.has(opts.droneId)) {
    throw new Error(`cannot write turn for permanently deleted drone: ${opts.droneId}`);
  }
  await memoryBackfillChat(opts.droneId, opts.chatName, {});
  const turn = normalizeTurn(opts.turn); memoryTurnMap(opts.droneId, opts.chatName).set(turnId(turn), turn);
  return { available: true, sourceHash: transcriptTurnsSourceHash(sortedTurns(memoryTurnMap(opts.droneId, opts.chatName).values())) };
}

export async function updateTranscriptTurnInStore(opts: {
  droneId: string;
  chatName: string;
  turnId: string;
  update: (turn: StoredTranscriptTurn) => StoredTranscriptTurn;
}): Promise<TranscriptTurnUpdateResult> {
  const store = repository();
  if (store) return await store.updateTurn(opts);
  const turns = memoryTurnMap(opts.droneId, opts.chatName);
  const current = turns.get(opts.turnId);
  if (!current) return { available: true, changed: false, turn: null };
  const next = normalizeTurn(opts.update(current));
  if (turnId(next) !== opts.turnId) throw new Error('targeted transcript update cannot change turn id');
  const changed = stableJson(current) !== stableJson(next);
  if (changed) turns.set(opts.turnId, next);
  return { available: true, changed, turn: next };
}

export async function rollbackTranscriptToTurnInStore(opts: {
  droneId: string;
  chatName: string;
  turnId: string;
  update: (turn: StoredTranscriptTurn) => StoredTranscriptTurn;
}): Promise<TranscriptRollbackResult> {
  const store = repository();
  if (store) return await store.rollbackToTurn(opts);
  const turns = memoryTurnMap(opts.droneId, opts.chatName);
  const ordered = sortedTurns(turns.values());
  const index = ordered.findIndex((turn) => turnId(turn) === opts.turnId);
  if (index < 0) return { available: true, changed: false, removedTurns: [], turn: null };
  const current = ordered[index];
  const next = normalizeTurn(opts.update(current));
  if (turnId(next) !== opts.turnId) throw new Error('transcript rollback cannot change turn id');
  const removedTurns = ordered.slice(index + 1);
  for (const removed of removedTurns) turns.delete(turnId(removed));
  const targetChanged = stableJson(current) !== stableJson(next);
  if (targetChanged) turns.set(opts.turnId, next);
  return { available: true, changed: targetChanged || removedTurns.length > 0, removedTurns, turn: next };
}

// Prompt compatibility exists only for Bun tests. Production callers use PromptQueueRepository.
export function upsertPendingPromptInStore(opts: { droneId: string; chatName: string; pending: StoredPendingPrompt }): ChatStoreImportResult {
  if (!(globalThis as any).Bun) throw new Error('pending prompts are owned by PromptQueueRepository');
  if (memoryDroneChatTombstones.has(opts.droneId)) {
    throw new Error(`cannot enqueue prompt for permanently deleted drone: ${opts.droneId}`);
  }
  memoryCancelledPrompts.delete(`${key(opts.droneId, opts.chatName)}\u0000${opts.pending.id}`);
  memoryPromptMap(opts.droneId, opts.chatName).set(opts.pending.id, opts.pending);
  return { available: true, sourceHash: '' };
}
export function updatePendingPromptInStore(opts: { droneId: string; chatName: string; id: string; patch: Partial<StoredPendingPrompt> }): { available: boolean; updated: boolean } {
  if (!(globalThis as any).Bun) throw new Error('pending prompts are owned by PromptQueueRepository');
  const map = memoryPromptMap(opts.droneId, opts.chatName); const current = map.get(opts.id);
  if (!current) return { available: true, updated: false };
  map.set(opts.id, { ...current, ...opts.patch, updatedAt: opts.patch.updatedAt ?? new Date().toISOString() });
  return { available: true, updated: true };
}
export function claimQueuedPendingPromptInStore(opts: { droneId: string; chatName: string; id: string }): { available: boolean; claimed: boolean; state: string | null } {
  const map = memoryPromptMap(opts.droneId, opts.chatName); const current = map.get(opts.id);
  if (!current) return { available: true, claimed: false, state: null };
  if (current.state !== 'queued') return { available: true, claimed: false, state: current.state };
  map.set(opts.id, { ...current, state: 'sending', updatedAt: new Date().toISOString() });
  return { available: true, claimed: true, state: 'sending' };
}
export function cancelQueuedPendingPromptInStore(opts: { droneId: string; chatName: string; id: string }): { available: boolean; cancelled: boolean; state: string | null } {
  const map = memoryPromptMap(opts.droneId, opts.chatName); const current = map.get(opts.id);
  if (!current) return { available: true, cancelled: false, state: null };
  if (current.state !== 'queued') return { available: true, cancelled: false, state: current.state };
  map.delete(opts.id);
  memoryCancelledPrompts.add(`${key(opts.droneId, opts.chatName)}\u0000${opts.id}`);
  return { available: true, cancelled: true, state: 'queued' };
}

export async function resetTranscriptStoreForTests(): Promise<void> {
  const store = repository();
  if (store) await store.clearAllForTests();
  memoryChats.clear(); memoryTurns.clear(); memoryPrompts.clear(); memoryReadStates.clear(); memoryCancelledPrompts.clear();
  memoryChatTombstones.clear(); memoryArchivedChats.clear(); memoryArchivedChatTombstones.clear();
  memoryDroneChatTombstones.clear();
}
