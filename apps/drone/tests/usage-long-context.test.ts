import { expect, test } from 'bun:test';
import { estimateUsageCost, type UsagePrice } from '@drone/assistant-chat';
import { applyBundledPrices } from '../src/hub/usage/bundledPrices';
import { refreshUsagePrices } from '../src/hub/usage/refreshUsagePrices';
import { UsageStore } from '../src/hub/usage/UsageStore';

const sol: UsagePrice = {
  id: 'p', provider: 'openai-codex', model: 'gpt-6-sol', effectiveAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', source: 'test',
  input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10,
  longContext: { inputTokensAbove: 272_000, input: 4, cacheRead: 0.4, cacheWrite: 5, output: 15 },
};

test('a request is priced at list rates, each token category at its own rate, and above the threshold at long-context rates', () => {
  // Input excludes the cached tokens; the threshold counts the request's whole input, cache included.
  expect(estimateUsageCost(sol, { input: 1_000, cacheRead: 1_000, cacheWrite: 1_000, output: 100, reasoning: null })).toBeCloseTo(0.002 + 0.0002 + 0.0025 + 0.001, 10);
  expect(estimateUsageCost(sol, { input: 100_000, cacheRead: 150_000, cacheWrite: 30_000, output: 10_000, reasoning: null })).toBeCloseTo(0.4 + 0.06 + 0.15 + 0.15, 10);
  expect(estimateUsageCost(sol, { input: 100_000, cacheRead: 150_000, cacheWrite: 20_000, output: 10_000, reasoning: null })).toBeCloseTo(0.2 + 0.03 + 0.05 + 0.1, 10);
  expect(estimateUsageCost({ ...sol, cacheWrite: null }, { input: 10, cacheRead: 0, cacheWrite: 5, output: 1, reasoning: null })).toBeNull();
  expect(estimateUsageCost(undefined, { input: 10, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: null })).toBeNull();
  // A total over many requests is not one long request: base rates.
  expect(estimateUsageCost(sol, { input: 100_000, cacheRead: 150_000, cacheWrite: 30_000, output: 10_000, reasoning: null }, false)).toBeCloseTo(0.2 + 0.03 + 0.075 + 0.1, 10);
});

test('bundled long-context rates join the catalog price, survive a catalog refresh, and leave manual prices alone', async () => {
  const store = new UsageStore(':memory:');
  const fetcher = (async () => Response.json({ openai: { models: {
    'gpt-6-sol': { cost: { input: 2, output: 10, cache_read: 0.2 } },
    'gpt-6-luna': { cost: { input: 0.1, output: 0.5, cache_read: 0.01 } },
  } } })) as unknown as typeof fetch;
  await refreshUsagePrices(store, fetcher);
  await new Promise(r => setTimeout(r, 5));
  store.addPrice({ provider: 'openai', model: 'gpt-6-luna', effectiveAt: new Date().toISOString(), source: 'mine', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: null, origin: 'manual' });
  expect(applyBundledPrices(store)).toBe(3); // sol for both providers, luna for openai-codex; the manual openai luna stays
  expect(applyBundledPrices(store)).toBe(0);
  const codexSol = store.currentPrice('openai-codex', 'gpt-6-sol')!;
  expect(codexSol).toMatchObject({ input: 2, cacheWrite: 2.5, origin: 'bundled', longContext: { inputTokensAbove: 272_000, output: 15 } });
  expect(store.currentPrice('openai', 'gpt-6-luna')).toMatchObject({ origin: 'manual' });
  // A later catalog change keeps the long-context rates.
  const raised = (async () => Response.json({ openai: { models: { 'gpt-6-sol': { cost: { input: 3, output: 12, cache_read: 0.3 } } } } })) as unknown as typeof fetch;
  await new Promise(r => setTimeout(r, 5));
  await refreshUsagePrices(store, raised);
  expect(store.currentPrice('openai-codex', 'gpt-6-sol')).toMatchObject({ input: 3, origin: 'catalog', longContext: { inputTokensAbove: 272_000 } });
});

test('a cache rate the catalog leaves out is kept from the current price', async () => {
  const store = new UsageStore(':memory:');
  const withWrite = (async () => Response.json({ openai: { models: { 'gpt-6-sol': { cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 } } } } })) as unknown as typeof fetch;
  const withoutWrite = (async () => Response.json({ openai: { models: { 'gpt-6-sol': { cost: { input: 3, output: 12, cache_read: 0.3 } } } } })) as unknown as typeof fetch;
  await refreshUsagePrices(store, withWrite);
  await new Promise(r => setTimeout(r, 5));
  await refreshUsagePrices(store, withoutWrite);
  expect(store.currentPrice('openai', 'gpt-6-sol')).toMatchObject({ input: 3, cacheRead: 0.3, cacheWrite: 2.5 });
});
