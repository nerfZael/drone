import { expect, test } from 'bun:test';
import { CompanionLiveTelemetry, validateLiveTiming } from '../src/hub/companion/companion-live-telemetry';
import type { CompanionRunTelemetryRecord } from '../src/hub/companion/companion-telemetry';
const event = (sequence: number, stage: string, elapsedMs: number, extra = {}) => ({ sessionId: 'live-test', sequence, stage, elapsedMs, resultSequence: 0, ...extra });

test('Live telemetry strips content, validates bounds and rejects cross-session events', async () => {
  const clean = validateLiveTiming(event(1, 'session_started', 0, { audio: 'secret', delta: 'speech', content: 'prompt', durationMs: Infinity }), 'live-test');
  expect(clean).toEqual(event(1, 'session_started', 0));
  expect(validateLiveTiming(event(2001, 'session_started', 0), 'live-test')).toBeUndefined();
  expect(validateLiveTiming(event(1, 'arbitrary text', 0), 'live-test')).toBeUndefined();
  expect(validateLiveTiming(event(1, 'session_started', -1), 'live-test')).toBeUndefined();
  expect(validateLiveTiming(event(1, 'session_started', 0), 'other')).toBeUndefined();
  const store = new CompanionLiveTelemetry();
  await store.record('live-test', 'client', [clean, clean, event(2, 'provider_session_closed', 2)]);
  expect(store.events()).toHaveLength(1);
});

test('joined report uses same-clock intervals and unions overlapping backend work', async () => {
  const store = new CompanionLiveTelemetry();
  await store.record('live-test', 'client', [event(1, 'session_started', 0), event(2, 'live_ready', 500),
    event(3, 'backend_dispatched', 1_000, { delegationId: 'd', dispatchMs: 450 }),
    event(4, 'backend_result', 3_000, { delegationId: 'd', resultSequence: 1 }),
    event(5, 'first_audio_received', 3_100, { resultSequence: 1 }),
    event(6, 'first_playback_started', 3_200, { resultSequence: 0 }), // Older audio must not match.
    event(7, 'append_submitted', 3_000, { eventId: 'a' }),
    event(8, 'append_acknowledged', 3_300, { eventId: 'a' }), event(9, 'session_closed', 4_000)]);
  await store.record('live-test', 'hub', [event(1, 'hub_append_received', 80, { eventId: 'a' }),
    event(2, 'hub_append_forwarded', 82, { eventId: 'a' }), event(3, 'provider_append_acknowledged', 180, { eventId: 'a' })]);
  const run = (messageId: string, start: number, end: number) => ({ messageId, client: { liveSessionId: 'live-test' },
    startedAt: new Date(start).toISOString(), finishedAt: new Date(end).toISOString(), durationMs: end - start }) as CompanionRunTelemetryRecord;
  const report = store.report([run('one', 1000, 3000), run('two', 2000, 4000)]);
  expect(report.startupMs).toBe(500);
  expect(report.backend.activeWallMs).toBe(3000);
  expect(report.backend.runDurationSumMs).toBe(4000);
  expect(report.delegations[0]).toMatchObject({ backendRoundTripMs: 2000, resultToNextAudioMs: 100, audioToPlaybackObservedMs: null });
  expect(report.appends[0]).toMatchObject({ hubForwardMs: 2, providerAcknowledgmentMs: 98, clientAcknowledgmentMs: 300 });
  expect(report.coverage.clientClosed).toBe(true);
  expect(report.providerConnectionMs).toBeNull();
});

test('missing batches and capped sessions are explicit, and retention is bounded', async () => {
  const store = new CompanionLiveTelemetry();
  await store.record('live-test', 'client', [event(1, 'session_started', 0), event(2000, 'backend_update', 100)]);
  expect(store.report([]).coverage).toMatchObject({ truncated: true, missingClientSequences: 1998, clientClosed: false });
  for (let i = 0; i < 101; i++) await store.record(`live-${i}`, 'client', [{ ...event(1, 'session_started', 0), sessionId: `live-${i}` }]);
  expect(store.events('live-test')).toEqual([]);
  expect(store.report([]).sessionId).toBe('live-100');
});


test('an empty voice timeline never collects unrelated text-only backend runs', () => {
  const store = new CompanionLiveTelemetry();
  const report = store.report([{ durationMs: 999 } as CompanionRunTelemetryRecord]);
  expect(report.sessionId).toBeNull();
  expect(report.backend.runCount).toBe(0);
  expect(report.backend.activeWallMs).toBe(0);
});
