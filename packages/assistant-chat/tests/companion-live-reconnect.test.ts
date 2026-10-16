import { expect, test } from 'bun:test';
import { companionLiveReconnectDelay, CompanionLiveReconnectBackoff, COMPANION_LIVE_HEALTHY_SESSION_MS } from '../src/companion-live-reconnect';

test('Live reconnect delay backs off exponentially and caps at thirty seconds', () => {
  expect(Array.from({ length: 8 }, (_, attempt) => companionLiveReconnectDelay(attempt))).toEqual([
    1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
  ]);
});

test('Live reconnect backoff keeps growing when sessions fail soon after ready', () => {
  let now = 0;
  const backoff = new CompanionLiveReconnectBackoff(() => now);
  const delays: Array<number | null> = [];
  for (let i = 0; i < 7; i++) {
    backoff.ready();
    now += 5_000; // Ready, then failed five seconds later.
    delays.push(backoff.next());
  }
  expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, null]);
});

test('Live reconnect backoff restarts after a healthy session', () => {
  let now = 0;
  const backoff = new CompanionLiveReconnectBackoff(() => now);
  expect(backoff.next()).toBe(1_000);
  expect(backoff.next()).toBe(2_000); // Failed before ready.
  backoff.ready();
  now += COMPANION_LIVE_HEALTHY_SESSION_MS;
  expect(backoff.next()).toBe(1_000);
  backoff.reset();
  expect(backoff.next()).toBe(1_000);
});

test('Live reconnect backoff can retry indefinitely at the capped delay', () => {
  const backoff = new CompanionLiveReconnectBackoff(() => 0, Infinity);
  const delays = Array.from({ length: 9 }, () => backoff.next());
  expect(delays.slice(-3)).toEqual([30_000, 30_000, 30_000]);
});
