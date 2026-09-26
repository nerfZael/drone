import type { UsagePrice } from '@drone/assistant-chat';
import type { UsageStore } from './UsageStore';

type Bundled = Pick<UsagePrice, 'input' | 'output' | 'cacheRead' | 'cacheWrite'> & Required<Pick<UsagePrice, 'longContext'>>;

/**
 * Rates the price catalog (models.dev) does not carry: long-context rates, and cache writes where the catalog leaves
 * them out. Standard token list prices; the same apply to the subscription (openai-codex) models, so their usage
 * shows what it would cost at list price.
 */
const BUNDLED: Record<string, Bundled> = {
  'gpt-6-sol': { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10, longContext: { inputTokensAbove: 272_000, input: 4, cacheRead: 0.4, cacheWrite: 5, output: 15 } },
  'gpt-6-luna': { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5, longContext: { inputTokensAbove: 272_000, input: 0.2, cacheRead: 0.02, cacheWrite: 0.25, output: 0.75 } },
};
const SOURCE = 'Bundled with Drone Hub: OpenAI list rates with long-context rates (same table as StorySpark shared llm-costs, shared-rates-2026-09-gpt6-opus55)';

/**
 * Adds long-context rates to the current price of each bundled model, keeping the current base rates when there are
 * any. Idempotent; a manual price is left alone.
 */
export function applyBundledPrices(store: UsageStore): number {
  const added: Array<Omit<UsagePrice, 'id' | 'createdAt'>> = [];
  for (const [model, bundled] of Object.entries(BUNDLED)) {
    for (const provider of ['openai', 'openai-codex']) {
      const current = store.currentPrice(provider, model);
      if (current?.longContext || current?.origin === 'manual') continue;
      const base = current ?? bundled;
      added.push({
        provider, model, effectiveAt: new Date().toISOString(), origin: 'bundled', source: SOURCE,
        input: base.input, output: base.output, cacheRead: base.cacheRead ?? bundled.cacheRead, cacheWrite: base.cacheWrite ?? bundled.cacheWrite,
        longContext: bundled.longContext,
      });
    }
  }
  if (added.length) store.addPrices(added);
  return added.length;
}
