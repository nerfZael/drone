import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';

import { HubRouter } from '../src/hub/hub-router';
import { registerDesktopEventRoutes } from '../src/hub/routes/desktop-event-routes';
import { hubChangeEvents } from '../src/hub/hub-change-events';

describe('desktop event routes', () => {
  test.each([false, true])('multiplexes events with notification opt-in %s', async (notifications) => {
    const writes: Array<{ event: string; data: any }> = [];
    let assistantSubscriber: ((data: any) => void) | null = null;
    let registrySubscriber: ((event: string, data: any) => void) | null = null;
    let chatSubscriber: ((event: string, data: any) => void) | null = null;
    const stopped: string[] = [];
    const registry = {
      snapshot: { ok: true, drones: [{ id: 'drone-a' }] },
      freshSnapshot: { ok: true, drones: [{ id: 'drone-a' }] },
      subscribe(subscriber: typeof registrySubscriber) {
        registrySubscriber = subscriber;
        return () => { registrySubscriber = null; };
      },
      start() {},
      schedule() {},
      refresh: async () => null,
      stopIfIdle: () => stopped.push('registry'),
    };
    const chat = {
      snapshot: {
        ok: true,
        chats: [{ droneId: 'drone-a', chatName: 'default' }],
        at: '2026-09-04T10:00:00.000Z',
      },
      subscribe(subscriber: typeof chatSubscriber) {
        chatSubscriber = subscriber;
        return () => { chatSubscriber = null; };
      },
      start() {},
      schedule() {},
      refresh: async () => {},
      stopIfIdle: () => stopped.push('chat'),
    };
    const router = new HubRouter(() => {}, async () => null);
    registerDesktopEventRoutes(router, {
      readNotificationStatus: async () => ({ droneName: 'Drone A', idle: true, reason: 'no_messages', latest: null }),
      assistantService: {
        subscribeChanges(subscriber) {
          assistantSubscriber = subscriber;
          return () => { assistantSubscriber = null; };
        },
      },
      droneRegistryBroadcaster: registry,
      droneChatBroadcaster: chat,
      nowIso: () => '2026-09-04T10:00:00.000Z',
      writeSseEvent: (_response, event, data) => writes.push({ event, data }),
    } as any);
    const req = Object.assign(new EventEmitter(), {
      method: 'GET',
      headers: {},
      socket: { setTimeout() {} },
    });
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      statusCode: 0,
      setHeader() {},
      flushHeaders() {},
      write() { return true; },
    });

    expect(
      await router.handle(req as any, res as any, new URL(`http://hub.test/api/desktop/events${notifications ? '?notifications=1' : ''}`)),
    ).toBe(true);
    assistantSubscriber?.({ threadId: 'assistant-1' });
    registrySubscriber?.('delta', { upserts: [{ id: 'drone-b' }] });
    chatSubscriber?.('chat_delta', { chats: [{ droneId: 'drone-a', chatName: 'default' }] });
    hubChangeEvents.emitResourceDeliveryChange();

    expect(writes.map(({ event }) => event)).toEqual([
      'connected',
      'registry_snapshot',
      'chat_snapshot',
      'assistant_change',
      'registry_delta',
      'chat_delta',
      'pending_events_changed',
    ]);
    const notification = { id: 'event-1', kind: 'message' as const, droneId: 'drone-a', droneName: 'Drone A', chatName: 'default', eventName: 'chat_message', body: 'Ready' };
    hubChangeEvents.emitDesktopNotification(notification);
    if (notifications) expect(writes.at(-1)).toEqual({ event: 'desktop_notification', data: notification });
    else expect(writes.at(-1)?.event).toBe('pending_events_changed');
    req.emit('close');
    const closedCount = writes.length;
    hubChangeEvents.emitDesktopNotification(notification);
    hubChangeEvents.emitResourceDeliveryChange();
    expect(writes.length).toBe(closedCount);
    expect(stopped).toEqual(['registry', 'chat']);
    expect(assistantSubscriber).toBeNull();
    expect(registrySubscriber).toBeNull();
    expect(chatSubscriber).toBeNull();
  });
});
