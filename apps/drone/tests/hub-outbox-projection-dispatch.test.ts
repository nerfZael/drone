import { describe, expect, it } from 'bun:test';

import type { HubOutboxEvent } from '../src/host/hub-outbox';
import { dispatchChatOutboxProjection } from '../src/hub/hub-outbox-projection-dispatch';

function event(eventType: string, payload: unknown): HubOutboxEvent {
  return {
    id: 1,
    topic: 'chat.changes',
    eventType,
    payload,
    occurredAt: '2026-08-27T20:00:00.000Z',
    availableAt: '2026-08-27T20:00:00.000Z',
    status: 'delivered',
    attemptCount: 1,
  };
}

describe('chat outbox projection dispatch', () => {
  it('routes content changes to the exact chat projection', () => {
    const chats: string[] = [];
    let registryWrites = 0;
    const handled = dispatchChatOutboxProjection(
      event('chat.turn.changed', { droneId: 'drone-a', chatName: 'default' }),
      {
        notifyChatWrite: (droneId, chatName) => chats.push(`${droneId}/${chatName}`),
        notifyRegistryWrite: () => registryWrites++,
      },
    );

    expect(handled).toBe(true);
    expect(chats).toEqual(['drone-a/default']);
    expect(registryWrites).toBe(0);
  });

  it.each(['chat.created', 'chat.deleted', 'chat.archived', 'chat.restored', 'chat.renamed'])(
    'keeps %s on the full registry projection',
    (eventType) => {
      let chatWrites = 0;
      let registryWrites = 0;
      dispatchChatOutboxProjection(
        event(eventType, { droneId: 'drone-a', chatName: 'default' }),
        {
          notifyChatWrite: () => chatWrites++,
          notifyRegistryWrite: () => registryWrites++,
        },
      );
      expect(chatWrites).toBe(0);
      expect(registryWrites).toBe(1);
    },
  );

  it('falls back to a full refresh for malformed chat events', () => {
    let registryWrites = 0;
    dispatchChatOutboxProjection(event('chat.turn.changed', { droneId: 'drone-a' }), {
      notifyChatWrite: () => undefined,
      notifyRegistryWrite: () => registryWrites++,
    });
    expect(registryWrites).toBe(1);
  });

  it('leaves non-chat topics for their owner', () => {
    let writes = 0;
    const input = { ...event('drone.lifecycle.updated', {}), topic: 'drone.lifecycle.changes' };
    expect(
      dispatchChatOutboxProjection(input, {
        notifyChatWrite: () => writes++,
        notifyRegistryWrite: () => writes++,
      }),
    ).toBe(false);
    expect(writes).toBe(0);
  });
});
