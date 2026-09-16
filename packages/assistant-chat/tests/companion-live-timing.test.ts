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
    { sessionId: timing.sessionId, sequence: 6, elapsedMs: 690, resultSequence: 1, stage: 'first_playback_scheduled', queueMs: 250, durationMs: 100 },
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

test('buffers startup, batches persistence, and flushes close without uploading content', async () => {
  const timing = new CompanionLiveTiming(() => 10, () => {});
  const batches: any[][] = [];
  timing.providerEvent({ type: 'session.input_transcript.delta', delta: 'private speech', start_ms: 0, end_ms: 100 });
  for (let i = 0; i < 205; i++) timing.mark('backend_update');
  timing.setSink(async events => { batches.push(events); });
  timing.close(); await timing.drain();
  expect(batches.map(b => b.length)).toEqual([100, 100, 8]);
  expect(batches.flat().at(-1).stage).toBe('session_closed');
  expect(JSON.stringify(batches)).not.toContain('private speech');
});

test('playback callbacks retain the sampled audio generation across newer results', () => {
  const events: any[] = [];
  const timing = new CompanionLiveTiming(() => 10, e => events.push(e));
  const sampleId = timing.audioReceived();
  expect(timing.audioReceived()).toBeUndefined();
  timing.result('next');
  timing.playback({ stage: 'started', sampleId });
  timing.playback({ stage: 'completed', sampleId });
  expect(events.at(-1).resultSequence).toBe(0);
  expect(timing.audioReceived()).toBe(1);
  timing.close();
});

test('failed uploads do not stop later batches and shutdown waiting is bounded', async () => {
  const timing = new CompanionLiveTiming(() => 10, () => {});
  for (let i = 0; i < 101; i++) timing.mark('backend_update');
  let calls = 0;
  timing.setSink(() => { if (++calls === 1) throw new Error('offline'); });
  timing.close(); await timing.drain();
  expect(calls).toBe(2);
  const stalled = new CompanionLiveTiming(() => 10, () => {});
  stalled.setSink(() => new Promise(() => {}));
  stalled.close(); await stalled.drain();
});

test('failed backend outcomes have their own timing stage', () => {
  const events: Record<string, unknown>[] = [];
  const timing = new CompanionLiveTiming(() => 0, e => events.push(e));
  timing.result('delegation', 'error');
  expect(events.at(-1)).toMatchObject({ stage: 'backend_error', delegationId: 'delegation', resultSequence: 1 });
  expect(events.some(e => e.stage === 'backend_result')).toBe(false);
  timing.close();
});
