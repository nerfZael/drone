import type { HubDatabase } from '../../host/hub-database';
import { resourceSubscriptionDeliveryMode } from './resource-subscription-delivery';
import type {
  ResourceSubscriptionEventType,
  ResourceSubscriptionSettings,
} from './resource-subscription-types';
import { subscriptionRunCapacitySql } from './subscription-run-capacity';

export type PendingSubscriptionDelivery = {
  id: string;
  subscriberChatId: string;
  resourceId: string;
  resourceType: string;
  eventType: string;
  summary: string;
  deliveryMode: 'queue' | 'asap';
  status: 'batching' | 'ready' | 'releasing' | 'paused' | 'rate-limited' | 'retrying' | 'failed';
  releaseAt: string | null;
  canRelease: boolean;
  error: string | null;
};

export function readPendingSubscriptionDeliveries(
  database: HubDatabase,
  droneId: string,
  chatName: string,
  settings: ResourceSubscriptionSettings,
  now: Date,
): { serverNow: string; deliveries: PendingSubscriptionDelivery[] } {
  const rows = database.read(
    (connection) =>
      connection
        .prepare(
          `
    SELECT d.id, d.state, d.available_at, d.next_attempt_at, d.last_error,
      s.subscriber_chat_id, s.status AS subscription_status,
      e.resource_id, e.resource_type, e.event_type, e.summary,
      CASE WHEN ${subscriptionRunCapacitySql} THEN 1 ELSE 0 END AS has_capacity
    FROM subscription_deliveries d
    JOIN resource_subscriptions s ON s.id = d.subscription_id
    JOIN resource_events e ON e.id = d.event_id
    LEFT JOIN subscription_batches b ON b.id = d.batch_id
    WHERE s.subscriber_drone_id = ? AND s.subscriber_chat_name = ?
      AND s.status IN ('active', 'completed', 'paused')
      AND (d.state IN ('pending', 'processing') OR (d.state = 'failed' AND d.attempt_count >= ?))
      AND NOT EXISTS (
        SELECT 1 FROM prompts p WHERE p.drone_id = s.subscriber_drone_id
          AND p.prompt_id = COALESCE((SELECT canonical_prompt_id FROM prompt_submission_receipts r
            WHERE r.drone_id = s.subscriber_drone_id
              AND r.idempotency_key = 'subscription-batch:' || b.id), b.prompt_id)
      )
    ORDER BY d.created_at, d.id
  `,
        )
        .all(
          new Date(now.getTime() - 3_600_000).toISOString(),
          settings.maxAutomatedRunsPerConversationPerHour,
          settings.maxEventsPerPrompt,
          JSON.stringify(settings.eventDeliveryModes),
          settings.deliveryMode,
          droneId,
          chatName,
          settings.deliveryRetryLimit,
        ) as Array<{
        id: string;
        state: string;
        available_at: string;
        next_attempt_at: string;
        last_error: string | null;
        subscriber_chat_id: string;
        subscription_status: string;
        resource_id: string;
        resource_type: string;
        event_type: ResourceSubscriptionEventType;
        summary: string;
        has_capacity: number;
      }>,
  );
  return {
    serverNow: now.toISOString(),
    deliveries: rows.map((row) => {
      const batchAt = Date.parse(row.available_at) + settings.batchWindowMs;
      const retryAt = Date.parse(row.next_attempt_at);
      const releaseAt = Math.max(batchAt, retryAt);
      const status: PendingSubscriptionDelivery['status'] =
        row.state === 'failed'
          ? 'failed'
          : row.state === 'processing'
            ? 'releasing'
            : !settings.enabled || row.subscription_status === 'paused'
              ? 'paused'
              : !row.has_capacity
                ? 'rate-limited'
                : retryAt > now.getTime() && row.last_error
                  ? 'retrying'
                  : releaseAt > now.getTime()
                    ? 'batching'
                    : 'ready';
      return {
        id: row.id,
        subscriberChatId: row.subscriber_chat_id,
        resourceId: row.resource_id,
        resourceType: row.resource_type,
        eventType: row.event_type,
        summary: row.summary,
        deliveryMode: resourceSubscriptionDeliveryMode(settings, row.event_type),
        status,
        releaseAt: ['batching', 'ready', 'retrying'].includes(status)
          ? new Date(releaseAt).toISOString()
          : null,
        canRelease:
          (status === 'batching' || status === 'ready') &&
          retryAt <= now.getTime() &&
          Date.parse(row.available_at) <= now.getTime(),
        error: row.last_error,
      };
    }),
  };
}
