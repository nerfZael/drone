import { expect, test } from 'bun:test';
import { CompanionLiveTiming } from '../src/companion-live-timing';

test('timings correlate dispatch without content and sample audio once per result', () => {
  let now = 10;
  const events: Record<string, unknown>[] = [];
  const timing = new CompanionLiveTiming(() => now, event => events.push(event));
  now = 460;
  const metadata = timing.dispatch('d1', 450);
  expect(metadata).toEqual({ version: 1, liveSessionId: timing.sessionId, liveDelegationId: 'd1', liveDispatchMs: 450 });
  timing.audioReceived(); timing.audioReceived();
  timing.result('d1'); now = 700;
  timing.audioReceived(); timing.audioReceived();
  timing.playback({ stage: 'scheduled', queueMs: 250, durationMs: 100 });
  timing.playback({ stage: 'scheduled', queueMs: 350, durationMs: 100 });
  expect(events.filter(e => e.stage === 'first_audio_received')).toHaveLength(2);
  expect(events.filter(e => e.stage === 'first_playback_scheduled')).toEqual([
    { sessionId: timing.sessionId, elapsedMs: 690, resultSequence: 1, stage: 'first_playback_scheduled', queueMs: 250, durationMs: 100 },
  ]);
  timing.close(); const count = events.length; timing.result(null); timing.audioReceived();
  expect(events).toHaveLength(count);
});

test('diagnostics are bounded and cannot throw into the voice path', () => {
  const timing = new CompanionLiveTiming(() => 0, () => { throw new Error('logging unavailable'); });
  expect(() => timing.result(null)).not.toThrow();
  const events: unknown[] = [];
  const bounded = new CompanionLiveTiming(() => 0, event => events.push(event));
  for (let i = 0; i < 3000; i++) bounded.result('d');
  expect(events).toHaveLength(2000);
});
