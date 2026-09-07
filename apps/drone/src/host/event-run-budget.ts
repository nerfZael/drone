import type { HubDatabaseConnection } from './hub-database';

export class EventRunLimitError extends Error {
  constructor() {
    super('hourly event run limit reached');
  }
}

/** Called only when enqueue would create a new event prompt, inside its transaction. */
export function assertEventRunBudget(
  connection: HubDatabaseConnection,
  subscriberChatId: string,
  maxRuns: number,
  now: string,
): void {
  const hourAgo = new Date(Date.parse(now) - 60 * 60_000).toISOString();
  const row = connection
    .prepare(
      `
    SELECT COUNT(DISTINCT COALESCE(r.canonical_prompt_id, b.prompt_id)) AS count
    FROM subscription_batches b LEFT JOIN prompt_submission_receipts r
      ON r.drone_id = b.subscriber_drone_id
      AND r.idempotency_key = 'subscription-batch:' || b.id
    WHERE b.subscriber_chat_id = ? AND b.created_at >= ?
      AND (b.state = 'delivered' OR r.canonical_prompt_id IS NOT NULL)
  `,
    )
    .get(subscriberChatId, hourAgo) as { count: number };
  if (row.count >= maxRuns) throw new EventRunLimitError();
}
