import type { HubDatabase, HubDatabaseConnection } from '../../host/hub-database';
import type {
  ResourceSubscriptionPauseReason,
  ResourceSubscriptionProvider,
  ResourceSubscriptionStatus,
  ResourceSubscriptionType,
} from './resource-subscription-types';
import { parseResourceSubscriptionPauseReasons } from './resource-subscription-types';

type LifecycleSubscriptionRow = {
  id: string;
  subscriber_chat_id: string;
  subscriber_drone_id: string;
  provider: ResourceSubscriptionProvider;
  resource_type: ResourceSubscriptionType;
  resource_id: string;
  status: ResourceSubscriptionStatus;
  pause_reasons_json: string;
  resource_config_json: string;
};

type SubscriptionRelations = {
  subscriberChatId?: string;
  subscriberDroneId?: string;
  resourceChatIds: string[];
  resourceDroneId?: string;
  subscriberReason?: ResourceSubscriptionPauseReason;
  resourceReason?: ResourceSubscriptionPauseReason;
};

export class ResourceSubscriptionLifecycleRepository {
  constructor(private readonly database: HubDatabase) {}

  async pauseForChat(chatIdRaw: string): Promise<string[]> {
    const relations = chatRelations(chatIdRaw);
    return relations ? await this.pauseRelations(relations) : [];
  }

  async pauseForDrone(droneIdRaw: string, chatIdsRaw: string[]): Promise<string[]> {
    const relations = droneRelations(droneIdRaw, chatIdsRaw);
    return relations ? await this.pauseRelations(relations) : [];
  }

  resumeCandidatesForChat(chatIdRaw: string): string[] {
    const relations = chatRelations(chatIdRaw);
    return relations ? this.resumeCandidates(relations) : [];
  }

  resumeCandidatesForDrone(droneIdRaw: string, chatIdsRaw: string[]): string[] {
    const relations = droneRelations(droneIdRaw, chatIdsRaw);
    return relations ? this.resumeCandidates(relations) : [];
  }

  async resumeForChat(chatIdRaw: string): Promise<string[]> {
    const relations = chatRelations(chatIdRaw);
    return relations ? await this.resumeRelations(relations) : [];
  }

  async resumeForDrone(droneIdRaw: string, chatIdsRaw: string[]): Promise<string[]> {
    const relations = droneRelations(droneIdRaw, chatIdsRaw);
    return relations ? await this.resumeRelations(relations) : [];
  }

  async cancelForChat(chatIdRaw: string): Promise<string[]> {
    const relations = chatRelations(chatIdRaw);
    return relations ? await this.cancelRelations(relations) : [];
  }

  async cancelForDrone(droneIdRaw: string, chatIdsRaw: string[]): Promise<string[]> {
    const relations = droneRelations(droneIdRaw, chatIdsRaw);
    return relations ? await this.cancelRelations(relations) : [];
  }

  private async cancelRelations(input: SubscriptionRelations): Promise<string[]> {
    const now = new Date().toISOString();
    return await this.database.writeTransaction(
      'cancel related resource subscriptions',
      (connection) => cancelRelationsWithConnection(connection, input, now),
    );
  }

  private async pauseRelations(input: SubscriptionRelations): Promise<string[]> {
    const now = new Date().toISOString();
    return await this.database.writeTransaction('pause resource subscriptions', (connection) =>
      pauseRelationsWithConnection(connection, input, now),
    );
  }

  private resumeCandidates(input: SubscriptionRelations): string[] {
    return this.database.read((connection) =>
      selectRelatedSubscriptions(connection, input, ['paused'])
        .filter((row) => pauseReasonsAfterRemoving(row, input).length === 0)
        .map((row) => row.id),
    );
  }

  private async resumeRelations(input: SubscriptionRelations): Promise<string[]> {
    const now = new Date().toISOString();
    return await this.database.writeTransaction('resume resource subscriptions', (connection) => {
      const rows = selectRelatedSubscriptions(connection, input, ['paused']);
      const update = connection.prepare(`
        UPDATE resource_subscriptions
        SET status = ?, pause_reasons_json = ?,
          delivery_after = CASE WHEN ? = 'active' THEN ? ELSE delivery_after END,
          updated_at = ?
        WHERE id = ? AND status = 'paused'
      `);
      for (const row of rows) {
        const reasons = pauseReasonsAfterRemoving(row, input);
        const status = reasons.length === 0 ? 'active' : 'paused';
        update.run(status, JSON.stringify(reasons), status, now, now, row.id);
      }
      return rows.map((row) => row.id);
    });
  }
}

