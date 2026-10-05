import { expect, test } from 'bun:test';
import path from 'node:path';

import { UsageStore } from '../src/hub/usage/UsageStore';
import { withTempDroneDataDir } from './test-helpers';

function helperCall(store: UsageStore, id: string, purpose: string, chat: { chatId?: string; droneId: string; chatName: string }, cost: number | null, status = 'completed') {
  store.record(
    { id, agent: 'native', purpose, startedAt: new Date().toISOString(), status, ...chat },
    [{ id, model: 'gpt-6-luna', provider: 'openai-codex', input: 100, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: 0,
      complete: true, scope: 'request', ...(cost === null ? {} : { reportedCost: cost }) } as any],
  );
}

test('helper purposes cost per chat and in total, follow renames, and never make a chat look busy', async () => {
  await withTempDroneDataDir('usage-helper-costs-', async (directory) => {
    const store = new UsageStore(path.join(directory, 'usage.sqlite'));
    try {
      store.bindChat('c1', 'd1', 'old name');
      helperCall(store, 'n1', 'next-actions', { chatId: 'c1', droneId: 'd1', chatName: 'old name' }, 0.01);
      helperCall(store, 'n2', 'next-actions', { chatId: 'c1', droneId: 'd1', chatName: 'old name' }, 0.02);
      helperCall(store, 'n3', 'next-actions', { droneId: 'd2', chatName: 'other' }, null);
      helperCall(store, 'a1', 'asks', { chatId: 'c1', droneId: 'd1', chatName: 'old name' }, 0.5, 'running');
      store.bindChat('c1', 'd1', 'new name');

      expect(store.purposeCost('next-actions')).toEqual({ cost: 0.03, calls: 3, unpriced: 1 });
      expect(store.purposeCost('next-actions', { chatId: 'c1' })).toEqual({ cost: 0.03, calls: 2, unpriced: 0 });
      expect(store.purposeCost('asks', { chatId: 'c1' }).calls).toBe(1);
      expect(store.purposeCostByChat('next-actions')).toEqual([
        { droneId: 'd1', chatName: 'new name', cost: 0.03, calls: 2, unpriced: 0 },
        { droneId: 'd2', chatName: 'other', cost: 0, calls: 1, unpriced: 1 },
      ]);
      // A helper call still running is not the chat's agent working.
      expect(store.runningChats()).toEqual([]);
      expect(store.chatActivity().find((chat) => chat.chatName === 'new name')?.runningSince ?? null).toBeNull();
    } finally {
      store.close();
    }
  });
});
