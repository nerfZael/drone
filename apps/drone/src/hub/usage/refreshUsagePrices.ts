import { getUsageStore, type UsageStore } from './UsageStore';
import type { UsagePrice } from '@drone/assistant-chat';

export async function refreshUsagePrices(store: UsageStore = getUsageStore(), fetcher: typeof fetch = fetch): Promise<number> {
  const response = await fetcher('https://models.dev/api.json', { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Price refresh failed (${response.status})`);
  const providers: any = await response.json();
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) throw new Error('Invalid price catalog');
  const existing = new Map(store.prices().map((price) => [`${price.provider}:${price.model}`, price] as const).reverse());
  const effectiveAt = new Date().toISOString();
  const pending: Array<Omit<UsagePrice, 'id' | 'createdAt'>> = [];
  for (const [provider, entry] of Object.entries<any>(providers)) {
    for (const [model, item] of Object.entries<any>(entry?.models ?? {})) {
      const cost = item?.cost;
      if (!cost || !valid(cost.input) || !valid(cost.output) || (cost.cache_read != null && !valid(cost.cache_read)) || (cost.cache_write != null && !valid(cost.cache_write))) continue;
      // Use token list prices, not a claim about subscription charges or service fees.
      for (const billingProvider of provider === 'openai' ? ['openai', 'openai-codex'] : [provider]) {
        const rates = { input: cost.input, output: cost.output, cacheRead: cost.cache_read ?? null, cacheWrite: cost.cache_write ?? null };
        const old = existing.get(`${billingProvider}:${model}`);
        if (old && (old.origin === 'manual' || (!old.origin && !old.source.startsWith('https://models.dev/')))) continue;
        if (old && Object.entries(rates).every(([key, value]) => old[key as keyof typeof rates] === value)) continue;
        pending.push({ ...rates, provider: billingProvider, model, effectiveAt, origin: 'catalog',
          source: 'https://models.dev/api.json (standard token list rates; excludes tier, region and tool charges)' });
      }
    }
  }
  if (!pending.length && !store.prices().length) throw new Error('Price catalog contains no usable rates');
  store.addPrices(pending);
  return pending.length;
}

function valid(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
