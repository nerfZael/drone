import fs from 'node:fs/promises';
import path from 'node:path';

import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  requireHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from './hub-database';
import {
  removeLegacyAssistantStateFiles,
  resetExternalAssistantData,
} from './assistant-data-reset';
import { droneRootPath } from './paths';

export type StoredAssistantState = {
  defaultModel?: { provider?: string; model?: string; thinkingLevel?: string };
  defaultEnabledTools?: string[];
  threads?: any[];
  webSearchToolMigrationApplied?: boolean;
  fetchContentToolMigrationApplied?: boolean;
  droneHubMcpDefaultOptInMigrationApplied?: boolean;
  askQuestionsDefaultMigrationApplied?: boolean;
  systemPrompt?: string;
  systemPromptUpdatedAt?: string;
  updatedAt?: string;
};

const ASSISTANT_STATE_FILE_NAME = 'assistant.json';
const ASSISTANT_MIGRATION_SCOPE = 'assistant';

function createAssistantSchema(connection: HubDatabaseConnection): void {
  connection.exec(`
        CREATE TABLE assistant_preferences (
          singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
          default_provider TEXT,
          default_model TEXT,
          default_thinking_level TEXT,
          default_enabled_tools_json TEXT,
          web_search_tool_migration_applied INTEGER,
          fetch_content_tool_migration_applied INTEGER,
          drone_hub_mcp_default_opt_in_migration_applied INTEGER,
          ask_questions_default_migration_applied INTEGER,
          system_prompt TEXT,
          system_prompt_updated_at TEXT,
          state_updated_at TEXT
        );

        CREATE TABLE assistant_threads (
          id TEXT NOT NULL PRIMARY KEY,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          title TEXT,
          created_at TEXT,
          updated_at TEXT,
          model TEXT,
          provider TEXT,
          thinking_level TEXT,
          system_prompt TEXT,
          system_prompt_updated_at TEXT,
          enabled_tools_json TEXT,
          access_scope_json TEXT,
          auto_approve INTEGER,
          prompt_delivery_mode TEXT,
          status TEXT,
          error TEXT,
          extra_json TEXT NOT NULL
        );
        CREATE INDEX assistant_threads_ordinal_idx ON assistant_threads (ordinal);

        CREATE TABLE assistant_store_metadata (
          key TEXT NOT NULL PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
  `);
}

