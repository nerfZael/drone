import type { Model } from '@mariozechner/pi-ai/agent-core';

export interface CompactionSettings {
  auto: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
  keepRecentTurns: number;
  /** Independent ceiling for summary generation, separate from chat headroom. */
  summaryMaxTokens?: number;
  /** Trigger at this fraction of the context window, or earlier for output headroom. */
  triggerThreshold?: number;
  /** Desired occupancy after compaction; recent-turn retention is a preference. */
  targetThreshold?: number;
  /** Minimum fractional input reduction required to install a checkpoint. */
  minimumReduction?: number;
  /** Per-message fragment size; longer messages continue in subsequent fragments. */
  maxSummaryMessageChars?: number;
  /** Transcript characters per summary batch; all batches are processed chronologically. */
  maxSummaryInputChars?: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  summaryMaxTokens: 4_096,
  triggerThreshold: 0.9,
  targetThreshold: 0.6,
  minimumReduction: 0.05,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  keepRecentTurns: 2,
  maxSummaryMessageChars: 12_000,
  maxSummaryInputChars: 120_000,
};

export function resolveCompactionSettings(
  settings?: CompactionSettings,
): Required<CompactionSettings> {
  const defined = Object.fromEntries(
    Object.entries(settings ?? {}).filter(([, value]) => value !== undefined),
  );
  const result = { ...DEFAULT_COMPACTION_SETTINGS, ...defined } as Required<CompactionSettings>;
  if (typeof result.auto !== 'boolean') throw new Error('Invalid compaction setting: auto');
  for (const key of ['reserveTokens', 'keepRecentTokens', 'keepRecentTurns'] as const) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0)
      throw new Error(`Invalid compaction setting: ${key}`);
  }
  for (const key of [
    'summaryMaxTokens',
    'maxSummaryMessageChars',
    'maxSummaryInputChars',
  ] as const) {
    if (!Number.isSafeInteger(result[key]) || result[key] <= 0)
      throw new Error(`Invalid compaction setting: ${key}`);
  }
  for (const key of ['triggerThreshold', 'targetThreshold', 'minimumReduction'] as const) {
    if (!Number.isFinite(result[key]) || result[key] <= 0 || result[key] >= 1)
      throw new Error(`Invalid compaction setting: ${key}`);
  }
  if (result.targetThreshold >= result.triggerThreshold)
    throw new Error('Compaction target must be below trigger threshold');
  return result;
}

export function compactionBudget(model: Model<any>, settings: Required<CompactionSettings>) {
  const window =
    Number.isFinite(model.contextWindow) && model.contextWindow > 0
      ? model.contextWindow
      : Number.MAX_SAFE_INTEGER;
  // Simple providers default to up to 32K output tokens. Reserve that allowance,
  // plus a margin for token-estimation error; never reduce an explicit reserve.
  const outputTokens = Math.min(
    model.maxTokens > 0 ? model.maxTokens : 32_000,
    32_000,
    Math.max(1, Math.floor(window / 4)),
  );
  // Some adapters add a thinking allowance to maxTokens. Reserve their largest
  // standard allowance as well; providers with a combined cap simply get margin.
  const outputAllowance = outputTokenAllowance(model, outputTokens, model.reasoning);
  const headroom = Math.max(settings.reserveTokens, outputAllowance + Math.ceil(window * 0.03));
  const hardLimit = Math.max(
    0,
    Math.min(window - headroom, Math.floor(window * settings.triggerThreshold)),
  );
  return {
    outputTokens,
    hardLimit,
    targetLimit: Math.min(hardLimit, Math.floor(window * settings.targetThreshold)),
    summaryTokens: Math.max(
      1,
      Math.min(
        settings.summaryMaxTokens,
        model.maxTokens > 0 ? model.maxTokens : settings.summaryMaxTokens,
        Math.floor(window / 8),
      ),
    ),
  };
}

/** Some simple adapters add thinking tokens on top of the requested output cap. */
export function outputTokenAllowance(
  model: Model<any>,
  outputTokens: number,
  reasoning: boolean,
): number {
  return reasoning
    ? Math.min(
        model.maxTokens > 0 ? model.maxTokens : Number.MAX_SAFE_INTEGER,
        outputTokens + 16_384,
      )
    : outputTokens;
}
