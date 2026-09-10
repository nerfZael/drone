import { expect, test } from 'bun:test';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { getUsageStore } from '../src/hub/usage/UsageStore';
import { NativeUsageOutbox } from '../src/hub/usage/NativeUsageOutbox';
import { withTempDroneDataDir } from './test-helpers';

test('native transcript forks, repeated delivery, compaction and deletion preserve execution accounting', async () => {
  await withTempDroneDataDir('native-usage-', async (directory) => {
    const repository = new HubSessionRepository(path.join(directory, 'assistant.sqlite'));
    const store = getUsageStore();
    const input = { workspaceRoot: directory, provider: 'test', model: 'test',
      permissionMode: 'workspace-write' as const, toolProfile: 'no-shell-workspace-write' as const };
    const session = await repository.create(input);
    await repository.bindThread('original', session.id);
    const event = { version: 1 as const, eventId: 'usage1', sessionId: session.id, turnId: 'turn1',
      timestamp: new Date().toISOString(), type: 'usage_observed' as const, model: 'test', provider: 'test',
      purpose: 'chat' as const, complete: true,
      usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, reasoning: 3, totalTokens: 135 } };
    try {
      await repository.appendRuntimeEvent(session, event);
      await repository.appendRuntimeEvent(session, event);
      const clone = await repository.fork(session, input);
      await repository.bindThread('clone', clone.id);
      expect(store.analytics().totals.total).toBe(135);
      expect(store.analytics({ chatId: 'clone' }).totals.executions).toBe(0);
      await repository.appendRuntimeEvent(clone, { ...event, eventId: 'usage2', sessionId: clone.id, turnId: 'turn2' });
      await repository.appendRuntimeEvent(clone, { ...event, eventId: 'compaction', sessionId: clone.id, purpose: 'compaction' });
      expect(store.analytics({ chatId: 'clone' }).totals.total).toBe(270);
      expect(store.analytics({ groupBy: 'purpose' }).groups.find((group) => group.key === 'compaction')?.total).toBe(135);
      await repository.delete(clone.id);
      await expect(repository.load(clone.id)).rejects.toThrow();
      expect(store.analytics().totals.total).toBe(405);
    } finally { repository.close(); }
  });
});

test('native outbox recovers queued events after restart even without a surviving chat binding', async () => {
  await withTempDroneDataDir('native-outbox-', async (directory) => {
    const file = path.join(directory, 'outbox.sqlite');
    const db = new Database(file);
    const outbox = new NativeUsageOutbox(db);
    db.prepare('INSERT INTO usage_outbox VALUES (?,?,?)').run('retained', 'deleted-chat', JSON.stringify({
      type: 'usage_observed', eventId: 'retained', sessionId: 'session', turnId: 'turn',
      timestamp: new Date().toISOString(), model: 'test', provider: 'test', purpose: 'chat', complete: true,
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    }));
    // A second connection represents startup after the writer stopped before delivery.
    const recovered = new Database(file);
    const restarted = new NativeUsageOutbox(recovered);
    try {
      restarted.drain();
      outbox.drain();
      expect(getUsageStore().analytics().totals.total).toBe(3);
      expect(db.query('SELECT COUNT(*) AS n FROM usage_outbox').get()).toEqual({ n: 0 });
    } finally {
      restarted.close(); recovered.close(); outbox.close(); db.close();
    }
  });
});