export const ASSISTANT_STORE_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'normalized assistant state',
    migrate: createAssistantSchema,
  },
  {
    version: 2,
    name: 'assistant default model',
    migrate() {
      // Kept for compatibility with databases that applied the original
      // migration. The replacement v1 schema already includes these columns.
    },
  },
  {
    version: 3,
    name: 'assistant default reasoning',
    migrate() {
      // Historical migration retained so existing schema history stays valid.
    },
  },
  {
    version: 4,
    name: 'assistant default tools',
    migrate() {
      // Historical migration retained so existing schema history stays valid.
    },
  },
  {
    version: 5,
    name: 'reset assistant state after removing voice modes',
    migrate(connection) {
      connection.exec(`
        DROP TABLE IF EXISTS assistant_messages;
        DROP TABLE IF EXISTS assistant_queued_prompts;
        DROP TABLE IF EXISTS assistant_chat_idle_subscriptions;
        DROP TABLE IF EXISTS assistant_threads;
        DROP TABLE IF EXISTS assistant_preferences;
        DROP TABLE IF EXISTS assistant_store_metadata;
      `);
      createAssistantSchema(connection);
    },
  },
  {
    version: 6,
    name: 'remove external assistant data after voice modes',
    migrate(connection) {
      connection
        .prepare(
          "INSERT INTO assistant_store_metadata (key, value, updated_at) VALUES ('assistant_data_reset_pending', '1', ?)",
        )
        .run(new Date().toISOString());
    },
  },
  {
    version: 7,
    name: 'reset standalone assistant data for native drone chats',
    migrate(connection) {
      connection.exec(`
        DROP TABLE IF EXISTS assistant_messages;
        DROP TABLE IF EXISTS assistant_queued_prompts;
        DROP TABLE IF EXISTS assistant_chat_idle_subscriptions;
        DROP TABLE IF EXISTS assistant_threads;
        DROP TABLE IF EXISTS assistant_preferences;
        DROP TABLE IF EXISTS assistant_store_metadata;
      `);
      createAssistantSchema(connection);
      connection
        .prepare(
          "INSERT INTO assistant_store_metadata (key, value, updated_at) VALUES ('assistant_data_reset_pending', '1', ?)",
        )
        .run(new Date().toISOString());
    },
  },
  {
    version: 8,
    name: 'remove runtime-owned assistant data',
    migrate(connection) {
      connection.exec(`
        DROP TABLE IF EXISTS assistant_messages;
        DROP TABLE IF EXISTS assistant_queued_prompts;
        DROP TABLE IF EXISTS assistant_chat_idle_subscriptions;
      `);
    },
  },
  {
    version: 9,
    name: 'native chat Drone Hub MCP tools are opt-in by default',
    migrate(connection) {
      const columns = connection.prepare('PRAGMA table_info(assistant_preferences)').all() as Array<{
        name?: string;
      }>;
      if (columns.some((column) => column.name === 'drone_hub_mcp_default_opt_in_migration_applied')) return;
      connection.exec(
        'ALTER TABLE assistant_preferences ADD COLUMN drone_hub_mcp_default_opt_in_migration_applied INTEGER',
      );
    },
  },
  {
    version: 10,
    name: 'enable ask questions for native chats',
    migrate(connection) {
      const columns = connection.prepare('PRAGMA table_info(assistant_preferences)').all() as Array<{
        name?: string;
      }>;
      if (columns.some((column) => column.name === 'ask_questions_default_migration_applied'))
        return;
      connection.exec(
        'ALTER TABLE assistant_preferences ADD COLUMN ask_questions_default_migration_applied INTEGER',
      );
    },
  },
];

type PreferenceRow = {
  default_provider: string | null;
  default_model: string | null;
  default_thinking_level: string | null;
  default_enabled_tools_json: string | null;
  web_search_tool_migration_applied: number | null;
  fetch_content_tool_migration_applied: number | null;
  drone_hub_mcp_default_opt_in_migration_applied: number | null;
  ask_questions_default_migration_applied: number | null;
  system_prompt: string | null;
  system_prompt_updated_at: string | null;
  state_updated_at: string | null;
};

type ThreadRow = {
  id: string;
  ordinal: number;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
  model: string | null;
  provider: string | null;
  thinking_level: string | null;
  system_prompt: string | null;
  system_prompt_updated_at: string | null;
  enabled_tools_json: string | null;
  access_scope_json: string | null;
  auto_approve: number | null;
  prompt_delivery_mode: string | null;
  status: string | null;
  error: string | null;
  extra_json: string;
};

