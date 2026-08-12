import crypto from 'node:crypto';

import {
  applyHubDatabaseMigrations,
  type HubDatabase,
  type HubDatabaseMigration,
} from '../../host/hub-database';
import {
  parseResourceSubscriptionPauseReasons,
  resourceRef,
  type ResourceEvent,
  type ResourceSubscription,
  type ResourceSubscriptionEventType,
  type ResourceSubscriptionProvider,
  type ResourceSubscriptionSettings,
  type ResourceSubscriptionStatus,
  type ResourceSubscriptionSubscriber,
  type ResourceSubscriptionType,
} from './resource-subscription-types';
import { isTerminalResourceSubscriptionEvent } from './resource-subscription-capabilities';
import {
  failPendingResourceSubscriptionDeliveries,
  ResourceSubscriptionLifecycleRepository,
} from './resource-subscription-lifecycle-repository';

export type ResourceSubscriptionBatchItem = {
  deliveryId: string;
  subscription: ResourceSubscription;
  event: ResourceEvent;
};

export type ResourceSubscriptionBatch = {
  id: string;
  subscriber: ResourceSubscriptionSubscriber;
  promptId: string;
  items: ResourceSubscriptionBatchItem[];
};

export type ResourceSubscriptionBatchRejection = {
  deliveryId: string;
  error: string;
  permanent: boolean;
};

export type ChatResourceLocation = {
  chatId: string;
  droneId: string;
  chatName: string;
  droneName?: string;
  droneChatCount?: number;
};

