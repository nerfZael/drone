import { appendHubOutboxEvent, type HubOutboxEvent } from '../../host/hub-outbox';
import type { HubDatabaseConnection } from '../../host/hub-database';
import {
  CHANGE_REQUEST_DOMAIN_EVENT_TYPES,
  type ChangeRequestDomainEvent,
} from './change-request-events';

export const CHANGE_REQUEST_OUTBOX_TOPIC = 'change-request.events';

export function appendChangeRequestOutboxEvent(
  connection: HubDatabaseConnection,
  event: ChangeRequestDomainEvent,
): void {
  appendHubOutboxEvent(connection, {
    topic: CHANGE_REQUEST_OUTBOX_TOPIC,
    eventType: event.eventType,
    aggregateType: 'change-request',
    aggregateId: String(event.requestNumber),
    payload: event,
    occurredAt: event.occurredAt,
    deduplicationKey: `change-request:${event.requestNumber}:v${event.stateVersion}`,
  });
}

export function changeRequestEventFromOutbox(
  outboxEvent: HubOutboxEvent,
): ChangeRequestDomainEvent | null {
  if (outboxEvent.topic !== CHANGE_REQUEST_OUTBOX_TOPIC) return null;
  const event = outboxEvent.payload as Partial<ChangeRequestDomainEvent> | null;
  if (
    !event ||
    typeof event.id !== 'string' ||
    !Number.isSafeInteger(event.requestNumber) ||
    !Number.isSafeInteger(event.stateVersion) ||
    !CHANGE_REQUEST_DOMAIN_EVENT_TYPES.includes(
      event.eventType as ChangeRequestDomainEvent['eventType'],
    ) ||
    typeof event.occurredAt !== 'string' ||
    !event.request ||
    typeof event.request !== 'object'
  ) {
    throw new Error(`invalid change request outbox event: ${outboxEvent.id}`);
  }
  return event as ChangeRequestDomainEvent;
}
