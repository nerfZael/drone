import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { HubDatabase } from '../../src/host/hub-database';
import { MobileChatLoadStore } from '../../src/hub/mobile-chat-load-store';

test('mobile telemetry persists, deduplicates by authenticated device and filters requests', async () => {
  const db = new Database(':memory:');
  const database = {
    read: (fn: any) => fn(db),
    writeTransaction: async (_name: string, fn: any) => db.transaction(() => fn(db))(),
  } as HubDatabase;
  try {
    const store = new MobileChatLoadStore(database);
    const record = {
      version: 1,
      navigationId: 'nav',
      targetDeviceId: 'hub',
      droneId: 'drone',
      chatName: 'default',
      platform: 'android',
      startedAt: new Date().toISOString(),
      durationMs: 123,
      status: 'completed',
      milestones: {},
      requests: [
        {
          requestId: 'mesh-id',
          serverRequestId: 'http-id',
          operation: 'chat.read',
          outcome: 'completed',
          timings: { fetchMs: 100 },
        },
      ],
      sourceDeviceId: 'spoof',
    };
    await store.upload('phone', [record]);
    await store.upload('phone', [record]);
    const reopened = new MobileChatLoadStore(database);
    assert.equal(reopened.list({}).length, 1);
    assert.equal(
      reopened.list({ deviceId: 'phone', requestId: 'http-id' })[0].sourceDeviceId,
      'phone',
    );
    assert.equal(reopened.list({ deviceId: 'spoof' }).length, 0);
    await store.upload('other-phone', [record]);
    assert.equal(reopened.list({}).length, 2);
    await assert.rejects(store.upload('phone', [{ ...record, durationMs: -1 }]));
    assert.equal(reopened.list({ requestId: 'mesh-id' }).length, 2);
    assert.equal(reopened.list({ since: '2099-01-01T00:00:00Z' }).length, 0);
    await assert.rejects(store.upload('phone', Array(11).fill(record)));
    for (let offset = 0; offset < 2010; offset += 10) {
      await store.upload(
        'phone',
        Array.from({ length: 10 }, (_, i) => ({
          ...record,
          navigationId: `retained-${offset + i}`,
        })),
      );
    }
    assert.equal(
      (
        db
          .prepare('SELECT count(*) AS count FROM mobile_chat_loads WHERE source_device_id = ?')
          .get('phone') as { count: number }
      ).count,
      2000,
    );
    assert.equal(reopened.list({ deviceId: 'other-phone' }).length, 1);
  } finally {
    db.close();
  }
});
