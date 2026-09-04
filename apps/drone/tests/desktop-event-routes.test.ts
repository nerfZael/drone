import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';

import { HubRouter } from '../src/hub/hub-router';
import { registerDesktopEventRoutes } from '../src/hub/routes/desktop-event-routes';

describe('desktop event routes', () => {
  test('multiplexes assistant, registry, and chat events onto one SSE response', async () => {
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
      await router.handle(req as any, res as any, new URL('http://hub.test/api/desktop/events')),
    ).toBe(true);
    assistantSubscriber?.({ threadId: 'assistant-1' });
    registrySubscriber?.('delta', { upserts: [{ id: 'drone-b' }] });
    chatSubscriber?.('chat_delta', { chats: [{ droneId: 'drone-a', chatName: 'default' }] });

    expect(writes.map(({ event }) => event)).toEqual([
      'connected',
      'registry_snapshot',
      'chat_snapshot',
      'assistant_change',
      'registry_delta',
      'chat_delta',
    ]);
    req.emit('close');
    expect(stopped).toEqual(['registry', 'chat']);
    expect(assistantSubscriber).toBeNull();
    expect(registrySubscriber).toBeNull();
    expect(chatSubscriber).toBeNull();
  });
});
