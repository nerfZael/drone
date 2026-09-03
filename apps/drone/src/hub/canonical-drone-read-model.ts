import { getHubDatabase, type HubDatabaseConnection } from '../host/hub-database';
import { compactActivityJsonSql } from '../host/activity-read-projection';

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

type SummaryTurnRow = {
  drone_id: string;
  chat_name: string;
  latest_julian_day: number | null;
};

type ActiveSnapshotRow = {
  drone_id: string;
  chat_name: string;
  active_snapshot_status: string | null;
};

export type CanonicalReadModelPhase = {
  name:
    | 'lifecycle'
    | 'chats'
    | 'chatParsing'
    | 'turns'
    | 'turnParsing'
    | 'snapshots'
    | 'prompts'
    | 'promptParsing';
  durationMs: number;
  rowCount: number;
};

export type CanonicalActiveDroneReadModel = {
  drones: Record<string, any>;
  pending: Record<string, any>;
};

const RECENT_TURNS_PER_CHAT = 60;

function measureRows<T>(
  name: CanonicalReadModelPhase['name'],
  read: () => T[],
  onPhase?: (phase: CanonicalReadModelPhase) => void,
): T[] {
  const startedAt = performance.now();
  const rows = read();
  onPhase?.({ name, durationMs: performance.now() - startedAt, rowCount: rows.length });
  return rows;
}

