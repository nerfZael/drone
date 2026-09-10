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
};

export type UsageTotals = TokenCounts & {
  executions: number;
  missing: number;
  partial: number;
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