export function pauseResourceSubscriptionsForChatWithConnection(
  connection: HubDatabaseConnection,
  chatIdRaw: string,
  now = new Date().toISOString(),
): string[] {
  const relations = chatRelations(chatIdRaw);
  if (!relations || !resourceSubscriptionTableExists(connection)) return [];
  return pauseRelationsWithConnection(connection, relations, now);
}

export function cancelResourceSubscriptionsForChatWithConnection(
  connection: HubDatabaseConnection,
  chatIdRaw: string,
  now = new Date().toISOString(),
): string[] {
  const relations = chatRelations(chatIdRaw);
  if (!relations || !resourceSubscriptionTableExists(connection)) return [];
  return cancelRelationsWithConnection(connection, relations, now);
}

export function cancelResourceSubscriptionsForDroneWithConnection(
  connection: HubDatabaseConnection,
  droneIdRaw: string,
  chatIdsRaw: string[],
  now = new Date().toISOString(),
): string[] {
  const relations = droneRelations(droneIdRaw, chatIdsRaw);
  if (!relations || !resourceSubscriptionTableExists(connection)) return [];
  return cancelRelationsWithConnection(connection, relations, now);
}

function pauseRelationsWithConnection(
  connection: HubDatabaseConnection,
  input: SubscriptionRelations,
  now: string,
): string[] {
  const rows = selectRelatedSubscriptions(connection, input, ['active', 'paused']);
  const update = connection.prepare(`
    UPDATE resource_subscriptions
    SET status = 'paused', pause_reasons_json = ?, updated_at = ?
    WHERE id = ? AND status IN ('active', 'paused')
  `);
  for (const row of rows) {
    update.run(JSON.stringify(pauseReasonsAfterAdding(row, input)), now, row.id);
    failPendingResourceSubscriptionDeliveries(connection, row.id, 'subscription paused', now);
  }
  return rows.map((row) => row.id);
}

function cancelRelationsWithConnection(
  connection: HubDatabaseConnection,
  input: Pick<
    SubscriptionRelations,
    'subscriberChatId' | 'subscriberDroneId' | 'resourceChatIds' | 'resourceDroneId'
  >,
  now: string,
): string[] {
  const rows = selectRelatedSubscriptions(connection, input, ['active', 'paused']);
  const update = connection.prepare(`
    UPDATE resource_subscriptions
    SET status = 'cancelled', pause_reasons_json = '[]', completed_at = ?, updated_at = ?
    WHERE id = ? AND status IN ('active', 'paused')
  `);
  for (const row of rows) {
    update.run(now, now, row.id);
    failPendingResourceSubscriptionDeliveries(connection, row.id, 'subscription cancelled', now);
  }
  return rows.map((row) => row.id);
}

function selectRelatedSubscriptions(
  connection: HubDatabaseConnection,
  input: Pick<
    SubscriptionRelations,
    'subscriberChatId' | 'subscriberDroneId' | 'resourceChatIds' | 'resourceDroneId'
  >,
  statuses: ResourceSubscriptionStatus[],
): LifecycleSubscriptionRow[] {
  const conditions: string[] = [];
  const values: string[] = [];
  if (input.subscriberChatId) {
    conditions.push('subscriber_chat_id = ?');
    values.push(input.subscriberChatId);
  }
  if (input.subscriberDroneId) {
    conditions.push('subscriber_drone_id = ?');
    values.push(input.subscriberDroneId);
  }
  if (input.resourceChatIds.length > 0) {
    conditions.push(
      `(provider = 'drone-hub' AND resource_type = 'chat' AND resource_id IN (${input.resourceChatIds.map(() => '?').join(', ')}))`,
    );
    values.push(...input.resourceChatIds);
  }
  if (input.resourceDroneId) {
    conditions.push(
      `(provider = 'drone-hub' AND resource_type = 'change_request' AND json_extract(resource_config_json, '$.droneId') = ?)`,
    );
    values.push(input.resourceDroneId);
  }
  if (conditions.length === 0 || statuses.length === 0) return [];
  return connection
    .prepare(
      `SELECT id, subscriber_chat_id, subscriber_drone_id, provider, resource_type,
        resource_id, resource_config_json, status, pause_reasons_json
       FROM resource_subscriptions
       WHERE status IN (${statuses.map(() => '?').join(', ')})
         AND (${conditions.join(' OR ')})
       ORDER BY created_at, id`,
    )
    .all(...statuses, ...values) as LifecycleSubscriptionRow[];
}

function pauseReasonsAfterAdding(
  row: LifecycleSubscriptionRow,
  input: SubscriptionRelations,
): ResourceSubscriptionPauseReason[] {
  const reasons = new Set(parseResourceSubscriptionPauseReasons(row.pause_reasons_json));
  if (subscriberMatches(row, input) && input.subscriberReason) reasons.add(input.subscriberReason);
  if (resourceMatches(row, input) && input.resourceReason) reasons.add(input.resourceReason);
  return [...reasons];
}

