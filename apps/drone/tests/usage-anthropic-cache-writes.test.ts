import { expect, test } from 'bun:test';
import { estimateUsageCost, type UsagePrice } from '@drone/assistant-chat';
import { UsageStore } from '../src/hub/usage/UsageStore';

const opus55: UsagePrice = { id: 'p', provider: 'anthropic', model: 'claude-opus-5-5', effectiveAt: '2026-01-01T00:00:00.000Z',
  input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, source: 'test', createdAt: '2026-01-01T00:00:00.000Z' };
const counts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000, reasoning: null };

test('1-hour cache writes cost twice the input rate for Anthropic, or the price own 1-hour rate', () => {
  expect(estimateUsageCost(opus55, counts)).toBeCloseTo(5, 6);
  expect(estimateUsageCost(opus55, { ...counts, cacheWrite1h: 1_000_000 })).toBeCloseTo(8, 6);
  expect(estimateUsageCost(opus55, { ...counts, cacheWrite1h: 250_000 })).toBeCloseTo(5.75, 6);
  expect(estimateUsageCost({ ...opus55, cacheWrite1h: 9 }, { ...counts, cacheWrite1h: 1_000_000 })).toBeCloseTo(9, 6);
  // Other providers keep one cache-write rate.
  expect(estimateUsageCost({ ...opus55, provider: 'openai' }, { ...counts, cacheWrite1h: 1_000_000 })).toBeCloseTo(5, 6);
});

test('Claude Opus 5.5 is priced, its 1-hour cache writes are told apart, and finished Claude turns cost what Claude reported', () => {
  const store = new UsageStore(':memory:');
  try {
    expect(store.currentPrice('anthropic', 'claude-opus-5-5')).toMatchObject({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 });
    const at = new Date(Date.parse(store.trackingSince) + 60_000).toISOString();
    const base = { model: 'claude-opus-5-5', provider: 'anthropic', complete: true, input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000, reasoning: null };
    // A request says which of its writes were kept for an hour.
    store.record({ id: 'running', chatId: 'c1', droneId: 'd1', chatName: 'plan', agent: 'claude', startedAt: at, status: 'done' }, [{
      ...base, id: 'msg_1', scope: 'request', raw: { cache_creation: { ephemeral_5m_input_tokens: 750_000, ephemeral_1h_input_tokens: 250_000 } },
    }]);
    // A finished Claude turn costs what Claude reported, whatever the Hub's price would say.
    store.record({ id: 'turn', chatId: 'c2', droneId: 'd1', chatName: 'build', agent: 'claude', startedAt: at, status: 'done' }, [{
      ...base, id: 'model:claude-opus-5-5', scope: 'tree', sessionId: 's1', reportedCost: 6.5, raw: {},
    }]);
    const cost = Object.fromEntries(store.chatActivity({ droneId: 'd1' }).map((row) => [row.chatName, row.estimatedCost]));
    expect(cost.plan).toBeCloseTo(5.75, 6);
    expect(cost.build).toBeCloseTo(6.5, 6);
    const build = store.chatActivity({ droneId: 'd1' }).find((row) => row.chatName === 'build')!;
    expect(build.reported).toBe(1);
  } finally { store.close(); }
});
