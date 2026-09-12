import type { Model } from '@mariozechner/pi-ai/agent-core';

export interface CompactionSettings {
  auto: boolean;
  /** Prepare a checkpoint before the hard trigger; install only at a model boundary. */
  background?: boolean;
  /** Fraction of the hard trigger at which background preparation may start. */
  backgroundThreshold?: number;
  /** Operational window override; zero uses provider defaults, never exceeds the model. */
  contextWindowTokens?: number;
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
  /** Optional explicit transcript character ceiling; default batches use available model capacity. */
  maxSummaryInputChars?: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  background: true,
  backgroundThreshold: 0.85,
  contextWindowTokens: 0,
  summaryMaxTokens: 4_096,
  triggerThreshold: 0.9,
  targetThreshold: 0.6,
  minimumReduction: 0.05,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  keepRecentTurns: 2,
  maxSummaryMessageChars: 12_000,
  maxSummaryInputChars: Number.MAX_SAFE_INTEGER,
};

export function resolveCompactionSettings(
  settings?: CompactionSettings,
): Required<CompactionSettings> {
  const defined = Object.fromEntries(
    Object.entries(settings ?? {}).filter(([, value]) => value !== undefined),
  );
  const result = { ...DEFAULT_COMPACTION_SETTINGS, ...defined } as Required<CompactionSettings>;
  if (typeof result.auto !== 'boolean') throw new Error('Invalid compaction setting: auto');
  if (typeof result.background !== 'boolean') throw new Error('Invalid compaction setting: background');
  for (const key of ['reserveTokens', 'keepRecentTokens', 'keepRecentTurns', 'contextWindowTokens'] as const) {
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
  for (const key of ['triggerThreshold', 'targetThreshold', 'minimumReduction', 'backgroundThreshold'] as const) {
    if (!Number.isFinite(result[key]) || result[key] <= 0 || result[key] >= 1)
      throw new Error(`Invalid compaction setting: ${key}`);
  }
  if (result.targetThreshold >= result.triggerThreshold)
    throw new Error('Compaction target must be below trigger threshold');
  return result;
}

export function compactionBudget(model: Model<any>, settings: Required<CompactionSettings>) {
  const window = operationalContextWindow(model, settings);
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
    contextWindow: window,
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

/** Keep the advertised model capability separate from the window used by the agent. */
export function operationalContextWindow(model: Model<any>, settings: CompactionSettings): number {
  const maximum = Number.isFinite(model.contextWindow) && model.contextWindow > 0
    ? model.contextWindow : Number.MAX_SAFE_INTEGER;
  const providerDefault = model.provider === 'openai' || model.provider === 'openai-codex'
    ? 272_000 : maximum;
  return Math.min(maximum, settings.contextWindowTokens || providerDefault);
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
