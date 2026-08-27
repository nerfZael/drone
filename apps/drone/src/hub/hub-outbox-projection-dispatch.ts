import type { HubOutboxEvent } from '../host/hub-outbox';

const CHAT_TOPOLOGY_EVENT_TYPES = new Set([
  'chat.created',
  'chat.deleted',
  'chat.archived',
  'chat.restored',
  'chat.archive.deleted',
  'chat.renamed',
  'drone.chats.deleted',
]);

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Projects chat outbox events at the narrowest safe invalidation scope.
 * Returns false when the event belongs to another projection domain.
 */
export function dispatchChatOutboxProjection(
  event: HubOutboxEvent,
  deps: {
    notifyChatWrite: (droneId: string, chatName: string) => void;
    notifyRegistryWrite: () => void;
  },
): boolean {
  if (event.topic !== 'chat.changes') return false;
  const payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const droneId = cleanString(payload.droneId);
  const chatName = cleanString(payload.chatName);
  if (CHAT_TOPOLOGY_EVENT_TYPES.has(event.eventType) || !droneId || !chatName) {
    deps.notifyRegistryWrite();
  } else {
    deps.notifyChatWrite(droneId, chatName);
  }
  return true;
}