function parseObject(raw: string): Record<string, any> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function isoFromJulianDay(raw: number | null): string | null {
  const julianDay = Number(raw);
  if (!Number.isFinite(julianDay) || julianDay <= 0) return null;
  const unixMs = Math.round((julianDay - 2_440_587.5) * 86_400_000);
  const value = new Date(unixMs);
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function hasTable(connection: HubDatabaseConnection, table: string): boolean {
  return Boolean(
    connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
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

function readCanonicalLifecycleWithConnection(
  connection: HubDatabaseConnection,
): CanonicalActiveDroneReadModel | null {
  if (
    !hasTable(connection, 'hub_canonical_drones') ||
    !hasTable(connection, 'hub_canonical_pending_drones')
  ) {
    return null;
  }
  const realRows = connection
    .prepare('SELECT * FROM hub_canonical_drones ORDER BY name, drone_id')
    .all() as LifecycleRow[];
  const pendingRows = connection
    .prepare('SELECT * FROM hub_canonical_pending_drones ORDER BY name, drone_id')
    .all() as LifecycleRow[];
  return {
    drones: Object.fromEntries(realRows.map((row) => [row.drone_id, lifecycleEntry(row)])),
    pending: Object.fromEntries(pendingRows.map((row) => [row.drone_id, lifecycleEntry(row)])),
  };
}

/** Lifecycle-only read model for workers that do not inspect chat state. */
export function readCanonicalDroneLifecycleModel(): CanonicalActiveDroneReadModel | null {
  const database = getHubDatabase();
  if (!database) return null;
  return database.read(readCanonicalLifecycleWithConnection);
}

/**
 * Builds the small active-drone view used by Hub summaries and SSE detection.
 *
 * This is deliberately a read model, not the registry compatibility projection:
 * it performs targeted queries with bounded chat-history results, never runs
 * migration backfills, and never writes. Callers that require catalogs, settings, archives, or export fidelity
 * must continue to use their canonical owner or the compatibility projection.
 */
export function readCanonicalActiveDroneModel(
  onPhase?: (phase: CanonicalReadModelPhase) => void,
): CanonicalActiveDroneReadModel | null {
  const database = getHubDatabase();
  if (!database) return null;
  return database.read((connection) => {
    const lifecycleStartedAt = performance.now();
    const lifecycle = readCanonicalLifecycleWithConnection(connection);
    onPhase?.({
      name: 'lifecycle',
      durationMs: performance.now() - lifecycleStartedAt,
      rowCount:
        Object.keys(lifecycle?.drones ?? {}).length + Object.keys(lifecycle?.pending ?? {}).length,
    });
    if (!lifecycle) return null;
    const drones = Object.fromEntries(
      Object.entries(lifecycle.drones).map(([droneId, entry]) => [
        droneId,
        { ...entry, chats: {} },
      ]),
    );
    const { pending } = lifecycle;

    if (!hasTable(connection, 'canonical_chats')) return { drones, pending };
    const chatRows = measureRows(
      'chats',
      () =>
        connection
          .prepare(
            `SELECT drone_id,chat_name,metadata_json
            FROM canonical_chats ORDER BY drone_id,chat_name`,
          )
          .all() as ChatRow[],
      onPhase,
    );
    const chats = new Map<string, any>();
    const chatParsingStartedAt = performance.now();
    for (const row of chatRows) {
      const drone = drones[row.drone_id];
      if (!drone) continue;
      const chat = { ...parseObject(row.metadata_json), turns: [], pendingPrompts: [] };
      drone.chats[row.chat_name] = chat;
      chats.set(chatKey(row.drone_id, row.chat_name), chat);
    }
    onPhase?.({
      name: 'chatParsing',
      durationMs: performance.now() - chatParsingStartedAt,
      rowCount: chatRows.length,
    });

    if (hasTable(connection, 'canonical_chat_turns')) {
      const hasTurnProjections = hasTable(connection, 'canonical_chat_turn_active_projections');
      const activeTurnJson = hasTurnProjections
        ? 'turn_projections.turn_json'
        : compactActivityJsonSql('turns.turn_json');
      const turnProjectionJoin = hasTurnProjections
        ? `JOIN canonical_chat_turn_active_projections AS turn_projections
          ON turn_projections.drone_id = turns.drone_id
          AND turn_projections.chat_name = turns.chat_name
          AND turn_projections.turn_id = turns.turn_id`
        : '';
      const turnRows = measureRows(
        'turns',
        () =>
          connection
            .prepare(
              `WITH ranked AS (
          SELECT drone_id,chat_name,turn_id,
            ROW_NUMBER() OVER (
              PARTITION BY drone_id,chat_name
              ORDER BY COALESCE(prompt_at,at) DESC,completed_at DESC,ordinal DESC,turn_id DESC
            ) AS recent_rank
          FROM canonical_chat_turns
        ), selected_ids AS (
          SELECT drone_id,chat_name,turn_id
          FROM ranked WHERE recent_rank <= ?
        )
        SELECT turns.drone_id,turns.chat_name,
          ${activeTurnJson} AS turn_json
        FROM selected_ids
        JOIN canonical_chat_turns AS turns
          ON turns.drone_id = selected_ids.drone_id
          AND turns.chat_name = selected_ids.chat_name
          AND turns.turn_id = selected_ids.turn_id
        ${turnProjectionJoin}
        ORDER BY turns.drone_id,turns.chat_name,COALESCE(turns.prompt_at,turns.at),
          turns.completed_at,turns.ordinal,turns.turn_id`,
            )
            .all(RECENT_TURNS_PER_CHAT) as TurnRow[],
        onPhase,
      );
      const turnParsingStartedAt = performance.now();
      for (const row of turnRows) {
        const chat = chats.get(chatKey(row.drone_id, row.chat_name));
        if (chat) chat.turns.push(parseObject(row.turn_json));
      }
      onPhase?.({
        name: 'turnParsing',
        durationMs: performance.now() - turnParsingStartedAt,
        rowCount: turnRows.length,
      });
    }

    if (hasTable(connection, 'prompts')) {
      const hasPromptProjections = hasTable(connection, 'prompt_active_projections');
      const activePromptJson = hasPromptProjections
        ? 'prompt_projections.payload_json'
        : compactActivityJsonSql('prompts.payload_json');
      const promptProjectionJoin = hasPromptProjections
        ? 'JOIN prompt_active_projections AS prompt_projections USING (drone_id,chat_name,prompt_id)'
        : '';
      const promptRows = measureRows(
        'prompts',
        () =>
          connection
            .prepare(
              `WITH ranked AS (
          SELECT prompts.drone_id,prompts.chat_name,prompts.prompt_id,prompts.sequence,
            ROW_NUMBER() OVER (
              PARTITION BY prompts.drone_id,prompts.chat_name ORDER BY prompts.sequence DESC
            ) AS rank
          FROM prompts
          WHERE prompts.state != 'cancelled'
            AND NOT EXISTS (
              SELECT 1
              FROM canonical_chat_turns AS turns
              WHERE turns.drone_id = prompts.drone_id
                AND turns.chat_name = prompts.chat_name
                AND turns.turn_id = prompts.prompt_id
            )
        )
        SELECT prompts.drone_id,prompts.chat_name,prompts.prompt_id,prompts.created_at,
          prompts.updated_at,prompts.state,prompts.prompt,
          ${activePromptJson} AS payload_json,prompts.last_error
        FROM ranked
        JOIN prompts USING (drone_id,chat_name,prompt_id)
        ${promptProjectionJoin}
        WHERE rank <= 60
        ORDER BY prompts.drone_id,prompts.chat_name,prompts.created_at,prompts.prompt_id`,
            )
            .all() as PromptRow[],
        onPhase,
      );
      const promptParsingStartedAt = performance.now();
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
      onPhase?.({
        name: 'promptParsing',
        durationMs: performance.now() - promptParsingStartedAt,
        rowCount: promptRows.length,
      });
    }

    return { drones, pending };
  });
}

/**
 * Builds the bounded single-chat view used by subscription change detection.
 *
 * A subscription only needs one chat's timeline, so rebuilding every drone and
 * parsing every recent turn once per polling tick is pure overhead. Keep the
 * same per-chat turn and unresolved-prompt bounds as the fleet-wide active
 * model so idle/latest-message behavior remains identical.
 */
export function readCanonicalChatActivityModel(
  droneIdRaw: string,
  chatNameRaw: string,
): CanonicalActiveDroneReadModel | null {
  const database = getHubDatabase();
  if (!database) return null;
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim();
  if (!droneId || !chatName) return null;

  return database.read((connection) => {
    if (!hasTable(connection, 'hub_canonical_drones') || !hasTable(connection, 'canonical_chats')) {
      return null;
    }

    const lifecycleRow = connection
      .prepare('SELECT * FROM hub_canonical_drones WHERE drone_id = ?')
      .get(droneId) as LifecycleRow | undefined;
    if (!lifecycleRow) return { drones: {}, pending: {} };

    const drone = { ...lifecycleEntry(lifecycleRow), chats: {} as Record<string, any> };
    const chatRow = connection
      .prepare(
        `SELECT drone_id,chat_name,metadata_json
        FROM canonical_chats WHERE drone_id = ? AND chat_name = ?`,
      )
      .get(droneId, chatName) as ChatRow | undefined;
    if (!chatRow) return { drones: { [droneId]: drone }, pending: {} };

    const chat: any = { ...parseObject(chatRow.metadata_json), turns: [], pendingPrompts: [] };
    drone.chats[chatName] = chat;

    if (hasTable(connection, 'canonical_chat_turns')) {
      const hasTurnProjections = hasTable(connection, 'canonical_chat_turn_active_projections');
      const activeTurnJson = hasTurnProjections
        ? 'turn_projections.turn_json'
        : compactActivityJsonSql('turns.turn_json');
      const turnProjectionJoin = hasTurnProjections
        ? `JOIN canonical_chat_turn_active_projections AS turn_projections
            ON turn_projections.drone_id = turns.drone_id
            AND turn_projections.chat_name = turns.chat_name
            AND turn_projections.turn_id = turns.turn_id`
        : '';
      const turnRows = connection
        .prepare(
          `WITH recent AS (
            SELECT turn_id
            FROM canonical_chat_turns
            WHERE drone_id = ? AND chat_name = ?
            ORDER BY COALESCE(prompt_at,at) DESC,completed_at DESC,ordinal DESC,turn_id DESC
            LIMIT ?
          )
          SELECT turns.drone_id,turns.chat_name,
            ${activeTurnJson} AS turn_json
          FROM recent
          JOIN canonical_chat_turns AS turns
            ON turns.drone_id = ? AND turns.chat_name = ? AND turns.turn_id = recent.turn_id
          ${turnProjectionJoin}
          ORDER BY COALESCE(turns.prompt_at,turns.at),turns.completed_at,turns.ordinal,turns.turn_id`,
        )
        .all(droneId, chatName, RECENT_TURNS_PER_CHAT, droneId, chatName) as TurnRow[];
      for (const row of turnRows) chat.turns.push(parseObject(row.turn_json));
    }

    if (hasTable(connection, 'prompts')) {
      const promptRows = connection
        .prepare(
          `WITH recent AS (
            SELECT prompts.prompt_id,prompts.sequence
            FROM prompts
            WHERE prompts.drone_id = ? AND prompts.chat_name = ?
              AND prompts.state != 'cancelled'
              AND NOT EXISTS (
                SELECT 1
                FROM canonical_chat_turns AS turns
                WHERE turns.drone_id = prompts.drone_id
                  AND turns.chat_name = prompts.chat_name
                  AND turns.turn_id = prompts.prompt_id
              )
            ORDER BY prompts.sequence DESC
            LIMIT ?
          )
          SELECT prompts.drone_id,prompts.chat_name,prompts.prompt_id,prompts.created_at,
            prompts.updated_at,prompts.state,prompts.prompt,'{}' AS payload_json,
            prompts.last_error
          FROM recent
          JOIN prompts
            ON prompts.drone_id = ? AND prompts.chat_name = ?
              AND prompts.prompt_id = recent.prompt_id
          ORDER BY prompts.created_at,prompts.prompt_id`,
        )
        .all(droneId, chatName, RECENT_TURNS_PER_CHAT, droneId, chatName) as PromptRow[];
      for (const row of promptRows) {
        chat.pendingPrompts.push({
          id: row.prompt_id,
          at: row.created_at,
          updatedAt: row.updated_at,
          state: row.state,
          prompt: row.prompt,
          ...(row.last_error ? { error: row.last_error } : { error: undefined }),
        });
      }
    }

    return { drones: { [droneId]: drone }, pending: {} };
  });
}

/**
 * Builds the canonical view used by the drone list and registry SSE stream.
 *
 * The sidebar needs chat metadata, latest activity, active snapshot state, and
 * unresolved prompts. It does not render transcript bodies. Reading and parsing
 * up to 60 complete turns for every chat made this synchronous SQLite read block
 * every Hub request for hundreds of milliseconds on large fleets.
 */
export function readCanonicalDroneSummaryModel(
  onPhase?: (phase: CanonicalReadModelPhase) => void,
): CanonicalActiveDroneReadModel | null {
  const database = getHubDatabase();
  if (!database) return null;
  return database.read((connection) => {
    const lifecycleStartedAt = performance.now();
    const lifecycle = readCanonicalLifecycleWithConnection(connection);
    onPhase?.({
      name: 'lifecycle',
      durationMs: performance.now() - lifecycleStartedAt,
      rowCount:
        Object.keys(lifecycle?.drones ?? {}).length + Object.keys(lifecycle?.pending ?? {}).length,
    });
    if (!lifecycle) return null;
    const drones = Object.fromEntries(
      Object.entries(lifecycle.drones).map(([droneId, entry]) => [
        droneId,
        { ...entry, chats: {} },
      ]),
    );
    const { pending } = lifecycle;

    if (!hasTable(connection, 'canonical_chats')) return { drones, pending };
    const chatRows = measureRows(
      'chats',
      () =>
        connection
          .prepare(
            `SELECT drone_id,chat_name,metadata_json
            FROM canonical_chats ORDER BY drone_id,chat_name`,
          )
          .all() as ChatRow[],
      onPhase,
    );
    const chats = new Map<string, any>();
    const chatParsingStartedAt = performance.now();
    for (const row of chatRows) {
      const drone = drones[row.drone_id];
      if (!drone) continue;
      const chat = { ...parseObject(row.metadata_json), turns: [], pendingPrompts: [] };
      drone.chats[row.chat_name] = chat;
      chats.set(chatKey(row.drone_id, row.chat_name), chat);
    }
    onPhase?.({
      name: 'chatParsing',
      durationMs: performance.now() - chatParsingStartedAt,
      rowCount: chatRows.length,
    });

    if (hasTable(connection, 'canonical_chat_turns')) {
      const turnRows = measureRows(
        'turns',
        () =>
          connection
            .prepare(
              `SELECT drone_id,chat_name,
                MAX(MAX(
                  COALESCE(julianday(completed_at), 0),
                  COALESCE(julianday(prompt_at), 0),
                  COALESCE(julianday(at), 0)
                )) AS latest_julian_day
              FROM canonical_chat_turns
              GROUP BY drone_id,chat_name
              ORDER BY drone_id,chat_name`,
            )
            .all() as SummaryTurnRow[],
        onPhase,
      );
      const turnParsingStartedAt = performance.now();
      for (const row of turnRows) {
        const chat = chats.get(chatKey(row.drone_id, row.chat_name));
        if (!chat) continue;
        const latestAt = isoFromJulianDay(row.latest_julian_day);
        chat.turns.push(latestAt ? { at: latestAt } : {});
      }
      onPhase?.({
        name: 'turnParsing',
        durationMs: performance.now() - turnParsingStartedAt,
        rowCount: turnRows.length,
      });

      const snapshotRows = measureRows(
        'snapshots',
        () =>
          connection
            .prepare(
              `SELECT drone_id,chat_name,
                MAX(CASE
                  WHEN json_valid(turn_json)
                    AND json_extract(turn_json, '$.dockerSnapshot.status') IN ('creating', 'restoring')
                  THEN json_extract(turn_json, '$.dockerSnapshot.status')
                  ELSE NULL
                END) AS active_snapshot_status
              FROM canonical_chat_turns
              WHERE instr(turn_json, '"dockerSnapshot"') > 0
              GROUP BY drone_id,chat_name
              ORDER BY drone_id,chat_name`,
            )
            .all() as ActiveSnapshotRow[],
        onPhase,
      );
      for (const row of snapshotRows) {
        if (!row.active_snapshot_status) continue;
        const chat = chats.get(chatKey(row.drone_id, row.chat_name));
        const turn = chat?.turns?.[0];
        if (turn) turn.dockerSnapshot = { status: row.active_snapshot_status };
      }
    }

    if (hasTable(connection, 'prompts')) {
      const hasPromptProjections = hasTable(connection, 'prompt_active_projections');
      const activePromptJson = hasPromptProjections
        ? 'prompt_projections.payload_json'
        : compactActivityJsonSql('prompts.payload_json');
      const promptProjectionJoin = hasPromptProjections
        ? 'JOIN prompt_active_projections AS prompt_projections USING (drone_id,chat_name,prompt_id)'
        : '';
      const promptRows = measureRows(
        'prompts',
        () =>
          connection
            .prepare(
              `WITH unresolved AS (
                SELECT prompts.drone_id,prompts.chat_name,prompts.prompt_id,
                  prompts.state,prompts.sequence
                FROM prompts
                WHERE prompts.state != 'cancelled'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM canonical_chat_turns AS turns
                    WHERE turns.drone_id = prompts.drone_id
                      AND turns.chat_name = prompts.chat_name
                      AND turns.turn_id = prompts.prompt_id
                  )
              ), ranked AS (
                SELECT unresolved.*,
                  ROW_NUMBER() OVER (
                    PARTITION BY drone_id,chat_name ORDER BY sequence DESC
                  ) AS rank
                FROM unresolved
              )
              SELECT prompts.drone_id,prompts.chat_name,prompts.prompt_id,
                prompts.created_at,prompts.updated_at,prompts.state,prompts.prompt,
                CASE
                  WHEN json_valid(${activePromptJson}) THEN json_object(
                    'action', json_extract(${activePromptJson}, '$.action'),
                    'approvals', json_extract(${activePromptJson}, '$.approvals'),
                    'activity', json_object(
                      'updatedAt', json_extract(${activePromptJson}, '$.activity.updatedAt')
                    )
                  )
                  ELSE '{}'
                END AS payload_json,prompts.last_error
              FROM ranked
              JOIN prompts USING (drone_id,chat_name,prompt_id)
              ${promptProjectionJoin}
              WHERE rank <= 60
                AND (
                  ranked.state != 'sent'
                  OR NOT EXISTS (
                    SELECT 1
                    FROM prompts AS newer
                    WHERE newer.drone_id = ranked.drone_id
                      AND newer.chat_name = ranked.chat_name
                      AND newer.state = 'sent'
                      AND newer.sequence > ranked.sequence
                      AND NOT EXISTS (
                        SELECT 1
                        FROM canonical_chat_turns AS newer_turns
                        WHERE newer_turns.drone_id = newer.drone_id
                          AND newer_turns.chat_name = newer.chat_name
                          AND newer_turns.turn_id = newer.prompt_id
                      )
                  )
                  OR json_array_length(json_extract(${activePromptJson}, '$.approvals')) > 0
                )
              ORDER BY prompts.drone_id,prompts.chat_name,prompts.created_at,prompts.prompt_id`,
            )
            .all() as PromptRow[],
        onPhase,
      );
      const promptParsingStartedAt = performance.now();
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
      onPhase?.({
        name: 'promptParsing',
        durationMs: performance.now() - promptParsingStartedAt,
        rowCount: promptRows.length,
      });
    }

    return { drones, pending };
  });
}
