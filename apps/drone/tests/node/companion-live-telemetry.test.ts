import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryHubDatabase } from './helpers/memory-hub-database';
import { CompanionLiveTelemetry } from '../../src/hub/companion/companion-live-telemetry';

test('Live timing survives service recreation, deduplicates batches and bounds persistent retention', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const store = new CompanionLiveTelemetry(database);
    const event = { sessionId: 'live-test', sequence: 1, stage: 'session_started', elapsedMs: 0, resultSequence: 0, audio: 'private' };
    await store.record('live-test', 'client', [event, event]);
    const reopened = new CompanionLiveTelemetry(database);
    assert.equal(reopened.events('live-test').length, 1);
    assert.equal(JSON.stringify(reopened.events()).includes('private'), false);
    for (let i = 0; i < 101; i++) await reopened.record(`live-${i}`, 'client', [{ ...event, sessionId: `live-${i}` }]);
    const count = database.read(db => db.prepare('SELECT COUNT(DISTINCT session_id) AS count FROM companion_live_timing').get()) as { count: number };
    assert.equal(count.count, 100);
  } finally { close(); }
});
