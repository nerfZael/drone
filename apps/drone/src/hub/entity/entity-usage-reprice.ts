import type { EntityEvent } from '@entity/core';
import type { TokenCounts } from '@drone/assistant-chat';

type Counts = { input?: number | null; output?: number | null; cacheRead?: number | null; cacheWrite?: number | null; cost?: number | null };

/**
 * Prices a restored session's model calls that had no known price when they ran, from today's price list.
 * A call is priced when it happens and its cost is logged, so a model priced later would otherwise stay
 * unpriced for the whole session. The log on disk is left as recorded; only the replayed copy changes.
 */
export function repriceUnpricedUsage(
  events: readonly EntityEvent[],
  price: (provider: string, model: string, counts: TokenCounts) => number | null,
): EntityEvent[] {
  const models = new Map<string, string>();
  const priced = (limb: string, used: Counts): Counts | null => {
    if (!used || typeof used.cost === 'number') return null;
    const [provider, ...rest] = (models.get(limb) ?? '').split('/');
    if (!provider || !rest.length) return null;
    const cost = price(provider, rest.join('/'), {
      input: used.input ?? 0, output: used.output ?? 0, cacheRead: used.cacheRead ?? 0, cacheWrite: used.cacheWrite ?? 0, reasoning: null,
    });
    return cost === null ? null : { ...used, cost };
  };
  return events.map(event => {
    const data = event.data as Record<string, any>;
    if (event.type === 'session_started' && data.setup?.models) {
      const { head, voice } = data.setup.models;
      if (head) { models.set('head', head); models.set('reviewer', head); }
      if (voice) models.set('voice', voice);
    }
    if (event.type === 'limb_spawned' && data.model) models.set(String(data.id), String(data.model));
    if (event.type === 'usage' && data.kind === 'run') {
      const next = priced(event.by, data);
      if (next) return { ...event, data: { ...data, ...next } };
    }
    if (event.type === 'run_finished' && data.usage) {
      const next = priced(event.by, data.usage);
      if (next) return { ...event, data: { ...data, usage: next } };
    }
    return event;
  });
}
