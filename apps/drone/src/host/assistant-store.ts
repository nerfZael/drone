import crypto from 'node:crypto';
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
import { droneRootPath } from './paths';

export type StoredAssistantState = {
  activeThreadId?: string | null;
  defaultModel?: { provider?: string; model?: string; thinkingLevel?: string };
  defaultEnabledTools?: string[];
  threads?: any[];
  chatIdleSubscriptions?: any[];
  webSearchToolMigrationApplied?: boolean;
  fetchContentToolMigrationApplied?: boolean;
  systemPrompt?: string;
  systemPromptUpdatedAt?: string;
  voiceSystemPrompt?: string;
  voiceSystemPromptUpdatedAt?: string;
  updatedAt?: string;
};

const ASSISTANT_STATE_FILE_NAME = 'assistant.json';
const ASSISTANT_MIGRATION_SCOPE = 'assistant';

export const ASSISTANT_STORE_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'normalized assistant state',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE assistant_preferences (
          singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
          active_thread_id TEXT,
          web_search_tool_migration_applied INTEGER,
          fetch_content_tool_migration_applied INTEGER,
          system_prompt TEXT,
          system_prompt_updated_at TEXT,
          voice_system_prompt TEXT,
          voice_system_prompt_updated_at TEXT,
          state_updated_at TEXT
        );

        CREATE TABLE assistant_threads (
          id TEXT NOT NULL PRIMARY KEY,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          title TEXT,
          created_at TEXT,
          updated_at TEXT,
          voice_enabled INTEGER,
          voice_enabled_at TEXT,
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

        CREATE TABLE assistant_messages (
          thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          message_json TEXT NOT NULL,
          PRIMARY KEY (thread_id, ordinal)
        );

        CREATE TABLE assistant_queued_prompts (
          id TEXT NOT NULL PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          prompt TEXT,
          attachments_json TEXT,
          prompt_images_json TEXT,
          created_at TEXT,
          provider TEXT,
          model TEXT,
          thinking_level TEXT,
          delivery_mode TEXT,
          voice_source TEXT,
          extra_json TEXT NOT NULL
        );
        CREATE INDEX assistant_queued_prompts_thread_ordinal_idx
          ON assistant_queued_prompts (thread_id, ordinal);

        CREATE TABLE assistant_chat_idle_subscriptions (
          id TEXT NOT NULL PRIMARY KEY,
          ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
          thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
          tool_call_id TEXT,
          voice_source TEXT,
          mode TEXT,
          targets_json TEXT NOT NULL,
          created_at TEXT,
          expires_at TEXT,
          idle_for_ms INTEGER,
          status TEXT,
          idle_since TEXT,
          fired_at TEXT,
          cancelled_at TEXT,
          expired_at TEXT,
          last_result_json TEXT,
          extra_json TEXT NOT NULL
        );
        CREATE INDEX assistant_chat_idle_subscriptions_ordinal_idx
          ON assistant_chat_idle_subscriptions (ordinal);

        CREATE TABLE assistant_store_metadata (
          key TEXT NOT NULL PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'assistant default model',
    migrate(connection) {
      connection.exec(`
        ALTER TABLE assistant_preferences ADD COLUMN default_provider TEXT;
        ALTER TABLE assistant_preferences ADD COLUMN default_model TEXT;
      `);
    },
  },
  {
    version: 3,
    name: 'assistant default reasoning',
    migrate(connection) {
      connection.exec('ALTER TABLE assistant_preferences ADD COLUMN default_thinking_level TEXT;');
    },
  },
  {
    version: 4,
    name: 'assistant default tools',
    migrate(connection) {
      connection.exec('ALTER TABLE assistant_preferences ADD COLUMN default_enabled_tools_json TEXT;');
    },
  },
];

type PreferenceRow = {
  active_thread_id: string | null;
  default_provider: string | null;
  default_model: string | null;
  default_thinking_level: string | null;
  default_enabled_tools_json: string | null;
  web_search_tool_migration_applied: number | null;
  fetch_content_tool_migration_applied: number | null;
  system_prompt: string | null;
  system_prompt_updated_at: string | null;
  voice_system_prompt: string | null;
  voice_system_prompt_updated_at: string | null;
  state_updated_at: string | null;
};

