import { describe, expect, test } from 'bun:test';
import { AgentUsageAccumulator } from '../src/hub/usage/AgentUsageAccumulator';
import { UsageStore } from '../src/hub/usage/UsageStore';
import { CodexUsageTracker } from '../src/CodexUsageTracker';
import { parseBuiltinPromptJobTranscript } from '../src/hub/builtin-transcript-sessions';
import { refreshUsagePrices } from '../src/hub/usage/refreshUsagePrices';

const count = { input: 100, output: 20, cacheRead: 50, cacheWrite: 10, reasoning: 5 };
const observation = { ...count, id: 'request', model: 'model', provider: 'provider', scope: 'request' as const, complete: true, raw: {} };
const parse = (agent: string, events: unknown[]) => {
  const accumulator = new AgentUsageAccumulator(agent);
  for (const event of events) accumulator.pushLine(JSON.stringify(event));
  return accumulator.result();
};

describe('new usage accounting', () => {
  test('cloned history is not ingested, run replay is idempotent, reasoning is not counted twice', () => {
    const store = new UsageStore(':memory:');
    try {
      const execution = { id: 'run', chatId: 'original', agent: 'native', startedAt: store.trackingSince, status: 'completed' };
      store.record(execution, [observation]);
      store.record(execution, [observation]);
      expect(store.analytics().totals.total).toBe(180);
      expect(store.analytics({ chatId: 'clone' }).totals.executions).toBe(0);
      store.record({ ...execution, id: 'clone-new-request', chatId: 'clone' }, [observation]);
      expect(store.analytics().totals.total).toBe(360);
      expect(store.analytics({ chatId: 'clone' }).totals.total).toBe(180);
      store.record({ ...execution, id: 'old', startedAt: '2020-01-01T00:00:00.000Z' }, [observation]);
      expect(store.analytics().totals.executions).toBe(2);
    } finally { store.close(); }
  });

  test('prices are versioned and existing estimates stay pinned after replay', () => {
    const store = new UsageStore(':memory:');
    try {
      const price = { provider: 'provider', model: 'model', effectiveAt: store.trackingSince, source: 'test', input: 1, output: 10, cacheRead: 0.1, cacheWrite: 2 };
      store.addPrice(price);
      const run = { id: 'run', agent: 'native', startedAt: store.trackingSince, status: 'completed' };
      store.record(run, [observation]);
      const cost = store.analytics().totals.estimatedCost;
      expect(cost).toBeCloseTo(0.000325, 9);
      store.addPrice({ ...price, input: 100 });
      store.record(run, [observation]);
      expect(store.analytics().totals.estimatedCost).toBe(cost);
      expect(store.prices()).toHaveLength(2);
      expect(() => store.addPrice({ ...price, input: -1 })).toThrow();
    } finally { store.close(); }
  });

  test('missing tokens and prices are not presented as free or zero', () => {
    const store = new UsageStore(':memory:');
    try {
      store.record({ id: 'missing', agent: 'cursor', startedAt: store.trackingSince, status: 'failed' }, []);
      expect(store.analytics().totals.total).toBeNull();
      expect(store.analytics().totals.missing).toBe(1);
      store.record({ id: 'known', agent: 'cursor', startedAt: store.trackingSince, status: 'done' }, [observation]);
      expect(store.analytics().totals.estimatedCost).toBeNull();
      expect(store.analytics().totals.unpriced).toBe(1);
    } finally { store.close(); }
  });
});

test('Claude whole-tree model usage replaces provisional assistant usage and includes multiple models', () => {
  const events = [
    { type: 'assistant', message: { id: 'msg', model: 'large', usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } },
    { type: 'result', modelUsage: {
      large: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 10, cacheCreationInputTokens: 5, costUSD: 0.01 },
      small: { inputTokens: 50, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.001 },
    } },
  ];
  const items = parse('claude', [...events, events[1]]);
  expect(items).toHaveLength(2);
  expect(items.map((item) => item.output)).toEqual([20, 10]);
  expect(items.every((item) => item.scope === 'tree')).toBe(true);
});

