/** Output includes reasoning. Cache categories are excluded from input. */
export type TokenCounts = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
};

export type UsageObservation = TokenCounts & {
  id: string;
  model: string;
  provider: string;
  sessionId?: string;
  turnId?: string;
  partialReason?: string;
  purpose?: string;
  scope: 'request' | 'thread' | 'tree';
  complete: boolean;
  reportedCost?: number;
  raw: unknown;
};

export type UsagePrice = {
  id: string;
  provider: string;
  model: string;
  effectiveAt: string;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  source: string;
  origin?: 'catalog' | 'bundled' | 'manual';
  createdAt: string;
  /** Rates that apply instead when a request's input (cache included) is above `inputTokensAbove`. */
  longContext?: UsagePriceTier & { inputTokensAbove: number };
};

/** USD per million tokens. */
export type UsagePriceTier = { input: number; output: number; cacheRead: number | null; cacheWrite: number | null };

/**
 * The cost in USD, or null when a category used has no rate. Reasoning is inside output. For one request
 * (`singleRequest`), a request whose whole input is above a long-context threshold takes the long-context rates in
 * every category. Totals over many requests (a thread, a tree) cannot tell which requests were long, so they are
 * priced at the base rates.
 */
export function estimateUsageCost(price: UsagePrice | undefined, counts: TokenCounts, singleRequest = true): number | null {
  if (!price) return null;
  const fields = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
  const context = (counts.input ?? 0) + (counts.cacheRead ?? 0) + (counts.cacheWrite ?? 0);
  const rates: UsagePriceTier = singleRequest && price.longContext && context > price.longContext.inputTokensAbove ? price.longContext : price;
  if (!fields.every((field) => counts[field] !== null && (counts[field] === 0 || rates[field] !== null))) return null;
  return fields.reduce((sum, field) => sum + counts[field]! * (rates[field] ?? 0) / 1_000_000, 0);
}

export type UsageTotals = TokenCounts & {
  executions: number;
  missing: number;
  partial: number;
  partialReasons?: string[];
  running: number;
  interrupted: number;
  recovering: number;
  total: number | null;
  estimatedCost: number | null;
  reportedCost: number | null;
  unpriced: number;
};

export type UsageAnalytics = {
  trackingSince: string;
  totals: UsageTotals;
  groups: Array<UsageTotals & { key: string; label: string }>;
  daily: Array<UsageTotals & { key: string; label: string }>;
};