type ThreadRow = {
  id: string;
  ordinal: number;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
  voice_enabled: number | null;
  voice_enabled_at: string | null;
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

type MessageRow = { thread_id: string; ordinal: number; message_json: string };
type QueuedPromptRow = {
  id: string;
  thread_id: string;
  ordinal: number;
  prompt: string | null;
  attachments_json: string | null;
  prompt_images_json: string | null;
  created_at: string | null;
  provider: string | null;
  model: string | null;
  thinking_level: string | null;
  delivery_mode: string | null;
  voice_source: string | null;
  extra_json: string;
};
type SubscriptionRow = {
  id: string;
  ordinal: number;
  thread_id: string;
  tool_call_id: string | null;
  voice_source: string | null;
  mode: string | null;
  targets_json: string;
  created_at: string | null;
  expires_at: string | null;
  idle_for_ms: number | null;
  status: string | null;
  idle_since: string | null;
  fired_at: string | null;
  cancelled_at: string | null;
  expired_at: string | null;
  last_result_json: string | null;
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

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
      singleton, active_thread_id, default_provider, default_model, default_thinking_level, default_enabled_tools_json,
      web_search_tool_migration_applied,
      fetch_content_tool_migration_applied, system_prompt, system_prompt_updated_at,
      voice_system_prompt, voice_system_prompt_updated_at, state_updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      active_thread_id = excluded.active_thread_id,
      default_provider = excluded.default_provider,
      default_model = excluded.default_model,
      default_thinking_level = excluded.default_thinking_level,
      default_enabled_tools_json = excluded.default_enabled_tools_json,
      web_search_tool_migration_applied = excluded.web_search_tool_migration_applied,
      fetch_content_tool_migration_applied = excluded.fetch_content_tool_migration_applied,
      system_prompt = excluded.system_prompt,
      system_prompt_updated_at = excluded.system_prompt_updated_at,
      voice_system_prompt = excluded.voice_system_prompt,
      voice_system_prompt_updated_at = excluded.voice_system_prompt_updated_at,
      state_updated_at = excluded.state_updated_at
    WHERE active_thread_id IS NOT excluded.active_thread_id
       OR default_provider IS NOT excluded.default_provider
       OR default_model IS NOT excluded.default_model
       OR default_thinking_level IS NOT excluded.default_thinking_level
       OR default_enabled_tools_json IS NOT excluded.default_enabled_tools_json
       OR web_search_tool_migration_applied IS NOT excluded.web_search_tool_migration_applied
       OR fetch_content_tool_migration_applied IS NOT excluded.fetch_content_tool_migration_applied
       OR system_prompt IS NOT excluded.system_prompt
       OR system_prompt_updated_at IS NOT excluded.system_prompt_updated_at
       OR voice_system_prompt IS NOT excluded.voice_system_prompt
       OR voice_system_prompt_updated_at IS NOT excluded.voice_system_prompt_updated_at
       OR state_updated_at IS NOT excluded.state_updated_at
  `,
    )
    .run(
      optionalText(state.activeThreadId),
      optionalText(state.defaultModel?.provider),
      optionalText(state.defaultModel?.model),
      optionalText(state.defaultModel?.thinkingLevel),
      Array.isArray(state.defaultEnabledTools) ? json(state.defaultEnabledTools) : null,
      optionalBoolean(state.webSearchToolMigrationApplied),
      optionalBoolean(state.fetchContentToolMigrationApplied),
      optionalText(state.systemPrompt),
      optionalText(state.systemPromptUpdatedAt),
      optionalText(state.voiceSystemPrompt),
      optionalText(state.voiceSystemPromptUpdatedAt),
      optionalText(state.updatedAt),
    );

  const threads = Array.isArray(state.threads) ? state.threads : [];
  const existingThreadIds = (
    connection.prepare('SELECT id FROM assistant_threads').all() as Array<{ id: string }>
  ).map((row) => row.id);
  const upsertThread = connection.prepare(`
    INSERT INTO assistant_threads (
      id, ordinal, title, created_at, updated_at, voice_enabled, voice_enabled_at,
      model, provider, thinking_level, system_prompt, system_prompt_updated_at,
      enabled_tools_json, access_scope_json, auto_approve, prompt_delivery_mode,
      status, error, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ordinal = excluded.ordinal, title = excluded.title, created_at = excluded.created_at,
      updated_at = excluded.updated_at, voice_enabled = excluded.voice_enabled,
      voice_enabled_at = excluded.voice_enabled_at, model = excluded.model,
      provider = excluded.provider, thinking_level = excluded.thinking_level,
      system_prompt = excluded.system_prompt,
      system_prompt_updated_at = excluded.system_prompt_updated_at,
      enabled_tools_json = excluded.enabled_tools_json,
      access_scope_json = excluded.access_scope_json, auto_approve = excluded.auto_approve,
      prompt_delivery_mode = excluded.prompt_delivery_mode, status = excluded.status,
      error = excluded.error, extra_json = excluded.extra_json
    WHERE ordinal IS NOT excluded.ordinal OR title IS NOT excluded.title
       OR created_at IS NOT excluded.created_at OR updated_at IS NOT excluded.updated_at
       OR voice_enabled IS NOT excluded.voice_enabled OR voice_enabled_at IS NOT excluded.voice_enabled_at
       OR model IS NOT excluded.model OR provider IS NOT excluded.provider
       OR thinking_level IS NOT excluded.thinking_level OR system_prompt IS NOT excluded.system_prompt
       OR system_prompt_updated_at IS NOT excluded.system_prompt_updated_at
       OR enabled_tools_json IS NOT excluded.enabled_tools_json
       OR access_scope_json IS NOT excluded.access_scope_json OR auto_approve IS NOT excluded.auto_approve
       OR prompt_delivery_mode IS NOT excluded.prompt_delivery_mode OR status IS NOT excluded.status
       OR error IS NOT excluded.error OR extra_json IS NOT excluded.extra_json
  `);
  const upsertMessage = connection.prepare(`
    INSERT INTO assistant_messages (thread_id, ordinal, message_json) VALUES (?, ?, ?)
    ON CONFLICT(thread_id, ordinal) DO UPDATE SET message_json = excluded.message_json
    WHERE message_json IS NOT excluded.message_json
  `);
  const upsertQueuedPrompt = connection.prepare(`
    INSERT INTO assistant_queued_prompts (
      id, thread_id, ordinal, prompt, attachments_json, prompt_images_json, created_at,
      provider, model, thinking_level, delivery_mode, voice_source, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      thread_id = excluded.thread_id, ordinal = excluded.ordinal, prompt = excluded.prompt,
      attachments_json = excluded.attachments_json, prompt_images_json = excluded.prompt_images_json,
      created_at = excluded.created_at, provider = excluded.provider, model = excluded.model,
      thinking_level = excluded.thinking_level, delivery_mode = excluded.delivery_mode,
      voice_source = excluded.voice_source, extra_json = excluded.extra_json
    WHERE thread_id IS NOT excluded.thread_id OR ordinal IS NOT excluded.ordinal
       OR prompt IS NOT excluded.prompt OR attachments_json IS NOT excluded.attachments_json
       OR prompt_images_json IS NOT excluded.prompt_images_json OR created_at IS NOT excluded.created_at
       OR provider IS NOT excluded.provider OR model IS NOT excluded.model
       OR thinking_level IS NOT excluded.thinking_level OR delivery_mode IS NOT excluded.delivery_mode
       OR voice_source IS NOT excluded.voice_source OR extra_json IS NOT excluded.extra_json
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
      optionalBoolean(thread.voiceEnabled),
      optionalText(thread.voiceEnabledAt),
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
        'voiceEnabled',
        'voiceEnabledAt',
        'model',
        'provider',
        'thinkingLevel',
        'systemPrompt',
        'systemPromptUpdatedAt',
        'enabledTools',
        'accessScope',
        'autoApprove',
        'promptDeliveryMode',
        'messageCount',
        'messages',
        'queuedPrompts',
        'status',
        'error',
      ]),
    );

    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    for (const [messageOrdinal, message] of messages.entries()) {
      upsertMessage.run(id, messageOrdinal, json(message));
    }
    connection
      .prepare('DELETE FROM assistant_messages WHERE thread_id = ? AND ordinal >= ?')
      .run(id, messages.length);

    const queuedPrompts = Array.isArray(thread.queuedPrompts) ? thread.queuedPrompts : [];
    const existingQueuedIds = (
      connection
        .prepare('SELECT id FROM assistant_queued_prompts WHERE thread_id = ?')
        .all(id) as Array<{ id: string }>
    ).map((row) => row.id);
    for (const [promptOrdinal, prompt] of queuedPrompts.entries()) {
      if (!prompt || typeof prompt !== 'object') continue;
      const promptId = String(prompt.id ?? '').trim();
      if (!promptId) continue;
      upsertQueuedPrompt.run(
        promptId,
        id,
        promptOrdinal,
        optionalText(prompt.prompt),
        prompt.attachments === undefined ? null : json(prompt.attachments),
        prompt.promptImages === undefined ? null : json(prompt.promptImages),
        optionalText(prompt.createdAt),
        optionalText(prompt.provider),
        optionalText(prompt.model),
        optionalText(prompt.thinkingLevel),
        optionalText(prompt.deliveryMode),
        optionalText(prompt.voiceSource),
        extraJson(prompt, [
          'id',
          'prompt',
          'attachments',
          'promptImages',
          'createdAt',
          'provider',
          'model',
          'thinkingLevel',
          'deliveryMode',
          'voiceSource',
        ]),
      );
    }
    deleteMissingRows(
      connection,
      'assistant_queued_prompts',
      existingQueuedIds,
      ids(queuedPrompts),
    );
  }
  deleteMissingRows(connection, 'assistant_threads', existingThreadIds, ids(threads));

  const subscriptions = Array.isArray(state.chatIdleSubscriptions)
    ? state.chatIdleSubscriptions
    : [];
  const existingSubscriptionIds = (
    connection.prepare('SELECT id FROM assistant_chat_idle_subscriptions').all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
  const upsertSubscription = connection.prepare(`
    INSERT INTO assistant_chat_idle_subscriptions (
      id, ordinal, thread_id, tool_call_id, voice_source, mode, targets_json,
      created_at, expires_at, idle_for_ms, status, idle_since, fired_at,
      cancelled_at, expired_at, last_result_json, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ordinal = excluded.ordinal, thread_id = excluded.thread_id,
      tool_call_id = excluded.tool_call_id, voice_source = excluded.voice_source,
      mode = excluded.mode, targets_json = excluded.targets_json,
      created_at = excluded.created_at, expires_at = excluded.expires_at,
      idle_for_ms = excluded.idle_for_ms, status = excluded.status,
      idle_since = excluded.idle_since, fired_at = excluded.fired_at,
      cancelled_at = excluded.cancelled_at, expired_at = excluded.expired_at,
      last_result_json = excluded.last_result_json, extra_json = excluded.extra_json
    WHERE ordinal IS NOT excluded.ordinal OR thread_id IS NOT excluded.thread_id
       OR tool_call_id IS NOT excluded.tool_call_id OR voice_source IS NOT excluded.voice_source
       OR mode IS NOT excluded.mode OR targets_json IS NOT excluded.targets_json
       OR created_at IS NOT excluded.created_at OR expires_at IS NOT excluded.expires_at
       OR idle_for_ms IS NOT excluded.idle_for_ms OR status IS NOT excluded.status
       OR idle_since IS NOT excluded.idle_since OR fired_at IS NOT excluded.fired_at
       OR cancelled_at IS NOT excluded.cancelled_at OR expired_at IS NOT excluded.expired_at
       OR last_result_json IS NOT excluded.last_result_json OR extra_json IS NOT excluded.extra_json
  `);
  for (const [ordinal, subscription] of subscriptions.entries()) {
    if (!subscription || typeof subscription !== 'object') continue;
    const id = String(subscription.id ?? '').trim();
    const threadId = String(subscription.threadId ?? '').trim();
    if (!id || !threadId) continue;
    upsertSubscription.run(
      id,
      ordinal,
      threadId,
      optionalText(subscription.toolCallId),
      optionalText(subscription.voiceSource),
      optionalText(subscription.mode),
      json(subscription.targets),
      optionalText(subscription.createdAt),
      optionalText(subscription.expiresAt),
      optionalNumber(subscription.idleForMs),
      optionalText(subscription.status),
      optionalText(subscription.idleSince),
      optionalText(subscription.firedAt),
      optionalText(subscription.cancelledAt),
      optionalText(subscription.expiredAt),
      subscription.lastResult == null ? null : json(subscription.lastResult),
      extraJson(subscription, [
        'id',
        'threadId',
        'toolCallId',
        'voiceSource',
        'mode',
        'targets',
        'createdAt',
        'expiresAt',
        'idleForMs',
        'status',
        'idleSince',
        'firedAt',
        'cancelledAt',
        'expiredAt',
        'lastResult',
      ]),
    );
  }
  deleteMissingRows(
    connection,
    'assistant_chat_idle_subscriptions',
    existingSubscriptionIds,
    ids(subscriptions),
  );
}