const initializationByDatabasePath = new Map<string, Promise<void>>();
let bunCompatibilityWriteQueue: Promise<void> = Promise.resolve();

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalBoolean(value: unknown): number | null {
  return typeof value === 'boolean' ? (value ? 1 : 0) : null;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function extraJson(value: Record<string, unknown>, knownKeys: readonly string[]): string {
  const extra = { ...value };
  for (const key of knownKeys) delete extra[key];
  return json(extra);
}

function parseJson(value: string | null): any {
  return value == null ? undefined : JSON.parse(value);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function ensureAssistantSchema(connection: HubDatabaseConnection): void {
  applyHubDatabaseMigrations(connection, ASSISTANT_STORE_MIGRATIONS, ASSISTANT_MIGRATION_SCOPE);
}

function ids(values: any[]): Set<string> {
  return new Set(
    values
      .map((value) => (value && typeof value === 'object' ? String(value.id ?? '').trim() : ''))
      .filter(Boolean),
  );
}

function deleteMissingRows(
  connection: HubDatabaseConnection,
  table: string,
  existingIds: string[],
  desiredIds: Set<string>,
): void {
  const remove = connection.prepare(`DELETE FROM ${table} WHERE id = ?`);
  for (const id of existingIds) {
    if (!desiredIds.has(id)) remove.run(id);
  }
}

function writeStateRows(connection: HubDatabaseConnection, state: StoredAssistantState): void {
  connection
    .prepare(
      `
    INSERT INTO assistant_preferences (
      singleton, default_provider, default_model, default_thinking_level, default_enabled_tools_json,
      web_search_tool_migration_applied,
      fetch_content_tool_migration_applied, drone_hub_mcp_default_opt_in_migration_applied,
      ask_questions_default_migration_applied,
      system_prompt, system_prompt_updated_at,
      state_updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      default_provider = excluded.default_provider,
      default_model = excluded.default_model,
      default_thinking_level = excluded.default_thinking_level,
      default_enabled_tools_json = excluded.default_enabled_tools_json,
      web_search_tool_migration_applied = excluded.web_search_tool_migration_applied,
      fetch_content_tool_migration_applied = excluded.fetch_content_tool_migration_applied,
      drone_hub_mcp_default_opt_in_migration_applied = excluded.drone_hub_mcp_default_opt_in_migration_applied,
      ask_questions_default_migration_applied = excluded.ask_questions_default_migration_applied,
      system_prompt = excluded.system_prompt,
      system_prompt_updated_at = excluded.system_prompt_updated_at,
      state_updated_at = excluded.state_updated_at
    WHERE default_provider IS NOT excluded.default_provider
       OR default_model IS NOT excluded.default_model
       OR default_thinking_level IS NOT excluded.default_thinking_level
       OR default_enabled_tools_json IS NOT excluded.default_enabled_tools_json
       OR web_search_tool_migration_applied IS NOT excluded.web_search_tool_migration_applied
       OR fetch_content_tool_migration_applied IS NOT excluded.fetch_content_tool_migration_applied
       OR drone_hub_mcp_default_opt_in_migration_applied IS NOT excluded.drone_hub_mcp_default_opt_in_migration_applied
       OR ask_questions_default_migration_applied IS NOT excluded.ask_questions_default_migration_applied
       OR system_prompt IS NOT excluded.system_prompt
       OR system_prompt_updated_at IS NOT excluded.system_prompt_updated_at
       OR state_updated_at IS NOT excluded.state_updated_at
  `,
    )
    .run(
      optionalText(state.defaultModel?.provider),
      optionalText(state.defaultModel?.model),
      optionalText(state.defaultModel?.thinkingLevel),
      Array.isArray(state.defaultEnabledTools) ? json(state.defaultEnabledTools) : null,
      optionalBoolean(state.webSearchToolMigrationApplied),
      optionalBoolean(state.fetchContentToolMigrationApplied),
      optionalBoolean(state.droneHubMcpDefaultOptInMigrationApplied),
      optionalBoolean(state.askQuestionsDefaultMigrationApplied),
      optionalText(state.systemPrompt),
      optionalText(state.systemPromptUpdatedAt),
      optionalText(state.updatedAt),
    );

  const threads = Array.isArray(state.threads) ? state.threads : [];
  const existingThreadIds = (
    connection.prepare('SELECT id FROM assistant_threads').all() as Array<{ id: string }>
  ).map((row) => row.id);
  const upsertThread = connection.prepare(`
    INSERT INTO assistant_threads (
      id, ordinal, title, created_at, updated_at,
      model, provider, thinking_level, system_prompt, system_prompt_updated_at,
      enabled_tools_json, access_scope_json, auto_approve, prompt_delivery_mode,
      status, error, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ordinal = excluded.ordinal, title = excluded.title, created_at = excluded.created_at,
      updated_at = excluded.updated_at, model = excluded.model,
      provider = excluded.provider, thinking_level = excluded.thinking_level,
      system_prompt = excluded.system_prompt,
      system_prompt_updated_at = excluded.system_prompt_updated_at,
      enabled_tools_json = excluded.enabled_tools_json,
      access_scope_json = excluded.access_scope_json, auto_approve = excluded.auto_approve,
      prompt_delivery_mode = excluded.prompt_delivery_mode, status = excluded.status,
      error = excluded.error, extra_json = excluded.extra_json
    WHERE ordinal IS NOT excluded.ordinal OR title IS NOT excluded.title
       OR created_at IS NOT excluded.created_at OR updated_at IS NOT excluded.updated_at
       OR model IS NOT excluded.model OR provider IS NOT excluded.provider
       OR thinking_level IS NOT excluded.thinking_level OR system_prompt IS NOT excluded.system_prompt
       OR system_prompt_updated_at IS NOT excluded.system_prompt_updated_at
       OR enabled_tools_json IS NOT excluded.enabled_tools_json
       OR access_scope_json IS NOT excluded.access_scope_json OR auto_approve IS NOT excluded.auto_approve
       OR prompt_delivery_mode IS NOT excluded.prompt_delivery_mode OR status IS NOT excluded.status
       OR error IS NOT excluded.error OR extra_json IS NOT excluded.extra_json
  `);
  for (const [ordinal, thread] of threads.entries()) {
    if (!thread || typeof thread !== 'object') continue;
    const id = String(thread.id ?? '').trim();
    if (!id) continue;
    upsertThread.run(
      id,
      ordinal,
      optionalText(thread.title),
      optionalText(thread.createdAt),
      optionalText(thread.updatedAt),
      optionalText(thread.model),
      optionalText(thread.provider),
      optionalText(thread.thinkingLevel),
      optionalText(thread.systemPrompt),
      optionalText(thread.systemPromptUpdatedAt),
      json(thread.enabledTools),
      json(thread.accessScope),
      optionalBoolean(thread.autoApprove),
      optionalText(thread.promptDeliveryMode),
      optionalText(thread.status),
      optionalText(thread.error),
      extraJson(thread, [
        'id',
        'title',
        'createdAt',
        'updatedAt',
        'model',
        'provider',
        'thinkingLevel',
        'systemPrompt',
        'systemPromptUpdatedAt',
        'enabledTools',
        'accessScope',
        'autoApprove',
        'promptDeliveryMode',
        'status',
        'error',
      ]),
    );
  }
  deleteMissingRows(connection, 'assistant_threads', existingThreadIds, ids(threads));

}

function readStateRows(connection: HubDatabaseConnection): StoredAssistantState | null {
  const preferences = connection
    .prepare('SELECT * FROM assistant_preferences WHERE singleton = 1')
    .get() as PreferenceRow | undefined;
  if (!preferences) return null;

  const threadRows = connection
    .prepare('SELECT * FROM assistant_threads ORDER BY ordinal')
    .all() as ThreadRow[];
  const threads = threadRows.map((row) =>
    removeUndefined({
      ...JSON.parse(row.extra_json),
      id: row.id,
      title: row.title ?? undefined,
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined,
      model: row.model ?? undefined,
      provider: row.provider ?? undefined,
      thinkingLevel: row.thinking_level ?? undefined,
      systemPrompt: row.system_prompt ?? undefined,
      systemPromptUpdatedAt: row.system_prompt_updated_at ?? undefined,
      enabledTools: parseJson(row.enabled_tools_json),
      accessScope: parseJson(row.access_scope_json),
      autoApprove: row.auto_approve == null ? undefined : row.auto_approve === 1,
      promptDeliveryMode: row.prompt_delivery_mode ?? undefined,
      status: row.status ?? undefined,
      error: row.error,
    }),
  );

  return removeUndefined({
    ...(preferences.default_provider || preferences.default_model
      ? {
          defaultModel: {
            provider: preferences.default_provider ?? undefined,
            model: preferences.default_model ?? undefined,
            thinkingLevel: preferences.default_thinking_level ?? undefined,
          },
        }
      : {}),
    defaultEnabledTools: parseJson(preferences.default_enabled_tools_json),
    threads,
    webSearchToolMigrationApplied:
      preferences.web_search_tool_migration_applied == null
        ? undefined
        : preferences.web_search_tool_migration_applied === 1,
    fetchContentToolMigrationApplied:
      preferences.fetch_content_tool_migration_applied == null
        ? undefined
        : preferences.fetch_content_tool_migration_applied === 1,
    droneHubMcpDefaultOptInMigrationApplied:
      preferences.drone_hub_mcp_default_opt_in_migration_applied == null
        ? undefined
        : preferences.drone_hub_mcp_default_opt_in_migration_applied === 1,
    askQuestionsDefaultMigrationApplied:
      preferences.ask_questions_default_migration_applied == null
        ? undefined
        : preferences.ask_questions_default_migration_applied === 1,
    systemPrompt: preferences.system_prompt ?? undefined,
    systemPromptUpdatedAt: preferences.system_prompt_updated_at ?? undefined,
    updatedAt: preferences.state_updated_at ?? undefined,
  });
}

function assistantStatePath(): string {
  return droneRootPath(ASSISTANT_STATE_FILE_NAME);
}

async function initializeStore(database: HubDatabase): Promise<void> {
  database.read(ensureAssistantSchema);
  const resetPending = database.read((connection) =>
    Boolean(
      connection
        .prepare(
          "SELECT 1 AS found FROM assistant_store_metadata WHERE key = 'assistant_data_reset_pending'",
        )
        .get(),
    ),
  );
  if (resetPending) {
    await resetExternalAssistantData();
    await database.writeTransaction('complete assistant data reset', (connection) => {
      connection
        .prepare("DELETE FROM assistant_store_metadata WHERE key = 'assistant_data_reset_pending'")
        .run();
    });
  } else {
    await removeLegacyAssistantStateFiles();
  }
}

async function ensureInitialized(database: HubDatabase): Promise<void> {
  const databasePath = database.path;
  let initialization = initializationByDatabasePath.get(databasePath);
  if (!initialization) {
    initialization = initializeStore(database).catch((error) => {
      initializationByDatabasePath.delete(databasePath);
      throw error;
    });
    initializationByDatabasePath.set(databasePath, initialization);
  }
  await initialization;
}

function bunCompatibilityBackendAvailable(): boolean {
  return typeof (globalThis as any).Bun !== 'undefined';
}

async function loadBunCompatibilityState(): Promise<StoredAssistantState | null> {
  const filePath = assistantStatePath();
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as StoredAssistantState) : null;
  } catch (error: any) {
    if (String(error?.code ?? '') === 'ENOENT') return null;
    throw error;
  }
}