function pauseReasonsAfterRemoving(
  row: LifecycleSubscriptionRow,
  input: SubscriptionRelations,
): ResourceSubscriptionPauseReason[] {
  const reasons = new Set(parseResourceSubscriptionPauseReasons(row.pause_reasons_json));
  if (subscriberMatches(row, input) && input.subscriberReason) {
    reasons.delete(input.subscriberReason);
  }
  if (resourceMatches(row, input) && input.resourceReason) reasons.delete(input.resourceReason);
  return [...reasons];
}

function subscriberMatches(
  row: LifecycleSubscriptionRow,
  input: Pick<SubscriptionRelations, 'subscriberChatId' | 'subscriberDroneId'>,
): boolean {
  return (
    (Boolean(input.subscriberChatId) && row.subscriber_chat_id === input.subscriberChatId) ||
    (Boolean(input.subscriberDroneId) && row.subscriber_drone_id === input.subscriberDroneId)
  );
}

function resourceMatches(
  row: LifecycleSubscriptionRow,
  input: Pick<SubscriptionRelations, 'resourceChatIds' | 'resourceDroneId'>,
): boolean {
  return (
    row.provider === 'drone-hub' &&
    ((row.resource_type === 'chat' && input.resourceChatIds.includes(row.resource_id)) ||
      (row.resource_type === 'change_request' &&
        Boolean(input.resourceDroneId) &&
        resourceConfigDroneId(row.resource_config_json) === input.resourceDroneId))
  );
}

function resourceConfigDroneId(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return cleanString(parsed?.droneId);
  } catch {
    return '';
  }
}

export function failPendingResourceSubscriptionDeliveries(
  connection: HubDatabaseConnection,
  subscriptionId: string,
  error: string,
  now: string,
): void {
  const batchRows = connection
    .prepare(
      `SELECT DISTINCT batch_id
       FROM subscription_deliveries
       WHERE subscription_id = ? AND state = 'processing' AND batch_id IS NOT NULL`,
    )
    .all(subscriptionId) as Array<{ batch_id: string }>;
  const batchIds = batchRows.map((row) => row.batch_id);
  if (batchIds.length > 0) {
    const placeholders = batchIds.map(() => '?').join(', ');
    connection
      .prepare(
        `UPDATE subscription_deliveries
         SET state = 'pending', batch_id = NULL, next_attempt_at = ?, updated_at = ?,
           last_error = 'batch interrupted by subscription lifecycle change'
         WHERE state = 'processing' AND subscription_id != ?
           AND batch_id IN (${placeholders})`,
      )
      .run(now, now, subscriptionId, ...batchIds);
    connection
      .prepare(
        `UPDATE subscription_batches
         SET state = 'failed', updated_at = ?, last_error = ?
         WHERE state = 'processing' AND id IN (${placeholders})`,
      )
      .run(now, error, ...batchIds);
  }
  connection
    .prepare(
      `UPDATE subscription_deliveries
       SET state = 'failed', batch_id = NULL, last_error = ?, updated_at = ?
       WHERE subscription_id = ? AND state IN ('pending', 'processing')`,
    )
    .run(error, now, subscriptionId);
}

function resourceSubscriptionTableExists(connection: HubDatabaseConnection): boolean {
  return Boolean(
    connection
      .prepare(
        `SELECT 1 FROM sqlite_schema
         WHERE type = 'table' AND name = 'resource_subscriptions'`,
      )
      .get(),
  );
}

function cleanStrings(raw: string[]): string[] {
  return [...new Set((raw ?? []).map((item) => cleanString(item)).filter(Boolean))];
}

function chatRelations(chatIdRaw: string): SubscriptionRelations | null {
  const chatId = cleanString(chatIdRaw);
  return chatId
    ? {
        subscriberChatId: chatId,
        resourceChatIds: [chatId],
        subscriberReason: 'subscriber_chat_archived',
        resourceReason: 'resource_chat_archived',
      }
    : null;
}

function droneRelations(droneIdRaw: string, chatIdsRaw: string[]): SubscriptionRelations | null {
  const droneId = cleanString(droneIdRaw);
  return droneId
    ? {
        subscriberDroneId: droneId,
        resourceChatIds: cleanStrings(chatIdsRaw),
        resourceDroneId: droneId,
        subscriberReason: 'subscriber_drone_archived',
        resourceReason: 'resource_drone_archived',
      }
    : null;
}

function cleanString(raw: unknown): string {
  return String(raw ?? '').trim();
}
