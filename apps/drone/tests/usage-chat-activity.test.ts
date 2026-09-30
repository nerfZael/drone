import { expect, test } from 'bun:test';
import { UsageStore } from '../src/hub/usage/UsageStore';

const observation = (id: string, input: number) => ({ id, input, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: null,
  model: 'test', provider: 'test', scope: 'request' as const, complete: true, raw: {} });

test('chat activity sums cost per chat by its current name and reports running work', () => {
  const store = new UsageStore(':memory:');
  try {
    store.addPrice({ provider: 'test', model: 'test', source: 'Fixture', effectiveAt: store.trackingSince,
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
    const later = new Date(Date.parse(store.trackingSince) + 60_000).toISOString();
    store.record({ id: 'first', chatId: 'c1', droneId: 'd1', chatName: 'plan', agent: 'codex', startedAt: store.trackingSince, status: 'completed' }, [observation('a', 90)]);
    store.record({ id: 'second', chatId: 'c1', droneId: 'd1', chatName: 'plan', agent: 'codex', startedAt: later, status: 'running' }, [observation('b', 40)]);
    store.record({ id: 'other', chatId: 'c2', droneId: 'd1', chatName: 'default', agent: 'codex', startedAt: store.trackingSince, status: 'completed' }, []);
    // Step summaries count toward the chat's cost but not its working time, and it is listed as running.
    store.record({ id: 'steps', chatId: 'c1', droneId: 'd1', chatName: 'plan', agent: 'native', purpose: 'steps', startedAt: later, status: 'running' }, [observation('s', 0)]);
    expect(store.runningChats().map(({ chatName, startedAt }) => ({ chatName, startedAt }))).toEqual([{ chatName: 'plan', startedAt: later }]);
    // A rename rebinds the chat: its card looks it up by the new name.
    store.bindChat('c1', 'd1', 'build');
    const rows = store.chatActivity({ droneId: 'd1' }).sort((a, b) => a.chatName.localeCompare(b.chatName));
    expect(rows.map(({ chatName, tokens, runningSince }) => ({ chatName, tokens, runningSince }))).toEqual([
      { chatName: 'build', tokens: 160, runningSince: later },
      { chatName: 'default', tokens: 0, runningSince: null },
    ]);
    expect(rows[0].estimatedCost).toBeGreaterThan(0);
    expect(rows[0].stepsCost).toBeCloseTo(0.00001, 8); // 10 output tokens at $1 per million.
    expect(rows[0].lastEndedAt).not.toBeNull();
    expect(store.chatActivity({ droneId: 'elsewhere' })).toEqual([]);
  } finally { store.close(); }
});
