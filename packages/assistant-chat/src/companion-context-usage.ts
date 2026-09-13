export type CompanionContextUsage = {
  tokens: number;
  contextWindow: number;
  percent: number;
  confidence?: 'heuristic';
};

export function parseCompanionContextUsage(value: unknown): CompanionContextUsage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  if (typeof usage.tokens !== 'number' || !Number.isFinite(usage.tokens) || usage.tokens < 0 ||
    typeof usage.contextWindow !== 'number' || !Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return null;
  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.tokens / usage.contextWindow * 100,
    ...(usage.confidence === 'heuristic' ? { confidence: 'heuristic' as const } : {}),
  };
}

export function companionContextUsageLabel(usage: CompanionContextUsage): string {
  return `Context: ${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens · ${Math.round(usage.percent)}%${usage.confidence === 'heuristic' ? ' (estimated)' : ''}`;
}
