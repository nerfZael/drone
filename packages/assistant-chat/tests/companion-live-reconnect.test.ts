import { expect, test } from 'bun:test';
import { companionLiveReconnectDelay } from '../src/companion-live-reconnect';

test('Live reconnect delay backs off exponentially and caps at thirty seconds', () => {
  expect(Array.from({ length: 8 }, (_, attempt) => companionLiveReconnectDelay(attempt))).toEqual([
    1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
  ]);
});