function readStateRows(connection: HubDatabaseConnection): StoredAssistantState | null {
  const preferences = connection
    .prepare('SELECT * FROM assistant_preferences WHERE singleton = 1')
    .get() as PreferenceRow | undefined;
  if (!preferences) return null;

  const threadRows = connection
    .prepare('SELECT * FROM assistant_threads ORDER BY ordinal')
    .all() as ThreadRow[];
  const messages = connection
    .prepare('SELECT * FROM assistant_messages ORDER BY thread_id, ordinal')
    .all() as MessageRow[];
  const queuedPrompts = connection
    .prepare('SELECT * FROM assistant_queued_prompts ORDER BY thread_id, ordinal')
    .all() as QueuedPromptRow[];
  const messagesByThread = new Map<string, any[]>();
  for (const row of messages) {
    const list = messagesByThread.get(row.thread_id) ?? [];
    list.push(JSON.parse(row.message_json));
    messagesByThread.set(row.thread_id, list);
  }
  const promptsByThread = new Map<string, any[]>();
  for (const row of queuedPrompts) {
    const list = promptsByThread.get(row.thread_id) ?? [];
    list.push(
      removeUndefined({
        ...JSON.parse(row.extra_json),
        id: row.id,
        prompt: row.prompt ?? undefined,
        attachments: parseJson(row.attachments_json),
        promptImages: parseJson(row.prompt_images_json),
        createdAt: row.created_at ?? undefined,
        provider: row.provider ?? undefined,
        model: row.model ?? undefined,
        thinkingLevel: row.thinking_level ?? undefined,
        deliveryMode: row.delivery_mode ?? undefined,
        voiceSource: row.voice_source ?? undefined,
      }),
    );
    promptsByThread.set(row.thread_id, list);
  }
  const threads = threadRows.map((row) =>
    removeUndefined({
      ...JSON.parse(row.extra_json),
      id: row.id,
      title: row.title ?? undefined,
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined,
      voiceEnabled: row.voice_enabled == null ? undefined : row.voice_enabled === 1,
      voiceEnabledAt: row.voice_enabled_at ?? undefined,
      model: row.model ?? undefined,
      provider: row.provider ?? undefined,
      thinkingLevel: row.thinking_level ?? undefined,
      systemPrompt: row.system_prompt ?? undefined,
      systemPromptUpdatedAt: row.system_prompt_updated_at ?? undefined,
      enabledTools: parseJson(row.enabled_tools_json),
      accessScope: parseJson(row.access_scope_json),
      autoApprove: row.auto_approve == null ? undefined : row.auto_approve === 1,
      promptDeliveryMode: row.prompt_delivery_mode ?? undefined,
      messages: messagesByThread.get(row.id) ?? [],
      queuedPrompts: promptsByThread.get(row.id) ?? [],
      status: row.status ?? undefined,
      error: row.error,
    }),
  );

  const subscriptionRows = connection
    .prepare('SELECT * FROM assistant_chat_idle_subscriptions ORDER BY ordinal')
    .all() as SubscriptionRow[];
  const subscriptions = subscriptionRows.map((row) =>
    removeUndefined({
      ...JSON.parse(row.extra_json),
      id: row.id,
      threadId: row.thread_id,
      toolCallId: row.tool_call_id,
      voiceSource: row.voice_source,
      mode: row.mode ?? undefined,
      targets: JSON.parse(row.targets_json),
      createdAt: row.created_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      idleForMs: row.idle_for_ms ?? undefined,
      status: row.status ?? undefined,
      idleSince: row.idle_since,
      firedAt: row.fired_at,
      cancelledAt: row.cancelled_at,
      expiredAt: row.expired_at,
      lastResult: row.last_result_json == null ? null : JSON.parse(row.last_result_json),
    }),
  );

  return removeUndefined({
    activeThreadId: preferences.active_thread_id,
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
    ...(subscriptions.length > 0 ? { chatIdleSubscriptions: subscriptions } : {}),
    webSearchToolMigrationApplied:
      preferences.web_search_tool_migration_applied == null
        ? undefined
        : preferences.web_search_tool_migration_applied === 1,
    fetchContentToolMigrationApplied:
      preferences.fetch_content_tool_migration_applied == null
        ? undefined
        : preferences.fetch_content_tool_migration_applied === 1,
    systemPrompt: preferences.system_prompt ?? undefined,
    systemPromptUpdatedAt: preferences.system_prompt_updated_at ?? undefined,
    voiceSystemPrompt: preferences.voice_system_prompt ?? undefined,
    voiceSystemPromptUpdatedAt: preferences.voice_system_prompt_updated_at ?? undefined,
    updatedAt: preferences.state_updated_at ?? undefined,
  });
}

