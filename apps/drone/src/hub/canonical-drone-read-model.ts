import { getHubDatabase, type HubDatabaseConnection } from '../host/hub-database';

type LifecycleRow = {
  drone_id: string;
  name: string;
  container_name: string | null;
  runtime_kind: string;
  phase: string | null;
  lifecycle_json: string;
};

type ChatRow = {
  drone_id: string;
  chat_name: string;
  metadata_json: string;
};

type TurnRow = {
  drone_id: string;
  chat_name: string;
  turn_json: string;
};

type PromptRow = {
  drone_id: string;
  chat_name: string;
  prompt_id: string;
  created_at: string;
  updated_at: string;
  state: string;
  prompt: string;
  payload_json: string;
  last_error: string | null;
};

export type CanonicalActiveDroneReadModel = {
  drones: Record<string, any>;
  pending: Record<string, any>;
};

function parseObject(raw: string): Record<string, any> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function hasTable(connection: HubDatabaseConnection, table: string): boolean {
  return Boolean(connection.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function lifecycleEntry(row: LifecycleRow): Record<string, any> {
  const entry = parseObject(row.lifecycle_json);
  entry.id = row.drone_id;
  entry.name = row.name;
  if (row.container_name) entry.containerName = row.container_name;
  else delete entry.containerName;
  entry.runtime = row.runtime_kind;
  if (row.phase) entry.phase = row.phase;
  else delete entry.phase;
  return entry;
}

function chatKey(droneId: string, chatName: string): string {
  return `${droneId}\u0000${chatName}`;
}

/**
 * Builds the small active-drone view used by Hub summaries and SSE detection.
 *
 * This is deliberately a read model, not the registry compatibility projection:
 * it performs four bounded SQL queries, never runs migration backfills, and never
 * writes. Callers that require catalogs, settings, archives, or export fidelity
 * must continue to use their canonical owner or the compatibility projection.
 */
export function readCanonicalActiveDroneModel(): CanonicalActiveDroneReadModel | null {
  const database = getHubDatabase();
  if (!database) return null;
  return database.read((connection) => {
    if (!hasTable(connection, 'hub_canonical_drones') || !hasTable(connection, 'hub_canonical_pending_drones')) {
      return null;
    }

    const realRows = connection.prepare('SELECT * FROM hub_canonical_drones ORDER BY name, drone_id').all() as LifecycleRow[];
    const pendingRows = connection.prepare('SELECT * FROM hub_canonical_pending_drones ORDER BY name, drone_id').all() as LifecycleRow[];
    const drones: Record<string, any> = Object.fromEntries(
      realRows.map((row) => [row.drone_id, { ...lifecycleEntry(row), chats: {} }]),
    );
    const pending: Record<string, any> = Object.fromEntries(
      pendingRows.map((row) => [row.drone_id, lifecycleEntry(row)]),
    );

    if (!hasTable(connection, 'canonical_chats')) return { drones, pending };
    const chatRows = connection.prepare(`SELECT drone_id,chat_name,metadata_json
      FROM canonical_chats ORDER BY drone_id,chat_name`).all() as ChatRow[];
    const chats = new Map<string, any>();
    for (const row of chatRows) {
      const drone = drones[row.drone_id];
      if (!drone) continue;
      const chat = { ...parseObject(row.metadata_json), turns: [], pendingPrompts: [] };
      drone.chats[row.chat_name] = chat;
      chats.set(chatKey(row.drone_id, row.chat_name), chat);
    }

    if (hasTable(connection, 'canonical_chat_turns')) {
      const turnRows = connection.prepare(`SELECT drone_id,chat_name,turn_json
        FROM canonical_chat_turns
        ORDER BY drone_id,chat_name,COALESCE(prompt_at,at),completed_at,ordinal,turn_id`).all() as TurnRow[];
      for (const row of turnRows) {
        const chat = chats.get(chatKey(row.drone_id, row.chat_name));
        if (chat) chat.turns.push(parseObject(row.turn_json));
      }
    }

    if (hasTable(connection, 'prompts')) {
      const promptRows = connection.prepare(`WITH ranked AS (
          SELECT drone_id,chat_name,prompt_id,created_at,updated_at,state,prompt,payload_json,last_error,
            ROW_NUMBER() OVER (PARTITION BY drone_id,chat_name ORDER BY sequence DESC) AS rank
          FROM prompts WHERE state != 'cancelled'
        )
        SELECT drone_id,chat_name,prompt_id,created_at,updated_at,state,prompt,payload_json,last_error
        FROM ranked WHERE rank <= 60
        ORDER BY drone_id,chat_name,created_at,prompt_id`).all() as PromptRow[];
      for (const row of promptRows) {
        const chat = chats.get(chatKey(row.drone_id, row.chat_name));
        if (!chat) continue;
        chat.pendingPrompts.push({
          ...parseObject(row.payload_json),
          id: row.prompt_id,
          at: row.created_at,
          updatedAt: row.updated_at,
          state: row.state,
          prompt: row.prompt,
          ...(row.last_error ? { error: row.last_error } : { error: undefined }),
        });
      }
    }

    return { drones, pending };
  });
}