async function writeBunCompatibilityState(
  filePath: string,
  serializedState: string,
): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.assistant.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, serializedState, 'utf8');
    await fs.chmod(temporaryPath, 0o600).catch(() => {});
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function saveBunCompatibilityState(state: StoredAssistantState): Promise<void> {
  const filePath = assistantStatePath();
  const serializedState = `${JSON.stringify(state, null, 2)}\n`;
  const write = bunCompatibilityWriteQueue
    .catch(() => {})
    .then(() => writeBunCompatibilityState(filePath, serializedState));
  bunCompatibilityWriteQueue = write;
  await write;
}

export async function loadAssistantState(): Promise<StoredAssistantState | null> {
  let database = getHubDatabase();
  if (!database) {
    if (bunCompatibilityBackendAvailable()) return await loadBunCompatibilityState();
    database = requireHubDatabase();
  }
  await ensureInitialized(database);
  return database.read(readStateRows);
}

export async function saveAssistantState(state: StoredAssistantState): Promise<void> {
  let database = getHubDatabase();
  if (!database) {
    if (bunCompatibilityBackendAvailable()) return await saveBunCompatibilityState(state);
    database = requireHubDatabase();
  }
  await ensureInitialized(database);
  await database.writeTransaction('persist assistant state', (connection) => {
    writeStateRows(connection, state);
  });
}

export function resetAssistantStoreForTests(): void {
  initializationByDatabasePath.clear();
  bunCompatibilityWriteQueue = Promise.resolve();
}
