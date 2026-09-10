import crypto from 'node:crypto';

/** Baselines include restored/forked history; only notifications for live turns become spend. */
export class CodexUsageTracker {
  private readonly totals = new Map<string, Record<string, number>>();
  private readonly turns = new Map<string, string>();

  observe(notification: { method: string; params?: any }, model?: string): any[] {
    const p = notification.params ?? {};
    const thread = String(p.threadId ?? p.thread?.id ?? '');
    const turn = String(p.turnId ?? p.turn?.id ?? '');
    if (notification.method === 'turn/started') this.turns.set(thread, turn);
    if (notification.method === 'thread/compacted' ||
      notification.method === 'item/completed' && p.item?.type === 'contextCompaction') {
      return [{ type: 'usage.coverage', sessionId: thread, turnId: turn, partialReason: 'compaction-unverified' }];
    }
    if (notification.method !== 'thread/tokenUsage/updated' || !p.tokenUsage?.total) return [];
    const current = p.tokenUsage.total;
    const previous = this.totals.get(thread);
    const fields = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'totalTokens'];
    // A decrease is a reset/replay, never negative spending or a new full historical total.
    if (previous && fields.some((field) => typeof current[field] === 'number' && typeof previous[field] === 'number' && current[field] < previous[field])) return [];
    this.totals.set(thread, current);
    if (this.turns.get(thread) !== turn) return [];
    const usage: Record<string, number> = {};
    for (const field of fields) {
      const value = previous ? current[field] - (previous[field] ?? 0) : p.tokenUsage.last?.[field];
      if (Number.isFinite(value) && value >= 0) usage[field] = value;
    }
    if (!Object.values(usage).some((value) => value > 0)) return [];
    return [{ type: 'usage.delta', sessionId: thread, turnId: turn,
      eventId: crypto.createHash('sha256').update(JSON.stringify([thread, turn, current])).digest('hex'),
      model: model ?? 'unknown', provider: 'openai-codex', complete: Boolean(previous), partialReason: previous ? undefined : 'missing-baseline', usage }];
  }
}
