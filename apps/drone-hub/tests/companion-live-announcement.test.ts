import { expect, test } from 'bun:test';
import { CompanionLiveAnnouncement } from '../src/droneHub/companion/CompanionLiveAnnouncement';

function harness() {
  let now = 0;
  const timers: Array<{ at: number; callback(): void; cancelled: boolean }> = [];
  const sent: Record<string, unknown>[] = [];
  const finished: Array<string | undefined> = [];
  const announcement = new CompanionLiveAnnouncement(event => sent.push(event), error => finished.push(error), (callback, delay) => {
    const timer = { at: now + delay, callback, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  });
  return { announcement, sent, finished, advance(ms: number) {
    now += ms;
    for (const timer of timers) if (!timer.cancelled && timer.at <= now) { timer.cancelled = true; timer.callback(); }
  } };
}

test('announcements wait for readiness, request speech, and stop only after actual audible playback', () => {
  const h = harness();
  h.announcement.deliver('The drone finished.');
  expect(h.sent).toEqual([]);
  h.announcement.connected();
  expect(h.sent.map(event => event.type)).toEqual(['session.instructions.append', 'session.commentary.append']);
  expect(h.sent[1].content).toBe('The drone finished.');
  h.announcement.playback({ stage: 'scheduled', silent: true });
  h.announcement.playback({ stage: 'completed', silent: true });
  h.advance(3_000);
  expect(h.finished).toEqual([]);
  h.announcement.playback({ stage: 'scheduled', silent: false });
  h.advance(3_000);
  expect(h.finished).toEqual([]);
  h.announcement.playback({ stage: 'completed', silent: false });
  h.announcement.playbackBlocked(false);
  h.advance(2_499);
  h.announcement.playback({ stage: 'scheduled', silent: true });
  h.announcement.playbackBlocked(false);
  h.announcement.playback({ stage: 'completed', silent: true });
  expect(h.finished).toEqual([]);
  h.advance(1);
  expect(h.finished).toEqual([undefined]);
  h.announcement.stop();
});

test('queued speech, new results, and blocked playback delay automatic shutdown', () => {
  const h = harness();
  h.announcement.connected();
  h.announcement.deliver('First');
  h.announcement.playback({ stage: 'scheduled', silent: false });
  h.announcement.playback({ stage: 'scheduled', silent: false });
  h.announcement.playback({ stage: 'completed', silent: false });
  h.advance(3_000);
  expect(h.finished).toEqual([]);
  h.announcement.playback({ stage: 'completed', silent: false });
  h.advance(1_000);
  h.announcement.deliver('Second');
  h.advance(3_000);
  expect(h.finished).toEqual([]);
  h.announcement.playback({ stage: 'scheduled', silent: false });
  h.announcement.playback({ stage: 'completed', silent: false });
  h.announcement.playbackBlocked(true);
  h.advance(3_000);
  expect(h.finished).toEqual([]);
  h.announcement.playbackBlocked(false);
  h.advance(2_500);
  expect(h.finished).toEqual([undefined]);
  h.announcement.stop();
});

test('silent or stuck announcements time out and stopping clears every timer', () => {
  const h = harness();
  h.announcement.deliver('Update');
  h.advance(90_000);
  expect(h.finished[0]).toContain('timed out');
  h.announcement.stop();
  h.announcement.connected();
  expect(h.sent).toEqual([]);
  const stopped = harness();
  stopped.announcement.stop();
  stopped.advance(100_000);
  expect(stopped.finished).toEqual([]);
});

test('long subscription results refer to the complete UI answer without truncating it', () => {
  const h = harness();
  h.announcement.deliver('あ'.repeat(1_000));
  h.announcement.connected();
  expect(h.sent).toHaveLength(2);
  expect(h.sent[1].content).toContain('full answer');
  h.announcement.stop();
});

test('a result arriving during speech waits its turn and cannot be completed by earlier audio', () => {
  const h = harness();
  h.announcement.deliver('First');
  h.announcement.connected();
  h.announcement.playback({ stage: 'scheduled', silent: false });
  h.announcement.deliver('Second');
  expect(h.sent.map(event => event.content)).not.toContain('Second');
  h.announcement.playback({ stage: 'completed', silent: false });
  h.advance(2_500);
  expect(h.sent.at(-1)?.content).toBe('Second');
  h.advance(10_000); // New reply is slow to generate audio.
  expect(h.finished).toEqual([]);
  h.announcement.playback({ stage: 'scheduled', silent: false });
  h.announcement.playback({ stage: 'completed', silent: false });
  h.advance(2_500);
  expect(h.finished).toEqual([undefined]);
  h.advance(100_000);
  expect(h.finished).toEqual([undefined]); // Completion cancels its own timeout.
});

test('each queued announcement receives a fresh timeout after previous playback', () => {
  const h = harness();
  h.announcement.deliver('First');
  h.announcement.connected();
  h.announcement.playback({ stage: 'scheduled', silent: false });
  h.advance(85_000);
  h.announcement.deliver('Second');
  h.announcement.playback({ stage: 'completed', silent: false });
  h.advance(2_500);
  h.advance(5_000);
  expect(h.finished).toEqual([]);
  h.announcement.playback({ stage: 'scheduled', silent: false });
  h.announcement.playback({ stage: 'completed', silent: false });
  h.advance(2_500);
  expect(h.finished).toEqual([undefined]);
});