export const RESOURCE_SUBSCRIPTION_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'durable resource subscriptions',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE resource_subscriptions (
          id TEXT NOT NULL PRIMARY KEY,
          subscriber_chat_id TEXT NOT NULL,
          subscriber_drone_id TEXT NOT NULL,
          subscriber_chat_name TEXT NOT NULL,
          provider TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          events_json TEXT NOT NULL,
          intent TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled', 'paused')),
          cursor_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          last_error TEXT,
          UNIQUE (subscriber_chat_id, provider, resource_type, resource_id)
        );

        CREATE INDEX idx_resource_subscriptions_active_resource
          ON resource_subscriptions (status, provider, resource_type, resource_id);
        CREATE INDEX idx_resource_subscriptions_subscriber
          ON resource_subscriptions (subscriber_chat_id, status, updated_at);

        CREATE TABLE resource_events (
          id TEXT NOT NULL PRIMARY KEY,
          provider_event_id TEXT NOT NULL UNIQUE,
          provider TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          parent_resource_id TEXT,
          event_type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          summary TEXT NOT NULL,
          provider_content_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_resource_events_resource
          ON resource_events (provider, resource_type, resource_id, occurred_at);
        CREATE INDEX idx_resource_events_created
          ON resource_events (created_at);

        CREATE TABLE subscription_deliveries (
          id TEXT NOT NULL PRIMARY KEY,
          subscription_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'delivered', 'failed')),
          available_at TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at TEXT NOT NULL,
          batch_id TEXT,
          delivered_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (subscription_id, event_id),
          FOREIGN KEY (subscription_id) REFERENCES resource_subscriptions(id) ON DELETE CASCADE,
          FOREIGN KEY (event_id) REFERENCES resource_events(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_subscription_deliveries_pending
          ON subscription_deliveries (state, available_at, next_attempt_at, created_at);

        CREATE TABLE subscription_batches (
          id TEXT NOT NULL PRIMARY KEY,
          subscriber_chat_id TEXT NOT NULL,
          subscriber_drone_id TEXT NOT NULL,
          subscriber_chat_name TEXT NOT NULL,
          prompt_id TEXT NOT NULL UNIQUE,
          delivery_ids_json TEXT NOT NULL,
          event_count INTEGER NOT NULL CHECK (event_count > 0),
          state TEXT NOT NULL CHECK (state IN ('processing', 'delivered', 'failed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          delivered_at TEXT,
          last_error TEXT
        );

        CREATE INDEX idx_subscription_batches_subscriber_created
          ON subscription_batches (subscriber_chat_id, created_at);

        CREATE TABLE resource_poll_cursors (
          provider TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          cursor_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_error TEXT,
          PRIMARY KEY (provider, resource_type, resource_id)
        );
      `);
    },
  },
  {
    version: 2,
    name: 'resource subscription pause reasons',
    migrate(connection) {
      connection.exec(`
        ALTER TABLE resource_subscriptions
          ADD COLUMN pause_reasons_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE resource_subscriptions
          ADD COLUMN delivery_after TEXT;
      `);
    },
  },
  {
    version: 3,
    name: 'scheduled resource subscriptions',
    migrate(connection) {
      connection.exec(`
        ALTER TABLE resource_subscriptions
          ADD COLUMN resource_config_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE resource_subscriptions
          ADD COLUMN next_event_at TEXT;

        CREATE INDEX idx_resource_subscriptions_due
          ON resource_subscriptions (next_event_at, id)
          WHERE status = 'active' AND provider = 'drone-hub'
            AND resource_type = 'cron' AND next_event_at IS NOT NULL;
      `);
    },
  },
];

type SubscriptionRow = {
  id: string;
  subscriber_chat_id: string;
  subscriber_drone_id: string;
  subscriber_chat_name: string;
  provider: ResourceSubscriptionProvider;
  resource_type: ResourceSubscriptionType;
  resource_id: string;
  resource_config_json: string;
  events_json: string;
  intent: string;
  status: ResourceSubscriptionStatus;
  pause_reasons_json: string;
  delivery_after: string | null;
  cursor_json: string;
  next_event_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  last_error: string | null;
};

type EventRow = {
  id: string;
  provider_event_id: string;
  provider: ResourceSubscriptionProvider;
  resource_type: ResourceSubscriptionType;
  resource_id: string;
  parent_resource_id: string | null;
  event_type: ResourceSubscriptionEventType;
  occurred_at: string;
  summary: string;
  provider_content_json: string;
};

type DeliveryJoinRow = EventRow & {
  delivery_id: string;
  subscription_id: string;
  subscriber_chat_id: string;
  subscriber_drone_id: string;
  subscriber_chat_name: string;
  subscription_provider: ResourceSubscriptionProvider;
  subscription_resource_type: ResourceSubscriptionType;
  subscription_resource_id: string;
  resource_config_json: string;
  events_json: string;
  intent: string;
  status: ResourceSubscriptionStatus;
  pause_reasons_json: string;
  delivery_after: string | null;
  cursor_json: string;
  next_event_at: string | null;
  subscription_created_at: string;
  subscription_updated_at: string;
  completed_at: string | null;
  last_error: string | null;
};

export class ResourceSubscriptionRepository {
  private readonly lifecycleRepository: ResourceSubscriptionLifecycleRepository;

  constructor(private readonly database: HubDatabase) {
    this.database.read((connection) =>
      applyHubDatabaseMigrations(
        connection,
        RESOURCE_SUBSCRIPTION_MIGRATIONS,
        'resource-subscriptions',
      ),
    );
    this.lifecycleRepository = new ResourceSubscriptionLifecycleRepository(database);
  }

  resolveChatResource(resourceIdRaw: string): ChatResourceLocation | null {
    const resourceId = cleanString(resourceIdRaw);
    if (!resourceId) return null;
    return this.resolveChatResources([resourceId]).get(resourceId) ?? null;
  }

  resolveChatResources(resourceIdsRaw: string[]): Map<string, ChatResourceLocation> {
    const resourceIds = [
      ...new Set(resourceIdsRaw.map((resourceId) => cleanString(resourceId)).filter(Boolean)),
    ];
    if (resourceIds.length === 0) return new Map();
    return this.database.read((connection) => {
      type ResourceLocationRow = {
        drone_id: string;
        chat_name: string;
        chat_id: string;
        drone_name?: string | null;
        drone_chat_count: number;
      };
      const placeholders = resourceIds.map(() => '?').join(', ');
      let rows: ResourceLocationRow[];
      try {
        rows = connection
          .prepare(
            `
            WITH chat_counts AS (
              SELECT drone_id, COUNT(*) AS count
              FROM canonical_chats
              GROUP BY drone_id
            )
            SELECT c.drone_id, c.chat_name,
              json_extract(c.metadata_json, '$.id') AS chat_id,
              d.name AS drone_name,
              counts.count AS drone_chat_count
            FROM canonical_chats c
            INNER JOIN chat_counts counts ON counts.drone_id = c.drone_id
            LEFT JOIN hub_canonical_drones d ON d.drone_id = c.drone_id
            WHERE json_extract(c.metadata_json, '$.id') IN (${placeholders})
          `,
          )
          .all(...resourceIds) as ResourceLocationRow[];
      } catch {
        // Older or partially initialized stores may not have the lifecycle read model yet.
        rows = connection
          .prepare(
            `
            WITH chat_counts AS (
              SELECT drone_id, COUNT(*) AS count
              FROM canonical_chats
              GROUP BY drone_id
            )
            SELECT c.drone_id, c.chat_name,
              json_extract(c.metadata_json, '$.id') AS chat_id,
              counts.count AS drone_chat_count
            FROM canonical_chats c
            INNER JOIN chat_counts counts ON counts.drone_id = c.drone_id
            WHERE json_extract(c.metadata_json, '$.id') IN (${placeholders})
          `,
          )
          .all(...resourceIds) as ResourceLocationRow[];
      }
      return new Map(
        rows.map((row) => [
          row.chat_id,
          {
            chatId: row.chat_id,
            droneId: row.drone_id,
            chatName: row.chat_name,
            ...(cleanString(row.drone_name) ? { droneName: cleanString(row.drone_name) } : {}),
            ...(row.drone_chat_count > 0 ? { droneChatCount: row.drone_chat_count } : {}),
          },
        ]),
      );
    });
  }

  get(idRaw: string, subscriberChatId?: string): ResourceSubscription | null {
    const id = cleanString(idRaw);
    if (!id) return null;
    return this.database.read((connection) => {
      const row = connection
        .prepare(
          `
          SELECT * FROM resource_subscriptions
          WHERE id = ? ${subscriberChatId ? 'AND subscriber_chat_id = ?' : ''}
        `,
        )
        .get(...(subscriberChatId ? [id, subscriberChatId] : [id])) as SubscriptionRow | undefined;
      return subscriptionFromRow(row);
    });
  }

  list(subscriberChatId: string, includeInactive = false): ResourceSubscription[] {
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `
          SELECT * FROM resource_subscriptions
          WHERE subscriber_chat_id = ? ${includeInactive ? '' : "AND status IN ('active', 'paused')"}
          ORDER BY updated_at DESC, id DESC
        `,
        )
        .all(subscriberChatId) as SubscriptionRow[];
      return rows.map(subscriptionFromRow).filter(isPresent);
    });
  }

  listActive(provider?: ResourceSubscriptionProvider): ResourceSubscription[] {
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `
          SELECT * FROM resource_subscriptions
          WHERE status = 'active' ${provider ? 'AND provider = ?' : ''}
          ORDER BY created_at, id
        `,
        )
        .all(...(provider ? [provider] : [])) as SubscriptionRow[];
      return rows.map(subscriptionFromRow).filter(isPresent);
    });
  }

  listDueCron(now = new Date()): ResourceSubscription[] {
    return this.database.read((connection) => {
      const rows = connection
        .prepare(
          `
          SELECT * FROM resource_subscriptions
          WHERE status = 'active' AND provider = 'drone-hub' AND resource_type = 'cron'
            AND next_event_at IS NOT NULL AND next_event_at <= ?
            AND (delivery_after IS NULL OR next_event_at >= delivery_after)
          ORDER BY next_event_at, id
        `,
        )
        .all(now.toISOString()) as SubscriptionRow[];
      return rows.map(subscriptionFromRow).filter(isPresent);
    });
  }

  async upsert(input: {
    subscriber: ResourceSubscriptionSubscriber;
    provider: ResourceSubscriptionProvider;
    resourceType: ResourceSubscriptionType;
    resourceId: string;
    resourceConfig?: Record<string, unknown>;
    events: ResourceSubscriptionEventType[];
    intent: string;
    cursor?: Record<string, unknown>;
    nextEventAt?: string | null;
    initialPollCursor?: {
      provider: ResourceSubscriptionProvider;
      resourceType: ResourceSubscriptionType;
      resourceId: string;
      cursor: Record<string, unknown>;
    };
    maxActive: number;
  }): Promise<{ created: boolean; subscription: ResourceSubscription }> {
    const now = new Date().toISOString();
    return await this.database.writeTransaction('upsert resource subscription', (connection) => {
      const current = connection
        .prepare(
          `
          SELECT * FROM resource_subscriptions
          WHERE subscriber_chat_id = ? AND provider = ? AND resource_type = ? AND resource_id = ?
        `,
        )
        .get(input.subscriber.chatId, input.provider, input.resourceType, input.resourceId) as
        | SubscriptionRow
        | undefined;
      if (!current || (current.status !== 'active' && current.status !== 'paused')) {
        const count = connection
          .prepare(
            `
            SELECT COUNT(*) AS count FROM resource_subscriptions
            WHERE subscriber_chat_id = ? AND status IN ('active', 'paused')
          `,
          )
          .get(input.subscriber.chatId) as { count: number };
        if (Number(count.count) >= input.maxActive) {
          throw new Error(`active subscription limit reached (max ${input.maxActive})`);
        }
      }
      const id = current?.id ?? crypto.randomUUID();
      const createdAt = current?.created_at ?? now;
      const resetPollCursor = input.initialPollCursor
        ? !connection
            .prepare(
              `
              SELECT 1 FROM resource_subscriptions
              WHERE status = 'active' AND provider = 'github'
                AND (
                  (resource_type = 'repository' AND resource_id = ?)
                  OR (
                    resource_type = 'pull_request'
                    AND instr(resource_id, ? || '#') = 1
                  )
                )
              LIMIT 1
            `,
            )
            .get(input.initialPollCursor.resourceId, input.initialPollCursor.resourceId)
        : false;
      const nextStatus = current?.status === 'paused' ? 'paused' : 'active';
      const pauseReasons =
        current?.status === 'paused'
          ? parseResourceSubscriptionPauseReasons(current.pause_reasons_json)
          : [];
      connection
        .prepare(
          `
          INSERT INTO resource_subscriptions (
            id, subscriber_chat_id, subscriber_drone_id, subscriber_chat_name,
            provider, resource_type, resource_id, resource_config_json, events_json,
            intent, status, pause_reasons_json, delivery_after, cursor_json,
            next_event_at, created_at, updated_at, completed_at, last_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL)
          ON CONFLICT (subscriber_chat_id, provider, resource_type, resource_id)
          DO UPDATE SET
            subscriber_drone_id = excluded.subscriber_drone_id,
            subscriber_chat_name = excluded.subscriber_chat_name,
            resource_config_json = excluded.resource_config_json,
            events_json = excluded.events_json,
            intent = excluded.intent,
            status = excluded.status,
            pause_reasons_json = excluded.pause_reasons_json,
            delivery_after = CASE
              WHEN resource_subscriptions.status = 'paused'
                THEN resource_subscriptions.delivery_after
              ELSE excluded.delivery_after
            END,
            cursor_json = excluded.cursor_json,
            next_event_at = excluded.next_event_at,
            updated_at = excluded.updated_at,
            completed_at = NULL,
            last_error = NULL
        `,
        )
        .run(
          id,
          input.subscriber.chatId,
          input.subscriber.droneId,
          input.subscriber.chatName,
          input.provider,
          input.resourceType,
          input.resourceId,
          JSON.stringify(input.resourceConfig ?? {}),
          JSON.stringify(input.events),
          input.intent,
          nextStatus,
          JSON.stringify(pauseReasons),
          JSON.stringify(input.cursor ?? parseObject(current?.cursor_json)),
          input.nextEventAt ?? null,
          createdAt,
          now,
        );
      if (input.initialPollCursor) {
        connection
          .prepare(
            resetPollCursor
              ? `
            INSERT INTO resource_poll_cursors (
              provider, resource_type, resource_id, cursor_json, updated_at, last_error
            ) VALUES (?, ?, ?, ?, ?, NULL)
            ON CONFLICT (provider, resource_type, resource_id)
            DO UPDATE SET cursor_json = excluded.cursor_json,
              updated_at = excluded.updated_at, last_error = NULL
          `
              : `
            INSERT OR IGNORE INTO resource_poll_cursors (
              provider, resource_type, resource_id, cursor_json, updated_at, last_error
            ) VALUES (?, ?, ?, ?, ?, NULL)
          `,
          )
          .run(
            input.initialPollCursor.provider,
            input.initialPollCursor.resourceType,
            input.initialPollCursor.resourceId,
            JSON.stringify(input.initialPollCursor.cursor),
            now,
          );
      }
      const stored = connection
        .prepare('SELECT * FROM resource_subscriptions WHERE id = ?')
        .get(id) as SubscriptionRow;
      return { created: !current, subscription: subscriptionFromRow(stored)! };
    });
  }

  async update(input: {
    id: string;
    subscriberChatId: string;
    events?: ResourceSubscriptionEventType[];
    intent?: string;
  }): Promise<ResourceSubscription | null> {
    const now = new Date().toISOString();
    return await this.database.writeTransaction('update resource subscription', (connection) => {
      const row = connection
        .prepare('SELECT * FROM resource_subscriptions WHERE id = ? AND subscriber_chat_id = ?')
        .get(input.id, input.subscriberChatId) as SubscriptionRow | undefined;
      if (!row) return null;
      connection
        .prepare(
          `
          UPDATE resource_subscriptions
          SET events_json = ?, intent = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          JSON.stringify(input.events ?? parseEvents(row.events_json)),
          input.intent ?? row.intent,
          now,
          row.id,
        );
      return subscriptionFromRow(
        connection.prepare('SELECT * FROM resource_subscriptions WHERE id = ?').get(row.id) as
          | SubscriptionRow
          | undefined,
      );
    });
  }

  async cancel(id: string, subscriberChatId: string): Promise<ResourceSubscription | null> {
    return await this.cancelWithStatusGuard(id, subscriberChatId, false);
  }

  async cancelActive(id: string, subscriberChatId: string): Promise<ResourceSubscription | null> {
    return await this.cancelWithStatusGuard(id, subscriberChatId, true);
  }

  private async cancelWithStatusGuard(
    id: string,
    subscriberChatId: string,
    activeOnly: boolean,
  ): Promise<ResourceSubscription | null> {
    const now = new Date().toISOString();
    return await this.database.writeTransaction('cancel resource subscription', (connection) => {
      const updated = connection
        .prepare(
          `
          UPDATE resource_subscriptions
          SET status = 'cancelled', pause_reasons_json = '[]', completed_at = ?, updated_at = ?
          WHERE id = ? AND subscriber_chat_id = ?
            ${activeOnly ? "AND status = 'active'" : "AND status != 'cancelled'"}
        `,
        )
        .run(now, now, id, subscriberChatId);
      const row = connection
        .prepare('SELECT * FROM resource_subscriptions WHERE id = ? AND subscriber_chat_id = ?')
        .get(id, subscriberChatId) as SubscriptionRow | undefined;
      if (Number(updated.changes ?? 0) === 1 || (!activeOnly && row?.status === 'cancelled')) {
        failPendingResourceSubscriptionDeliveries(connection, id, 'subscription cancelled', now);
      }
      return subscriptionFromRow(row);
    });
  }

  async pauseForChat(chatIdRaw: string): Promise<ResourceSubscription[]> {
    return this.subscriptionsForIds(await this.lifecycleRepository.pauseForChat(chatIdRaw));
  }

  async pauseForDrone(droneIdRaw: string, chatIdsRaw: string[]): Promise<ResourceSubscription[]> {
    return this.subscriptionsForIds(
      await this.lifecycleRepository.pauseForDrone(droneIdRaw, chatIdsRaw),
    );
  }

  resumeCandidatesForChat(chatIdRaw: string): ResourceSubscription[] {
    return this.subscriptionsForIds(this.lifecycleRepository.resumeCandidatesForChat(chatIdRaw));
  }

  resumeCandidatesForDrone(droneIdRaw: string, chatIdsRaw: string[]): ResourceSubscription[] {
    return this.subscriptionsForIds(
      this.lifecycleRepository.resumeCandidatesForDrone(droneIdRaw, chatIdsRaw),
    );
  }

  async resumeForChat(chatIdRaw: string): Promise<ResourceSubscription[]> {
    return this.subscriptionsForIds(await this.lifecycleRepository.resumeForChat(chatIdRaw));
  }

  async resumeForDrone(droneIdRaw: string, chatIdsRaw: string[]): Promise<ResourceSubscription[]> {
    return this.subscriptionsForIds(
      await this.lifecycleRepository.resumeForDrone(droneIdRaw, chatIdsRaw),
    );
  }

  async cancelForChat(chatIdRaw: string): Promise<ResourceSubscription[]> {
    return this.subscriptionsForIds(await this.lifecycleRepository.cancelForChat(chatIdRaw));
  }

  async cancelForDrone(droneIdRaw: string, chatIdsRaw: string[]): Promise<ResourceSubscription[]> {
    return this.subscriptionsForIds(
      await this.lifecycleRepository.cancelForDrone(droneIdRaw, chatIdsRaw),
    );
  }

  private subscriptionsForIds(ids: string[]): ResourceSubscription[] {
    return ids.map((id) => this.get(id)).filter(isPresent);
  }

  async updateSubscriptionCursor(id: string, cursor: Record<string, unknown>): Promise<void> {
    await this.database.writeTransaction('update subscription cursor', (connection) => {
      connection
        .prepare(
          `
          UPDATE resource_subscriptions SET cursor_json = ?, updated_at = ? WHERE id = ?
        `,
        )
        .run(JSON.stringify(cursor), new Date().toISOString(), id);
    });
  }

  async updateNextEventAt(id: string, nextEventAt: string): Promise<void> {
    const parsed = Date.parse(nextEventAt);
    if (!Number.isFinite(parsed)) throw new Error('next event timestamp must be a valid date');
    await this.database.writeTransaction('update subscription next event', (connection) => {
      connection
        .prepare(
          `
          UPDATE resource_subscriptions
          SET next_event_at = ?, updated_at = ?
          WHERE id = ? AND provider = 'drone-hub' AND resource_type = 'cron'
        `,
        )
        .run(new Date(parsed).toISOString(), new Date().toISOString(), id);
    });
  }

  pollCursor(
    provider: ResourceSubscriptionProvider,
    resourceType: ResourceSubscriptionType,
    resourceId: string,
  ): Record<string, unknown> | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare(
          `
          SELECT cursor_json FROM resource_poll_cursors
          WHERE provider = ? AND resource_type = ? AND resource_id = ?
        `,
        )
        .get(provider, resourceType, resourceId) as { cursor_json: string } | undefined;
      return row ? parseObject(row.cursor_json) : null;
    });
  }

  async setPollCursor(input: {
    provider: ResourceSubscriptionProvider;
    resourceType: ResourceSubscriptionType;
    resourceId: string;
    cursor: Record<string, unknown>;
    error?: string | null;
  }): Promise<void> {
    await this.database.writeTransaction('update resource poll cursor', (connection) => {
      connection
        .prepare(
          `
          INSERT INTO resource_poll_cursors (
            provider, resource_type, resource_id, cursor_json, updated_at, last_error
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (provider, resource_type, resource_id)
          DO UPDATE SET cursor_json = excluded.cursor_json, updated_at = excluded.updated_at,
            last_error = excluded.last_error
        `,
        )
        .run(
          input.provider,
          input.resourceType,
          input.resourceId,
          JSON.stringify(input.cursor),
          new Date().toISOString(),
          input.error ?? null,
        );
    });
  }

  async appendEvent(event: ResourceEvent): Promise<boolean> {
    if (event.resourceType === 'cron') {
      throw new Error('cron events must be appended with appendCronOccurrence');
    }
    const now = new Date().toISOString();
    return await this.database.writeTransaction('append resource event', (connection) => {
      const inserted = connection
        .prepare(
          `
          INSERT OR IGNORE INTO resource_events (
            id, provider_event_id, provider, resource_type, resource_id,
            parent_resource_id, event_type, occurred_at, summary,
            provider_content_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          event.id,
          event.providerEventId,
          event.provider,
          event.resourceType,
          event.resourceId,
          event.parentResourceId,
          event.eventType,
          event.occurredAt,
          event.summary,
          JSON.stringify(event.providerContent),
          now,
        );
      if (Number(inserted.changes ?? 0) !== 1) return false;

      const subscriptions = connection
        .prepare(
          `
          SELECT * FROM resource_subscriptions
          WHERE status = 'active' AND provider = ?
            AND (delivery_after IS NULL OR ? >= delivery_after)
            AND (
              (resource_type = ? AND resource_id = ?)
              OR (resource_type = 'repository' AND resource_id = ?)
            )
        `,
        )
        .all(
          event.provider,
          event.occurredAt,
          event.resourceType,
          event.resourceId,
          event.parentResourceId ?? '',
        ) as SubscriptionRow[];
      const insertDelivery = connection.prepare(`
        INSERT OR IGNORE INTO subscription_deliveries (
          id, subscription_id, event_id, state, available_at, attempt_count,
          next_attempt_at, batch_id, delivered_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, 0, ?, NULL, NULL, NULL, ?, ?)
      `);
      for (const row of subscriptions) {
        if (!parseEvents(row.events_json).includes(event.eventType)) continue;
        if (isChangeRequestEventAtOrBeforeBaseline(row, event)) continue;
        insertDelivery.run(crypto.randomUUID(), row.id, event.id, now, now, now, now);
      }

      if (isTerminalResourceSubscriptionEvent(event)) {
        connection
          .prepare(
            `
            UPDATE resource_subscriptions
            SET status = 'completed', pause_reasons_json = '[]', completed_at = ?, updated_at = ?
            WHERE provider = ? AND resource_type = ?
              AND resource_id = ? AND status IN ('active', 'paused')
          `,
          )
          .run(now, now, event.provider, event.resourceType, event.resourceId);
      }
      return true;
    });
  }

  async appendCronOccurrence(event: ResourceEvent, nextEventAt: string): Promise<number> {
    if (
      event.provider !== 'drone-hub' ||
      event.resourceType !== 'cron' ||
      event.eventType !== 'cron.triggered'
    ) {
      throw new Error('appendCronOccurrence requires a DroneHub cron event');
    }
    const occurredAtMs = Date.parse(event.occurredAt);
    const nextEventAtMs = Date.parse(nextEventAt);
    if (!Number.isFinite(occurredAtMs) || !Number.isFinite(nextEventAtMs)) {
      throw new Error('cron occurrence timestamps must be valid dates');
    }
    if (nextEventAtMs <= occurredAtMs) {
      throw new Error('cron next event must be after the current occurrence');
    }
    const now = new Date().toISOString();
    return await this.database.writeTransaction('append cron occurrence', (connection) => {
      connection
        .prepare(
          `
          INSERT OR IGNORE INTO resource_events (
            id, provider_event_id, provider, resource_type, resource_id,
            parent_resource_id, event_type, occurred_at, summary,
            provider_content_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          event.id,
          event.providerEventId,
          event.provider,
          event.resourceType,
          event.resourceId,
          event.parentResourceId,
          event.eventType,
          event.occurredAt,
          event.summary,
          JSON.stringify(event.providerContent),
          now,
        );
      const storedEvent = connection
        .prepare('SELECT id FROM resource_events WHERE provider_event_id = ?')
        .get(event.providerEventId) as { id: string } | undefined;
      if (!storedEvent) throw new Error('cron occurrence was not stored');

      const subscriptions = connection
        .prepare(
          `
          SELECT * FROM resource_subscriptions
          WHERE status = 'active' AND provider = 'drone-hub' AND resource_type = 'cron'
            AND resource_id = ? AND next_event_at IS NOT NULL AND next_event_at <= ?
            AND (delivery_after IS NULL OR ? >= delivery_after)
          ORDER BY id
        `,
        )
        .all(event.resourceId, event.occurredAt, event.occurredAt) as SubscriptionRow[];
      const supersedePending = connection.prepare(`
        UPDATE subscription_deliveries
        SET state = 'failed', batch_id = NULL, last_error = 'superseded by newer cron occurrence',
          updated_at = ?
        WHERE subscription_id = ? AND state = 'pending' AND event_id != ?
          AND event_id IN (
            SELECT id FROM resource_events
            WHERE provider = 'drone-hub' AND resource_type = 'cron'
          )
      `);
      const insertDelivery = connection.prepare(`
        INSERT OR IGNORE INTO subscription_deliveries (
          id, subscription_id, event_id, state, available_at, attempt_count,
          next_attempt_at, batch_id, delivered_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, 0, ?, NULL, NULL, NULL, ?, ?)
      `);
      const advanceSubscription = connection.prepare(`
        UPDATE resource_subscriptions
        SET next_event_at = ?, updated_at = ?, last_error = NULL
        WHERE id = ? AND status = 'active' AND next_event_at <= ?
      `);
      let deliveryCount = 0;
      for (const row of subscriptions) {
        if (parseEvents(row.events_json).includes(event.eventType)) {
          supersedePending.run(now, row.id, storedEvent.id);
          const inserted = insertDelivery.run(
            crypto.randomUUID(),
            row.id,
            storedEvent.id,
            now,
            now,
            now,
            now,
          );
          deliveryCount += Number(inserted.changes ?? 0);
        }
        advanceSubscription.run(nextEventAt, now, row.id, event.occurredAt);
      }
      return deliveryCount;
    });
  }

  async recoverInterruptedBatches(): Promise<void> {
    const now = new Date().toISOString();
    await this.database.writeTransaction(
      'recover interrupted subscription batches',
      (connection) => {
        // A prompt may have been committed just before the process stopped. Treat
        // that batch as delivered before re-queuing anything, otherwise restart
        // recovery could enqueue the same event a second time under a new batch.
        connection
          .prepare(
            `
        UPDATE subscription_deliveries
        SET state = 'delivered', delivered_at = COALESCE(delivered_at, ?), updated_at = ?,
          last_error = NULL
        WHERE state = 'processing' AND batch_id IN (
          SELECT b.id
          FROM subscription_batches b
          JOIN prompts p
            ON p.drone_id = b.subscriber_drone_id
           AND p.chat_name = b.subscriber_chat_name
           AND p.prompt_id = b.prompt_id
          WHERE b.state = 'processing'
        )
      `,
          )
          .run(now, now);
        connection
          .prepare(
            `
        UPDATE subscription_batches
        SET state = 'delivered', delivered_at = COALESCE(delivered_at, ?), updated_at = ?,
          last_error = NULL
        WHERE state = 'processing' AND EXISTS (
          SELECT 1 FROM prompts p
          WHERE p.drone_id = subscription_batches.subscriber_drone_id
            AND p.chat_name = subscription_batches.subscriber_chat_name
            AND p.prompt_id = subscription_batches.prompt_id
        )
      `,
          )
          .run(now, now);
        connection.exec(`
        UPDATE subscription_deliveries
        SET state = 'pending', batch_id = NULL, updated_at = '${now}'
        WHERE state = 'processing';
        UPDATE subscription_batches
        SET state = 'failed', updated_at = '${now}', last_error = 'Hub restarted during delivery'
        WHERE state = 'processing';
      `);
      },
    );
  }

  async updateSubscriberLocation(batchId: string, location: ChatResourceLocation): Promise<void> {
    const now = new Date().toISOString();
    await this.database.writeTransaction(
      'update subscription subscriber location',
      (connection) => {
        connection
          .prepare(
            `
          UPDATE subscription_batches
          SET subscriber_drone_id = ?, subscriber_chat_name = ?, updated_at = ?
          WHERE id = ? AND state = 'processing'
        `,
          )
          .run(location.droneId, location.chatName, now, batchId);
        connection
          .prepare(
            `
          UPDATE resource_subscriptions
          SET subscriber_drone_id = ?, subscriber_chat_name = ?, updated_at = ?
          WHERE subscriber_chat_id = ?
        `,
          )
          .run(location.droneId, location.chatName, now, location.chatId);
      },
    );
  }

  isBatchProcessing(batchId: string): boolean {
    return this.database.read((connection) =>
      Boolean(
        connection
          .prepare("SELECT 1 FROM subscription_batches WHERE id = ? AND state = 'processing'")
          .get(batchId),
      ),
    );
  }

  async releaseRejectedBatchItems(input: {
    batchId: string;
    rejected: ResourceSubscriptionBatchRejection[];
    remainingDeliveryIds: string[];
    retryLimit: number;
  }): Promise<void> {
    if (input.rejected.length === 0) return;
    const now = new Date();
    await this.database.writeTransaction(
      'release rejected subscription deliveries',
      (connection) => {
        const select = connection.prepare(`
        SELECT attempt_count FROM subscription_deliveries
        WHERE id = ? AND batch_id = ? AND state = 'processing'
      `);
        const update = connection.prepare(`
        UPDATE subscription_deliveries
        SET state = ?, attempt_count = ?, next_attempt_at = ?, batch_id = NULL,
          last_error = ?, updated_at = ?
        WHERE id = ? AND batch_id = ? AND state = 'processing'
      `);
        for (const rejection of input.rejected) {
          const row = select.get(rejection.deliveryId, input.batchId) as
            | { attempt_count: number }
            | undefined;
          if (!row) continue;
          const attempts = Number(row.attempt_count) + 1;
          const failed = rejection.permanent || attempts >= input.retryLimit;
          const nextAttemptAt = new Date(
            now.getTime() + Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 10)),
          ).toISOString();
          update.run(
            failed ? 'failed' : 'pending',
            attempts,
            nextAttemptAt,
            cleanString(rejection.error, 'subscription delivery rejected').slice(0, 1_000),
            now.toISOString(),
            rejection.deliveryId,
            input.batchId,
          );
        }

        if (input.remainingDeliveryIds.length > 0) {
          connection
            .prepare(
              `
            UPDATE subscription_batches
            SET delivery_ids_json = ?, event_count = ?, updated_at = ?
            WHERE id = ? AND state = 'processing'
          `,
            )
            .run(
              JSON.stringify(input.remainingDeliveryIds),
              input.remainingDeliveryIds.length,
              now.toISOString(),
              input.batchId,
            );
        } else {
          connection
            .prepare(
              `
            UPDATE subscription_batches
            SET state = 'failed', updated_at = ?, last_error = ?
            WHERE id = ? AND state = 'processing'
          `,
            )
            .run(
              now.toISOString(),
              cleanString(input.rejected[0]?.error, 'subscription delivery rejected').slice(
                0,
                1_000,
              ),
              input.batchId,
            );
        }
      },
    );
  }

  async claimBatch(
    settings: ResourceSubscriptionSettings,
    now = new Date(),
  ): Promise<ResourceSubscriptionBatch | null> {
    const nowIso = now.toISOString();
    const cutoff = new Date(now.getTime() - settings.batchWindowMs).toISOString();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    return await this.database.writeTransaction('claim subscription batch', (connection) => {
      const subscribers = connection
        .prepare(
          `
          SELECT s.subscriber_chat_id, s.subscriber_drone_id, s.subscriber_chat_name,
            MIN(d.created_at) AS oldest_delivery_at
          FROM subscription_deliveries d
          JOIN resource_subscriptions s ON s.id = d.subscription_id
          WHERE d.state = 'pending' AND d.available_at <= ? AND d.next_attempt_at <= ?
            AND s.status IN ('active', 'completed')
            AND (
              SELECT COUNT(*) FROM subscription_batches b
              WHERE b.subscriber_chat_id = s.subscriber_chat_id
                AND b.state = 'delivered' AND b.created_at >= ?
            ) < ?
          GROUP BY s.subscriber_chat_id, s.subscriber_drone_id, s.subscriber_chat_name
          ORDER BY oldest_delivery_at
          LIMIT 20
        `,
        )
        .all(cutoff, nowIso, hourAgo, settings.maxAutomatedRunsPerConversationPerHour) as Array<{
        subscriber_chat_id: string;
        subscriber_drone_id: string;
        subscriber_chat_name: string;
      }>;
      for (const subscriber of subscribers) {
        const rows = connection
          .prepare(
            `
            SELECT
              d.id AS delivery_id,
              s.id AS subscription_id,
              s.subscriber_chat_id,
              s.subscriber_drone_id,
              s.subscriber_chat_name,
              s.provider AS subscription_provider,
              s.resource_type AS subscription_resource_type,
              s.resource_id AS subscription_resource_id,
              s.resource_config_json,
              s.events_json,
              s.intent,
              s.status,
              s.pause_reasons_json,
              s.delivery_after,
              s.cursor_json,
              s.next_event_at,
              s.created_at AS subscription_created_at,
              s.updated_at AS subscription_updated_at,
              s.completed_at,
              s.last_error,
              e.*
            FROM subscription_deliveries d
            JOIN resource_subscriptions s ON s.id = d.subscription_id
            JOIN resource_events e ON e.id = d.event_id
            WHERE d.state = 'pending' AND d.available_at <= ? AND d.next_attempt_at <= ?
              AND s.subscriber_chat_id = ? AND s.status IN ('active', 'completed')
            ORDER BY e.occurred_at, d.created_at
            LIMIT ?
          `,
          )
          .all(
            cutoff,
            nowIso,
            subscriber.subscriber_chat_id,
            settings.maxEventsPerPrompt,
          ) as DeliveryJoinRow[];
        if (rows.length === 0) continue;
        const batchId = crypto.randomUUID();
        const promptId = `subscription-${batchId}`;
        const deliveryIds = rows.map((row) => row.delivery_id);
        connection
          .prepare(
            `
            INSERT INTO subscription_batches (
              id, subscriber_chat_id, subscriber_drone_id, subscriber_chat_name,
              prompt_id, delivery_ids_json, event_count, state, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)
          `,
          )
          .run(
            batchId,
            subscriber.subscriber_chat_id,
            subscriber.subscriber_drone_id,
            subscriber.subscriber_chat_name,
            promptId,
            JSON.stringify(deliveryIds),
            rows.length,
            nowIso,
            nowIso,
          );
        const mark = connection.prepare(`
          UPDATE subscription_deliveries
          SET state = 'processing', batch_id = ?, updated_at = ?
          WHERE id = ? AND state = 'pending'
        `);
        for (const id of deliveryIds) mark.run(batchId, nowIso, id);
        return {
          id: batchId,
          subscriber: {
            chatId: subscriber.subscriber_chat_id,
            droneId: subscriber.subscriber_drone_id,
            chatName: subscriber.subscriber_chat_name,
          },
          promptId,
          items: rows.map((row) => ({
            deliveryId: row.delivery_id,
            subscription: subscriptionFromRow({
              id: row.subscription_id,
              subscriber_chat_id: row.subscriber_chat_id,
              subscriber_drone_id: row.subscriber_drone_id,
              subscriber_chat_name: row.subscriber_chat_name,
              provider: row.subscription_provider,
              resource_type: row.subscription_resource_type,
              resource_id: row.subscription_resource_id,
              resource_config_json: row.resource_config_json,
              events_json: row.events_json,
              intent: row.intent,
              status: row.status,
              pause_reasons_json: row.pause_reasons_json,
              delivery_after: row.delivery_after,
              cursor_json: row.cursor_json,
              next_event_at: row.next_event_at,
              created_at: row.subscription_created_at,
              updated_at: row.subscription_updated_at,
              completed_at: row.completed_at,
              last_error: row.last_error,
            })!,
            event: eventFromRow(row),
          })),
        };
      }
      return null;
    });
  }

  async completeBatch(batchId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.database.writeTransaction('complete subscription batch', (connection) => {
      connection
        .prepare(
          `
          UPDATE subscription_deliveries
          SET state = 'delivered', delivered_at = ?, updated_at = ?, last_error = NULL
          WHERE batch_id = ? AND state = 'processing'
        `,
        )
        .run(now, now, batchId);
      connection
        .prepare(
          `
          UPDATE subscription_batches
          SET state = 'delivered', delivered_at = ?, updated_at = ?, last_error = NULL
          WHERE id = ? AND state = 'processing'
        `,
        )
        .run(now, now, batchId);
    });
  }

  async failBatch(batchId: string, errorRaw: string, retryLimit: number): Promise<void> {
    const now = new Date();
    const error = cleanString(errorRaw, 'subscription delivery failed').slice(0, 1_000);
    await this.database.writeTransaction('fail subscription batch', (connection) => {
      const alreadyQueued = connection
        .prepare(
          `
          SELECT 1
          FROM subscription_batches b
          JOIN prompts p
            ON p.drone_id = b.subscriber_drone_id
           AND p.chat_name = b.subscriber_chat_name
           AND p.prompt_id = b.prompt_id
          WHERE b.id = ?
        `,
        )
        .get(batchId);
      if (alreadyQueued) {
        connection
          .prepare(
            `
            UPDATE subscription_deliveries
            SET state = 'delivered', delivered_at = COALESCE(delivered_at, ?), updated_at = ?,
              last_error = NULL
            WHERE batch_id = ? AND state = 'processing'
          `,
          )
          .run(now.toISOString(), now.toISOString(), batchId);
        connection
          .prepare(
            `
            UPDATE subscription_batches
            SET state = 'delivered', delivered_at = COALESCE(delivered_at, ?), updated_at = ?,
              last_error = NULL
            WHERE id = ?
          `,
          )
          .run(now.toISOString(), now.toISOString(), batchId);
        return;
      }
      const rows = connection
        .prepare(
          `
          SELECT id, attempt_count FROM subscription_deliveries
          WHERE batch_id = ? AND state = 'processing'
        `,
        )
        .all(batchId) as Array<{ id: string; attempt_count: number }>;
      const update = connection.prepare(`
        UPDATE subscription_deliveries
        SET state = ?, attempt_count = ?, next_attempt_at = ?, batch_id = NULL,
          last_error = ?, updated_at = ?
        WHERE id = ?
      `);
      for (const row of rows) {
        const attempts = Number(row.attempt_count) + 1;
        const failed = attempts >= retryLimit;
        const nextAttemptAt = new Date(
          now.getTime() + Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 10)),
        ).toISOString();
        update.run(
          failed ? 'failed' : 'pending',
          attempts,
          nextAttemptAt,
          error,
          now.toISOString(),
          row.id,
        );
      }
      connection
        .prepare(
          `
          UPDATE subscription_batches SET state = 'failed', updated_at = ?, last_error = ?
          WHERE id = ?
        `,
        )
        .run(now.toISOString(), error, batchId);
    });
  }

  async cleanup(settings: ResourceSubscriptionSettings): Promise<void> {
    const now = Date.now();
    const eventCutoff = new Date(
      now - settings.terminalEventRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const deliveryCutoff = new Date(
      now - settings.deliveryRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    await this.database.writeTransaction('clean resource subscription history', (connection) => {
      connection
        .prepare(
          `
          DELETE FROM subscription_batches
          WHERE state IN ('delivered', 'failed') AND updated_at < ?
        `,
        )
        .run(deliveryCutoff);
      connection
        .prepare(
          `
          DELETE FROM subscription_deliveries
          WHERE state IN ('delivered', 'failed') AND updated_at < ?
        `,
        )
        .run(deliveryCutoff);
      connection
        .prepare(
          `
          DELETE FROM resource_events
          WHERE created_at < ?
            AND NOT EXISTS (
              SELECT 1 FROM subscription_deliveries d WHERE d.event_id = resource_events.id
            )
        `,
        )
        .run(eventCutoff);
    });
  }
}

function isChangeRequestEventAtOrBeforeBaseline(
  row: SubscriptionRow,
  event: ResourceEvent,
): boolean {
  if (event.provider !== 'drone-hub' || event.resourceType !== 'change_request') return false;
  const baseline = Number(parseObject(row.resource_config_json).stateVersion);
  const eventVersion = Number(event.providerContent.stateVersion);
  return (
    Number.isSafeInteger(baseline) &&
    baseline > 0 &&
    Number.isSafeInteger(eventVersion) &&
    eventVersion <= baseline
  );
}

function parseJson(raw: unknown): unknown {
  try {
    return JSON.parse(String(raw ?? ''));
  } catch {
    return null;
  }
}

function parseObject(raw: unknown): Record<string, unknown> {
  const value = parseJson(raw);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseEvents(raw: unknown): ResourceSubscriptionEventType[] {
  const value = parseJson(raw);
  return Array.isArray(value)
    ? (value.map((item) => cleanString(item)).filter(Boolean) as ResourceSubscriptionEventType[])
    : [];
}

function cleanString(raw: unknown, fallback = ''): string {
  const value = String(raw ?? '').trim();
  return value || fallback;
}

function subscriptionFromRow(row: SubscriptionRow | undefined): ResourceSubscription | null {
  if (!row) return null;
  return {
    id: row.id,
    subscriber: {
      chatId: row.subscriber_chat_id,
      droneId: row.subscriber_drone_id,
      chatName: row.subscriber_chat_name,
    },
    provider: row.provider,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceRef: resourceRef(row.provider, row.resource_type, row.resource_id),
    resourceConfig: parseObject(row.resource_config_json),
    events: parseEvents(row.events_json),
    intent: row.intent,
    status: row.status,
    pauseReasons: parseResourceSubscriptionPauseReasons(row.pause_reasons_json),
    cursor: parseObject(row.cursor_json),
    nextEventAt: row.next_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
  };
}

function eventFromRow(row: EventRow): ResourceEvent {
  return {
    id: row.id,
    providerEventId: row.provider_event_id,
    provider: row.provider,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    parentResourceId: row.parent_resource_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    summary: row.summary,
    providerContent: parseObject(row.provider_content_json),
  };
}

function isPresent<T>(value: T | null): value is T {
  return value != null;
}
