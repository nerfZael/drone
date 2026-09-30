import { estimateUsageCost, type TokenCounts } from '@drone/assistant-chat';
import { getUsageStore } from './UsageStore';

/**
 * One model call's cost in USD from the Hub's price table (list rates, long-context rates where known), or null when
 * the model has no price. Subscription models are priced at list rates too, so their usage shows what it is worth.
 */
export function priceModelCall(provider: string, model: string, counts: TokenCounts): number | null {
  try { return estimateUsageCost(getUsageStore().currentPrice(provider, model), counts); }
  catch { return null; }
}