function assistantStatePath(): string {
  return droneRootPath(ASSISTANT_STATE_FILE_NAME);
}

async function readLegacyState(): Promise<{
  state: StoredAssistantState;
  sha256: string;
} | null> {
  try {
    const bytes = await fs.readFile(assistantStatePath());
    const parsed = JSON.parse(bytes.toString('utf8'));
    return parsed && typeof parsed === 'object'
      ? {
          state: parsed as StoredAssistantState,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        }
      : null;
  } catch (error: any) {
    if (String(error?.code ?? '') === 'ENOENT') return null;
    throw error;
  }
}

async function archiveLegacyState(): Promise<string | null> {
  const source = assistantStatePath();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (let attempt = 0; ; attempt += 1) {
    const suffix = attempt === 0 ? stamp : `${stamp}-${attempt}`;
    const destination = `${source}.migrated-${suffix}.bak`;
    try {
      await fs.rename(source, destination);
      return destination;
    } catch (error: any) {
      const code = String(error?.code ?? '');
      if (code === 'ENOENT') return null;
      if (code === 'EEXIST') continue;
      throw error;
    }
  }
}

async function initializeStore(database: HubDatabase): Promise<void> {
  database.read(ensureAssistantSchema);
  const canonicalExists = database.read(
    (connection) =>
      connection
        .prepare('SELECT 1 AS found FROM assistant_preferences WHERE singleton = 1')
        .get() !== undefined,
  );
  if (!canonicalExists) {
    const legacy = await readLegacyState();
    if (legacy) {
      await database.writeTransaction('migrate assistant.json', (connection) => {
        const alreadyImported = connection
          .prepare('SELECT 1 AS found FROM assistant_preferences WHERE singleton = 1')
          .get();
        if (alreadyImported) return;
        writeStateRows(connection, legacy.state);
        connection
          .prepare(
            "INSERT OR REPLACE INTO assistant_store_metadata (key, value, updated_at) VALUES ('legacy_import', ?, ?)",
          )
          .run(
            JSON.stringify({ path: assistantStatePath(), sha256: legacy.sha256 }),
            new Date().toISOString(),
          );
      });
    }
  }

  const backupPath = await archiveLegacyState();
  if (backupPath) {
    await database.writeTransaction('record assistant.json backup', (connection) => {
      connection
        .prepare(
          "INSERT OR REPLACE INTO assistant_store_metadata (key, value, updated_at) VALUES ('legacy_backup', ?, ?)",
        )
        .run(backupPath, new Date().toISOString());
    });
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
