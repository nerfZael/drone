import { describe, expect, test } from 'bun:test';

import { DroneChatBroadcaster } from '../src/hub/drone-chat-broadcaster';

describe('DroneChatBroadcaster', () => {
  test('broadcasts known chat writes without rebuilding the full fleet model', async () => {
    let modelReads = 0;
    const events: Array<{ event: string; data: any }> = [];
    const broadcaster = new DroneChatBroadcaster({
      loadModel: async () => {
        modelReads += 1;
        return { drones: {} };
      },
      normalizeDroneId: (value) => String(value).trim(),
      normalizeChatName: (value) => String(value).trim(),
      nowIso: () => '2026-08-27T00:00:00.000Z',
      writeSseEvent: (_response, event, data) => events.push({ event, data }),
    });
    broadcaster.clients.add({ destroyed: false, writableEnded: false, write() {} } as any);
    broadcaster.lastByKey.set('drone-1\0default', 'existing');

    broadcaster.schedule(0, { droneId: 'drone-1', chatName: 'default' });
    await Bun.sleep(20);

    expect(modelReads).toBe(0);
    expect(events).toEqual([
      {
        event: 'chat_delta',
        data: {
          ok: true,
          chats: [{ droneId: 'drone-1', chatName: 'default' }],
          removed: [],
          at: '2026-08-27T00:00:00.000Z',
        },
      },
    ]);
    broadcaster.stop();
  });

  test('does not lose a targeted write that arrives during a full refresh', async () => {
    let releaseModel: (() => void) | null = null;
    let modelReadStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      modelReadStarted = resolve;
    });
    const events: Array<{ event: string; data: any }> = [];
    const broadcaster = new DroneChatBroadcaster({
      loadModel: async () => {
        modelReadStarted?.();
        await new Promise<void>((resolve) => {
          releaseModel = resolve;
        });
        return { drones: {} };
      },
      normalizeDroneId: (value) => String(value).trim(),
      normalizeChatName: (value) => String(value).trim(),
      nowIso: () => '2026-08-27T00:00:00.000Z',
      writeSseEvent: (_response, event, data) => events.push({ event, data }),
    });
    broadcaster.clients.add({ destroyed: false, writableEnded: false, write() {} } as any);
    broadcaster.lastByKey.set('existing\0default', 'existing');

    broadcaster.schedule(0);
    await started;
    broadcaster.schedule(0, { droneId: 'drone-1', chatName: 'default' });
    releaseModel?.();
    await Bun.sleep(30);

    expect(
      events.some(
        ({ event, data }) =>
          event === 'chat_delta' &&
          data.chats?.some(
            (chat: any) => chat.droneId === 'drone-1' && chat.chatName === 'default',
          ),
      ),
    ).toBe(true);
    broadcaster.stop();
  });
});