test('Cursor emitted input is already net of cache, and reasoning remains unknown', () => {
  const items = parse('cursor', [{ type: 'result', request_id: 'r', usage: { inputTokens: 5, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 50 } }]);
  expect(items[0].input).toBe(5);
  expect(items[0].reasoning).toBeNull();
});

test('OpenCode counts reasoning once and server snapshots replace root CLI observations', () => {
  const step = { type: 'step_finish', part: { id: 'step', tokens: { input: 2, output: 3, reasoning: 7, cache: { read: 10, write: 4 } } } };
  expect(parse('opencode', [step])[0].output).toBe(10);
  const items = parse('opencode', [step, { type: 'usage.snapshot', observations: [observation, { ...observation, id: 'child' }] }]);
  expect(items.map((item) => item.id)).toEqual(['request', 'child']);
});

test('Codex excludes restored totals, repeated notifications and resets', () => {
  const tracker = new CodexUsageTracker();
  const totals = (input: number) => ({ inputTokens: input, outputTokens: 20, cachedInputTokens: 10, cacheWriteInputTokens: 5, reasoningOutputTokens: 2, totalTokens: input + 20 });
  const usage = (input: number, turnId = 'new') => ({ method: 'thread/tokenUsage/updated', params: { threadId: 'fork', turnId, tokenUsage: { total: totals(input), last: totals(input) } } });
  expect(tracker.observe(usage(1000, 'inherited'))).toEqual([]);
  tracker.observe({ method: 'turn/started', params: { threadId: 'fork', turn: { id: 'new' } } });
  const events = tracker.observe(usage(1100));
  expect(parse('codex', events)[0].input).toBe(100);
  expect(tracker.observe(usage(1100))).toEqual([]);
  expect(tracker.observe(usage(5))).toEqual([]);
  expect(tracker.observe(usage(1100))).toEqual([]);
  expect(parse('codex', tracker.observe(usage(1110)))[0].input).toBe(10);
});

test('OpenCode overlapping snapshots and later CLI steps count each message once', () => {
  const step = (id: string, messageID: string) => ({ type: 'step_finish', part: { id, messageID,
    tokens: { input: 100, output: 15, reasoning: 5, cache: { read: 50, write: 10 } } } });
  const snapshot = (complete: boolean) => ({ type: 'usage.snapshot', observations: [{ ...observation, complete }] });
  const accumulator = new AgentUsageAccumulator('opencode');
  for (const event of [step('step', 'request'), snapshot(true), step('step', 'request'), step('new-step', 'new-request')]) {
    accumulator.pushLine(JSON.stringify(event));
  }
  expect(accumulator.result().map((item) => item.id)).toEqual(['request', 'new-step']);
  expect(accumulator.result().reduce((sum, item) => sum + item.input!, 0)).toBe(200);
  // An incomplete snapshot must not hide newer completed CLI steps if the next read fails.
  expect(parse('opencode', [snapshot(false), step('step', 'request')]).map((item) => item.id)).toEqual(['step']);
});

test('Claude empty model aggregates still preserve available final root usage', () => {
  const items = parse('claude', [{ type: 'result', model: 'large', modelUsage: {},
    usage: { input_tokens: 12, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }]);
  expect(items).toHaveLength(1);
  expect(items[0].output).toBe(20);
  expect(items[0].complete).toBe(false);
});

test('correcting a provisional model also corrects its pinned price', () => {
  const store = new UsageStore(':memory:');
  try {
    const price = { provider: 'provider', model: 'model', effectiveAt: store.trackingSince,
      source: 'test', input: 1, output: 1, cacheRead: 1, cacheWrite: 1 };
    store.addPrice(price);
    store.addPrice({ ...price, model: 'actual', input: 10 });
    const run = { id: 'run', agent: 'native', startedAt: store.trackingSince, status: 'completed' };
    store.record(run, [observation]);
    store.record(run, [{ ...observation, model: 'actual' }]);
    expect(store.analytics().totals.estimatedCost).toBeCloseTo(0.00108, 9);
  } finally { store.close(); }
});

test('usage survives durable transcript projection for all external parsers', () => {
  const cursor = parseBuiltinPromptJobTranscript('cursor', JSON.stringify({ type: 'result', request_id: 'r', result: 'done', usage: { inputTokens: 5, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } }));
  expect(cursor?.usage?.[0].input).toBe(5);
  const codex = parseBuiltinPromptJobTranscript('codex', JSON.stringify({ type: 'usage.delta', eventId: 'r', usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 40, cacheWriteInputTokens: 5 } }));
  expect(codex?.usage?.[0].input).toBe(55);
});

