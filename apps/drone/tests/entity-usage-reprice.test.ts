import { describe, expect, test } from 'bun:test';
import { replayRuntime, type EntityEvent } from '@entity/core';

import { repriceUnpricedUsage } from '../src/hub/entity/entity-usage-reprice';

let seq = 0;
const event = (type: string, by: string, data: Record<string, unknown>): EntityEvent =>
  ({ seq: ++seq, t: seq, at: seq, type, by, data }) as EntityEvent;

const setup = { models: { head: 'openai/gpt-6.1-sol', task: 'openai/gpt-6.1-sol' }, review: 'head', codeLimbs: true, keptSessions: 12 };
const counts = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };
// $1 per 1k input and $10 per 1k output, for gpt-6.1-sol on openai only.
const price = (provider: string, model: string, c: { input?: number | null; output?: number | null }) =>
  provider === 'openai' && model === 'gpt-6.1-sol' ? (c.input ?? 0) / 1000 + ((c.output ?? 0) / 1000) * 10 : null;

describe('repriceUnpricedUsage', () => {
  test('prices worker and head calls logged without a price, by the model of the limb that made them', () => {
    const events = [
      event('session_started', 'user', { setup }),
      event('run_started', 'head', { run: 'run-1', reason: 'user' }),
      event('usage', 'head', { kind: 'run', run: 'run-1', ...counts, cost: null }),
      event('run_finished', 'head', { run: 'run-1', ms: 10, usage: { ...counts, cost: null } }),
      event('limb_spawned', 'head', { id: 'worker-1', name: 'Worker', task: 'x', model: 'openai/gpt-6.1-sol', status: 'running' }),
      event('run_started', 'worker-1', { run: 'run-2', reason: 'spawned' }),
      event('usage', 'worker-1', { kind: 'run', run: 'run-2', ...counts, cost: null }),
      event('usage', 'worker-1', { kind: 'run', run: 'run-2', ...counts, cost: 0.5 }),
      event('run_finished', 'worker-1', { run: 'run-2', ms: 10, usage: { ...counts, cost: null } }),
    ];

    const repriced = repriceUnpricedUsage(events, price);
    const state = replayRuntime(repriced);

    expect(state.limbs['head']!.kind === 'llm' && state.limbs['head']!.usage).toMatchObject({ cost: 2, unpriced: 0 });
    expect(state.limbs['worker-1']!.kind === 'llm' && state.limbs['worker-1']!.usage).toMatchObject({ cost: 2.5, unpriced: 0 });
    expect(state.usage).toMatchObject({ cost: 4.5, unpriced: 0 });
    // The recorded log is not changed.
    expect((events[2]!.data as any).cost).toBeNull();
  });

  test('leaves calls unpriced when their model still has no price', () => {
    const events = [
      event('session_started', 'user', { setup: { ...setup, models: { head: 'other/unknown', task: 'other/unknown' } } }),
      event('run_started', 'head', { run: 'run-1', reason: 'user' }),
      event('usage', 'head', { kind: 'run', run: 'run-1', ...counts, cost: null }),
    ];

    expect(replayRuntime(repriceUnpricedUsage(events, price)).usage).toMatchObject({ cost: 0, unpriced: 1 });
  });
});
