import { expect, test } from 'bun:test';
import type { BlipRuntimeEvent } from '@blip/protocol';
import { CompactionEventObserver } from '../src/CompactionEventObserver';

const base = { version: 1 as const, sessionId: 'session', eventId: 'event', timestamp: '2026-09-10T00:00:00Z' };

test('compaction measurements include every model call and reset for each attempt', async () => {
  let now = 0;
  const events: BlipRuntimeEvent[] = [];
  const observer = new CompactionEventObserver(async (event) => { events.push(event); }, () => now);
  await observer.emit({ ...base, type: 'compaction_started', reason: 'auto' });
  for (const complete of [true, false]) {
    observer.modelCall('started');
    now += 10;
    observer.modelCall('finished');
    await observer.emit({
      ...base, type: 'usage_observed', purpose: 'compaction', provider: 'test', model: 'test', complete,
      usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 10, totalTokens: 160 },
    });
  }
  // Chat usage must never inflate summary usage.
  await observer.emit({ ...base, type: 'usage_observed', purpose: 'chat', provider: 'test', model: 'test', complete: true,
    usage: { input: 999, output: 999, cacheRead: 0, cacheWrite: 0, totalTokens: 1998 } });
  now += 5;
  await observer.emit({ ...base, type: 'compaction_completed', summaryId: 'checkpoint', tokensBefore: 9000, tokensAfter: 1000, fallbackUsed: true });
  expect(events.at(-1)).toMatchObject({
    type: 'compaction_completed', fallbackUsed: true,
    metrics: { durationMs: 25, modelDurationMs: 20, modelCallCount: 2, modelResponseCount: 2,
      incompleteModelResponseCount: 1, usage: { input: 200, output: 40, cacheRead: 60, cacheWrite: 20, totalTokens: 320 } },
  });
  await observer.emit({ ...base, type: 'compaction_started', reason: 'manual' });
  now += 3;
  await observer.emit({ ...base, type: 'compaction_skipped', reason: 'nothing to compact' });
  expect(events.at(-1)).toMatchObject({ type: 'compaction_skipped', metrics: { durationMs: 3, modelCallCount: 0, modelResponseCount: 0, usage: { totalTokens: 0 } } });
  await observer.fail(false);
  expect(events.at(-1)?.type).toBe('compaction_skipped');
});

test.each([true, false])('failed compaction records calls with no response; cancelled=%s', async (cancelled) => {
  let now = 0;
  const events: BlipRuntimeEvent[] = [];
  const observer = new CompactionEventObserver(async (event) => { events.push(event); }, () => now);
  await observer.emit({ ...base, type: 'compaction_started', reason: 'manual' });
  observer.modelCall('started');
  now = 50;
  observer.modelCall('finished');
  await observer.fail(cancelled);
  expect(events.at(-1)).toMatchObject({ type: 'compaction_failed', reason: cancelled ? 'cancelled' : 'error',
    metrics: { durationMs: 50, modelDurationMs: 50, modelCallCount: 1, modelResponseCount: 0 } });
  await observer.fail(cancelled);
  expect(events).toHaveLength(2);
});
