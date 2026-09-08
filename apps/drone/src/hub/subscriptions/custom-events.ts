import crypto from 'node:crypto';
import type { ResourceEvent, ResourceSubscriptionSubscriber } from './resource-subscription-types';

export type CustomEventInfo = {
  name: string;
  description: string;
  createdAt: string;
  lastEmittedAt: string | null;
};

export type CustomEventSourceFilter = { sourceDroneId?: string; sourceChatId?: string };

export function customEventSearchText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function normalizeCustomEventName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 512) {
    throw new Error('custom event name must be a string of at most 512 characters');
  }
  const name = raw
    .normalize('NFKC')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  if (!name || name.length > 128 || !/\p{L}/u.test(name)) {
    throw new Error(
      'custom event name must contain a letter and normalize to at most 128 characters',
    );
  }
  return name;
}

export function customEventDescription(raw: unknown): string {
  if (raw === undefined) return '';
  if (typeof raw !== 'string' || raw.length > 2_000) {
    throw new Error('custom event description must be a string of at most 2000 characters');
  }
  return raw.trim();
}

export function customEventSourceFilter(input: CustomEventSourceFilter): CustomEventSourceFilter {
  const result: CustomEventSourceFilter = {};
  for (const key of ['sourceDroneId', 'sourceChatId'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > 200) {
      throw new Error(`${key} must be a nonempty ID of at most 200 characters`);
    }
    result[key] = value.trim();
  }
  return result;
}

export function customEventMatchesSource(
  filter: CustomEventSourceFilter,
  event: ResourceEvent,
): boolean {
  const source = event.providerContent.source as ResourceSubscriptionSubscriber | undefined;
  return Boolean(
    source?.droneId &&
    source?.chatId &&
    (!filter.sourceDroneId || filter.sourceDroneId === source.droneId) &&
    (!filter.sourceChatId || filter.sourceChatId === source.chatId),
  );
}

// Stable object ordering lets an idempotent retry serialize the same data in a different order.
export function customEventData(raw: unknown = {}): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('custom event data must be a JSON object');
  }
  const serialized = JSON.stringify(raw, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      );
    }
    return value;
  });
  if (Buffer.byteLength(serialized, 'utf8') > 16_000) {
    throw new Error('custom event data must be at most 16000 bytes of JSON');
  }
  return JSON.parse(serialized);
}

export function createCustomEvent(input: {
  name: string;
  source: ResourceSubscriptionSubscriber;
  data: Record<string, unknown>;
  idempotencyKey?: string;
}): ResourceEvent {
  if (
    input.idempotencyKey !== undefined &&
    (typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey.trim() ||
      input.idempotencyKey.length > 200)
  ) {
    throw new Error('idempotencyKey must be a nonempty string of at most 200 characters');
  }
  const id = crypto.randomUUID();
  const providerEventId =
    input.idempotencyKey === undefined
      ? `custom:${id}`
      : `custom:${crypto
          .createHash('sha256')
          .update(JSON.stringify([input.source.chatId, input.name, input.idempotencyKey]))
          .digest('hex')}`;
  return {
    id,
    providerEventId,
    provider: 'drone-hub',
    resourceType: 'custom_event',
    resourceId: input.name,
    parentResourceId: null,
    eventType: 'custom.emitted',
    occurredAt: new Date().toISOString(),
    summary: `Custom event ${input.name} was emitted.`,
    providerContent: { eventId: id, name: input.name, source: input.source, data: input.data },
  };
}
