export type CompanionCompactionActivity = {
  status: 'running' | 'completed' | 'skipped' | 'cancelled' | 'failed' | 'interrupted';
  tokensBefore?: number;
  tokensAfter?: number;
  fallbackUsed?: boolean;
};

export type CompanionCompactionEvent = {
  type: string;
  reason?: unknown;
  tokensBefore?: unknown;
  tokensAfter?: unknown;
  fallbackUsed?: unknown;
};

export function reduceCompanionCompaction(
  current: CompanionCompactionActivity | null,
  event: CompanionCompactionEvent,
): CompanionCompactionActivity | null {
  if (event.type === 'compaction_started') return { status: 'running' };
  if (event.type === 'compaction_skipped') return { status: 'skipped' };
  if (event.type === 'compaction_failed') {
    return { status: event.reason === 'cancelled' ? 'cancelled' : 'failed' };
  }
  if (event.type === 'compaction_completed') {
    return {
      status: 'completed',
      tokensBefore: tokenCount(event.tokensBefore),
      tokensAfter: tokenCount(event.tokensAfter),
      fallbackUsed: event.fallbackUsed === true,
    };
  }
  return current;
}

/** Shared wording for the web and mobile Companion overlays. */
export function companionCompactionLabel(activity: CompanionCompactionActivity): string {
  if (activity.status === 'running') return 'Compacting context…';
  if (activity.status === 'skipped') return 'Context compaction skipped';
  if (activity.status === 'cancelled') return 'Context compaction stopped';
  if (activity.status === 'failed') return 'Context compaction failed';
  if (activity.status === 'interrupted') return 'Context compaction ended without a result';
  const counts = activity.tokensBefore !== undefined && activity.tokensAfter !== undefined
    ? ` · ~${activity.tokensBefore.toLocaleString()} → ~${activity.tokensAfter.toLocaleString()} tokens`
    : '';
  return `Context compacted${counts}${activity.fallbackUsed ? ' · fallback summary' : ''}`;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value) : undefined;
}