test('late running snapshots cannot erase final usage or reopen an execution', () => {
  const store = new UsageStore(':memory:');
  try {
    const execution = { id: 'r', agent: 'codex', startedAt: store.trackingSince, status: 'done' };
    store.record(execution, [observation]);
    store.record({ ...execution, status: 'running' }, []);
    expect(store.analytics().totals.total).toBe(180);
    expect(store.analytics().totals.running).toBe(0);
    store.record({ ...execution, status: 'running' }, [observation], false);
    expect(store.analytics().totals.running).toBe(0);
  } finally { store.close(); }
});

test('zeroed Claude crash results retain earlier input usage', () => {
  const items = parse('claude', [
    { type: 'assistant', message: { id: 'msg', model: 'large', usage: { input_tokens: 12 } } },
    { type: 'result', modelUsage: { large: { inputTokens: 0, outputTokens: 0, contextWindow: 200000 } } },
  ]);
  expect(items).toHaveLength(1);
  expect(items[0].input).toBe(12);
  expect(items[0].output).toBeNull();
  expect(items[0].complete).toBe(false);
});

test('catalog refresh versions changed prices, skips unchanged rates and preserves manual prices', async () => {
  const store = new UsageStore(':memory:');
  let input = 1;
  const fetcher = (async () => Response.json({ openai: { models: {
    model: { cost: { input, output: 2, cache_read: 0.1 } },
  } } })) as typeof fetch;
  try {
    expect(await refreshUsagePrices(store, fetcher)).toBe(2);
    expect(await refreshUsagePrices(store, fetcher)).toBe(0);
    store.addPrice({ provider: 'openai', model: 'model', effectiveAt: new Date().toISOString(),
      input: 9, output: 9, cacheRead: 9, cacheWrite: 9, source: 'My negotiated rate' });
    input = 3;
    expect(await refreshUsagePrices(store, fetcher)).toBe(1);
    expect(store.prices().filter((price) => price.provider === 'openai')).toHaveLength(2);
  } finally { store.close(); }
});

test('an absent cache price only prevents estimation when cached tokens were used', () => {
  const store = new UsageStore(':memory:');
  try {
    store.addPrice({ provider: 'provider', model: 'model', source: 'test', effectiveAt: store.trackingSince,
      input: 1, output: 2, cacheRead: null, cacheWrite: null });
    const run = { id: 'cache', agent: 'native', startedAt: store.trackingSince, status: 'completed' };
    store.record(run, [observation]);
    expect(store.analytics().totals.estimatedCost).toBeNull();
    store.record({ ...run, id: 'uncached', chatId: 'uncached' }, [{ ...observation, cacheRead: 0, cacheWrite: 0 }]);
    expect(store.analytics({ chatId: 'uncached' }).totals.estimatedCost).toBeCloseTo(0.00014, 9);
  } finally { store.close(); }
});

test('Codex preserves OpenRouter usage attribution', () => {
  const tracker = new CodexUsageTracker();
  tracker.observe({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } });
  const events = tracker.observe({ method: 'thread/tokenUsage/updated', params: {
    threadId: 'thread', turnId: 'turn', tokenUsage: {
      total: { inputTokens: 10, outputTokens: 3 }, last: { inputTokens: 10, outputTokens: 3 },
    },
  } }, 'vendor/model', 'openrouter');
  expect(events[0]).toMatchObject({ provider: 'openrouter', model: 'vendor/model' });
  expect(parse('codex', events)[0]).toMatchObject({ provider: 'openrouter', model: 'vendor/model' });
});
